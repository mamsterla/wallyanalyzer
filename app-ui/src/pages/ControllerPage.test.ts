import { describe, expect, it } from 'vitest';
import { queueCapturedPsiuWav } from './ControllerPage.js';

describe('PSIU capture handoff', () => {
  it('adds a completed WAV with a stable client upload identity and assigned unit', () => {
    const file = new File(['RIFF____WAVE'], 'capture.wav', { type: 'audio/wav', lastModified: 1_700_000_000_000 });
    const queued = queueCapturedPsiuWav(file, 'unit-1');

    expect(queued).toMatchObject({ file, psiuUnitId: 'unit-1', recordedAt: '2023-11-14T22:13:20.000Z' });
    expect(queued.clientFileId).toMatch(/^[a-f0-9]{32}$/);
  });

  it('does not queue a capture without an assigned unit', () => {
    const file = new File(['RIFF____WAVE'], 'capture.wav', { type: 'audio/wav' });
    expect(() => queueCapturedPsiuWav(file, '')).toThrow('PSIU is unavailable.');
  });
});
