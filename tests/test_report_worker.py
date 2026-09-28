from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from algorithms.wally_report_worker import PRESET, _geometry_provenance, _resolve_preset, build_tracking_error_artifacts


class TrackingErrorWorkerGeometryTests(unittest.TestCase):
    def test_persisted_geometry_overrides_worker_defaults(self) -> None:
        preset = _resolve_preset(
            {
                "effectiveLengthMm": 250.0,
                "offsetAngleDeg": 23.0,
                "overhangMm": 17.5,
                "mountYawDeg": -0.4,
            }
        )

        self.assertEqual(preset["effective_length_mm"], 250.0)
        self.assertEqual(preset["offset_angle_deg"], 23.0)
        self.assertEqual(preset["overhang_mm"], 17.5)
        self.assertEqual(preset["cantilever_yaw_deg"], -0.4)
        self.assertEqual(_geometry_provenance(preset)["mountYawDeg"], -0.4)
        self.assertEqual(PRESET["effective_length_mm"], 245.0)

    def test_invalid_persisted_geometry_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "geometry is invalid"):
            _resolve_preset({"mountYawDeg": 90.0})

    def test_report_pdf_and_metrics_use_persisted_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            artifacts = build_tracking_error_artifacts(
                [Path("data/RTI1P27.wav")],
                Path(tmpdir),
                "Hosted worker test",
                {"effectiveLengthMm": 250.0, "offsetAngleDeg": 23.0, "overhangMm": 17.5, "mountYawDeg": -0.4},
            )
            self.assertIn("report_pdf", {artifact["kind"] for artifact in artifacts})
            self.assertTrue((Path(tmpdir) / "tracking-error.pdf").is_file())
            metrics = json.loads((Path(tmpdir) / "metrics.json").read_text(encoding="utf-8"))
            self.assertEqual(metrics["effectiveAlgorithmValues"], {"effectiveLengthMm": 250.0, "offsetAngleDeg": 23.0, "overhangMm": 17.5, "mountYawDeg": -0.4})


if __name__ == "__main__":
    unittest.main()
