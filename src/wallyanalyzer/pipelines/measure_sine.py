from __future__ import annotations

from pathlib import Path
import time

import numpy as np

from wallyanalyzer.audio import infer_decimation_factor, load_wav
from wallyanalyzer.metadata import MetadataProvider
from wallyanalyzer.schemas import MeasureSineConfig, MeasurementResult
from wallyanalyzer.signal import (
    analyze_period_envelope,
    build_snippet_geometry,
    fftlag,
    nuttall_window,
)


class MeasurementPipelineError(RuntimeError):
    pass


def measure_sine_file(
    audio_path: str | Path,
    metadata_provider: MetadataProvider,
    config: MeasureSineConfig | None = None,
) -> MeasurementResult:
    config = config or MeasureSineConfig()
    path = Path(audio_path)
    file_stem = path.stem

    acquisition = metadata_provider.get_acquisition(file_stem)
    if not acquisition.test_track_name:
        raise MeasurementPipelineError(f"Acquisition record for {file_stem!r} has no test_track_name")
    test_track = metadata_provider.get_test_track(acquisition.test_track_name)

    t0 = time.perf_counter()
    decimation_factor = infer_decimation_factor(acquisition.digitizer)
    audio = load_wav(path, decimation_factor=decimation_factor)
    t_audio_load = time.perf_counter() - t0
    if audio.num_channels != 2:
        raise MeasurementPipelineError(
            f"Expected stereo WAV input, got num_channels={audio.num_channels}"
        )

    effective_sample_rate_hz = audio.sample_rate_hz / audio.decimation_factor
    dt_s = 1.0 / effective_sample_rate_hz
    samples_per_revolution = config.rotation_period_s / dt_s
    samples_per_period = int(round(0.001 / dt_s))
    skip_samples = int(round(samples_per_revolution / 360.0 * config.skip_deg))

    if samples_per_period <= 0:
        raise MeasurementPipelineError("Derived samples_per_period is not positive")
    if skip_samples <= 0:
        raise MeasurementPipelineError("Derived skip_samples is not positive")

    t1 = time.perf_counter()
    envelope_result = analyze_period_envelope(
        audio.samples,
        period_samples=samples_per_period,
        threshold_fraction=config.envelope_threshold_fraction,
        end_threshold_fraction=config.envelope_end_threshold_fraction,
    )
    t_envelope = time.perf_counter() - t1

    t2 = time.perf_counter()
    highpass_filter_length = int(config.highpass_window_base / audio.decimation_factor) + 1
    smoothing_filter = nuttall_window(highpass_filter_length)
    smoothing_filter = smoothing_filter / np.sum(smoothing_filter)
    smoothing_margin = (highpass_filter_length - 1) // 2

    snippet_length_samples = config.periods_per_segment * samples_per_period
    padding_length_samples = highpass_filter_length - 1
    snippet_geometry = build_snippet_geometry(
        start_sample=envelope_result.start_sample,
        end_sample=envelope_result.end_sample,
        snippet_length_samples=snippet_length_samples,
        padding_length_samples=padding_length_samples,
        skip_samples=skip_samples,
    )
    analysis_window = nuttall_window(snippet_length_samples)
    analysis_window_2d = analysis_window[:, None]
    smoothed_full = _fft_convolve_same_multichannel(audio.samples, smoothing_filter)
    t_setup = time.perf_counter() - t2

    n_segments = len(snippet_geometry.start_indices)
    lag_s = np.full(n_segments, np.nan, dtype=float)
    fundamental_freq_hz = np.full((n_segments, 2), np.nan, dtype=float)
    harmonic_amplitude = np.full((n_segments, 3), np.nan, dtype=float)
    lr_diff_over_sum_rms_ratio = np.full(n_segments, np.nan, dtype=float)
    lag_difference_db = np.full((n_segments, 2), np.nan, dtype=float)
    power_noise = np.full((n_segments, 4), np.nan, dtype=float)
    harmonic_lr_difference_ratio = np.full(n_segments, np.nan, dtype=float)
    phase_delta_rad = np.full((n_segments, 2 * config.spectral_half_width_bins + 1), np.nan, dtype=float)
    valid_mask = np.zeros(n_segments, dtype=bool)

    process_start = time.perf_counter()
    valid_snippet_count = 0
    rejected_snippet_count = 0
    fft_failure_count = 0
    t_extract = 0.0
    t_validity = 0.0
    t_detrend = 0.0
    t_fft = 0.0
    t_lr_metric = 0.0
    edge_probe_samples = min(500, snippet_geometry.padded_length_samples)
    padded_length_samples = snippet_geometry.padded_length_samples
    for index, start_sample in enumerate(snippet_geometry.start_indices):
        loop_t0 = time.perf_counter()
        end_sample = start_sample + padded_length_samples
        padded_snippet = audio.samples[start_sample:end_sample, :]
        t_extract += time.perf_counter() - loop_t0

        loop_t1 = time.perf_counter()
        leading = padded_snippet[:edge_probe_samples, :]
        trailing = padded_snippet[-edge_probe_samples:, :]
        leading_rms = np.sqrt(np.mean(np.square(leading), axis=0))
        trailing_rms = np.sqrt(np.mean(np.square(trailing), axis=0))
        leading_peak = np.max(np.abs(leading), axis=0)
        trailing_peak = np.max(np.abs(trailing), axis=0)
        full_peak = np.max(np.abs(padded_snippet), axis=0)
        is_valid = not (
            np.any(config.noise_reject_rms_multiplier * leading_rms < leading_peak)
            or np.any(config.noise_reject_rms_multiplier * trailing_rms < trailing_peak)
            or np.any(full_peak < envelope_result.level / 2.0)
        )
        t_validity += time.perf_counter() - loop_t1
        if not is_valid:
            rejected_snippet_count += 1
            continue

        loop_t2 = time.perf_counter()
        centered_start = start_sample + smoothing_margin
        centered_end = centered_start + snippet_length_samples
        signal_of_interest = audio.samples[centered_start:centered_end, :]
        trend = smoothed_full[centered_start:centered_end, :]
        detrended = (signal_of_interest - trend) * analysis_window_2d
        t_detrend += time.perf_counter() - loop_t2
        try:
            loop_t3 = time.perf_counter()
            fft_result = fftlag(
                detrended,
                dt_s=dt_s,
                spectral_half_width_bins=config.spectral_half_width_bins,
            )
            t_fft += time.perf_counter() - loop_t3
        except Exception:
            fft_failure_count += 1
            continue
        lag_s[index] = fft_result.lag_s
        fundamental_freq_hz[index, :] = fft_result.fundamental_freq_hz
        harmonic_amplitude[index, :] = fft_result.harmonic_amplitude
        lag_difference_db[index, :] = fft_result.lag_difference_db
        power_noise[index, :] = fft_result.power_noise
        harmonic_lr_difference_ratio[index] = fft_result.harmonic_lr_difference_ratio
        phase_delta_rad[index, : fft_result.phase_delta_rad.shape[0]] = fft_result.phase_delta_rad

        loop_t4 = time.perf_counter()
        sum_signal = detrended[:, 0] + detrended[:, 1]
        diff_signal = detrended[:, 0] - detrended[:, 1]
        sum_rms = np.sqrt(np.mean(np.square(sum_signal)))
        if sum_rms > 0:
            diff_rms = np.sqrt(np.mean(np.square(diff_signal)))
            lr_diff_over_sum_rms_ratio[index] = float(diff_rms / sum_rms)
        t_lr_metric += time.perf_counter() - loop_t4
        valid_mask[index] = True
        valid_snippet_count += 1

    large_lag_mask = np.abs(lag_s) > config.lag_outlier_abs_s
    lag_s[large_lag_mask] = np.nan
    valid_mask[large_lag_mask] = False
    fundamental_freq_hz[large_lag_mask, :] = np.nan
    harmonic_amplitude[large_lag_mask, :] = np.nan
    lr_diff_over_sum_rms_ratio[large_lag_mask] = np.nan
    lag_difference_db[large_lag_mask, :] = np.nan
    power_noise[large_lag_mask, :] = np.nan
    harmonic_lr_difference_ratio[large_lag_mask] = np.nan
    phase_delta_rad[large_lag_mask, :] = np.nan
    processing_time_s = time.perf_counter() - process_start

    modulation_duration_s = (
        (envelope_result.end_sample - envelope_result.start_sample + 1) * dt_s
    )
    pitch_estimate = None
    if modulation_duration_s > 0:
        pitch_estimate = (
            (test_track.outer_radius_mm - test_track.inner_radius_mm)
            * config.rotation_period_s
            / modulation_duration_s
        )

    segment_midpoint_samples = (
        snippet_geometry.start_indices + snippet_geometry.snippet_length_samples // 2
    )

    diagnostics = {
        "n_segments": int(n_segments),
        "n_valid_segments": int(np.count_nonzero(valid_mask)),
        "n_snippet_rejected_pre_fft": int(rejected_snippet_count),
        "n_fft_failures": int(fft_failure_count),
        "highpass_filter_length": int(highpass_filter_length),
        "large_lag_rejections": int(np.count_nonzero(large_lag_mask)),
        "timings_s": {
            "audio_load": float(t_audio_load),
            "envelope": float(t_envelope),
            "setup": float(t_setup),
            "segment_loop": float(processing_time_s),
            "segment_extract": float(t_extract),
            "segment_validity": float(t_validity),
            "segment_detrend_window": float(t_detrend),
            "segment_fft": float(t_fft),
            "segment_lr_metric": float(t_lr_metric),
            "segment_loop_overhead": float(processing_time_s - (t_extract + t_validity + t_detrend + t_fft + t_lr_metric)),
            "segment_loop_per_valid_ms": None if valid_snippet_count == 0 else float(processing_time_s / valid_snippet_count * 1000.0),
            "segment_fft_per_valid_ms": None if valid_snippet_count == 0 else float(t_fft / valid_snippet_count * 1000.0),
        },
    }

    return MeasurementResult(
        source_file=str(path),
        file_stem=file_stem,
        acquisition=acquisition,
        test_track=test_track,
        sample_rate_hz_original=audio.sample_rate_hz,
        sample_rate_hz_effective=float(effective_sample_rate_hz),
        decimation_factor=audio.decimation_factor,
        bits_per_sample=audio.bits_per_sample,
        dt_s=float(dt_s),
        skip_deg=float(config.skip_deg),
        periods_per_segment=int(config.periods_per_segment),
        spectral_half_width_bins=int(config.spectral_half_width_bins),
        cut_velocity_m_per_s=float(config.cut_velocity_m_per_s),
        angular_velocity_rad_per_s=float(config.angular_velocity_rad_per_s),
        outer_radius_mm=float(test_track.outer_radius_mm),
        inner_radius_mm=float(test_track.inner_radius_mm),
        pitch_estimate=None if pitch_estimate is None else float(pitch_estimate),
        envelope_level=float(envelope_result.level),
        envelope_start_sample=int(envelope_result.start_sample),
        envelope_end_sample=int(envelope_result.end_sample),
        modulation_duration_s=float(modulation_duration_s),
        samples_per_revolution=float(samples_per_revolution),
        samples_per_period=int(samples_per_period),
        snippet_length_samples=int(snippet_geometry.snippet_length_samples),
        padded_length_samples=int(snippet_geometry.padded_length_samples),
        skip_samples=int(snippet_geometry.skip_samples),
        segment_start_samples=np.asarray(snippet_geometry.start_indices, dtype=int),
        segment_midpoint_samples=np.asarray(segment_midpoint_samples, dtype=int),
        lag_s=lag_s,
        fundamental_freq_hz=fundamental_freq_hz,
        harmonic_amplitude=harmonic_amplitude,
        lr_diff_over_sum_rms_ratio=lr_diff_over_sum_rms_ratio,
        valid_mask=valid_mask,
        processing_time_s=float(processing_time_s),
        diagnostics=diagnostics,
        lag_difference_db=lag_difference_db,
        power_noise=power_noise,
        harmonic_lr_difference_ratio=harmonic_lr_difference_ratio,
        phase_delta_rad=phase_delta_rad,
    )


def _fft_convolve_same_multichannel(samples: np.ndarray, kernel: np.ndarray, block_size: int = 1 << 18) -> np.ndarray:
    return np.column_stack(
        [_fft_convolve_same_1d(samples[:, channel], kernel, block_size=block_size) for channel in range(samples.shape[1])]
    )


def _fft_convolve_same_1d(signal: np.ndarray, kernel: np.ndarray, block_size: int = 1 << 18) -> np.ndarray:
    signal = np.asarray(signal, dtype=float)
    kernel = np.asarray(kernel, dtype=float)
    n = signal.shape[0]
    m = kernel.shape[0]
    pad = m // 2
    padded = np.pad(signal, (pad, pad))
    full_len = padded.shape[0] + m - 1
    output = np.zeros(full_len, dtype=float)

    fft_size = 1
    while fft_size < block_size + m - 1:
        fft_size <<= 1
    chunk_len = fft_size - m + 1
    kernel_fft = np.fft.rfft(kernel, n=fft_size)

    for start in range(0, padded.shape[0], chunk_len):
        chunk = padded[start : start + chunk_len]
        chunk_fft = np.fft.rfft(chunk, n=fft_size)
        conv = np.fft.irfft(chunk_fft * kernel_fft, n=fft_size)
        out_end = min(start + fft_size, full_len)
        output[start:out_end] += conv[: out_end - start]

    return output[m - 1 : m - 1 + n]
