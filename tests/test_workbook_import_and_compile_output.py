import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from wallyanalyzer.fitting import modeled_apparent_tracking_error_deg
from wallyanalyzer.geometry import baerwald_tracking_error_deg
from wallyanalyzer.metadata import InMemoryMetadataProvider, export_tracking_workbook_to_json_fixtures
from wallyanalyzer.output import (
    render_compile_sweep_svg,
    render_compile_validation_svg,
    save_compile_result,
    save_compile_sweep_summary,
)
from wallyanalyzer.pipelines import compile_one_measurement, compile_sine_results
from wallyanalyzer.schemas import (
    AcquisitionRecord,
    CartridgeRecord,
    CompileConfig,
    MeasurementResult,
    SystemRecord,
    TestTrackRecord,
)


class WorkbookImportAndCompileOutputTests(unittest.TestCase):
    def test_export_tracking_workbook_to_json_fixtures(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            outputs = export_tracking_workbook_to_json_fixtures(
                "data/ResearchRecordingTrackingJune2026.xlsx",
                tmpdir,
                file_stems=["RTI1P27"],
            )
            acquisitions = json.loads(Path(outputs["acquisitions_json"]).read_text(encoding="utf-8"))
            systems = json.loads(Path(outputs["systems_json"]).read_text(encoding="utf-8"))
            cartridges = json.loads(Path(outputs["cartridges_json"]).read_text(encoding="utf-8"))
            self.assertEqual(acquisitions[0]["file_stem"], "RTI1P27")
            self.assertEqual(acquisitions[0]["system_id"], 11.0)
            self.assertEqual(systems[0]["tonearm"], "KorfTACF10")
            self.assertEqual(cartridges[0]["cartridge_name"], "UB2950")

    def test_save_compile_result_and_render_svg(self):
        n = 12
        radii = np.linspace(144.5, 58.5, n)
        effective_length_mm = 245.0
        offset_angle_deg = 22.42
        overhang_mm = 16.9
        mount_yaw_deg = 0.0
        stylus_yaw_deg = 2.2
        lr_um = 9.5
        cut_velocity = 0.06
        omega = 100.0 / 3.0 * 2.0 * np.pi / 60.0

        ate_deg = modeled_apparent_tracking_error_deg(
            radius_mm=radii,
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_mm=overhang_mm,
            stylus_yaw_deg=stylus_yaw_deg,
            mount_yaw_deg=mount_yaw_deg,
            rotation_sign=1.0,
        )
        lag_s = np.sin(np.radians(ate_deg)) * 0.9 * lr_um / (1000.0 * np.pi * radii)
        base_te = baerwald_tracking_error_deg(
            radii,
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg - mount_yaw_deg,
            overhang_mm=overhang_mm,
        )
        distortion_ratio = cut_velocity * np.tan(np.radians(base_te)) / radii * 1000.0 / omega
        harmonics = np.ones((n, 3), dtype=float)
        harmonics[:, 1] = np.abs(distortion_ratio)
        harmonics[:, 2] = np.abs(distortion_ratio) * 0.5

        acquisition = AcquisitionRecord(
            file_stem="demo",
            test_track_name="TrackA",
            system_id=11,
            cartridge_name="UB2950",
            cantilever_yaw_deg=0.0,
            stylus_yaw_deg=-0.2,
            effective_length_mm=245.0,
            offset_angle_deg=22.42,
            overhang_mm=16.9,
            actual_pivot_to_spindle_mm=228.1,
        )
        measurement = MeasurementResult(
            source_file="demo.wav",
            file_stem="demo",
            acquisition=acquisition,
            test_track=TestTrackRecord(name="TrackA", outer_radius_mm=144.5, inner_radius_mm=58.5),
            sample_rate_hz_original=192000,
            sample_rate_hz_effective=192000.0,
            decimation_factor=1,
            bits_per_sample=24,
            dt_s=1 / 192000.0,
            skip_deg=30.0,
            periods_per_segment=64,
            spectral_half_width_bins=5,
            cut_velocity_m_per_s=cut_velocity,
            angular_velocity_rad_per_s=omega,
            outer_radius_mm=144.5,
            inner_radius_mm=58.5,
            pitch_estimate=0.44,
            envelope_level=0.1,
            envelope_start_sample=0,
            envelope_end_sample=100,
            modulation_duration_s=1.0,
            samples_per_revolution=345600.0,
            samples_per_period=192,
            snippet_length_samples=12288,
            padded_length_samples=12788,
            skip_samples=9600,
            segment_start_samples=np.arange(n),
            segment_midpoint_samples=np.arange(n),
            lag_s=lag_s,
            fundamental_freq_hz=np.full((n, 2), 1000.0),
            harmonic_amplitude=harmonics,
            lr_diff_over_sum_rms_ratio=np.full(n, 0.4 / 100.0, dtype=float),
            valid_mask=np.ones(n, dtype=bool),
            processing_time_s=0.1,
            diagnostics={},
        )
        provider = InMemoryMetadataProvider(
            acquisitions={"demo": acquisition},
            test_tracks={"TrackA": measurement.test_track},
            cartridges={"UB2950": CartridgeRecord(cartridge_name="UB2950", lr_um=17.0)},
            systems={11: SystemRecord(system_id=11, turntable="TechDas IIIP", tonearm="KorfTACF10")},
        )
        compile_result = compile_one_measurement(
            measurement,
            provider,
            CompileConfig(smoothing_rotations=1, stylus_fit_max_iter=100, distortion_fit_max_iter=100),
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            saved = save_compile_result(compile_result, tmpdir)
            svg_path = Path(tmpdir) / "compile.svg"
            render_compile_validation_svg(compile_result, svg_path)
            self.assertTrue(saved["summary_json"].exists())
            self.assertTrue(saved["arrays_npz"].exists())
            self.assertTrue(saved["traces_csv"].exists())
            self.assertTrue(svg_path.exists())
            summary = json.loads(saved["summary_json"].read_text(encoding="utf-8"))
            self.assertEqual(summary["file_stem"], "demo")
            self.assertIn("effective_lr_um", summary)
            svg_text = svg_path.read_text(encoding="utf-8")
            self.assertIn("demo.wav", svg_text)
            self.assertIn("UB2950", svg_text)

    def test_render_compile_sweep_svg(self):
        provider = InMemoryMetadataProvider(
            acquisitions={},
            test_tracks={"TrackA": TestTrackRecord(name="TrackA", outer_radius_mm=144.5, inner_radius_mm=58.5)},
            cartridges={"UB2950": CartridgeRecord(cartridge_name="UB2950", lr_um=17.0)},
            systems={11: SystemRecord(system_id=11, turntable="TechDas IIIP", tonearm="KorfTACF10")},
        )
        measurements = []
        for idx, cy in enumerate([-4.5, -3.0, -1.5, 0.0], start=1):
            n = 12
            radii = np.linspace(144.5, 58.5, n)
            ate_deg = modeled_apparent_tracking_error_deg(
                radius_mm=radii,
                effective_length_mm=245.0,
                offset_angle_deg=22.42,
                overhang_mm=16.9,
                stylus_yaw_deg=2.0,
                mount_yaw_deg=cy,
                rotation_sign=1.0,
            )
            lag_s = np.sin(np.radians(ate_deg)) * 0.9 * 9.0 / (1000.0 * np.pi * radii)
            harmonics = np.ones((n, 3), dtype=float)
            harmonics[:, 1] = 0.2 + 0.15 * np.abs(cy)
            harmonics[:, 2] = harmonics[:, 1] * 0.4
            acquisition = AcquisitionRecord(
                file_stem=f"demo{idx}",
                test_track_name="TrackA",
                system_id=11,
                cartridge_name="UB2950",
                cantilever_yaw_deg=cy,
                stylus_yaw_deg=-0.2,
                effective_length_mm=245.0,
                offset_angle_deg=22.42,
                overhang_mm=16.9,
                actual_pivot_to_spindle_mm=228.1,
            )
            provider.acquisitions[f"demo{idx}"] = acquisition
            measurements.append(
                MeasurementResult(
                    source_file=f"demo{idx}.wav",
                    file_stem=f"demo{idx}",
                    acquisition=acquisition,
                    test_track=provider.test_tracks["TrackA"],
                    sample_rate_hz_original=192000,
                    sample_rate_hz_effective=192000.0,
                    decimation_factor=1,
                    bits_per_sample=24,
                    dt_s=1 / 192000.0,
                    skip_deg=30.0,
                    periods_per_segment=64,
                    spectral_half_width_bins=5,
                    cut_velocity_m_per_s=0.06,
                    angular_velocity_rad_per_s=100.0 / 3.0 * 2.0 * np.pi / 60.0,
                    outer_radius_mm=144.5,
                    inner_radius_mm=58.5,
                    pitch_estimate=0.44,
                    envelope_level=0.1,
                    envelope_start_sample=0,
                    envelope_end_sample=100,
                    modulation_duration_s=1.0,
                    samples_per_revolution=345600.0,
                    samples_per_period=192,
                    snippet_length_samples=12288,
                    padded_length_samples=12788,
                    skip_samples=9600,
                    segment_start_samples=np.arange(n),
                    segment_midpoint_samples=np.arange(n),
                    lag_s=lag_s,
                    fundamental_freq_hz=np.full((n, 2), 1000.0),
                    harmonic_amplitude=harmonics,
                    lr_diff_over_sum_rms_ratio=np.full(n, 0.4 / 100.0, dtype=float),
                    valid_mask=np.ones(n, dtype=bool),
                    processing_time_s=0.1,
                    diagnostics={},
                )
            )
        compile_bundle = compile_sine_results(measurements, provider, CompileConfig(smoothing_rotations=1))

        with tempfile.TemporaryDirectory() as tmpdir:
            sweep_svg = Path(tmpdir) / "compile_sweep.svg"
            sweep_json = Path(tmpdir) / "compile_sweep.json"
            render_compile_sweep_svg(compile_bundle, sweep_svg)
            save_compile_sweep_summary(compile_bundle, sweep_json)
            self.assertTrue(sweep_svg.exists())
            self.assertTrue(sweep_json.exists())
            svg_text = sweep_svg.read_text(encoding="utf-8")
            self.assertIn("demo4.wav", svg_text)
            self.assertIn("Cartridge Mount Yaw", svg_text)
            self.assertIn("Min:", svg_text)


if __name__ == "__main__":
    unittest.main()
