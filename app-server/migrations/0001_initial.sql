-- Transactional metadata only. Audio and report artifacts live in S3.
create type user_role as enum ('user', 'installer', 'admin');
create type sample_status as enum ('uploaded', 'queued', 'running', 'completed', 'failed', 'cancelled');

create table users (
  id uuid primary key,
  cognito_subject text not null unique,
  email text not null,
  role user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table equipment (
  id uuid primary key,
  owner_id uuid not null references users(id),
  equipment_type text not null check (equipment_type in ('turntable', 'tonearm', 'cartridge')),
  manufacturer text not null,
  model text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table samples (
  id uuid primary key,
  owner_id uuid not null references users(id),
  source_device_id text,
  object_key text not null unique,
  content_type text not null,
  byte_length bigint not null check (byte_length > 0),
  checksum_sha256 text,
  recorded_at timestamptz not null,
  status sample_status not null default 'uploaded',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table analysis_jobs (
  id uuid primary key,
  sample_id uuid not null references samples(id),
  algorithm_name text not null,
  algorithm_version text not null,
  status sample_status not null default 'queued',
  credit_cost integer not null check (credit_cost >= 0),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index samples_owner_created_at_idx on samples(owner_id, created_at desc);
create index analysis_jobs_sample_idx on analysis_jobs(sample_id);
