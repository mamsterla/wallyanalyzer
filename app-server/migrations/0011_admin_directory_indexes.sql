-- Directory keyset indexes. The migration runner wraps each file in a transaction, so do not use
-- CREATE INDEX CONCURRENTLY here. These B-tree indexes support stable directory ordering and
-- active assignment joins. Substring search currently uses escaped ILIKE; add pg_trgm indexes
-- later only through an explicitly approved, non-transactional operational migration.
create index users_admin_directory_cursor_idx on users(role, created_at desc, id desc);
create index users_admin_directory_lifecycle_cursor_idx on users(role, lifecycle, created_at desc, id desc);
create index psiu_units_admin_directory_cursor_idx on psiu_units(serial_number, id);
create index psiu_units_admin_directory_status_cursor_idx on psiu_units(status, serial_number, id);
create index psiu_assignments_active_unit_lookup_idx on psiu_assignments(psiu_unit_id) where unassigned_at is null;
