from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class AcquisitionRecord:
    file_stem: str
    file_name: Optional[str] = None
    recorded_at: Optional[str] = None
    digitizer: Optional[str] = None
    test_track_name: Optional[str] = None
    system_id: Optional[float] = None
    cartridge_name: Optional[str] = None
    cantilever_yaw_deg: Optional[float] = None
    stylus_yaw_deg: Optional[float] = None
    effective_length_mm: Optional[float] = None
    offset_angle_deg: Optional[float] = None
    overhang_mm: Optional[float] = None
    required_overhang_mm: Optional[float] = None
    overhang_adjustment_mm: Optional[float] = None
    pivot_spindle_adjustment_mm: Optional[float] = None
    actual_pivot_to_spindle_mm: Optional[float] = None
    comments: Optional[str] = None
    raw_source_ref: Optional[str] = None


@dataclass(frozen=True)
class TestTrackRecord:
    name: str
    outer_radius_mm: float
    inner_radius_mm: float
    notes: Optional[str] = None


@dataclass(frozen=True)
class CartridgeRecord:
    cartridge_name: str
    lr_um: Optional[float] = None
    ze_deg: Optional[float] = None
    wally_zenith_deg: Optional[float] = None
    sra_deg: Optional[float] = None
    vta_deg: Optional[float] = None
    notes: Optional[str] = None


@dataclass(frozen=True)
class SystemRecord:
    system_id: float
    turntable: Optional[str] = None
    tonearm: Optional[str] = None
    headshell: Optional[str] = None
    shim: Optional[str] = None
    isolation: Optional[str] = None
    notes: Optional[str] = None


@dataclass(frozen=True)
class MeasureSineConfig:
    skip_deg: float = 10.0
    periods_per_segment: int = 64
    spectral_half_width_bins: int = 5
    rotation_period_s: float = 1.8
    cut_velocity_m_per_s: float = 0.06
    envelope_threshold_fraction: float = 0.3
    envelope_end_threshold_fraction: float = 0.5
    noise_reject_rms_multiplier: float = 2.0
    lag_outlier_abs_s: float = 1.5e-5
    highpass_window_base: int = 500

    @property
    def angular_velocity_rad_per_s(self) -> float:
        import math

        return 100.0 / 3.0 * 2.0 * math.pi / 60.0
