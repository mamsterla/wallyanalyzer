import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { createProductionServer } from './production.js';

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

function call(server: ReturnType<typeof createProductionServer>, method:string,path:string,body?:unknown):Promise<{status:number;body:string}>{const address=server.address();if(!address||typeof address==='string')throw Error('server unavailable');return new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:address.port,path,method,headers:{authorization:'Bearer token','content-type':'application/json'}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode??0,body:text}));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});}
