import unittest

import numpy as np

from wallyanalyzer.fitting import modeled_apparent_tracking_error_deg
from wallyanalyzer.geometry import baerwald_tracking_error_deg
from wallyanalyzer.metadata import InMemoryMetadataProvider
from wallyanalyzer.pipelines import compile_one_measurement, compile_sine_results
from wallyanalyzer.schemas import (
    AcquisitionRecord,
    CartridgeRecord,
    CompileConfig,
    MeasurementResult,
    SystemRecord,
    TestTrackRecord,
)


class CompilePipelineTests(unittest.TestCase):
    def test_compile_one_measurement_recovers_synthetic_parameters(self):
        n = 24
        radii = np.linspace(146.0, 60.0, n)
        skip_deg = 90.0
        effective_length_mm = 230.0
        offset_angle_deg = 22.0
        overhang_mm = 17.0
        mount_yaw_deg = 0.3
        stylus_yaw_deg = -0.2
        lr_um = 25.0
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
            lathe_offset_mm=0.0,
        )
        distortion_ratio = cut_velocity * np.tan(np.radians(base_te)) / radii * 1000.0 / omega

        harmonics = np.ones((n, 3), dtype=float)
        harmonics[:, 1] = np.abs(distortion_ratio)
        frequencies = np.full((n, 2), 1000.0, dtype=float)
        valid_mask = np.ones(n, dtype=bool)

        acquisition = AcquisitionRecord(
            file_stem="synthetic",
            test_track_name="TrackA",
            system_id=1,
            cartridge_name="CartA",
            cantilever_yaw_deg=mount_yaw_deg,
            stylus_yaw_deg=0.0,
            effective_length_mm=effective_length_mm,
            offset_angle_deg=offset_angle_deg,
            overhang_mm=overhang_mm,
            actual_pivot_to_spindle_mm=effective_length_mm - overhang_mm,
        )
        measurement = MeasurementResult(
            source_file="synthetic.wav",
            file_stem="synthetic",
            acquisition=acquisition,
            test_track=TestTrackRecord(name="TrackA", outer_radius_mm=146.0, inner_radius_mm=60.0),
            sample_rate_hz_original=10000,
            sample_rate_hz_effective=10000.0,
            decimation_factor=1,
            bits_per_sample=16,
            dt_s=0.0001,
            skip_deg=skip_deg,
            periods_per_segment=64,
            spectral_half_width_bins=5,
            cut_velocity_m_per_s=cut_velocity,
            angular_velocity_rad_per_s=omega,
            outer_radius_mm=146.0,
            inner_radius_mm=60.0,
            pitch_estimate=1.0,
            envelope_level=1.0,
            envelope_start_sample=0,
            envelope_end_sample=100,
            modulation_duration_s=1.0,
            samples_per_revolution=100.0,
            samples_per_period=10,
            snippet_length_samples=64,
            padded_length_samples=72,
            skip_samples=10,
            segment_start_samples=np.arange(n, dtype=int),
            segment_midpoint_samples=np.arange(n, dtype=int),
            lag_s=lag_s,
            fundamental_freq_hz=frequencies,
            harmonic_amplitude=harmonics,
            lr_diff_over_sum_rms_ratio=np.full(n, 0.35 / 100.0, dtype=float),
            valid_mask=valid_mask,
            processing_time_s=0.01,
            diagnostics={},
        )

        provider = InMemoryMetadataProvider(
            acquisitions={"synthetic": acquisition},
            test_tracks={"TrackA": measurement.test_track},
            cartridges={"CartA": CartridgeRecord(cartridge_name="CartA", lr_um=lr_um)},
            systems={1: SystemRecord(system_id=1, tonearm="TA")},
        )

        result = compile_one_measurement(
            measurement,
            metadata_provider=provider,
            config=CompileConfig(smoothing_rotations=1, stylus_fit_max_iter=200, distortion_fit_max_iter=200),
        )

        self.assertAlmostEqual(result.summary.effective_lr_um, lr_um, delta=3.0)
        self.assertAlmostEqual(result.summary.effective_stylus_yaw_deg, stylus_yaw_deg, delta=0.5)
        self.assertAlmostEqual(result.summary.effective_mount_yaw_deg, mount_yaw_deg, delta=0.5)
        self.assertAlmostEqual(result.summary.effective_overhang_mm, overhang_mm, delta=1.0)
        self.assertLess(result.summary.apparent_tracking_fit_rms_deg, 0.25)


    def test_compile_sine_results_builds_aggregate_summary(self):
        provider = InMemoryMetadataProvider(
            acquisitions={},
            test_tracks={"TrackA": TestTrackRecord(name="TrackA", outer_radius_mm=146.0, inner_radius_mm=60.0)},
            cartridges={"CartA": CartridgeRecord(cartridge_name="CartA", lr_um=25.0)},
            systems={1: SystemRecord(system_id=1, tonearm="TA")},
        )
        measurements = []
        for idx, cy in enumerate([-3.0, -1.5, 1.5, 3.0], start=1):
            n = 12
            radii = np.linspace(146.0, 60.0, n)
            ate_deg = modeled_apparent_tracking_error_deg(
                radius_mm=radii,
                effective_length_mm=230.0,
                offset_angle_deg=22.0,
                overhang_mm=17.0,
                stylus_yaw_deg=2.2,
                mount_yaw_deg=cy,
                rotation_sign=1.0,
            )
            lag_s = np.sin(np.radians(ate_deg)) * 0.9 * 25.0 / (1000.0 * np.pi * radii)
            harmonics = np.ones((n, 3), dtype=float)
            harmonics[:, 1] = np.abs(cy) * 0.1 + 0.2
            acquisition = AcquisitionRecord(
                file_stem=f"sweep{idx}",
                test_track_name="TrackA",
                system_id=1,
                cartridge_name="CartA",
                cantilever_yaw_deg=cy,
                stylus_yaw_deg=0.0,
                effective_length_mm=230.0,
                offset_angle_deg=22.0,
                overhang_mm=17.0,
                actual_pivot_to_spindle_mm=213.0,
            )
            provider.acquisitions[f"sweep{idx}"] = acquisition
            measurements.append(
                MeasurementResult(
                    source_file=f"sweep{idx}.wav",
                    file_stem=f"sweep{idx}",
                    acquisition=acquisition,
                    test_track=provider.test_tracks["TrackA"],
                    sample_rate_hz_original=10000,
                    sample_rate_hz_effective=10000.0,
                    decimation_factor=1,
                    bits_per_sample=16,
                    dt_s=0.0001,
                    skip_deg=90.0,
                    periods_per_segment=64,
                    spectral_half_width_bins=5,
                    cut_velocity_m_per_s=0.06,
                    angular_velocity_rad_per_s=100.0 / 3.0 * 2.0 * np.pi / 60.0,
                    outer_radius_mm=146.0,
                    inner_radius_mm=60.0,
                    pitch_estimate=1.0,
                    envelope_level=1.0,
                    envelope_start_sample=0,
                    envelope_end_sample=100,
                    modulation_duration_s=1.0,
                    samples_per_revolution=100.0,
                    samples_per_period=10,
                    snippet_length_samples=64,
                    padded_length_samples=72,
                    skip_samples=10,
                    segment_start_samples=np.arange(n, dtype=int),
                    segment_midpoint_samples=np.arange(n, dtype=int),
                    lag_s=lag_s,
                    fundamental_freq_hz=np.full((n, 2), 1000.0, dtype=float),
                    harmonic_amplitude=harmonics,
                    lr_diff_over_sum_rms_ratio=np.full(n, 0.004, dtype=float),
                    valid_mask=np.ones(n, dtype=bool),
                    processing_time_s=0.01,
                    diagnostics={},
                )
            )
        result = compile_sine_results(measurements, provider, CompileConfig(smoothing_rotations=1))
        self.assertIsNotNone(result.aggregate_summary)
        self.assertIn("records", result.aggregate_summary)
        self.assertIn("ate_peak_branches", result.aggregate_summary)
        self.assertGreaterEqual(len(result.aggregate_summary["records"]), 4)


if __name__ == "__main__":
    unittest.main()
