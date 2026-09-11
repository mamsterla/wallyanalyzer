import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SAMPLE_BUCKET_NAME='raw'; process.env.REPORT_BUCKET_NAME='reports';
const { artifactDescriptorIsValid }=await import('./reportWorkflow.js');
const hash='a'.repeat(64), prefix='reports/owner/report/';
test('report finalizer rejects worker-controlled paths, kinds, and checksums',()=>{
  assert.equal(artifactDescriptorIsValid({kind:'report_pdf',objectKey:`${prefix}report.pdf`,contentType:'application/pdf',byteLength:10,checksumSha256:hash},prefix),true);
  assert.equal(artifactDescriptorIsValid({kind:'report_pdf',objectKey:'reports/other/report.pdf',contentType:'application/pdf',byteLength:10,checksumSha256:hash},prefix),false);
  assert.equal(artifactDescriptorIsValid({kind:'script',objectKey:`${prefix}x`,contentType:'text/plain',byteLength:10,checksumSha256:hash},prefix),false);
  assert.equal(artifactDescriptorIsValid({kind:'graph_svg_2',objectKey:`${prefix}two.svg`,contentType:'image/svg+xml',byteLength:10,checksumSha256:'bad'},prefix),false);
});
