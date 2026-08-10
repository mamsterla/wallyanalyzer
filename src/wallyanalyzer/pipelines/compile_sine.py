from __future__ import annotations

import time

import numpy as np

from wallyanalyzer.fitting import (
    apparent_tracking_error_from_lag_deg,
    fit_stylus_width_yaw_and_overhang,
    fit_stylus_width_yaw_and_overhang_from_lag,
    modeled_apparent_tracking_error_deg,
    polyfit_with_rejection,
    sigma_reject_1d,
)
from wallyanalyzer.metadata import MetadataProvider
from wallyanalyzer.geometry import baerwald_tracking_error_deg
from wallyanalyzer.math_utils import rms
from wallyanalyzer.schemas import (
    CompileConfig,
    CompileResult,
    MeasurementResult,
    SingleCompileResult,
    SingleCompileSummary,
)


class CompilePipelineError(RuntimeError):
    pass


def compile_sine_results(
    measurements: list[MeasurementResult],
    metadata_provider: MetadataProvider,
    config: CompileConfig | None = None,
) -> CompileResult:
    config = config or CompileConfig()
    single_results = [compile_one_measurement(m, metadata_provider, config) for m in measurements]
    aggregate_summary = _compile_mount_yaw_sweep(single_results) if len(single_results) >= 2 else None
    return CompileResult(
        single_results=single_results,
        aggregate_summary=aggregate_summary,
    )


def compile_one_measurement(
    measurement: MeasurementResult,
    metadata_provider: MetadataProvider,
    config: CompileConfig | None = None,
) -> SingleCompileResult:
    config = config or CompileConfig()
    t0 = time.perf_counter()
    acquisition = measurement.acquisition
    if not acquisition.cartridge_name:
        raise CompilePipelineError(f"Measurement {measurement.file_stem!r} has no cartridge_name")
    if acquisition.system_id is None:
        raise CompilePipelineError(f"Measurement {measurement.file_stem!r} has no system_id")
    if acquisition.effective_length_mm is None or acquisition.offset_angle_deg is None or acquisition.overhang_mm is None:
        raise CompilePipelineError(f"Measurement {measurement.file_stem!r} is missing geometry fields")

    cartridge = metadata_provider.get_cartridge(acquisition.cartridge_name)
    system = metadata_provider.get_system(acquisition.system_id)
    if cartridge is None or cartridge.lr_um is None:
        raise CompilePipelineError(f"No cartridge LR metadata for {acquisition.cartridge_name!r}")

    mount_yaw_deg = 0.0 if acquisition.cantilever_yaw_deg is None else float(acquisition.cantilever_yaw_deg)
    stylus_yaw_guess_deg = 0.0 if acquisition.stylus_yaw_deg is None else float(acquisition.stylus_yaw_deg)
    effective_length_mm = float(acquisition.effective_length_mm)
    offset_angle_deg = float(acquisition.offset_angle_deg)
    nominal_overhang_mm = float(acquisition.overhang_mm)
    overhang_adjustment_mm = 0.0 if acquisition.overhang_adjustment_mm is None else float(acquisition.overhang_adjustment_mm)
    pivot_spindle_adjustment_mm = 0.0 if acquisition.pivot_spindle_adjustment_mm is None else float(acquisition.pivot_spindle_adjustment_mm)
    actual_pivot_to_spindle_mm = acquisition.actual_pivot_to_spindle_mm

    effective_overhang_mm = nominal_overhang_mm + overhang_adjustment_mm - pivot_spindle_adjustment_mm

    t_metadata = time.perf_counter() - t0

    t1 = time.perf_counter()
    lag_reject = sigma_reject_1d(measurement.lag_s, nsig=config.lag_outlier_sigma)
    lag_clean_s = lag_reject.cleaned.copy()
    valid_indices = np.flatnonzero(~np.isnan(lag_clean_s))
    if valid_indices.size < 3:
        raise CompilePipelineError(f"Measurement {measurement.file_stem!r} has too few valid lag points")

    radius_all_mm = np.linspace(
        measurement.outer_radius_mm,
        measurement.inner_radius_mm,
        measurement.lag_s.shape[0],
    )
    radius_valid_mm = radius_all_mm[valid_indices]
    lag_valid_s = lag_clean_s[valid_indices]
    harmonic_valid = measurement.harmonic_amplitude[valid_indices, :]
    lr_diff_over_sum_rms_ratio_valid = measurement.lr_diff_over_sum_rms_ratio[valid_indices]

    nrot = max(1, int(round(360.0 / measurement.skip_deg)))
    max_window_for_fit = max(1, valid_indices.size - 2)
    smoothing_window = max(1, min(max_window_for_fit, nrot * config.smoothing_rotations))

    radius_smooth_mm = _moving_average_valid(radius_valid_mm, smoothing_window)
    lag_smooth_s = _moving_average_valid(lag_valid_s, smoothing_window)
    harmonic_smooth = np.column_stack(
        [_moving_average_valid(harmonic_valid[:, col], smoothing_window) for col in range(harmonic_valid.shape[1])]
    )
    lr_diff_over_sum_rms_ratio_smooth = _moving_average_valid(lr_diff_over_sum_rms_ratio_valid, smoothing_window)

    rotation_sign = -1.0 if radius_smooth_mm[0] < radius_smooth_mm[-1] else 1.0
    t_preprocess = time.perf_counter() - t1

    t2 = time.perf_counter()
    lag_fit_s = lag_smooth_s.copy()
    fit_mask = np.ones(radius_smooth_mm.shape[0], dtype=bool)
    rejected_fit_indices: list[int] = []
    lag_fit = None
    play_yaw_sigma_deg = float("nan")
    play_yaw_reject_threshold_deg = None
    for _ in range(2):
        fit_mask = np.isfinite(lag_fit_s)
        if np.count_nonzero(fit_mask) < 3:
            break
        lag_fit = fit_stylus_width_yaw_and_overhang_from_lag(
            radius_mm=radius_smooth_mm[fit_mask],
            lag_s=lag_fit_s[fit_mask],
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_guess_mm=effective_overhang_mm,
            mount_yaw_deg=mount_yaw_deg,
            stylus_yaw_guess_deg=stylus_yaw_guess_deg,
            lr_guess_um=float(cartridge.lr_um),
            rotation_sign=rotation_sign,
            max_iter=config.stylus_fit_max_iter,
        )
        lag_fit_lr_um = float(lag_fit.x[0])
        lag_fit_stylus_yaw_deg = float(lag_fit.x[1])
        lag_fit_overhang_mm = float(lag_fit.x[2])
        play_yaw_measured_deg = apparent_tracking_error_from_lag_deg(
            radius_smooth_mm[fit_mask],
            lag_fit_s[fit_mask],
            lag_fit_lr_um,
        )
        play_yaw_fitted_deg = modeled_apparent_tracking_error_deg(
            radius_mm=radius_smooth_mm[fit_mask],
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_mm=lag_fit_overhang_mm,
            stylus_yaw_deg=lag_fit_stylus_yaw_deg,
            mount_yaw_deg=mount_yaw_deg,
            rotation_sign=rotation_sign,
        )
        play_yaw_residual_deg = play_yaw_measured_deg - play_yaw_fitted_deg
        play_yaw_sigma_deg = float(np.nanstd(play_yaw_residual_deg))
        if not np.isfinite(play_yaw_sigma_deg) or play_yaw_sigma_deg <= 0.0:
            break
        play_yaw_reject_threshold_deg = float(play_yaw_sigma_deg * config.lag_fit_reject_sigma_multiplier)
        local_bad = np.flatnonzero(np.abs(play_yaw_residual_deg) > play_yaw_reject_threshold_deg)
        if local_bad.size == 0:
            break
        max_reject_count = max(1, int(np.floor(config.lag_fit_reject_max_fraction * np.count_nonzero(fit_mask))))
        if local_bad.size > max_reject_count:
            ranked = np.argsort(np.abs(play_yaw_residual_deg[local_bad]))[::-1]
            local_bad = local_bad[ranked[:max_reject_count]]
        if local_bad.size >= np.count_nonzero(fit_mask) - 2:
            break
        global_bad = np.flatnonzero(fit_mask)[local_bad]
        rejected_fit_indices.extend(global_bad.tolist())
        lag_fit_s[global_bad] = np.nan
    fit_mask = np.isfinite(lag_fit_s)
    if np.count_nonzero(fit_mask) < 3:
        raise CompilePipelineError(f"Measurement {measurement.file_stem!r} fit failed after lag-domain rejection")
    stylus_fit = fit_stylus_width_yaw_and_overhang(
        radius_mm=radius_smooth_mm[fit_mask],
        lag_s=lag_fit_s[fit_mask],
        effective_length_mm=effective_length_mm,
        offset_angle_deg=offset_angle_deg,
        overhang_guess_mm=float(lag_fit.x[2]),
        mount_yaw_deg=mount_yaw_deg,
        stylus_yaw_guess_deg=float(lag_fit.x[1]),
        lr_guess_um=float(lag_fit.x[0]),
        rotation_sign=rotation_sign,
        max_iter=config.stylus_fit_max_iter,
    )
    effective_lr_um = float(stylus_fit.x[0])
    effective_stylus_yaw_deg = float(stylus_fit.x[1])
    fitted_overhang_mm = float(stylus_fit.x[2])
    t_stylus_fit = time.perf_counter() - t2
    ate_measured_deg = apparent_tracking_error_from_lag_deg(radius_smooth_mm, lag_fit_s, effective_lr_um)
    ate_fitted_deg = modeled_apparent_tracking_error_deg(
        radius_mm=radius_smooth_mm,
        effective_length_mm=effective_length_mm,
        offset_angle_deg=offset_angle_deg,
        overhang_mm=fitted_overhang_mm,
        stylus_yaw_deg=effective_stylus_yaw_deg,
        mount_yaw_deg=mount_yaw_deg,
        rotation_sign=rotation_sign,
    )
    ate_raw_deg = apparent_tracking_error_from_lag_deg(radius_valid_mm, lag_valid_s, effective_lr_um)

    distortion_measured_ratio = harmonic_smooth[:, 1] / harmonic_smooth[:, 0]
    baerwald_distortion_deg = baerwald_tracking_error_deg(
        radius_smooth_mm,
        effective_length_mm=effective_length_mm,
        offset_angle_deg=offset_angle_deg,
        overhang_mm=fitted_overhang_mm,
        lathe_offset_mm=0.0,
    )
    distortion_model_trace = (
        measurement.cut_velocity_m_per_s
        * np.tan(np.radians(baerwald_distortion_deg))
        / radius_smooth_mm
        * 1000.0
        / measurement.angular_velocity_rad_per_s
    )

    t3 = time.perf_counter()
    fitted_mount_yaw_deg = float(mount_yaw_deg)
    distortion_fit_objective = float(np.sum((np.abs(distortion_model_trace) - np.abs(distortion_measured_ratio)) ** 2))
    t_distortion_fit = time.perf_counter() - t3
    distortion_fit_trace = distortion_model_trace.copy()

    summary = SingleCompileSummary(
        file_stem=measurement.file_stem,
        effective_lr_um=effective_lr_um,
        effective_stylus_yaw_deg=effective_stylus_yaw_deg,
        effective_mount_yaw_deg=fitted_mount_yaw_deg,
        effective_overhang_mm=fitted_overhang_mm,
        apparent_tracking_error_peak_abs_deg=float(np.max(np.abs(ate_fitted_deg))),
        apparent_tracking_error_peak_signed_deg=float(ate_fitted_deg[np.argmax(np.abs(ate_fitted_deg))]),
        apparent_tracking_error_range_deg=float(np.max(ate_fitted_deg) - np.min(ate_fitted_deg)),
        apparent_tracking_error_mean_deg=float(np.mean(ate_fitted_deg)),
        apparent_tracking_fit_rms_deg=float(rms(ate_measured_deg - ate_fitted_deg)),
        distortion_second_harmonic_peak_pct=float(np.max(distortion_measured_ratio) * 100.0),
        distortion_second_harmonic_rms_pct=float(rms(distortion_measured_ratio) * 100.0),
    )

    diagnostics = {
        "lag_bad_indices": lag_reject.bad_indices,
        "smoothing_window": int(smoothing_window),
        "rotation_sign": float(rotation_sign),
        "fit_rejected_indices": np.asarray(sorted(set(rejected_fit_indices)), dtype=int).tolist(),
        "fit_rejected_point_count": int(len(set(rejected_fit_indices))),
        "fit_retained_point_count": int(np.count_nonzero(np.isfinite(lag_fit_s))),
        "fit_rejected_effective_windows": float(len(set(rejected_fit_indices)) / max(1, smoothing_window)),
        "lag_fit_params": np.asarray(lag_fit.x, dtype=float).tolist(),
        "lag_fit_objective": float(lag_fit.fun),
        "ate_fit_selected_start": "metadata",
        "play_yaw_sigma_deg": None if not np.isfinite(play_yaw_sigma_deg) else float(play_yaw_sigma_deg),
        "play_yaw_reject_sigma_multiplier": float(config.lag_fit_reject_sigma_multiplier),
        "play_yaw_reject_max_fraction": float(config.lag_fit_reject_max_fraction),
        "play_yaw_reject_threshold_deg": play_yaw_reject_threshold_deg,
        "play_yaw_noise_deg": None
        if not np.any(np.isfinite(ate_raw_deg)) or not np.any(np.isfinite(ate_measured_deg))
        else float(3.0 * np.nanstd(ate_raw_deg[(smoothing_window // 2): (ate_measured_deg.shape[0] + smoothing_window // 2)] - ate_measured_deg)),
        "pivot_spindle_consistency_error_mm": None
        if actual_pivot_to_spindle_mm is None
        else float(abs(effective_length_mm - fitted_overhang_mm - float(actual_pivot_to_spindle_mm))),
        "timings_s": {
            "metadata_join": float(t_metadata),
            "preprocess": float(t_preprocess),
            "stylus_fit": float(t_stylus_fit),
            "distortion_fit": float(t_distortion_fit),
            "total": float(t_metadata + t_preprocess + t_stylus_fit + t_distortion_fit),
        },
        "source_algorithm": "WallySine02-inspired single-file fit",
    }

    return SingleCompileResult(
        measurement=measurement,
        cartridge=cartridge,
        system=system,
        radius_all_mm=radius_all_mm,
        radius_valid_mm=radius_valid_mm,
        radius_smooth_mm=radius_smooth_mm,
        lag_clean_s=lag_clean_s,
        lag_smooth_s=lag_smooth_s,
        harmonic_valid=harmonic_valid,
        harmonic_smooth=harmonic_smooth,
        lr_diff_over_sum_rms_ratio_valid=lr_diff_over_sum_rms_ratio_valid,
        lr_diff_over_sum_rms_ratio_smooth=lr_diff_over_sum_rms_ratio_smooth,
        ate_measured_deg=ate_measured_deg,
        ate_fitted_deg=ate_fitted_deg,
        ate_raw_deg=ate_raw_deg,
        distortion_model=distortion_model_trace,
        distortion_fit=distortion_fit_trace,
        stylus_fit_params=np.asarray(stylus_fit.x, dtype=float),
        stylus_fit_objective=float(stylus_fit.fun),
        stylus_fit_success=bool(stylus_fit.success),
        distortion_fit_params=np.asarray([fitted_mount_yaw_deg, fitted_overhang_mm], dtype=float),
        distortion_fit_objective=distortion_fit_objective,
        distortion_fit_success=True,
        diagnostics=diagnostics,
        summary=summary,
    )


def _moving_average_valid(values: np.ndarray, window: int) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    if window <= 1:
        return array.copy()
    kernel = np.ones(window, dtype=float) / window
    return np.convolve(array, kernel, mode="valid")


def _compile_mount_yaw_sweep(single_results: list[SingleCompileResult]) -> dict:
    records = []
    for result in single_results:
        cy = result.measurement.acquisition.cantilever_yaw_deg
        if cy is None:
            continue
        records.append(
            {
                "file_stem": result.measurement.file_stem,
                "mount_yaw_deg": float(cy),
                "ate_peak_abs_deg": float(result.summary.apparent_tracking_error_peak_abs_deg),
                "ate_peak_signed_deg": float(result.summary.apparent_tracking_error_peak_signed_deg),
                "d2_peak_pct": float(result.summary.distortion_second_harmonic_peak_pct),
                "d2_rms_pct": float(result.summary.distortion_second_harmonic_rms_pct),
                "effective_lr_um": float(result.summary.effective_lr_um),
            }
        )
    if len(records) < 2:
        return {"records": records}

    records.sort(key=lambda r: r["mount_yaw_deg"])
    cy = np.array([r["mount_yaw_deg"] for r in records], dtype=float)
    atepk = np.array([r["ate_peak_abs_deg"] for r in records], dtype=float)
    atepos = np.array([r["ate_peak_signed_deg"] for r in records], dtype=float)
    d2pk = np.array([r["d2_peak_pct"] for r in records], dtype=float)

    aggregate: dict[str, object] = {"records": records}

    if len(records) >= 3:
        d2_quad = polyfit_with_rejection(cy, d2pk, degree=2, nsig=3.0)
        coef = d2_quad.coefficients
        aggregate["d2_peak_quadratic"] = {
            "coefficients": coef.tolist(),
            "sigma": float(d2_quad.sigma),
            "good_indices": d2_quad.good_indices.tolist(),
            "bad_indices": d2_quad.bad_indices.tolist(),
        }
        if coef[0] != 0:
            cyd2_min = float(-coef[1] / (2.0 * coef[0]))
            aggregate["d2_peak_quadratic"]["minimum_mount_yaw_deg"] = cyd2_min
            aggregate["d2_peak_quadratic"]["minimum_d2_peak_pct"] = float(np.polyval(coef, cyd2_min))
        good_idx = d2_quad.good_indices
    else:
        good_idx = np.arange(len(records))

    ipos = np.flatnonzero(np.isclose(atepos, atepk))
    ineg = np.flatnonzero(~np.isclose(atepos, atepk))
    aggregate["ate_peak_branches"] = {}
    for label, idxs in [("positive_branch", ipos), ("negative_branch", ineg)]:
        filtered = np.array([i for i in idxs if i in set(good_idx.tolist())], dtype=int)
        if filtered.size >= 2:
            fit = polyfit_with_rejection(cy[filtered], atepk[filtered], degree=1, nsig=3.0)
            aggregate["ate_peak_branches"][label] = {
                "coefficients": fit.coefficients.tolist(),
                "sigma": float(fit.sigma),
                "good_indices": filtered[fit.good_indices].tolist(),
                "bad_indices": filtered[fit.bad_indices].tolist(),
            }
        elif filtered.size == 1:
            slope = 1.0 if label == "positive_branch" else -1.0
            intercept = float(atepk[filtered[0]] - slope * cy[filtered[0]])
            aggregate["ate_peak_branches"][label] = {
                "coefficients": [slope, intercept],
                "sigma": 0.0,
                "good_indices": filtered.tolist(),
                "bad_indices": [],
            }

    pos_fit = aggregate["ate_peak_branches"].get("positive_branch")
    neg_fit = aggregate["ate_peak_branches"].get("negative_branch")
    if pos_fit and neg_fit:
        pos_coef = np.array(pos_fit["coefficients"], dtype=float)
        neg_coef = np.array(neg_fit["coefficients"], dtype=float)
        denom = -pos_coef[0] + neg_coef[0]
        if denom != 0:
            cross = float((pos_coef[1] - neg_coef[1]) / denom)
            aggregate["ate_peak_branches"]["crossing"] = {
                "mount_yaw_deg": cross,
                "ate_peak_deg": float(np.polyval(pos_coef, cross)),
            }

    if len(records) >= 4:
        order = np.argsort(d2pk)
        left_idx = int(min(order[0], order[1]))
        right_idx = int(max(order[0], order[1]))
        ilow = np.arange(0, left_idx + 1, dtype=int)
        ihigh = np.arange(right_idx, len(records), dtype=int)
        aggregate["d2_peak_linear_branches"] = {}
        for label, idxs, slope_hint in [("low_branch", ilow, -1.0), ("high_branch", ihigh, 1.0)]:
            filtered = np.array([i for i in idxs if i in set(good_idx.tolist())], dtype=int)
            if filtered.size >= 2:
                fit = polyfit_with_rejection(cy[filtered], d2pk[filtered], degree=1, nsig=3.0)
                aggregate["d2_peak_linear_branches"][label] = {
                    "coefficients": fit.coefficients.tolist(),
                    "sigma": float(fit.sigma),
                    "good_indices": filtered[fit.good_indices].tolist(),
                    "bad_indices": filtered[fit.bad_indices].tolist(),
                }
            elif filtered.size == 1:
                intercept = float(d2pk[filtered[0]] - slope_hint * cy[filtered[0]])
                aggregate["d2_peak_linear_branches"][label] = {
                    "coefficients": [slope_hint, intercept],
                    "sigma": 0.0,
                    "good_indices": filtered.tolist(),
                    "bad_indices": [],
                }
        low_fit = aggregate["d2_peak_linear_branches"].get("low_branch")
        high_fit = aggregate["d2_peak_linear_branches"].get("high_branch")
        if low_fit and high_fit:
            low_coef = np.array(low_fit["coefficients"], dtype=float)
            high_coef = np.array(high_fit["coefficients"], dtype=float)
            denom = -high_coef[0] + low_coef[0]
            if denom != 0:
                cross = float((high_coef[1] - low_coef[1]) / denom)
                aggregate["d2_peak_linear_branches"]["crossing"] = {
                    "mount_yaw_deg": cross,
                    "d2_peak_pct": float(np.polyval(high_coef, cross)),
                }

    return aggregate
