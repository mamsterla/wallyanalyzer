from __future__ import annotations

import numpy as np


ArrayLike = np.ndarray | list[float] | tuple[float, ...]


def nanmean(values: ArrayLike) -> float:
    array = np.asarray(values, dtype=float)
    return float(np.nanmean(array))


def nanstd(values: ArrayLike, ddof: int = 0) -> float:
    array = np.asarray(values, dtype=float)
    return float(np.nanstd(array, ddof=ddof))


def rms(values: ArrayLike, axis: int | None = None) -> np.ndarray | float:
    array = np.asarray(values, dtype=float)
    result = np.sqrt(np.nanmean(np.square(array), axis=axis))
    if np.isscalar(result):
        return float(result)
    return result
