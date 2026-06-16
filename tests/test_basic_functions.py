import math
import unittest

import numpy as np

from wallyanalyzer.fitting import polyfit_with_rejection, sigma_reject_1d
from wallyanalyzer.geometry import baerwald_tracking_error_deg
from wallyanalyzer.math_utils import rms
from wallyanalyzer.metadata import InMemoryMetadataProvider, load_metadata_provider_from_json_dir
from wallyanalyzer.schemas import AcquisitionRecord, TestTrackRecord
from wallyanalyzer.signal import nuttall_window


class BasicFunctionTests(unittest.TestCase):
    def test_baerwald_tracking_error_scalar_vector_shape(self):
        radii = np.array([57.0, 100.0, 146.0])
        result = baerwald_tracking_error_deg(radii)
        self.assertEqual(result.shape, (3,))
        self.assertTrue(np.isfinite(result).all())

    def test_nuttall_window_matches_matlab_even_shape_behavior(self):
        window = nuttall_window(6, version=1)
        self.assertEqual(window.shape, (6,))
        self.assertEqual(window[0], 0.0)
        self.assertTrue(np.all(window[1:] >= 0.0))

    def test_rms_ignores_nan(self):
        values = np.array([3.0, 4.0, np.nan])
        self.assertTrue(math.isclose(rms(values), math.sqrt((9.0 + 16.0) / 2.0)))

    def test_sigma_reject_1d_removes_large_outlier(self):
        result = sigma_reject_1d([1.0, 1.1, 0.9, 50.0], nsig=1.5)
        self.assertIn(3, result.bad_indices)
        self.assertTrue(np.isnan(result.cleaned[3]))
        self.assertEqual(len(result.good_indices), 3)

    def test_polyfit_with_rejection_removes_large_outlier(self):
        x = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
        y = np.array([0.0, 1.0, 2.0, 30.0, 4.0])
        result = polyfit_with_rejection(x, y, degree=1, nsig=1.5)
        self.assertIn(3, result.bad_indices)
        self.assertGreaterEqual(len(result.good_indices), 2)

    def test_in_memory_metadata_provider_case_insensitive_lookup(self):
        provider = InMemoryMetadataProvider(
            acquisitions={
                "RTI2P30": AcquisitionRecord(file_stem="RTI2P30", test_track_name="TrackA")
            },
            test_tracks={"TrackA": TestTrackRecord(name="TrackA", outer_radius_mm=146.0, inner_radius_mm=57.0)},
        )
        acquisition = provider.get_acquisition("rti2p30")
        track = provider.get_test_track("tracka")
        self.assertEqual(acquisition.file_stem, "RTI2P30")
        self.assertEqual(track.outer_radius_mm, 146.0)

    def test_load_metadata_provider_from_json_dir(self):
        provider = load_metadata_provider_from_json_dir("data/fixtures")
        acquisition = provider.get_acquisition("RTI1P27")
        track = provider.get_test_track("RTI Test 1 Track 1 Side A")
        self.assertEqual(acquisition.digitizer, "Cosmos")
        self.assertEqual(track.outer_radius_mm, 144.5)


if __name__ == "__main__":
    unittest.main()
