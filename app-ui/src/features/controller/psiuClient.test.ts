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
  it('reads proxied status and maps firmware fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status));
    const client = createPsuClient(fetchMock);

    await expect(client.getStatus()).resolves.toMatchObject({ uid: 'PSIU-001', sampleRateHz: 192_000, xlr: true, bufferCount: 7 });
    expect(fetchMock).toHaveBeenCalledWith('/api/psiu/status', undefined);
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

  it('maps completed recording metadata and treats no recording as empty state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ available: true, sample_rate_hz: 192_000, channels: 2, bits: 32, data_bytes: 1_000, duration_ms: 2_500, dropped_halves: 0, recording_count: 3 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const client = createPsuClient(fetchMock);

    await expect(client.getCompletedCapture('2026-08-09T14:00:00.000Z')).resolves.toMatchObject({ durationMs: 2_500, channels: 2, completedAt: '2026-08-09T14:00:00.000Z' });
    await expect(client.getCompletedCapture('2026-08-09T14:00:00.000Z')).resolves.toBeNull();
  });

  it('normalizes proxy absence to unavailable', async () => {
    const client = createPsuClient(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(client.getStatus()).rejects.toBeInstanceOf(PsiuUnavailableError);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
