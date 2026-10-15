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


@dataclass(frozen=True)
class ToneRegion:
    start_sample: int
    end_sample: int
    first_tone_snr_db: float
    last_tone_snr_db: float


@dataclass(frozen=True)
class OrientationPreamble:
    start_sample: int
    end_sample: int
    dominant_channel: str
    lag_polarity: int
    dominant_channel_snr_db: float
    channel_dominance_db: float


def detect_orientation_preamble(
    samples: np.ndarray,
    sample_rate_hz: float,
    one_khz_start_sample: int,
    rotation_period_s: float,
    target_hz: float = 80.0,
    minimum_snr_db: float = 20.0,
    minimum_dominance_db: float = 12.0,
) -> OrientationPreamble:
    """Read the one-revolution 80 Hz channel-identity preamble before 1 kHz.

    The reference tone is cut on the physical left channel. A right-dominant
    preamble therefore records a reversed physical channel identity. Signed Play
    Yaw still follows the recorded electrical L/R order.
    """
    if samples.ndim != 2 or samples.shape[1] != 2 or sample_rate_hz <= 0.0:
        raise ValueError("Orientation preamble requires stereo samples and a positive sample rate")
    length = int(round(rotation_period_s * sample_rate_hz))
    boundary = int(one_khz_start_sample)
    if length < 16 or boundary < 0 or boundary > samples.shape[0]:
        raise EnvelopeDetectionError("80 Hz orientation preamble is unavailable near the 1 kHz program")
    # Production captures can overlap the 80 Hz reference with the first 1 kHz
    # blocks. Search around that spectral boundary, then trim through the selected
    # one-revolution window before timing the 1 kHz program.
    first_start = max(0, boundary - length)
    last_start = min(samples.shape[0] - length, boundary + length)
    if last_start < first_start:
        raise EnvelopeDetectionError("80 Hz orientation preamble does not fit in the capture")
    step = max(1, int(round(sample_rate_hz / 10.0)))
    frequencies = np.fft.rfftfreq(length, 1.0 / sample_rate_hz)
    tone_index = int(np.argmin(np.abs(frequencies - target_hz)))
    noise_band = (frequencies >= 30.0) & (frequencies <= 180.0) & (np.abs(frequencies - target_hz) > 10.0)
    best: tuple[float, int, int, float, np.ndarray] | None = None
    for start in range(first_start, last_start + 1, step):
        snippet = samples[start : start + length] * np.hanning(length)[:, None]
        spectrum = np.abs(np.fft.rfft(snippet, axis=0))
        tone = spectrum[tone_index]
        noise = np.maximum(np.median(spectrum[noise_band], axis=0), 1e-30)
        snr_db = 20.0 * np.log10(np.maximum(tone, 1e-30) / noise)
        dominant_index = int(np.argmax(tone))
        other_index = 1 - dominant_index
        dominance_db = float(20.0 * np.log10(max(float(tone[dominant_index]), 1e-30) / max(float(tone[other_index]), 1e-30)))
        score = float(np.min(snr_db) + dominance_db)
        if best is None or score > best[0]:
            best = (score, start, dominant_index, dominance_db, snr_db)
    assert best is not None
    _, start, dominant_index, dominance_db, snr_db = best
    if snr_db[dominant_index] < minimum_snr_db or dominance_db < minimum_dominance_db:
        raise EnvelopeDetectionError("80 Hz orientation preamble does not identify one channel reliably")
    dominant_channel = "left" if dominant_index == 0 else "right"
    return OrientationPreamble(
        start_sample=start,
        end_sample=start + length,
        dominant_channel=dominant_channel,
        lag_polarity=1 if dominant_channel == "left" else -1,
        dominant_channel_snr_db=float(snr_db[dominant_index]),
        channel_dominance_db=dominance_db,
    )


def detect_tone_region(
    samples: np.ndarray,
    sample_rate_hz: float,
    target_hz: float = 1_000.0,
    block_seconds: float = 0.25,
    search_seconds: float = 30.0,
    min_tone_snr_db: float = 30.0,
    consecutive_blocks: int = 4,
) -> ToneRegion:
    """Find the contiguous 1 kHz program, rejecting broadband lead-in/out noise."""
    if samples.ndim != 2 or sample_rate_hz <= 0.0:
        raise ValueError("samples must be 2D and sample_rate_hz must be positive")
    block = max(1, int(round(block_seconds * sample_rate_hz)))
    count = samples.shape[0] // block
    scan = min(count, max(consecutive_blocks, int(round(search_seconds / block_seconds))))
    if count < consecutive_blocks * 2:
        raise EnvelopeDetectionError("Capture is too short to identify a tone region")
    mono = np.mean(samples[: count * block], axis=1)
    frequencies = np.fft.rfftfreq(block, 1.0 / sample_rate_hz)
    tone_band = np.abs(frequencies - target_hz) <= 60.0
    noise_band = (frequencies >= 200.0) & (frequencies <= 5_000.0) & ~tone_band

    def snr_db(index: int) -> float:
        snippet = mono[index * block : (index + 1) * block] * np.hanning(block)
        spectrum = np.abs(np.fft.rfft(snippet))
        tone = float(np.max(spectrum[tone_band]))
        noise = float(np.median(spectrum[noise_band]))
        return float(20.0 * np.log10(max(tone, 1e-30) / max(noise, 1e-30)))

    head_scores = np.array([snr_db(index) for index in range(scan)])
    tail_start = count - scan
    tail_scores = np.array([snr_db(index) for index in range(tail_start, count)])
    head_good = head_scores >= min_tone_snr_db
    tail_good = tail_scores >= min_tone_snr_db
    first = _find_consecutive_run(head_good, 0.5, consecutive_blocks, from_start=True)
    last = _find_consecutive_run(tail_good, 0.5, consecutive_blocks, from_start=False)
    if first is None or last is None:
        raise EnvelopeDetectionError("Could not find a sustained 1 kHz tone at both capture boundaries")
    last += tail_start
    if last <= first:
        raise EnvelopeDetectionError("Detected tone end before tone start")
    return ToneRegion(
        start_sample=int(first * block),
        end_sample=int(min(samples.shape[0] - 1, (last + 1) * block - 1)),
        first_tone_snr_db=float(head_scores[first]),
        last_tone_snr_db=float(tail_scores[last - tail_start]),
    )


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
