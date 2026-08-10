from __future__ import annotations

import csv
import sqlite3
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from wallyanalyzer.turntables.database import SCHEMA_SQL, build_turntable_database, enrich_turntable_database, normalize_name, sync_turntable_research_queue


def _insert_manufacturer(conn: sqlite3.Connection, name: str) -> int:
    cursor = conn.execute(
        "INSERT INTO manufacturers(name, normalized_name, created_at) VALUES (?, ?, ?)",
        (name, normalize_name(name), datetime.now(timezone.utc).replace(microsecond=0).isoformat()),
    )
    return int(cursor.lastrowid)


def _insert_model(conn: sqlite3.Connection, manufacturer_id: int, model_name: str) -> int:
    cursor = conn.execute(
        """
        INSERT INTO turntable_models(manufacturer_id, model_name, normalized_model_name, display_name, notes, created_at)
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


def _insert_feature(
    conn: sqlite3.Connection,
    model_id: int,
    source_id: int,
    feature_kind: str,
    feature_text: str,
) -> None:
    conn.execute(
        """
        INSERT INTO turntable_features(
            turntable_model_id, source_id, feature_kind, normalized_feature_kind, feature_text, status, confidence, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, 'parsed', 0.9, NULL, ?)
        """,
        (
            model_id,
            source_id,
            feature_kind,
            normalize_name(feature_kind),
            feature_text,
            datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        ),
    )


class TurntableResearchQueueTests(unittest.TestCase):
    def test_build_turntable_database_creates_exports_and_seed_queue(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "turntables"
            outputs = build_turntable_database(base_dir)

            self.assertTrue((base_dir / "turntables.db").exists())
            self.assertTrue((base_dir / "schema.sql").exists())
            self.assertTrue((base_dir / "README.md").exists())
            self.assertTrue(outputs["manufacturer_research_summary_csv"].exists())
            self.assertTrue(outputs["turntable_research_targets_csv"].exists())

            with (base_dir / "exports" / "manufacturer_research_summary.csv").open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertTrue(any(row["manufacturer_name"] == "Technics" for row in rows))
            self.assertTrue(any(row["manufacturer_name"] == "Rega" for row in rows))

    def test_sync_research_queue_derives_hydration_statuses(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "turntables"
            base_dir.mkdir()
            db_path = base_dir / "turntables.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                rega_id = _insert_manufacturer(conn, "Rega")
                technics_id = _insert_manufacturer(conn, "Technics")
                _insert_model(conn, rega_id, "Planar 10")
                _insert_model(conn, rega_id, "Planar 8")
                _insert_model(conn, technics_id, "SL-1200G")
                _insert_model(conn, technics_id, "SP-10R")
                conn.commit()
            finally:
                conn.close()

            sync_turntable_research_queue(base_dir)

            conn = sqlite3.connect(db_path)
            try:
                rega_targets = dict(
                    conn.execute(
                        """
                        SELECT trt.model_name, trt.status
                        FROM turntable_research_targets trt
                        JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
                        WHERE mrq.manufacturer_name = 'Rega'
                        """
                    ).fetchall()
                )
                technics_targets = dict(
                    conn.execute(
                        """
                        SELECT trt.model_name, trt.status
                        FROM turntable_research_targets trt
                        JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
                        WHERE mrq.manufacturer_name = 'Technics'
                        """
                    ).fetchall()
                )
                self.assertEqual(rega_targets["Planar 10"], "hydrated")
                self.assertEqual(rega_targets["Planar 8"], "hydrated")
                self.assertEqual(technics_targets["SL-1200G"], "hydrated")
                self.assertEqual(technics_targets["SP-10R"], "hydrated")

                statuses = dict(
                    conn.execute(
                        "SELECT manufacturer_name, status FROM manufacturer_research_queue WHERE manufacturer_name IN ('Rega', 'Technics')"
                    ).fetchall()
                )
                self.assertEqual(statuses["Rega"], "hydrated")
                self.assertEqual(statuses["Technics"], "hydrated")
            finally:
                conn.close()

    def test_enrich_turntable_database_adds_model_feature_and_hydrates_target(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "turntables"
            build_turntable_database(base_dir)
            csv_path = base_dir / "staging" / "batch.csv"
            csv_path.write_text(
                "manufacturer,model,source_name,source_url,source_type,trust_level,feature_kind,feature_text,status,confidence\n"
                "Technics,SL-1200G,Technics official page,https://example.com/sl1200g,official_website,official,summary,Coreless direct-drive turntable with high-rigidity platter.,parsed,0.95\n",
                encoding="utf-8",
            )

            enrich_turntable_database(base_dir, csv_path)

            with (base_dir / "exports" / "turntable_models.csv").open(newline="", encoding="utf-8") as handle:
                models = list(csv.DictReader(handle))
            self.assertTrue(any(row["manufacturer"] == "Technics" and row["model_name"] == "SL-1200G" for row in models))

            with (base_dir / "exports" / "turntable_features.csv").open(newline="", encoding="utf-8") as handle:
                features = list(csv.DictReader(handle))
            self.assertTrue(any(row["manufacturer"] == "Technics" and row["model_name"] == "SL-1200G" for row in features))

            with (base_dir / "exports" / "turntable_research_targets.csv").open(newline="", encoding="utf-8") as handle:
                targets = [row for row in csv.DictReader(handle) if row["manufacturer_name"] == "Technics"]
            target_statuses = {row["model_name"]: row["status"] for row in targets}
            self.assertEqual(target_statuses["SL-1200G"], "hydrated")

    def test_export_database_writes_source_audit_reports(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir) / "turntables"
            base_dir.mkdir()
            db_path = base_dir / "turntables.db"

            conn = sqlite3.connect(db_path)
            try:
                conn.executescript(SCHEMA_SQL)
                thorens_id = _insert_manufacturer(conn, "Thorens")
                model_id = _insert_model(conn, thorens_id, "TD 124 DD")
                source_id = _insert_source(conn, "Thorens official page", "https://example.com/td124dd", "official_website", "official")
                _insert_feature(conn, model_id, source_id, "summary", "Modern reference direct-drive Thorens turntable.")
                conn.commit()
            finally:
                conn.close()

            outputs = sync_turntable_research_queue(base_dir)
            self.assertTrue(outputs["model_source_audit_csv"].exists())
            self.assertTrue(outputs["models_needing_source_upgrade_csv"].exists())

            with outputs["model_source_audit_csv"].open(newline="", encoding="utf-8") as handle:
                audit_rows = list(csv.DictReader(handle))
            thorens_row = next(row for row in audit_rows if row["manufacturer"] == "Thorens" and row["model_name"] == "TD 124 DD")
            self.assertEqual(thorens_row["has_official_source"], "1")
            self.assertEqual(thorens_row["needs_official_followup"], "0")


if __name__ == "__main__":
    unittest.main()
