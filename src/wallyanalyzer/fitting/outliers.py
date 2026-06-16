from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SigmaRejectResult:
    mean: float
    std: float
    good_indices: np.ndarray
    bad_indices: np.ndarray
    cleaned: np.ndarray


def sigma_reject_1d(values: np.ndarray | list[float], nsig: float = 3.0) -> SigmaRejectResult:
    """Port of `Amster/choose.m` for 1D numeric arrays."""

    working = np.asarray(values, dtype=float).reshape(-1).copy()

    while True:
        mean = float(np.nanmean(working))
        std = float(np.nanstd(working))
        if np.isnan(std) or std == 0.0:
            break
        bad = np.flatnonzero(np.abs(working - mean) > nsig * std)
        if bad.size == 0:
            break
        working[bad] = np.nan

    bad_indices = np.flatnonzero(np.isnan(working))
    good_indices = np.flatnonzero(~np.isnan(working))
    return SigmaRejectResult(
        mean=float(np.nanmean(working)),
        std=float(np.nanstd(working)),
        good_indices=good_indices,
        bad_indices=bad_indices,
        cleaned=working,
    )
