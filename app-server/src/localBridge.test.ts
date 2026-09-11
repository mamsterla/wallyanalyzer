import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalServer, pairLocalBridge, promptMacOsPairing, validatePsiuBaseUrl } from './local.js';

const development = { NODE_ENV: 'development', PSIU_BASE_URL: 'http://psiu.local' } as NodeJS.ProcessEnv;

async function runningServer(fetchImplementation: typeof fetch) {
  const server = await createLocalServer({ environment: development, fetchImplementation });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, base: `http://127.0.0.1:${address.port}` };
}
async function close(server: import('node:http').Server) { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

test('local bridge restricts origins and fixed PSIU routes', async () => {
  const upstream: typeof fetch = async input => new Response(String(input).endsWith('/status') ? JSON.stringify({ uid: 'unit', recording: false }) : JSON.stringify({ uid: 'unit' }), { status: 200, headers: { 'content-type': 'application/json' } });
  const { server, base } = await runningServer(upstream);
  try {
    const allowed = await fetch(`${base}/psiu/status`, { headers: { origin: 'https://wally-analytics.app' } });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://wally-analytics.app');
    const denied = await fetch(`${base}/psiu/status`, { headers: { origin: 'https://evil.example' } }); assert.equal(denied.status, 403);
    const preflight = await fetch(`${base}/psiu/capture`, { method: 'OPTIONS', headers: { origin: 'https://wally-analytics.app', 'access-control-request-private-network': 'true' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    const unknown = await fetch(`${base}/psiu/anything`, { headers: { origin: 'https://wally-analytics.app' } }); assert.equal(unknown.status, 404);
  } finally { await close(server); }
});

test('bridge forwards the tested audio.wav route', async () => {
  const calls: string[] = [];
  const upstream: typeof fetch = async input => { calls.push(String(input)); return new Response('RIFF____WAVE', { status: 200, headers: { 'content-type': 'audio/wav' } }); };
  const { server, base } = await runningServer(upstream);
  try { const response = await fetch(`${base}/psiu/wav`, { headers: { origin: 'https://wally-analytics.app' } }); assert.equal(response.status, 200); assert.deepEqual(calls, ['http://psiu.local/audio.wav']); } finally { await close(server); }
});

test('pairing stores target and authorization without echoing authorization', async () => {
  let saved = '';
  await pairLocalBridge('http://psiu.local', { store: { load: () => undefined, save: value => { saved = value; } }, prompt: () => ({ username: 'operator', password: 'device-password' }) });
  assert.deepEqual(JSON.parse(saved), { baseUrl: 'http://psiu.local', authorization: `Basic ${Buffer.from('operator:device-password').toString('base64')}` });
  const calls: unknown[][] = [];
  const spawn = ((_command: string, args: string[]) => { calls.push(args); return { status: 0, stdout: args[1]?.includes('password') ? 'secret\n' : 'operator\n' }; }) as typeof import('node:child_process').spawnSync;
  assert.deepEqual(promptMacOsPairing(spawn), { username: 'operator', password: 'secret' });
  assert.match(String(calls[1]?.[1]), /with hidden answer/);
});

test('invalid paired target rejects before any authorization can be forwarded', async () => {
  let calls = 0;
  await assert.rejects(() => createLocalServer({ environment: { NODE_ENV: 'development', PSIU_BASE_URL: 'http://8.8.8.8' }, authorization: 'Basic never-forward', fetchImplementation: (async () => { calls += 1; return new Response(); }) as typeof fetch }), /private, link-local, or loopback/);
  assert.equal(calls, 0);
  for (const target of ['http://user:pass@psiu.local', 'http://psiu.local/path', 'http://psiu.local/?q=1', 'https://example.com']) await assert.rejects(() => validatePsiuBaseUrl(target));
});
