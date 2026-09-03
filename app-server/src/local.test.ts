import assert from 'node:assert/strict';
import test from 'node:test';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createLocalServer, parsePsiuCredential, resolvePsiuAuthorization } from './local.js';

test('resolves PSIU authorization from a Secrets Manager ARN', async () => {
  let requestedSecretId: string | undefined;
  const authorization = await resolvePsiuAuthorization({
    environment: { PSIU_CREDENTIAL_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:psiu' },
    secrets: { send: async (command: GetSecretValueCommand) => {
      requestedSecretId = command.input.SecretId;
      return { SecretString: JSON.stringify({ username: 'operator', password: 'not-in-source' }) };
    } },
  });
  assert.equal(requestedSecretId, 'arn:aws:secretsmanager:us-east-1:123456789012:secret:psiu');
  assert.equal(authorization, `Basic ${Buffer.from('operator:not-in-source').toString('base64')}`);
});

test('forwards authenticated audio.wav bytes and content headers through local WAV proxy', async () => {
  const wav = Buffer.from('RIFF____WAVEpayload');
  const server = await createLocalServer({
    authorization: 'Basic test',
    environment: { PSIU_BASE_URL: 'http://psiu.local' },
    fetchImplementation: (async (input, init) => {
      assert.equal(String(input), 'http://psiu.local/audio.wav');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Basic test');
      return new Response(wav, { status: 206, headers: { 'content-type': 'audio/wav', 'content-length': String(wav.length), 'content-range': `bytes 0-${wav.length - 1}/${wav.length}`, 'accept-ranges': 'bytes' } });
    }) as typeof fetch,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/psiu/wav`);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('content-range'), `bytes 0-${wav.length - 1}/${wav.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('proxies only a valid unauthenticated PSIU UID without telemetry or cache persistence', async () => {
  const server = await createLocalServer({
    environment: { PSIU_BASE_URL: 'http://psiu.local' },
    fetchImplementation: (async (input, init) => {
      assert.equal(String(input), 'http://psiu.local/uid');
      assert.equal(new Headers(init?.headers).get('authorization'), null);
      return new Response(JSON.stringify({ uid: 'psiu-uid-001', telemetry: 'discarded' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/psiu/uid`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { uid: 'psiu-uid-001' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('rejects malformed UID responses and unavailable PSIU scan targets', async () => {
  for (const [fetchImplementation, expectedStatus] of [
    [(async () => new Response(JSON.stringify({ telemetry: true }), { status: 200 })) as typeof fetch, 502],
    [(async () => { throw new TypeError('network unavailable'); }) as typeof fetch, 503],
  ] as const) {
    const server = await createLocalServer({ environment: { PSIU_BASE_URL: 'http://psiu.local' }, fetchImplementation });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/psiu/uid`);
      assert.equal(response.status, expectedStatus);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test('accepts an opaque authorization value for future firmware authentication', () => {
  assert.equal(parsePsiuCredential(JSON.stringify({ authorization: 'Bearer opaque-firmware-token' })), 'Bearer opaque-firmware-token');
});

test('rejects missing or malformed PSIU Secrets Manager credentials without including values', async () => {
  await assert.rejects(() => resolvePsiuAuthorization({ environment: {} }), /Missing required PSIU_CREDENTIAL_SECRET_ARN/);
  assert.throws(() => parsePsiuCredential('{"username":"operator"}'), /authorization value or username and password/);
  assert.throws(() => parsePsiuCredential('not-json'), /valid JSON/);
});
