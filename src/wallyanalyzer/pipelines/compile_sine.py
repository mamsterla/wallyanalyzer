from __future__ import annotations

import time

import numpy as np

from wallyanalyzer.fitting import (
    apparent_tracking_error_from_lag_deg,
    estimate_lr_from_nulls,
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
    if acquisition.lag_polarity not in (-1, 1):
        raise CompilePipelineError("Lag polarity must be either -1 or 1")
    # Signed Play Yaw follows recorded electrical L/R order. The 80 Hz preamble
    # remains durable channel-identity evidence, but does not normalize a swapped
    # recording into the same signed yaw direction.
    applied_lag_polarity = 1
    lag_polarity_source = "recorded_electrical_channel_order"
    lag_clean_s = lag_reject.cleaned.copy()
    valid_indices = np.flatnonzero(~np.isnan(lag_clean_s))
    if valid_indices.size < 3:
        raise CompilePipelineError(f"Measurement {measurement.file_stem!r} has too few valid lag points")

    tone_duration_s = (measurement.envelope_end_sample - measurement.envelope_start_sample) * measurement.dt_s
    if tone_duration_s <= 0.0:
        raise CompilePipelineError(f"Measurement {measurement.file_stem!r} has invalid tone boundaries")
    segment_time_s = measurement.segment_midpoint_samples.astype(float) * measurement.dt_s
    tone_elapsed_s = np.clip(
        segment_time_s - measurement.envelope_start_sample * measurement.dt_s,
        0.0,
        tone_duration_s,
    )
    carrier_derived_rpm = measurement.diagnostics.get("carrier_derived_rpm")
    radius_all_mm = (
        measurement.outer_radius_mm
        + (measurement.inner_radius_mm - measurement.outer_radius_mm) * tone_elapsed_s / tone_duration_s
    )
    radius_mapping_method = "tone_duration_linear_track"
    sample_angular_velocity_rad_per_s = (
        float(carrier_derived_rpm) * 2.0 * np.pi / 60.0
        if isinstance(carrier_derived_rpm, (int, float)) and carrier_derived_rpm > 0.0
        else float(measurement.angular_velocity_rad_per_s)
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
    lr_sanity_min_um = float(config.stylus_fit_lr_min_um)
    lr_sanity_max_um = float(config.stylus_fit_lr_max_um)
    if not np.isfinite(lr_sanity_min_um) or not np.isfinite(lr_sanity_max_um) or lr_sanity_min_um <= 0.0 or lr_sanity_min_um >= lr_sanity_max_um:
        raise CompilePipelineError("L/R fit bounds must be finite, positive, and ordered")
    overhang_fit_max_deviation_mm = float(config.overhang_fit_max_deviation_mm)
    if not np.isfinite(overhang_fit_max_deviation_mm) or overhang_fit_max_deviation_mm < 0.0:
        raise CompilePipelineError("Overhang fit deviation must be finite and non-negative")
    overhang_fit_min_mm = max(0.0, effective_overhang_mm - overhang_fit_max_deviation_mm)
    overhang_fit_max_mm = effective_overhang_mm + overhang_fit_max_deviation_mm
    effective_lr_um = float(np.clip(float(cartridge.lr_um), lr_sanity_min_um, lr_sanity_max_um))
    effective_stylus_yaw_deg = stylus_yaw_guess_deg
    fitted_overhang_mm = effective_overhang_mm
    for _ in range(2):
        fit_mask = np.isfinite(lag_fit_s)
        if np.count_nonzero(fit_mask) < 3:
            break
        lag_fit = fit_stylus_width_yaw_and_overhang_from_lag(
            radius_mm=radius_smooth_mm[fit_mask],
            lag_s=lag_fit_s[fit_mask],
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_guess_mm=fitted_overhang_mm,
            mount_yaw_deg=mount_yaw_deg,
            stylus_yaw_guess_deg=effective_stylus_yaw_deg,
            lr_guess_um=effective_lr_um,
            rotation_sign=rotation_sign,
            angular_velocity_rad_per_s=sample_angular_velocity_rad_per_s,
            max_iter=config.stylus_fit_max_iter,
            lr_min_um=lr_sanity_min_um,
            lr_max_um=lr_sanity_max_um,
            overhang_min_mm=overhang_fit_min_mm,
            overhang_max_mm=overhang_fit_max_mm,
        )
        lag_fit_lr_um = float(lag_fit.x[0])
        lag_fit_stylus_yaw_deg = float(lag_fit.x[1])
        lag_fit_overhang_mm = float(lag_fit.x[2])
        play_yaw_measured_deg = apparent_tracking_error_from_lag_deg(
            radius_smooth_mm[fit_mask],
            lag_fit_s[fit_mask],
            lag_fit_lr_um,
            sample_angular_velocity_rad_per_s,
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
        angular_velocity_rad_per_s=sample_angular_velocity_rad_per_s,
        max_iter=config.stylus_fit_max_iter,
        lr_min_um=lr_sanity_min_um,
        lr_max_um=lr_sanity_max_um,
        overhang_min_mm=overhang_fit_min_mm,
        overhang_max_mm=overhang_fit_max_mm,
    )
    candidate_lr_um = float(stylus_fit.x[0])
    candidate_stylus_yaw_deg = float(stylus_fit.x[1])
    candidate_overhang_mm = float(stylus_fit.x[2])
    stylus_fit_accepted = bool(stylus_fit.success and np.isfinite(candidate_lr_um) and np.isfinite(candidate_stylus_yaw_deg) and np.isfinite(candidate_overhang_mm) and candidate_overhang_mm >= 0.0)
    # The bounded optimizer remains diagnostic-only. Primary L/R uses fixed
    # physical geometry, local null regressions, and off-null spot estimates.
    try:
        null_lr = estimate_lr_from_nulls(
            radius_smooth_mm,
            lag_smooth_s,
            effective_length_mm,
            offset_angle_deg,
            effective_overhang_mm,
            sample_angular_velocity_rad_per_s,
            rotation_sign,
            alignment=acquisition.alignment,
        )
    except ValueError as error:
        null_lr = None
        null_lr_error = str(error)
    else:
        null_lr_error = None
    effective_lr_um = null_lr.lr_um if null_lr is not None else (candidate_lr_um if stylus_fit_accepted else float(np.clip(float(cartridge.lr_um), lr_sanity_min_um, lr_sanity_max_um)))
    effective_stylus_yaw_deg = (null_lr.total_yaw_deg - mount_yaw_deg) if null_lr is not None else (candidate_stylus_yaw_deg if stylus_fit_accepted else stylus_yaw_guess_deg)
    fitted_overhang_mm = effective_overhang_mm if null_lr is not None else (candidate_overhang_mm if stylus_fit_accepted else effective_overhang_mm)
    t_stylus_fit = time.perf_counter() - t2
    # Plot the complete smoothed measurement.  `lag_fit_s` is deliberately sparse
    # after robust rejection and is reserved for fit quality statistics.
    ate_measured_deg = apparent_tracking_error_from_lag_deg(radius_smooth_mm, lag_smooth_s, effective_lr_um, sample_angular_velocity_rad_per_s)
    ate_fit_input_deg = apparent_tracking_error_from_lag_deg(radius_smooth_mm, lag_fit_s, effective_lr_um, sample_angular_velocity_rad_per_s)
    ate_projection_full_deg = modeled_apparent_tracking_error_deg(
        radius_mm=radius_smooth_mm,
        effective_length_mm=effective_length_mm,
        offset_angle_deg=offset_angle_deg,
        overhang_mm=fitted_overhang_mm,
        stylus_yaw_deg=effective_stylus_yaw_deg,
        mount_yaw_deg=mount_yaw_deg,
        rotation_sign=rotation_sign,
    )
    if null_lr is not None:
        spot_lr_um = np.interp(radius_smooth_mm, null_lr.spot_radius_mm, null_lr.spot_lr_um, left=np.nan, right=np.nan)
        lower_lr_um, upper_lr_um = null_lr.interval_10_90_um
        residual_deg = ate_measured_deg - ate_projection_full_deg
        residual_median_deg = float(np.nanmedian(residual_deg))
        residual_mad_deg = float(np.nanmedian(np.abs(residual_deg - residual_median_deg)))
        residual_limit_deg = max(0.25, 3.0 * 1.4826 * residual_mad_deg)
        projection_mask = np.isfinite(spot_lr_um) & (spot_lr_um >= lower_lr_um) & (spot_lr_um <= upper_lr_um) & (np.abs(residual_deg - residual_median_deg) <= residual_limit_deg)
    else:
        spot_lr_um = np.full(radius_smooth_mm.shape, np.nan)
        residual_limit_deg = float("nan")
        projection_mask = np.isfinite(lag_fit_s)
    # Recreate the historical full-model path on only the locally coherent
    # 16-rotation-average points.  The null estimate supplies the initial L/R
    # and the section-quality mask; this bounded fit supplies the smooth model
    # curve and is iterated after residual rejection.
    section_model_fit = None
    section_model_iterations = 0
    if null_lr is not None and np.count_nonzero(projection_mask) >= 3:
        # The section-model search range must include the provenance-backed
        # null interval.  The narrower configured range remains a reported
        # sanity gate; it must not make the physical-model objective infinite
        # before comparison is possible.
        section_fit_lr_min_um = max(1.0, min(lr_sanity_min_um, null_lr.interval_10_90_um[0]))
        section_fit_lr_max_um = max(lr_sanity_max_um, null_lr.interval_10_90_um[1])
        for section_model_iterations in range(1, 3):
            section_model_fit = fit_stylus_width_yaw_and_overhang(
                radius_mm=radius_smooth_mm[projection_mask],
                lag_s=lag_smooth_s[projection_mask],
                effective_length_mm=effective_length_mm,
                offset_angle_deg=offset_angle_deg,
                overhang_guess_mm=fitted_overhang_mm,
                mount_yaw_deg=mount_yaw_deg,
                stylus_yaw_guess_deg=effective_stylus_yaw_deg,
                lr_guess_um=float(np.clip(effective_lr_um, section_fit_lr_min_um, section_fit_lr_max_um)),
                rotation_sign=rotation_sign,
                angular_velocity_rad_per_s=sample_angular_velocity_rad_per_s,
                max_iter=config.stylus_fit_max_iter,
                lr_min_um=section_fit_lr_min_um,
                lr_max_um=section_fit_lr_max_um,
                overhang_min_mm=overhang_fit_min_mm,
                overhang_max_mm=overhang_fit_max_mm,
            )
            fit_lr_um, fit_stylus_yaw_deg, fit_overhang_mm = map(float, section_model_fit.x)
            if not (section_model_fit.success and np.all(np.isfinite(section_model_fit.x))):
                break
            effective_lr_um = fit_lr_um
            effective_stylus_yaw_deg = fit_stylus_yaw_deg
            fitted_overhang_mm = fit_overhang_mm
            ate_measured_deg = apparent_tracking_error_from_lag_deg(radius_smooth_mm, lag_smooth_s, effective_lr_um, sample_angular_velocity_rad_per_s)
            ate_fit_input_deg = apparent_tracking_error_from_lag_deg(radius_smooth_mm, lag_fit_s, effective_lr_um, sample_angular_velocity_rad_per_s)
            ate_projection_full_deg = modeled_apparent_tracking_error_deg(
                radius_mm=radius_smooth_mm,
                effective_length_mm=effective_length_mm,
                offset_angle_deg=offset_angle_deg,
                overhang_mm=fitted_overhang_mm,
                stylus_yaw_deg=effective_stylus_yaw_deg,
                mount_yaw_deg=mount_yaw_deg,
                rotation_sign=rotation_sign,
            )
            residual_deg = ate_measured_deg - ate_projection_full_deg
            residual_median_deg = float(np.nanmedian(residual_deg))
            residual_mad_deg = float(np.nanmedian(np.abs(residual_deg - residual_median_deg)))
            residual_limit_deg = max(0.25, 3.0 * 1.4826 * residual_mad_deg)
            next_projection_mask = np.isfinite(spot_lr_um) & (spot_lr_um >= lower_lr_um) & (spot_lr_um <= upper_lr_um) & (np.abs(residual_deg - residual_median_deg) <= residual_limit_deg)
            if np.array_equal(next_projection_mask, projection_mask):
                break
            projection_mask = next_projection_mask

    lr_at_lower_bound = bool(np.isclose(effective_lr_um, lr_sanity_min_um, atol=0.01, rtol=0.0))
    lr_at_upper_bound = bool(np.isclose(effective_lr_um, lr_sanity_max_um, atol=0.01, rtol=0.0))
    lr_within_sanity_range = bool(lr_sanity_min_um <= effective_lr_um <= lr_sanity_max_um and not lr_at_lower_bound and not lr_at_upper_bound)
    lr_sanity_warning = None if lr_within_sanity_range else f"L/R timing fit reached the {('minimum' if lr_at_lower_bound else 'maximum')} {effective_lr_um:.3g} µm bound; review cartridge data and geometry."
    # Draw the physical model only across validated contiguous sections.  Blue
    # remains the full measured 16-rotation average for direct comparison.
    ate_fitted_deg = np.where(projection_mask, ate_projection_full_deg, np.nan)
    ate_raw_deg = apparent_tracking_error_from_lag_deg(radius_valid_mm, lag_valid_s, effective_lr_um, sample_angular_velocity_rad_per_s)
    stylus_fit_objective = float(rms(ate_fit_input_deg - ate_fitted_deg))
    valid_lag_s = lag_clean_s[np.isfinite(lag_clean_s)]
    lag_median_s = float(np.median(valid_lag_s)) if valid_lag_s.size else float("nan")
    lag_mean_s = float(np.mean(valid_lag_s)) if valid_lag_s.size else float("nan")
    lag_p05_s, lag_p95_s = (np.quantile(valid_lag_s, [0.05, 0.95]).astype(float) if valid_lag_s.size else (float("nan"), float("nan")))
    lag_leading_channel = "right" if lag_median_s > 0.0 else "left" if lag_median_s < 0.0 else "neither"

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

    displayed_yaw_deg = ate_fitted_deg[np.isfinite(ate_fitted_deg)]
    if displayed_yaw_deg.size == 0:
        displayed_yaw_deg = ate_measured_deg[np.isfinite(ate_measured_deg)]
    summary = SingleCompileSummary(
        file_stem=measurement.file_stem,
        effective_lr_um=effective_lr_um,
        effective_stylus_yaw_deg=effective_stylus_yaw_deg,
        effective_mount_yaw_deg=fitted_mount_yaw_deg,
        effective_overhang_mm=fitted_overhang_mm,
        apparent_tracking_error_peak_abs_deg=float(np.max(np.abs(displayed_yaw_deg))),
        apparent_tracking_error_peak_signed_deg=float(displayed_yaw_deg[np.argmax(np.abs(displayed_yaw_deg))]),
        apparent_tracking_error_range_deg=float(np.max(displayed_yaw_deg) - np.min(displayed_yaw_deg)),
        apparent_tracking_error_mean_deg=float(np.mean(displayed_yaw_deg)),
        apparent_tracking_fit_rms_deg=float(rms(ate_fit_input_deg - ate_fitted_deg)),
        distortion_second_harmonic_peak_pct=float(np.max(distortion_measured_ratio) * 100.0),
        distortion_second_harmonic_rms_pct=float(rms(distortion_measured_ratio) * 100.0),
    )

    diagnostics = {
        "lag_bad_indices": lag_reject.bad_indices,
        "smoothing_window": int(smoothing_window),
        "rotation_sign": float(rotation_sign),
        "lag_polarity": applied_lag_polarity,
        "lag_polarity_source": lag_polarity_source,
        "alignment": acquisition.alignment,
        "radius_mapping": {
            "method": radius_mapping_method,
            "outer_radius_mm": float(measurement.outer_radius_mm),
            "inner_radius_mm": float(measurement.inner_radius_mm),
            "tone_duration_s": float(tone_duration_s),
            "radial_rate_mm_per_s": float((measurement.inner_radius_mm - measurement.outer_radius_mm) / tone_duration_s),
            "carrier_derived_rpm": None if not isinstance(carrier_derived_rpm, (int, float)) else float(carrier_derived_rpm),
            "angular_velocity_rad_per_s": sample_angular_velocity_rad_per_s,
            "angular_velocity_source": "carrier_frequency" if isinstance(carrier_derived_rpm, (int, float)) and carrier_derived_rpm > 0.0 else "measurement_nominal",
            "radial_pitch_mm_per_revolution": measurement.pitch_estimate,
        },
        "projection": {
            "method": "null_selected_iterative_full_model",
            "displayed_trace": "accepted_section_full_physical_model",
            "retained_point_count": int(np.count_nonzero(projection_mask)),
            "retained_fraction": float(np.mean(projection_mask)),
            "residual_limit_deg": residual_limit_deg,
            "local_lr_um": spot_lr_um.tolist(),
        },
        "fit_rejected_indices": np.asarray(sorted(set(rejected_fit_indices)), dtype=int).tolist(),
        "fit_rejected_point_count": int(len(set(rejected_fit_indices))),
        "fit_retained_point_count": int(np.count_nonzero(np.isfinite(lag_fit_s))),
        "fit_rejected_effective_windows": float(len(set(rejected_fit_indices)) / max(1, smoothing_window)),
        "lag_fit_params": np.asarray(lag_fit.x, dtype=float).tolist(),
        "lag_fit_objective": float(lag_fit.fun),
        "lag_fit_iterations": int(lag_fit.nit),
        "lag_fit_converged": bool(lag_fit.success),
        "stylus_fit_candidate_lr_um": candidate_lr_um,
        "stylus_fit_candidate_stylus_yaw_deg": candidate_stylus_yaw_deg,
        "stylus_fit_geometry_locked": False,
        "stylus_fit_input_overhang_mm": effective_overhang_mm,
        "stylus_fit_overhang_bounds_mm": [overhang_fit_min_mm, overhang_fit_max_mm],
        "stylus_fit_effective_overhang_mm": fitted_overhang_mm,
        "stylus_fit_overhang_delta_mm": fitted_overhang_mm - effective_overhang_mm,
        "stylus_fit_accepted": stylus_fit_accepted,
        "lr_estimation": {
            "method": "accepted_section_full_model" if section_model_fit is not None and section_model_fit.success else ("null_anchored_weighted_spots" if null_lr is not None else "legacy_optimizer_fallback"),
            "alignment": None if null_lr is None else null_lr.alignment,
            "lr_um": effective_lr_um,
            "null_anchored_lr_um": None if null_lr is None else null_lr.lr_um,
            "interval_10_90_um": None if null_lr is None else list(null_lr.interval_10_90_um),
            "total_yaw_deg": None if null_lr is None else null_lr.total_yaw_deg,
            "channel_baseline_lag_ns": None if null_lr is None else null_lr.channel_baseline_lag_s * 1e9,
            "null_radii_mm": None if null_lr is None else list(null_lr.null_radii_mm),
            "null_mismatch_percent": None if null_lr is None else null_lr.null_mismatch_percent,
            "spot_count": None if null_lr is None else null_lr.spot_count,
            "fallback_reason": null_lr_error,
            "legacy_optimizer_lr_um": candidate_lr_um if stylus_fit_accepted else None,
            "accepted_section_model": None if section_model_fit is None else {
                "lr_um": float(section_model_fit.x[0]),
                "stylus_yaw_deg": float(section_model_fit.x[1]),
                "overhang_mm": float(section_model_fit.x[2]),
                "objective": float(section_model_fit.fun),
                "iterations": section_model_iterations,
                "converged": bool(section_model_fit.success),
            },
        },
        "stylus_fit_iterations": int(stylus_fit.nit),
        "stylus_fit_converged": bool(stylus_fit.success),
        "stylus_fit_fallback": None if stylus_fit_accepted else {"lr_um": effective_lr_um, "stylus_yaw_deg": effective_stylus_yaw_deg},
        "stylus_fit_mode": "bounded_timing_fit_with_floating_overhang", 
        "lr_sanity_min_um": lr_sanity_min_um,
        "lr_sanity_max_um": lr_sanity_max_um,
        "lr_within_sanity_range": lr_within_sanity_range,
        "lr_sanity_warning": lr_sanity_warning,
        "ate_fit_selected_start": "metadata",
        "play_yaw_sigma_deg": None if not np.isfinite(play_yaw_sigma_deg) else float(play_yaw_sigma_deg),
        "play_yaw_reject_sigma_multiplier": float(config.lag_fit_reject_sigma_multiplier),
        "play_yaw_reject_max_fraction": float(config.lag_fit_reject_max_fraction),
        "play_yaw_reject_threshold_deg": play_yaw_reject_threshold_deg,
        "play_yaw_noise_deg": None
        if not np.any(np.isfinite(ate_raw_deg)) or not np.any(np.isfinite(ate_measured_deg))
        else float(3.0 * np.nanstd(ate_raw_deg[(smoothing_window // 2): (ate_measured_deg.shape[0] + smoothing_window // 2)] - ate_measured_deg)),
        "stereo_lag_sign_convention": "positive lag means right channel leads left channel",
        "stereo_lag_leading_channel": lag_leading_channel,
        "stereo_lag_median_us": None if not np.isfinite(lag_median_s) else lag_median_s * 1_000_000.0,
        "stereo_lag_mean_us": None if not np.isfinite(lag_mean_s) else lag_mean_s * 1_000_000.0,
        "stereo_lag_p05_us": None if not np.isfinite(lag_p05_s) else float(lag_p05_s) * 1_000_000.0,
        "stereo_lag_p95_us": None if not np.isfinite(lag_p95_s) else float(lag_p95_s) * 1_000_000.0,
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
        ate_model_full_deg=ate_projection_full_deg,
        ate_raw_deg=ate_raw_deg,
        distortion_model=distortion_model_trace,
        distortion_fit=distortion_fit_trace,
        stylus_fit_params=np.asarray(section_model_fit.x if section_model_fit is not None and section_model_fit.success else stylus_fit.x, dtype=float),
        stylus_fit_objective=float(section_model_fit.fun if section_model_fit is not None and section_model_fit.success else stylus_fit.fun),
        stylus_fit_success=bool(section_model_fit.success if section_model_fit is not None else stylus_fit.success),
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
