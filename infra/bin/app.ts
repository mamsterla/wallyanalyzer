#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WallyPlatformStack } from '../lib/wally-platform-stack.js';

const app = new cdk.App();
const environment = app.node.tryGetContext('environment') ?? 'production';
if (environment !== 'production') {
  throw new Error('Only the production AWS stack is defined. Development runs in local Docker Compose.');
}

new WallyPlatformStack(app, 'WallyPlatform-production', {
  env: { account: '265404809336', region: 'us-east-1' },
  githubConnectionArn: 'arn:aws:codestar-connections:us-east-1:265404809336:connection/f749d6e5-912d-42d3-8569-df047653ac31',
  githubOwner: 'mamsterla',
  githubRepository: 'wallyanalyzer',
  description: 'Wally Analyzer private production platform',
});
