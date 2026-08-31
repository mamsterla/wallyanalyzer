-- A client retry may reuse an idempotency key only for the exact same selected files.
alter table sample_upload_batches
  add column request_fingerprint text not null default '';

-- Existing batches predate request fingerprints and are terminally safe to retain.
alter table sample_upload_batches
  alter column request_fingerprint drop default;
