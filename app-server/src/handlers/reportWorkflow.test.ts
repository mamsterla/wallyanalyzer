import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SAMPLE_BUCKET_NAME='raw'; process.env.REPORT_BUCKET_NAME='reports';
const { artifactDescriptorIsValid, artifactReplayMatches, buildManifest, buildWorkerInput }=await import('./reportWorkflow.js');
const hash='a'.repeat(64), prefix='reports/owner/report/', version='version-1';
const artifact=(patch:Record<string,unknown>={})=>({kind:'report_pdf',objectKey:`${prefix}report.pdf`,objectVersionId:version,contentType:'application/pdf',byteLength:10,checksumSha256:hash,...patch});
test('report finalizer rejects worker-controlled paths, kinds, versions, and checksums',()=>{
  assert.equal(artifactDescriptorIsValid(artifact(),prefix),true);
  assert.equal(artifactDescriptorIsValid(artifact({objectKey:'reports/other/report.pdf'}),prefix),false);
  assert.equal(artifactDescriptorIsValid(artifact({objectVersionId:''}),prefix),false);
  assert.equal(artifactDescriptorIsValid(artifact({kind:'script',contentType:'text/plain'}),prefix),false);
  assert.equal(artifactDescriptorIsValid(artifact({kind:'graph_svg_2',contentType:'image/svg+xml',checksumSha256:'bad'}),prefix),false);
});
test('artifact replay mismatch cannot replace a completed report pointer',()=>{
  const prior={object_key:`${prefix}report.pdf`,object_version_id:version,content_type:'application/pdf',byte_length:10,checksum_sha256:hash};
  assert.equal(artifactReplayMatches(prior,artifact()),true);
  assert.equal(artifactReplayMatches(prior,artifact({objectVersionId:'new-version'})),false);
});
test('artifact descriptor retains the first graph SVG and permits numbered additional graphs',()=>{
  assert.equal(artifactDescriptorIsValid(artifact({kind:'graph_svg',objectKey:`${prefix}one.svg`,contentType:'image/svg+xml'}),prefix),true);
  assert.equal(artifactDescriptorIsValid(artifact({kind:'graph_svg_2',objectKey:`${prefix}two.svg`,contentType:'image/svg+xml'}),prefix),true);
});
test('worker execution state excludes display system and user provenance',()=>{
  const state=buildWorkerInput({requestId:'request',reportId:'report',ownerId:'owner',algorithmVersion:'1.0.0',parameterProvenance:{fixedDemoValues:{digitizer:'Cosmos'},systemSnapshot:{name:'Private system'},userMetadataSnapshot:{address:'private'}},inputs:[{sampleId:'sample',objectKey:'raw/123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001/input.wav',versionId:'v1',checksumSha256:'base64checksum',contentType:'audio/wav'}]});
  assert.deepEqual(Object.keys(state).sort(),['algorithmVersion','effectiveAlgorithmValues','inputs','outputPrefix','reportId','requestId']);
  assert.equal(JSON.stringify(state).includes('Private system'),false);
  assert.equal(JSON.stringify(state).includes('private'),false);
});
test('trusted finalizer manifest includes pinned input and database provenance',async()=>{
  const calls:string[]=[];
  const client={query:async(sql:string)=>{calls.push(sql);return calls.length===1?{rows:[{kind:'report_pdf',object_key:'reports/owner/report/report.pdf',object_version_id:'version',content_type:'application/pdf',byte_length:9,checksum_sha256:hash}]}:{rows:[{input_ordinal:0,object_key:'raw/owner/input.wav',object_version_id:'raw-version',object_checksum_sha256:'raw-checksum',sample_id:'sample',content_type:'audio/wav',byte_length:12,recorded_at:new Date('2026-01-01T00:00:00Z'),metadata:{sampleRateHz:96000},system_snapshot:{name:'System'},psiu_unit_id:'psiu',observed_psiu_uid:'uid'}]};}};
  const manifest=await buildManifest(client,'report',{algorithm_version:'1.0.0',parameter_provenance:{fixedDemoValues:{digitizer:'Cosmos'}},system_snapshot:{name:'System'},user_metadata_snapshot:{}});
  assert.equal(manifest.inputProvenance[0].objectVersionId,'raw-version');
  assert.equal(manifest.inputProvenance[0].checksumSha256,'raw-checksum');
  assert.equal(manifest.parameterProvenance.fixedDemoValues.digitizer,'Cosmos');
  assert.equal(manifest.artifacts[0].object_version_id,'version');
});
