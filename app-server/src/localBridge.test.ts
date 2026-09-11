import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalServer, pairLocalBridge, promptMacOsPairing, validatePsiuBaseUrl } from './local.js';

const development = { NODE_ENV: 'development', PSIU_BASE_URL: 'http://psiu.local' } as NodeJS.ProcessEnv;

const localResolver = async () => ['192.168.1.20'];
async function runningServer(fetchImplementation: typeof fetch, resolveAddresses = localResolver) {
  const server = await createLocalServer({ environment: development, fetchImplementation, resolveAddresses });
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
  const upstream: typeof fetch = async (input, init) => { calls.push(String(input)); assert.equal(new Headers(init?.headers).get('host'), 'psiu.local'); return new Response('RIFF____WAVE', { status: 200, headers: { 'content-type': 'audio/wav' } }); };
  const { server, base } = await runningServer(upstream);
  try { const response = await fetch(`${base}/psiu/wav`, { headers: { origin: 'https://wally-analytics.app' } }); assert.equal(response.status, 200); assert.deepEqual(calls, ['http://192.168.1.20/audio.wav']); } finally { await close(server); }
});

test('pairing stores target and authorization without echoing authorization', async () => {
  let saved = '';
  await pairLocalBridge('http://psiu.local', { store: { load: () => undefined, save: value => { saved = value; } }, prompt: () => ({ username: 'operator', password: 'device-password' }), resolveAddresses: localResolver });
  assert.deepEqual(JSON.parse(saved), { baseUrl: 'http://psiu.local', authorization: `Basic ${Buffer.from('operator:device-password').toString('base64')}` });
  const calls: unknown[][] = [];
  const spawn = ((_command: string, args: string[]) => { calls.push(args); return { status: 0, stdout: args[1]?.includes('password') ? 'secret\n' : 'operator\n' }; }) as typeof import('node:child_process').spawnSync;
  assert.deepEqual(promptMacOsPairing(spawn), { username: 'operator', password: 'secret' });
  assert.match(String(calls[1]?.[1]), /with hidden answer/);
});

test('resolves psiu.local before each protected request and blocks rebinding before authorization forwarding', async () => {
  let resolutions = 0, upstreamCalls = 0;
  const resolver = async () => ++resolutions === 1 ? ['192.168.1.20'] : ['8.8.8.8'];
  const server = await createLocalServer({ environment: development, authorization: 'Basic never-forward', resolveAddresses: resolver, fetchImplementation: (async () => { upstreamCalls += 1; return new Response('{}'); }) as typeof fetch });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { const response = await fetch(`http://127.0.0.1:${address.port}/psiu/status`); assert.equal(response.status, 403); assert.equal(upstreamCalls, 0); } finally { await close(server); }
});

test('bridge rejects upstream redirects without following a second target', async () => {
  let calls = 0, redirect = '';
  const upstream: typeof fetch = async (_input, init) => { calls += 1; redirect = String(init?.redirect); return new Response(null, { status: 302, headers: { location: 'http://8.8.8.8/' } }); };
  const { server, base } = await runningServer(upstream);
  try {
    const response = await fetch(`${base}/psiu/status`, { headers: { origin: 'https://wally-analytics.app' } });
    assert.equal(response.status, 302);
    assert.equal(calls, 1);
    assert.equal(redirect, 'error');
  } finally { await close(server); }
});

test('invalid paired target rejects before any authorization can be forwarded', async () => {
  let calls = 0;
  await assert.rejects(() => createLocalServer({ environment: { NODE_ENV: 'development', PSIU_BASE_URL: 'http://8.8.8.8' }, authorization: 'Basic never-forward', fetchImplementation: (async () => { calls += 1; return new Response(); }) as typeof fetch }), /private, link-local, or loopback/);
  assert.equal(calls, 0);
  for (const target of ['http://user:pass@psiu.local', 'http://psiu.local/path', 'http://psiu.local/?q=1', 'https://example.com']) await assert.rejects(() => validatePsiuBaseUrl(target, localResolver));
});
