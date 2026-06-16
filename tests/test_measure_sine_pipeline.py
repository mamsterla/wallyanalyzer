import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from wallyanalyzer.metadata import InMemoryMetadataProvider
from wallyanalyzer.pipelines import measure_sine_file
from wallyanalyzer.schemas import AcquisitionRecord, MeasureSineConfig, TestTrackRecord


class MeasureSinePipelineTests(unittest.TestCase):
    def test_measure_sine_file_runs_on_synthetic_tone(self):
        sample_rate = 10000
        silence_samples = 500
        tone_samples = 12000
        freq = 1000.0
        lag_s = 0.0

        t = np.arange(tone_samples, dtype=float) / sample_rate
        left = 0.8 * np.sin(2.0 * np.pi * freq * t)
        right = 0.8 * np.sin(2.0 * np.pi * freq * (t + lag_s))
        tone = np.column_stack([left, right])
        silence = np.zeros((silence_samples, 2), dtype=float)
        samples = np.vstack([silence, tone, silence])
        pcm = np.clip(samples * 32767.0, -32768, 32767).astype("<i2")

        provider = InMemoryMetadataProvider(
            acquisitions={
                "synthetic": AcquisitionRecord(
                    file_stem="synthetic",
                    digitizer="Cosmos ADC",
                    test_track_name="TrackA",
                )
            },
            test_tracks={
                "TrackA": TestTrackRecord(name="TrackA", outer_radius_mm=146.0, inner_radius_mm=57.0)
            },
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = Path(tmpdir) / "synthetic.wav"
            with wave.open(str(audio_path), "wb") as wav_file:
                wav_file.setnchannels(2)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(pcm.tobytes())

            result = measure_sine_file(
                audio_path,
                metadata_provider=provider,
                config=MeasureSineConfig(),
            )

        self.assertEqual(result.file_stem, "synthetic")
        self.assertEqual(result.sample_rate_hz_effective, sample_rate)
        self.assertGreater(len(result.segment_start_samples), 0)
        self.assertEqual(result.lag_s.shape[0], len(result.segment_start_samples))
        self.assertEqual(result.fundamental_freq_hz.shape[1], 2)
        self.assertEqual(result.harmonic_amplitude.shape[1], 3)
        self.assertGreater(np.count_nonzero(result.valid_mask), 0)
        self.assertTrue(np.allclose(result.fundamental_freq_hz[result.valid_mask, 0], freq, atol=10.0))


if __name__ == "__main__":
    unittest.main()
