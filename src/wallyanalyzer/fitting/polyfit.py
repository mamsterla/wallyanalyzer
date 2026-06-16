from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from wallyanalyzer.math_utils import rms


@dataclass(frozen=True)
class PolyfitRejectResult:
    coefficients: np.ndarray
    sigma: float
    good_indices: np.ndarray
    bad_indices: np.ndarray
    fitted_values: np.ndarray
    iterations: int


def polyfit_with_rejection(
    x: np.ndarray | list[float],
    y: np.ndarray | list[float],
    degree: int,
    nsig: float = 3.0,
) -> PolyfitRejectResult:
    """Port of `Amster/choosepolyfit1.m` without plotting side effects."""

    x_array = np.asarray(x, dtype=float).reshape(-1)
    y_array = np.asarray(y, dtype=float).reshape(-1)

    if x_array.shape != y_array.shape:
        raise ValueError("x and y must have the same shape")

    valid = np.flatnonzero(~np.isnan(x_array) & ~np.isnan(y_array))
    bad_indices = np.flatnonzero(np.isnan(x_array) | np.isnan(y_array))
    iterations = 0

    while True:
        if valid.size <= degree:
            raise ValueError("Not enough points remain for requested polynomial degree")

        coefficients = np.polyfit(x_array[valid], y_array[valid], degree)
        fitted = np.polyval(coefficients, x_array[valid])
        residual = y_array[valid] - fitted
        sigma = float(rms(residual))

        if sigma == 0.0:
            break

        misses = np.flatnonzero(np.abs(residual) > nsig * sigma)
        if misses.size == 0:
            break

        bad_indices = np.concatenate([bad_indices, valid[misses]])
        valid = np.delete(valid, misses)
        iterations += 1

    return PolyfitRejectResult(
        coefficients=np.asarray(coefficients, dtype=float),
        sigma=float(sigma),
        good_indices=np.asarray(valid, dtype=int),
        bad_indices=np.unique(np.asarray(bad_indices, dtype=int)),
        fitted_values=np.asarray(np.polyval(coefficients, x_array[valid]), dtype=float),
        iterations=iterations,
    )
