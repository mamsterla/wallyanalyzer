from __future__ import annotations

import csv
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


DEFAULT_TURNTABLE_MANUFACTURER_QUEUE: list[dict[str, str]] = [
    {
        "manufacturer_name": "Acoustic Signature",
        "canonical_match_name": "Acoustic Signature",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "high-mass-belt-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Acoustic Signature turntable official models specs",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Audio Note",
        "canonical_match_name": "Audio Note",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "belt-drive-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Audio Note turntable official models TT",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Basis Audio",
        "canonical_match_name": "Basis Audio",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "high-end-belt-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Basis Audio turntable official models Debut",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Brinkmann",
        "canonical_match_name": "Brinkmann",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "belt-drive-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Brinkmann turntable official models Bardo Balance",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Clearaudio",
        "canonical_match_name": "Clearaudio",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "belt-drive-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Clearaudio turntable official models Innovation Ovation",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Denon",
        "canonical_match_name": "Denon",
        "manufacturer_type": "legacy-audio-brand",
        "coverage_focus": "historic-direct-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Denon turntable official historical models DP",
        "notes": "Historic table maker overlapping with tonearm support work.",
    },
    {
        "manufacturer_name": "Dr. Feickert",
        "canonical_match_name": "Dr. Feickert",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "high-end-belt-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Dr Feickert turntable official models Blackbird Woodpecker",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Dual",
        "canonical_match_name": "Dual",
        "manufacturer_type": "legacy-audio-brand",
        "coverage_focus": "historic-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "turntable-seed",
        "search_terms": "Dual turntable official historical models",
        "notes": "Historic turntable maker seed.",
    },
    {
        "manufacturer_name": "Gold Note",
        "canonical_match_name": "Gold Note",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "modern-belt-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Gold Note turntable official models Mediterraneo Pianosa",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Goldmund",
        "canonical_match_name": "Goldmund",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "statement-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Goldmund turntable official models Reference Studio",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Garrard",
        "canonical_match_name": "Garrard",
        "manufacturer_type": "legacy-audio-brand",
        "coverage_focus": "idler-drive-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "turntable-seed",
        "search_terms": "Garrard turntable 301 401 official historical",
        "notes": "Historic turntable maker seed.",
    },
    {
        "manufacturer_name": "Kuzma",
        "canonical_match_name": "Kuzma",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "high-end-turntables",
        "priority_tier": "primary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Kuzma turntable official models Stabi R XL",
        "notes": "Primary turntable maker overlapping with tonearm coverage.",
    },
    {
        "manufacturer_name": "Linn",
        "canonical_match_name": "Linn",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "suspended-subchassis",
        "priority_tier": "primary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Linn Sondek LP12 official models Klimax Selekt",
        "notes": "Primary turntable maker overlapping with tonearm coverage.",
    },
    {
        "manufacturer_name": "Micro Seiki",
        "canonical_match_name": "Micro Seiki",
        "manufacturer_type": "legacy-audio-brand",
        "coverage_focus": "historic-high-end-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Micro Seiki turntable historical models SX RX DQX",
        "notes": "Historic high-end turntable maker seed.",
    },
    {
        "manufacturer_name": "Michell",
        "canonical_match_name": "Michell",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "suspended-belt-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Michell turntable official models GyroDec Orbe",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Nottingham Analogue",
        "canonical_match_name": "Nottingham Analogue",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "belt-drive-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "turntable-seed",
        "search_terms": "Nottingham Analogue turntable official models Dais Space Deck",
        "notes": "Turntable specialist seed.",
    },
    {
        "manufacturer_name": "Oracle",
        "canonical_match_name": "Oracle",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "suspended-belt-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "turntable-seed",
        "search_terms": "Oracle Delphi official turntable models",
        "notes": "Turntable specialist seed.",
    },
    {
        "manufacturer_name": "Pear Audio",
        "canonical_match_name": "Pear Audio",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "belt-drive-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Pear Audio turntable official models Kid Thomas Odar",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Pioneer",
        "canonical_match_name": "Pioneer",
        "manufacturer_type": "legacy-audio-brand",
        "coverage_focus": "historic-direct-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "turntable-seed",
        "search_terms": "Pioneer turntable historical PL official",
        "notes": "Historic turntable maker seed.",
    },
    {
        "manufacturer_name": "Pro-Ject",
        "canonical_match_name": "Pro-Ject",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "modern-belt-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "turntable-seed",
        "search_terms": "Pro-Ject turntable official models Xtension Signature",
        "notes": "Major modern turntable maker seed.",
    },
    {
        "manufacturer_name": "Rega",
        "canonical_match_name": "Rega",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "rigid-lightweight-belt-drive",
        "priority_tier": "primary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Rega turntable official models Planar 8 10 Naia",
        "notes": "Primary turntable maker overlapping with tonearm coverage.",
    },
    {
        "manufacturer_name": "SME",
        "canonical_match_name": "SME",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "statement-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "turntable-seed",
        "search_terms": "SME turntable official models 15 20 30",
        "notes": "Turntable specialist seed.",
    },
    {
        "manufacturer_name": "Sony",
        "canonical_match_name": "Sony",
        "manufacturer_type": "legacy-audio-brand",
        "coverage_focus": "historic-direct-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Sony turntable historical PS official",
        "notes": "Historic turntable maker seed.",
    },
    {
        "manufacturer_name": "Technics",
        "canonical_match_name": "Technics",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "direct-drive-turntables",
        "priority_tier": "primary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Technics turntable official models SL-1200G SP-10R",
        "notes": "Primary turntable maker overlapping with tonearm coverage.",
    },
    {
        "manufacturer_name": "Thorens",
        "canonical_match_name": "Thorens",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "historic-and-modern-turntables",
        "priority_tier": "primary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Thorens turntable official models TD124 TD1600 TD124DD",
        "notes": "Primary turntable maker overlapping with tonearm coverage.",
    },
    {
        "manufacturer_name": "TW-Acustic",
        "canonical_match_name": "TW-Acustic",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "high-end-belt-drive",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "TW-Acustic turntable official models Raven",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "VPI",
        "canonical_match_name": "VPI",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "american-belt-drive",
        "priority_tier": "primary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "VPI turntable official models Prime Avenger Classic",
        "notes": "Primary turntable maker overlapping with tonearm coverage.",
    },
    {
        "manufacturer_name": "Well Tempered Lab",
        "canonical_match_name": "Well Tempered Lab",
        "manufacturer_type": "turntable-specialist",
        "coverage_focus": "belt-drive-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Well Tempered Lab turntable official Amadeus Versalex",
        "notes": "Turntable manufacturer seeded from overlapping tonearm coverage.",
    },
    {
        "manufacturer_name": "Yamaha",
        "canonical_match_name": "Yamaha",
        "manufacturer_type": "legacy-audio-brand",
        "coverage_focus": "historic-turntables",
        "priority_tier": "secondary",
        "status": "queued",
        "discovery_source": "tonearm-manufacturer-reuse",
        "search_terms": "Yamaha turntable historical GT official",
        "notes": "Historic turntable maker seed.",
    },
]


DEFAULT_TURNTABLE_TARGETS: list[dict[str, str]] = [
    {"manufacturer_name": "Acoustic Signature", "model_name": "Invictus NEO", "target_group": "Invictus", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Flagship Acoustic Signature table target."},
    {"manufacturer_name": "Acoustic Signature", "model_name": "Maximus NEO", "target_group": "Maximus", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Compact Acoustic Signature NEO-series target."},
    {"manufacturer_name": "Audio Note", "model_name": "TT-Three", "target_group": "TT", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Current Audio Note higher-tier turntable target."},
    {"manufacturer_name": "Basis Audio", "model_name": "Debut V", "target_group": "Debut", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official page / catalog", "notes": "Basis flagship turntable target."},
    {"manufacturer_name": "Brinkmann", "model_name": "Bardo", "target_group": "Bardo", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Brinkmann direct-drive turntable target."},
    {"manufacturer_name": "Clearaudio", "model_name": "Innovation", "target_group": "Innovation", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Clearaudio reference-line turntable target."},
    {"manufacturer_name": "Clearaudio", "model_name": "Ovation", "target_group": "Ovation", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Clearaudio performance-line turntable target."},
    {"manufacturer_name": "Denon", "model_name": "DP-3000NE", "target_group": "DP", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Current Denon flagship direct-drive turntable target."},
    {"manufacturer_name": "Dr. Feickert", "model_name": "Blackbird", "target_group": "Bird", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Dr. Feickert classic high-end turntable target."},
    {"manufacturer_name": "Dual", "model_name": "CS 618Q", "target_group": "CS", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Current Dual direct-drive turntable target."},
    {"manufacturer_name": "Gold Note", "model_name": "Mediterraneo", "target_group": "Mediterraneo", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Gold Note reference wood-plinth table target."},
    {"manufacturer_name": "Goldmund", "model_name": "Reference", "target_group": "Reference", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "archival official page", "notes": "Historic Goldmund statement turntable target."},
    {"manufacturer_name": "Garrard", "model_name": "301", "target_group": "301/401", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "historical documentation", "notes": "Historic Garrard idler-drive turntable target."},
    {"manufacturer_name": "Kuzma", "model_name": "Stabi R", "target_group": "Stabi", "target_type": "turntable", "priority_tier": "primary", "status": "queued", "source_hint": "official product page", "notes": "Flagship Kuzma turntable target."},
    {"manufacturer_name": "Linn", "model_name": "Sondek LP12 Klimax", "target_group": "LP12", "target_type": "turntable", "priority_tier": "primary", "status": "queued", "source_hint": "official product page", "notes": "Flagship Linn LP12 target."},
    {"manufacturer_name": "Linn", "model_name": "Selekt LP12", "target_group": "LP12", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Upper-mid Linn LP12 package target."},
    {"manufacturer_name": "Micro Seiki", "model_name": "SX-8000 II", "target_group": "SX", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "archival brochure / manual", "notes": "Historic Micro Seiki statement table target."},
    {"manufacturer_name": "Michell", "model_name": "GyroDec", "target_group": "Gyro", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Michell signature suspended table target."},
    {"manufacturer_name": "Nottingham Analogue", "model_name": "Space Deck", "target_group": "Space Deck", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "dealer manual / official manual mirror", "notes": "Classic Nottingham Analogue suspended turntable target."},
    {"manufacturer_name": "Oracle", "model_name": "Delphi MKVI", "target_group": "Delphi", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Oracle flagship suspended turntable target."},
    {"manufacturer_name": "Pear Audio", "model_name": "Kid Thomas", "target_group": "Kid", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Pear Audio entry-level turntable target."},
    {"manufacturer_name": "Pioneer", "model_name": "PLX-1000", "target_group": "PLX", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Current Pioneer DJ direct-drive turntable target."},
    {"manufacturer_name": "Pro-Ject", "model_name": "Xtension 12 Evolution", "target_group": "Xtension", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Pro-Ject high-end turntable target."},
    {"manufacturer_name": "Pro-Ject", "model_name": "Debut PRO S Balanced", "target_group": "Debut PRO", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Modern Pro-Ject balanced-output turntable target."},
    {"manufacturer_name": "Rega", "model_name": "Planar 10", "target_group": "Planar", "target_type": "turntable", "priority_tier": "primary", "status": "queued", "source_hint": "official product page", "notes": "Current Rega reference turntable target."},
    {"manufacturer_name": "Rega", "model_name": "Planar 8", "target_group": "Planar", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Upper-tier Rega skeletal turntable target."},
    {"manufacturer_name": "SME", "model_name": "Model 20/3", "target_group": "Model 20", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "SME compact suspended turntable target."},
    {"manufacturer_name": "SME", "model_name": "Model 15", "target_group": "Model 15", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Compact SME suspended turntable target."},
    {"manufacturer_name": "Sony", "model_name": "PS-LX310BT", "target_group": "PS", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Current Sony wireless turntable target."},
    {"manufacturer_name": "Technics", "model_name": "SL-1200G", "target_group": "SL-1200", "target_type": "turntable", "priority_tier": "primary", "status": "queued", "source_hint": "official product page", "notes": "Current Technics flagship-core direct-drive target."},
    {"manufacturer_name": "Technics", "model_name": "SP-10R", "target_group": "SP-10", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Reference Technics motor-unit turntable target."},
    {"manufacturer_name": "Thorens", "model_name": "TD 124 DD", "target_group": "TD 124", "target_type": "turntable", "priority_tier": "primary", "status": "queued", "source_hint": "official product page", "notes": "Current Thorens statement direct-drive target."},
    {"manufacturer_name": "Thorens", "model_name": "TD 1600", "target_group": "TD 1600", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Modern suspended Thorens turntable target."},
    {"manufacturer_name": "TW-Acustic", "model_name": "Raven LS", "target_group": "Raven", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "TW-Acustic Raven-series target."},
    {"manufacturer_name": "VPI", "model_name": "Prime 21", "target_group": "Prime", "target_type": "turntable", "priority_tier": "primary", "status": "queued", "source_hint": "official product page", "notes": "Current VPI Prime-series target."},
    {"manufacturer_name": "VPI", "model_name": "Avenger", "target_group": "Avenger", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Multi-arm VPI reference-series target."},
    {"manufacturer_name": "Well Tempered Lab", "model_name": "Amadeus", "target_group": "Amadeus", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Well Tempered core turntable target."},
    {"manufacturer_name": "Yamaha", "model_name": "GT-5000", "target_group": "GT", "target_type": "turntable", "priority_tier": "secondary", "status": "queued", "source_hint": "official product page", "notes": "Modern Yamaha flagship turntable target."},
]


SCHEMA_SQL = """
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
"""


NON_DERIVED_TARGET_STATUSES = {"superseded"}


def normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    lowered = ascii_text.lower().strip()
    lowered = lowered.replace("&", " and ")
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-+", "-", lowered)
    return lowered.strip("-")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _export_query(conn: sqlite3.Connection, query: str, output_path: Path) -> Path:
    rows = conn.execute(query).fetchall()
    columns = [description[0] for description in conn.execute(query).description]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)
        writer.writerows(rows)
    return output_path


def _write_schema(base_dir: Path) -> Path:
    schema_path = base_dir / "schema.sql"
    schema_path.write_text(SCHEMA_SQL, encoding="utf-8")
    return schema_path


def _write_readme(base_dir: Path, counts: dict[str, int]) -> Path:
    readme_path = base_dir / "README.md"
    readme_path.write_text(
        "\n".join(
            [
                "# Turntable Database",
                "",
                "Generated local turntable database artifacts.",
                "",
                "## Current hydration",
                f"- turntable models: {counts['turntable_models']}",
                f"- feature rows: {counts['turntable_features']}",
                f"- manufacturer research queue rows: {counts['manufacturer_research_queue']}",
                f"- target model queue rows: {counts['turntable_research_targets']}",
                "",
                "## Scope",
                "- Separate DB from tonearms.",
                "- Text-first turntable coverage: manufacturer, model, and feature text.",
                "- Keep queue/audit/export workflow similar to tonearms.",
                "",
                "## Files",
                "- `turntables.db` SQLite working database",
                "- `schema.sql` SQLite schema",
                "- `exports/turntables.csv` flattened preferred export",
                "- `exports/turntable_features.csv` feature-level export",
                "- `exports/manufacturers.csv` manufacturer export",
                "- `exports/turntable_models.csv` model export",
                "- `exports/sources.csv` source export",
                "- `exports/manufacturer_research_queue.csv` manufacturer-first research queue",
                "- `exports/turntable_research_targets.csv` queued model targets by manufacturer",
                "- `exports/manufacturer_research_summary.csv` priority and coverage dashboard",
                "- `exports/model_source_audit.csv` per-model source audit",
                "- `exports/models_needing_source_upgrade.csv` models still lacking official support",
                "- `staging/` staged enrichment CSVs",
                "",
                "## Notes",
                "- Initial seed reuses many manufacturers already covered in the tonearm workflow.",
                "- Feature ingestion is text-first and lighter than the tonearm geometry/spec system.",
                "- Exact-model targets can expand over time without changing the core schema.",
                "- Staged enrichment CSV columns: `manufacturer,model,source_name,source_url,source_type,trust_level,local_snapshot_path,source_notes,model_notes,feature_kind,feature_text,status,confidence,feature_notes`.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    return readme_path


def _upsert_manufacturer(conn: sqlite3.Connection, name: str, now: str) -> int:
    normalized_name = normalize_name(name)
    existing = conn.execute(
        "SELECT manufacturer_id FROM manufacturers WHERE normalized_name = ?",
        (normalized_name,),
    ).fetchone()
    if existing is not None:
        conn.execute(
            "UPDATE manufacturers SET name = ? WHERE manufacturer_id = ?",
            (name, int(existing[0])),
        )
        return int(existing[0])
    cursor = conn.execute(
        "INSERT INTO manufacturers(name, normalized_name, created_at) VALUES (?, ?, ?)",
        (name, normalized_name, now),
    )
    return int(cursor.lastrowid)


def _upsert_model(conn: sqlite3.Connection, manufacturer_id: int, model_name: str, notes: str | None, now: str) -> int:
    normalized_model_name = normalize_name(model_name)
    existing = conn.execute(
        "SELECT turntable_model_id FROM turntable_models WHERE manufacturer_id = ? AND normalized_model_name = ?",
        (manufacturer_id, normalized_model_name),
    ).fetchone()
    display_name = model_name
    if existing is not None:
        conn.execute(
            """
            UPDATE turntable_models
            SET model_name = ?, display_name = ?, notes = COALESCE(?, notes)
            WHERE turntable_model_id = ?
            """,
            (model_name, display_name, notes, int(existing[0])),
        )
        return int(existing[0])
    cursor = conn.execute(
        """
        INSERT INTO turntable_models(
            manufacturer_id, model_name, normalized_model_name, display_name, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (manufacturer_id, model_name, normalized_model_name, display_name, notes, now),
    )
    return int(cursor.lastrowid)


def _insert_source(
    conn: sqlite3.Connection,
    *,
    source_name: str,
    source_url: str,
    source_type: str,
    trust_level: str,
    retrieved_at: str,
    local_snapshot_path: str | None,
    notes: str | None,
) -> int:
    existing = conn.execute(
        "SELECT source_id FROM sources WHERE source_url = ? AND retrieved_at = ?",
        (source_url, retrieved_at),
    ).fetchone()
    if existing is not None:
        return int(existing[0])
    cursor = conn.execute(
        """
        INSERT INTO sources(
            source_name, source_url, source_type, trust_level, retrieved_at, local_snapshot_path, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (source_name, source_url, source_type, trust_level, retrieved_at, local_snapshot_path, notes),
    )
    return int(cursor.lastrowid)


def _insert_feature(
    conn: sqlite3.Connection,
    *,
    model_id: int,
    source_id: int,
    feature_kind: str,
    feature_text: str,
    status: str,
    confidence: float | None,
    notes: str | None,
    created_at: str,
) -> int:
    cursor = conn.execute(
        """
        INSERT INTO turntable_features(
            turntable_model_id, source_id, feature_kind, normalized_feature_kind, feature_text,
            status, confidence, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            model_id,
            source_id,
            feature_kind,
            normalize_name(feature_kind),
            feature_text,
            status,
            confidence,
            notes,
            created_at,
        ),
    )
    return int(cursor.lastrowid)


def _upsert_manufacturer_queue_seed(conn: sqlite3.Connection, seed: dict[str, str], now: str) -> None:
    normalized_name = normalize_name(seed["manufacturer_name"])
    canonical_name = seed["canonical_match_name"]
    canonical_row = conn.execute(
        "SELECT manufacturer_id FROM manufacturers WHERE normalized_name = ?",
        (normalize_name(canonical_name),),
    ).fetchone()
    canonical_manufacturer_id = None if canonical_row is None else int(canonical_row[0])

    existing = conn.execute(
        "SELECT manufacturer_queue_id FROM manufacturer_research_queue WHERE normalized_name = ?",
        (normalized_name,),
    ).fetchone()
    values = (
        seed["manufacturer_name"],
        normalized_name,
        canonical_name,
        canonical_manufacturer_id,
        seed["manufacturer_type"],
        seed["coverage_focus"],
        seed["priority_tier"],
        seed["status"],
        seed.get("discovery_source"),
        seed.get("search_terms"),
        seed.get("notes"),
        now,
        now,
    )
    if existing is None:
        conn.execute(
            """
            INSERT INTO manufacturer_research_queue(
                manufacturer_name, normalized_name, canonical_match_name, canonical_manufacturer_id,
                manufacturer_type, coverage_focus, priority_tier, status, discovery_source,
                search_terms, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values,
        )
        return

    conn.execute(
        """
        UPDATE manufacturer_research_queue
        SET manufacturer_name = ?,
            canonical_match_name = ?,
            canonical_manufacturer_id = ?,
            manufacturer_type = ?,
            coverage_focus = ?,
            priority_tier = ?,
            status = ?,
            discovery_source = ?,
            search_terms = ?,
            notes = ?,
            updated_at = ?
        WHERE manufacturer_queue_id = ?
        """,
        (
            seed["manufacturer_name"],
            canonical_name,
            canonical_manufacturer_id,
            seed["manufacturer_type"],
            seed["coverage_focus"],
            seed["priority_tier"],
            seed["status"],
            seed.get("discovery_source"),
            seed.get("search_terms"),
            seed.get("notes"),
            now,
            int(existing[0]),
        ),
    )


def _upsert_turntable_research_target_seed(conn: sqlite3.Connection, seed: dict[str, str], now: str) -> None:
    queue_row = conn.execute(
        "SELECT manufacturer_queue_id FROM manufacturer_research_queue WHERE normalized_name = ?",
        (normalize_name(seed["manufacturer_name"]),),
    ).fetchone()
    if queue_row is None:
        return
    manufacturer_queue_id = int(queue_row[0])
    normalized_model_name = normalize_name(seed["model_name"])
    existing = conn.execute(
        "SELECT target_id FROM turntable_research_targets WHERE manufacturer_queue_id = ? AND normalized_model_name = ?",
        (manufacturer_queue_id, normalized_model_name),
    ).fetchone()
    if existing is None:
        conn.execute(
            """
            INSERT INTO turntable_research_targets(
                manufacturer_queue_id, model_name, normalized_model_name, target_group, target_type,
                priority_tier, status, source_hint, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                manufacturer_queue_id,
                seed["model_name"],
                normalized_model_name,
                seed.get("target_group"),
                seed["target_type"],
                seed["priority_tier"],
                seed["status"],
                seed.get("source_hint"),
                seed.get("notes"),
                now,
                now,
            ),
        )
        return

    conn.execute(
        """
        UPDATE turntable_research_targets
        SET model_name = ?,
            target_group = ?,
            target_type = ?,
            priority_tier = ?,
            status = ?,
            source_hint = ?,
            notes = ?,
            updated_at = ?
        WHERE target_id = ?
        """,
        (
            seed["model_name"],
            seed.get("target_group"),
            seed["target_type"],
            seed["priority_tier"],
            seed["status"],
            seed.get("source_hint"),
            seed.get("notes"),
            now,
            int(existing[0]),
        ),
    )


def _refresh_target_hydration_statuses(conn: sqlite3.Connection, now: str) -> None:
    rows = conn.execute(
        """
        SELECT
            trt.target_id,
            trt.status,
            trt.normalized_model_name,
            mrq.canonical_manufacturer_id
        FROM turntable_research_targets trt
        JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
        ORDER BY trt.target_id
        """
    ).fetchall()
    for target_id, status, normalized_model_name, canonical_manufacturer_id in rows:
        if status in NON_DERIVED_TARGET_STATUSES or canonical_manufacturer_id is None:
            continue
        matched = conn.execute(
            """
            SELECT 1
            FROM turntable_models
            WHERE manufacturer_id = ? AND normalized_model_name = ?
            LIMIT 1
            """,
            (int(canonical_manufacturer_id), normalized_model_name),
        ).fetchone()
        derived_status = "hydrated" if matched is not None else "queued"
        if derived_status != status:
            conn.execute(
                "UPDATE turntable_research_targets SET status = ?, updated_at = ? WHERE target_id = ?",
                (derived_status, now, int(target_id)),
            )


def _refresh_manufacturer_hydration_statuses(conn: sqlite3.Connection, now: str) -> None:
    rows = conn.execute(
        "SELECT manufacturer_queue_id, priority_tier, status FROM manufacturer_research_queue ORDER BY manufacturer_queue_id"
    ).fetchall()
    for queue_id, priority_tier, status in rows:
        counts = conn.execute(
            """
            SELECT
                COUNT(*) AS active_targets,
                SUM(CASE WHEN status = 'hydrated' THEN 1 ELSE 0 END) AS hydrated_targets
            FROM turntable_research_targets
            WHERE manufacturer_queue_id = ?
              AND status IN ('queued', 'hydrated')
            """,
            (int(queue_id),),
        ).fetchone()
        if counts is None:
            continue
        active_targets = int(counts[0] or 0)
        hydrated_targets = int(counts[1] or 0)
        if active_targets == 0:
            derived_status = status if status != "hydrated-partial" else "queued"
        elif hydrated_targets == 0:
            derived_status = "queued"
        elif hydrated_targets == active_targets:
            derived_status = "hydrated"
        else:
            derived_status = "hydrated-partial"
        if derived_status != status:
            conn.execute(
                "UPDATE manufacturer_research_queue SET status = ?, updated_at = ? WHERE manufacturer_queue_id = ?",
                (derived_status, now, int(queue_id)),
            )


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        "turntable_models": int(conn.execute("SELECT COUNT(*) FROM turntable_models").fetchone()[0]),
        "turntable_features": int(conn.execute("SELECT COUNT(*) FROM turntable_features").fetchone()[0]),
        "manufacturer_research_queue": int(conn.execute("SELECT COUNT(*) FROM manufacturer_research_queue").fetchone()[0]),
        "turntable_research_targets": int(conn.execute("SELECT COUNT(*) FROM turntable_research_targets").fetchone()[0]),
    }


def export_database(base_dir: Path) -> dict[str, Path]:
    db_path = base_dir / "turntables.db"
    export_dir = base_dir / "exports"
    conn = _connect(db_path)
    try:
        outputs: dict[str, Path] = {}
        outputs["manufacturers_csv"] = _export_query(
            conn,
            "SELECT manufacturer_id, name, normalized_name, created_at FROM manufacturers ORDER BY name",
            export_dir / "manufacturers.csv",
        )
        outputs["turntable_models_csv"] = _export_query(
            conn,
            """
            SELECT
                tm.turntable_model_id,
                m.name AS manufacturer,
                tm.model_name,
                tm.normalized_model_name,
                tm.display_name,
                tm.notes,
                tm.created_at
            FROM turntable_models tm
            JOIN manufacturers m ON m.manufacturer_id = tm.manufacturer_id
            ORDER BY m.name, tm.model_name
            """,
            export_dir / "turntable_models.csv",
        )
        outputs["sources_csv"] = _export_query(
            conn,
            "SELECT source_id, source_name, source_url, source_type, trust_level, retrieved_at, local_snapshot_path, notes FROM sources ORDER BY source_id",
            export_dir / "sources.csv",
        )
        outputs["turntable_features_csv"] = _export_query(
            conn,
            """
            SELECT
                tf.turntable_feature_id,
                m.name AS manufacturer,
                tm.model_name,
                tf.feature_kind,
                tf.feature_text,
                tf.status,
                tf.confidence,
                tf.notes AS feature_notes,
                s.source_name,
                s.source_url,
                s.source_type,
                s.trust_level,
                s.local_snapshot_path
            FROM turntable_features tf
            JOIN turntable_models tm ON tm.turntable_model_id = tf.turntable_model_id
            JOIN manufacturers m ON m.manufacturer_id = tm.manufacturer_id
            JOIN sources s ON s.source_id = tf.source_id
            ORDER BY m.name, tm.model_name, tf.turntable_feature_id
            """,
            export_dir / "turntable_features.csv",
        )
        outputs["turntables_csv"] = _export_query(
            conn,
            """
            SELECT
                m.name AS manufacturer,
                tm.model_name,
                COALESCE(
                    GROUP_CONCAT(DISTINCT tf.feature_text),
                    ''
                ) AS feature_text,
                COALESCE(GROUP_CONCAT(DISTINCT s.source_name), '') AS sources
            FROM turntable_models tm
            JOIN manufacturers m ON m.manufacturer_id = tm.manufacturer_id
            LEFT JOIN turntable_features tf ON tf.turntable_model_id = tm.turntable_model_id
            LEFT JOIN sources s ON s.source_id = tf.source_id
            GROUP BY tm.turntable_model_id, m.name, tm.model_name
            ORDER BY m.name, tm.model_name
            """,
            export_dir / "turntables.csv",
        )
        outputs["manufacturer_research_queue_csv"] = _export_query(
            conn,
            """
            SELECT
                manufacturer_name,
                canonical_match_name,
                manufacturer_type,
                coverage_focus,
                priority_tier,
                status,
                discovery_source,
                search_terms,
                notes
            FROM manufacturer_research_queue
            ORDER BY priority_tier, manufacturer_name
            """,
            export_dir / "manufacturer_research_queue.csv",
        )
        outputs["turntable_research_targets_csv"] = _export_query(
            conn,
            """
            SELECT
                mrq.manufacturer_name,
                trt.model_name,
                trt.target_group,
                trt.target_type,
                trt.priority_tier,
                trt.status,
                trt.source_hint,
                trt.notes
            FROM turntable_research_targets trt
            JOIN manufacturer_research_queue mrq ON mrq.manufacturer_queue_id = trt.manufacturer_queue_id
            ORDER BY mrq.manufacturer_name, trt.model_name
            """,
            export_dir / "turntable_research_targets.csv",
        )
        outputs["manufacturer_research_summary_csv"] = _export_query(
            conn,
            """
            SELECT
                mrq.manufacturer_name,
                mrq.canonical_match_name AS canonical_db_manufacturer,
                mrq.manufacturer_type,
                mrq.coverage_focus,
                mrq.priority_tier,
                mrq.status,
                COALESCE(COUNT(DISTINCT tm.turntable_model_id), 0) AS current_db_model_count,
                COALESCE(COUNT(DISTINCT trt.target_id), 0) AS target_model_count,
                mrq.discovery_source,
                mrq.search_terms,
                mrq.notes
            FROM manufacturer_research_queue mrq
            LEFT JOIN turntable_models tm ON tm.manufacturer_id = mrq.canonical_manufacturer_id
            LEFT JOIN turntable_research_targets trt ON trt.manufacturer_queue_id = mrq.manufacturer_queue_id
            GROUP BY mrq.manufacturer_queue_id
            ORDER BY mrq.priority_tier, mrq.manufacturer_name
            """,
            export_dir / "manufacturer_research_summary.csv",
        )
        outputs["model_source_audit_csv"] = _export_query(
            conn,
            """
            SELECT
                m.name AS manufacturer,
                tm.model_name,
                COUNT(DISTINCT s.source_id) AS source_count,
                GROUP_CONCAT(DISTINCT s.trust_level) AS trust_levels,
                GROUP_CONCAT(DISTINCT s.source_type) AS source_types,
                MAX(CASE WHEN s.trust_level = 'official' THEN 1 ELSE 0 END) AS has_official_source,
                MAX(CASE WHEN s.trust_level = 'secondary' THEN 1 ELSE 0 END) AS has_secondary_source,
                MAX(CASE WHEN s.source_type = 'dealer_page' THEN 1 ELSE 0 END) AS has_dealer_source,
                MAX(CASE WHEN s.source_type = 'review' THEN 1 ELSE 0 END) AS has_review_source,
                MAX(CASE WHEN s.source_type = 'manual_mirror' THEN 1 ELSE 0 END) AS has_manual_mirror_source,
                CASE
                    WHEN MAX(CASE WHEN s.trust_level = 'official' THEN 1 ELSE 0 END) = 0
                     AND MAX(CASE WHEN s.trust_level = 'secondary' THEN 1 ELSE 0 END) = 1
                    THEN 1 ELSE 0
                END AS relies_on_secondary_only,
                CASE
                    WHEN MAX(CASE WHEN s.trust_level = 'official' THEN 1 ELSE 0 END) = 0
                    THEN 1 ELSE 0
                END AS needs_official_followup
            FROM turntable_models tm
            JOIN manufacturers m ON m.manufacturer_id = tm.manufacturer_id
            LEFT JOIN turntable_features tf ON tf.turntable_model_id = tm.turntable_model_id
            LEFT JOIN sources s ON s.source_id = tf.source_id
            GROUP BY tm.turntable_model_id, m.name, tm.model_name
            ORDER BY m.name, tm.model_name
            """,
            export_dir / "model_source_audit.csv",
        )
        outputs["models_needing_source_upgrade_csv"] = _export_query(
            conn,
            """
            SELECT
                manufacturer,
                model_name,
                source_count,
                trust_levels,
                source_types,
                has_dealer_source,
                has_review_source,
                has_manual_mirror_source,
                relies_on_secondary_only,
                needs_official_followup
            FROM (
                SELECT
                    m.name AS manufacturer,
                    tm.model_name,
                    COUNT(DISTINCT s.source_id) AS source_count,
                    GROUP_CONCAT(DISTINCT s.trust_level) AS trust_levels,
                    GROUP_CONCAT(DISTINCT s.source_type) AS source_types,
                    MAX(CASE WHEN s.trust_level = 'official' THEN 1 ELSE 0 END) AS has_official_source,
                    MAX(CASE WHEN s.source_type = 'dealer_page' THEN 1 ELSE 0 END) AS has_dealer_source,
                    MAX(CASE WHEN s.source_type = 'review' THEN 1 ELSE 0 END) AS has_review_source,
                    MAX(CASE WHEN s.source_type = 'manual_mirror' THEN 1 ELSE 0 END) AS has_manual_mirror_source,
                    CASE
                        WHEN MAX(CASE WHEN s.trust_level = 'official' THEN 1 ELSE 0 END) = 0
                         AND MAX(CASE WHEN s.trust_level = 'secondary' THEN 1 ELSE 0 END) = 1
                        THEN 1 ELSE 0
                    END AS relies_on_secondary_only,
                    CASE
                        WHEN MAX(CASE WHEN s.trust_level = 'official' THEN 1 ELSE 0 END) = 0
                        THEN 1 ELSE 0
                    END AS needs_official_followup
                FROM turntable_models tm
                JOIN manufacturers m ON m.manufacturer_id = tm.manufacturer_id
                LEFT JOIN turntable_features tf ON tf.turntable_model_id = tm.turntable_model_id
                LEFT JOIN sources s ON s.source_id = tf.source_id
                GROUP BY tm.turntable_model_id, m.name, tm.model_name
            )
            WHERE needs_official_followup = 1
            ORDER BY manufacturer, model_name
            """,
            export_dir / "models_needing_source_upgrade.csv",
        )
        return outputs
    finally:
        conn.close()


def build_turntable_database(base_dir: Path) -> dict[str, Path]:
    base_dir.mkdir(parents=True, exist_ok=True)
    (base_dir / "exports").mkdir(parents=True, exist_ok=True)
    (base_dir / "staging").mkdir(parents=True, exist_ok=True)
    (base_dir / "sources").mkdir(parents=True, exist_ok=True)
    db_path = base_dir / "turntables.db"
    now = _now()
    conn = _connect(db_path)
    try:
        conn.executescript(SCHEMA_SQL)
        for seed in DEFAULT_TURNTABLE_MANUFACTURER_QUEUE:
            _upsert_manufacturer_queue_seed(conn, seed, now)
        for seed in DEFAULT_TURNTABLE_TARGETS:
            _upsert_turntable_research_target_seed(conn, seed, now)
        _refresh_target_hydration_statuses(conn, now)
        _refresh_manufacturer_hydration_statuses(conn, now)
        conn.commit()
        counts = _counts(conn)
    finally:
        conn.close()

    outputs = export_database(base_dir)
    outputs["schema_sql"] = _write_schema(base_dir)
    outputs["readme_md"] = _write_readme(base_dir, counts)
    outputs["db_path"] = db_path
    return outputs


def sync_turntable_research_queue(base_dir: Path) -> dict[str, Path]:
    build_turntable_database(base_dir)
    db_path = base_dir / "turntables.db"
    now = _now()
    conn = _connect(db_path)
    try:
        conn.executescript(SCHEMA_SQL)
        for seed in DEFAULT_TURNTABLE_MANUFACTURER_QUEUE:
            _upsert_manufacturer_queue_seed(conn, seed, now)
        for seed in DEFAULT_TURNTABLE_TARGETS:
            _upsert_turntable_research_target_seed(conn, seed, now)
        _refresh_target_hydration_statuses(conn, now)
        _refresh_manufacturer_hydration_statuses(conn, now)
        conn.commit()
        counts = _counts(conn)
    finally:
        conn.close()
    outputs = export_database(base_dir)
    outputs["schema_sql"] = _write_schema(base_dir)
    outputs["readme_md"] = _write_readme(base_dir, counts)
    return outputs


def enrich_turntable_database(base_dir: Path, enrichment_csv: Path) -> dict[str, Path]:
    build_turntable_database(base_dir)
    db_path = base_dir / "turntables.db"
    now = _now()
    conn = _connect(db_path)
    try:
        conn.executescript(SCHEMA_SQL)
        with enrichment_csv.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                manufacturer_name = (row.get("manufacturer") or "").strip()
                model_name = (row.get("model") or "").strip()
                source_name = (row.get("source_name") or "").strip()
                source_url = (row.get("source_url") or "").strip()
                source_type = (row.get("source_type") or "").strip() or "unknown"
                trust_level = (row.get("trust_level") or "").strip() or "secondary"
                feature_kind = (row.get("feature_kind") or row.get("feature_name") or "summary").strip() or "summary"
                feature_text = (row.get("feature_text") or row.get("value_text") or "").strip()
                if not manufacturer_name or not model_name or not source_name or not source_url or not feature_text:
                    continue
                manufacturer_id = _upsert_manufacturer(conn, manufacturer_name, now)
                model_id = _upsert_model(conn, manufacturer_id, model_name, (row.get("model_notes") or "").strip() or None, now)
                source_id = _insert_source(
                    conn,
                    source_name=source_name,
                    source_url=source_url,
                    source_type=source_type,
                    trust_level=trust_level,
                    retrieved_at=now,
                    local_snapshot_path=(row.get("local_snapshot_path") or "").strip() or None,
                    notes=(row.get("source_notes") or "").strip() or None,
                )
                confidence_raw = (row.get("confidence") or "").strip()
                confidence = float(confidence_raw) if confidence_raw else None
                _insert_feature(
                    conn,
                    model_id=model_id,
                    source_id=source_id,
                    feature_kind=feature_kind,
                    feature_text=feature_text,
                    status=(row.get("status") or "parsed").strip() or "parsed",
                    confidence=confidence,
                    notes=(row.get("feature_notes") or row.get("notes") or "").strip() or None,
                    created_at=now,
                )
        for seed in DEFAULT_TURNTABLE_MANUFACTURER_QUEUE:
            _upsert_manufacturer_queue_seed(conn, seed, now)
        for seed in DEFAULT_TURNTABLE_TARGETS:
            _upsert_turntable_research_target_seed(conn, seed, now)
        _refresh_target_hydration_statuses(conn, now)
        _refresh_manufacturer_hydration_statuses(conn, now)
        conn.commit()
        counts = _counts(conn)
    finally:
        conn.close()
    outputs = export_database(base_dir)
    outputs["schema_sql"] = _write_schema(base_dir)
    outputs["readme_md"] = _write_readme(base_dir, counts)
    return outputs
