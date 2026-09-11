#!/usr/bin/env node
/**
 * One-time operator bootstrap. Run through an SSM port-forward to the private
 * RDS Proxy. This process uses the operator's short-lived AWS identity and
 * exits after creating the smoke role/database; no deployed workload receives
 * the platform-admin secret.
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [name, value] = arg.split('=', 2);
  return [name.replace(/^--/, ''), value];
}));
const required = (name) => {
  const value = args[name];
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
};
const identifier = (value) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/i.test(value)) throw new Error('Database identifier is invalid.');
  return `"${value}"`;
};
const literal = (value) => `'${value.replace(/'/g, "''")}'`;
const readSecret = async (arn) => {
  const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }));
  if (!response.SecretString) throw new Error('Database secret is unavailable.');
  const value = JSON.parse(response.SecretString);
  if (typeof value.username !== 'string' || typeof value.password !== 'string') throw new Error('Database secret is invalid.');
  return value;
};
const duplicateRole = (error) => typeof error === 'object' && error !== null && error.code === '42710';

const host = required('proxy-host');
const master = await readSecret(required('master-secret-arn'));
const smoke = await readSecret(required('smoke-secret-arn'));
const database = required('database');
const client = new pg.Client({ host, database: 'postgres', user: master.username, password: master.password, ssl: { rejectUnauthorized: true } });
await client.connect();
try {
  try { await client.query(`create role ${identifier(smoke.username)} login password ${literal(smoke.password)}`); }
  catch (error) { if (!duplicateRole(error)) throw error; await client.query(`alter role ${identifier(smoke.username)} login password ${literal(smoke.password)}`); }
  const existing = await client.query('select 1 from pg_database where datname=$1', [database]);
  if (!existing.rowCount) await client.query(`create database ${identifier(database)} owner ${identifier(smoke.username)}`);
} finally {
  await client.end();
}
console.log(`Created or verified isolated smoke database ${database}.`);
