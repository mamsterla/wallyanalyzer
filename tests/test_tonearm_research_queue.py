from __future__ import annotations

import csv
import sqlite3
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from wallyanalyzer.tonearms.database import (
    SCHEMA_SQL,
    export_database,
    import_tonearm_workbook_gaps,
    normalize_name,
    normalize_tonearm_manufacturers,
    parse_biglobe_armdata,
    sync_tonearm_research_queue,
)


def _insert_manufacturer(conn: sqlite3.Connection, name: str) -> int:
    cursor = conn.execute(
        "INSERT INTO manufacturers(name, normalized_name, created_at) VALUES (?, ?, ?)",
        (name, normalize_name(name), datetime.now(timezone.utc).replace(microsecond=0).isoformat()),
    )
    return int(cursor.lastrowid)


def _insert_model(conn: sqlite3.Connection, manufacturer_id: int, model_name: str) -> int:
    cursor = conn.execute(
        """
        INSERT INTO tonearm_models(manufacturer_id, model_name, normalized_model_name, display_name, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            manufacturer_id,
            model_name,
            normalize_name(model_name),
            model_name,
            None,
            datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        ),
    )
    return int(cursor.lastrowid)


def _insert_source(conn: sqlite3.Connection, source_name: str, source_url: str, source_type: str, trust_level: str) -> int:
    cursor = conn.execute(
        """
        INSERT INTO sources(source_name, source_url, source_type, trust_level, retrieved_at, local_snapshot_path, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            source_name,
            source_url,
            source_type,
            trust_level,
            datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            None,
            None,
        ),
    )
    return int(cursor.lastrowid)


def _insert_spec(
    conn: sqlite3.Connection,
    model_id: int,
    source_id: int,
    field_name: str,
    *,
    value_num: float | None = None,
    value_text: str | None = None,
    raw_value_text: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO tonearm_specs(
            tonearm_model_id, source_id, ingest_run_id, field_name, value_num, value_text, unit, raw_value_text, status, confidence, notes, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, 'parsed', 0.9, NULL, ?)
        """,
        (
            model_id,
            source_id,
            field_name,
            value_num,
            value_text,
            raw_value_text,
            datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        ),
    )


class TonearmResearchQueueTests(unittest.TestCase):
    def test_parse_biglobe_armdata_excludes_known_non_tonearm_row(self):
        html = """
        <table>
          <tr>
            <td>MAKER</td><td>MODEL</td><td>EFFECTIVE LENGTH</td><td>OVERHANG</td><td>OFFSET ANGLE</td><td>NULL POINTS</td>
          </tr>
          <tr>
            <td>JML Co.</td><td>TA-3A</td><td>229</td><td>18.156</td><td>24.102</td><td>66/121</td>
          </tr>
          <tr>
            <td>Infinity</td><td>Black Widow</td><td>237</td><td>15*</td><td>21*</td><td>67/103*</td>
          </tr>
        </table>
        """
        rows = parse_biglobe_armdata(html)
        self.assertEqual([(row.manufacturer, row.model) for row in rows], [("Infinity", "Black Widow")])

    def test_sync_research_queue_derives_target_and_manufacturer_statuses(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                ortofon_id = _insert_manufacturer(conn, "Ortofon")
                project_id = _insert_manufacturer(conn, "Pro-Ject")

                for model_name in ("AS-212R", "AS-309R", "RS-212D", "RS-309D"):
                    _insert_model(conn, ortofon_id, model_name)

                _insert_model(conn, project_id, "9cc Evolution")

                conn.commit()
            finally:
                conn.close()

            sync_tonearm_research_queue(base_dir)

            conn = sqlite3.connect(db_path)
            try:
                ortofon_targets = dict(
                    conn.execute(
                        """
                        SELECT trt.model_name, trt.status
                        FROM tonearm_research_targets trt
                        JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
                        WHERE mrq.manufacturer_name = 'Ortofon'
                        """
                    ).fetchall()
                )
                self.assertEqual(
                    ortofon_targets,
                    {
                        "AS-212R": "hydrated",
                        "AS-309R": "hydrated",
                        "RS-212D": "hydrated",
                        "RS-309D": "hydrated",
                    },
                )

                project_targets = dict(
                    conn.execute(
                        """
                        SELECT trt.model_name, trt.status
                        FROM tonearm_research_targets trt
                        JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
                        WHERE mrq.manufacturer_name = 'Pro-Ject'
                        """
                    ).fetchall()
                )
                self.assertEqual(project_targets["9cc Evolution"], "hydrated")
                self.assertEqual(project_targets["10cc Evolution"], "queued")
                self.assertEqual(project_targets["12cc Evolution"], "queued")

                manufacturer_statuses = dict(
                    conn.execute(
                        "SELECT manufacturer_name, status FROM manufacturer_research_queue WHERE manufacturer_name IN ('Ortofon', 'Pro-Ject')"
                    ).fetchall()
                )
                self.assertEqual(manufacturer_statuses["Ortofon"], "hydrated")
                self.assertEqual(manufacturer_statuses["Pro-Ject"], "hydrated-partial")
            finally:
                conn.close()

    def test_sync_research_queue_uses_canonical_manufacturer_for_hydration(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                alphason_id = _insert_manufacturer(conn, "Alphason")
                _insert_model(conn, alphason_id, "HR-100S")
                _insert_model(conn, alphason_id, "HR-100MCS")
                conn.commit()
            finally:
                conn.close()

            sync_tonearm_research_queue(base_dir)

            conn = sqlite3.connect(db_path)
            try:
                target_statuses = dict(
                    conn.execute(
                        """
                        SELECT trt.model_name, trt.status
                        FROM tonearm_research_targets trt
                        JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
                        WHERE mrq.manufacturer_name = 'Alphason Designs'
                        """
                    ).fetchall()
                )
                self.assertEqual(target_statuses["HR-100S"], "hydrated")
                self.assertEqual(target_statuses["HR-100MCS"], "hydrated")

                canonical_match = conn.execute(
                    "SELECT canonical_match_name, canonical_manufacturer_id FROM manufacturer_research_queue WHERE manufacturer_name = 'Alphason Designs'"
                ).fetchone()
                self.assertEqual(canonical_match[0], "Alphason")
                self.assertIsNotNone(canonical_match[1])
            finally:
                conn.close()

    def test_sync_research_queue_ignores_superseded_targets_in_manufacturer_rollup(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                schroeder_id = _insert_manufacturer(conn, "Schroeder")
                for model_name in ("Reference", "CB 9-inch", "CB-L 12-inch", "Model 2", "DPS"):
                    _insert_model(conn, schroeder_id, model_name)
                conn.commit()
            finally:
                conn.close()

            sync_tonearm_research_queue(base_dir)

            conn = sqlite3.connect(db_path)
            try:
                target_statuses = dict(
                    conn.execute(
                        """
                        SELECT trt.model_name, trt.status
                        FROM tonearm_research_targets trt
                        JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
                        WHERE mrq.manufacturer_name = 'Schroeder'
                        """
                    ).fetchall()
                )
                self.assertEqual(target_statuses["CB"], "superseded")
                self.assertEqual(target_statuses["Reference"], "hydrated")
                self.assertEqual(target_statuses["CB 9-inch"], "hydrated")
                self.assertEqual(target_statuses["CB-L 12-inch"], "hydrated")
                self.assertEqual(target_statuses["Model 2"], "hydrated")
                self.assertEqual(target_statuses["DPS"], "hydrated")

                manufacturer_status = conn.execute(
                    "SELECT status FROM manufacturer_research_queue WHERE manufacturer_name = 'Schroeder'"
                ).fetchone()
                self.assertIsNotNone(manufacturer_status)
                self.assertEqual(manufacturer_status[0], "hydrated")
            finally:
                conn.close()

    def test_sync_research_queue_air_tangent_supersedes_unconfirmed_2a_target(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                air_tangent_id = _insert_manufacturer(conn, "Air Tangent")
                for model_name in ("2B", "Reference", "Model 2002"):
                    _insert_model(conn, air_tangent_id, model_name)
                conn.commit()
            finally:
                conn.close()

            sync_tonearm_research_queue(base_dir)

            conn = sqlite3.connect(db_path)
            try:
                target_statuses = dict(
                    conn.execute(
                        """
                        SELECT trt.model_name, trt.status
                        FROM tonearm_research_targets trt
                        JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
                        WHERE mrq.manufacturer_name = 'Air Tangent'
                        """
                    ).fetchall()
                )
                self.assertEqual(target_statuses["2A"], "superseded")
                self.assertEqual(target_statuses["2B"], "hydrated")
                self.assertEqual(target_statuses["Reference"], "hydrated")
                self.assertEqual(target_statuses["Model 2002"], "hydrated")

                manufacturer_status = conn.execute(
                    "SELECT status FROM manufacturer_research_queue WHERE manufacturer_name = 'Air Tangent'"
                ).fetchone()
                self.assertIsNotNone(manufacturer_status)
                self.assertEqual(manufacturer_status[0], "hydrated")
            finally:
                conn.close()

    def test_export_database_writes_source_audit_reports(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            export_dir = base_dir / "exports"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                schroeder_id = _insert_manufacturer(conn, "Schroeder")
                legacy_id = _insert_manufacturer(conn, "Schroder")

                official_model_id = _insert_model(conn, schroeder_id, "Reference")
                dealer_model_id = _insert_model(conn, schroeder_id, "CB 9-inch")
                legacy_model_id = _insert_model(conn, legacy_id, "Model 2 and Model DPS")

                official_source_id = _insert_source(conn, "Official page", "https://example.com/official", "official_page", "official")
                dealer_source_id = _insert_source(conn, "Dealer page", "https://example.com/dealer", "dealer_page", "secondary")
                legacy_source_id = _insert_source(conn, "Legacy table", "https://example.com/legacy", "secondary_table", "secondary")

                _insert_spec(conn, official_model_id, official_source_id, "mounting_distance_mm", value_num=222.0)
                _insert_spec(conn, dealer_model_id, dealer_source_id, "mounting_distance_mm", value_num=222.0)
                _insert_spec(conn, legacy_model_id, legacy_source_id, "mounting_distance_mm", value_num=230.0)

                conn.commit()

                outputs = export_database(conn, export_dir)
            finally:
                conn.close()

            self.assertIn("model_source_audit_csv", outputs)
            self.assertIn("models_needing_source_upgrade_csv", outputs)
            self.assertIn("manufacturer_normalization_candidates_csv", outputs)

            with outputs["models_needing_source_upgrade_csv"].open(newline="", encoding="utf-8") as handle:
                upgrade_rows = list(csv.DictReader(handle))
            flagged_models = {(row["manufacturer"], row["model_name"]) for row in upgrade_rows}
            self.assertIn(("Schroeder", "CB 9-inch"), flagged_models)
            self.assertIn(("Schroder", "Model 2 and Model DPS"), flagged_models)
            self.assertNotIn(("Schroeder", "Reference"), flagged_models)

            with outputs["manufacturer_normalization_candidates_csv"].open(newline="", encoding="utf-8") as handle:
                normalization_rows = list(csv.DictReader(handle))
            schroder_row = next(row for row in normalization_rows if row["legacy_name"] == "Schroder")
            self.assertEqual(schroder_row["canonical_name"], "Schroeder")
            self.assertTrue(schroder_row["legacy_manufacturer_id"])
            self.assertTrue(schroder_row["canonical_manufacturer_id"])
            self.assertEqual(schroder_row["resolution_state"], "pending")

    def test_export_database_includes_null_alignment_type(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            export_dir = base_dir / "exports"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                manufacturer_id = _insert_manufacturer(conn, "Test Maker")
                unknown_model_id = _insert_model(conn, manufacturer_id, "Unknown Arm")
                stevenson_model_id = _insert_model(conn, manufacturer_id, "Stevenson Arm")
                source_id = _insert_source(conn, "Source", "https://example.com/source", "official_page", "official")

                _insert_spec(conn, unknown_model_id, source_id, "mounting_distance_mm", value_num=222.0)
                _insert_spec(conn, stevenson_model_id, source_id, "mounting_distance_mm", value_num=223.0)
                _insert_spec(conn, stevenson_model_id, source_id, "null_alignment_type", value_text="Stevenson", raw_value_text="Stevenson")

                conn.commit()
                conn.executescript(SCHEMA_SQL)
                outputs = export_database(conn, export_dir)
            finally:
                conn.close()

            with outputs["tonearms_csv"].open(newline="", encoding="utf-8") as handle:
                rows = {row["Model"]: row for row in csv.DictReader(handle)}
            self.assertEqual(rows["Unknown Arm"]["Null Alignment Type"], "Unknown")
            self.assertEqual(rows["Stevenson Arm"]["Null Alignment Type"], "Stevenson")

    def test_sync_research_queue_backfills_null_alignment_type_from_geometry(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                manufacturer_id = _insert_manufacturer(conn, "VPI")
                model_id = _insert_model(conn, manufacturer_id, "JMW-10")
                source_id = _insert_source(conn, "Official page", "https://example.com/jmw10", "official_page", "official")
                _insert_spec(conn, model_id, source_id, "effective_length_mm", value_num=273.42)
                _insert_spec(conn, model_id, source_id, "mounting_distance_mm", value_num=258.0)
                _insert_spec(conn, model_id, source_id, "offset_angle_deg", value_num=19.98)
                _insert_spec(conn, model_id, source_id, "overhang_mm", value_num=15.42)
                conn.commit()
            finally:
                conn.close()

            sync_tonearm_research_queue(base_dir)

            conn = sqlite3.connect(db_path)
            try:
                row = conn.execute(
                    "SELECT value_text, raw_value_text FROM tonearm_specs WHERE field_name = 'null_alignment_type' AND tonearm_model_id = ? ORDER BY tonearm_spec_id DESC LIMIT 1",
                    (model_id,),
                ).fetchone()
                self.assertEqual(row[0], "Loefgren")
                self.assertIn("mm", row[1])
            finally:
                conn.close()

    def test_normalize_tonearm_manufacturers_merges_legacy_manufacturers(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                tri_planar_id = _insert_manufacturer(conn, "Tri-Planar")
                legacy_tri_planar_id = _insert_manufacturer(conn, "Wheaton/Tri-Planar")
                schroeder_id = _insert_manufacturer(conn, "Schroeder")
                legacy_schroder_id = _insert_manufacturer(conn, "Schroder")

                _insert_model(conn, tri_planar_id, "Mk VII")
                legacy_tri_model_id = _insert_model(conn, legacy_tri_planar_id, "Tri-Planar MKIV Ultimate")
                legacy_schroder_model_id = _insert_model(conn, legacy_schroder_id, "Model 2 and Model DPS")

                source_id = _insert_source(conn, "Legacy table", "https://example.com/legacy", "secondary_table", "secondary")
                _insert_spec(conn, legacy_tri_model_id, source_id, "effective_length_mm", value_num=250.0)
                _insert_spec(conn, legacy_schroder_model_id, source_id, "effective_length_mm", value_num=239.3)
                conn.commit()
            finally:
                conn.close()

            outputs = normalize_tonearm_manufacturers(base_dir)

            conn = sqlite3.connect(db_path)
            try:
                remaining_manufacturers = {row[0] for row in conn.execute("SELECT name FROM manufacturers").fetchall()}
                self.assertIn("Tri-Planar", remaining_manufacturers)
                self.assertIn("Schroeder", remaining_manufacturers)
                self.assertNotIn("Wheaton/Tri-Planar", remaining_manufacturers)
                self.assertNotIn("Schroder", remaining_manufacturers)

                moved_models = set(
                    conn.execute(
                        """
                        SELECT m.name, tm.model_name
                        FROM tonearm_models tm
                        JOIN manufacturers m ON m.manufacturer_id = tm.manufacturer_id
                        WHERE tm.model_name IN ('Tri-Planar MKIV Ultimate', 'Model 2 and Model DPS')
                        """
                    ).fetchall()
                )
                self.assertIn(("Tri-Planar", "Tri-Planar MKIV Ultimate"), moved_models)
                self.assertIn(("Schroeder", "Model 2 and Model DPS"), moved_models)
            finally:
                conn.close()

            with outputs["manufacturer_normalization_candidates_csv"].open(newline="", encoding="utf-8") as handle:
                normalization_rows = list(csv.DictReader(handle))
            states = {row["legacy_name"]: row["resolution_state"] for row in normalization_rows}
            self.assertEqual(states["Schroder"], "merged")
            self.assertEqual(states["Wheaton/Tri-Planar"], "merged")

    def test_import_tonearm_workbook_gaps_adds_missing_targets(self):
        from openpyxl import Workbook

        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "tonearms"
            base_dir.mkdir()
            db_path = base_dir / "tonearms.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                basis_id = _insert_manufacturer(conn, "Basis Audio")
                _insert_model(conn, basis_id, "Vector 4")
                conn.commit()
            finally:
                conn.close()

            workbook_path = base_dir / "TonearmDatabaseWTv4.xlsx"
            wb = Workbook()
            ws = wb.active
            ws.title = "Main"
            ws.append(["MAKE", "MODEL", "EFF", "Target Eff", "EFF SOURCE", "P2S", "P2S SOURCE", "Notes"])
            ws.append(["Basis", "Vector 4", 222, 222, "worksheet", 208, "worksheet", "already in db"])
            ws.append(["Audio Origami", "PU7", 229, 229, "worksheet", 210.427, "worksheet", "new target"])
            ws.append(["Project", "Carbon Debut", 218.5, 218.5, "worksheet", "", "", "turntable row"])
            ws.append(["Luxman/SAEC", "PD-191A turntable", 250, 250, "worksheet", 230, "worksheet", "not a tonearm"])
            ws.append(["Avid", "Acutus", 233.15, 233.15, "worksheet", 216, "worksheet", "turntable row"])
            ws.append(["Vertere", "SG-1", 240, 240, "worksheet", 222.5, "worksheet", "turntable row"])
            wb.save(workbook_path)

            outputs = import_tonearm_workbook_gaps(base_dir, workbook_path)
            self.assertEqual(outputs["imported_target_count"], 1)
            self.assertTrue(Path(outputs["tonearm_workbook_gap_report_csv"]).exists())

            conn = sqlite3.connect(db_path)
            try:
                imported = conn.execute(
                    """
                    SELECT mrq.manufacturer_name, trt.model_name
                    FROM tonearm_research_targets trt
                    JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
                    WHERE mrq.manufacturer_name = 'Audio Origami'
                    """
                ).fetchall()
                self.assertEqual(imported, [("Audio Origami", "PU7")])
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
