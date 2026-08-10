PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturers (
    manufacturer_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tonearm_models (
    tonearm_model_id INTEGER PRIMARY KEY,
    manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(manufacturer_id),
    model_name TEXT NOT NULL,
    normalized_model_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(manufacturer_id, normalized_model_name)
);

CREATE TABLE IF NOT EXISTS sources (
    source_id INTEGER PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,
    trust_level TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    local_snapshot_path TEXT,
    notes TEXT,
    UNIQUE(source_url, retrieved_at)
);

CREATE TABLE IF NOT EXISTS ingest_runs (
    ingest_run_id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS tonearm_specs (
    tonearm_spec_id INTEGER PRIMARY KEY,
    tonearm_model_id INTEGER NOT NULL REFERENCES tonearm_models(tonearm_model_id),
    source_id INTEGER NOT NULL REFERENCES sources(source_id),
    ingest_run_id INTEGER REFERENCES ingest_runs(ingest_run_id),
    field_name TEXT NOT NULL,
    value_num REAL,
    value_text TEXT,
    unit TEXT,
    raw_value_text TEXT,
    status TEXT NOT NULL,
    confidence REAL,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tonearm_specs_model_field ON tonearm_specs(tonearm_model_id, field_name);
CREATE INDEX IF NOT EXISTS idx_tonearm_specs_source ON tonearm_specs(source_id);

DROP VIEW IF EXISTS preferred_tonearm_specs;
CREATE VIEW preferred_tonearm_specs AS
SELECT
    tm.tonearm_model_id,
    m.name AS manufacturer,
    tm.model_name AS model,
    MAX(CASE WHEN ts.field_name = 'effective_length_mm' THEN ts.value_num END) AS effective_length_mm,
    MAX(CASE WHEN ts.field_name = 'overhang_mm' THEN ts.value_num END) AS overhang_mm,
    MAX(CASE WHEN ts.field_name = 'offset_angle_deg' THEN ts.value_num END) AS offset_angle_deg,
    MAX(CASE WHEN ts.field_name = 'null_points' THEN COALESCE(ts.value_text, ts.raw_value_text) END) AS null_points,
    COALESCE(
        MAX(CASE WHEN ts.field_name = 'null_alignment_type' AND COALESCE(ts.value_text, ts.raw_value_text) <> 'Unknown' THEN COALESCE(ts.value_text, ts.raw_value_text) END),
        MAX(CASE WHEN ts.field_name = 'null_alignment_type' THEN COALESCE(ts.value_text, ts.raw_value_text) END),
        'Unknown'
    ) AS null_alignment_type,
    MAX(CASE WHEN ts.field_name = 'effective_mass_g' THEN ts.value_num END) AS effective_mass_g,
    MAX(CASE WHEN ts.field_name = 'cartridge_range_low_g' THEN ts.value_num END) AS cartridge_range_low_g,
    MAX(CASE WHEN ts.field_name = 'cartridge_range_high_g' THEN ts.value_num END) AS cartridge_range_high_g,
    MAX(CASE WHEN ts.field_name = 'arm_mount' THEN COALESCE(ts.value_text, ts.raw_value_text) END) AS arm_mount,
    MAX(CASE WHEN ts.field_name = 'null_point_inner_mm' THEN ts.value_num END) AS null_point_inner_mm,
    MAX(CASE WHEN ts.field_name = 'null_point_outer_mm' THEN ts.value_num END) AS null_point_outer_mm,
    GROUP_CONCAT(DISTINCT s.source_name) AS source_names,
    GROUP_CONCAT(DISTINCT s.source_url) AS source_urls
FROM tonearm_models tm
JOIN manufacturers m ON m.manufacturer_id = tm.manufacturer_id
LEFT JOIN tonearm_specs ts ON ts.tonearm_model_id = tm.tonearm_model_id
LEFT JOIN sources s ON s.source_id = ts.source_id
GROUP BY tm.tonearm_model_id, m.name, tm.model_name;
