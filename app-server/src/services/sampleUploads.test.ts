import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from './auth.js';
import { parseWavHeader, validateUploadBatch } from './sampleUploads.js';

function wav(){const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(36,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(0,40);return b;}
test('parses PCM WAV provenance from S3 range bytes',()=>assert.deepEqual(parseWavHeader(wav(),44),{sampleRateHz:48000,channels:2,bitsPerSample:16,durationMs:0}));
test('rejects non-WAV upload intents',()=>assert.throws(()=>validateUploadBatch({idempotencyKey:'x'.repeat(16),psiuUnitId:'unit',files:[{fileName:'sample.mp3',contentType:'audio/mpeg',byteLength:44,recordedAt:new Date().toISOString()}]}),HttpError));
test('rejects unsupported WAV headers',()=>assert.throws(()=>parseWavHeader(Buffer.from('not-a-wave'),10),HttpError));
