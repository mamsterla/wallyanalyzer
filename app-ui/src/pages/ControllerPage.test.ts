// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
import { captureEligibility, queueCapturedPsiuWav, sha256Base64 } from './ControllerPage.js';

describe('PSIU capture eligibility', () => {
  const status={uid:'uid-1',uptimeMs:0,sampleRateHz:0,recording:false,xlr:false,bufferCount:0,recorderState:'idle',pagesWritten:0,droppedHalves:0,badBlockCount:0,dmaErrors:0,i2sErrors:0,codecOk:true,codecAttempts:1,codecRecoveries:0,audioAlive:true,levelDb:[-60,-60] as [number,number],recordingCount:0};
  const system={id:'system-1',name:'System',notes:'',components:{turntable:'TT',tonearm:'Arm',cartridge:'Cart'},active:true,createdAt:'2026-01-01T00:00:00.000Z'};
  it('requires active system and matching enabled assignment before capture', () => { expect(captureEligibility(status,[{id:'unit-1',serialNumber:'serial',uid:'uid-1',status:'enabled'}],[])).toMatchObject({ok:false});expect(captureEligibility(status,[{id:'unit-1',serialNumber:'serial',uid:'different',status:'enabled'}],[system])).toMatchObject({ok:false});expect(captureEligibility(status,[{id:'unit-1',serialNumber:'serial',uid:'uid-1',status:'disabled'}],[system])).toMatchObject({ok:false});expect(captureEligibility(status,[{id:'unit-1',serialNumber:'serial',uid:'uid-1',status:'enabled'}],[system])).toMatchObject({ok:true,unit:{id:'unit-1'}}); });
});

describe('PSIU capture handoff', () => {
  it('calculates an immutable SHA-256 digest for the raw upload', async () => {
    expect(await sha256Base64(new Blob(['abc']))).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });

  it('adds a completed WAV with a stable client upload identity and assigned unit', () => {
    const file = new NodeFile(['RIFF____WAVE'], 'capture.wav', { type: 'audio/wav', lastModified: 1_700_000_000_000 }) as unknown as File;
    const queued = queueCapturedPsiuWav(file, 'unit-1', 'uid-1', [{ id: 'unit-1', serialNumber: 'serial-1', uid: 'uid-1', status: 'enabled' }]);

    expect(queued).toMatchObject({ file, psiuUnitId: 'unit-1', observedPsiuUid: 'uid-1', recordedAt: '2023-11-14T22:13:20.000Z' });
    expect(queued.clientFileId).toMatch(/^[a-f0-9]{32}$/);
  });

  it('does not queue a capture without an assigned unit', () => {
    const file = new NodeFile(['RIFF____WAVE'], 'capture.wav', { type: 'audio/wav' }) as unknown as File;
    expect(() => queueCapturedPsiuWav(file, '', 'uid-1', [])).toThrow('PSIU is unavailable.');
  });

  it('does not queue a capture for a different assigned UID', () => {
    const file = new NodeFile(['RIFF____WAVE'], 'capture.wav', { type: 'audio/wav' }) as unknown as File;
    expect(() => queueCapturedPsiuWav(file, 'unit-1', 'observed-uid', [{ id: 'unit-1', serialNumber: 'serial-1', uid: 'assigned-uid', status: 'enabled' }])).toThrow('PSIU is unavailable.');
  });
});
