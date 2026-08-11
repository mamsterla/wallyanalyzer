-- Identity and fulfillment metadata. Cognito stores credentials; Postgres remains
-- the authority for account status, customer scope, PSIU ownership, and auditing.
create type user_account_status as enum ('provisioned', 'active', 'suspended', 'cancelled');

alter table users
  add column account_status user_account_status not null default 'active',
  add column invited_at timestamptz,
  add column suspended_at timestamptz,
  add column suspended_reason text;

create table psiu_units (
  id uuid primary key,
  serial_number text not null unique,
  opaque_uid text unique,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  check (length(serial_number) between 1 and 128),
  check (opaque_uid is null or length(opaque_uid) between 1 and 256)
);

create table psiu_assignments (
  id uuid primary key,
  psiu_unit_id uuid not null references psiu_units(id),
  user_id uuid not null references users(id),
  assigned_by uuid not null references users(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  unassigned_by uuid references users(id),
  check ((unassigned_at is null) = (unassigned_by is null))
);
create unique index psiu_assignments_one_active_unit_idx on psiu_assignments (psiu_unit_id) where unassigned_at is null;
create index psiu_assignments_active_user_idx on psiu_assignments (user_id, assigned_at desc) where unassigned_at is null;

-- Installers can read only their explicitly assigned customers. This relationship
-- is independent of Cognito groups and must be enforced by every backend query.
create table installer_customers (
  installer_id uuid not null references users(id),
  customer_id uuid not null references users(id),
  assigned_by uuid not null references users(id),
  assigned_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (installer_id, customer_id),
  check (installer_id <> customer_id)
);
create index installer_customers_active_customer_idx on installer_customers (customer_id) where removed_at is null;

create table customer_systems (
  id uuid primary key,
  owner_id uuid not null references users(id),
  name text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  check (length(name) between 1 and 160)
);
create index customer_systems_active_owner_idx on customer_systems (owner_id) where retired_at is null;

-- Basic users are limited to three active systems. Administrators and installers
-- are not system owners for this constraint; their customer accounts are checked.
create function enforce_basic_user_system_cap() returns trigger language plpgsql as $$
begin
  -- Serialize concurrent system inserts for the same basic user.
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
  if new.retired_at is null
    and (select role from users where id = new.owner_id) = 'user'
    and (select count(*) from customer_systems where owner_id = new.owner_id and retired_at is null) >= 3 then
    raise exception 'basic user system limit reached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger customer_systems_basic_user_cap
  before insert or update of owner_id, retired_at on customer_systems
  for each row execute function enforce_basic_user_system_cap();

create table audit_events (
  id uuid primary key,
  actor_id uuid references users(id),
  action text not null,
  subject_type text not null,
  subject_id text not null,
  occurred_at timestamptz not null default now(),
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  check (length(action) between 1 and 128),
  check (length(subject_type) between 1 and 128),
  check (length(subject_id) between 1 and 256)
);
create index audit_events_subject_idx on audit_events (subject_type, subject_id, occurred_at desc);
create index audit_events_actor_idx on audit_events (actor_id, occurred_at desc);

create function prevent_audit_event_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events are immutable' using errcode = 'insufficient_privilege';
end;
$$;
create trigger audit_events_no_update before update or delete on audit_events
  for each row execute function prevent_audit_event_mutation();
