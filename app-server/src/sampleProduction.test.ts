import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import type { CreateSampleUploadBatchRequest, SampleSummary } from '@wally/contracts';
import { HttpError } from './services/auth.js';
import type { SampleRepository } from './services/sampleRepository.js';
import { createProductionServer } from './production.js';

process.env.COGNITO_USER_POOL_ID = 'pool';
process.env.COGNITO_WEB_CLIENT_ID = 'client';

const intent = { sampleId: 'sample-a', clientFileId: 'file-a', fileName: 'capture.wav', objectKey: 'raw/owner-a/sample-a/capture.wav', contentType: 'audio/wav', byteLength: 44 };

function serverFor(samples: SampleRepository) {
  const accounts = { async findActivePrincipal(subject: string) { return { id: subject === 'owner-a' ? 'owner-a' : 'owner-b', role: 'user' as const, lifecycle: 'active' as const }; }, async me() { return undefined; } };
  return createProductionServer({ pool: {} as never, repository: accounts as never, samples, s3: { send: async () => ({ ContentLength: 43 }) } as never, sampleBucketName: 'bucket', verify: async (token) => ({ subject: token, roles: ['user'] }) });
}

function request(server: ReturnType<typeof createProductionServer>, owner: string, method: string, path: string, body?: unknown) {
  const address = server.address(); if (!address || typeof address === 'string') throw Error('server unavailable');
  return new Promise<{ status: number; body: string }>((resolve, reject) => { const req = httpRequest({ host: '127.0.0.1', port: address.port, path, method, headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' } }, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text })); }); req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end(); });
}

function samples(): SampleRepository {
  return {
    async createBatch(owner: string, request: CreateSampleUploadBatchRequest) { if (owner !== 'owner-a') throw new HttpError(403, 'An assigned enabled PSIU unit is required.'); if (request.idempotencyKey === 'conflict-key-0001') throw new HttpError(409, 'Upload idempotency key was already used for different files.'); return { batchId: 'batch-a', intents: [intent] }; },
    async intent(owner, sampleId) { return owner === 'owner-a' && sampleId === 'sample-a' ? intent : undefined; },
    async objectKey(owner, sampleId) { return owner === 'owner-a' && sampleId === 'sample-a' ? intent.objectKey : undefined; },
    async complete() { throw Error('S3 object mismatch must prevent completion.'); },
    async list(owner) { return owner === 'owner-a' ? [{ id: 'sample-a', batchId: 'batch-a', psiuUnitId: 'unit-a', fileName: 'capture.wav', contentType: 'audio/wav', byteLength: 44, recordedAt: new Date().toISOString(), uploadState: 'uploaded', createdAt: new Date().toISOString() } satisfies SampleSummary] : []; },
    async sample() { return undefined; },
  };
}

const upload = { idempotencyKey: 'valid-key-0000001', psiuUnitId: 'unit-a', files: [{ clientFileId: 'file-id-00000001', fileName: 'capture.wav', contentType: 'audio/wav', byteLength: 44, recordedAt: '2026-01-01T00:00:00.000Z' }] };

test('sample routes deny cross-owner create, completion, download, and list access', async () => {
  const server = serverFor(samples()); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await request(server, 'owner-b', 'POST', '/v1/samples/upload-batches', upload)).status, 403);
    assert.equal((await request(server, 'owner-b', 'POST', '/v1/samples/sample-a/complete')).status, 404);
    assert.equal((await request(server, 'owner-b', 'GET', '/v1/samples/sample-a/download')).status, 404);
    assert.deepEqual(JSON.parse((await request(server, 'owner-b', 'GET', '/v1/samples')).body), []);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('sample routes enforce idempotency conflict and object verification before completion', async () => {
  const server = serverFor(samples()); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await request(server, 'owner-a', 'POST', '/v1/samples/upload-batches', { ...upload, idempotencyKey: 'conflict-key-0001' })).status, 409);
    assert.equal((await request(server, 'owner-a', 'POST', '/v1/samples/sample-a/complete')).status, 409);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
