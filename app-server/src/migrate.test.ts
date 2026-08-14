import assert from 'node:assert/strict';
import test from 'node:test';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { databaseSettings, parseDatabaseSecret } from './migrate.js';

test('databaseSettings resolves standard RDS JSON with only a secret ARN reference', async () => {
  let requestedSecretId: string | undefined;
  const settings = await databaseSettings({
    environment: { DATABASE_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:database', DATABASE_PROXY_HOST: 'proxy.internal', DATABASE_NAME: 'wally', DATABASE_SSL: 'require' },
    secrets: { send: async (command: GetSecretValueCommand) => { requestedSecretId = command.input.SecretId; return { SecretString: JSON.stringify({ username: 'dbuser', password: 'not-logged', host: 'database.internal', port: 5432, dbname: 'ignored' }) }; } },
  });
  assert.equal(requestedSecretId, 'arn:aws:secretsmanager:us-east-1:123456789012:secret:database');
  assert.deepEqual(settings, { host: 'proxy.internal', port: 5432, database: 'wally', user: 'dbuser', password: 'not-logged', ssl: { rejectUnauthorized: true } });
});

test('database secret parsing rejects missing credentials without disclosing secret content', () => {
  assert.throws(() => parseDatabaseSecret('{"username":"dbuser"}'), /username and password/);
  assert.throws(() => parseDatabaseSecret('not-json'), /valid JSON/);
});
