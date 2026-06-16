from __future__ import annotations

import numpy as np

from wallyanalyzer.geometry import baerwald_tracking_error_deg
from wallyanalyzer.optimization import OptimizeResult, nelder_mead


def distortion_parameter(
    radius_mm: np.ndarray,
    effective_length_mm: float,
    offset_angle_deg: float,
    overhang_mm: float,
    mount_yaw_deg: float,
    cut_velocity_m_per_s: float,
    angular_velocity_rad_per_s: float,
) -> np.ndarray:
    tracking_error_deg = baerwald_tracking_error_deg(
        radius_mm,
        effective_length_mm=effective_length_mm,
        offset_angle_deg=offset_angle_deg - mount_yaw_deg,
        overhang_mm=overhang_mm,
        lathe_offset_mm=0.0,
    )
    return (
        cut_velocity_m_per_s
        * np.tan(np.radians(tracking_error_deg))
        / radius_mm
        * 1000.0
        / angular_velocity_rad_per_s
    )


def fit_distortion_geometry(
    radius_mm: np.ndarray,
    distortion_ratio: np.ndarray,
    effective_length_mm: float,
    offset_angle_deg: float,
    overhang_guess_mm: float,
    mount_yaw_guess_deg: float,
    cut_velocity_m_per_s: float,
    angular_velocity_rad_per_s: float,
    max_iter: int = 300,
) -> OptimizeResult:
    def objective(params: np.ndarray) -> float:
        mount_yaw_deg, overhang_mm = params
        modeled = distortion_parameter(
            radius_mm=radius_mm,
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_mm=overhang_mm,
            mount_yaw_deg=mount_yaw_deg,
            cut_velocity_m_per_s=cut_velocity_m_per_s,
            angular_velocity_rad_per_s=angular_velocity_rad_per_s,
        )
        return float(np.sum((np.abs(modeled) - np.abs(distortion_ratio)) ** 2))

    return nelder_mead(
        objective,
        x0=np.array([mount_yaw_guess_deg, overhang_guess_mm], dtype=float),
        step=np.array([0.25, 0.25], dtype=float),
        max_iter=max_iter,
    )
