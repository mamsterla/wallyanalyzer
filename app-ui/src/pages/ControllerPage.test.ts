import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
import { localInventoryPreview, queueCapturedPsiuWav } from './ControllerPage.js';

describe('local inventory scan panel', () => {
  it('previews local UID and optional serial without cloud inventory claims', () => {
    expect(localInventoryPreview('uid-1', '')).toContain('No cloud change has been made');
    expect(localInventoryPreview('uid-1', 'Serial 7')).toContain('Serial 7 · uid-1');
  });
});

describe('PSIU capture handoff', () => {
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
