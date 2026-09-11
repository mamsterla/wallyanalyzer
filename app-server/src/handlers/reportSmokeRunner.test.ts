import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSmokeArtifacts, cleanupSmokeRows, createSmokeSeed, invokeSmokeDispatcher, isSmokeDiagnosticKey, isTerminalSmokeStatus, smokeEnvironment } from './reportSmokeRunner.js';

const expected={reportId:'11111111-1111-4111-8111-111111111111',sampleId:'22222222-2222-4222-8222-222222222222',rawKey:'smoke/raw/owner/sample/input.wav',reportPrefix:'smoke/reports/owner/report/'};
const requiredArtifacts=()=>[
  {kind:'metrics_json',body:Buffer.from('{"valid":true}')},
  {kind:'graph_svg',body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')},
  {kind:'report_pdf',body:Buffer.from('%PDF-1.7\n')},
  {kind:'manifest',body:Buffer.from(JSON.stringify({reportId:expected.reportId,inputProvenance:[{sampleId:expected.sampleId,objectKey:expected.rawKey}]}))},
];

test('smoke seed uses opaque UUID paths under only the isolated prefixes',()=>{
  const seed=createSmokeSeed('smoke/raw/','smoke/reports/');
  assert.match(seed.rawKey,/^smoke\/raw\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/input\.wav$/i);
  assert.match(seed.reportPrefix,/^smoke\/reports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/$/i);
  assert.throws(()=>createSmokeSeed('raw/','reports/'),/Smoke prefixes/);
});

test('smoke artifact assertion accepts only valid isolated report provenance and bodies',()=>{
  assert.doesNotThrow(()=>assertSmokeArtifacts(expected,requiredArtifacts()));
  const contaminated=requiredArtifacts();
  contaminated[3]={kind:'manifest',body:Buffer.from(JSON.stringify({reportId:expected.reportId,inputProvenance:[{sampleId:expected.sampleId,objectKey:'raw/customer/sample/input.wav'}]}))};
  assert.throws(()=>assertSmokeArtifacts(expected,contaminated),/not isolated/);
});

test('only completed reports pass the smoke terminal assertion path',()=>{
  assert.equal(isTerminalSmokeStatus('completed'),true);
  assert.equal(isTerminalSmokeStatus('failed'),true);
  assert.equal(isTerminalSmokeStatus('running'),false);
  assert.equal(isTerminalSmokeStatus(undefined),false);
});

test('transactional fake migrates only the smoke target and cleans its complete synthetic graph',async()=>{
  const seed=createSmokeSeed('smoke/raw/','smoke/reports/');
  const remaining=new Set(['report_artifacts','analysis_report_inputs','report_outbox','analysis_reports','report_requests','samples','sample_upload_batches','user_systems','psiu_assignments','psiu_units','users']);
  const statements:string[]=[];
  await cleanupSmokeRows({query:async(text:string)=>{statements.push(text); const table=/delete from ([a-z_]+)/.exec(text)?.[1]; if(table) remaining.delete(table);}},seed);
  assert.deepEqual(statements,[
    'delete from report_artifacts where report_id=$1',
    'delete from analysis_report_inputs where report_id=$1',
    'delete from report_outbox where report_request_id=$1',
    'delete from analysis_reports where id=$1',
    'delete from report_requests where id=$1',
    'delete from samples where id=$1',
    'delete from sample_upload_batches where id=$1',
    'delete from user_systems where id=$1',
    'delete from psiu_assignments where id=$1',
    'delete from psiu_units where id=$1',
    'delete from users where id=$1',
  ]);
  assert.deepEqual([...remaining],[]);
  assert.equal(smokeEnvironment({SMOKE_DATABASE_SECRET_ARN:'smoke',SMOKE_DATABASE_NAME:'wally_report_smoke',SMOKE_RAW_PREFIX:'smoke/raw/',SMOKE_REPORT_PREFIX:'smoke/reports/',SMOKE_DISPATCHER_FUNCTION_NAME:'SmokeReportDispatcher'}).database,'wally_report_smoke');
});

test('failure diagnostics can retain only deterministic smoke-prefix objects',()=>{
  const seed=createSmokeSeed('smoke/raw/','smoke/reports/');
  assert.equal(isSmokeDiagnosticKey(seed,seed.rawKey),true);
  assert.equal(isSmokeDiagnosticKey(seed,`${seed.reportPrefix}metrics.json`),true);
  assert.equal(isSmokeDiagnosticKey(seed,'raw/customer/sample/input.wav'),false);
  assert.equal(isSmokeDiagnosticKey(seed,'reports/customer/report.pdf'),false);
});

test('transactional fake binds only the smoke database, dispatcher, and prefixes',async()=>{
  const config=smokeEnvironment({
    SMOKE_DATABASE_SECRET_ARN:'arn:aws:secretsmanager:us-east-1:123:secret:smoke',
    SMOKE_DATABASE_NAME:'wally_report_smoke',
    SMOKE_RAW_PREFIX:'smoke/raw/',
    SMOKE_REPORT_PREFIX:'smoke/reports/',
    SMOKE_DISPATCHER_FUNCTION_NAME:'WallyPlatform-SmokeReportDispatcherFunction-abc',
  });
  let invoked:string|undefined;
  await invokeSmokeDispatcher(config.dispatcher,async(command)=>{invoked=command.input.FunctionName;return {StatusCode:200};});
  assert.match(invoked!,/SmokeReportDispatcher/);
  assert.throws(()=>smokeEnvironment({...process.env,SMOKE_DATABASE_SECRET_ARN:'smoke',SMOKE_DATABASE_NAME:'wally',SMOKE_RAW_PREFIX:'smoke/raw/',SMOKE_REPORT_PREFIX:'smoke/reports/',SMOKE_DISPATCHER_FUNCTION_NAME:'SmokeReportDispatcher'}),/wally_report_smoke/);
  assert.throws(()=>smokeEnvironment({...process.env,SMOKE_DATABASE_SECRET_ARN:'smoke',SMOKE_DATABASE_NAME:'wally_report_smoke',SMOKE_RAW_PREFIX:'raw/',SMOKE_REPORT_PREFIX:'smoke/reports/',SMOKE_DISPATCHER_FUNCTION_NAME:'SmokeReportDispatcher'}),/fixed smoke prefixes/);
  assert.throws(()=>smokeEnvironment({...process.env,SMOKE_DATABASE_SECRET_ARN:'smoke',SMOKE_DATABASE_NAME:'wally_report_smoke',SMOKE_RAW_PREFIX:'smoke/raw/',SMOKE_REPORT_PREFIX:'smoke/reports/',SMOKE_DISPATCHER_FUNCTION_NAME:'ReportDispatcher'}),/isolated smoke dispatcher/);
});
