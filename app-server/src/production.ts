import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminDisableUserCommand, AdminEnableUserCommand, AdminResetUserPasswordCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { AssignPsiuRequest, CreateCustomerRequest, CreatePsiuRequest, PsiuUnitStatus } from '@wally/contracts';
import { Pool } from 'pg';
import { HttpError, verifyCognitoAccessToken, type AuthenticatedPrincipal } from './services/auth.js';
import { requireAdmin, requirePrincipal } from './services/accountAuthorization.js';
import { PostgresAccountRepository, type AccountRepository } from './services/accountRepository.js';
import { databaseSettings } from './migrate.js';

const port = Number(process.env.PORT ?? 3000);
export function createProductionServer(dependencies: Partial<ProductionDependencies> = {}) {
  const pool = dependencies.pool ?? new Pool(databaseSettings());
  const repository = dependencies.repository ?? new PostgresAccountRepository(pool);
  const cognito = dependencies.cognito ?? new CognitoIdentityProviderClient({});
  const verify = dependencies.verify ?? verifyCognitoAccessToken;
  return createServer(async (request,response) => { try {
    if (request.method==='GET' && request.url==='/health') return sendJson(response,200,{status:'ok',service:'wally-app-server'});
    const path=new URL(request.url??'/', 'http://wally.local').pathname;
    const principal=await verify(bearerToken(request),cognitoSettings());
    const actor=await requirePrincipal(principal,repository);
    if(request.method==='GET' && path==='/v1/me') return sendJson(response,200,await repository.me(actor.id));
    if(request.method==='GET' && path==='/v1/me/units') return sendJson(response,200,(await repository.me(actor.id))?.units??[]);
    if(path.startsWith('/v1/admin/')) { requireAdmin(actor); return await adminRoute(request,response,path,actor.id,repository,cognito); }
    return sendJson(response,404,{message:'Route not found.'});
  } catch(error) { if(error instanceof HttpError)return sendJson(response,error.statusCode,{message:error.message}); console.error('Unhandled production API error',error);return sendJson(response,500,{message:'Internal server error.'}); }});
}
async function adminRoute(request:IncomingMessage,response:ServerResponse,path:string,actorId:string,repo:AccountRepository,cognito:CognitoIdentityProviderClient):Promise<void>{
  const id=path.split('/')[4]; const reqId=requestId(request);
  if(request.method==='GET'&&path==='/v1/admin/customers')return sendJson(response,200,await repo.customers());
  if(request.method==='POST'&&path==='/v1/admin/customers'){const x=await parseJson<CreateCustomerRequest>(request);return sendJson(response,201,await repo.createCustomer(email(x.email),actorId,reqId));}
  if(request.method==='GET'&&path==='/v1/admin/psiu-units')return sendJson(response,200,await repo.units());
  if(request.method==='POST'&&path==='/v1/admin/psiu-units'){const x=await parseJson<CreatePsiuRequest>(request);return sendJson(response,201,await repo.createUnit(identifier(x.serialNumber,'PSIU serial number',128),identifier(x.uid,'PSIU UID',256),actorId,reqId));}
  if(!id)throw new HttpError(404,'Route not found.');
  if(request.method==='POST'&&path.endsWith('/assign')){const x=await parseJson<AssignPsiuRequest>(request);await repo.assign(id,x.customerId,actorId,reqId);return sendJson(response,204,undefined);}
  if(request.method==='POST'&&path.endsWith('/deassign')){await repo.deassign(id,actorId,reqId);return sendJson(response,204,undefined);}
  if(request.method==='POST'&&path.endsWith('/enable')){await repo.setUnitStatus(id,'enabled',actorId,reqId);return sendJson(response,204,undefined);}
  if(request.method==='POST'&&path.endsWith('/disable')){await repo.setUnitStatus(id,'disabled',actorId,reqId);return sendJson(response,204,undefined);}
  if(request.method==='POST'&&path.endsWith('/invite'))return invite(id,actorId,repo,cognito,reqId,response);
  if(request.method==='POST'&&path.endsWith('/reset-password'))return reset(id,repo,cognito,response);
  if(request.method==='POST'&&path.endsWith('/suspend')){const x=await repo.setCustomerLifecycle(id,'suspended',actorId,reqId);if(x.cognitoSubject)await cognito.send(new AdminDisableUserCommand({UserPoolId:requiredEnvironment('COGNITO_USER_POOL_ID'),Username:x.email}));return sendJson(response,204,undefined);}
  if(request.method==='POST'&&path.endsWith('/restore')){const x=await repo.setCustomerLifecycle(id,'ready',actorId,reqId);if(x.cognitoSubject)await cognito.send(new AdminEnableUserCommand({UserPoolId:requiredEnvironment('COGNITO_USER_POOL_ID'),Username:x.email}));return sendJson(response,204,undefined);}
  if(request.method==='DELETE'&&path.startsWith('/v1/admin/customers/')){const x=await repo.archive(id,actorId,reqId);if(x.cognitoSubject)await cognito.send(new AdminDeleteUserCommand({UserPoolId:requiredEnvironment('COGNITO_USER_POOL_ID'),Username:x.email}));return sendJson(response,204,undefined);}
  throw new HttpError(404,'Route not found.');
}
async function invite(id:string,actor:string,repo:AccountRepository,cognito:CognitoIdentityProviderClient,reqId:string|undefined,response:ServerResponse){const customer=(await repo.customers()).find(x=>x.id===id);if(!customer)throw new HttpError(404,'Customer not found.');if(!['draft','ready'].includes(customer.lifecycle))throw new HttpError(409,'Customer cannot be invited.');const created=await cognito.send(new AdminCreateUserCommand({UserPoolId:requiredEnvironment('COGNITO_USER_POOL_ID'),Username:customer.email,UserAttributes:[{Name:'email',Value:customer.email},{Name:'email_verified',Value:'false'}]}));const subject=created.User?.Attributes?.find(x=>x.Name==='sub')?.Value;if(!subject)throw new Error('Cognito did not return a user subject.');try{await cognito.send(new AdminAddUserToGroupCommand({UserPoolId:requiredEnvironment('COGNITO_USER_POOL_ID'),Username:customer.email,GroupName:'user'}));await repo.markInvited(id,subject,actor,reqId);sendJson(response,202,{status:'invited'});}catch(e){await cognito.send(new AdminDeleteUserCommand({UserPoolId:requiredEnvironment('COGNITO_USER_POOL_ID'),Username:customer.email})).catch(()=>undefined);throw e}}
async function reset(id:string,repo:AccountRepository,cognito:CognitoIdentityProviderClient,response:ServerResponse){const customer=(await repo.customers()).find(x=>x.id===id);if(!customer?.invitedAt)throw new HttpError(409,'Invited customer required.');await cognito.send(new AdminResetUserPasswordCommand({UserPoolId:requiredEnvironment('COGNITO_USER_POOL_ID'),Username:customer.email}));sendJson(response,202,{status:'reset_requested'});}
interface ProductionDependencies { pool:Pool; repository:AccountRepository; cognito:CognitoIdentityProviderClient; verify:(token:string,settings:{userPoolId:string;clientId:string})=>Promise<AuthenticatedPrincipal>; }
function bearerToken(r:IncomingMessage){const v=r.headers.authorization;if(!v?.startsWith('Bearer '))throw new HttpError(401,'Bearer access token required.');return v.slice(7).trim()}
async function parseJson<T>(r:IncomingMessage):Promise<T>{const chunks:Buffer[]=[];let n=0;for await(const x of r){const b=Buffer.from(x);if((n+=b.length)>16_384)throw new HttpError(413,'Request body too large.');chunks.push(b)}try{return JSON.parse(Buffer.concat(chunks).toString()) as T}catch{throw new HttpError(400,'Valid JSON request body required.')}}
function cognitoSettings(){return{userPoolId:requiredEnvironment('COGNITO_USER_POOL_ID'),clientId:requiredEnvironment('COGNITO_WEB_CLIENT_ID')}}
function requiredEnvironment(n:string){const v=process.env[n];if(!v)throw new Error(`Missing required environment variable: ${n}`);return v}
function email(x:string){const v=x.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)||v.length>320)throw new HttpError(400,'Valid email required.');return v}
function identifier(x:string,label:string,max:number){const v=x.trim();if(!v||v.length>max||/[\u0000-\u001f]/.test(v))throw new HttpError(400,`${label} is invalid.`);return v}
function requestId(r:IncomingMessage){const x=r.headers['x-request-id'];return typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x)?x:undefined}
function sendJson(r:ServerResponse,status:number,body:unknown){r.writeHead(status,{'content-type':'application/json; charset=utf-8'});r.end(body===undefined?'':JSON.stringify(body))}
if(process.argv[1]?.endsWith('production.js'))createProductionServer().listen(port,'0.0.0.0',()=>console.info(`Wally private production API listening on port ${port}`));
