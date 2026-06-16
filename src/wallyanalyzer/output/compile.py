from __future__ import annotations

from dataclasses import asdict, is_dataclass
import json
from pathlib import Path

import numpy as np

from wallyanalyzer.schemas import SingleCompileResult


def save_compile_result(result: SingleCompileResult, output_dir: str | Path) -> dict[str, Path]:
    output_path = Path(output_dir) / result.measurement.file_stem
    output_path.mkdir(parents=True, exist_ok=True)

    metadata_path = output_path / "metadata.json"
    arrays_path = output_path / "arrays.npz"
    summary_path = output_path / "summary.json"
    traces_csv_path = output_path / "traces.csv"

    metadata = {
        "file_stem": result.measurement.file_stem,
        "measurement_source_file": result.measurement.source_file,
        "cartridge": _to_jsonable(result.cartridge),
        "system": _to_jsonable(result.system),
        "measurement_acquisition": _to_jsonable(result.measurement.acquisition),
        "diagnostics": _to_jsonable(result.diagnostics),
        "stylus_fit_params": _to_jsonable(result.stylus_fit_params),
        "stylus_fit_objective": result.stylus_fit_objective,
        "stylus_fit_success": result.stylus_fit_success,
        "distortion_fit_params": _to_jsonable(result.distortion_fit_params),
        "distortion_fit_objective": result.distortion_fit_objective,
        "distortion_fit_success": result.distortion_fit_success,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    np.savez_compressed(
        arrays_path,
        radius_all_mm=result.radius_all_mm,
        radius_valid_mm=result.radius_valid_mm,
        radius_smooth_mm=result.radius_smooth_mm,
        lag_clean_s=result.lag_clean_s,
        lag_smooth_s=result.lag_smooth_s,
        harmonic_valid=result.harmonic_valid,
        harmonic_smooth=result.harmonic_smooth,
        lr_diff_over_sum_rms_ratio_valid=result.lr_diff_over_sum_rms_ratio_valid,
        lr_diff_over_sum_rms_ratio_smooth=result.lr_diff_over_sum_rms_ratio_smooth,
        ate_measured_deg=result.ate_measured_deg,
        ate_fitted_deg=result.ate_fitted_deg,
        ate_raw_deg=result.ate_raw_deg,
        distortion_model=result.distortion_model,
        distortion_fit=result.distortion_fit,
    )

    summary_path.write_text(json.dumps(_to_jsonable(result.summary), indent=2), encoding="utf-8")
    _write_traces_csv(result, traces_csv_path)

    return {
        "output_dir": output_path,
        "metadata_json": metadata_path,
        "arrays_npz": arrays_path,
        "summary_json": summary_path,
        "traces_csv": traces_csv_path,
    }


def _write_traces_csv(result: SingleCompileResult, path: Path) -> None:
    header = (
        "radius_smooth_mm,lag_smooth_s,ate_measured_deg,ate_fitted_deg,"
        "distortion_model_pct,distortion_fit_pct,harm2_pct,harm3_pct,lr_diff_over_sum_rms_pct\n"
    )
    harm2_pct = 100.0 * result.harmonic_smooth[:, 1] / result.harmonic_smooth[:, 0]
    harm3_pct = 100.0 * result.harmonic_smooth[:, 2] / result.harmonic_smooth[:, 0]
    with path.open("w", encoding="utf-8") as handle:
        handle.write(header)
        for i in range(len(result.radius_smooth_mm)):
            row = [
                _fmt(result.radius_smooth_mm[i]),
                _fmt(result.lag_smooth_s[i]),
                _fmt(result.ate_measured_deg[i]),
                _fmt(result.ate_fitted_deg[i]),
                _fmt(100.0 * result.distortion_model[i]),
                _fmt(100.0 * result.distortion_fit[i]),
                _fmt(harm2_pct[i]),
                _fmt(harm3_pct[i]),
                _fmt(100.0 * result.lr_diff_over_sum_rms_ratio_smooth[i]),
            ]
            handle.write(",".join(row) + "\n")


def _fmt(value: float) -> str:
    if np.isnan(value):
        return "nan"
    return f"{float(value):.12g}"


def _to_jsonable(value):
    if value is None:
        return None
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
