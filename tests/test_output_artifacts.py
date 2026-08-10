import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from wallyanalyzer.output import render_measurement_validation_svg, render_svg_to_png, save_measurement_result
from wallyanalyzer.schemas import AcquisitionRecord, MeasurementResult, TestTrackRecord


class OutputArtifactTests(unittest.TestCase):
    def test_save_measurement_result_and_render_svg(self):
        acquisition = AcquisitionRecord(
            file_stem="demo",
            digitizer="Cosmos",
            test_track_name="TrackA",
        )
        test_track = TestTrackRecord(name="TrackA", outer_radius_mm=144.5, inner_radius_mm=58.5)
        result = MeasurementResult(
            source_file="demo.wav",
            file_stem="demo",
            acquisition=acquisition,
            test_track=test_track,
            sample_rate_hz_original=192000,
            sample_rate_hz_effective=192000.0,
            decimation_factor=1,
            bits_per_sample=24,
            dt_s=1 / 192000.0,
            skip_deg=10.0,
            periods_per_segment=64,
            spectral_half_width_bins=5,
            cut_velocity_m_per_s=0.06,
            angular_velocity_rad_per_s=3.4906585039886595,
            outer_radius_mm=144.5,
            inner_radius_mm=58.5,
            pitch_estimate=0.44,
            envelope_level=0.08,
            envelope_start_sample=100,
            envelope_end_sample=1000,
            modulation_duration_s=1.0,
            samples_per_revolution=345600.0,
            samples_per_period=192,
            snippet_length_samples=12288,
            padded_length_samples=12788,
            skip_samples=9600,
            segment_start_samples=np.array([0, 1, 2], dtype=int),
            segment_midpoint_samples=np.array([5, 6, 7], dtype=int),
            lag_s=np.array([1e-6, np.nan, 2e-6], dtype=float),
            fundamental_freq_hz=np.array([[1000.1, 1000.2], [np.nan, np.nan], [999.9, 1000.0]], dtype=float),
            harmonic_amplitude=np.array([[100.0, 1.0, 0.5], [np.nan, np.nan, np.nan], [100.0, 2.0, 1.0]], dtype=float),
            lr_diff_over_sum_rms_ratio=np.array([0.004, np.nan, 0.006], dtype=float),
            valid_mask=np.array([True, False, True]),
            processing_time_s=0.25,
            diagnostics={"n_segments": 3},
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            saved = save_measurement_result(result, tmpdir)
            svg_path = Path(tmpdir) / "demo.svg"
            render_measurement_validation_svg(result, svg_path)

            self.assertTrue(saved["metadata_json"].exists())
            self.assertTrue(saved["arrays_npz"].exists())
            self.assertTrue(saved["segments_csv"].exists())
            self.assertTrue(saved["summary_json"].exists())
            self.assertTrue(svg_path.exists())

            summary = json.loads(saved["summary_json"].read_text(encoding="utf-8"))
            self.assertEqual(summary["file_stem"], "demo")
            self.assertEqual(summary["valid_segment_count"], 2)

            svg_text = svg_path.read_text(encoding="utf-8")
            self.assertIn("Measurement validation: demo", svg_text)
            self.assertIn("Lag (µs)", svg_text)
            self.assertIn("dB((L-R)/(L+R))", svg_text)
            self.assertIn("ΔLR / Fundamental (%) and PNx excess (%)", svg_text)
            self.assertIn("deLagged", svg_text)
            self.assertIn("PNx Left", svg_text)

    def test_render_svg_to_png_uses_inkscape(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            svg_path = Path(tmpdir) / "plot.svg"
            png_path = Path(tmpdir) / "rendered" / "plot.svg.png"
            svg_path.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', encoding="utf-8")
            with patch("wallyanalyzer.output.render_png.find_inkscape_executable", return_value="/usr/local/bin/inkscape"):
                with patch("subprocess.run") as mock_run:
                    out = render_svg_to_png(svg_path, png_path, width=1234)
            self.assertEqual(out, png_path)
            self.assertTrue(png_path.parent.exists())
            mock_run.assert_called_once()
            command = mock_run.call_args.args[0]
            self.assertIn("/usr/local/bin/inkscape", command)
            self.assertIn(f"--export-filename={png_path}", command)
            self.assertIn("--export-width=1234", command)


if __name__ == "__main__":
    unittest.main()
