import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSmokeArtifacts, createSmokeSeed, isTerminalSmokeStatus } from './reportSmokeRunner.js';

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
