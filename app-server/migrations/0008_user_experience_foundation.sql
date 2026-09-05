-- Owner profile, named systems, immutable credit ledger, and upload provenance.
alter table users add column first_name text;
alter table users add column last_name text;
alter table users add constraint users_first_name_length check (first_name is null or length(first_name) between 1 and 100);
alter table users add constraint users_last_name_length check (last_name is null or length(last_name) between 1 and 100);

create table user_systems (
  id uuid primary key,
  owner_id uuid not null references users(id),
  name text not null check (length(name) between 1 and 160),
  notes text not null default '' check (length(notes) <= 4000),
  components jsonb not null,
  active boolean not null default false,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(components) = 'object')
);
create unique index user_systems_one_active_owner_idx on user_systems(owner_id) where active and retired_at is null;
create index user_systems_owner_idx on user_systems(owner_id, created_at desc) where retired_at is null;

create type credit_ledger_kind as enum ('initial_verified_account_credit', 'purchase', 'grant', 'usage', 'administrative_adjustment');
create table credit_ledger_entries (
  id uuid primary key,
  owner_id uuid not null references users(id),
  kind credit_ledger_kind not null,
  delta integer not null check (delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  note text not null default '' check (length(note) <= 2000),
  actor_id uuid references users(id),
  reference_type text,
  reference_id text,
  created_at timestamptz not null default now(),
  unique(owner_id, kind, reference_type, reference_id)
);
create index credit_ledger_owner_created_idx on credit_ledger_entries(owner_id, created_at desc);
create function prevent_credit_ledger_mutation() returns trigger language plpgsql as $$ begin raise exception 'credit ledger is immutable' using errcode='insufficient_privilege'; end; $$;
create trigger credit_ledger_no_update before update or delete on credit_ledger_entries for each row execute function prevent_credit_ledger_mutation();

alter table samples add column system_snapshot jsonb;
alter table users add column email_confirmed_at timestamptz;
