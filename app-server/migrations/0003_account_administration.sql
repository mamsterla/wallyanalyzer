-- Detached customer records are created before a Cognito identity exists.
-- This migration is intentionally preflighted: email is the durable reserved identity
-- and cannot be silently deduplicated without losing customer history.
lock table users, psiu_units, psiu_assignments in share row exclusive mode;

do $$
begin
  if exists (select 1 from users group by email having count(*) > 1) then
    raise exception 'Cannot apply 0003: duplicate users.email values require operator reconciliation before email reservation.';
  end if;
  if exists (select 1 from psiu_assignments where unassigned_at is null group by user_id having count(*) > 1) then
    raise exception 'Cannot apply 0003: multiple active PSIU assignments per customer require operator reconciliation.';
  end if;
end;
$$;

create type customer_lifecycle as enum ('draft', 'ready', 'invited', 'active', 'suspended', 'cancelled');
create type psiu_unit_status as enum ('enabled', 'disabled');
create type cognito_reconciliation_action as enum ('invite_cleanup', 'archive_delete');
create type cognito_reconciliation_status as enum ('pending', 'completed');

alter table users alter column cognito_subject drop not null;
alter table users add column lifecycle customer_lifecycle;
update users set lifecycle = (case account_status
  when 'active' then 'active'
  when 'suspended' then 'suspended'
  when 'cancelled' then 'cancelled'
  else 'invited'
end)::customer_lifecycle;
alter table users alter column lifecycle set not null;
alter table users alter column account_status drop not null;
alter table users alter column account_status drop default;
alter table users add column archived_at timestamptz;
alter table users add constraint users_email_reserved_unique unique (email);

alter table psiu_units add column status psiu_unit_status not null default 'enabled';
alter table psiu_units add column disabled_at timestamptz;
alter table psiu_units add column disabled_by uuid references users(id);
-- Existing 0002 inventory could lack a UID. New enrollment requires one in the API;
-- preserve legacy rows rather than fabricating a firmware identity during migration.
alter table psiu_units add constraint psiu_units_uid_length check (opaque_uid is null or length(opaque_uid) between 1 and 256);
create unique index psiu_assignments_one_active_user_idx on psiu_assignments (user_id) where unassigned_at is null;

-- Durable retry queue for Cognito identities created/deleted outside the database
-- transaction. A successful retry is audited; operations are never silently lost.
create table cognito_reconciliation_jobs (
  id uuid primary key,
  customer_id uuid not null references users(id),
  action cognito_reconciliation_action not null,
  email text not null,
  cognito_subject text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  check (length(email) between 3 and 320)
);
create unique index cognito_reconciliation_pending_action_idx
  on cognito_reconciliation_jobs (customer_id, action) where completed_at is null;
