from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class EnvelopeResult:
    envelope: np.ndarray
    center_samples: np.ndarray
    level: float
    start_sample: int
    end_sample: int


class EnvelopeDetectionError(ValueError):
    pass


def compute_period_envelope(samples: np.ndarray, period_samples: int) -> tuple[np.ndarray, np.ndarray]:
    if period_samples <= 0:
        raise ValueError("period_samples must be positive")
    if samples.ndim != 2:
        raise ValueError("samples must have shape (n_samples, n_channels)")

    n_samples = samples.shape[0]
    n_blocks = n_samples // period_samples
    if n_blocks < 1:
        raise ValueError("Not enough samples for one envelope block")

    trimmed = samples[: n_blocks * period_samples]
    reshaped = trimmed.reshape(n_blocks, period_samples, samples.shape[1])
    envelope = np.max(np.abs(reshaped), axis=1)
    center_samples = np.arange(period_samples // 2, n_blocks * period_samples, period_samples)
    return envelope, center_samples


def detect_modulated_region(
    envelope: np.ndarray,
    center_samples: np.ndarray,
    threshold_fraction: float = 0.3,
    end_threshold_fraction: float | None = None,
    channel_index: int = 0,
    consecutive_blocks: int = 9,
) -> EnvelopeResult:
    if envelope.ndim != 2:
        raise ValueError("envelope must have shape (n_blocks, n_channels)")
    if center_samples.ndim != 1:
        raise ValueError("center_samples must be 1D")
    if envelope.shape[0] != center_samples.shape[0]:
        raise ValueError("envelope and center_samples lengths must match")
    if consecutive_blocks < 1:
        raise ValueError("consecutive_blocks must be >= 1")

    primary = envelope[:, channel_index]
    level = float(np.median(primary))
    threshold = threshold_fraction * level
    end_threshold = (threshold_fraction if end_threshold_fraction is None else end_threshold_fraction) * level

    start_block = _find_consecutive_run(primary, threshold, consecutive_blocks, from_start=True)
    end_block = _find_consecutive_run(primary, end_threshold, consecutive_blocks, from_start=False)

    if start_block is None or end_block is None:
        raise EnvelopeDetectionError("Could not find modulation start/end from envelope")
    if end_block < start_block:
        raise EnvelopeDetectionError("Detected modulation end before start")

    return EnvelopeResult(
        envelope=envelope,
        center_samples=center_samples,
        level=level,
        start_sample=int(center_samples[start_block]),
        end_sample=int(center_samples[end_block]),
    )


def analyze_period_envelope(
    samples: np.ndarray,
    period_samples: int,
    threshold_fraction: float = 0.3,
    end_threshold_fraction: float | None = None,
    channel_index: int = 0,
    consecutive_blocks: int = 9,
) -> EnvelopeResult:
    envelope, center_samples = compute_period_envelope(samples, period_samples)
    return detect_modulated_region(
        envelope,
        center_samples,
        threshold_fraction=threshold_fraction,
        end_threshold_fraction=end_threshold_fraction,
        channel_index=channel_index,
        consecutive_blocks=consecutive_blocks,
    )


def _find_consecutive_run(
    values: np.ndarray,
    threshold: float,
    consecutive_blocks: int,
    *,
    from_start: bool,
) -> int | None:
    if from_start:
        indices = range(0, len(values) - consecutive_blocks + 1)
    else:
        indices = range(len(values) - consecutive_blocks, -1, -1)

    for index in indices:
        window = values[index : index + consecutive_blocks]
        if np.all(window > threshold):
            return index if from_start else index + consecutive_blocks - 1
    return None
