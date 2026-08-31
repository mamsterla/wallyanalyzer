import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./sampleRepository.js', import.meta.url), 'utf8');
const freshUploadMigrations = await Promise.all([
  readFile(new URL('../../migrations/0004_sample_uploads.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../migrations/0005_sample_upload_idempotency_fingerprint.sql', import.meta.url), 'utf8'),
]);

test('fresh upload schema adds request_fingerprint before repository upload intent inserts it', () => {
  const [uploadSchema, fingerprintMigration] = freshUploadMigrations;
  assert.match(uploadSchema, /create table sample_upload_batches/i);
  assert.match(fingerprintMigration, /add column request_fingerprint text not null/i);
  assert.match(source, /insert into sample_upload_batches\(id,owner_id,psiu_unit_id,idempotency_key,request_fingerprint\)/i);
});

test('concurrent idempotency claims use atomic insert-on-conflict before reloading the winning batch', () => {
  assert.match(source, /on conflict \(owner_id,idempotency_key\) do nothing returning id,request_fingerprint/i);
  assert.match(source, /const batch\s*=\s*claimed\.rows\[0\]\s*\?\?\s*\(await c\.query/i);
  assert.match(source, /if\s*\(batch\.request_fingerprint\s*!==\s*fingerprint\)\s*throw new HttpError\(409/i);
  assert.doesNotMatch(source, /const existing=await c\.query/);
});
