create table user_alerts (
  id uuid primary key,
  owner_id uuid not null references users(id),
  event_key text not null,
  severity text not null check (severity in ('info','warning','success')),
  title text not null,
  message text not null,
  action_label text,
  action_route text,
  dismissible boolean not null default true,
  status text not null check (status in ('open','dismissed','resolved')),
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,
  resolved_at timestamptz,
  unique (owner_id, event_key)
);
create index user_alerts_owner_open_idx on user_alerts(owner_id, status, created_at desc);
