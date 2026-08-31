-- Customers and dealers may retain multiple active unit assignments. A unit remains
-- exclusive because psiu_assignments_one_active_unit_idx is intentionally retained.
drop index if exists psiu_assignments_one_active_user_idx;

alter table sample_upload_batches
  add column source text not null default 'manual_file',
  add column observed_psiu_uid text;
alter table sample_upload_batches
  add constraint sample_upload_batches_source_check check (source in ('manual_file', 'psiu_capture')),
  add constraint sample_upload_batches_psiu_capture_uid_check check (source <> 'psiu_capture' or observed_psiu_uid is not null);
alter table sample_upload_batches
  alter column source drop default;

-- Sample-level copies make each listed artifact independently attributable without
-- requiring a mutable join to its upload batch.
alter table samples
  add column source text not null default 'manual_file',
  add column observed_psiu_uid text;
alter table samples
  add constraint samples_source_check check (source in ('manual_file', 'psiu_capture')),
  add constraint samples_psiu_capture_uid_check check (source <> 'psiu_capture' or observed_psiu_uid is not null);
alter table samples
  alter column source drop default;
