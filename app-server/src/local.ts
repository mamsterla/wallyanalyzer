import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3000);
const psiuBaseUrl = normalizePsiuBaseUrl(process.env.PSIU_BASE_URL ?? 'http://psiu.local');
const psiuAuthorization = `Basic ${Buffer.from('admin:admin').toString('base64')}`;

// Local-only PSIU proxy. Production uses production.ts and always verifies Cognito
// access tokens. Local account/API verification uses a dedicated mock server tool,
// not this device proxy and never a production authentication bypass.
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { status: 'ok', service: 'wally-app-server' });
  if (request.method === 'GET' && url.pathname === '/psiu/status') return forwardPsiu(response, '/status');
  if (request.method === 'GET' && url.pathname === '/psiu/wav') return forwardPsiu(response, '/wav');
  if (request.method === 'POST' && url.pathname === '/psiu/capture') try { const { running } = await parseCaptureRequest(request); await requestPsiu('/api/sampling',{method:'POST',headers:{authorization:psiuAuthorization,'content-type':'application/json'},body:JSON.stringify({running})}); return forwardPsiu(response,'/status'); } catch(error) { return sendPsiuError(response,error); }
  return sendJson(response, 404, { message: 'Route not found.' });
});
server.listen(port, '127.0.0.1', () => console.info(`Wally local API listening on http://127.0.0.1:${port}`));
async function forwardPsiu(response: import('node:http').ServerResponse,path:string){try{const upstream=await requestPsiu(path,undefined,path==='/status'?3:1);response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json; charset=utf-8'});response.end(await upstream.text());}catch(error){sendPsiuError(response,error);}}
async function requestPsiu(path:string,init?:RequestInit,attempts=1):Promise<Response>{let last:PsiuProxyError|undefined;for(let n=0;n<attempts;n+=1){try{const r=await fetch(`${psiuBaseUrl}${path}`,{...init,signal:AbortSignal.timeout(5000)});if(r.ok)return r;last=new PsiuProxyError(r.status,'PSIU request failed.');if(r.status<500)throw last;}catch(error){if(error instanceof PsiuProxyError)throw error;last=new PsiuProxyError(503,'PSIU unit unavailable.');}if(n<attempts-1)await new Promise<void>(r=>setTimeout(r,250));}throw last??new PsiuProxyError(503,'PSIU unit unavailable.');}
async function parseCaptureRequest(request:import('node:http').IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const chunk of request){const buffer=Buffer.from(chunk);if((size+=buffer.length)>1024)throw new PsiuProxyError(400,'Capture request too large.');chunks.push(buffer);}try{const value=JSON.parse(Buffer.concat(chunks).toString()) as {running?:unknown};if(typeof value.running!=='boolean')throw Error();return{running:value.running};}catch{throw new PsiuProxyError(400,'Capture request requires boolean running.');}}
function normalizePsiuBaseUrl(value:string){const url=new URL(value);if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('PSIU_BASE_URL must use HTTP or HTTPS.');return url.toString().replace(/\/$/,'');}class PsiuProxyError extends Error{constructor(readonly statusCode:number,message:string){super(message);}}function sendPsiuError(response:import('node:http').ServerResponse,error:unknown){sendJson(response,error instanceof PsiuProxyError?error.statusCode:503,{status:'unavailable',message:error instanceof PsiuProxyError?error.message:'PSIU unit unavailable.'});}function sendJson(response:import('node:http').ServerResponse,statusCode:number,body:unknown){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8'});response.end(JSON.stringify(body));}
