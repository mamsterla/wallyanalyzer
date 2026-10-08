export {};
declare const chrome: any;

type Command = 'probe' | 'uid' | 'status' | 'signal' | 'inputsel' | 'samplerate' | 'sampling' | 'audio';
type Request = { type: 'request'; requestId: string; command: Command; running?: boolean; xlr?: boolean; hz?: number };
const base = 'http://psiu.local';
const chunkBytes = 48 * 1024;

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
      case 'audio': return streamAudio(port, message.requestId);
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

async function streamAudio(port: any, requestId: string) {
  const response = await fetch(`${base}/audio.wav`, { headers: { range: 'bytes=0-' } });
  if (response.status === 404) return reply(port, requestId, null);
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('audio/wav') || !response.body) throw new Error('PSIU audio is unavailable.');
  const reader = response.body.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    for (let offset = 0; offset < next.value.length; offset += chunkBytes) {
      port.postMessage({ requestId, type: 'audio-chunk', data: base64(next.value.subarray(offset, offset + chunkBytes)) });
    }
  }
  port.postMessage({ requestId, type: 'audio-complete' });
}

function reply(port: any, requestId: string, value: unknown) { port.postMessage({ requestId, type: 'result', value }); }
function base64(bytes: Uint8Array) { let value = ''; for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(value); }
