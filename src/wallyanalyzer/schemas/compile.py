from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from .measurement import MeasurementResult
from .metadata import CartridgeRecord, SystemRecord


@dataclass(frozen=True)
class CompileConfig:
    smoothing_rotations: int = 16
    lag_outlier_sigma: float = 4.0
    stylus_fit_max_iter: int = 300
    distortion_fit_max_iter: int = 300


@dataclass(frozen=True)
class SingleCompileSummary:
    file_stem: str
    effective_lr_um: float
    effective_stylus_yaw_deg: float
    effective_mount_yaw_deg: float
    effective_overhang_mm: float
    apparent_tracking_error_peak_abs_deg: float
    apparent_tracking_error_peak_signed_deg: float
    apparent_tracking_error_range_deg: float
    apparent_tracking_error_mean_deg: float
    apparent_tracking_fit_rms_deg: float
    distortion_second_harmonic_peak_pct: float
    distortion_second_harmonic_rms_pct: float


@dataclass(frozen=True)
class SingleCompileResult:
    measurement: MeasurementResult
    cartridge: Optional[CartridgeRecord]
    system: Optional[SystemRecord]
    radius_all_mm: np.ndarray
    radius_valid_mm: np.ndarray
    radius_smooth_mm: np.ndarray
    lag_clean_s: np.ndarray
    lag_smooth_s: np.ndarray
    harmonic_valid: np.ndarray
    harmonic_smooth: np.ndarray
    lr_diff_over_sum_rms_ratio_valid: np.ndarray
    lr_diff_over_sum_rms_ratio_smooth: np.ndarray
    ate_measured_deg: np.ndarray
    ate_fitted_deg: np.ndarray
    ate_raw_deg: np.ndarray
    distortion_model: np.ndarray
    distortion_fit: np.ndarray
    stylus_fit_params: np.ndarray
    stylus_fit_objective: float
    stylus_fit_success: bool
    distortion_fit_params: np.ndarray
    distortion_fit_objective: float
    distortion_fit_success: bool
    diagnostics: dict
    summary: SingleCompileSummary


@dataclass(frozen=True)
class CompileResult:
    single_results: list[SingleCompileResult]
    aggregate_summary: Optional[dict] = None
