import { describe, expect, it, vi } from 'vitest';
import { createPsuClient, PsiuUnavailableError } from './psiuClient.js';

const status = {
  uid: 'PSIU-001',
  uptime_ms: 12_000,
  sample_rate_hz: 192_000,
  recording: false,
  xlr: true,
  buffer_count: 7,
  recorder_state: 'idle',
  pages_written: 3,
  dropped_halves: 0,
  bad_block_count: 0,
  dma_errors: 0,
  i2s_errors: 0,
  recording_count: 2,
};

describe('PSIU client', () => {
  it('scans only a valid local PSIU UID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ uid: 'psiu-uid-001', telemetry: 'discarded' }));
    const client = createPsuClient(fetchMock);

    await expect(client.scanUid()).resolves.toBe('psiu-uid-001');
    expect(fetchMock).toHaveBeenCalledWith('/api/psiu/uid');
  });

  it('uses direct fixed HTTP firmware routes outside local development for the temporary demonstration', async () => {
    vi.stubGlobal('window', { location: { hostname: 'wally-analytics.app' } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...status, recording: true }))
      .mockResolvedValueOnce(jsonResponse({ ...status, recording: false }))
      .mockResolvedValueOnce(new Response(new Blob(['RIFF____WAVE'], { type: 'audio/wav' }), { status: 206, headers: { 'content-type': 'audio/wav' } }));
    const client = createPsuClient(fetchMock);
    await client.startCapture();
    await client.stopCapture();
    await client.getCompletedCapture();
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://psiu.local/api/sampling', expect.objectContaining({ method: 'POST', body: '{"running":true}' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://psiu.local/api/sampling', expect.objectContaining({ method: 'POST', body: '{"running":false}' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://psiu.local/audio.wav', expect.objectContaining({ headers: { range: 'bytes=0-' } }));
    vi.unstubAllGlobals();
  });

  it('rejects missing local PSIU UID values', async () => {
    const client = createPsuClient(vi.fn().mockResolvedValue(jsonResponse({ telemetry: true })));
    await expect(client.scanUid()).rejects.toBeInstanceOf(PsiuUnavailableError);
  });

  it('reads proxied status and maps firmware fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status));
    const client = createPsuClient(fetchMock);

    await expect(client.getStatus()).resolves.toMatchObject({ uid: 'PSIU-001', sampleRateHz: 192_000, xlr: true, bufferCount: 7 });
    expect(fetchMock).toHaveBeenCalledWith('/api/psiu/status');
  });

  it('sends capture actions only to the same-origin local proxy', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...status, recording: true }))
      .mockResolvedValueOnce(jsonResponse({ ...status, recording: false }));
    const client = createPsuClient(fetchMock);

    await client.startCapture();
    await client.stopCapture();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/psiu/capture', expect.objectContaining({ method: 'POST', body: '{"running":true}' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/psiu/capture', expect.objectContaining({ method: 'POST', body: '{"running":false}' }));
  });

  it('returns completed WAV bytes and treats no recording as empty state', async () => {
    const wav = new Blob(['RIFF____WAVE'], { type: 'audio/wav' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(wav, { status: 206, headers: { 'content-type': 'audio/wav', 'content-range': 'bytes 0-11/12' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const client = createPsuClient(fetchMock);

    await expect(client.getCompletedCapture()).resolves.toMatchObject({ type: 'audio/wav', size: 12 });
    await expect(client.getCompletedCapture()).resolves.toBeNull();
  });

  it('normalizes proxy absence and invalid audio content to unavailable', async () => {
    const client = createPsuClient(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(client.getStatus()).rejects.toBeInstanceOf(PsiuUnavailableError);
    const invalidAudio = createPsuClient(vi.fn().mockResolvedValue(jsonResponse({ message: 'unavailable' })));
    await expect(invalidAudio.getCompletedCapture()).rejects.toBeInstanceOf(PsiuUnavailableError);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
