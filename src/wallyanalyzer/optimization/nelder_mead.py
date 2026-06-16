from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np


@dataclass(frozen=True)
class OptimizeResult:
    x: np.ndarray
    fun: float
    nit: int
    success: bool


def nelder_mead(
    objective: Callable[[np.ndarray], float],
    x0: np.ndarray | list[float],
    step: np.ndarray | list[float] | None = None,
    max_iter: int = 300,
    x_tol: float = 1e-8,
    f_tol: float = 1e-8,
) -> OptimizeResult:
    """Small Nelder-Mead implementation for low-dimensional fitting.

    Good enough for early parity work without adding SciPy yet.
    """

    x0_array = np.asarray(x0, dtype=float)
    n = x0_array.size
    if n < 1:
        raise ValueError("x0 must have at least one element")

    if step is None:
        step_array = np.where(x0_array != 0.0, 0.05 * np.abs(x0_array), 0.1)
    else:
        step_array = np.asarray(step, dtype=float)
        if step_array.shape != x0_array.shape:
            raise ValueError("step must match shape of x0")

    simplex = np.vstack([x0_array] + [x0_array + step_array * (np.arange(n) == i) for i in range(n)])
    values = np.array([float(objective(point)) for point in simplex], dtype=float)

    alpha = 1.0
    gamma = 2.0
    rho = 0.5
    sigma = 0.5

    for iteration in range(1, max_iter + 1):
        order = np.argsort(values)
        simplex = simplex[order]
        values = values[order]

        if np.max(np.abs(simplex[1:] - simplex[0])) <= x_tol and np.max(np.abs(values[1:] - values[0])) <= f_tol:
            return OptimizeResult(x=simplex[0].copy(), fun=float(values[0]), nit=iteration, success=True)

        centroid = np.mean(simplex[:-1], axis=0)
        worst = simplex[-1]

        reflected = centroid + alpha * (centroid - worst)
        reflected_value = float(objective(reflected))

        if values[0] <= reflected_value < values[-2]:
            simplex[-1] = reflected
            values[-1] = reflected_value
            continue

        if reflected_value < values[0]:
            expanded = centroid + gamma * (reflected - centroid)
            expanded_value = float(objective(expanded))
            if expanded_value < reflected_value:
                simplex[-1] = expanded
                values[-1] = expanded_value
            else:
                simplex[-1] = reflected
                values[-1] = reflected_value
            continue

        contracted = centroid + rho * (worst - centroid)
        contracted_value = float(objective(contracted))
        if contracted_value < values[-1]:
            simplex[-1] = contracted
            values[-1] = contracted_value
            continue

        best = simplex[0]
        simplex = np.vstack([best + sigma * (point - best) for point in simplex])
        values = np.array([float(objective(point)) for point in simplex], dtype=float)

    order = np.argsort(values)
    simplex = simplex[order]
    values = values[order]
    return OptimizeResult(x=simplex[0].copy(), fun=float(values[0]), nit=max_iter, success=False)
