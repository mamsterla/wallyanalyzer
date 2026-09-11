import { createHash, randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StartExecutionCommand, SFNClient } from '@aws-sdk/client-sfn';
import { Pool } from 'pg';
import { databaseSettings } from '../migrate.js';
import { PostgresReportOutbox, dispatchReportOutbox } from '../services/reportRepository.js';
import { isOpaqueRawObjectKey } from '../services/sampleUploads.js';

const rawBucket=required('SAMPLE_BUCKET_NAME'), reportBucket=required('REPORT_BUCKET_NAME');
const rawPrefix=()=>process.env.RAW_PREFIX ?? 'raw/';
const reportPrefix=()=>process.env.REPORT_PREFIX ?? 'reports/';
const s3=new S3Client({});
let pool:Pool|undefined;
async function db(){return pool??=new Pool(await databaseSettings());}

type WorkflowInput={requestId:string;reportId:string};
type PinnedInput={sampleId:string;objectKey:string;versionId:string;checksumSha256:string;contentType:string};
type WorkerArtifact={kind:string;objectKey:string;objectVersionId:string;contentType:string;byteLength:number;checksumSha256:string};
const checksumBase64=(hex:string)=>Buffer.from(hex,'hex').toString('base64');
const prefixFor=(ownerId:string,reportId:string)=>`${reportPrefix()}${ownerId}/${reportId}/`;
const allowedRawKey=(key:string)=>new RegExp(`^${escapeRegExp(rawPrefix())}[0-9a-f-]{36}/[0-9a-f-]{36}/input\\.wav$`,'i').test(key);
const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Scheduler target: claims committed outbox rows and starts a stable, idempotent execution name. */
export async function dispatch(){
  const machine=required('REPORT_STATE_MACHINE_ARN'); const sfn=new SFNClient({});
  const started=await dispatchReportOutbox(new PostgresReportOutbox(await db()),{start:async x=>{
    try { const r=await sfn.send(new StartExecutionCommand({stateMachineArn:machine,name:x.executionName,input:JSON.stringify({requestId:x.requestId,reportIds:x.reportIds})})); return {executionArn:r.executionArn!}; }
    catch(error) { if(typeof error==='object'&&error&&'name' in error&&(error as {name?:string}).name==='ExecutionAlreadyExists') return {executionArn:`existing:${x.executionName}`}; throw error; }
  }});
  return {started};
}

/** Re-reads and pins immutable inputs. Sensitive provenance stays in Postgres, never in workflow state. */
export async function preflight(event:WorkflowInput){
  const p=await db();
  const r=await p.query<any>(`select ar.id,rr.id request_id,rr.owner_id,ar.algorithm_version,ar.parameter_provenance,
    i.sample_id,i.object_key pinned_object_key,i.object_version_id pinned_version_id,i.object_checksum_sha256 pinned_checksum,
    s.object_key,s.checksum_sha256,s.content_type
    from analysis_reports ar join report_requests rr on rr.id=ar.request_id join analysis_report_inputs i on i.report_id=ar.id
    join samples s on s.id=i.sample_id where ar.id=$1 and rr.id=$2 and ar.status in ('queued','running') and s.upload_state='uploaded' order by i.input_ordinal`,[event.reportId,event.requestId]);
  if(!r.rowCount)throw new Error('Report inputs are unavailable.');
  const first=r.rows[0]; const inputs:PinnedInput[]=[];
  for(const row of r.rows){
    const key=row.pinned_object_key??row.object_key;
    if(!(rawPrefix()==='raw/' ? isOpaqueRawObjectKey(key) : allowedRawKey(key)))throw new Error('This report input key is not permitted for this workflow.');
    const versionId=row.pinned_version_id;
    const head=await s3.send(new HeadObjectCommand({Bucket:rawBucket,Key:key,...(versionId?{VersionId:versionId}:{}),ChecksumMode:'ENABLED'}));
    if(!head.VersionId||!head.ChecksumSHA256)throw new Error('Raw input has no immutable versioned checksum.');
    if(versionId&&head.VersionId!==versionId)throw new Error('Pinned raw input version changed.');
    if(row.pinned_checksum&&head.ChecksumSHA256!==row.pinned_checksum)throw new Error('Pinned raw input checksum changed.');
    await p.query(`update analysis_report_inputs set object_key=coalesce(object_key,$3),object_version_id=coalesce(object_version_id,$4),object_checksum_sha256=coalesce(object_checksum_sha256,$5) where report_id=$1 and sample_id=$2`,[event.reportId,row.sample_id,key,head.VersionId,head.ChecksumSHA256]);
    inputs.push({sampleId:row.sample_id,objectKey:key,versionId:head.VersionId,checksumSha256:head.ChecksumSHA256,contentType:row.content_type});
  }
  await p.query(`update analysis_reports set status='running',started_at=coalesce(started_at,now()) where id=$1 and status='queued'`,[event.reportId]);
  return buildWorkerInput({requestId:event.requestId,reportId:event.reportId,ownerId:first.owner_id,algorithmVersion:first.algorithm_version,parameterProvenance:first.parameter_provenance,inputs});
}

/** Deliberately projects only worker-required, non-display data into Step Functions state. */
export function buildWorkerInput(value:{requestId:string;reportId:string;ownerId:string;algorithmVersion:string;parameterProvenance:Record<string,unknown>;inputs:PinnedInput[]}){
  return {requestId:value.requestId,reportId:value.reportId,algorithmVersion:value.algorithmVersion,inputs:value.inputs,effectiveAlgorithmValues:(value.parameterProvenance?.fixedDemoValues??{}) as Record<string,unknown>,outputPrefix:prefixFor(value.ownerId,value.reportId)};
}

/** Worker descriptors are accepted only at the database-derived report prefix and exact S3 version. */
export function artifactDescriptorIsValid(artifact:WorkerArtifact,prefix:string){
  const allowed=new Map([['metrics_json','application/json'],['graph_svg','image/svg+xml'],['report_pdf','application/pdf']]);
  return (allowed.has(artifact.kind)||/^graph_svg_[1-9][0-9]*$/.test(artifact.kind))&&(allowed.get(artifact.kind)??'image/svg+xml')===artifact.contentType&&artifact.objectKey.startsWith(prefix)&&typeof artifact.objectVersionId==='string'&&artifact.objectVersionId.length>0&&artifact.checksumSha256?.match(/^[a-f0-9]{64}$/)!==null&&Number.isSafeInteger(artifact.byteLength)&&artifact.byteLength>=0;
}

export function artifactReplayMatches(prior:{object_key:string;object_version_id:string;content_type:string;byte_length:number|string;checksum_sha256:string},artifact:WorkerArtifact){return prior.object_key===artifact.objectKey&&prior.object_version_id===artifact.objectVersionId&&prior.content_type===artifact.contentType&&Number(prior.byte_length)===artifact.byteLength&&prior.checksum_sha256===artifact.checksumSha256;}

/** Persist artifact pointers once. Replays must name the identical S3 object version. */
export async function finalize(event:{reportId:string;artifacts:WorkerArtifact[]}){
  if(!Array.isArray(event.artifacts)||!event.artifacts.length)throw new Error('Worker returned no artifacts.');
  const p=await db(); const c=await p.connect();
  try{
    await c.query('begin');
    const report=await c.query<any>(`select ar.id,ar.status,ar.algorithm_version,ar.parameter_provenance,rr.owner_id,rr.system_snapshot,rr.user_metadata_snapshot from analysis_reports ar join report_requests rr on rr.id=ar.request_id where ar.id=$1 for update`,[event.reportId]);
    if(!report.rowCount)throw new Error('Report was not found.');
    const row=report.rows[0], prefix=prefixFor(row.owner_id,event.reportId);
    for(const artifact of event.artifacts){
      if(!artifactDescriptorIsValid(artifact,prefix))throw new Error('Invalid report artifact descriptor.');
      const head=await s3.send(new HeadObjectCommand({Bucket:reportBucket,Key:artifact.objectKey,VersionId:artifact.objectVersionId,ChecksumMode:'ENABLED'}));
      if(head.ContentLength!==artifact.byteLength||head.ChecksumSHA256!==checksumBase64(artifact.checksumSha256))throw new Error('Report artifact integrity validation failed.');
      const existing=await c.query<any>(`select object_key,object_version_id,content_type,byte_length,checksum_sha256 from report_artifacts where report_id=$1 and kind=$2`,[event.reportId,artifact.kind]);
      if(existing.rowCount){if(!artifactReplayMatches(existing.rows[0],artifact))throw new Error('Artifact replay cannot replace an immutable report artifact.');}
      else await c.query(`insert into report_artifacts(id,report_id,kind,object_key,object_version_id,content_type,byte_length,checksum_sha256) values($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),event.reportId,artifact.kind,artifact.objectKey,artifact.objectVersionId,artifact.contentType,artifact.byteLength,artifact.checksumSha256]);
    }
    const manifestExisting=await c.query<any>(`select object_key,object_version_id,content_type,byte_length,checksum_sha256 from report_artifacts where report_id=$1 and kind='manifest'`,[event.reportId]);
    if(!manifestExisting.rowCount){
      const manifest=await buildManifest(c,event.reportId,row);
      const body=Buffer.from(JSON.stringify(manifest,null,2)); const key=`${prefix}manifest.json`;
      const checksum=createHash('sha256').update(body).digest('hex');
      const put=await s3.send(new PutObjectCommand({Bucket:reportBucket,Key:key,Body:body,ContentType:'application/json',ChecksumSHA256:checksumBase64(checksum),Metadata:{reportid:event.reportId}}));
      if(!put.VersionId)throw new Error('Report manifest has no immutable object version.');
      const head=await s3.send(new HeadObjectCommand({Bucket:reportBucket,Key:key,VersionId:put.VersionId,ChecksumMode:'ENABLED'}));
      if(head.ContentLength!==body.length||head.ChecksumSHA256!==checksumBase64(checksum))throw new Error('Report manifest integrity validation failed.');
      await c.query(`insert into report_artifacts(id,report_id,kind,object_key,object_version_id,content_type,byte_length,checksum_sha256) values($1,$2,'manifest',$3,$4,'application/json',$5,$6)`,[randomUUID(),event.reportId,key,put.VersionId,body.length,checksum]);
    }
    await c.query(`update analysis_reports set status='completed',completed_at=coalesce(completed_at,now()),failure_code=null,failure_detail_safe=null where id=$1 and status in ('queued','running','completed')`,[event.reportId]);
    await c.query('commit'); return{reportId:event.reportId,status:'completed'};
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
}

export async function buildManifest(c:any,reportId:string,report:any){
  const artifacts=await c.query(`select kind,object_key,object_version_id,content_type,byte_length,checksum_sha256 from report_artifacts where report_id=$1 order by kind`,[reportId]);
  const inputs=await c.query(`select i.input_ordinal,i.object_key,i.object_version_id,i.object_checksum_sha256,s.id sample_id,s.content_type,s.byte_length,s.recorded_at,s.metadata,s.system_snapshot,s.psiu_unit_id,s.observed_psiu_uid from analysis_report_inputs i join samples s on s.id=i.sample_id where i.report_id=$1 order by i.input_ordinal`,[reportId]);
  return {reportId,algorithmVersion:report.algorithm_version,workerImageIdentity:null,inputProvenance:inputs.rows.map((x:any)=>({ordinal:x.input_ordinal,sampleId:x.sample_id,objectKey:x.object_key,objectVersionId:x.object_version_id,checksumSha256:x.object_checksum_sha256,contentType:x.content_type,byteLength:Number(x.byte_length),recordedAt:x.recorded_at?.toISOString(),wavMetadata:x.metadata,systemSnapshot:x.system_snapshot,psiuUnitId:x.psiu_unit_id,observedPsiuUid:x.observed_psiu_uid??undefined})),parameterProvenance:report.parameter_provenance,requestSystemSnapshot:report.system_snapshot,userMetadataSnapshot:report.user_metadata_snapshot,artifacts:artifacts.rows};
}
export async function fail(event:{reportId:string;error?:string}){const p=await db();await p.query(`update analysis_reports set status='failed',completed_at=now(),failure_code='processing_failed',failure_detail_safe=$2 where id=$1 and status in ('queued','running')`,[event.reportId,String(event.error??'Report processing failed.').slice(0,500)]);return{reportId:event.reportId,status:'failed'};}
export async function finalizeRequest(event:{requestId:string}){const p=await db();const r=await p.query<{status:string;count:string}>(`select status,count(*) from analysis_reports where request_id=$1 group by status`,[event.requestId]);const counts=Object.fromEntries(r.rows.map(x=>[x.status,Number(x.count)]));const status=counts.failed&&counts.completed?'partial_failed':counts.failed?'failed':counts.completed?'completed':'running';await p.query(`update report_requests set status=$2 where id=$1`,[event.requestId,status]);return{requestId:event.requestId,status,counts};}
function required(name:string){const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;}
