import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import type { CreateSampleUploadBatchRequest, SampleSummary } from '@wally/contracts';
import { HttpError } from './services/auth.js';
import type { SampleRepository } from './services/sampleRepository.js';
import { createProductionServer } from './production.js';

process.env.COGNITO_USER_POOL_ID = 'pool';
process.env.COGNITO_WEB_CLIENT_ID = 'client';

const intent = { sampleId: 'sample-a', clientFileId: 'file-a', fileName: 'capture.wav', objectKey: 'raw/owner-a/sample-a/capture.wav', contentType: 'audio/wav', byteLength: 44 };

function serverFor(samples: SampleRepository) {
  const accounts = { async findActivePrincipal(subject: string) { return { id: subject === 'owner-a' ? 'owner-a' : 'owner-b', role: 'user' as const, lifecycle: 'active' as const }; }, async me() { return undefined; } };
  const s3 = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  s3.send = async () => ({ ContentLength: 43 }) as never;
  return createProductionServer({ pool: {} as never, repository: accounts as never, samples, s3, sampleBucketName: 'bucket', verify: async (token) => ({ subject: token, roles: ['user'] }) });
}

function request(server: ReturnType<typeof createProductionServer>, owner: string, method: string, path: string, body?: unknown) {
  const address = server.address(); if (!address || typeof address === 'string') throw Error('server unavailable');
  return new Promise<{ status: number; body: string }>((resolve, reject) => { const req = httpRequest({ host: '127.0.0.1', port: address.port, path, method, headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' } }, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text })); }); req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end(); });
}

function samples(): SampleRepository {
  return {
    async createBatch(owner: string, request: CreateSampleUploadBatchRequest) { if (owner !== 'owner-a' || !['unit-a','unit-b'].includes(request.psiuUnitId)) throw new HttpError(403, 'An assigned enabled PSIU unit is required.'); if (request.idempotencyKey === 'conflict-key-0001') throw new HttpError(409, 'Upload idempotency key was already used for different files.'); return { batchId: 'batch-a', intents: [intent] }; },
    async intent(owner, sampleId) { return owner === 'owner-a' && sampleId === 'sample-a' ? intent : undefined; },
    async objectKey(owner, sampleId) { return owner === 'owner-a' && sampleId === 'sample-a' ? intent.objectKey : undefined; },
    async complete() { throw Error('S3 object mismatch must prevent completion.'); },
    async list(owner) { return owner === 'owner-a' ? [{ id: 'sample-a', batchId: 'batch-a', psiuUnitId: 'unit-a', fileName: 'capture.wav', contentType: 'audio/wav', byteLength: 44, recordedAt: new Date().toISOString(), uploadState: 'uploaded', source: 'manual_file', createdAt: new Date().toISOString() } satisfies SampleSummary] : []; },
    async sample() { return undefined; },
  };
}

const upload = { idempotencyKey: 'valid-key-0000001', psiuUnitId: 'unit-a', source: 'manual_file' as const, files: [{ clientFileId: 'file-id-00000001', fileName: 'capture.wav', source: 'manual_file' as const, contentType: 'audio/wav', byteLength: 44, recordedAt: '2026-01-01T00:00:00.000Z' }] };

test('sample routes deny cross-owner create, completion, download, and list access', async () => {
  const server = serverFor(samples()); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await request(server, 'owner-b', 'POST', '/v1/samples/upload-batches', upload)).status, 403);
    assert.equal((await request(server, 'owner-b', 'POST', '/v1/samples/sample-a/complete')).status, 404);
    assert.equal((await request(server, 'owner-b', 'GET', '/v1/samples/sample-a/download')).status, 404);
    assert.deepEqual(JSON.parse((await request(server, 'owner-b', 'GET', '/v1/samples')).body), []);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('sample routes allow a dealer to select either assigned unit for upload', async () => {
  const server = serverFor(samples()); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await request(server, 'owner-a', 'POST', '/v1/samples/upload-batches', upload)).status, 201);
    assert.equal((await request(server, 'owner-a', 'POST', '/v1/samples/upload-batches', { ...upload, idempotencyKey: 'second-unit-key-01', psiuUnitId: 'unit-b' })).status, 201);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('completion deletes a newly blocked object after an unavailable or unassigned unit rejects it', async () => {
  const blocked: SampleRepository = { ...samples(), async intent(owner, sampleId) { return owner === 'owner-a' && sampleId === 'sample-a' ? { ...intent, byteLength: 48 } : undefined; }, async complete() { throw new HttpError(403, 'PSIU unit is unavailable or no longer assigned; upload was rejected.'); } };
  const accounts = { async findActivePrincipal() { return { id: 'owner-a', role: 'user' as const, lifecycle: 'active' as const }; }, async me() { return undefined; } };
  const wav = Buffer.alloc(48); wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
  const commands: string[] = []; const s3 = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
  s3.send = async (command: { constructor: { name: string } }) => { commands.push(command.constructor.name); if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: 48 } as never; if (command.constructor.name === 'GetObjectCommand') return { Body: Readable.from([wav]) } as never; return {} as never; };
  const server = createProductionServer({ pool: {} as never, repository: accounts as never, samples: blocked, s3, sampleBucketName: 'bucket', verify: async () => ({ subject: 'owner-a', roles: ['user'] }) }); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { assert.equal((await request(server, 'owner-a', 'POST', '/v1/samples/sample-a/complete')).status, 403); assert.deepEqual(commands, ['HeadObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand']); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('sample routes enforce idempotency conflict and object verification before completion', async () => {
  const server = serverFor(samples()); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await request(server, 'owner-a', 'POST', '/v1/samples/upload-batches', { ...upload, idempotencyKey: 'conflict-key-0001' })).status, 409);
    assert.equal((await request(server, 'owner-a', 'POST', '/v1/samples/sample-a/complete')).status, 409);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
