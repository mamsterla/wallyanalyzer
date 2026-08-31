import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const baseUrl = required('PSIU_BASE_URL').replace(/\/$/, '');
const secretArn = required('PSIU_CREDENTIAL_SECRET_ARN');
const credentials = await loadCredentials(secretArn);

const response = await fetch(`${baseUrl}/audio.wav`, {
  headers: { authorization: credentials.authorization, range: 'bytes=0-63' },
  signal: AbortSignal.timeout(10_000),
});
const body = Buffer.from(await response.arrayBuffer());

console.log(JSON.stringify({
  endpoint: `${baseUrl}/audio.wav`,
  status: response.status,
  contentType: response.headers.get('content-type'),
  contentLength: response.headers.get('content-length'),
  contentRange: response.headers.get('content-range'),
  acceptRanges: response.headers.get('accept-ranges'),
  bytesReceived: body.length,
  wavMagic: body.subarray(0, 12).toString('ascii'),
}, null, 2));

if (!response.ok) process.exitCode = 1;

async function loadCredentials(arn) {
  const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }));
  if (!response.SecretString) throw new Error('PSIU credential secret must use SecretString.');
  let value;
  try {
    value = JSON.parse(response.SecretString);
  } catch {
    throw new Error('PSIU credential secret must contain JSON.');
  }
  if (typeof value.authorization === 'string' && value.authorization) return { authorization: value.authorization };
  if (typeof value.username === 'string' && value.username && typeof value.password === 'string' && value.password) {
    return { authorization: `Basic ${Buffer.from(`${value.username}:${value.password}`).toString('base64')}` };
  }
  throw new Error('PSIU credential secret must contain authorization or username/password.');
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
