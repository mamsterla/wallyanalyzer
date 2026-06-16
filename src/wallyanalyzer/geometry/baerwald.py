from __future__ import annotations

import numpy as np


def baerwald_tracking_error_deg(
    radius_mm: np.ndarray | list[float],
    effective_length_mm: float = 280.0,
    offset_angle_deg: float = 19.495,
    overhang_mm: float = 14.63,
    lathe_offset_mm: float = 0.0,
) -> np.ndarray:
    """Vectorized port of `Amster/baerwaldTE.m`.

    Parameters use the same units as Matlab:
    - radius_mm: groove radius in mm
    - effective_length_mm: tonearm effective length in mm
    - offset_angle_deg: offset angle in degrees
    - overhang_mm: overhang in mm
    - lathe_offset_mm: lathe centering offset in mm
    """

    r = np.asarray(radius_mm, dtype=float)
    pivot_to_spindle_mm = effective_length_mm - overhang_mm
    arc_term = (r**2 + effective_length_mm**2 - pivot_to_spindle_mm**2) / (
        2.0 * r * effective_length_mm
    )
    arc_term = np.clip(arc_term, -1.0, 1.0)
    lathe_term = np.clip(lathe_offset_mm / r, -1.0, 1.0)

    return (
        np.degrees(np.arcsin(arc_term))
        - offset_angle_deg
        - np.degrees(np.arcsin(lathe_term))
    )
