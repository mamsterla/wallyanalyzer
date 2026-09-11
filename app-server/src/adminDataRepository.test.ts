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

test('admin profile patches preserve omitted PII fields and exclude PII from audit metadata', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { query: async (sql: string, values: unknown[] = []) => { calls.push({ sql, values }); if (sql.startsWith('update users')) return { rowCount: 1, rows: [{ id: 'user' }] }; if (sql.includes('from users u where')) return { rowCount: 1, rows: [{ id:'user', email:'u@example.com', balance:0 }] }; return { rowCount: 0, rows: [] }; } };
  const repository = new PostgresAdminDataRepository(pool as never);
  await repository.updateUser('user','admin',{ firstName:'Ada', address:{ line1:'1 Private Lane', countryCode:'US' } });
  const update = calls.find(x => x.sql.startsWith('update users'))!;
  assert.match(update.sql, /case when \$2 then \$3 else first_name end/);
  assert.deepEqual(update.values.slice(1), [true, 'Ada', false, undefined, true, '1 Private Lane', false, undefined, false, undefined, false, undefined, false, undefined, true, 'US']);
  const audit = calls.find(x => x.sql.includes('customer.profile_updated'))!;
  assert.match(audit.sql, /'\{\}'::jsonb/);
  assert.equal(JSON.stringify(audit.values).includes('Private Lane'), false);
});

test('admin credit adjustment rejects reserved and invalid ledger kinds', async () => {
  const repository = new PostgresAdminDataRepository({ connect: async () => { throw Error('must reject before database access'); } } as never);
  for (const kind of ['usage', 'purchase', 'initial_verified_account_credit', 'invalid']) {
    await assert.rejects(() => repository.adjustCredits('user', 'admin', { delta: 1, note: 'test', kind: kind as never }), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
  }
});

test('user and PSIU directories enforce two-character queries, escape wildcards, and return keyset cursors', async () => {
  const calls: Array<{ sql:string; values:unknown[] }> = [];
  const pool = { query: async (sql:string, values:unknown[] = []) => { calls.push({sql, values}); return { rows: [{ id:'00000000-0000-4000-8000-000000000001', email:'a@example.com', created_at:new Date('2026-01-02T00:00:00Z'), serial_number:'PSIU-1', opaque_uid:'UID-1', status:'enabled' }, { id:'00000000-0000-4000-8000-000000000002', email:'b@example.com', created_at:new Date('2026-01-01T00:00:00Z'), serial_number:'PSIU-2', opaque_uid:'UID-2', status:'enabled' }], rowCount:2 }; } };
  const repository = new PostgresAdminDataRepository(pool as never);
  await assert.rejects(() => repository.users({ q:'a' }), (e:unknown) => e instanceof HttpError && e.statusCode===400);
  const users = await repository.users({ q:'a_%', limit:1 });
  assert.equal(users.items.length, 1); assert.ok(users.nextCursor);
  assert.equal(calls[0]!.values[1], '%a\\_\\%%');
  await repository.users({ cursor:users.nextCursor, limit:1 });
  assert.match(calls[1]!.sql, /u\.created_at,u\.id/);
  const units = await repository.units({ q:'PS', status:'enabled', assignment:'assigned', limit:1 });
  assert.equal(units.items.length, 1); assert.ok(units.nextCursor);
  await assert.rejects(() => repository.typeahead('x'), (e:unknown) => e instanceof HttpError && e.statusCode===400);
});

test('admin enum filters normalize blanks, cast safely, and reject invalid values', async () => {
  const calls: Array<{ sql:string; values:unknown[] }> = [];
  const pool = { query: async (sql:string, values:unknown[] = []) => { calls.push({sql,values}); return { rows: [] }; } };
  const repository = new PostgresAdminDataRepository(pool as never);
  await repository.users({ lifecycle:' ' });
  await repository.units({ status:'', assignment:' ' });
  await repository.samples({ source:'', state:' ' });
  assert.match(calls[0]!.sql, /u\.lifecycle=\$3::customer_lifecycle/);
  assert.equal(calls[0]!.values[2], undefined);
  assert.match(calls[1]!.sql, /p\.status=\$4::psiu_unit_status/);
  assert.equal(calls[1]!.values[3], undefined);
  assert.match(calls[2]!.sql, /s\.upload_state=\$4::sample_upload_state/);
  assert.deepEqual(calls[2]!.values.slice(2,4), [undefined, undefined]);
  await assert.rejects(() => repository.users({ lifecycle:'unknown' }), (e:unknown) => e instanceof HttpError && e.statusCode===400);
  await assert.rejects(() => repository.units({ status:'unknown' }), (e:unknown) => e instanceof HttpError && e.statusCode===400);
  await assert.rejects(() => repository.samples({ source:'unknown' }), (e:unknown) => e instanceof HttpError && e.statusCode===400);
});

test('admin report, sample, and credit sorting is whitelisted and deterministic', async () => {
  const calls: Array<{sql:string;values:unknown[]}> = [];
  const repository = new PostgresAdminDataRepository({ query: async (sql:string,values:unknown[]=[])=>(calls.push({sql,values}),{rows:[]}) } as never);
  await repository.samples({ sortBy:'owner', sortDirection:'asc' });
  await repository.reports({ sortBy:'status', sortDirection:'desc' });
  await repository.creditEntries({ sortBy:'delta', sortDirection:'asc' });
  assert.match(calls[0]!.sql, /order by u\.email asc,s\.id asc/);
  assert.match(calls[1]!.sql, /order by ar\.status desc,ar\.id desc/);
  assert.match(calls[2]!.sql, /order by l\.delta asc,l\.id asc/);
  await assert.rejects(() => repository.samples({ sortBy:'drop table' }), (e:unknown) => e instanceof HttpError && e.statusCode===400);
  await assert.rejects(() => repository.creditEntries({ sortDirection:'sideways' }), (e:unknown) => e instanceof HttpError && e.statusCode===400);
});

test('PSIU and sample owner filters require selected IDs while general search stays device-only', async () => {
  const calls: Array<{ sql:string; values:unknown[] }> = [];
  const pool = { query: async (sql:string, values:unknown[] = []) => { calls.push({sql,values}); return { rows: [] }; } };
  const repository = new PostgresAdminDataRepository(pool as never);
  await repository.units({ q:'PS', customerId:'00000000-0000-4000-8000-000000000001' });
  assert.match(calls[0]!.sql, /u\.id=\$3/);
  assert.equal(calls[0]!.sql.includes('u.email ilike'), false);
  assert.equal(calls[0]!.values[2], '00000000-0000-4000-8000-000000000001');
  await repository.samples({ q:'PS' });
  assert.match(calls[1]!.sql, /p\.serial_number ilike/);
  assert.equal(calls[1]!.sql.includes('u.email ilike'), false);
});

test('admin profile update never updates email', async () => {
  const calls: Array<{ sql:string }> = [];
  const pool = { query: async (sql:string) => { calls.push({sql}); if (sql.startsWith('update users')) return { rowCount:1, rows:[{id:'user'}] }; if (sql.includes('from users u where')) return { rowCount:1, rows:[{id:'user',email:'u@example.com',balance:0}] }; return { rowCount:0,rows:[] }; } };
  await new PostgresAdminDataRepository(pool as never).updateUser('user','admin',{ firstName:'Ada', email:'new@example.com' } as never);
  assert.equal(calls.find(x=>x.sql.startsWith('update users'))!.sql.includes('email='), false);
});
