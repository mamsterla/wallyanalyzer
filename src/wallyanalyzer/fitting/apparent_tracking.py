from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from wallyanalyzer.geometry import baerwald_tracking_error_deg
from wallyanalyzer.math_utils import rms
from wallyanalyzer.optimization import OptimizeResult, nelder_mead


@dataclass(frozen=True)
class LocalLagEstimate:
    radius_mm: float
    lag_s: float
    lag_standard_error_s: float
    residual_standard_deviation_s: float
    slope_s_per_mm: float
    point_count: int
    bandwidth_mm: float


def estimate_local_lag_at_radius(
    radius_mm: np.ndarray,
    lag_s: np.ndarray,
    target_radius_mm: float,
    bandwidth_mm: float = 2.0,
) -> LocalLagEstimate:
    """Estimate lag at one radius with locally weighted quadratic regression."""
    if not np.isfinite(target_radius_mm) or not np.isfinite(bandwidth_mm) or bandwidth_mm <= 0.0:
        raise ValueError("Target radius and bandwidth must be finite; bandwidth must be positive")
    offset_mm = np.asarray(radius_mm, dtype=float) - target_radius_mm
    values_s = np.asarray(lag_s, dtype=float)
    mask = np.isfinite(offset_mm) & np.isfinite(values_s) & (np.abs(offset_mm) <= bandwidth_mm)
    if np.count_nonzero(mask) < 4:
        raise ValueError("At least four finite lag points are required for local regression")
    x = offset_mm[mask]
    y = values_s[mask]
    scaled_distance = np.abs(x) / bandwidth_mm
    weights = (1.0 - scaled_distance**3) ** 3
    design = np.column_stack((np.ones_like(x), x, x**2))
    weighted_design = design * np.sqrt(weights)[:, None]
    weighted_values = y * np.sqrt(weights)
    coefficients, _, _, _ = np.linalg.lstsq(weighted_design, weighted_values, rcond=None)
    residuals = y - design @ coefficients
    degrees_of_freedom = max(1, x.size - design.shape[1])
    weighted_residual_variance = float(np.sum(weights * residuals**2) / degrees_of_freedom)
    covariance = weighted_residual_variance * np.linalg.pinv(weighted_design.T @ weighted_design)
    return LocalLagEstimate(
        radius_mm=float(target_radius_mm),
        lag_s=float(coefficients[0]),
        lag_standard_error_s=float(np.sqrt(max(0.0, covariance[0, 0]))),
        residual_standard_deviation_s=float(np.sqrt(weighted_residual_variance)),
        slope_s_per_mm=float(coefficients[1]),
        point_count=int(x.size),
        bandwidth_mm=float(bandwidth_mm),
    )


@dataclass(frozen=True)
class NullAnchoredLrEstimate:
    lr_um: float
    alignment: str
    total_yaw_deg: float
    channel_baseline_lag_s: float
    null_mismatch_percent: float
    null_radii_mm: tuple[float, float]
    interval_10_90_um: tuple[float, float]
    spot_count: int
    spot_radius_mm: np.ndarray
    spot_lr_um: np.ndarray
    spot_weight: np.ndarray


def _weighted_quantile(values: np.ndarray, weights: np.ndarray, quantile: float) -> float:
    order = np.argsort(values)
    cumulative = np.cumsum(weights[order])
    return float(values[order][np.searchsorted(cumulative, quantile * cumulative[-1])])


ALIGNMENT_NULL_RADII_MM: dict[str, tuple[float, float]] = {
    "baerwald": (66.0, 120.9),
    "lofgren": (70.3, 116.6),
    "stevenson": (60.3, 117.4),
}


def _linear_reference_radii(radius_mm: np.ndarray, lag_s: np.ndarray, bandwidth_mm: float) -> tuple[float, float]:
    """Choose the cleanest pair equidistant from track center for linear arms."""
    lower, upper = float(np.nanmin(radius_mm)), float(np.nanmax(radius_mm))
    center = (lower + upper) / 2.0
    half_span = (upper - lower) / 2.0
    candidates: list[tuple[float, float, float]] = []
    for offset in np.linspace(half_span * 0.15, half_span * 0.75, 49):
        inner, outer = center - offset, center + offset
        try:
            first = estimate_local_lag_at_radius(radius_mm, lag_s, inner, bandwidth_mm)
            second = estimate_local_lag_at_radius(radius_mm, lag_s, outer, bandwidth_mm)
        except ValueError:
            continue
        candidates.append((first.residual_standard_deviation_s + second.residual_standard_deviation_s, inner, outer))
    if not candidates:
        raise ValueError("Linear alignment could not find two clean symmetric reference points")
    _, inner, outer = min(candidates, key=lambda item: item[0])
    return float(inner), float(outer)


def _alignment_reference_radii(
    alignment: str,
    radius_mm: np.ndarray,
    lag_s: np.ndarray,
    bandwidth_mm: float,
    effective_length_mm: float,
    offset_angle_deg: float,
    overhang_mm: float,
) -> tuple[float, float]:
    key = alignment.lower()
    if key == "linear":
        return _linear_reference_radii(radius_mm, lag_s, bandwidth_mm)
    if key in ALIGNMENT_NULL_RADII_MM:
        nulls = ALIGNMENT_NULL_RADII_MM[key]
        lower, upper = float(np.nanmin(radius_mm)), float(np.nanmax(radius_mm))
        # Snippet edge trimming can remove a few millimetres at either end.
        # Keep the selected alignment while using the nearest clean available
        # sample when its nominal null falls outside the retained measurement.
        return tuple(float(np.clip(null, lower, upper)) for null in nulls)
    if key == "physical":
        lower, upper = float(np.nanmin(radius_mm)), float(np.nanmax(radius_mm))
        grid = np.linspace(lower, upper, 20_001)
        geometry = baerwald_tracking_error_deg(grid, effective_length_mm, offset_angle_deg, overhang_mm)
        crossings = np.flatnonzero(np.signbit(geometry[:-1]) != np.signbit(geometry[1:]))
        if crossings.size != 2:
            raise ValueError("Physical geometry must produce exactly two nulls within the measured track")
        return tuple(float(grid[i] - geometry[i] * (grid[i + 1] - grid[i]) / (geometry[i + 1] - geometry[i])) for i in crossings)
    raise ValueError("Alignment must be linear, lofgren, baerwald, stevenson, or physical")


def estimate_lr_from_nulls(
    radius_mm: np.ndarray,
    lag_s: np.ndarray,
    effective_length_mm: float,
    offset_angle_deg: float,
    overhang_mm: float,
    angular_velocity_rad_per_s: float,
    rotation_sign: float,
    alignment: str = "baerwald",
    bandwidth_mm: float = 2.0,
    spot_step_mm: float = 0.5,
    minimum_geometry_deg: float = 0.25,
) -> NullAnchoredLrEstimate:
    """Estimate signed yaw and L/R from local null fits plus off-null spot values."""
    radii = np.asarray(radius_mm, dtype=float)
    values = np.asarray(lag_s, dtype=float)
    lower, upper = float(np.nanmin(radii)), float(np.nanmax(radii))
    nulls = _alignment_reference_radii(
        alignment, radii, values, bandwidth_mm, effective_length_mm, offset_angle_deg, overhang_mm
    )
    first, second = (estimate_local_lag_at_radius(radii, values, target, bandwidth_mm) for target in nulls)
    null_product = (first.lag_s - second.lag_s) / (1.0 / nulls[0] - 1.0 / nulls[1])
    baseline = first.lag_s - null_product / nulls[0]
    normalized_first = nulls[0] * first.lag_s
    normalized_second = nulls[1] * second.lag_s
    mismatch = 100.0 * (normalized_first - normalized_second) / ((normalized_first + normalized_second) / 2.0)
    spot_radii: list[float] = []
    candidates: list[float] = []
    weights: list[float] = []
    for target in np.arange(lower + bandwidth_mm, upper - bandwidth_mm + spot_step_mm / 2.0, spot_step_mm):
        geometric_yaw_rad = np.radians(rotation_sign * baerwald_tracking_error_deg(np.array([target]), effective_length_mm, offset_angle_deg, overhang_mm)[0])
        if abs(np.degrees(geometric_yaw_rad)) < minimum_geometry_deg:
            continue
        local = estimate_local_lag_at_radius(radii, values, float(target), bandwidth_mm)
        sine_geometry = np.sin(geometric_yaw_rad)
        quadrature = (target * (local.lag_s - baseline) - null_product * np.cos(geometric_yaw_rad)) / sine_geometry
        contact_scale = float(np.hypot(null_product, quadrature))
        candidate = 1000.0 * angular_velocity_rad_per_s * contact_scale
        if np.isfinite(candidate) and candidate > 0.0:
            spot_radii.append(float(target))
            candidates.append(candidate)
            weights.append(sine_geometry**2 / max(local.residual_standard_deviation_s**2, 1e-24))
    if len(candidates) < 3:
        raise ValueError("Insufficient off-null spots for L/R estimation")
    candidate_array, weight_array = np.asarray(candidates), np.asarray(weights)
    lr_um = _weighted_quantile(candidate_array, weight_array, 0.5)
    total_yaw_deg = float(np.degrees(np.arcsin(np.clip(null_product / (lr_um / (1000.0 * angular_velocity_rad_per_s)), -1.0, 1.0))))
    return NullAnchoredLrEstimate(
        lr_um, alignment.lower(), total_yaw_deg, float(baseline), float(mismatch), nulls,
        (_weighted_quantile(candidate_array, weight_array, .1), _weighted_quantile(candidate_array, weight_array, .9)),
        len(candidates), np.asarray(spot_radii), candidate_array, weight_array,
    )


def apparent_tracking_error_from_lag_deg(
    radius_mm: np.ndarray,
    lag_s: np.ndarray,
    lr_um: float,
    angular_velocity_rad_per_s: float = 10.0 * np.pi / 9.0,
) -> np.ndarray:
    argument = 1000.0 * angular_velocity_rad_per_s * radius_mm * lag_s / lr_um
    argument = np.clip(argument, -1.0, 1.0)
    return np.degrees(np.arcsin(argument))


def lag_from_apparent_tracking_error_s(
    radius_mm: np.ndarray,
    apparent_tracking_error_deg: np.ndarray,
    lr_um: float,
    angular_velocity_rad_per_s: float = 10.0 * np.pi / 9.0,
) -> np.ndarray:
    return lr_um * np.sin(np.radians(apparent_tracking_error_deg)) / (1000.0 * angular_velocity_rad_per_s * radius_mm)


def modeled_apparent_tracking_error_deg(
    radius_mm: np.ndarray,
    effective_length_mm: float,
    offset_angle_deg: float,
    overhang_mm: float,
    stylus_yaw_deg: float,
    mount_yaw_deg: float,
    rotation_sign: float,
) -> np.ndarray:
    return (
        rotation_sign
        * baerwald_tracking_error_deg(
            radius_mm,
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_mm=overhang_mm,
            lathe_offset_mm=0.0,
        )
        + stylus_yaw_deg
        + mount_yaw_deg
    )


def fit_stylus_width_and_yaw(
    radius_mm: np.ndarray,
    lag_s: np.ndarray,
    effective_length_mm: float,
    offset_angle_deg: float,
    overhang_mm: float,
    mount_yaw_deg: float,
    stylus_yaw_guess_deg: float,
    lr_guess_um: float,
    rotation_sign: float,
    angular_velocity_rad_per_s: float = 10.0 * np.pi / 9.0,
    max_iter: int = 300,
    lr_min_um: float = 10.0,
    lr_max_um: float = 35.0,
) -> OptimizeResult:
    if not np.isfinite(lr_min_um) or not np.isfinite(lr_max_um) or lr_min_um <= 0.0 or lr_min_um >= lr_max_um:
        raise ValueError("L/R fit bounds must be finite, positive, and ordered")

    def objective(params: np.ndarray) -> float:
        lr_um, stylus_yaw_deg = params
        if lr_um < lr_min_um or lr_um > lr_max_um: 
            return float("inf")
        measured = apparent_tracking_error_from_lag_deg(radius_mm, lag_s, lr_um, angular_velocity_rad_per_s)
        modeled = modeled_apparent_tracking_error_deg(
            radius_mm=radius_mm,
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_mm=overhang_mm,
            stylus_yaw_deg=stylus_yaw_deg,
            mount_yaw_deg=mount_yaw_deg,
            rotation_sign=rotation_sign,
        )
        return float(rms(measured - modeled))

    return nelder_mead(
        objective,
        x0=np.array([lr_guess_um, stylus_yaw_guess_deg], dtype=float),
        step=np.array([max(1.0, 0.05 * abs(lr_guess_um)), 0.25], dtype=float),
        max_iter=max_iter,
    )


def fit_stylus_width_yaw_and_overhang(
    radius_mm: np.ndarray,
    lag_s: np.ndarray,
    effective_length_mm: float,
    offset_angle_deg: float,
    overhang_guess_mm: float,
    mount_yaw_deg: float,
    stylus_yaw_guess_deg: float,
    lr_guess_um: float,
    rotation_sign: float,
    angular_velocity_rad_per_s: float = 10.0 * np.pi / 9.0,
    max_iter: int = 300,
    lr_min_um: float = 10.0,
    lr_max_um: float = 35.0,
    overhang_min_mm: float = 0.0,
    overhang_max_mm: float = float("inf"),
) -> OptimizeResult:
    if not np.isfinite(lr_min_um) or not np.isfinite(lr_max_um) or lr_min_um <= 0.0 or lr_min_um >= lr_max_um:
        raise ValueError("L/R fit bounds must be finite, positive, and ordered")
    if not np.isfinite(overhang_min_mm) or overhang_min_mm < 0.0 or overhang_min_mm > overhang_max_mm:
        raise ValueError("Overhang fit bounds must be non-negative and ordered")

    def objective(params: np.ndarray) -> float:
        lr_um, stylus_yaw_deg, overhang_mm = params
        if lr_um < lr_min_um or lr_um > lr_max_um or overhang_mm < overhang_min_mm or overhang_mm > overhang_max_mm:
            return float("inf")
        measured = apparent_tracking_error_from_lag_deg(radius_mm, lag_s, lr_um, angular_velocity_rad_per_s)
        modeled = modeled_apparent_tracking_error_deg(
            radius_mm=radius_mm,
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_mm=overhang_mm,
            stylus_yaw_deg=stylus_yaw_deg,
            mount_yaw_deg=mount_yaw_deg,
            rotation_sign=rotation_sign,
        )
        return float(rms(measured - modeled))

    return nelder_mead(
        objective,
        x0=np.array([lr_guess_um, stylus_yaw_guess_deg, overhang_guess_mm], dtype=float),
        step=np.array([max(1.0, 0.05 * abs(lr_guess_um)), 0.25, 0.25], dtype=float),
        max_iter=max_iter,
    )


def fit_stylus_width_yaw_and_overhang_from_lag(
    radius_mm: np.ndarray,
    lag_s: np.ndarray,
    effective_length_mm: float,
    offset_angle_deg: float,
    overhang_guess_mm: float,
    mount_yaw_deg: float,
    stylus_yaw_guess_deg: float,
    lr_guess_um: float,
    rotation_sign: float,
    angular_velocity_rad_per_s: float = 10.0 * np.pi / 9.0,
    max_iter: int = 300,
    lr_min_um: float = 10.0,
    lr_max_um: float = 35.0,
    overhang_min_mm: float = 0.0,
    overhang_max_mm: float = float("inf"),
) -> OptimizeResult:
    if not np.isfinite(lr_min_um) or not np.isfinite(lr_max_um) or lr_min_um <= 0.0 or lr_min_um >= lr_max_um:
        raise ValueError("L/R fit bounds must be finite, positive, and ordered")
    if not np.isfinite(overhang_min_mm) or overhang_min_mm < 0.0 or overhang_min_mm > overhang_max_mm:
        raise ValueError("Overhang fit bounds must be non-negative and ordered")

    def objective(params: np.ndarray) -> float:
        lr_um, stylus_yaw_deg, overhang_mm = params
        if lr_um < lr_min_um or lr_um > lr_max_um or overhang_mm < overhang_min_mm or overhang_mm > overhang_max_mm:
            return float("inf")
        modeled_ate = modeled_apparent_tracking_error_deg(
            radius_mm=radius_mm,
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_mm=overhang_mm,
            stylus_yaw_deg=stylus_yaw_deg,
            mount_yaw_deg=mount_yaw_deg,
            rotation_sign=rotation_sign,
        )
        modeled_lag = lag_from_apparent_tracking_error_s(radius_mm, modeled_ate, lr_um, angular_velocity_rad_per_s)
        return float(rms(lag_s - modeled_lag))

    return nelder_mead(
        objective,
        x0=np.array([lr_guess_um, stylus_yaw_guess_deg, overhang_guess_mm], dtype=float),
        step=np.array([max(1.0, 0.05 * abs(lr_guess_um)), 0.25, 0.25], dtype=float),
        max_iter=max_iter,
    )
