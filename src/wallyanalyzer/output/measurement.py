from __future__ import annotations

from dataclasses import asdict, is_dataclass
import json
from pathlib import Path

import numpy as np

from wallyanalyzer.schemas import MeasurementResult


def save_measurement_result(result: MeasurementResult, output_dir: str | Path) -> dict[str, Path]:
    output_path = Path(output_dir) / result.file_stem
    output_path.mkdir(parents=True, exist_ok=True)

    metadata_path = output_path / "metadata.json"
    arrays_path = output_path / "arrays.npz"
    segments_csv_path = output_path / "segments.csv"
    summary_json_path = output_path / "summary.json"

    metadata = {
        "source_file": result.source_file,
        "file_stem": result.file_stem,
        "sample_rate_hz_original": result.sample_rate_hz_original,
        "sample_rate_hz_effective": result.sample_rate_hz_effective,
        "decimation_factor": result.decimation_factor,
        "bits_per_sample": result.bits_per_sample,
        "dt_s": result.dt_s,
        "skip_deg": result.skip_deg,
        "periods_per_segment": result.periods_per_segment,
        "spectral_half_width_bins": result.spectral_half_width_bins,
        "cut_velocity_m_per_s": result.cut_velocity_m_per_s,
        "angular_velocity_rad_per_s": result.angular_velocity_rad_per_s,
        "outer_radius_mm": result.outer_radius_mm,
        "inner_radius_mm": result.inner_radius_mm,
        "pitch_estimate": result.pitch_estimate,
        "envelope_level": result.envelope_level,
        "envelope_start_sample": result.envelope_start_sample,
        "envelope_end_sample": result.envelope_end_sample,
        "modulation_duration_s": result.modulation_duration_s,
        "samples_per_revolution": result.samples_per_revolution,
        "samples_per_period": result.samples_per_period,
        "snippet_length_samples": result.snippet_length_samples,
        "padded_length_samples": result.padded_length_samples,
        "skip_samples": result.skip_samples,
        "processing_time_s": result.processing_time_s,
        "diagnostics": result.diagnostics,
        "acquisition": _to_jsonable(result.acquisition),
        "test_track": _to_jsonable(result.test_track),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    np.savez_compressed(
        arrays_path,
        segment_start_samples=result.segment_start_samples,
        segment_midpoint_samples=result.segment_midpoint_samples,
        lag_s=result.lag_s,
        fundamental_freq_hz=result.fundamental_freq_hz,
        harmonic_amplitude=result.harmonic_amplitude,
        lr_diff_over_sum_rms_ratio=result.lr_diff_over_sum_rms_ratio,
        valid_mask=result.valid_mask,
    )

    summary = {
        "file_stem": result.file_stem,
        "segment_count": int(len(result.segment_start_samples)),
        "valid_segment_count": int(np.count_nonzero(result.valid_mask)),
        "invalid_segment_count": int(len(result.segment_start_samples) - np.count_nonzero(result.valid_mask)),
        "mean_frequency_left_hz": _safe_nanmean(result.fundamental_freq_hz[:, 0]),
        "mean_frequency_right_hz": _safe_nanmean(result.fundamental_freq_hz[:, 1]),
        "mean_abs_lag_us": _safe_nanmean(np.abs(result.lag_s) * 1e6),
        "mean_lr_diff_over_sum_rms_pct": _safe_nanmean(result.lr_diff_over_sum_rms_ratio * 100.0),
        "pitch_estimate": result.pitch_estimate,
        "processing_time_s": result.processing_time_s,
    }
    summary_json_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    _write_segments_csv(result, segments_csv_path)

    return {
        "output_dir": output_path,
        "metadata_json": metadata_path,
        "arrays_npz": arrays_path,
        "segments_csv": segments_csv_path,
        "summary_json": summary_json_path,
    }


def _write_segments_csv(result: MeasurementResult, path: Path) -> None:
    harmonic_ratio_2 = result.harmonic_amplitude[:, 1] / result.harmonic_amplitude[:, 0]
    harmonic_ratio_3 = result.harmonic_amplitude[:, 2] / result.harmonic_amplitude[:, 0]
    radius_mm = np.linspace(result.outer_radius_mm, result.inner_radius_mm, len(result.segment_start_samples))

    header = (
        "segment_index,segment_start_sample,segment_midpoint_sample,radius_mm,is_valid,"
        "lag_s,freq_left_hz,freq_right_hz,harm1,harm2,harm3,harm2_ratio,harm3_ratio,lr_diff_over_sum_rms_ratio\n"
    )
    with path.open("w", encoding="utf-8") as handle:
        handle.write(header)
        for i in range(len(result.segment_start_samples)):
            row = [
                i,
                int(result.segment_start_samples[i]),
                int(result.segment_midpoint_samples[i]),
                _fmt(radius_mm[i]),
                int(bool(result.valid_mask[i])),
                _fmt(result.lag_s[i]),
                _fmt(result.fundamental_freq_hz[i, 0]),
                _fmt(result.fundamental_freq_hz[i, 1]),
                _fmt(result.harmonic_amplitude[i, 0]),
                _fmt(result.harmonic_amplitude[i, 1]),
                _fmt(result.harmonic_amplitude[i, 2]),
                _fmt(harmonic_ratio_2[i]),
                _fmt(harmonic_ratio_3[i]),
                _fmt(result.lr_diff_over_sum_rms_ratio[i]),
            ]
            handle.write(",".join(map(str, row)) + "\n")


def _fmt(value: float) -> str:
    if np.isnan(value):
        return "nan"
    return f"{float(value):.12g}"


def _safe_nanmean(values: np.ndarray) -> float | None:
    valid = values[~np.isnan(values)]
    if valid.size == 0:
        return None
    return float(np.nanmean(values))


def _to_jsonable(value):
    if is_dataclass(value):
        return {k: _to_jsonable(v) for k, v in asdict(value).items()}
    if isinstance(value, dict):
        return {str(k): _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(v) for v in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    return value
