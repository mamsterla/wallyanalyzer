import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { AdminFulfillmentRequest } from '@wally/contracts';
import { Pool } from 'pg';
import { HttpError, verifyCognitoAccessToken, type AuthenticatedPrincipal } from './services/auth.js';
import { provisionFulfillment, type FulfillmentRepository } from './services/fulfillment.js';
import { requireActiveFulfillmentAdmin } from './services/fulfillmentAuthorization.js';
import { PostgresFulfillmentRepository, type ActiveAdminRepository } from './services/fulfillmentRepository.js';
import { databaseSettings } from './migrate.js';

const port = Number(process.env.PORT ?? 3000);

export function createProductionServer(dependencies: Partial<ProductionDependencies> = {}) {
  const pool = dependencies.pool ?? new Pool(databaseSettings());
  const repository = dependencies.repository ?? new PostgresFulfillmentRepository(pool);
  const cognito = dependencies.cognito ?? new CognitoIdentityProviderClient({});
  const verify = dependencies.verify ?? verifyCognitoAccessToken;

  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, 200, { status: 'ok', service: 'wally-app-server' });
      }
      if (request.method === 'POST' && request.url === '/v1/admin/fulfillment') {
        const token = bearerToken(request);
        const principal = await verify(token, cognitoSettings());
        const actor = await requireActiveFulfillmentAdmin(principal, repository);
        const fulfillment = await provisionFulfillment(await parseJson<AdminFulfillmentRequest>(request), {
          userPoolId: requiredEnvironment('COGNITO_USER_POOL_ID'),
          cognito,
          repository,
          assignedByUserId: actor.id,
          requestId: requestId(request),
        });
        return sendJson(response, 201, fulfillment);
      }
      return sendJson(response, 404, { message: 'Route not found.' });
    } catch (error) {
      if (error instanceof HttpError) return sendJson(response, error.statusCode, { message: error.message });
      console.error('Unhandled production API error', error);
      return sendJson(response, 500, { message: 'Internal server error.' });
    }
  });
}

interface ProductionDependencies {
  pool: Pool;
  repository: FulfillmentRepository & ActiveAdminRepository;
  cognito: CognitoIdentityProviderClient;
  verify: (token: string, settings: { userPoolId: string; clientId: string }) => Promise<AuthenticatedPrincipal>;
}

function bearerToken(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) throw new HttpError(401, 'Bearer access token required.');
  const token = value.slice('Bearer '.length).trim();
  if (!token) throw new HttpError(401, 'Bearer access token required.');
  return token;
}

async function parseJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new HttpError(413, 'Request body too large.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'Valid JSON request body required.');
  }
}

function cognitoSettings(): { userPoolId: string; clientId: string } {
  return {
    userPoolId: requiredEnvironment('COGNITO_USER_POOL_ID'),
    clientId: requiredEnvironment('COGNITO_WEB_CLIENT_ID'),
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requestId(request: IncomingMessage): string | undefined {
  const value = request.headers['x-request-id'];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

if (process.argv[1]?.endsWith('production.js')) {
  createProductionServer().listen(port, '0.0.0.0', () => {
    console.info(`Wally private production API listening on port ${port}`);
  });
}
