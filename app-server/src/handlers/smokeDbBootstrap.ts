import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';

type Secret = { username:string; password:string };
const secrets=new SecretsManagerClient({});

/** CloudFormation custom-resource handler. It creates only the isolated smoke role/database. */
export async function onEvent(event:{RequestType:string}){
  if(event.RequestType==='Delete') return {PhysicalResourceId:'wally-report-smoke-db'};
  const master=await secret('MASTER_DATABASE_SECRET_ARN');
  const smoke=await secret('SMOKE_DATABASE_SECRET_ARN');
  const host=required('DATABASE_PROXY_HOST');
  const database=required('SMOKE_DATABASE_NAME');
  const admin=new Client({host,database:'postgres',user:master.username,password:master.password,ssl:{rejectUnauthorized:true}});
  await admin.connect();
  try {
    await admin.query(`create role ${identifier(smoke.username)} login password ${literal(smoke.password)}`);
  } catch(error) {
    if(!isDuplicate(error)) throw error;
    await admin.query(`alter role ${identifier(smoke.username)} login password ${literal(smoke.password)}`);
  }
  try {
    const exists=await admin.query('select 1 from pg_database where datname=$1',[database]);
    if(!exists.rowCount) await admin.query(`create database ${identifier(database)} owner ${identifier(smoke.username)}`);
  } finally { await admin.end(); }
  return {PhysicalResourceId:'wally-report-smoke-db'};
}
async function secret(name:string):Promise<Secret>{const value=await secrets.send(new GetSecretValueCommand({SecretId:required(name)}));if(!value.SecretString)throw Error('Smoke database secret is unavailable.');const parsed=JSON.parse(value.SecretString) as Partial<Secret>;if(!parsed.username||!parsed.password)throw Error('Smoke database secret is invalid.');return{username:parsed.username,password:parsed.password};}
function identifier(value:string){if(!/^[a-z][a-z0-9_]{0,62}$/i.test(value))throw Error('Smoke database identifier is invalid.');return `"${value}"`;}
function literal(value:string){return `'${value.replace(/'/g,"''")}'`;}
function required(name:string){const value=process.env[name];if(!value)throw Error(`Missing ${name}`);return value;}
function isDuplicate(error:unknown){return typeof error==='object'&&error!==null&&'code' in error&&(error as {code?:string}).code==='42710';}
