from __future__ import annotations

import numpy as np

from wallyanalyzer.geometry import baerwald_tracking_error_deg
from wallyanalyzer.math_utils import rms
from wallyanalyzer.optimization import OptimizeResult, nelder_mead


def apparent_tracking_error_from_lag_deg(
    radius_mm: np.ndarray,
    lag_s: np.ndarray,
    lr_um: float,
) -> np.ndarray:
    argument = 1000.0 * np.pi * radius_mm * lag_s / 0.9 / lr_um
    argument = np.clip(argument, -1.0, 1.0)
    return np.degrees(np.arcsin(argument))


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
    max_iter: int = 300,
) -> OptimizeResult:
    def objective(params: np.ndarray) -> float:
        lr_um, stylus_yaw_deg = params
        if lr_um <= 0.0:
            return float("inf")
        measured = apparent_tracking_error_from_lag_deg(radius_mm, lag_s, lr_um)
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
