import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { Pool } from 'pg';
import { databaseSettings, runMigrations } from '../migrate.js';
import { fabricatedTrackingErrorWav } from '../services/reportSmoke.js';

const definitionId = '10000000-0000-4000-8000-000000000001';
const presetId = '10000000-0000-4000-8000-000000000002';
const pollIntervalMs = 5_000;
const pollTimeoutMs = 12 * 60_000;

type Seed = { ownerId:string; unitId:string; assignmentId:string; systemId:string; batchId:string; sampleId:string; requestId:string; reportId:string; rawKey:string; rawVersionId?:string; reportPrefix:string };
type Artifact = { kind:string; object_key:string; object_version_id:string };
type ObjectBody = { kind:string; body:Buffer };

function smokeEnvironment() {
  const secret = required('SMOKE_DATABASE_SECRET_ARN');
  const database = required('SMOKE_DATABASE_NAME');
  const rawPrefix = requiredPrefix('SMOKE_RAW_PREFIX');
  const reportPrefix = requiredPrefix('SMOKE_REPORT_PREFIX');
  return { secret, database, rawPrefix, reportPrefix };
}

function bindSmokeDatabase() {
  const { secret, database } = smokeEnvironment();
  process.env.DATABASE_SECRET_ARN = secret;
  process.env.DATABASE_NAME = database;
}

/** Invoked manually after deployment. It never reads customer tables or object prefixes. */
export async function run() {
  bindSmokeDatabase();
  const environment = smokeEnvironment();
  await runMigrations();
  const pool = new Pool(await databaseSettings());
  let seed: Seed | undefined;
  let completed = false;
  try {
    seed = await seedSmokeReport(pool, environment.rawPrefix, environment.reportPrefix);
    seed.rawVersionId = await putSmokeInput(seed.rawKey);
    await invokeDispatcher();
    const artifacts = await waitForCompletion(pool, seed.reportId);
    const bodies = await readArtifactBodies(artifacts, seed.reportPrefix);
    assertSmokeArtifacts({ reportId: seed.reportId, sampleId: seed.sampleId, rawKey: seed.rawKey, reportPrefix: seed.reportPrefix }, bodies);
    await cleanupSmokeRun(pool, seed, artifacts);
    completed = true;
    return { correlationId: seed.requestId, status: 'completed' };
  } finally {
    if (!completed && seed) {
      // Deliberately retain only isolated smoke records and smoke-prefix objects for diagnosis.
    }
    await pool.end();
  }
}

/** Builds opaque smoke-only record IDs and keys before any database mutation. */
export function createSmokeSeed(rawPrefix:string, reportPrefix:string):Seed {
  const ownerId=randomUUID(),unitId=randomUUID(),assignmentId=randomUUID(),systemId=randomUUID(),batchId=randomUUID(),sampleId=randomUUID(),requestId=randomUUID(),reportId=randomUUID();
  if(!rawPrefix.startsWith('smoke/raw/') || !reportPrefix.startsWith('smoke/reports/')) throw new Error('Smoke prefixes are required.');
  return { ownerId, unitId, assignmentId, systemId, batchId, sampleId, requestId, reportId, rawKey:`${rawPrefix}${ownerId}/${sampleId}/input.wav`, reportPrefix: `${reportPrefix}${ownerId}/${reportId}/` };
}

async function seedSmokeReport(pool:Pool, rawPrefix:string, reportPrefix:string):Promise<Seed> {
  const seed=createSmokeSeed(rawPrefix,reportPrefix);
  const {ownerId,unitId,assignmentId,systemId,batchId,sampleId,requestId,reportId,rawKey}=seed;
  const wav=fabricatedTrackingErrorWav();
  const checksum=createHash('sha256').update(wav).digest('base64');
  const snapshot={name:'Isolated report smoke system',components:{turntable:'Synthetic smoke fixture'},source:'isolated-smoke'};
  const provenance={presetSnapshot:{name:'RTI Test 1 Track 1 Side A',version:'1'},fixedDemoValues:{},systemSnapshot:snapshot,userMetadataSnapshot:{},userEnteredValues:{}};
  const client=await pool.connect();
  try {
    await client.query('begin');
    await client.query(`insert into users(id,cognito_subject,email,role,account_status,lifecycle,email_confirmed_at,first_name,last_name) values($1,$2,$3,'user','active','active',now(),'Smoke','Runner')`,[ownerId,`smoke-${ownerId}`,`smoke-${ownerId}@invalid.example`]);
    await client.query(`insert into psiu_units(id,serial_number,opaque_uid,status,created_by) values($1,$2,$3,'enabled',$4)`,[unitId,`SMOKE-${unitId}`,`smoke-${unitId}`,ownerId]);
    await client.query(`insert into psiu_assignments(id,psiu_unit_id,user_id,assigned_by) values($1,$2,$3,$3)`,[assignmentId,unitId,ownerId]);
    await client.query(`insert into user_systems(id,owner_id,name,components,active) values($1,$2,'Isolated report smoke system',$3::jsonb,true)`,[systemId,ownerId,JSON.stringify(snapshot.components)]);
    await client.query(`insert into sample_upload_batches(id,owner_id,psiu_unit_id,idempotency_key,source) values($1,$2,$3,$4,'manual_file')`,[batchId,ownerId,unitId,`smoke-${requestId}`]);
    await client.query(`insert into samples(id,owner_id,object_key,content_type,byte_length,checksum_sha256,recorded_at,status,metadata,upload_batch_id,psiu_unit_id,upload_state,uploaded_at,verified_at,source,system_snapshot) values($1,$2,$3,'audio/wav',$4,$5,now(),'uploaded',$6::jsonb,$7,$8,'uploaded',now(),now(),'manual_file',$9::jsonb)`,[sampleId,ownerId,rawKey,wav.length,checksum,JSON.stringify({channels:2,sampleRateHz:48_000,durationSeconds:60,fixture:'deterministic-1khz'}),batchId,unitId,JSON.stringify(snapshot)]);
    await client.query(`insert into report_requests(id,owner_id,upload_batch_id,idempotency_key,request_fingerprint,system_snapshot,user_metadata_snapshot,status) values($1,$2,$3,$4,$5,$6::jsonb,'{}'::jsonb,'queued')`,[requestId,ownerId,batchId,`smoke-${requestId}`,createHash('sha256').update(requestId).digest('hex'),JSON.stringify(snapshot)]);
    await client.query(`insert into analysis_reports(id,request_id,definition_id,preset_id,algorithm_version,status,parameter_provenance) values($1,$2,$3,$4,'1.0.0','queued',$5::jsonb)`,[reportId,requestId,definitionId,presetId,JSON.stringify(provenance)]);
    await client.query(`insert into analysis_report_inputs(report_id,sample_id,input_ordinal,object_key,object_checksum_sha256) values($1,$2,0,$3,$4)`,[reportId,sampleId,rawKey,checksum]);
    await client.query(`insert into report_outbox(id,report_request_id,event_type) values($1,$2,'report.requested')`,[randomUUID(),requestId]);
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  return seed;
}

async function putSmokeInput(key:string) {
  const wav=fabricatedTrackingErrorWav();
  const checksum=createHash('sha256').update(wav).digest('base64');
  const response=await new S3Client({}).send(new PutObjectCommand({Bucket:required('SAMPLE_BUCKET_NAME'),Key:key,Body:wav,ContentType:'audio/wav',ChecksumSHA256:checksum,Metadata:{fixture:'isolated-report-smoke'}}));
  if(!response.VersionId) throw new Error('Smoke input did not receive an immutable version.');
  return response.VersionId;
}

async function invokeDispatcher() {
  const response=await new LambdaClient({}).send(new InvokeCommand({FunctionName:required('SMOKE_DISPATCHER_FUNCTION_NAME'),InvocationType:'RequestResponse',Payload:Buffer.from('{}')}));
  if(response.FunctionError || response.StatusCode!==200) throw new Error('Smoke dispatcher invocation failed.');
}

async function waitForCompletion(pool:Pool, reportId:string):Promise<Artifact[]> {
  const deadline=Date.now()+pollTimeoutMs;
  while(Date.now()<deadline) {
    const report=await pool.query<{status:string}>(`select status from analysis_reports where id=$1`,[reportId]);
    if(report.rows[0]?.status==='completed') {
      const artifacts=await pool.query<Artifact>(`select kind,object_key,object_version_id from report_artifacts where report_id=$1`,[reportId]);
      return artifacts.rows;
    }
    if(isTerminalSmokeStatus(report.rows[0]?.status) || !report.rowCount) throw new Error('Smoke report did not complete.');
    await sleep(pollIntervalMs);
  }
  throw new Error('Smoke report timed out.');
}

async function readArtifactBodies(artifacts:Artifact[], prefix:string):Promise<ObjectBody[]> {
  const s3=new S3Client({});
  const output:ObjectBody[]=[];
  for(const artifact of artifacts) {
    if(!artifact.object_key.startsWith(prefix) || !artifact.object_version_id) throw new Error('Smoke artifact escaped its isolated prefix.');
    const response=await s3.send(new GetObjectCommand({Bucket:required('REPORT_BUCKET_NAME'),Key:artifact.object_key,VersionId:artifact.object_version_id}));
    output.push({kind:artifact.kind,body:Buffer.from(await response.Body!.transformToByteArray())});
  }
  return output;
}

/** Exported pure assertion seam: tests cover artifact content without AWS resources. */
export function assertSmokeArtifacts(expected:{reportId:string;sampleId:string;rawKey:string;reportPrefix:string}, artifacts:ObjectBody[]) {
  const byKind=new Map(artifacts.map((artifact)=>[artifact.kind,artifact.body]));
  const metrics=byKind.get('metrics_json'); const pdf=byKind.get('report_pdf'); const manifest=byKind.get('manifest');
  const svg=[...byKind.entries()].find(([kind])=>kind==='graph_svg'||/^graph_svg_[1-9][0-9]*$/.test(kind))?.[1];
  if(!metrics || !pdf || !manifest || !svg) throw new Error('Smoke report is missing required artifacts.');
  try { JSON.parse(metrics.toString('utf8')); } catch { throw new Error('Smoke metrics artifact is not JSON.'); }
  if(!svg.toString('utf8').includes('<svg')) throw new Error('Smoke graph artifact is not SVG.');
  if(!pdf.subarray(0,5).equals(Buffer.from('%PDF-'))) throw new Error('Smoke PDF artifact is invalid.');
  let provenance:unknown; try { provenance=JSON.parse(manifest.toString('utf8')); } catch { throw new Error('Smoke manifest artifact is not JSON.'); }
  const value=provenance as {reportId?:unknown;inputProvenance?:Array<{sampleId?:unknown;objectKey?:unknown}>};
  if(value.reportId!==expected.reportId || !Array.isArray(value.inputProvenance) || value.inputProvenance.length!==1 || value.inputProvenance[0]?.sampleId!==expected.sampleId || value.inputProvenance[0]?.objectKey!==expected.rawKey || !expected.rawKey.startsWith('smoke/raw/') || !expected.reportPrefix.startsWith('smoke/reports/')) throw new Error('Smoke manifest provenance is not isolated.');
}

async function cleanupSmokeRun(pool:Pool, seed:Seed, artifacts:Artifact[]) {
  const client=await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from report_requests where id=$1',[seed.requestId]);
    await client.query('delete from samples where id=$1',[seed.sampleId]);
    await client.query('delete from sample_upload_batches where id=$1',[seed.batchId]);
    await client.query('delete from user_systems where id=$1',[seed.systemId]);
    await client.query('delete from psiu_assignments where id=$1',[seed.assignmentId]);
    await client.query('delete from psiu_units where id=$1',[seed.unitId]);
    await client.query('delete from users where id=$1',[seed.ownerId]);
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  const s3=new S3Client({});
  if(!seed.rawVersionId) throw new Error('Smoke input version is required for cleanup.');
  await Promise.all([s3.send(new DeleteObjectCommand({Bucket:required('SAMPLE_BUCKET_NAME'),Key:seed.rawKey,VersionId:seed.rawVersionId})),...artifacts.map((artifact)=>s3.send(new DeleteObjectCommand({Bucket:required('REPORT_BUCKET_NAME'),Key:artifact.object_key,VersionId:artifact.object_version_id})))]);
}

/** The runner only accepts a completed report; every other terminal state retains smoke diagnostics. */
export const isTerminalSmokeStatus=(status:string|undefined)=>status==='completed'||status==='failed'||status==='cancelled';
const sleep=(ms:number)=>new Promise<void>((resolve)=>setTimeout(resolve,ms));
function required(name:string){const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;}
function requiredPrefix(name:string){const value=required(name);if(!value.endsWith('/'))throw new Error(`Invalid ${name}`);return value;}
