export {};
declare const chrome: any;

type Command = 'probe' | 'uid' | 'status' | 'sampling' | 'audio';
type Request = { type: 'request'; requestId: string; command: Command; running?: boolean };
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
      case 'sampling':
        if (typeof message.running !== 'boolean') throw new Error('Invalid sampling request.');
        await json('/api/sampling', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ running: message.running }) });
        return reply(port, message.requestId, await json('/status'));
      case 'audio': return streamAudio(port, message.requestId);
      default: throw new Error('Unsupported bridge command.');
    }
  } catch {
    port.postMessage({ requestId: message.requestId, type: 'error', message: 'PSIU bridge request failed.' });
  }
}

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error('PSIU request failed.');
  return response.json();
}

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
