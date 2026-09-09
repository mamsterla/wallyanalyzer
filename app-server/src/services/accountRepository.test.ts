import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresAccountRepository } from './accountRepository.js';
import { HttpError } from './auth.js';

test('assigning a second enabled PSIU retains existing customer assignments', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('select id from psiu_units')) return { rowCount: 1, rows: [{ id: 'unit-b' }] };
      if (sql.includes('select id from users')) return { rowCount: 1, rows: [{ id: 'dealer-a' }] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client };
  const repository = new PostgresAccountRepository(pool as never);

  await repository.assign('unit-b', 'dealer-a', 'admin-a');

  assert.equal(queries.some((sql) => sql.includes('update psiu_assignments set unassigned_at=now(),unassigned_by=$2 where user_id=$1')), false);
  assert.equal(queries.some((sql) => sql.includes('where psiu_unit_id=$1 and unassigned_at is null')), true);
  assert.equal(queries.some((sql) => sql.includes('insert into psiu_assignments')), true);
});

test('marking a unit unavailable closes its active assignment, fails pending intents, and records an audit event', async () => {
  const queries: string[] = [];
  const client = { async query(sql: string) { queries.push(sql); if (sql.includes('select status from psiu_units')) return { rowCount: 1, rows: [{ status: 'enabled' }] }; if (sql.includes("update samples set upload_state='failed'")) return { rowCount: 1, rows: [{ object_key: 'raw/owner-a/pending.wav' }] }; return { rowCount: 1, rows: [] }; }, release() {} };
  const repository = new PostgresAccountRepository({ connect: async () => client } as never);

  const objectKeys = await repository.markUnitUnavailable('unit-a', 'admin-a');

  assert.deepEqual(objectKeys, ['raw/owner-a/pending.wav']);
  assert.equal(queries.some((sql) => sql.includes("status='unavailable',unavailable_at=now(),unavailable_by=$2")), true);
  assert.equal(queries.some((sql) => sql.includes("update samples set upload_state='failed'")), true);
  assert.equal(queries.some((sql) => sql.includes('where psiu_unit_id=$1 and unassigned_at is null')), true);
  assert.equal(queries.some((sql) => sql.includes('insert into audit_events')), true);
});

test('hard deletion rejects a unit with retained assignment or sample history', async () => {
  const client = { async query(sql: string) { if (sql.includes('select id from psiu_units')) return { rowCount: 1, rows: [{ id: 'unit-a' }] }; if (sql.includes('as has_history')) return { rowCount: 1, rows: [{ has_history: true }] }; return { rowCount: 1, rows: [] }; }, release() {} };
  const repository = new PostgresAccountRepository({ connect: async () => client } as never);

  await assert.rejects(() => repository.hardDeleteUnit('unit-a', 'admin-a'), (error: unknown) => error instanceof HttpError && error.statusCode === 409 && error.message.includes('Mark unavailable'));
});

test('hard deletion permits a never-used test unit to be re-added', async () => {
  const queries: string[] = [];
  const client = { async query(sql: string) { queries.push(sql); if (sql.includes('select id from psiu_units')) return { rowCount: 1, rows: [{ id: 'unit-a' }] }; if (sql.includes('as has_history')) return { rowCount: 1, rows: [{ has_history: false }] }; if (sql.includes('insert into psiu_units')) return { rowCount: 1, rows: [{ id: 'unit-b', serial_number: 'serial-a', opaque_uid: 'uid-a', status: 'enabled', assigned_at: null, unavailable_at: null }] }; return { rowCount: 1, rows: [] }; }, release() {} };
  const repository = new PostgresAccountRepository({ connect: async () => client, query: client.query } as never);

  await repository.hardDeleteUnit('unit-a', 'admin-a');
  const readded = await repository.createUnit('serial-a', 'uid-a', 'admin-a');

  assert.equal(readded.id, 'unit-b');
  assert.equal(queries.some((sql) => sql.includes('delete from psiu_units where id=$1')), true);
  assert.equal(queries.some((sql) => sql.includes('insert into psiu_units')), true);
});

test('email confirmation also promotes legacy active accounts that lack durable confirmation', async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { async query(sql: string, values?: unknown[]) { queries.push({ sql, values }); return { rowCount: 1, rows: [{ id: 'admin-a' }] }; }, release() {} };
  const repository = new PostgresAccountRepository({ connect: async () => client } as never);

  await repository.confirmEmail('admin-subject');

  assert.equal(queries.some(({ sql }) => sql.includes('lifecycle in') && sql.includes('email_confirmed_at is null')), true);
  const creditInsert = queries.find(({ sql }) => sql.includes("kind='initial_verified_account_credit'"));
  assert.match(creditInsert?.sql ?? '', /reference_id=\$2::text/);
  assert.equal(typeof creditInsert?.values?.[1], 'string');
  assert.equal(queries.some(({ sql }) => sql.includes('insert into audit_events')), true);
});

test('customer unit queries retain assigned unit status for capture eligibility', async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('from users where id=$1')) return { rowCount: 1, rows: [{ id: 'customer-a', email: 'customer@example.com', role: 'user', lifecycle: 'active', invited_at: null }] };
      if (sql.includes('from psiu_units p join psiu_assignments')) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    },
  };
  const repository = new PostgresAccountRepository(pool as never);

  assert.deepEqual((await repository.me('customer-a'))?.units, []);
  assert.equal(queries.some((sql) => sql.includes('where a.user_id=$1 order by a.assigned_at desc')), true);
  assert.equal(queries.some((sql) => sql.includes('from psiu_units p left join psiu_assignments')), false);
});
