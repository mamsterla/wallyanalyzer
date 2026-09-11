import { createServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const port = Number(process.env.PORT ?? 3000);
const bridgeService = 'wally-local-bridge';
const bridgeAccount = 'psiu-pairing';
const allowedOrigins = new Set(['https://wally-analytics.app', 'http://localhost:8081', 'http://127.0.0.1:8081']);

type BridgePairing = { baseUrl: string; authorization: string };
type CredentialStore = { load(): string | undefined; save(value: string): void };
export type PsiuAddressResolver = (hostname: string) => Promise<string[]>;
export interface PsiuCredentialClient { send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>; }

/** Development-harness compatibility only. Customer bridge startup never calls this. */
export function parsePsiuCredential(value: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('PSIU credential secret must contain valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PSIU credential secret must be an object.');
  const credential = parsed as Record<string, unknown>;
  if (typeof credential.authorization === 'string' && credential.authorization.trim()) return credential.authorization.trim();
  if (typeof credential.username !== 'string' || !credential.username || typeof credential.password !== 'string' || !credential.password) throw new Error('PSIU credential secret must contain a non-empty authorization value or username and password strings.');
  return `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`;
}

export async function resolvePsiuAuthorization(dependencies: { secrets?: PsiuCredentialClient; environment?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const environment = dependencies.environment ?? process.env;
  const arn = environment.PSIU_CREDENTIAL_SECRET_ARN;
  if (!arn) throw new Error('Missing required PSIU_CREDENTIAL_SECRET_ARN.');
  const response = await (dependencies.secrets ?? new SecretsManagerClient({})).send(new GetSecretValueCommand({ SecretId: arn }));
  if (!response.SecretString) throw new Error('PSIU credential secret must use SecretString.');
  return parsePsiuCredential(response.SecretString);
}

/** macOS Keychain storage for a customer-owned paired PSIU target and authorization. */
export function macOsCredentialStore(): CredentialStore {
  if (process.platform !== 'darwin') throw new Error('Customer local bridge requires a supported OS credential-store adapter. Use the Compose development harness on this platform.');
  return {
    load() { const result = spawnSync('security', ['find-generic-password', '-s', bridgeService, '-a', bridgeAccount, '-w'], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() || undefined : undefined; },
    save(value) { const result = spawnSync('security', ['add-generic-password', '-U', '-s', bridgeService, '-a', bridgeAccount, '-w', value], { encoding: 'utf8' }); if (result.status !== 0) throw new Error('Unable to store PSIU pairing in the OS credential store.'); },
  };
}

/** Uses native hidden-answer dialogs so PSIU authorization is never echoed to a terminal. */
export function promptMacOsPairing(run: typeof spawnSync = spawnSync): { username: string; password: string } {
  const ask = (message: string, hidden = false) => {
    const script = `text returned of (display dialog ${JSON.stringify(message)} default answer ""${hidden ? ' with hidden answer' : ''} buttons {"Cancel", "Continue"} default button "Continue")`;
    const result = run('osascript', ['-e', script], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('PSIU pairing was cancelled.');
    return result.stdout.trim();
  };
  const username = ask('PSIU username'); const password = ask('PSIU password', true);
  if (!username || !password) throw new Error('PSIU username and password are required.');
  return { username, password };
}

export async function pairLocalBridge(baseUrl: string, dependencies: { store?: CredentialStore; prompt?: () => { username: string; password: string }; resolveAddresses?: PsiuAddressResolver } = {}) {
  const normalized = await validatePsiuBaseUrl(baseUrl, dependencies.resolveAddresses);
  const { username, password } = (dependencies.prompt ?? (() => promptMacOsPairing()))();
  (dependencies.store ?? macOsCredentialStore()).save(JSON.stringify({ baseUrl: normalized, authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } satisfies BridgePairing));
}

export async function createLocalServer(dependencies: { authorization?: string; environment?: NodeJS.ProcessEnv; fetchImplementation?: typeof fetch; store?: CredentialStore; secrets?: PsiuCredentialClient; resolveAddresses?: PsiuAddressResolver } = {}): Promise<Server> {
  const environment = dependencies.environment ?? process.env;
  const developmentHarness = environment.NODE_ENV === 'development';
  const pairing = developmentHarness
    ? { baseUrl: environment.PSIU_BASE_URL ?? 'http://psiu.local', authorization: dependencies.authorization ?? (environment.PSIU_CREDENTIAL_SECRET_ARN ? await resolvePsiuAuthorization({ secrets: dependencies.secrets, environment }) : undefined) }
    : dependencies.authorization !== undefined ? { baseUrl: environment.PSIU_BASE_URL ?? 'http://psiu.local', authorization: dependencies.authorization } : customerPairing(dependencies.store ?? defaultCustomerStore());
  const resolveAddresses = dependencies.resolveAddresses ?? lookupAddresses;
  const psiuBaseUrl = await validatePsiuBaseUrl(pairing.baseUrl, resolveAddresses);
  const request = (path: string, authorization?: string, init?: RequestInit, attempts = 1) => requestPsiu(psiuBaseUrl, authorization, path, dependencies.fetchImplementation ?? fetch, resolveAddresses, init, attempts);
  return createServer(async (incoming, response) => {
    const origin = incoming.headers.origin;
    if (incoming.method === 'OPTIONS') return preflight(response, origin, typeof incoming.headers['access-control-request-private-network'] === 'string' ? incoming.headers['access-control-request-private-network'] : undefined);
    if (origin && !allowedOrigins.has(origin)) return sendJson(response, 403, { message: 'Bridge origin is not allowed.' });
    const cors = origin ? corsHeaders(origin) : {};
    const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
    if (incoming.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { status: 'ok', service: 'wally-local-bridge' }, cors);
    if (incoming.method === 'GET' && url.pathname === '/psiu/uid') return scanPsiuUid(response, request, cors);
    if (incoming.method === 'GET' && url.pathname === '/psiu/status') return forwardPsiu(response, '/status', request, pairing.authorization, cors);
    if (incoming.method === 'GET' && url.pathname === '/psiu/wav') return forwardPsiu(response, '/audio.wav', request, pairing.authorization, cors);
    if (incoming.method === 'POST' && url.pathname === '/psiu/capture') try { const { running } = await parseCaptureRequest(incoming); await request('/api/sampling', pairing.authorization, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ running }) }); return forwardPsiu(response, '/status', request, pairing.authorization, cors); } catch (error) { return sendPsiuError(response, error, cors); }
    return sendJson(response, 404, { message: 'Route not found.' }, cors);
  });
}

function defaultCustomerStore(): CredentialStore { return process.platform === 'darwin' ? macOsCredentialStore() : { load: () => undefined, save: () => { throw new Error('Customer local bridge requires a supported OS credential-store adapter.'); } }; }
function customerPairing(store: CredentialStore): { baseUrl: string; authorization?: string } { const value = store.load(); if (!value) return { baseUrl: 'http://psiu.local' }; let pairing: unknown; try { pairing = JSON.parse(value); } catch { throw new Error('Stored PSIU pairing is invalid. Pair the bridge again.'); } if (!pairing || typeof pairing !== 'object' || Array.isArray(pairing)) throw new Error('Stored PSIU pairing is invalid. Pair the bridge again.'); const record = pairing as Record<string, unknown>; if (typeof record.baseUrl !== 'string' || typeof record.authorization !== 'string' || !record.authorization.trim()) throw new Error('Stored PSIU pairing is invalid. Pair the bridge again.'); return { baseUrl: record.baseUrl, authorization: record.authorization }; }

export async function validatePsiuBaseUrl(value: string, resolveAddresses: PsiuAddressResolver = lookupAddresses): Promise<string> {
  let url: URL; try { url = new URL(value); } catch { throw new Error('PSIU target is invalid.'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PSIU target must be an HTTP origin without credentials, path, query, or fragment.');
  await resolveLocalAddress(url.hostname, resolveAddresses);
  return url.toString().replace(/\/$/, '');
}
async function lookupAddresses(hostname: string): Promise<string[]> { return (await lookup(hostname, { all: true })).map(result => result.address); }
async function resolveLocalAddress(hostname: string, resolveAddresses: PsiuAddressResolver): Promise<string> { const addresses = isIP(hostname) ? [hostname] : await resolveAddresses(hostname); if (!addresses.length || addresses.some(address => !isLocalAddress(address))) throw new PsiuProxyError(403, 'PSIU target must resolve only to a private, link-local, or loopback address.'); return addresses[0]!; }
function isLocalAddress(address: string): boolean { if (isIP(address) === 4) { const [a, b] = address.split('.').map(Number); return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254); } const normalized = address.toLowerCase(); return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:'); }

function corsHeaders(origin: string): Record<string, string> { return { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Range', 'access-control-allow-private-network': 'true' }; }
function preflight(response: import('node:http').ServerResponse, origin: string | undefined, privateNetwork: string | undefined) { if (!origin || !allowedOrigins.has(origin)) return sendJson(response, 403, { message: 'Bridge origin is not allowed.' }); if (privateNetwork && privateNetwork !== 'true') return sendJson(response, 400, { message: 'Invalid private network request.' }); response.writeHead(204, corsHeaders(origin)); response.end(); }
type PsiuRequest = (path: string, authorization?: string, init?: RequestInit, attempts?: number) => Promise<Response>;
async function scanPsiuUid(response: import('node:http').ServerResponse, request: PsiuRequest, cors: Record<string, string>) { try { const upstream = await request('/uid'); const body: unknown = await upstream.json(); const uid = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).uid : undefined; if (typeof uid !== 'string' || !uid.trim() || uid.trim().length > 256) throw new PsiuProxyError(502, 'PSIU returned an invalid UID response.'); sendJson(response, 200, { uid: uid.trim() }, { ...cors, 'cache-control': 'no-store' }); } catch (error) { sendPsiuError(response, error, cors); } }
async function forwardPsiu(response: import('node:http').ServerResponse, path: string, request: PsiuRequest, authorization: string | undefined, cors: Record<string, string>) { try { const upstream = await request(path, authorization, undefined, path === '/status' ? 3 : 1); const headers: Record<string, string> = { 'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8', ...cors }; for (const name of ['content-length', 'content-range', 'accept-ranges']) { const value = upstream.headers.get(name); if (value) headers[name] = value; } response.writeHead(upstream.status, headers); response.end(Buffer.from(await upstream.arrayBuffer())); } catch (error) { sendPsiuError(response, error, cors); } }
/** Resolve on every request, then replace the URL host with that validated address before authorization is attached. */
async function requestPsiu(base: string, authorization: string | undefined, path: string, fetchImplementation: typeof fetch, resolveAddresses: PsiuAddressResolver, init?: RequestInit, attempts = 1): Promise<Response> { let last: PsiuProxyError | undefined; for (let n = 0; n < attempts; n += 1) { try { const original = new URL(base); const address = await resolveLocalAddress(original.hostname, resolveAddresses); const pinned = new URL(base); pinned.hostname = isIP(address) === 6 ? `[${address}]` : address; const headers = new Headers(init?.headers); headers.set('host', original.host); if (authorization) headers.set('authorization', authorization); const result = await fetchImplementation(`${pinned.toString().replace(/\/$/, '')}${path}`, { ...init, headers, signal: AbortSignal.timeout(5000) }); if (result.ok) return result; last = new PsiuProxyError(result.status, 'PSIU request failed.'); if (result.status < 500) throw last; } catch (error) { if (error instanceof PsiuProxyError) throw error; last = new PsiuProxyError(503, 'PSIU unit unavailable.'); } if (n < attempts - 1) await new Promise<void>(resolve => setTimeout(resolve, 250)); } throw last ?? new PsiuProxyError(503, 'PSIU unit unavailable.'); }
async function parseCaptureRequest(request: import('node:http').IncomingMessage) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const buffer = Buffer.from(chunk); if ((size += buffer.length) > 1024) throw new PsiuProxyError(400, 'Capture request too large.'); chunks.push(buffer); } try { const value = JSON.parse(Buffer.concat(chunks).toString()) as { running?: unknown }; if (typeof value.running !== 'boolean') throw Error(); return { running: value.running }; } catch { throw new PsiuProxyError(400, 'Capture request requires boolean running.'); } }
class PsiuProxyError extends Error { constructor(readonly statusCode: number, message: string) { super(message); } }
function sendPsiuError(response: import('node:http').ServerResponse, error: unknown, headers: Record<string, string> = {}) { sendJson(response, error instanceof PsiuProxyError ? error.statusCode : 503, { status: 'unavailable', message: error instanceof PsiuProxyError ? error.message : 'PSIU unit unavailable.' }, headers); }
function sendJson(response: import('node:http').ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}) { response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', ...headers }); response.end(JSON.stringify(body)); }

async function main() { if (process.argv[2] === 'pair') { const index = process.argv.indexOf('--psiu-base-url'); const baseUrl = index >= 0 ? process.argv[index + 1] : undefined; if (!baseUrl) throw new Error('Usage: npm run bridge:pair -- --psiu-base-url http://psiu.local'); await pairLocalBridge(baseUrl); console.info('PSIU pairing saved locally.'); return; } const server = await createLocalServer(); server.listen(port, '127.0.0.1', () => console.info(`Wally local bridge listening on http://127.0.0.1:${port}`)); }
if (process.argv[1]?.endsWith('local.js')) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Local bridge failed.'); process.exitCode = 1; });
