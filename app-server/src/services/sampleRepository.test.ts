import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { HttpError } from './auth.js';
import { PostgresSampleRepository } from './sampleRepository.js';

const source = await readFile(new URL('./sampleRepository.js', import.meta.url), 'utf8');
const freshUploadMigrations = await Promise.all([
  readFile(new URL('../../migrations/0004_sample_uploads.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../migrations/0005_sample_upload_idempotency_fingerprint.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../migrations/0006_multi_psiu_upload_provenance.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../migrations/0007_psiu_unavailable_lifecycle.sql', import.meta.url), 'utf8'),
]);

test('fresh upload schema adds idempotency and source provenance before repository upload intent inserts it', () => {
  const [uploadSchema, fingerprintMigration, provenanceMigration, unavailableMigration] = freshUploadMigrations;
  assert.match(uploadSchema, /create table sample_upload_batches/i);
  assert.match(fingerprintMigration, /add column request_fingerprint text not null/i);
  assert.match(provenanceMigration, /drop index if exists psiu_assignments_one_active_user_idx/i);
  assert.match(provenanceMigration, /add column source text not null default 'manual_file'/i);
  assert.match(provenanceMigration, /add column observed_psiu_uid text/i);
  assert.match(source, /insert into sample_upload_batches\(id,owner_id,psiu_unit_id,idempotency_key,request_fingerprint,source,observed_psiu_uid\)/i);
  assert.match(unavailableMigration, /add value if not exists 'unavailable'/i);
  assert.match(unavailableMigration, /unavailable_at timestamptz/i);
});

test('completion locks the PSIU row and fails a pending upload when unavailable wins the race', async () => {
  const queries: string[] = [];
  const client = { async query(sql: string) { queries.push(sql); if (sql.startsWith('select s.*')) return { rowCount: 1, rows: [{ id: 'sample-a', upload_state: 'intent', observed_psiu_uid: 'uid-a', unit_status: 'unavailable', unit_uid: 'uid-a', assigned_owner_id: null }] }; if (sql.startsWith("update samples set upload_state='failed'")) return { rowCount: 1, rows: [{ object_key: 'raw/owner/sample.wav' }] }; return { rowCount: 1, rows: [] }; }, release() {} };
  const repository = new PostgresSampleRepository({ connect: async () => client } as never);

  await assert.rejects(() => repository.complete('owner-a', 'sample-a', { sampleRateHz: 48000, channels: 2, bitsPerSample: 16, durationMs: 1 }), (error: unknown) => error instanceof HttpError && error.statusCode === 403);
  assert.match(queries.find((sql) => sql.startsWith('select s.*'))!, /for key share of p/i);
  assert.match(queries.find((sql) => sql.startsWith('select s.*'))!, /for update of s/i);
  assert.match(queries.find((sql) => sql.startsWith("update samples set upload_state='failed'"))!, /upload_state='intent'/);
  assert.equal(queries.filter((sql) => sql === 'commit').length, 1);
});

test('concurrent idempotency claims use atomic insert-on-conflict before reloading the winning batch', () => {
  assert.match(source, /on conflict \(owner_id,idempotency_key\) do nothing returning id,request_fingerprint/i);
  assert.match(source, /const batch\s*=\s*claimed\.rows\[0\]\s*\?\?\s*\(await c\.query/i);
  assert.match(source, /if\s*\(batch\.request_fingerprint\s*!==\s*fingerprint\)\s*throw new HttpError\(409/i);
  assert.doesNotMatch(source, /const existing=await c\.query/);
});
