import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresUserAlertsRepository } from './userAlertsRepository.js';

function repository(systemActive = false, balance = 2) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (sql.includes('select exists')) return { rows: [{ ok: systemActive }], rowCount: 1 };
      if (sql.includes('select coalesce')) return { rows: [{ balance }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = { connect: async () => client, query: client.query.bind(client) };
  return { repository: new PostgresUserAlertsRepository(pool as never), queries };
}

test('refresh creates idempotent system-required and <=2 credit alerts', async () => {
  const { repository: alerts, queries } = repository(false, 2);
  await alerts.refresh('owner-a');
  await alerts.refresh('owner-a');
  const opens = queries.filter(query => query.sql.includes('on conflict(owner_id,event_key)'));
  assert.equal(opens.length, 4);
  assert.match(opens[0]!.sql, /where user_alerts\.status='resolved'/);
  assert.deepEqual(opens.map(query => query.values?.[2]), ['system_required', 'credits_low', 'system_required', 'credits_low']);
});

test('refresh resolves open and dismissed alerts when conditions clear', async () => {
  const { repository: alerts, queries } = repository(true, 3);
  await alerts.refresh('owner-a');
  const resolves = queries.filter(query => query.sql.includes("status in ('open','dismissed')"));
  assert.equal(resolves.length, 2);
  assert.deepEqual(resolves.map(query => query.values?.slice(0, 2)), [['owner-a', 'system_required'], ['owner-a', 'credits_low']]);
});

test('dismiss scopes the alert update to its owner', async () => {
  const { repository: alerts, queries } = repository();
  await alerts.dismiss('owner-a', 'alert-a');
  const dismiss = queries.find(query => query.sql.includes("status='dismissed'"));
  assert.ok(dismiss);
  assert.deepEqual(dismiss.values, ['alert-a', 'owner-a']);
});
