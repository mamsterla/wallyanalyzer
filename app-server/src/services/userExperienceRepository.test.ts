import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresUserExperienceRepository } from './userExperienceRepository.js';

test('owner profile update accepts an international address without audit metadata', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { query: async (sql: string, values: unknown[]) => { queries.push({ sql, values }); return { rowCount: 1, rows: [{ first_name: 'Ada', last_name: 'Lovelace', address_line1: '1 Analytical Engine Way', address_line2: null, address_city: 'London', address_region: 'London', address_postal_code: 'SW1A 1AA', address_country_code: 'GB' }] }; } };
  const result = await new PostgresUserExperienceRepository(pool as never).updateProfile('owner-id', { firstName: 'Ada', lastName: 'Lovelace', address: { line1: '1 Analytical Engine Way', city: 'London', region: 'London', postalCode: 'SW1A 1AA', countryCode: 'gb' } });
  assert.deepEqual(result, { firstName: 'Ada', lastName: 'Lovelace', address: { line1: '1 Analytical Engine Way', line2: undefined, city: 'London', region: 'London', postalCode: 'SW1A 1AA', countryCode: 'GB' } });
  assert.match(queries[0]!.sql, /address_country_code/);
  assert.equal(queries[0]!.values.includes('GB'), true);
});
