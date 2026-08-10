import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { SampleUploadRequest, SampleUploadResponse } from '@wally/contracts';
import { HttpError } from './auth.js';

const MAX_SAMPLE_BYTES = 2 * 1024 * 1024 * 1024;
const URL_TTL_SECONDS = 15 * 60;

export async function createSampleUpload(
  subject: string,
  request: SampleUploadRequest,
  dependencies: { bucketName: string; s3: S3Client },
): Promise<SampleUploadResponse> {
  validateUploadRequest(request);

  const sampleId = randomUUID();
  const safeFileName = request.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `raw/${subject}/${sampleId}/${safeFileName}`;
  const command = new PutObjectCommand({
    Bucket: dependencies.bucketName,
    Key: objectKey,
    ContentType: request.contentType,
    Metadata: {
      sampleid: sampleId,
      recordedat: request.metadata.recordedAt,
      ...(request.sha256 ? { sha256: request.sha256 } : {}),
      ...(request.psuDeviceId ? { psiudeviceid: request.psuDeviceId } : {}),
    },
  });
  const uploadUrl = await getSignedUrl(dependencies.s3, command, { expiresIn: URL_TTL_SECONDS });

  return {
    sampleId,
    objectKey,
    uploadUrl,
    expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1_000).toISOString(),
  };
}

function validateUploadRequest(request: SampleUploadRequest): void {
  if (!request.fileName || !request.contentType || !request.metadata?.recordedAt) {
    throw new HttpError(400, 'fileName, contentType, and metadata.recordedAt are required.');
  }
  if (!Number.isSafeInteger(request.byteLength) || request.byteLength <= 0 || request.byteLength > MAX_SAMPLE_BYTES) {
    throw new HttpError(400, `byteLength must be between 1 and ${MAX_SAMPLE_BYTES}.`);
  }
}
