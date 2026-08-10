#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WallyPlatformStack } from '../lib/wally-platform-stack.js';

const app = new cdk.App();
const environment = app.node.tryGetContext('environment') ?? 'staging';
if (environment !== 'staging' && environment !== 'production') {
  throw new Error('context environment must be staging or production');
}

new WallyPlatformStack(app, `WallyPlatform-${environment}`, {
  environment,
  description: `Wally Analyzer platform (${environment})`,
});
