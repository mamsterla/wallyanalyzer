import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import type { SampleUploadRequest } from '@wally/contracts';
import { authenticatedSubject, HttpError, requireRole } from '../services/auth.js';
import { createSampleUpload } from '../services/uploads.js';

const s3 = new S3Client({});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    if (event.httpMethod === 'GET' && event.resource === '/health') {
      return json(200, { status: 'ok' });
    }

    if (event.httpMethod === 'POST' && event.resource === '/v1/samples/uploads') {
      const subject = authenticatedSubject(event);
      requireRole(event, 'user');
      const request = parseJson<SampleUploadRequest>(event.body ?? undefined);
      const bucketName = requiredEnvironment('SAMPLE_BUCKET_NAME');
      const upload = await createSampleUpload(subject, request, { bucketName, s3 });
      // Persist upload intent in Postgres before returning in production. The migration defines samples.
      return json(201, upload);
    }

    return json(404, { message: 'Route not found.' });
  } catch (error) {
    if (error instanceof HttpError) return json(error.statusCode, { message: error.message });
    console.error('Unhandled API error', error);
    return json(500, { message: 'Internal server error.' });
  }
}

function parseJson<T>(body: string | undefined): T {
  if (!body) throw new HttpError(400, 'JSON request body required.');
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON request body.');
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
