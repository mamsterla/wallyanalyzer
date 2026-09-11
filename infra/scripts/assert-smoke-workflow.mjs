import { readFileSync } from 'node:fs';

const templatePath=process.argv[2] ?? 'cdk.out/WallyPlatform-production.template.json';
const template=JSON.parse(readFileSync(templatePath,'utf8'));
const resources=template.Resources;
const entries=Object.entries(resources);
const find=(part,type)=>entries.filter(([id,value])=>id.includes(part)&&value.Type===type);
const flatten=value=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value&&typeof value==='object'?Object.values(value).map(flatten).join(''):'';
const smokeFunctions=entries.filter(([id,value])=>(id.startsWith('SmokeReport')||id.startsWith('SmokeAnalysis')||id.startsWith('ReportSmokeRunner'))&&value.Type==='AWS::Lambda::Function');
if(smokeFunctions.length<7)throw new Error('Expected isolated smoke workflow Lambda functions and manual runner.');
const smokeMachine=find('SmokeReportStateMachine','AWS::StepFunctions::StateMachine');
if(smokeMachine.length!==1)throw new Error('Expected one distinct Standard smoke report state machine.');
const [smokeMachineId]=smokeMachine[0];
const smokeDispatcher=find('SmokeReportDispatcherFunction','AWS::Lambda::Function');
if(smokeDispatcher.length!==1)throw new Error('Expected exactly one isolated smoke dispatcher.');
const dispatcherVariables=smokeDispatcher[0][1].Properties?.Environment?.Variables??{};
if(!flatten(dispatcherVariables.REPORT_STATE_MACHINE_ARN).includes(smokeMachineId))throw new Error('Smoke dispatcher must reference only the smoke state machine ARN.');
const smokeText=JSON.stringify(smokeFunctions.map(([,value])=>value));
for(const expected of ['SMOKE_DATABASE_SECRET_ARN','SMOKE_DATABASE_NAME','SMOKE_DISPATCHER_FUNCTION_NAME','smoke/raw/','smoke/reports/'])if(!smokeText.includes(expected))throw new Error(`Smoke functions are missing ${expected}.`);
for(const [,fn] of smokeFunctions){
  const variables=fn.Properties?.Environment?.Variables??{};
  for(const forbidden of ['DATABASE_SECRET_ARN','MASTER_DATABASE_SECRET_ARN'])if(Object.prototype.hasOwnProperty.call(variables,forbidden))throw new Error(`Smoke functions must not receive ${forbidden}.`);
}
if(entries.some(([id,value])=>id.includes('SmokeDatabaseBootstrap')||flatten(value).includes('smokeDbBootstrap')))throw new Error('Smoke bootstrap must be an explicit one-time operator action, not a deployed resource.');
const smokePolicies=find('Smoke','AWS::IAM::Policy');
const policyText=JSON.stringify(smokePolicies.map(([,value])=>value));
for(const expected of ['smoke/raw/*','smoke/reports/*'])if(!policyText.includes(expected))throw new Error(`Smoke IAM is missing ${expected}.`);
for(const forbidden of ['raw/*','reports/*']){const unscoped=policyText.replaceAll('smoke/raw/*','').replaceAll('smoke/reports/*','');if(unscoped.includes(forbidden))throw new Error(`Smoke IAM must not allow ${forbidden}.`);}
if(/"Fn::GetAtt"\s*:\s*\["DatabaseSecret/.test(policyText))throw new Error('Smoke IAM must not grant the platform-admin database secret.');
const scheduler=find('Smoke','AWS::Events::Rule');
if(scheduler.length)throw new Error('Smoke lane must not have an automatic EventBridge schedule.');
console.log('Smoke workflow is isolated by database secret, state machine, IAM, prefixes, manual runner, and no persistent master-secret bootstrap.');
