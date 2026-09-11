import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalServer } from './local.js';

test('local bridge restricts origins and fixed PSIU routes', async () => {
  const upstream: typeof fetch = async (input) => new Response(String(input).endsWith('/status') ? JSON.stringify({uid:'unit',recording:false}) : JSON.stringify({uid:'unit'}), {status:200,headers:{'content-type':'application/json'}});
  const server = await createLocalServer({ fetchImplementation:upstream, store:{load:()=>undefined,save:()=>undefined} });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string'); const base=`http://127.0.0.1:${address.port}`;
    const allowed=await fetch(`${base}/psiu/status`,{headers:{origin:'https://wally-analytics.app'}}); assert.equal(allowed.status,200); assert.equal(allowed.headers.get('access-control-allow-origin'),'https://wally-analytics.app');
    const denied=await fetch(`${base}/psiu/status`,{headers:{origin:'https://evil.example'}}); assert.equal(denied.status,403);
    const preflight=await fetch(`${base}/psiu/capture`,{method:'OPTIONS',headers:{origin:'https://wally-analytics.app','access-control-request-private-network':'true'}}); assert.equal(preflight.status,204); assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');
    const unknown=await fetch(`${base}/psiu/anything`,{headers:{origin:'https://wally-analytics.app'}}); assert.equal(unknown.status,404);
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
});
