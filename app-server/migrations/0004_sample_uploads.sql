-- Upload intents are durable before a browser receives a presigned S3 URL. S3 remains
-- the artifact authority; Postgres stores tenant-scoped provenance and lifecycle only.
create type sample_upload_state as enum ('intent', 'uploaded', 'failed');

do $$
begin
  if exists (select 1 from samples) then
    raise exception 'Cannot apply 0004: existing samples require operator provenance backfill.';
  end if;
end;
$$;

create table sample_upload_batches (
  id uuid primary key,
  owner_id uuid not null references users(id),
  psiu_unit_id uuid not null references psiu_units(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

alter table samples add column upload_batch_id uuid references sample_upload_batches(id);
alter table samples add column psiu_unit_id uuid references psiu_units(id);
alter table samples add column upload_state sample_upload_state not null default 'uploaded';
alter table samples add column uploaded_at timestamptz;
alter table samples add column verified_at timestamptz;

update samples set upload_state='uploaded', uploaded_at=created_at, verified_at=created_at;
alter table samples alter column upload_batch_id set not null;
alter table samples alter column psiu_unit_id set not null;
alter table samples alter column upload_state drop default;

create index samples_owner_upload_created_idx on samples(owner_id, created_at desc);
create index samples_batch_idx on samples(upload_batch_id);
