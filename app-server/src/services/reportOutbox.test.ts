import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchReportOutbox, type ClaimedReportRequest, type ReportExecutionStarter } from './reportRepository.js';

test('dispatch starts stable claimed execution and marks it processed', async()=>{
  const item:ClaimedReportRequest={outboxId:'outbox',requestId:'request',executionName:'report-request',reportIds:['one','two']};
  const calls:string[]=[];
  const outbox={claim:async()=>[item],started:async(x:ClaimedReportRequest,arn:string)=>calls.push(`${x.executionName}:${arn}`),retry:async()=>calls.push('retry')};
  const starter:ReportExecutionStarter={start:async input=>{assert.deepEqual(input,{requestId:'request',reportIds:['one','two'],executionName:'report-request'});return{executionArn:'arn:execution'}}};
  assert.equal(await dispatchReportOutbox(outbox as never,starter),1);
  assert.deepEqual(calls,['report-request:arn:execution']);
});
test('dispatch leaves a failed start retryable', async()=>{
  const item:ClaimedReportRequest={outboxId:'outbox',requestId:'request',executionName:'report-request',reportIds:['one']}; let retried='';
  const outbox={claim:async()=>[item],started:async()=>assert.fail('must not mark processed'),retry:async(x:ClaimedReportRequest,error:unknown)=>retried=`${x.outboxId}:${(error as Error).message}`};
  const starter:ReportExecutionStarter={start:async()=>{throw new Error('transient') }};
  assert.equal(await dispatchReportOutbox(outbox as never,starter),0);assert.equal(retried,'outbox:transient');
});
