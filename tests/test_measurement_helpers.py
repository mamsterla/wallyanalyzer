import math
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from wallyanalyzer.audio import infer_decimation_factor, load_wav
from wallyanalyzer.signal import (
    analyze_period_envelope,
    build_snippet_geometry,
    detrend_and_window,
    extract_padded_snippet,
    fftlag,
    snippet_is_valid,
)


class MeasurementHelperTests(unittest.TestCase):
    def test_infer_decimation_factor(self):
        self.assertEqual(infer_decimation_factor("TASCAM DR-40"), 2)
        self.assertEqual(infer_decimation_factor("Cosmos ADC"), 1)
        self.assertEqual(infer_decimation_factor("unknown"), 1)

    def test_load_wav_16bit_stereo(self):
        sample_rate = 8000
        duration_s = 0.01
        t = np.arange(int(sample_rate * duration_s)) / sample_rate
        left = 0.5 * np.sin(2.0 * np.pi * 440.0 * t)
        right = 0.25 * np.sin(2.0 * np.pi * 220.0 * t)
        stereo = np.column_stack([left, right])
        int16_data = np.clip(stereo * 32767.0, -32768, 32767).astype("<i2")

        with tempfile.TemporaryDirectory() as tmpdir:
            wav_path = Path(tmpdir) / "test.wav"
            with wave.open(str(wav_path), "wb") as wav_file:
                wav_file.setnchannels(2)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(int16_data.tobytes())

            audio = load_wav(wav_path)

        self.assertEqual(audio.num_channels, 2)
        self.assertEqual(audio.sample_rate_hz, sample_rate)
        self.assertEqual(audio.samples.shape, stereo.shape)
        self.assertTrue(np.all(np.abs(audio.samples[:, 0]) <= 1.0))

    def test_analyze_period_envelope_detects_tone_region(self):
        block = 8
        silent = np.zeros((4 * block, 2), dtype=float)
        tone_blocks = 20
        tone_t = np.arange(tone_blocks * block, dtype=float)
        tone = np.column_stack(
            [
                np.sin(2.0 * np.pi * tone_t / block),
                0.8 * np.sin(2.0 * np.pi * tone_t / block),
            ]
        )
        samples = np.vstack([silent, tone, silent])

        result = analyze_period_envelope(
            samples,
            period_samples=block,
            threshold_fraction=0.3,
            consecutive_blocks=3,
        )

        self.assertEqual(result.start_sample, 4 * block + block // 2)
        self.assertEqual(result.end_sample, (4 + tone_blocks - 1) * block + block // 2)
        self.assertGreater(result.level, 0.0)

    def test_build_extract_validate_and_detrend_snippet(self):
        geometry = build_snippet_geometry(
            start_sample=100,
            end_sample=400,
            snippet_length_samples=16,
            padding_length_samples=4,
            skip_samples=50,
        )
        self.assertEqual(geometry.padded_length_samples, 20)
        self.assertEqual(geometry.start_indices[0], 110)

        t = np.arange(500, dtype=float)
        samples = np.column_stack(
            [np.sin(2.0 * np.pi * t / 8.0), np.sin(2.0 * np.pi * t / 8.0 + 0.2)]
        )
        snippet = extract_padded_snippet(samples, geometry.start_indices[0], geometry.padded_length_samples)
        self.assertEqual(snippet.shape, (20, 2))
        self.assertTrue(snippet_is_valid(snippet, level=0.5, edge_probe_samples=5))

        smoothing_filter = np.ones(5, dtype=float) / 5.0
        analysis_window = np.ones(16, dtype=float)
        detrended = detrend_and_window(snippet, smoothing_filter, analysis_window)
        self.assertEqual(detrended.shape, (16, 2))

    def test_fftlag_estimates_known_lag_and_frequency(self):
        sample_rate = 8192.0
        dt = 1.0 / sample_rate
        n = 4096
        freq = 256.0
        lag = 2.0e-4
        t = np.arange(n, dtype=float) * dt
        left = np.sin(2.0 * np.pi * freq * t)
        right = np.sin(2.0 * np.pi * freq * (t + lag))
        segment = np.column_stack([left, right])

        result = fftlag(segment, dt_s=dt, spectral_half_width_bins=3)

        self.assertTrue(math.isclose(result.lag_s, lag, rel_tol=0.05, abs_tol=2e-5))
        self.assertTrue(np.allclose(result.fundamental_freq_hz, [freq, freq], atol=1.0))
        self.assertGreater(result.harmonic_amplitude[0], 0.0)


if __name__ == "__main__":
    unittest.main()
