import assert from 'node:assert/strict';
import test from 'node:test';
import { page, PostgresAdminDataRepository } from './services/adminDataRepository.js';
import { HttpError } from './services/auth.js';

test('admin paging is bounded and integral', () => {
  assert.deepEqual(page({ limit: 25, offset: 0 }), { limit: 25, offset: 0 });
  for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }]) assert.throws(() => page(input), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
});

test('last activity update is durably rate limited', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const repository = new PostgresAdminDataRepository({ query: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); return { rows: [] }; } } as never);
  await repository.touchLastActive('owner');
  assert.match(calls[0]!.sql, /15 minutes/);
  assert.deepEqual(calls[0]!.values, ['owner']);
});

test('admin profile audit metadata excludes address PII', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { query: async (sql: string, values: unknown[] = []) => { calls.push({ sql, values }); if (sql.startsWith('update users')) return { rowCount: 1, rows: [{ id: 'user' }] }; if (sql.includes('from users u where')) return { rowCount: 1, rows: [{ id:'user', email:'u@example.com', balance:0 }] }; return { rowCount: 0, rows: [] }; } };
  const repository = new PostgresAdminDataRepository(pool as never);
  await repository.updateUser('user','admin',{ firstName:'Ada', address:{ line1:'1 Private Lane', countryCode:'US' } });
  const audit = calls.find(x => x.sql.includes('customer.profile_updated'))!;
  assert.match(audit.sql, /'\{\}'::jsonb/);
  assert.equal(JSON.stringify(audit.values).includes('Private Lane'), false);
});
