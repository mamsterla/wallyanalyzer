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
    """Port of the core `fftlag` logic from `MeasureSine14.m`.

    Parameters
    ----------
    segment:
        Array of shape `(n_samples, 2)` after detrending and windowing.
    dt_s:
        Sample interval in seconds.
    spectral_half_width_bins:
        Half-width around the fundamental spectral peak.
    """

    if segment.ndim != 2 or segment.shape[1] != 2:
        raise ValueError("segment must have shape (n_samples, 2)")
    if dt_s <= 0:
        raise ValueError("dt_s must be positive")

    n_samples = segment.shape[0]
    if n_samples < 8:
        raise FFTLagError("segment is too short for FFT lag analysis")

    channel_std = np.std(segment, axis=0)
    if np.any(channel_std == 0):
        raise FFTLagError("segment contains a zero-variance channel")

    normalized = segment / channel_std[None, :]
    spectrum = np.fft.rfft(np.fft.ifftshift(normalized, axes=0), axis=0)
    power_by_channel = np.abs(spectrum) ** 2
    mean_power = np.mean(power_by_channel, axis=1)
    if frequency_axis_hz is None:
        frequency_axis_hz = np.fft.rfftfreq(n_samples, d=dt_s)

    positive_region = mean_power
    peak_index = int(np.argmax(positive_region))
    if peak_index == 0:
        raise FFTLagError("dominant spectral peak is DC; expected tonal content")

    if peak_window_offsets is None:
        peak_window_offsets = np.arange(
            -spectral_half_width_bins,
            spectral_half_width_bins + 1,
            dtype=int,
        )
    peak_indices = peak_index + peak_window_offsets
    if peak_indices[0] < 0 or peak_indices[-1] >= mean_power.shape[0]:
        raise FFTLagError("peak window exceeds FFT bounds")

    phase = np.angle(spectrum[peak_indices, :])
    dphi = phase[:, 1] - phase[:, 0]
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
    lag_s = float(np.sum(lag_by_bin * weight))
    fundamental_freq_hz = peak_freqs @ weights

    harmonic_amplitude = np.array(
        [
            np.sqrt(np.sum(mean_power[peak_indices])),
            _harmonic_amplitude(
                mean_power,
                peak_index,
                2,
                spectral_half_width_bins,
                harmonic_search_offsets=harmonic_search_offsets,
                harmonic_width_offsets=harmonic_width_offsets,
            ),
            _harmonic_amplitude(
                mean_power,
                peak_index,
                3,
                spectral_half_width_bins,
                harmonic_search_offsets=harmonic_search_offsets,
                harmonic_width_offsets=harmonic_width_offsets,
            ),
        ],
        dtype=float,
    )

    return FFTLagResult(
        lag_s=lag_s,
        fundamental_freq_hz=np.asarray(fundamental_freq_hz, dtype=float),
        harmonic_amplitude=harmonic_amplitude,
        peak_index=peak_index,
        peak_indices=peak_indices,
    )


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


def _harmonic_amplitude(
    mean_power: np.ndarray,
    peak_index: int,
    harmonic_number: int,
    spectral_half_width_bins: int,
    harmonic_search_offsets: np.ndarray | None = None,
    harmonic_width_offsets: np.ndarray | None = None,
) -> float:
    if harmonic_search_offsets is None:
        harmonic_search_offsets = np.arange(-spectral_half_width_bins, spectral_half_width_bins + 1, dtype=int)
    harmonic_region = peak_index * harmonic_number + harmonic_search_offsets
    harmonic_region = harmonic_region[(harmonic_region >= 0) & (harmonic_region < mean_power.shape[0])]
    if harmonic_region.size == 0:
        return float("nan")

    local_peak_position = int(np.argmax(mean_power[harmonic_region]))
    harmonic_center = int(harmonic_region[local_peak_position])
    if harmonic_width_offsets is None:
        harmonic_width_offsets = np.arange(-2, 3, dtype=int)
    amplitude_region = harmonic_center + harmonic_width_offsets
    amplitude_region = amplitude_region[
        (amplitude_region >= 0) & (amplitude_region < mean_power.shape[0])
    ]
    return float(np.sqrt(np.sum(mean_power[amplitude_region])))
