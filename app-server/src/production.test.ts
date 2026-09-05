import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { S3Client } from '@aws-sdk/client-s3';
import { createProductionServer } from './production.js';
import { HttpError } from './services/auth.js';

process.env.COGNITO_USER_POOL_ID = 'pool';
process.env.COGNITO_WEB_CLIENT_ID = 'client';

test('legacy fulfillment remains supported and invites the detached customer', async () => {
  const calls: string[] = []; const customers = new Map<string, { id:string; email:string; lifecycle:any }>(); let unit = 0;
  const repository = {
    async findActivePrincipal(){ return { id:'admin', role:'admin' as const, lifecycle:'active' }; }, async me(){ return undefined; },
    async customers(){ return [...customers.values()]; }, async customer(id:string){ return customers.get(id); }, async units(){ return []; },
    async createCustomer(email:string){ const c={id:'customer',email,lifecycle:'draft' as const}; customers.set(c.id,c); return {...c,units:[]}; },
    async createUnit(){ return {id:`unit-${++unit}`,serialNumber:'serial',uid:'uid',status:'enabled' as const}; }, async assign(){ calls.push('assign'); }, async deassign(){}, async setUnitStatus(){},
    async markInvited(id:string){ const c=customers.get(id)!; c.lifecycle='invited'; calls.push('markInvited'); }, async recordInviteCleanup(){ throw Error('not used'); }, async pendingCognitoJob(){ return undefined; }, async completeCognitoJob(){}, async activate(){}, async setCustomerLifecycle(){ return {email:'customer@example.com'}; }, async archive(){ return {email:'customer@example.com'}; },
  };
  const cognito = { send: async (command: unknown) => { const name=(command as {constructor:{name:string}}).constructor.name; calls.push(name); if(command instanceof AdminCreateUserCommand)return {User:{Attributes:[{Name:'sub',Value:'subject'}]}}; return {}; } };
  const server=createProductionServer({pool:{} as never,repository:repository as never,cognito:cognito as never,verify:async()=>({subject:'admin-subject',roles:['admin']})}); await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try { const result=await call(server,'POST','/v1/admin/fulfillment',{email:'customer@example.com',psiuSerialNumber:'serial',psiuOpaqueUid:'uid'}); assert.equal(result.status,201); assert.deepEqual(calls,['assign','AdminCreateUserCommand','AdminAddUserToGroupCommand','markInvited']); } finally { await new Promise<void>(r=>server.close(()=>r())); }
});

test('invite group failure persists cleanup work and deletes the created Cognito user', async () => {
  const calls:string[]=[]; const customer={id:'customer',email:'customer@example.com',lifecycle:'draft' as const};
  const repository={async findActivePrincipal(){return{id:'admin',role:'admin' as const,lifecycle:'active'}},async me(){return undefined},async customers(){return[customer]},async customer(){return customer},async units(){return[]},async createCustomer(){throw Error('unused')},async createUnit(){throw Error('unused')},async assign(){},async deassign(){},async setUnitStatus(){},async markInvited(){throw Error('write failed')},async recordInviteCleanup(){calls.push('queued');return{id:'job',customerId:'customer',action:'invite_cleanup' as const,email:customer.email,cognitoSubject:'subject'}},async pendingCognitoJob(){return undefined},async completeCognitoJob(){calls.push('completed')},async activate(){},async setCustomerLifecycle(){return{email:customer.email}},async archive(){return{email:customer.email}}};
  const cognito={send:async(command:unknown)=>{if(command instanceof AdminCreateUserCommand)return{User:{Attributes:[{Name:'sub',Value:'subject'}]}};if(command instanceof AdminAddUserToGroupCommand)throw Error('group failure');if(command instanceof AdminDeleteUserCommand){calls.push('deleted');return{}};return{}}};
  const server=createProductionServer({pool:{} as never,repository:repository as never,cognito:cognito as never,verify:async()=>({subject:'admin-subject',roles:['admin']})});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try { const result=await call(server,'POST','/v1/admin/customers/customer/invite'); assert.equal(result.status,500); assert.deepEqual(calls,['queued','deleted','completed']); } finally {await new Promise<void>(r=>server.close(()=>r()));}
});

test('admin inventory lifecycle cleans failed pending objects and hard-delete requires the exact unit path', async () => {
  const calls: string[] = [];
  const repository = { async findActivePrincipal(){ return { id:'admin', role:'admin' as const, lifecycle:'active' }; }, async me(){ return undefined; }, async customers(){ return []; }, async customer(){ return undefined; }, async units(){ return []; }, async createCustomer(){ throw Error('unused'); }, async createUnit(){ throw Error('unused'); }, async assign(){}, async deassign(){}, async setUnitStatus(){}, async markUnitUnavailable(){ calls.push('unavailable'); return ['raw/admin-a/pending.wav']; }, async hardDeleteUnit(){ calls.push('hard-delete'); throw new HttpError(409,'PSIU unit has assignment or sample history. Mark unavailable to retain its history.'); }, async markInvited(){}, async recordInviteCleanup(){ throw Error('unused'); }, async pendingCognitoJob(){ return undefined; }, async completeCognitoJob(){}, async activate(){}, async setCustomerLifecycle(){ return { email:'x@example.com' }; }, async archive(){ return { email:'x@example.com' }; } };
  const s3 = new S3Client({ region:'us-east-1', credentials:{accessKeyId:'test',secretAccessKey:'test'} }); s3.send = async (command: { constructor: { name: string } }) => { calls.push(command.constructor.name); return {} as never; };
  const server = createProductionServer({ pool:{} as never, repository:repository as never, s3, sampleBucketName:'bucket', verify:async()=>({subject:'admin',roles:['admin']}) }); await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try { assert.equal((await call(server,'POST','/v1/admin/psiu-units/unit-a/unavailable')).status,204); assert.deepEqual(calls,['unavailable','DeleteObjectCommand']); const suffix=await call(server,'DELETE','/v1/admin/psiu-units/unit-a/extra'); assert.equal(suffix.status,404); assert.equal(calls.includes('hard-delete'),false); const deleted=await call(server,'DELETE','/v1/admin/psiu-units/unit-a'); assert.equal(deleted.status,409); assert.match(deleted.body,/Mark unavailable/); } finally { await new Promise<void>(r=>server.close(()=>r())); }
});

test('email confirmation checks Cognito by durable email and completes durably once', async () => {
  const calls:string[]=[];
  const repository={async findEmailConfirmationPrincipal(){return{id:'user',email:'user@example.com',role:'user' as const,lifecycle:'invited'}},async confirmEmail(subject:string){calls.push(`confirm:${subject}`)}};
  const cognito={send:async(command:unknown)=>{if(command instanceof AdminGetUserCommand){calls.push(`lookup:${command.input.Username}`);return{UserAttributes:[{Name:'email_verified',Value:'true'}]};}return{}}};
  const server=createProductionServer({pool:{} as never,repository:repository as never,cognito:cognito as never,verify:async()=>({subject:'subject',roles:['user']})});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{assert.equal((await call(server,'POST','/v1/me/confirm-email')).status,204);assert.deepEqual(calls,['lookup:user@example.com','confirm:subject']);}finally{await new Promise<void>(r=>server.close(()=>r()));}
});

test('email confirmation rejects an unverified Cognito email without durable activation', async () => {
  const calls: string[] = [];
  const repository = { async findEmailConfirmationPrincipal(){ return { id:'user', email:'user@example.com', role:'user' as const, lifecycle:'invited' }; }, async confirmEmail(){ calls.push('confirm'); } };
  const cognito = { send: async (command: unknown) => { if (command instanceof AdminGetUserCommand) return { UserAttributes:[{ Name:'email_verified', Value:'false' }] }; return {}; } };
  const server = createProductionServer({ pool:{} as never, repository:repository as never, cognito:cognito as never, verify:async()=>({ subject:'subject', roles:['user'] }) }); await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  try { const result = await call(server,'POST','/v1/me/confirm-email'); assert.equal(result.status,403); assert.match(result.body,/Confirm your email/); assert.deepEqual(calls,[]); } finally { await new Promise<void>(resolve => server.close(()=>resolve())); }
});

test('active users without durable email confirmation cannot access normal APIs but can confirm', async () => {
  const calls: string[] = [];
  const repository = {
    async findActivePrincipal() { return undefined; },
    async findEmailConfirmationPrincipal() { return { id: 'admin', email: 'admin@example.com', role: 'admin' as const, lifecycle: 'active' }; },
    async confirmEmail(subject: string) { calls.push(`confirm:${subject}`); },
  };
  const cognito = { send: async (command: unknown) => command instanceof AdminGetUserCommand ? { UserAttributes: [{ Name: 'email_verified', Value: 'true' }] } : {} };
  const server = createProductionServer({ pool: {} as never, repository: repository as never, cognito: cognito as never, verify: async () => ({ subject: 'admin-subject', roles: ['admin'] }) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await call(server, 'GET', '/v1/me')).status, 403);
    assert.equal((await call(server, 'POST', '/v1/me/confirm-email')).status, 204);
    assert.deepEqual(calls, ['confirm:admin-subject']);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('restore uses repository lifecycle decision instead of forcing active', async () => {
  const calls:string[]=[];const repository={async findActivePrincipal(){return{id:'admin',email:'admin@example.com',role:'admin' as const,lifecycle:'active'}},async restoreCustomer(){calls.push('restore');return{email:'unconfirmed@example.com',cognitoSubject:'sub'}}};const cognito={send:async(command:unknown)=>{calls.push((command as {constructor:{name:string}}).constructor.name);return{}}};const server=createProductionServer({pool:{} as never,repository:repository as never,cognito:cognito as never,verify:async()=>({subject:'admin',roles:['admin']})});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));try{assert.equal((await call(server,'POST','/v1/admin/customers/user/restore')).status,204);assert.deepEqual(calls,['restore','AdminEnableUserCommand']);}finally{await new Promise<void>(r=>server.close(()=>r()));}
});

function call(server: ReturnType<typeof createProductionServer>, method:string,path:string,body?:unknown):Promise<{status:number;body:string}>{const address=server.address();if(!address||typeof address==='string')throw Error('server unavailable');return new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:address.port,path,method,headers:{authorization:'Bearer token','content-type':'application/json'}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode??0,body:text}));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});}
