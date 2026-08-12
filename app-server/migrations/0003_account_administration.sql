-- Detached customer records are created before a Cognito identity exists.
create type customer_lifecycle as enum ('draft', 'ready', 'invited', 'active', 'suspended', 'cancelled');
create type psiu_unit_status as enum ('enabled', 'disabled');

alter table users alter column cognito_subject drop not null;
alter table users add column lifecycle customer_lifecycle;
update users set lifecycle = case account_status when 'active' then 'active' when 'suspended' then 'suspended' when 'cancelled' then 'cancelled' else 'invited' end;
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
