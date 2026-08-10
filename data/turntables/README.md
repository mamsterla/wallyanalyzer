# Turntable Database

Generated local turntable database artifacts.

## Current hydration
- turntable models: 38
- feature rows: 76
- manufacturer research queue rows: 29
- target model queue rows: 38

## Scope
- Separate DB from tonearms.
- Text-first turntable coverage: manufacturer, model, and feature text.
- Keep queue/audit/export workflow similar to tonearms.

## Files
- `turntables.db` SQLite working database
- `schema.sql` SQLite schema
- `exports/turntables.csv` flattened preferred export
- `exports/turntable_features.csv` feature-level export
- `exports/manufacturers.csv` manufacturer export
- `exports/turntable_models.csv` model export
- `exports/sources.csv` source export
- `exports/manufacturer_research_queue.csv` manufacturer-first research queue
- `exports/turntable_research_targets.csv` queued model targets by manufacturer
- `exports/manufacturer_research_summary.csv` priority and coverage dashboard
- `exports/model_source_audit.csv` per-model source audit
- `exports/models_needing_source_upgrade.csv` models still lacking official support
- `staging/` staged enrichment CSVs

## Notes
- Initial seed reuses many manufacturers already covered in the tonearm workflow.
- Feature ingestion is text-first and lighter than the tonearm geometry/spec system.
- Exact-model targets can expand over time without changing the core schema.
- Staged enrichment CSV columns: `manufacturer,model,source_name,source_url,source_type,trust_level,local_snapshot_path,source_notes,model_notes,feature_kind,feature_text,status,confidence,feature_notes`.
