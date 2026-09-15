import type { PsiuSignal, PsiuStatus } from '@wally/contracts';

export class PsiuUnavailableError extends Error { constructor(message = 'PSIU is unavailable. Wally PSIU Bridge cannot reach the device.') { super(message); } }
export interface PsiuClient { scanUid(): Promise<string>; getStatus(): Promise<PsiuStatus>; getSignal(): Promise<PsiuSignal>; setInput(xlr: boolean): Promise<PsiuStatus>; startCapture(): Promise<PsiuStatus>; stopCapture(): Promise<PsiuStatus>; getCompletedCapture(): Promise<Blob | null>; }
export type FetchLike = typeof fetch;
type BridgeCommand = 'probe' | 'uid' | 'status' | 'signal' | 'inputsel' | 'sampling' | 'audio';
type BridgeResponse = { channel: 'wally-psiu-bridge'; type: 'result' | 'error' | 'audio-chunk' | 'audio-complete'; requestId: string; value?: unknown; data?: string };
const bridgeChannel = 'wally-psiu-bridge';

/** Local Compose uses its same-origin proxy; deployed Wally uses the installed browser bridge. */
export function createPsuClient(fetchImplementation: FetchLike = fetch): PsiuClient {
  const localDevelopment = typeof window === 'undefined' || ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return localDevelopment ? createDirectClient(fetchImplementation, '/api/psiu') : createExtensionClient();
}

function createDirectClient(fetchImplementation: FetchLike, base: string): PsiuClient {
  return {
    async scanUid() { const value = await requestJson(fetchImplementation, `${base}/uid`); return uid(value); },
    async getStatus() { return requestStatus(fetchImplementation, `${base}/status`); },
    async getSignal() { return parseSignal(await requestJson(fetchImplementation, `${base}/signal`)); },
    async setInput(xlr: boolean) { return requestStatus(fetchImplementation, `${base}/input`, inputInit(xlr)); },
    async startCapture() { await requestJson(fetchImplementation, `${base}/capture`, captureInit(true)); return requestStatus(fetchImplementation, `${base}/status`); },
    async stopCapture() { await requestJson(fetchImplementation, `${base}/capture`, captureInit(false)); return requestStatus(fetchImplementation, `${base}/status`); },
    async getCompletedCapture() { return wavResponse(await response(fetchImplementation, `${base}/wav`, { headers: { range: 'bytes=0-' } })); },
  };
}

export async function isPsiuBridgeInstalled(): Promise<boolean> {
  if (typeof window === 'undefined' || ['localhost', '127.0.0.1'].includes(window.location.hostname)) return true;
  try { await bridgeRequest('probe', undefined, 1_500); return true; } catch { return false; }
}

export function createExtensionClient(): PsiuClient {
  return {
    async scanUid() { return uid(await bridgeRequest('uid')); },
    async getStatus() { return parseStatus(await bridgeRequest('status')); },
    async getSignal() { return parseSignal(await bridgeRequest('signal')); },
    async setInput(xlr: boolean) { return parseStatus(await bridgeRequest('inputsel', undefined, 10_000, xlr)); },
    async startCapture() { return parseStatus(await bridgeRequest('sampling', true)); },
    async stopCapture() { return parseStatus(await bridgeRequest('sampling', false)); },
    async getCompletedCapture() { return bridgeAudio(); },
  };
}

function bridgeRequest(command: Exclude<BridgeCommand, 'audio'>, running?: boolean, timeoutMs = 10_000, xlr?: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = window.setTimeout(() => finish(new PsiuUnavailableError()), timeoutMs);
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data as Partial<BridgeResponse> | null;
      if (!message || message.channel !== bridgeChannel || message.requestId !== requestId) return;
      if (message.type === 'result') finish(undefined, message.value);
      else if (message.type === 'error') finish(new PsiuUnavailableError());
    };
    const finish = (error?: Error, value?: unknown) => { window.clearTimeout(timer); window.removeEventListener('message', onMessage); error ? reject(error) : resolve(value); };
    window.addEventListener('message', onMessage);
    window.postMessage({ channel: bridgeChannel, type: 'request', requestId, command, ...(command === 'sampling' ? { running } : {}), ...(command === 'inputsel' ? { xlr } : {}) }, window.location.origin);
  });
}

function bridgeAudio(): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID(); const chunks: Uint8Array[] = [];
    const timer = window.setTimeout(() => finish(new PsiuUnavailableError()), 120_000);
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data as Partial<BridgeResponse> | null;
      if (!message || message.channel !== bridgeChannel || message.requestId !== requestId) return;
      if (message.type === 'result') finish(undefined, message.value === null ? null : undefined);
      else if (message.type === 'audio-chunk' && typeof message.data === 'string') chunks.push(fromBase64(message.data));
      else if (message.type === 'audio-complete') finish(undefined, new Blob(chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer), { type: 'audio/wav' }));
      else if (message.type === 'error') finish(new PsiuUnavailableError());
    };
    const finish = (error?: Error, value?: Blob | null) => { window.clearTimeout(timer); window.removeEventListener('message', onMessage); error ? reject(error) : resolve(value ?? null); };
    window.addEventListener('message', onMessage);
    window.postMessage({ channel: bridgeChannel, type: 'request', requestId, command: 'audio' }, window.location.origin);
  });
}

function fromBase64(value: string) { const binary = atob(value); return Uint8Array.from(binary, character => character.charCodeAt(0)); }
function captureInit(running: boolean): RequestInit { return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ running }) }; }
function inputInit(xlr: boolean): RequestInit { return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ xlr }) }; }
async function response(fetchImplementation: FetchLike, input: RequestInfo | URL, init?: RequestInit): Promise<Response> { try { return init === undefined ? await fetchImplementation(input) : await fetchImplementation(input, init); } catch { throw new PsiuUnavailableError(); } }
async function requestJson(fetchImplementation: FetchLike, input: RequestInfo | URL, init?: RequestInit): Promise<unknown> { const result = await response(fetchImplementation, input, init); if (!result.ok) throw new PsiuUnavailableError(); try { return await result.json(); } catch { throw new PsiuUnavailableError(); } }
async function requestStatus(fetchImplementation: FetchLike, input: RequestInfo | URL, init?: RequestInit): Promise<PsiuStatus> { return parseStatus(await requestJson(fetchImplementation, input, init)); }
async function wavResponse(result: Response): Promise<Blob | null> { if (result.status === 404) return null; if (!result.ok || !result.headers.get('content-type')?.toLowerCase().startsWith('audio/wav')) throw new PsiuUnavailableError(); return result.blob(); }
function parseSignal(value: unknown): PsiuSignal { const signal = asRecord(value); const left = asNumber(signal.L); const right = asNumber(signal.R); if (left < 0 || left > 100 || right < 0 || right > 100) throw new PsiuUnavailableError(); return { left, right }; }
function uid(value: unknown) { const parsed = asRecord(value).uid; if (typeof parsed !== 'string' || !parsed.trim() || parsed.trim().length > 256) throw new PsiuUnavailableError(); return parsed.trim(); }
function parseStatus(value: unknown): PsiuStatus { const status = asRecord(value); return { uid: asString(status.uid, 'Unknown'), uptimeMs: asNumber(status.uptime_ms), sampleRateHz: asNumber(status.sample_rate_hz), recording: Boolean(status.recording), xlr: Boolean(status.xlr), bufferCount: asNumber(status.buffer_count), recorderState: asString(status.recorder_state, 'unknown'), pagesWritten: asNumber(status.pages_written), droppedHalves: asNumber(status.dropped_halves), badBlockCount: asNumber(status.bad_block_count), dmaErrors: asNumber(status.dma_errors), i2sErrors: asNumber(status.i2s_errors), codecOk: status.codec_ok === true, codecAttempts: asNumber(status.codec_attempts), codecRecoveries: asNumber(status.codec_recoveries), audioAlive: status.audio_alive === true, levelDb: levelDb(status.level_db), recordingCount: asNumber(status.recording_count) }; }
function levelDb(value: unknown): [number, number] { if (!Array.isArray(value) || value.length !== 2 || !value.every(item => typeof item === 'number' && Number.isFinite(item))) return [-60, -60]; return [value[0] as number, value[1] as number]; }
function asRecord(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PsiuUnavailableError(); return value as Record<string, unknown>; }
function asString(value: unknown, fallback: string): string { return typeof value === 'string' && value.length > 0 ? value : fallback; }
function asNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
