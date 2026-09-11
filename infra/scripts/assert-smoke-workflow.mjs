import { readFileSync } from 'node:fs';

const templatePath=process.argv[2] ?? 'cdk.out/WallyPlatform-production.template.json';
const template=JSON.parse(readFileSync(templatePath,'utf8'));
const resources=template.Resources;
const find=(part,type)=>Object.entries(resources).filter(([id,value])=>id.includes(part)&&value.Type===type);
const smokeFunctions=Object.entries(resources).filter(([id,value])=>(id.startsWith('SmokeReport')||id.startsWith('SmokeAnalysis'))&&value.Type==='AWS::Lambda::Function');
if(smokeFunctions.length<6)throw new Error('Expected isolated smoke workflow Lambda functions.');
const smokeMachine=find('SmokeReportStateMachine','AWS::StepFunctions::StateMachine');
if(smokeMachine.length!==1)throw new Error('Expected one distinct Standard smoke report state machine.');
const flatten=value=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value&&typeof value==='object'?Object.values(value).map(flatten).join(''):'';
const smokeText=JSON.stringify(smokeFunctions.map(([,value])=>value));
for(const expected of ['SMOKE_DATABASE_SECRET_ARN','SMOKE_DATABASE_NAME','smoke/raw/','smoke/reports/'])if(!smokeText.includes(expected))throw new Error(`Smoke functions are missing ${expected}.`);
for(const [,fn] of smokeFunctions){const variables=fn.Properties?.Environment?.Variables??{};if(Object.prototype.hasOwnProperty.call(variables,'DATABASE_SECRET_ARN'))throw new Error('Smoke functions must not receive DATABASE_SECRET_ARN.');}
const smokePolicies=find('Smoke','AWS::IAM::Policy');
const policyText=JSON.stringify(smokePolicies.map(([,value])=>value));
for(const expected of ['smoke/raw/*','smoke/reports/*'])if(!policyText.includes(expected))throw new Error(`Smoke IAM is missing ${expected}.`);
for(const forbidden of ['raw/*','reports/*']){const unscoped=policyText.replaceAll('smoke/raw/*','').replaceAll('smoke/reports/*','');if(unscoped.includes(forbidden))throw new Error(`Smoke IAM must not allow ${forbidden}.`);}
const scheduler=find('Smoke','AWS::Events::Rule');
if(scheduler.length)throw new Error('Smoke lane must not have an automatic EventBridge schedule.');
console.log('Smoke workflow is isolated by state machine, secret, prefixes, IAM, and manual dispatch.');
