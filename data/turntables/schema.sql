
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manufacturers (
    manufacturer_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turntable_models (
    turntable_model_id INTEGER PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS turntable_features (
    turntable_feature_id INTEGER PRIMARY KEY,
    turntable_model_id INTEGER NOT NULL REFERENCES turntable_models(turntable_model_id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
    feature_kind TEXT NOT NULL,
    normalized_feature_kind TEXT NOT NULL,
    feature_text TEXT NOT NULL,
    status TEXT NOT NULL,
    confidence REAL,
    notes TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turntable_features_model ON turntable_features(turntable_model_id);
CREATE INDEX IF NOT EXISTS idx_turntable_features_source ON turntable_features(source_id);

CREATE TABLE IF NOT EXISTS manufacturer_research_queue (
    manufacturer_queue_id INTEGER PRIMARY KEY,
    manufacturer_name TEXT NOT NULL UNIQUE,
    normalized_name TEXT NOT NULL UNIQUE,
    canonical_match_name TEXT,
    canonical_manufacturer_id INTEGER REFERENCES manufacturers(manufacturer_id),
    manufacturer_type TEXT NOT NULL,
    coverage_focus TEXT NOT NULL,
    priority_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    discovery_source TEXT,
    search_terms TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manufacturer_research_queue_priority ON manufacturer_research_queue(priority_tier, status);

CREATE TABLE IF NOT EXISTS turntable_research_targets (
    target_id INTEGER PRIMARY KEY,
    manufacturer_queue_id INTEGER NOT NULL REFERENCES manufacturer_research_queue(manufacturer_queue_id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    normalized_model_name TEXT NOT NULL,
    target_group TEXT,
    target_type TEXT NOT NULL,
    priority_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    source_hint TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(manufacturer_queue_id, normalized_model_name)
);
CREATE INDEX IF NOT EXISTS idx_turntable_research_targets_queue ON turntable_research_targets(manufacturer_queue_id, priority_tier, status);
