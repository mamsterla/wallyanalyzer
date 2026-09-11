# Report Processing Plan

## Goal

Turn an accepted private WAV sample into durable report records and private report artifacts. The first report demonstrates the existing Python implementation under `src/wallyanalyzer`; it does not introduce report products or credit debits.

## Principles

- Raw WAVs and report artifacts stay private in S3.
- Postgres stores transactional state, ownership, algorithm version, input/provenance snapshots, failures, and artifact metadata.
- Backend authorization remains authoritative. A user can access only reports for owned samples; admins may use the existing admin scope.
- Every run is idempotent and reproducible from immutable inputs.
- Do not trigger processing from an unauthenticated browser or grant processors broad bucket access.
- Report product selection and credit `usage` entries are deferred until products exist.

## Proposed Architecture

```text
Accepted sample upload
  -> durable Postgres report-job row + outbox event
  -> dispatcher
  -> Step Functions Standard execution
  -> validate/preflight Lambda
  -> Python report worker (container-image Lambda for demo)
  -> private report JSON/HTML/PDF artifacts in S3
  -> finalize Lambda writes report status/artifact provenance to Postgres
```

Use Step Functions Standard for execution history, retries, explicit transitions, and future fan-out across report products.

### Worker choice

Start with an image-based Lambda containing the selected `src/wallyanalyzer` report code and pinned Python dependencies.

Move an algorithm to ECS Fargate when any applies:

- execution can exceed Lambda's 15-minute limit;
- native/scientific dependencies or image size become impractical;
- memory or ephemeral storage needs exceed Lambda limits;
- a report needs long-running multi-file processing.

The Step Functions contract stays unchanged; only the worker state changes from Lambda invoke to ECS `RunTask`.

## Storage

```text
raw/{owner-id}/{sample-id}/...wav                 existing private input
reports/{owner-id}/{sample-id}/{report-id}/
  manifest.json                                   immutable provenance
  result.json                                     structured metrics
  report.html                                     initial human-readable artifact
  report.pdf                                      optional later artifact
```

The manifest includes sample ID, raw object key/version/ETag/checksum, system snapshot, PSIU provenance, algorithm/report version, worker image digest, parameters, timestamps, and artifact checksums.

## Database Model

Add migrations only during implementation.

```text
report_definitions
  id, key, display_name, version, status, input_contract, created_at

analysis_reports
  id, owner_id, sample_id, definition_id, algorithm_version,
  status: queued|running|completed|failed|cancelled,
  requested_at, started_at, completed_at, failure_code, failure_detail_safe,
  execution_arn, request_fingerprint

report_artifacts
  id, report_id, kind, object_key, content_type, byte_length,
  checksum_sha256, created_at

report_outbox
  id, report_id, event_type, available_at, attempts, processed_at, last_error_safe
```

Constraints:

- Unique `(sample_id, definition_id, algorithm_version, request_fingerprint)` for idempotent requests.
- `analysis_reports.owner_id` must match the sample owner.
- Artifacts are append-only after report completion.
- Do not store raw exception stacks, secrets, WAV contents, addresses, or tokens in Postgres/audit metadata.

## Lifecycle

1. Existing upload verification accepts the WAV and records immutable sample metadata.
2. User later selects a report definition. For the demo, an admin/internal action can enqueue one fixed definition.
3. API transaction creates or reuses the idempotent report row and outbox event.
4. Dispatcher starts one Step Functions execution using report ID only.
5. Preflight worker rechecks accepted sample state, ownership/provenance, S3 object existence, WAV bounds, and supported algorithm version.
6. Algorithm worker reads only its exact raw object, writes only its report prefix, and returns artifact metadata.
7. Finalizer transaction marks completed or failed and records artifacts.
8. User receives report summary/status; download uses an owner-authorized short-lived S3 URL.

Retries use bounded exponential backoff. Retry only transient failures. Deterministic input/algorithm failures become durable `failed` reports with safe user-visible messages.

## IAM and Network

- Step Functions may invoke only the named preflight/finalizer/workers.
- Worker role: read exact `raw/*` objects, write exact `reports/*` objects, emit scoped logs/metrics, and no database credentials unless required through a narrowly scoped runtime secret reference.
- Prefer a small report API/finalizer for Postgres updates rather than direct broad database access from workers.
- If a worker needs Postgres, it uses the existing private network/RDS Proxy and Secrets Manager reference at runtime.
- No public bucket, public Lambda URL, browser credentials, or PSIU access from workers.

## API and UI Phases

### Phase 1: demonstration report

- One versioned internal report definition backed by `src/wallyanalyzer`.
- Create/list/get report status APIs.
- Reports page shows accepted upload, report state, algorithm version, and artifact download when completed.
- Admin can observe queued/running/failed jobs.
- No credit debit.

### Phase 2: report catalog and credits

- Product-backed report definitions with display price/credit cost.
- Transactionally reserve/debit credits only when a report request is accepted under an approved policy.
- Ledger entry references report ID and product ID.
- Refund/reversal uses a new immutable ledger entry, never an update/delete.

### Phase 3: scale and operations

- Multiple report definitions/fan-out.
- ECS worker migration where needed.
- DLQ/alerting, operational dashboards, retention policies, algorithm fixtures, and comparison/parity reporting.

## Implementation Acceptance Criteria

- A completed sample produces exactly one idempotent demo report request.
- User cannot read another user's report/artifact or request a report for another user's sample.
- Report manifest fully identifies immutable input, system/PSIU provenance, algorithm version, image digest, and outputs.
- Retrying a transient execution cannot duplicate report artifacts or ledger activity.
- Failed jobs expose safe messages and preserve diagnostic correlation IDs only.
- Tests cover authorization, idempotency, worker input validation, success/failure finalization, and presigned artifact download.
- CDK synth, local algorithm fixture tests, and production-safe deployment validation pass.

## Open Decisions Before Implementation

1. Which `src/wallyanalyzer` algorithm and WAV fixture define the first demo report?
2. What structured result schema and visual report layout should the demo expose?
3. Is HTML sufficient for phase 1, or is PDF required immediately?
4. What timeout, memory, and ephemeral-storage profile does the selected algorithm need?
5. When products arrive, should credits debit at request acceptance, worker start, or successful completion?

## Approved Tracking Error vertical-slice decisions

- First report definition: `tracking-error` / **Tracking Error** / algorithm version `1.0.0`.
- First versioned preset: **RTI Test 1 Track 1 Side A** v1 (144.5 mm to 58.5 mm).
- The initial report uses fixed demonstration acquisition/alignment values from the existing fixture. Artifacts and immutable provenance must state this limitation.
- A report request owns the ordered, fully verified WAV upload batch. One selected definition/preset creates one child analysis report; a future multi-selection request fans out child reports through a bounded Standard Step Functions Map.
- One input produces an individual graph; two or more inputs additionally produce a sweep graph. Artifacts are checksummed manifest, metrics JSON, SVG graph(s), and an SVG-derived PDF.
- Future parameter resolution may use saved System and related user metadata. Preserve separate preset, fixed-demo, system, user-metadata, and user-entered snapshots. Do not copy address or other PII.
- This slice does not debit credits.
