from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class FFTLagResult:
    lag_s: float
    fundamental_freq_hz: np.ndarray
    harmonic_amplitude: np.ndarray
    peak_index: int
    peak_indices: np.ndarray
    lag_difference_db: np.ndarray
    power_noise: np.ndarray
    harmonic_lr_difference: float
    harmonic_lr_difference_ratio: float
    phase_delta_rad: np.ndarray


class FFTLagError(ValueError):
    pass


def fftlag(
    segment: np.ndarray,
    dt_s: float,
    spectral_half_width_bins: int = 5,
    frequency_axis_hz: np.ndarray | None = None,
    peak_window_offsets: np.ndarray | None = None,
    harmonic_search_offsets: np.ndarray | None = None,
    harmonic_width_offsets: np.ndarray | None = None,
) -> FFTLagResult:
    """Port of `fftlag` from `MeasureSine33.m`."""

    if segment.ndim != 2 or segment.shape[1] != 2:
        raise ValueError("segment must have shape (n_samples, 2)")
    if dt_s <= 0:
        raise ValueError("dt_s must be positive")

    n_samples = segment.shape[0]
    if n_samples < 8:
        raise FFTLagError("segment is too short for FFT lag analysis")

    channel_std = np.std(segment, axis=0, ddof=1)
    if np.any(channel_std == 0) or np.any(~np.isfinite(channel_std)):
        raise FFTLagError("segment contains a zero-variance channel")

    normalized = segment / channel_std[None, :]
    one_sided_spectrum = np.fft.rfft(np.fft.ifftshift(normalized, axes=0), axis=0)
    power_by_channel = np.abs(one_sided_spectrum) ** 2
    total_power = np.sum(power_by_channel, axis=1)
    if frequency_axis_hz is None:
        frequency_axis_hz = np.fft.rfftfreq(n_samples, d=dt_s)
    else:
        frequency_axis_hz = np.asarray(frequency_axis_hz, dtype=float)
        if frequency_axis_hz.shape[0] == n_samples:
            frequency_axis_hz = frequency_axis_hz[: one_sided_spectrum.shape[0]]

    positive_region = total_power[: n_samples // 2 - 1]
    peak_index = int(np.argmax(positive_region))
    if peak_index == 0:
        raise FFTLagError("dominant spectral peak is DC; expected tonal content")

    if peak_window_offsets is None:
        peak_window_offsets = np.arange(-spectral_half_width_bins, spectral_half_width_bins + 1, dtype=int)
    peak_indices = peak_index + peak_window_offsets
    if peak_indices[0] < 0 or peak_indices[-1] >= one_sided_spectrum.shape[0]:
        raise FFTLagError("peak window exceeds FFT bounds")

    phase = np.angle(one_sided_spectrum[peak_indices, :])
    dphi = np.diff(phase, axis=1).reshape(-1)
    dphi = _unwrap_phase_like_matlab(dphi)

    peak_freqs = frequency_axis_hz[peak_indices]
    if np.any(peak_freqs == 0):
        raise FFTLagError("peak window includes zero frequency; cannot convert phase to lag")

    weights0 = power_by_channel[peak_indices, :]
    per_channel_weight_sum = np.sum(weights0, axis=0)
    if np.any(per_channel_weight_sum == 0):
        raise FFTLagError("zero spectral weight near the fundamental peak")
    weights = weights0 / per_channel_weight_sum[None, :]
    weight0 = np.sum(weights0, axis=1)
    weight = weight0 / np.sum(weight0)

    lag_by_bin = dphi / (2.0 * np.pi * peak_freqs)
    lag_s = float(lag_by_bin @ weight)
    fundamental_freq_hz = peak_freqs @ weights

    h2_region = _harmonic_region_indices(
        total_power,
        peak_index,
        2,
        spectral_half_width_bins,
        harmonic_search_offsets,
        harmonic_width_offsets,
    )
    h3_region = _harmonic_region_indices(
        total_power,
        peak_index,
        3,
        spectral_half_width_bins,
        harmonic_search_offsets,
        harmonic_width_offsets,
    )
    harmonic_amplitude = np.array(
        [
            float(np.sqrt(np.sum(total_power[peak_indices]))),
            float(np.sqrt(np.sum(total_power[h2_region]))) if h2_region.size else float("nan"),
            float(np.sqrt(np.sum(total_power[h3_region]))) if h3_region.size else float("nan"),
        ],
        dtype=float,
    )

    sum_power = float(2.0 * np.sum(power_by_channel[peak_indices, :]))
    diff_spectrum = one_sided_spectrum[peak_indices, 0] - one_sided_spectrum[peak_indices, 1]
    diff_power = float(2.0 * np.sum(np.abs(diff_spectrum) ** 2))
    corrected_right = one_sided_spectrum[peak_indices, 1] * np.exp(-1j * 2.0 * np.pi * peak_freqs * lag_s)
    corrected_diff = one_sided_spectrum[peak_indices, 0] - corrected_right
    corrected_diff_power = float(2.0 * np.sum(np.abs(corrected_diff) ** 2))
    lag_difference_ratio = np.array([diff_power / sum_power, corrected_diff_power / sum_power], dtype=float)
    lag_difference_db = 10.0 * np.log10(np.maximum(lag_difference_ratio, np.finfo(float).tiny))

    harmonic_lr_difference = float(np.sqrt(np.sum(np.abs(one_sided_spectrum[peak_indices, 0] - one_sided_spectrum[peak_indices, 1]) ** 2)))
    harmonic_lr_difference_ratio = float(harmonic_lr_difference / harmonic_amplitude[0]) if harmonic_amplitude[0] > 0 else float("nan")

    total_left_power = _full_power_from_onesided(power_by_channel[:, 0], n_samples)
    total_right_power = _full_power_from_onesided(power_by_channel[:, 1], n_samples)
    i200 = int(np.argmin(np.abs(frequency_axis_hz - 200.0)))
    removed_indices = np.arange(i200 + 1, dtype=int)
    removed_indices = np.unique(
        np.concatenate(
            [
                removed_indices,
                peak_indices,
                h2_region if h2_region.size else np.empty(0, dtype=int),
                h3_region if h3_region.size else np.empty(0, dtype=int),
            ]
        )
    )
    noise_left_power = total_left_power - float(np.sum(power_by_channel[removed_indices, 0]))
    noise_right_power = total_right_power - float(np.sum(power_by_channel[removed_indices, 1]))
    power_noise = np.array(
        [
            total_left_power,
            total_right_power,
            noise_left_power,
            noise_right_power,
        ],
        dtype=float,
    )

    return FFTLagResult(
        lag_s=lag_s,
        fundamental_freq_hz=np.asarray(fundamental_freq_hz, dtype=float),
        harmonic_amplitude=harmonic_amplitude,
        peak_index=peak_index,
        peak_indices=peak_indices,
        lag_difference_db=np.asarray(lag_difference_db, dtype=float),
        power_noise=power_noise,
        harmonic_lr_difference=harmonic_lr_difference,
        harmonic_lr_difference_ratio=harmonic_lr_difference_ratio,
        phase_delta_rad=np.asarray(dphi, dtype=float),
    )


def _full_power_from_onesided(power: np.ndarray, n_samples: int) -> float:
    power = np.asarray(power, dtype=float)
    if power.size == 0:
        return 0.0
    if n_samples % 2 == 0 and power.size >= 2:
        return float(power[0] + power[-1] + 2.0 * np.sum(power[1:-1]))
    return float(power[0] + 2.0 * np.sum(power[1:]))


def _unwrap_phase_like_matlab(dphi: np.ndarray) -> np.ndarray:
    dphi = np.asarray(dphi, dtype=float).copy()
    reference = float(np.median(dphi))

    big = np.flatnonzero(dphi - reference > np.pi)
    little = np.flatnonzero(dphi - reference < -np.pi)

    if big.size:
        dphi[big] = dphi[big] - 2.0 * np.pi * np.ceil((dphi[big] - reference) / (2.0 * np.pi))
    if little.size:
        dphi[little] = dphi[little] + 2.0 * np.pi * np.ceil((reference - dphi[little]) / (2.0 * np.pi))
    return dphi


def _harmonic_region_indices(
    total_power: np.ndarray,
    peak_index: int,
    harmonic_number: int,
    spectral_half_width_bins: int,
    harmonic_search_offsets: np.ndarray | None = None,
    harmonic_width_offsets: np.ndarray | None = None,
) -> np.ndarray:
    if harmonic_search_offsets is None:
        harmonic_search_offsets = np.arange(-spectral_half_width_bins, spectral_half_width_bins + 1, dtype=int)
    search_center = peak_index * harmonic_number
    harmonic_region = search_center + harmonic_search_offsets
    harmonic_region = harmonic_region[(harmonic_region >= 0) & (harmonic_region < total_power.shape[0])]
    if harmonic_region.size == 0:
        return np.array([], dtype=int)

    local_peak_position = int(np.argmax(total_power[harmonic_region]))
    harmonic_center = int(harmonic_region[local_peak_position])
    if harmonic_width_offsets is None:
        harmonic_width_offsets = np.arange(-2, 3, dtype=int)
    amplitude_region = harmonic_center + harmonic_width_offsets
    amplitude_region = amplitude_region[(amplitude_region >= 0) & (amplitude_region < total_power.shape[0])]
    return np.asarray(amplitude_region, dtype=int)
