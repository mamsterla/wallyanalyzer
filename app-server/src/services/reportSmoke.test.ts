import assert from 'node:assert/strict';
import test from 'node:test';
import { fabricatedTrackingErrorWav, SMOKE_DURATION_SECONDS, SMOKE_SAMPLE_RATE_HZ } from './reportSmoke.js';

test('fabricates a one-minute stereo 1 kHz PCM WAV smoke fixture',()=>{const wav=fabricatedTrackingErrorWav();assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt16LE(22),2);assert.equal(wav.readUInt32LE(24),SMOKE_SAMPLE_RATE_HZ);assert.equal(wav.readUInt16LE(34),16);assert.equal(wav.readUInt32LE(40),SMOKE_SAMPLE_RATE_HZ*SMOKE_DURATION_SECONDS*4);assert.equal(wav.length,44+SMOKE_SAMPLE_RATE_HZ*SMOKE_DURATION_SECONDS*4);assert.notEqual(wav.readInt16LE(44+(SMOKE_SAMPLE_RATE_HZ/4000)*4),0);});
