# Database Metadata Design

## Goal
Replace the Excel workbook with explicit metadata contracts that can be loaded from a database, API, or fixture files.

Core rule:
- numeric algorithms must not know where metadata comes from
- metadata loading must be separated from signal processing and fitting

---

## What the Matlab code needs

The Matlab files do not need a spreadsheet. They need structured metadata.

### Measurement stage needs
Per audio file:
- file name or file stem
- digitizer type
- test track name

Per test track:
- outer radius mm
- inner radius mm

### Compile stage needs
Per measurement file:
- system id
- cartridge name
- mount yaw / cantilever yaw
- stylus yaw
- effective length mm
- offset angle deg
- nominal overhang mm
- required overhang mm
- overhang adjustment mm
- pivot-to-spindle adjustment mm
- actual pivot-to-spindle mm
- comments

Per cartridge:
- LR stylus width estimate um
- optional ZE / WZ / SRA / VTA fields

Per system:
- descriptive labels used for reports

---

## Proposed logical model

### `acquisition_records`
One row per raw audio file or measurement run.

Suggested columns:
- `id`
- `file_stem` unique
- `file_name`
- `recorded_at`
- `digitizer`
- `test_track_name`
- `system_id`
- `cartridge_name`
- `cantilever_yaw_deg`
- `stylus_yaw_deg`
- `effective_length_mm`
- `offset_angle_deg`
- `overhang_mm`
- `required_overhang_mm`
- `overhang_adjustment_mm`
- `pivot_spindle_adjustment_mm`
- `actual_pivot_to_spindle_mm`
- `comments`
- `raw_source_ref`
- `created_at`
- `updated_at`

### `test_tracks`
Suggested columns:
- `id`
- `name` unique
- `outer_radius_mm`
- `inner_radius_mm`
- `notes`

### `cartridges`
Suggested columns:
- `id`
- `cartridge_name` unique
- `lr_um`
- `ze_deg`
- `wally_zenith_deg`
- `sra_deg`
- `vta_deg`
- `notes`

### `systems`
Suggested columns:
- `id`
- `system_code` or numeric id
- `turntable`
- `tonearm`
- `headshell`
- `shim`
- `isolation`
- `notes`

---

## Python-side abstraction

The algorithms should depend on a provider interface, not a database library.

```python
class MetadataProvider(Protocol):
    def get_acquisition(self, file_stem: str) -> AcquisitionRecord: ...
    def get_test_track(self, name: str) -> TestTrackRecord: ...
    def get_cartridge(self, cartridge_name: str) -> CartridgeRecord | None: ...
    def get_system(self, system_id: float | int) -> SystemRecord | None: ...
```

This lets us support:
- Postgres
- DynamoDB
- SQLite
- JSON fixtures
- in-memory test data

without changing math code.

---

## Near-term implementation plan

### Phase 1
Build:
- dataclass schemas
- provider protocol
- in-memory provider for tests
- JSON fixture loader

### Phase 2
Add one real persistence adapter:
- SQLite for local development, or
- Postgres if cloud backend is already known

### Phase 3
Add AWS-facing adapters:
- RDS/Postgres
- DynamoDB if access patterns fit
- S3 for measurement artifacts, not relational metadata

---

## Storage split recommendation

### Database stores
- acquisition metadata
- cartridge metadata
- system metadata
- test track metadata
- job status / processing metadata

### Object storage stores
- raw WAV files
- measurement artifacts
- compile artifacts
- plots or debug bundles

Use S3 for large binary and array artifacts.
Use a database for queryable metadata.

---

## Why this split is better than Excel

Excel in the Matlab code is doing three jobs badly:
- metadata storage
- lookup/join logic
- weak serialization boundary

Database + object storage is cleaner:
- explicit schemas
- indexed lookups
- audit trail
- API-friendly
- easier Lambda integration
- easier test fixtures

---

## First implementation target

Before database work, create Python records and provider interfaces that model the needed metadata exactly.

That gives us:
- stable contracts
- fixture-based testing
- freedom to add a real DB later
