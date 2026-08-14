import { createServer, type Server } from 'node:http';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const port = Number(process.env.PORT ?? 3000);

export interface PsiuCredentialClient {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
}

export async function resolvePsiuAuthorization(dependencies: { secrets?: PsiuCredentialClient; environment?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const environment = dependencies.environment ?? process.env;
  const secretArn = requiredEnvironment(environment, 'PSIU_CREDENTIAL_SECRET_ARN');
  const response = await (dependencies.secrets ?? new SecretsManagerClient({})).send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!response.SecretString) throw new Error('PSIU credential secret must use SecretString.');
  return parsePsiuCredential(response.SecretString);
}

/** Accepts a future firmware-specific Authorization header or legacy username/password JSON. */
export function parsePsiuCredential(value: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('PSIU credential secret must contain valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PSIU credential secret must be an object.');
  const credential = parsed as Record<string, unknown>;
  if (typeof credential.authorization === 'string' && credential.authorization.trim()) return credential.authorization.trim();
  if (typeof credential.username !== 'string' || !credential.username || typeof credential.password !== 'string' || !credential.password) {
    throw new Error('PSIU credential secret must contain a non-empty authorization value or username and password strings.');
  }
  return `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`;
}

export async function createLocalServer(dependencies: { authorization?: string; environment?: NodeJS.ProcessEnv; secrets?: PsiuCredentialClient } = {}): Promise<Server> {
  const environment = dependencies.environment ?? process.env;
  const psiuBaseUrl = normalizePsiuBaseUrl(environment.PSIU_BASE_URL ?? 'http://psiu.local');
  const psiuAuthorization = dependencies.authorization ?? await resolvePsiuAuthorization({ secrets: dependencies.secrets, environment });

  // Local-only PSIU proxy. Production uses production.ts and always verifies Cognito
  // access tokens. This proxy never exposes the PSIU to cloud or public routing.
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { status: 'ok', service: 'wally-app-server' });
    if (request.method === 'GET' && url.pathname === '/psiu/status') return forwardPsiu(response, '/status', psiuBaseUrl, psiuAuthorization);
    if (request.method === 'GET' && url.pathname === '/psiu/wav') return forwardPsiu(response, '/wav', psiuBaseUrl, psiuAuthorization);
    if (request.method === 'POST' && url.pathname === '/psiu/capture') try { const { running } = await parseCaptureRequest(request); await requestPsiu(psiuBaseUrl, psiuAuthorization, '/api/sampling', { method: 'POST', headers: { authorization: psiuAuthorization, 'content-type': 'application/json' }, body: JSON.stringify({ running }) }); return forwardPsiu(response, '/status', psiuBaseUrl, psiuAuthorization); } catch (error) { return sendPsiuError(response, error); }
    return sendJson(response, 404, { message: 'Route not found.' });
  });
}

async function forwardPsiu(response: import('node:http').ServerResponse, path: string, psiuBaseUrl: string, psiuAuthorization: string) { try { const upstream = await requestPsiu(psiuBaseUrl, psiuAuthorization, path, undefined, path === '/status' ? 3 : 1); response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8' }); response.end(await upstream.text()); } catch (error) { sendPsiuError(response, error); } }
async function requestPsiu(psiuBaseUrl: string, psiuAuthorization: string, path: string, init?: RequestInit, attempts = 1): Promise<Response> { let last: PsiuProxyError | undefined; for (let n = 0; n < attempts; n += 1) { try { const response = await fetch(`${psiuBaseUrl}${path}`, { ...init, headers: { authorization: psiuAuthorization, ...init?.headers }, signal: AbortSignal.timeout(5000) }); if (response.ok) return response; last = new PsiuProxyError(response.status, 'PSIU request failed.'); if (response.status < 500) throw last; } catch (error) { if (error instanceof PsiuProxyError) throw error; last = new PsiuProxyError(503, 'PSIU unit unavailable.'); } if (n < attempts - 1) await new Promise<void>((resolve) => setTimeout(resolve, 250)); } throw last ?? new PsiuProxyError(503, 'PSIU unit unavailable.'); }
async function parseCaptureRequest(request: import('node:http').IncomingMessage) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const buffer = Buffer.from(chunk); if ((size += buffer.length) > 1024) throw new PsiuProxyError(400, 'Capture request too large.'); chunks.push(buffer); } try { const value = JSON.parse(Buffer.concat(chunks).toString()) as { running?: unknown }; if (typeof value.running !== 'boolean') throw new Error(); return { running: value.running }; } catch { throw new PsiuProxyError(400, 'Capture request requires boolean running.'); } }
function normalizePsiuBaseUrl(value: string) { const url = new URL(value); if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('PSIU_BASE_URL must use HTTP or HTTPS.'); return url.toString().replace(/\/$/, ''); }
function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string { const value = environment[name]; if (!value) throw new Error(`Missing required ${name}.`); return value; }
class PsiuProxyError extends Error { constructor(readonly statusCode: number, message: string) { super(message); } }
function sendPsiuError(response: import('node:http').ServerResponse, error: unknown) { sendJson(response, error instanceof PsiuProxyError ? error.statusCode : 503, { status: 'unavailable', message: error instanceof PsiuProxyError ? error.message : 'PSIU unit unavailable.' }); }
function sendJson(response: import('node:http').ServerResponse, statusCode: number, body: unknown) { response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); }

async function main() { const server = await createLocalServer(); server.listen(port, '127.0.0.1', () => console.info(`Wally local API listening on http://127.0.0.1:${port}`)); }
if (process.argv[1]?.endsWith('local.js')) main().catch((error: unknown) => { console.error(error instanceof Error ? `Local PSIU proxy initialization failed: ${error.message}` : 'Local PSIU proxy initialization failed.'); process.exitCode = 1; });
