import type { PsiuStatus } from '@wally/contracts';

export class PsiuUnavailableError extends Error { constructor() { super('PSIU is unavailable.'); } }
export interface PsiuClient { scanUid(): Promise<string>; getStatus(): Promise<PsiuStatus>; startCapture(): Promise<PsiuStatus>; stopCapture(): Promise<PsiuStatus>; getCompletedCapture(): Promise<Blob | null>; }
export type FetchLike = typeof fetch;

/** Direct PSIU browser mode is a temporary HTTPS-site → HTTP-device demonstration exception. */
export function createPsuClient(fetchImplementation: FetchLike = fetch): PsiuClient {
  const localDevelopment = typeof window === 'undefined' || ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const base = localDevelopment ? '/api/psiu' : 'http://psiu.local';
  return {
    async scanUid() { const value = await requestJson(fetchImplementation, `${base}/uid`); const uid = asRecord(value).uid; if (typeof uid !== 'string' || !uid.trim() || uid.trim().length > 256) throw new PsiuUnavailableError(); return uid.trim(); },
    async getStatus() { return requestStatus(fetchImplementation, `${base}/status`); },
    async startCapture() {
      await requestJson(fetchImplementation, `${base}${localDevelopment ? '/capture' : '/api/sampling'}`, captureInit(true));
      return requestStatus(fetchImplementation, `${base}/status`);
    },
    async stopCapture() {
      await requestJson(fetchImplementation, `${base}${localDevelopment ? '/capture' : '/api/sampling'}`, captureInit(false));
      return requestStatus(fetchImplementation, `${base}/status`);
    },
    async getCompletedCapture() { let response: Response; try { response = await fetchImplementation(`${base}${localDevelopment ? '/wav' : '/audio.wav'}`, { headers: { range: 'bytes=0-' } }); } catch { throw new PsiuUnavailableError(); } if (response.status === 404) return null; if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('audio/wav')) throw new PsiuUnavailableError(); return response.blob(); },
  };
}
function captureInit(running:boolean):RequestInit { return { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({running}) }; }
async function requestJson(fetchImplementation:FetchLike,input:RequestInfo|URL,init?:RequestInit):Promise<unknown>{let response:Response;try{response=init===undefined?await fetchImplementation(input):await fetchImplementation(input,init)}catch{throw new PsiuUnavailableError()}if(!response.ok)throw new PsiuUnavailableError();try{return await response.json()}catch{throw new PsiuUnavailableError()}}
async function requestStatus(fetchImplementation: FetchLike, input: RequestInfo | URL, init?: RequestInit): Promise<PsiuStatus> { return parseStatus(await requestJson(fetchImplementation,input,init)); }
function parseStatus(value: unknown): PsiuStatus { const status = asRecord(value); return { uid: asString(status.uid, 'Unknown'), uptimeMs: asNumber(status.uptime_ms), sampleRateHz: asNumber(status.sample_rate_hz), recording: Boolean(status.recording), xlr: Boolean(status.xlr), bufferCount: asNumber(status.buffer_count), recorderState: asString(status.recorder_state, 'unknown'), pagesWritten: asNumber(status.pages_written), droppedHalves: asNumber(status.dropped_halves), badBlockCount: asNumber(status.bad_block_count), dmaErrors: asNumber(status.dma_errors), i2sErrors: asNumber(status.i2s_errors), recordingCount: asNumber(status.recording_count) }; }
function asRecord(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PsiuUnavailableError(); return value as Record<string, unknown>; }
function asString(value: unknown, fallback: string): string { return typeof value === 'string' && value.length > 0 ? value : fallback; }
function asNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
