import { randomUUID } from 'node:crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

const secretArn = process.env.DATABASE_SECRET_ARN;
if (!secretArn) throw new Error('DATABASE_SECRET_ARN is required.');
const secretResponse = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretArn }));
if (!secretResponse.SecretString) throw new Error('Database secret must use SecretString.');
const secret = JSON.parse(secretResponse.SecretString);
if (typeof secret.username !== 'string' || typeof secret.password !== 'string') throw new Error('Database secret requires username and password.');
const port = Number(process.env.DATABASE_TEST_PORT ?? secret.port ?? 5432);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Database port is invalid.');
const pool = new pg.Pool({ host: process.env.DATABASE_TEST_HOST ?? secret.host ?? '127.0.0.1', port, database: process.env.DATABASE_NAME ?? 'wally', user: secret.username, password: secret.password, ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined });
const ids = { actor: randomUUID(), owner: randomUUID(), unit: randomUUID(), assignment: randomUUID(), batch: randomUUID(), sample: randomUUID() };
const suffix = ids.unit.slice(0, 12);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function mustBlock(operation, description) {
  let settled = false;
  const pending = operation().finally(() => { settled = true; });
  await wait(150);
  if (settled) {
    await pending;
    throw new Error(`Expected ${description} to wait on an existing row lock.`);
  }
  return { pending };
}

async function setup() {
  await pool.query(`insert into users(id,email,role,lifecycle,account_status) values($1,$2,'admin','active','active'),($3,$4,'user','active','active')`, [ids.actor, `lock-admin-${suffix}@example.invalid`, ids.owner, `lock-owner-${suffix}@example.invalid`]);
  await pool.query(`insert into psiu_units(id,serial_number,opaque_uid,created_by,status) values($1,$2,$3,$4,'enabled')`, [ids.unit, `lock-serial-${suffix}`, `lock-uid-${suffix}`, ids.actor]);
  await pool.query(`insert into psiu_assignments(id,psiu_unit_id,user_id,assigned_by) values($1,$2,$3,$4)`, [ids.assignment, ids.unit, ids.owner, ids.actor]);
  await pool.query(`insert into sample_upload_batches(id,owner_id,psiu_unit_id,idempotency_key,request_fingerprint,source) values($1,$2,$3,$4,$5,'manual_file')`, [ids.batch, ids.owner, ids.unit, `lock-key-${suffix}`, 'lock-fingerprint']);
  await pool.query(`insert into samples(id,owner_id,upload_batch_id,psiu_unit_id,source,object_key,content_type,byte_length,recorded_at,status,upload_state,metadata) values($1,$2,$3,$4,'manual_file',$5,'audio/wav',44,now(),'uploaded','intent','{}'::jsonb)`, [ids.sample, ids.owner, ids.batch, ids.unit, `raw/${ids.owner}/${ids.sample}/lock.wav`]);
}

async function lockCompletion(client) {
  await client.query('begin');
  await client.query(`select s.psiu_unit_id,p.status,p.opaque_uid from samples s join psiu_units p on p.id=s.psiu_unit_id where s.id=$1 and s.owner_id=$2 and s.upload_state='intent' for update of p`, [ids.sample, ids.owner]);
  await client.query(`select user_id from psiu_assignments where psiu_unit_id=$1 and user_id=$2 and unassigned_at is null for share`, [ids.unit, ids.owner]);
  await client.query(`select id from samples where id=$1 and owner_id=$2 and upload_state='intent' for update`, [ids.sample, ids.owner]);
}

async function lockUnavailable(client) {
  await client.query('begin');
  await client.query(`select id from psiu_units where id=$1 for update`, [ids.unit]);
  await client.query(`update psiu_assignments set unassigned_at=now(),unassigned_by=$2 where psiu_unit_id=$1 and unassigned_at is null`, [ids.unit, ids.actor]);
  await client.query(`update samples set upload_state='failed' where psiu_unit_id=$1 and upload_state='intent'`, [ids.unit]);
}

async function lockDeassign(client) {
  await client.query('begin');
  await client.query(`update psiu_assignments set unassigned_at=now(),unassigned_by=$2 where id=$1`, [ids.assignment, ids.actor]);
}

let completion;
let lifecycle;
try {
  await setup();
  completion = await pool.connect();
  lifecycle = await pool.connect();

  await lockCompletion(completion);
  console.log('Testing completion-first deassign lock…');
  const { pending: deassign } = await mustBlock(() => lockDeassign(lifecycle), 'deassign');
  await completion.query('rollback');
  await deassign;
  await lifecycle.query('rollback');

  await lockCompletion(completion);
  console.log('Testing completion-first unavailable lock…');
  const { pending: unavailable } = await mustBlock(() => lockUnavailable(lifecycle), 'unavailable transition');
  await completion.query('rollback');
  await unavailable;
  await lifecycle.query('rollback');

  await lockUnavailable(lifecycle);
  console.log('Testing unavailable-first completion lock…');
  const { pending: reverseCompletion } = await mustBlock(() => lockCompletion(completion), 'completion');
  await lifecycle.query('rollback');
  await reverseCompletion;
  await completion.query('rollback');

  console.log('PSIU completion and unavailable transitions serialize in both lock orders.');
} finally {
  if (completion) { try { await completion.query('rollback'); } catch {} completion.release(); }
  if (lifecycle) { try { await lifecycle.query('rollback'); } catch {} lifecycle.release(); }
  await pool.query(`delete from samples where id=$1`, [ids.sample]).catch(() => undefined);
  await pool.query(`delete from sample_upload_batches where id=$1`, [ids.batch]).catch(() => undefined);
  await pool.query(`delete from psiu_assignments where id=$1`, [ids.assignment]).catch(() => undefined);
  await pool.query(`delete from psiu_units where id=$1`, [ids.unit]).catch(() => undefined);
  await pool.query(`delete from users where id in ($1,$2)`, [ids.actor, ids.owner]).catch(() => undefined);
  await pool.end();
}
