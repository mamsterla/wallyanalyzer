-- Admin directory, address/engagement metadata, and reporting indexes.
alter table users add column address_line1 text;
alter table users add column address_line2 text;
alter table users add column address_city text;
alter table users add column address_region text;
alter table users add column address_postal_code text;
alter table users add column address_country_code char(2);
alter table users add column last_active_at timestamptz;
alter table users add column admin_samples_viewed_at timestamptz;
create index users_admin_directory_idx on users(role, email);
create index psiu_assignments_active_user_lookup_idx on psiu_assignments(user_id) where unassigned_at is null;
create index samples_admin_directory_idx on samples(created_at desc);
