from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import wave

import numpy as np


@dataclass(frozen=True)
class AudioData:
    samples: np.ndarray
    sample_rate_hz: int
    num_channels: int
    total_samples: int
    bits_per_sample: int
    decimation_factor: int


class AudioFormatError(ValueError):
    pass


def load_wav(audio_path: str | Path, decimation_factor: int = 1) -> AudioData:
    """Load PCM WAV audio into a float64 NumPy array.

    Supported formats:
    - 8-bit PCM unsigned
    - 16-bit PCM signed
    - 24-bit PCM signed
    - 32-bit PCM signed
    """

    path = Path(audio_path)
    if decimation_factor < 1:
        raise ValueError("decimation_factor must be >= 1")

    with wave.open(str(path), "rb") as wav_file:
        num_channels = wav_file.getnchannels()
        sample_rate_hz = wav_file.getframerate()
        sampwidth = wav_file.getsampwidth()
        raw = wav_file.readframes(wav_file.getnframes())

    bits_per_sample = sampwidth * 8
    samples = _decode_pcm_bytes(raw, sampwidth, num_channels)

    if decimation_factor > 1:
        samples = samples[::decimation_factor]

    return AudioData(
        samples=samples,
        sample_rate_hz=sample_rate_hz,
        num_channels=num_channels,
        total_samples=int(samples.shape[0]),
        bits_per_sample=bits_per_sample,
        decimation_factor=decimation_factor,
    )


def infer_decimation_factor(digitizer: str | None) -> int:
    if digitizer is None:
        return 1
    lowered = digitizer.lower()
    if "tascam" in lowered:
        return 2
    if "cosmos" in lowered:
        return 1
    return 1


def _decode_pcm_bytes(raw: bytes, sampwidth: int, num_channels: int) -> np.ndarray:
    if sampwidth == 1:
        data = np.frombuffer(raw, dtype=np.uint8).astype(np.float64)
        data = (data - 128.0) / 128.0
    elif sampwidth == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float64) / (2**15)
    elif sampwidth == 3:
        byte_array = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        signed = (
            byte_array[:, 0].astype(np.int32)
            | (byte_array[:, 1].astype(np.int32) << 8)
            | (byte_array[:, 2].astype(np.int32) << 16)
        )
        sign_mask = signed & 0x800000
        signed = signed - (sign_mask << 1)
        data = signed.astype(np.float64) / (2**23)
    elif sampwidth == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float64) / (2**31)
    else:
        raise AudioFormatError(f"Unsupported WAV sample width: {sampwidth} bytes")

    if data.size % num_channels != 0:
        raise AudioFormatError("Decoded sample count is not divisible by channel count")

    return data.reshape(-1, num_channels)
