import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeReportCursor, PostgresReportRepository } from './reportRepository.js';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const row = (id: string, createdAt: string) => ({
  id,
  request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  display_name: 'Tracking Error',
  algorithm_version: '0.1.0',
  preset_name: 'RTI Test 1',
  preset_version: '1',
  status: 'queued',
  created_at: new Date(createdAt),
  completed_at: null,
  system_snapshot: { name: 'Reference system' },
  artifacts: [],
});

test('report history uses owner-scoped created_at/id keyset cursor without page gaps', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return {
        rows:
          calls.length === 1
            ? [
                row(ids[0], '2026-01-03T00:00:00.000Z'),
                row(ids[1], '2026-01-02T00:00:00.000Z'),
                row(ids[2], '2026-01-01T00:00:00.000Z'),
              ]
            : [row(ids[2], '2026-01-01T00:00:00.000Z')],
      };
    },
  };
  const reports = new PostgresReportRepository(pool as never);
  const first = await reports.history('owner-a', { limit: 2 });
  assert.deepEqual(
    first.items.map((item) => item.id),
    ids.slice(0, 2),
  );
  assert.ok(first.nextCursor);
  const second = await reports.history('owner-a', { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(
    second.items.map((item) => item.id),
    [ids[2]],
  );
  assert.deepEqual(
    [...first.items, ...second.items].map((item) => item.id),
    ids,
  );
  assert.equal(calls[1]?.params[0], 'owner-a');
  assert.match(calls[1]?.sql ?? '', /rr\.owner_id=\$1/);
  assert.match(calls[1]?.sql ?? '', /\(ar\.created_at,ar\.id\)<\(\$3::timestamptz,\$4::uuid\)/);
  assert.equal(decodeReportCursor(first.nextCursor!).id, ids[1]);
});

test('report history normalizes JSON-aggregated artifact timestamps from Postgres', async () => {
  const pool = { query: async () => ({ rows: [{ ...row(ids[0], '2026-01-03T00:00:00.000Z'), artifacts: [{ kind: 'report_pdf', content_type: 'application/pdf', created_at: '2026-01-03T00:01:00.000Z' }] }] }) };
  const page = await new PostgresReportRepository(pool as never).history('owner-a');
  assert.equal(page.items[0]?.artifacts[0]?.createdAt, '2026-01-03T00:01:00.000Z');
});

test('report history rejects malformed and forged cursors', () => {
  for (const cursor of [
    '',
    'not-base64!',
    Buffer.from(JSON.stringify({ createdAt: 'nope', id: ids[0] })).toString('base64url'),
    Buffer.from(
      JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', id: 'not-a-uuid' }),
    ).toString('base64url'),
  ])
    assert.throws(() => decodeReportCursor(cursor), /cursor is invalid/);
});

test('PDF artifact lookup remains owner scoped and completed-only', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await new PostgresReportRepository(pool as never).artifact('owner-a', ids[0], 'report_pdf');
  assert.equal(calls[0]?.params[2], 'owner-a');
  assert.match(calls[0]?.sql ?? '', /ar\.status='completed'/);
  assert.match(calls[0]?.sql ?? '', /rr\.owner_id=\$3/);
});
