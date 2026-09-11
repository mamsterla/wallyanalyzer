-- Durable, owner-scoped report requests and immutable artifacts.
create table report_definitions (
  id uuid primary key,
  key text not null unique,
  display_name text not null,
  algorithm_version text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table report_presets (
  id uuid primary key,
  definition_id uuid not null references report_definitions(id),
  key text not null,
  display_name text not null,
  version text not null,
  enabled boolean not null default true,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(definition_id,key,version)
);
create table report_requests (
  id uuid primary key,
  owner_id uuid not null references users(id),
  upload_batch_id uuid not null references sample_upload_batches(id),
  idempotency_key text not null,
  request_fingerprint text not null,
  system_snapshot jsonb not null,
  user_metadata_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(owner_id,idempotency_key)
);
create table analysis_reports (
  id uuid primary key,
  request_id uuid not null references report_requests(id),
  definition_id uuid not null references report_definitions(id),
  preset_id uuid not null references report_presets(id),
  algorithm_version text not null,
  status text not null check(status in ('queued','running','completed','failed','cancelled')),
  parameter_provenance jsonb not null,
  execution_arn text,
  failure_code text,
  failure_detail_safe text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique(request_id,definition_id,preset_id)
);
create table analysis_report_inputs (
  report_id uuid not null references analysis_reports(id) on delete cascade,
  sample_id uuid not null references samples(id),
  input_ordinal integer not null check(input_ordinal >= 0),
  primary key(report_id,sample_id),
  unique(report_id,input_ordinal)
);
create table report_artifacts (
  id uuid primary key,
  report_id uuid not null references analysis_reports(id) on delete cascade,
  kind text not null check(kind in ('manifest','metrics_json','graph_svg','report_pdf')),
  object_key text not null,
  content_type text not null,
  byte_length bigint not null check(byte_length >= 0),
  checksum_sha256 text not null,
  created_at timestamptz not null default now(),
  unique(report_id,kind)
);
create table report_outbox (
  id uuid primary key,
  report_request_id uuid not null references report_requests(id) on delete cascade,
  event_type text not null check(event_type='report.requested'),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts >= 0),
  processed_at timestamptz,
  last_error_safe text,
  created_at timestamptz not null default now(),
  unique(report_request_id,event_type)
);
create index analysis_reports_request_created_idx on analysis_reports(request_id,created_at desc,id desc);
create index report_requests_owner_created_idx on report_requests(owner_id,created_at desc,id desc);
create index report_outbox_dispatch_idx on report_outbox(processed_at,available_at);

insert into report_definitions(id,key,display_name,algorithm_version,enabled)
values ('10000000-0000-4000-8000-000000000001','tracking-error','Tracking Error','1.0.0',true);
insert into report_presets(id,definition_id,key,display_name,version,enabled,snapshot)
values ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','rti-test-1-track-1-side-a','RTI Test 1 Track 1 Side A','1',true,
'{"testTrack":{"name":"RTI Test 1 Track 1 Side A","outerRadiusMm":144.5,"innerRadiusMm":58.5},"fixedDemoAcquisition":{"digitizer":"Cosmos","effectiveLengthMm":245,"offsetAngleDeg":22.42,"overhangMm":16.9,"cantileverYawDeg":0,"stylusYawDeg":-0.2,"actualPivotToSpindleMm":228.1},"notice":"Demonstration preset assumptions are used; future reports may resolve parameters from the saved system."}'::jsonb);
