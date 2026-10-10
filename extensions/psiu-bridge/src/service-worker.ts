export {};
declare const chrome: any;

type Command = 'probe' | 'uid' | 'status' | 'signal' | 'inputsel' | 'samplerate' | 'sampling' | 'audio' | 'audio-cancel';
type Request = { type: 'request'; requestId: string; command: Command; running?: boolean; xlr?: boolean; hz?: number; targetRequestId?: string };
const base = 'http://psiu.local';
const chunkBytes = 48 * 1024;
const audioRangeBytes = 1 * 1024 * 1024;
const audioTransfers = new Map<string, AbortController>();
const trace = (event: string, details: Record<string, unknown> = {}) => console.info('[Wally PSIU Bridge]', event, details);
const failure = (error: unknown) => error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name !== 'wally-psiu-bridge') return;
  port.onMessage.addListener((message: Request) => void handle(port, message));
});

async function handle(port: any, message: Request) {
  if (!message || message.type !== 'request' || typeof message.requestId !== 'string') return;
  try {
    switch (message.command) {
      case 'probe': return reply(port, message.requestId, { available: true });
      case 'uid': return reply(port, message.requestId, await json('/uid'));
      case 'status': return reply(port, message.requestId, await json('/status'));
      case 'signal': return reply(port, message.requestId, await json('/api/signal'));
      case 'inputsel':
        if (typeof message.xlr !== 'boolean') throw new Error('Invalid input selection request.');
        await json('/api/inputsel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ xlr: message.xlr }) });
        return reply(port, message.requestId, await json('/status'));
      case 'samplerate':
        if (message.hz !== 96_000 && message.hz !== 192_000) throw new Error('Invalid sample-rate request.');
        await json('/samplerate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hz: message.hz }) });
        return reply(port, message.requestId, await json('/status'));
      case 'sampling':
        if (typeof message.running !== 'boolean') throw new Error('Invalid sampling request.');
        return reply(port, message.requestId, await setRecording(message.running));
      case 'audio': return runAudioTransfer(port, message.requestId);
      case 'audio-cancel':
        if (typeof message.targetRequestId !== 'string') throw new Error('Invalid audio cancellation request.');
        trace('audio-cancel', { requestId: message.targetRequestId, active: audioTransfers.has(message.targetRequestId) });
        audioTransfers.get(message.targetRequestId)?.abort();
        return reply(port, message.requestId, { cancelled: true });
      default: throw new Error('Unsupported bridge command.');
    }
  } catch (error) {
    port.postMessage({ requestId: message.requestId, type: 'error', message: error instanceof Error ? error.message : 'PSIU bridge request failed.' });
  }
}

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(`PSIU returned HTTP ${response.status} for ${path}.`);
  return response.json();
}

async function setRecording(running: boolean): Promise<unknown> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await json('/api/sampling', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ running }) }); } catch (error) { lastError = error instanceof Error ? error : new Error('PSIU sampling request failed.'); }
    try {
      const status = await json('/status');
      if (typeof (status as { recording?: unknown }).recording === 'boolean' && (status as { recording: boolean }).recording === running) return status;
      lastError = new Error(`PSIU did not confirm recording=${running}.`);
    } catch (error) { lastError = error instanceof Error ? error : new Error('PSIU status request failed.'); }
    if (attempt < 2) await wait(500);
  }
  try {
    await json(running ? '/api/samplestart' : '/api/samplestop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: true }) });
    const status = await json('/status');
    if (typeof (status as { recording?: unknown }).recording === 'boolean' && (status as { recording: boolean }).recording === running) return status;
    lastError = new Error(`PSIU fallback did not confirm recording=${running}.`);
  } catch (error) { lastError = error instanceof Error ? error : new Error('PSIU sampling fallback failed.'); }
  throw lastError ?? new Error(`PSIU did not confirm recording=${running}.`);
}

function wait(milliseconds: number) { return new Promise<void>((resolve) => setTimeout(resolve, milliseconds)); }

async function runAudioTransfer(port: any, requestId: string) {
  const controller = new AbortController();
  audioTransfers.set(requestId, controller);
  trace('audio-transfer-start', { requestId });
  try { await streamAudio(port, requestId, controller.signal); }
  catch (error) {
    if (controller.signal.aborted) { trace('audio-transfer-cancelled', { requestId }); return; }
    trace('audio-transfer-failed', { requestId, ...failure(error) });
    throw error;
  } finally { audioTransfers.delete(requestId); }
}

async function streamAudio(port: any, requestId: string, signal: AbortSignal) {
  let offset = 0;
  let totalBytes: number | undefined;
  let retriesWithoutProgress = 0;
  let rangeNumber = 0;
  while (totalBytes === undefined || offset < totalBytes) {
    const startingOffset = offset;
    const rangeEnd = offset + audioRangeBytes - 1;
    rangeNumber += 1;
    trace('audio-range-request', { requestId, rangeNumber, offset, rangeEnd, totalBytes });
    try {
      const response = await fetch(`${base}/audio.wav`, { headers: { range: `bytes=${offset}-${rangeEnd}`, connection: 'close' }, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
      if (response.status === 404 && offset === 0) return reply(port, requestId, null);
      if (response.status !== 206 || !response.headers.get('content-type')?.toLowerCase().startsWith('audio/wav') || !response.body) throw new Error('PSIU audio range is unavailable.');
      const contentRange = response.headers.get('content-range');
      trace('audio-range-response', { requestId, rangeNumber, status: response.status, contentRange, contentType: response.headers.get('content-type') });
      const match = contentRange?.match(new RegExp(`^bytes ${offset}-(\\d+)/(\\d+)$`));
      if (!match) throw new Error('PSIU returned an invalid audio range.');
      totalBytes = Number(match[2]);
      if (!Number.isSafeInteger(totalBytes) || totalBytes < 44) throw new Error('PSIU returned an invalid audio length.');
      if (offset === 0) port.postMessage({ requestId, type: 'audio-start', totalBytes });
      const reader = response.body.getReader();
      let nextTraceAt = offset + 256 * 1024;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        if (!next.value.byteLength || offset + next.value.byteLength > totalBytes) throw new Error('PSIU returned an invalid audio range body.');
        for (let chunkOffset = 0; chunkOffset < next.value.length; chunkOffset += chunkBytes) port.postMessage({ requestId, type: 'audio-chunk', data: base64(next.value.subarray(chunkOffset, chunkOffset + chunkBytes)) });
        offset += next.value.byteLength;
        if (offset >= nextTraceAt || offset === totalBytes) { trace('audio-range-progress', { requestId, rangeNumber, receivedBytes: offset, rangeBytes: offset - startingOffset, totalBytes }); nextTraceAt = offset + 256 * 1024; }
      }
      if (offset === startingOffset) throw new Error('PSIU returned an empty audio range.');
      trace('audio-range-complete', { requestId, rangeNumber, receivedBytes: offset, rangeBytes: offset - startingOffset, totalBytes });
      retriesWithoutProgress = 0;
    } catch (error) {
      if (signal.aborted) throw error;
      if (offset > startingOffset) { trace('audio-range-partial-retry', { requestId, rangeNumber, receivedBytes: offset, rangeBytes: offset - startingOffset, ...failure(error) }); retriesWithoutProgress = 0; continue; }
      retriesWithoutProgress += 1;
      trace('audio-range-retry', { requestId, rangeNumber, offset, retriesWithoutProgress, ...failure(error) });
      if (retriesWithoutProgress >= 3) throw error instanceof Error ? error : new Error('PSIU audio range failed.');
      await wait(1_000);
    }
  }
  trace('audio-transfer-complete', { requestId, totalBytes: offset });
  port.postMessage({ requestId, type: 'audio-complete' });
}

function reply(port: any, requestId: string, value: unknown) { port.postMessage({ requestId, type: 'result', value }); }
function base64(bytes: Uint8Array) { let value = ''; for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(value); }
