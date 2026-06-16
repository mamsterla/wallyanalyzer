from __future__ import annotations

import numpy as np


def nuttall_window(length: int, version: int = 1) -> np.ndarray:
    """Port of `Amster/nuttall.m`.

    Keeps Matlab behavior for odd/even lengths and coefficient variants.
    """

    if length <= 0:
        raise ValueError("length must be positive")

    if version == 1:
        coeffs = np.array([0.3635819, 0.4891775, 0.1365995, 0.0106411], dtype=float)
    elif version == 2:
        coeffs = np.array([0.3633509, 0.4893550, 0.1366491, 0.01064496], dtype=float)
    elif version == 3:
        coeffs = np.array([0.355768, 0.487396, 0.144232, -0.012604], dtype=float)
    else:
        raise ValueError(f"Unsupported Nuttall version: {version}")

    output = np.zeros(length, dtype=float)

    if length % 2 == 0:
        active_indices = np.arange(1, length)
        active_length = length - 1
    else:
        active_indices = np.arange(length)
        active_length = length

    arg = 2.0 * np.pi * np.arange(active_length, dtype=float) / (active_length - 1)
    output[active_indices] = (
        coeffs[0]
        - coeffs[1] * np.cos(arg)
        + coeffs[2] * np.cos(2.0 * arg)
        - coeffs[3] * np.cos(3.0 * arg)
    )
    return output
