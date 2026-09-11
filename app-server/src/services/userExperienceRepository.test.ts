import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresUserExperienceRepository } from './userExperienceRepository.js';
import { HttpError } from './auth.js';

test('owner profile update accepts an international address without audit metadata', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { query: async (sql: string, values: unknown[]) => { queries.push({ sql, values }); return { rowCount: 1, rows: [{ first_name: 'Ada', last_name: 'Lovelace', address_line1: '1 Analytical Engine Way', address_line2: null, address_city: 'London', address_region: 'London', address_postal_code: 'SW1A 1AA', address_country_code: 'GB' }] }; } };
  const result = await new PostgresUserExperienceRepository(pool as never).updateProfile('owner-id', { firstName: 'Ada', lastName: 'Lovelace', address: { line1: '1 Analytical Engine Way', city: 'London', region: 'London', postalCode: 'SW1A 1AA', countryCode: 'gb' } });
  assert.deepEqual(result, { firstName: 'Ada', lastName: 'Lovelace', address: { line1: '1 Analytical Engine Way', line2: undefined, city: 'London', region: 'London', postalCode: 'SW1A 1AA', countryCode: 'GB' } });
  assert.match(queries[0]!.sql, /address_country_code/);
  assert.equal(queries[0]!.values.includes('GB'), true);
});

test('system update is owner scoped', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { query: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return { rowCount: 1, rows: [{ id: 'system', name: 'Updated', notes: '', components: { turntable: 'TT', tonearm: 'Arm', cartridge: 'Cart' }, active: true, created_at: new Date('2026-01-01') }] }; } };
  const result = await new PostgresUserExperienceRepository(pool as never).updateSystem('owner', 'system', { name: 'Updated', components: { turntable: 'TT', tonearm: 'Arm', cartridge: 'Cart' } });
  assert.equal(result.name, 'Updated');
  assert.match(calls[0]!.sql, /owner_id=\$2/);
  assert.deepEqual(calls[0]!.values.slice(0, 2), ['system', 'owner']);
});

test('system used by a report cannot be deleted', async () => {
  const calls: string[] = [];
  const client = { query: async (sql: string) => { calls.push(sql); if (sql.startsWith('select id from user_systems')) return { rowCount: 1, rows: [{ id: 'system' }] }; if (sql.startsWith('select 1 from report_requests')) return { rowCount: 1, rows: [{ '?column?': 1 }] }; return { rowCount: 0, rows: [] }; }, release() {} };
  const pool = { connect: async () => client };
  await assert.rejects(() => new PostgresUserExperienceRepository(pool as never).deleteSystem('owner', 'system'), (error: unknown) => error instanceof HttpError && error.statusCode === 409);
  assert.equal(calls.some(sql => sql.startsWith('delete from user_systems')), false);
  assert.equal(calls.some(sql => sql.includes('system_snapshot')), true);
});
