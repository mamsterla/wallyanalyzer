import type { PsiuStatus } from '@wally/contracts';

export class PsiuUnavailableError extends Error { constructor() { super('PSIU is unavailable.'); } }
export interface PsiuClient { scanUid(): Promise<string>; getStatus(): Promise<PsiuStatus>; startCapture(): Promise<PsiuStatus>; stopCapture(): Promise<PsiuStatus>; getCompletedCapture(): Promise<Blob | null>; }
export type FetchLike = typeof fetch;

/** Uses the local proxy during development and the firmware 1.2.6 CORS allowlist in HTTPS production. */
export function createPsuClient(fetchImplementation: FetchLike = fetch): PsiuClient {
  const direct = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
  const base = direct ? 'http://psiu.local' : '/api/psiu';
  const path = (local: string, production: string) => direct ? `${base}${production}` : `${base}${local}`;
  return {
    async scanUid() { const value = await requestJson(fetchImplementation, path('/uid','/uid')); const uid = asRecord(value).uid; if (typeof uid !== 'string' || !uid.trim() || uid.trim().length > 256) throw new PsiuUnavailableError(); return uid.trim(); },
    async getStatus() { return requestStatus(fetchImplementation, path('/status','/status')); },
    async startCapture() { return capture(fetchImplementation, path('/capture','/api/sampling'), true, direct, path('/status','/status')); },
    async stopCapture() { return capture(fetchImplementation, path('/capture','/api/sampling'), false, direct, path('/status','/status')); },
    async getCompletedCapture() { let response: Response; try { response = await fetchImplementation(path('/wav','/audio.wav'), direct ? { headers: { range: 'bytes=0-' } } : undefined); } catch { throw new PsiuUnavailableError(); } if (response.status === 404) return null; if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('audio/wav')) throw new PsiuUnavailableError(); return response.blob(); },
  };
}
async function capture(fetchImplementation: FetchLike, endpoint: string, running: boolean, direct: boolean, statusPath: string): Promise<PsiuStatus> { const init={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({running})}; if(!direct)return requestStatus(fetchImplementation,endpoint,init); await requestJson(fetchImplementation,endpoint,init); return requestStatus(fetchImplementation,statusPath); }
async function requestJson(fetchImplementation:FetchLike,input:RequestInfo|URL,init?:RequestInit):Promise<unknown>{let response:Response;try{response=init===undefined?await fetchImplementation(input):await fetchImplementation(input,init)}catch{throw new PsiuUnavailableError()}if(!response.ok)throw new PsiuUnavailableError();try{return await response.json()}catch{throw new PsiuUnavailableError()}}
async function requestStatus(fetchImplementation: FetchLike, input: RequestInfo | URL, init?: RequestInit): Promise<PsiuStatus> { return parseStatus(await requestJson(fetchImplementation,input,init)); }
function parseStatus(value: unknown): PsiuStatus { const status = asRecord(value); return { uid: asString(status.uid, 'Unknown'), uptimeMs: asNumber(status.uptime_ms), sampleRateHz: asNumber(status.sample_rate_hz), recording: Boolean(status.recording), xlr: Boolean(status.xlr), bufferCount: asNumber(status.buffer_count), recorderState: asString(status.recorder_state, 'unknown'), pagesWritten: asNumber(status.pages_written), droppedHalves: asNumber(status.dropped_halves), badBlockCount: asNumber(status.bad_block_count), dmaErrors: asNumber(status.dma_errors), i2sErrors: asNumber(status.i2s_errors), recordingCount: asNumber(status.recording_count) }; }
function asRecord(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PsiuUnavailableError(); return value as Record<string, unknown>; }
function asString(value: unknown, fallback: string): string { return typeof value === 'string' && value.length > 0 ? value : fallback; }
function asNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
