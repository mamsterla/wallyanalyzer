from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from wallyanalyzer.math_utils import rms


@dataclass(frozen=True)
class SnippetGeometry:
    snippet_length_samples: int
    padded_length_samples: int
    skip_samples: int
    start_indices: np.ndarray


class SnippetError(ValueError):
    pass


def build_snippet_geometry(
    start_sample: int,
    end_sample: int,
    snippet_length_samples: int,
    padding_length_samples: int,
    skip_samples: int,
) -> SnippetGeometry:
    if snippet_length_samples <= 0:
        raise ValueError("snippet_length_samples must be positive")
    if padding_length_samples < 0:
        raise ValueError("padding_length_samples must be >= 0")
    if skip_samples <= 0:
        raise ValueError("skip_samples must be positive")

    padded_length = snippet_length_samples + padding_length_samples
    first_start = start_sample + int(np.ceil(padded_length / 2.0))
    last_start = end_sample - padded_length

    if last_start < first_start:
        raise SnippetError("Not enough room for one snippet between start and end samples")

    start_indices = np.arange(first_start, last_start + 1, skip_samples, dtype=int)
    return SnippetGeometry(
        snippet_length_samples=snippet_length_samples,
        padded_length_samples=padded_length,
        skip_samples=skip_samples,
        start_indices=start_indices,
    )


def extract_padded_snippet(samples: np.ndarray, start_sample: int, padded_length_samples: int) -> np.ndarray:
    if samples.ndim != 2:
        raise ValueError("samples must have shape (n_samples, n_channels)")

    end = start_sample + padded_length_samples
    if start_sample < 0 or end > samples.shape[0]:
        raise SnippetError("Requested snippet exceeds sample bounds")
    return samples[start_sample:end, :]


def snippet_is_valid(
    snippet: np.ndarray,
    level: float,
    edge_probe_samples: int = 500,
    noise_reject_rms_multiplier: float = 2.0,
) -> bool:
    if snippet.ndim != 2:
        raise ValueError("snippet must have shape (n_samples, n_channels)")

    probe = min(edge_probe_samples, snippet.shape[0])
    leading = snippet[:probe, :]
    trailing = snippet[-probe:, :]

    leading_noise = np.any(
        noise_reject_rms_multiplier * rms(leading, axis=0) < np.max(np.abs(leading), axis=0)
    )
    trailing_noise = np.any(
        noise_reject_rms_multiplier * rms(trailing, axis=0) < np.max(np.abs(trailing), axis=0)
    )
    low_level = np.any(np.max(np.abs(snippet), axis=0) < level / 2.0)

    return not (leading_noise or trailing_noise or low_level)


def detrend_and_window(
    padded_snippet: np.ndarray,
    smoothing_filter: np.ndarray,
    analysis_window: np.ndarray,
) -> np.ndarray:
    if padded_snippet.ndim != 2:
        raise ValueError("padded_snippet must have shape (n_samples, n_channels)")
    if smoothing_filter.ndim != 1:
        raise ValueError("smoothing_filter must be 1D")
    if analysis_window.ndim != 1:
        raise ValueError("analysis_window must be 1D")

    valid_length = padded_snippet.shape[0] - smoothing_filter.shape[0] + 1
    if valid_length != analysis_window.shape[0]:
        raise ValueError("analysis window length does not match valid convolution output")

    trend = np.column_stack(
        [
            np.convolve(padded_snippet[:, channel], smoothing_filter, mode="valid")
            for channel in range(padded_snippet.shape[1])
        ]
    )
    margin = (smoothing_filter.shape[0] - 1) // 2
    signal_of_interest = padded_snippet[margin : margin + valid_length, :]
    return (signal_of_interest - trend) * analysis_window[:, None]
