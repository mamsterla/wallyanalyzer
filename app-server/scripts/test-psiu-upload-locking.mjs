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
async function mustBlock(query) { let settled = false; const pending = query().then(() => { settled = true; }); await wait(150); if (settled) throw new Error('Expected concurrent lifecycle write to wait on completion locks.'); return { pending }; }
async function setup() {
  await pool.query(`insert into users(id,email,role,lifecycle,account_status) values($1,$2,'admin','active','active'),($3,$4,'user','active','active')`, [ids.actor, `lock-admin-${suffix}@example.invalid`, ids.owner, `lock-owner-${suffix}@example.invalid`]);
  await pool.query(`insert into psiu_units(id,serial_number,opaque_uid,created_by,status) values($1,$2,$3,$4,'enabled')`, [ids.unit, `lock-serial-${suffix}`, `lock-uid-${suffix}`, ids.actor]);
  await pool.query(`insert into psiu_assignments(id,psiu_unit_id,user_id,assigned_by) values($1,$2,$3,$4)`, [ids.assignment, ids.unit, ids.owner, ids.actor]);
  await pool.query(`insert into sample_upload_batches(id,owner_id,psiu_unit_id,idempotency_key,request_fingerprint,source) values($1,$2,$3,$4,$5,'manual_file')`, [ids.batch, ids.owner, ids.unit, `lock-key-${suffix}`, 'lock-fingerprint']);
  await pool.query(`insert into samples(id,owner_id,upload_batch_id,psiu_unit_id,source,object_key,content_type,byte_length,recorded_at,status,upload_state,metadata) values($1,$2,$3,$4,'manual_file',$5,'audio/wav',44,now(),'uploaded','intent','{}'::jsonb)`, [ids.sample, ids.owner, ids.batch, ids.unit, `raw/${ids.owner}/${ids.sample}/lock.wav`]);
}
async function lockCompletion(client) { await client.query('begin'); await client.query(`select s.id from samples s join psiu_units p on p.id=s.psiu_unit_id where s.id=$1 and s.owner_id=$2 and s.upload_state='intent' for update of s,p`, [ids.sample, ids.owner]); await client.query(`select user_id from psiu_assignments where psiu_unit_id=$1 and user_id=$2 and unassigned_at is null for share`, [ids.unit, ids.owner]); }
let completion; let lifecycle;
try {
  await setup(); completion = await pool.connect(); lifecycle = await pool.connect();
  await lockCompletion(completion); console.log('Testing deassign lock…'); const { pending: deassign } = await mustBlock(() => lifecycle.query(`update psiu_assignments set unassigned_at=now(),unassigned_by=$2 where id=$1`, [ids.assignment, ids.actor])); await completion.query('rollback'); await deassign; await lifecycle.query('rollback'); await pool.query(`update psiu_assignments set unassigned_at=null,unassigned_by=null where id=$1`, [ids.assignment]);
  await lockCompletion(completion); console.log('Testing unavailable lock…'); const { pending: unavailable } = await mustBlock(() => lifecycle.query(`update psiu_units set status='unavailable',unavailable_at=now(),unavailable_by=$2 where id=$1`, [ids.unit, ids.actor])); await completion.query('rollback'); await unavailable; await lifecycle.query('rollback');
  console.log('PSIU completion locks blocked concurrent deassign and unavailable transitions.');
} finally {
  if (completion) { try { await completion.query('rollback'); } catch {} completion.release(); }
  if (lifecycle) { try { await lifecycle.query('rollback'); } catch {} lifecycle.release(); }
  await pool.query(`delete from samples where id=$1`, [ids.sample]).catch(() => undefined); await pool.query(`delete from sample_upload_batches where id=$1`, [ids.batch]).catch(() => undefined); await pool.query(`delete from psiu_assignments where id=$1`, [ids.assignment]).catch(() => undefined); await pool.query(`delete from psiu_units where id=$1`, [ids.unit]).catch(() => undefined); await pool.query(`delete from users where id in ($1,$2)`, [ids.actor, ids.owner]).catch(() => undefined); await pool.end();
}
