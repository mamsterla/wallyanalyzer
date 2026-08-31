import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from './auth.js';
import { parseWavHeader, validateUploadBatch } from './sampleUploads.js';

function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}
test('parses PCM WAV provenance from S3 range bytes',()=>assert.deepEqual(parseWavHeader(wav(),48),{sampleRateHz:48000,channels:2,bitsPerSample:16,durationMs:0}));
test('rejects RIFF size, invalid chunk boundaries, and zero data',()=>{const bad=wav();bad.writeUInt32LE(36,4);assert.throws(()=>parseWavHeader(bad,48),HttpError);const boundary=wav();boundary.writeUInt32LE(99,40);assert.throws(()=>parseWavHeader(boundary,48),HttpError);const empty=wav();empty.writeUInt32LE(0,40);assert.throws(()=>parseWavHeader(empty,48),HttpError);});
test('rejects non-WAV upload intents',()=>assert.throws(()=>validateUploadBatch({idempotencyKey:'x'.repeat(16),psiuUnitId:'unit',source:'manual',files:[{clientFileId:'a'.repeat(16),fileName:'sample.mp3',contentType:'audio/mpeg',byteLength:44,recordedAt:new Date().toISOString()}]}),HttpError));
test('requires observed UID only for PSIU captures',()=>assert.throws(()=>validateUploadBatch({idempotencyKey:'x'.repeat(16),psiuUnitId:'unit',source:'psiu_capture',files:[{clientFileId:'a'.repeat(16),fileName:'sample.wav',contentType:'audio/wav',byteLength:44,recordedAt:new Date().toISOString()}]}),HttpError));
test('rejects unsupported WAV headers',()=>assert.throws(()=>parseWavHeader(Buffer.from('not-a-wave'),10),HttpError));
