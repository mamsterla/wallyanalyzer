import math
import wave
from pathlib import Path

import numpy as np

from wallyanalyzer.tools.psiu_local_harness import active_tone_region, estimate_tone_hz, inspect, spectral_diagnostics


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


def test_fft_diagnostics_reports_noise_floor_and_second_third_harmonics() -> None:
    rate = 48_000
    seconds = 2
    x = np.arange(rate * seconds) / rate
    fundamental = 0.5 * np.sin(2 * math.pi * 1_000 * x)
    signal = fundamental + 0.005 * np.sin(2 * math.pi * 2_000 * x) + 0.0015 * np.sin(2 * math.pi * 3_000 * x)
    diagnostics, frequencies, spectra = spectral_diagnostics(np.column_stack([signal, signal]), rate, 1_000)
    assert len(frequencies) == len(spectra[0])
    assert diagnostics[0]["peakToNoiseFloorDb"] > 100
    second, third = diagnostics[0]["harmonics"]
    assert second["order"] == 2 and abs(second["levelDbc"] + 40) < 1
    assert third["order"] == 3 and abs(third["levelDbc"] + 50.5) < 1


def test_inspect_trims_leadin_and_runout_without_reencoding(tmp_path: Path) -> None:
    source = tmp_path / "capture.wav"
    trimmed = tmp_path / "trimmed.wav"
    write_pcm(source, np.vstack([np.zeros((48_000, 2)), tone(2), np.zeros((48_000, 2))]))
    spectrum = tmp_path / "spectrum.svg"
    result = inspect(source, 1_000, trimmed, spectrum)
    assert result["trimmedOutput"] == str(trimmed)
    assert trimmed.exists()
    assert spectrum.exists()
    assert "fftDiagnostics" in result
    assert 1.5 < result["programRegion"]["durationSeconds"] < 2.5
    assert all(abs(value - 1_000) < 0.1 for value in result["toneHz"])
