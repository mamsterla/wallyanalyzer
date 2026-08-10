import type { PsiuCaptureInfo, PsiuStatus } from '@wally/contracts';

export class PsiuUnavailableError extends Error {
  constructor() {
    super('PSIU is unavailable.');
  }
}

export interface PsiuClient {
  getStatus(): Promise<PsiuStatus>;
  startCapture(): Promise<PsiuStatus>;
  stopCapture(): Promise<PsiuStatus>;
  getCompletedCapture(completedAt: string): Promise<PsiuCaptureInfo | null>;
}

export type FetchLike = typeof fetch;

/**
 * Browser client for the local app-server PSIU proxy. The proxy owns the LAN
 * device address and temporary firmware credentials, keeping direct PSIU CORS
 * requirements out of this milestone's browser path.
 */
export function createPsuClient(fetchImplementation: FetchLike = fetch): PsiuClient {
  return {
    async getStatus() {
      return requestStatus(fetchImplementation, '/api/psiu/status');
    },
    async startCapture() {
      return requestStatus(fetchImplementation, '/api/psiu/capture', captureRequest(true));
    },
    async stopCapture() {
      return requestStatus(fetchImplementation, '/api/psiu/capture', captureRequest(false));
    },
    async getCompletedCapture(completedAt: string) {
      let response: Response;
      try {
        response = await fetchImplementation('/api/psiu/wav');
      } catch {
        throw new PsiuUnavailableError();
      }
      if (response.status === 404) return null;
      if (!response.ok) throw new PsiuUnavailableError();
      return parseCapture(await response.json(), completedAt);
    },
  };
}

function captureRequest(running: boolean): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ running }) };
}

async function requestStatus(fetchImplementation: FetchLike, input: RequestInfo | URL, init?: RequestInit): Promise<PsiuStatus> {
  let response: Response;
  try {
    response = await fetchImplementation(input, init);
  } catch {
    throw new PsiuUnavailableError();
  }
  if (!response.ok) throw new PsiuUnavailableError();
  return parseStatus(await response.json());
}

function parseStatus(value: unknown): PsiuStatus {
  const status = asRecord(value);
  return {
    uid: asString(status.uid, 'Unknown'),
    uptimeMs: asNumber(status.uptime_ms),
    sampleRateHz: asNumber(status.sample_rate_hz),
    recording: Boolean(status.recording),
    xlr: Boolean(status.xlr),
    bufferCount: asNumber(status.buffer_count),
    recorderState: asString(status.recorder_state, 'unknown'),
    pagesWritten: asNumber(status.pages_written),
    droppedHalves: asNumber(status.dropped_halves),
    badBlockCount: asNumber(status.bad_block_count),
    dmaErrors: asNumber(status.dma_errors),
    i2sErrors: asNumber(status.i2s_errors),
    recordingCount: asNumber(status.recording_count),
  };
}

function parseCapture(value: unknown, completedAt: string): PsiuCaptureInfo {
  const capture = asRecord(value);
  return {
    sampleRateHz: asNumber(capture.sample_rate_hz),
    channels: asNumber(capture.channels),
    bits: asNumber(capture.bits),
    dataBytes: asNumber(capture.data_bytes),
    durationMs: asNumber(capture.duration_ms),
    droppedHalves: asNumber(capture.dropped_halves),
    recordingCount: asNumber(capture.recording_count),
    completedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PsiuUnavailableError();
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
