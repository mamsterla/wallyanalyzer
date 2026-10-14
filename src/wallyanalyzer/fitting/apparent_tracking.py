from __future__ import annotations

import numpy as np

from wallyanalyzer.geometry import baerwald_tracking_error_deg
from wallyanalyzer.math_utils import rms
from wallyanalyzer.optimization import OptimizeResult, nelder_mead


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
