import { readFileSync } from 'node:fs';
const templatePath=process.argv[2] ?? 'cdk.out/WallyPlatform-production.template.json';
const template=JSON.parse(readFileSync(templatePath,'utf8'));
const stateMachine=Object.values(template.Resources).find(resource=>resource.Type==='AWS::StepFunctions::StateMachine');
if(!stateMachine)throw new Error('Report state machine resource is missing.');
const flatten=value=>typeof value==='string'?value:Array.isArray(value)?value.map(flatten).join(''):value&&typeof value==='object'&&Array.isArray(value['Fn::Join'])?flatten(value['Fn::Join'][1]):'<intrinsic>';
const definition=flatten(stateMachine.Properties?.DefinitionString);
for(const expected of ['"ReportFanout"','"ResultPath":"$.fanout"','"Next":"ReportRequestFinalize"','"requestId.$":"$.requestId"','"ResultPath":"$.worker"','"artifacts.$":"$.worker.artifacts"'])if(!definition.includes(expected))throw new Error(`Report workflow execution shape is missing ${expected}.`);
console.log('Report State Machine preserves requestId across fan-out.');
