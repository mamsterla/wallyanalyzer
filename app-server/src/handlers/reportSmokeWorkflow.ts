import * as workflow from './reportWorkflow.js';

/**
 * Smoke-lane wrappers deliberately bind the shared workflow code to the isolated
 * smoke database. The smoke runner and migrations are added separately.
 */
function bindSmokeDatabase() {
  const secret = process.env.SMOKE_DATABASE_SECRET_ARN;
  const database = process.env.SMOKE_DATABASE_NAME;
  if (!secret || !database) throw new Error('Smoke database configuration is required.');
  process.env.DATABASE_SECRET_ARN = secret;
  process.env.DATABASE_NAME = database;
  process.env.RAW_PREFIX = requiredPrefix('SMOKE_RAW_PREFIX');
  process.env.REPORT_PREFIX = requiredPrefix('SMOKE_REPORT_PREFIX');
}
function requiredPrefix(name:string) { const value=process.env[name]; if (!value || !value.endsWith('/')) throw new Error(`Missing ${name}`); return value; }

export async function dispatch() { bindSmokeDatabase(); return workflow.dispatch(); }
export async function preflight(event: Parameters<typeof workflow.preflight>[0]) { bindSmokeDatabase(); return workflow.preflight(event); }
export async function finalize(event: Parameters<typeof workflow.finalize>[0]) { bindSmokeDatabase(); return workflow.finalize(event); }
export async function fail(event: Parameters<typeof workflow.fail>[0]) { bindSmokeDatabase(); return workflow.fail(event); }
export async function finalizeRequest(event: Parameters<typeof workflow.finalizeRequest>[0]) { bindSmokeDatabase(); return workflow.finalizeRequest(event); }
