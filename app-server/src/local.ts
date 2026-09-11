import { createServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createInterface } from 'node:readline/promises';

const port = Number(process.env.PORT ?? 3000);
const bridgeService = 'wally-local-bridge';
const bridgeAccount = 'psiu-authorization';
const allowedOrigins = new Set(['https://wally-analytics.app', 'http://localhost:8081', 'http://127.0.0.1:8081']);

export interface PsiuCredentialClient { send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>; }
/** Development-harness compatibility only. Customer bridge startup never calls this. */
export function parsePsiuCredential(value:string):string { let parsed:unknown;try{parsed=JSON.parse(value);}catch{throw new Error('PSIU credential secret must contain valid JSON.');}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('PSIU credential secret must be an object.');const credential=parsed as Record<string,unknown>;if(typeof credential.authorization==='string'&&credential.authorization.trim())return credential.authorization.trim();if(typeof credential.username!=='string'||!credential.username||typeof credential.password!=='string'||!credential.password)throw new Error('PSIU credential secret must contain a non-empty authorization value or username and password strings.');return `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`; }
export async function resolvePsiuAuthorization(dependencies:{secrets?:PsiuCredentialClient;environment?:NodeJS.ProcessEnv}={}):Promise<string>{const environment=dependencies.environment??process.env;const arn=environment.PSIU_CREDENTIAL_SECRET_ARN;if(!arn)throw new Error('Missing required PSIU_CREDENTIAL_SECRET_ARN.');const response=await (dependencies.secrets??new SecretsManagerClient({})).send(new GetSecretValueCommand({SecretId:arn}));if(!response.SecretString)throw new Error('PSIU credential secret must use SecretString.');return parsePsiuCredential(response.SecretString);}
type CredentialStore = { load(): string | undefined; save(value: string): void };

/** macOS Keychain storage for a customer-owned PSIU credential. It is never sent to Wally. */
export function macOsCredentialStore(): CredentialStore {
  if (process.platform !== 'darwin') throw new Error('Local bridge pairing requires an OS credential-store adapter for this platform.');
  return {
    load() { const result = spawnSync('security', ['find-generic-password', '-s', bridgeService, '-a', bridgeAccount, '-w'], { encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() || undefined : undefined; },
    save(value) { const result = spawnSync('security', ['add-generic-password', '-U', '-s', bridgeService, '-a', bridgeAccount, '-w', value], { encoding: 'utf8' }); if (result.status !== 0) throw new Error('Unable to store PSIU authorization in the OS credential store.'); },
  };
}

export async function pairLocalBridge(store: CredentialStore = macOsCredentialStore()) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const username = (await terminal.question('PSIU username: ')).trim();
    const password = await terminal.question('PSIU password: ');
    if (!username || !password) throw new Error('PSIU username and password are required.');
    store.save(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
  } finally { terminal.close(); }
}

export async function createLocalServer(dependencies: { authorization?: string; environment?: NodeJS.ProcessEnv; fetchImplementation?: typeof fetch; store?: CredentialStore } = {}): Promise<Server> {
  const environment = dependencies.environment ?? process.env;
  const psiuBaseUrl = normalizePsiuBaseUrl(environment.PSIU_BASE_URL ?? 'http://psiu.local');
  const authorization = dependencies.authorization ?? (dependencies.store ? dependencies.store.load() : macOsCredentialStore().load());
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (request.method === 'OPTIONS') return preflight(response, origin, typeof request.headers['access-control-request-private-network'] === 'string' ? request.headers['access-control-request-private-network'] : undefined);
    if (origin && !allowedOrigins.has(origin)) return sendJson(response, 403, { message: 'Bridge origin is not allowed.' });
    const cors = origin ? corsHeaders(origin) : {};
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { status: 'ok', service: 'wally-local-bridge' }, cors);
    if (request.method === 'GET' && url.pathname === '/psiu/uid') return scanPsiuUid(response, psiuBaseUrl, fetchImplementation, cors);
    if (request.method === 'GET' && url.pathname === '/psiu/status') return forwardPsiu(response, '/status', psiuBaseUrl, authorization, fetchImplementation, cors);
    if (request.method === 'GET' && url.pathname === '/psiu/wav') return forwardPsiu(response, '/audio.wav', psiuBaseUrl, authorization, fetchImplementation, cors);
    if (request.method === 'POST' && url.pathname === '/psiu/capture') try { const { running } = await parseCaptureRequest(request); await requestPsiu(psiuBaseUrl, authorization, '/api/sampling', fetchImplementation, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({running}) }); return forwardPsiu(response, '/status', psiuBaseUrl, authorization, fetchImplementation, cors); } catch (error) { return sendPsiuError(response, error, cors); }
    return sendJson(response, 404, { message: 'Route not found.' }, cors);
  });
}
function corsHeaders(origin:string):Record<string,string>{ return {'access-control-allow-origin':origin,'vary':'Origin','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type, Range','access-control-allow-private-network':'true'}; }
function preflight(response:import('node:http').ServerResponse,origin:string|undefined,privateNetwork:string|undefined){if(!origin||!allowedOrigins.has(origin))return sendJson(response,403,{message:'Bridge origin is not allowed.'});if(privateNetwork && privateNetwork !== 'true')return sendJson(response,400,{message:'Invalid private network request.'});response.writeHead(204,corsHeaders(origin));response.end();}
async function scanPsiuUid(response: import('node:http').ServerResponse, base: string, fetchImplementation: typeof fetch, cors:Record<string,string>) { try { const upstream = await requestPsiu(base, undefined, '/uid', fetchImplementation); const body:unknown=await upstream.json(); const uid=body&&typeof body==='object'&&!Array.isArray(body)?(body as Record<string,unknown>).uid:undefined; if(typeof uid!=='string'||!uid.trim()||uid.trim().length>256)throw new PsiuProxyError(502,'PSIU returned an invalid UID response.'); sendJson(response,200,{uid:uid.trim()},{...cors,'cache-control':'no-store'}); } catch(error){sendPsiuError(response,error,cors);} }
async function forwardPsiu(response: import('node:http').ServerResponse,path:string,base:string,authorization:string|undefined,fetchImplementation:typeof fetch,cors:Record<string,string>){try{const upstream=await requestPsiu(base,authorization,path,fetchImplementation,undefined,path==='/status'?3:1);const headers:Record<string,string>={'content-type':upstream.headers.get('content-type')??'application/json; charset=utf-8',...cors};for(const name of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(name);if(value)headers[name]=value;}response.writeHead(upstream.status,headers);response.end(Buffer.from(await upstream.arrayBuffer()));}catch(error){sendPsiuError(response,error,cors);}}
async function requestPsiu(base:string,authorization:string|undefined,path:string,fetchImplementation:typeof fetch,init?:RequestInit,attempts=1):Promise<Response>{let last:PsiuProxyError|undefined;for(let n=0;n<attempts;n+=1){try{const headers=new Headers(init?.headers);if(authorization)headers.set('authorization',authorization);const response=await fetchImplementation(`${base}${path}`,{...init,headers,signal:AbortSignal.timeout(5000)});if(response.ok)return response;last=new PsiuProxyError(response.status,'PSIU request failed.');if(response.status<500)throw last;}catch(error){if(error instanceof PsiuProxyError)throw error;last=new PsiuProxyError(503,'PSIU unit unavailable.');}if(n<attempts-1)await new Promise<void>(resolve=>setTimeout(resolve,250));}throw last??new PsiuProxyError(503,'PSIU unit unavailable.');}
async function parseCaptureRequest(request:import('node:http').IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const buffer=Buffer.from(chunk);if((size+=buffer.length)>1024)throw new PsiuProxyError(400,'Capture request too large.');chunks.push(buffer);}try{const value=JSON.parse(Buffer.concat(chunks).toString()) as {running?:unknown};if(typeof value.running!=='boolean')throw Error();return{running:value.running};}catch{throw new PsiuProxyError(400,'Capture request requires boolean running.');}}
function normalizePsiuBaseUrl(value:string){const url=new URL(value);if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('PSIU_BASE_URL must use HTTP or HTTPS.');return url.toString().replace(/\/$/,'');}
class PsiuProxyError extends Error{constructor(readonly statusCode:number,message:string){super(message);}}
function sendPsiuError(response:import('node:http').ServerResponse,error:unknown,headers:Record<string,string>={}){sendJson(response,error instanceof PsiuProxyError?error.statusCode:503,{status:'unavailable',message:error instanceof PsiuProxyError?error.message:'PSIU unit unavailable.'},headers);}
function sendJson(response:import('node:http').ServerResponse,statusCode:number,body:unknown,headers:Record<string,string>={}){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8',...headers});response.end(JSON.stringify(body));}
async function main(){if(process.argv[2]==='pair'){await pairLocalBridge();console.info('PSIU pairing saved locally.');return;}const server=await createLocalServer();server.listen(port,'127.0.0.1',()=>console.info(`Wally local bridge listening on http://127.0.0.1:${port}`));}
if(process.argv[1]?.endsWith('local.js'))main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Local bridge failed.');process.exitCode=1;});
