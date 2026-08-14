import assert from 'node:assert/strict';
import test from 'node:test';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { parsePsiuCredential, resolvePsiuAuthorization } from './local.js';

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

test('accepts an opaque authorization value for future firmware authentication', () => {
  assert.equal(parsePsiuCredential(JSON.stringify({ authorization: 'Bearer opaque-firmware-token' })), 'Bearer opaque-firmware-token');
});

test('rejects missing or malformed PSIU Secrets Manager credentials without including values', async () => {
  await assert.rejects(() => resolvePsiuAuthorization({ environment: {} }), /Missing required PSIU_CREDENTIAL_SECRET_ARN/);
  assert.throws(() => parsePsiuCredential('{"username":"operator"}'), /authorization value or username and password/);
  assert.throws(() => parsePsiuCredential('not-json'), /valid JSON/);
});
