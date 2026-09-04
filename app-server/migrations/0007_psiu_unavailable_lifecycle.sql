-- Unavailable PSIUs preserve durable assignment and sample provenance while blocking new use.
alter type psiu_unit_status add value if not exists 'unavailable';

alter table psiu_units
  add column unavailable_at timestamptz,
  add column unavailable_by uuid references users(id);
