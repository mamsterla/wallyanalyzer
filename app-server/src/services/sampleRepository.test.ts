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

test('completion locks PSIU, active owner assignment, then sample before unavailable or deassign can win the race', async () => {
  const queries: string[] = [];
  const client = { async query(sql: string) { queries.push(sql); if (sql.startsWith('select s.psiu_unit_id')) return { rowCount: 1, rows: [{ psiu_unit_id: 'unit-a', unit_status: 'unavailable', unit_uid: 'uid-a' }] }; if (sql.startsWith('select * from samples')) return { rowCount: 1, rows: [{ id: 'sample-a', upload_state: 'intent', observed_psiu_uid: 'uid-a' }] }; if (sql.startsWith("update samples set upload_state='failed'")) return { rowCount: 1, rows: [{ object_key: 'raw/owner/sample.wav' }] }; return { rowCount: 1, rows: [] }; }, release() {} };
  const repository = new PostgresSampleRepository({ connect: async () => client } as never);

  await assert.rejects(() => repository.complete('owner-a', 'sample-a', { sampleRateHz: 48000, channels: 2, bitsPerSample: 16, durationMs: 1 }), (error: unknown) => error instanceof HttpError && error.statusCode === 403);
  const unitIndex = queries.findIndex((sql) => sql.startsWith('select s.psiu_unit_id'));
  const assignmentIndex = queries.findIndex((sql) => sql.startsWith('select user_id from psiu_assignments'));
  const sampleIndex = queries.findIndex((sql) => sql.startsWith('select * from samples'));
  assert.match(queries[unitIndex]!, /for update of p/i);
  assert.match(queries[assignmentIndex]!, /unassigned_at is null for share/i);
  assert.match(queries[sampleIndex]!, /for update/i);
  assert.ok(unitIndex < assignmentIndex && assignmentIndex < sampleIndex);
  assert.match(queries.find((sql) => sql.startsWith("update samples set upload_state='failed'"))!, /upload_state='intent'/);
  assert.equal(queries.filter((sql) => sql === 'commit').length, 1);
});

test('completion locks PSIU, assignment, and sample in unavailable transition order', () => {assert.match(source,/select s\.psiu_unit_id,p\.status as unit_status,p\.opaque_uid as unit_uid[\s\S]*for update of p/i);assert.match(source,/select user_id from psiu_assignments where psiu_unit_id=\$1 and user_id=\$2 and unassigned_at is null for share/i);assert.match(source,/select \* from samples where id=\$1 and owner_id=\$2 and upload_state in \('intent','uploaded'\) for update/i);assert.match(source,/update samples set upload_state='failed' where id=\$1 and upload_state='intent'/i);});

test('duplicate completion returns an uploaded sample before lifecycle tagging callback', async () => {
  const queries: string[] = [];
  const uploaded = { id: 'sample-a', upload_state: 'uploaded', observed_psiu_uid: null, upload_batch_id: 'batch-a', psiu_unit_id: 'unit-a', source: 'manual_file', object_key: 'raw/owner/sample.wav', content_type: 'audio/wav', byte_length: 44, checksum_sha256: null, recorded_at: new Date('2026-01-01T00:00:00.000Z'), metadata: { fileName: 'capture.wav' }, created_at: new Date('2026-01-01T00:00:00.000Z'), uploaded_at: new Date('2026-01-01T00:00:00.000Z') };
  const client = { async query(sql: string) { queries.push(sql); if (sql.startsWith('select s.psiu_unit_id')) return { rowCount: 1, rows: [{ psiu_unit_id: 'unit-a', unit_status: 'enabled', unit_uid: 'uid-a' }] }; if (sql.startsWith('select user_id from psiu_assignments')) return { rowCount: 1, rows: [{ user_id: 'owner-a' }] }; if (sql.startsWith('select * from samples')) return { rowCount: 1, rows: [uploaded] }; return { rowCount: 1, rows: [] }; }, release() {} };
  const repository = new PostgresSampleRepository({ connect: async () => client } as never);
  let tagged = false;
  const result = await repository.complete('owner-a', 'sample-a', { sampleRateHz: 48000, channels: 2, bitsPerSample: 16, durationMs: 1 }, async () => { tagged = true; });
  assert.equal(result.uploadState, 'uploaded');
  assert.equal(tagged, false);
  assert.equal(queries.some((sql) => sql.startsWith("update samples set upload_state='uploaded'")), false);
});
test('concurrent idempotency claims use atomic insert-on-conflict before reloading the winning batch', () => {
  assert.match(source, /on conflict \(owner_id,idempotency_key\) do nothing returning id,request_fingerprint/i);
  assert.match(source, /const batch\s*=\s*claimed\.rows\[0\]\s*\?\?\s*\(await c\.query/i);
  assert.match(source, /if\s*\(batch\.request_fingerprint\s*!==\s*fingerprint\)\s*throw new HttpError\(409/i);
  assert.doesNotMatch(source, /const existing=await c\.query/);
});
