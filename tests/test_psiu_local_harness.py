import math
import wave
from pathlib import Path

import numpy as np

from wallyanalyzer.tools.psiu_local_harness import active_tone_region, estimate_tone_hz, inspect


def tone(seconds: float, rate: int = 48_000, frequency: float = 1_000.0) -> np.ndarray:
    frames = round(seconds * rate)
    values = 0.4 * np.sin(2 * math.pi * frequency * np.arange(frames) / rate)
    return np.column_stack([values, values])


def write_pcm(path: Path, samples: np.ndarray, rate: int = 48_000) -> None:
    pcm = np.rint(np.clip(samples, -1, 1) * (2**15 - 1)).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, rate, 0, "NONE", "not compressed"))
        output.writeframes(pcm.tobytes())


def test_finds_loud_program_region_and_verifies_stereo_tone(tmp_path: Path) -> None:
    rate = 48_000
    samples = np.vstack([np.zeros((rate, 2)), tone(3, rate), np.zeros((rate, 2))])
    start, end = active_tone_region(samples, rate)
    assert abs(start / rate - 1) <= 0.25
    assert abs(end / rate - 4) <= 0.25
    estimated = estimate_tone_hz(samples[start:end], rate, 1_000)
    assert all(abs(value - 1_000) < 0.1 for value in estimated)


def test_inspect_trims_leadin_and_runout_without_reencoding(tmp_path: Path) -> None:
    source = tmp_path / "capture.wav"
    trimmed = tmp_path / "trimmed.wav"
    write_pcm(source, np.vstack([np.zeros((48_000, 2)), tone(2), np.zeros((48_000, 2))]))
    result = inspect(source, 1_000, trimmed)
    assert result["trimmedOutput"] == str(trimmed)
    assert trimmed.exists()
    assert 1.5 < result["programRegion"]["durationSeconds"] < 2.5
    assert all(abs(value - 1_000) < 0.1 for value in result["toneHz"])
