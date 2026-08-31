import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresAccountRepository } from './accountRepository.js';

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
