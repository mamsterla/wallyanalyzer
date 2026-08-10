from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .metadata import AcquisitionRecord, TestTrackRecord


@dataclass(frozen=True)
class MeasurementResult:
    source_file: str
    file_stem: str
    acquisition: AcquisitionRecord
    test_track: TestTrackRecord
    sample_rate_hz_original: int
    sample_rate_hz_effective: float
    decimation_factor: int
    bits_per_sample: int
    dt_s: float
    skip_deg: float
    periods_per_segment: int
    spectral_half_width_bins: int
    cut_velocity_m_per_s: float
    angular_velocity_rad_per_s: float
    outer_radius_mm: float
    inner_radius_mm: float
    pitch_estimate: Optional[float]
    envelope_level: float
    envelope_start_sample: int
    envelope_end_sample: int
    modulation_duration_s: float
    samples_per_revolution: float
    samples_per_period: int
    snippet_length_samples: int
    padded_length_samples: int
    skip_samples: int
    segment_start_samples: np.ndarray
    segment_midpoint_samples: np.ndarray
    lag_s: np.ndarray
    fundamental_freq_hz: np.ndarray
    harmonic_amplitude: np.ndarray
    lr_diff_over_sum_rms_ratio: np.ndarray
    valid_mask: np.ndarray
    processing_time_s: float
    diagnostics: dict
    lag_difference_db: np.ndarray = field(default_factory=lambda: np.empty((0, 2), dtype=float))
    power_noise: np.ndarray = field(default_factory=lambda: np.empty((0, 4), dtype=float))
    harmonic_lr_difference_ratio: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=float))
    phase_delta_rad: np.ndarray = field(default_factory=lambda: np.empty((0, 0), dtype=float))
