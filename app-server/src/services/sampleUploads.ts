import { GetObjectCommand, type GetObjectCommandOutput, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { CreateSampleUploadBatchRequest } from '@wally/contracts';
import { HttpError } from './auth.js';

export const MAX_WAV_BYTES = 2 * 1024 * 1024 * 1024;
const URL_TTL_SECONDS = 15 * 60;
export const UPLOAD_LIFECYCLE_TAG_KEY = 'wally-upload-state';
export const UNACCEPTED_UPLOAD_TAG = `${UPLOAD_LIFECYCLE_TAG_KEY}=unaccepted`;
export const ACCEPTED_UPLOAD_TAG = `${UPLOAD_LIFECYCLE_TAG_KEY}=accepted`;
export type UploadIntentRow = { sampleId:string; clientFileId:string; fileName:string; objectKey:string; contentType:string; byteLength:number; sha256Base64?:string };

export function validateUploadBatch(request: CreateSampleUploadBatchRequest): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(request.idempotencyKey)) throw new HttpError(400, 'A valid idempotency key is required.');
  if (!request.psiuUnitId || !Array.isArray(request.files) || request.files.length < 1 || request.files.length > 25) throw new HttpError(400, 'Upload batch must contain 1 to 25 files.');
  if (request.source !== 'manual_file' && request.source !== 'psiu_capture') throw new HttpError(400, 'Upload source is invalid.');
  if (request.source === 'psiu_capture' && (!request.observedPsiuUid || request.observedPsiuUid.trim().length > 256)) throw new HttpError(400, 'PSIU capture uploads require an observed PSIU UID.');
  const fileIds = new Set<string>();
  for (const file of request.files) {
    if (file.source !== request.source) throw new HttpError(400, 'Upload batch files must share one source.');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(file.clientFileId) || fileIds.has(file.clientFileId)) throw new HttpError(400, 'Each upload file requires a unique stable client file ID.');
    fileIds.add(file.clientFileId);
    if (!file.fileName.toLowerCase().endsWith('.wav') || !['audio/wav', 'audio/wave', 'audio/x-wav'].includes(file.contentType.toLowerCase())) throw new HttpError(400, 'Only WAV files are accepted.');
    if (!Number.isSafeInteger(file.byteLength) || file.byteLength < 44 || file.byteLength > MAX_WAV_BYTES) throw new HttpError(400, `WAV size must be between 44 and ${MAX_WAV_BYTES} bytes.`);
    if (!Number.isFinite(Date.parse(file.recordedAt))) throw new HttpError(400, 'recordedAt must be an ISO timestamp.');
    if (file.sha256Base64 && !/^[A-Za-z0-9+/]{43}=$/.test(file.sha256Base64)) throw new HttpError(400, 'sha256Base64 must be a SHA-256 base64 digest.');
  }
}

export async function presignUpload(intent: UploadIntentRow, bucketName:string, s3:S3Client) {
  const command = new PutObjectCommand({ Bucket:bucketName, Key:intent.objectKey, ContentType:intent.contentType, Tagging:UNACCEPTED_UPLOAD_TAG, ...(intent.sha256Base64 ? { ChecksumSHA256:intent.sha256Base64 } : {}) });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: URL_TTL_SECONDS, ...(intent.sha256Base64 ? { unhoistableHeaders:new Set(['x-amz-checksum-sha256']) } : {}) });
  return { sampleId:intent.sampleId, clientFileId:intent.clientFileId, fileName:intent.fileName, uploadUrl, expiresAt:new Date(Date.now()+URL_TTL_SECONDS*1000).toISOString(), requiredHeaders:{ 'content-type':intent.contentType, ...(intent.sha256Base64 ? { 'x-amz-checksum-sha256':intent.sha256Base64 } : {}) } };
}

export async function verifyWavObject(intent: UploadIntentRow, bucketName:string, s3:S3Client): Promise<{ sampleRateHz:number; channels:number; bitsPerSample:number; durationMs:number }> {
  const head = await s3.send(new HeadObjectCommand({ Bucket:bucketName, Key:intent.objectKey, ChecksumMode:'ENABLED' }));
  if (head.ContentLength !== intent.byteLength) throw new HttpError(409, 'Uploaded object size does not match the upload intent.');
  if (intent.sha256Base64 && head.ChecksumSHA256 !== intent.sha256Base64) throw new HttpError(409, 'Uploaded object checksum does not match the upload intent.');
  const response = await s3.send(new GetObjectCommand({ Bucket:bucketName, Key:intent.objectKey, Range:'bytes=0-65535' }));
  const bytes = await readBody(response);
  return parseWavHeader(bytes, intent.byteLength);
}

async function readBody(response:GetObjectCommandOutput): Promise<Uint8Array> {
  if (!response.Body) throw new HttpError(409, 'Uploaded WAV cannot be read.');
  const chunks:Buffer[]=[]; for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
}

export function parseWavHeader(bytes:Uint8Array, totalBytes:number): { sampleRateHz:number; channels:number; bitsPerSample:number; durationMs:number } {
  const b=Buffer.from(bytes); if (b.length<44 || b.toString('ascii',0,4)!=='RIFF' || b.toString('ascii',8,12)!=='WAVE') throw new HttpError(409,'Uploaded object is not a RIFF/WAVE file.');
  const boundary=b.readUInt32LE(4)+8; if(boundary!==totalBytes) throw new HttpError(409,'WAV RIFF size does not match uploaded object size.');
  let offset=12; let format: {channels:number;rate:number;bits:number;blockAlign:number;byteRate:number}|undefined; let dataLength:number|undefined;
  while(offset+8<=boundary){ if(offset+8>b.length) throw new HttpError(409,'WAV header range is incomplete.'); const id=b.toString('ascii',offset,offset+4); const length=b.readUInt32LE(offset+4); const next=offset+8+length+(length%2); if(next>boundary) throw new HttpError(409,'WAV chunk exceeds RIFF boundary.'); if(id==='fmt '){ if(length<16||offset+24>b.length) throw new HttpError(409,'WAV format chunk is invalid.'); const tag=b.readUInt16LE(offset+8); if(tag!==1&&tag!==3) throw new HttpError(409,'Only PCM WAV files are accepted.'); format={channels:b.readUInt16LE(offset+10),rate:b.readUInt32LE(offset+12),byteRate:b.readUInt32LE(offset+16),blockAlign:b.readUInt16LE(offset+20),bits:b.readUInt16LE(offset+22)}; } if(id==='data'){dataLength=length;break;} offset=next; }
  if(!format||!dataLength||format.channels<1||format.channels>8||format.rate<8000||format.rate>384000||![8,16,24,32].includes(format.bits)||format.blockAlign!==format.channels*format.bits/8||format.byteRate!==format.rate*format.blockAlign) throw new HttpError(409,'WAV header is unsupported or incomplete.');
  return {sampleRateHz:format.rate,channels:format.channels,bitsPerSample:format.bits,durationMs:Math.round(dataLength/format.blockAlign/format.rate*1000)};
}

export function newObjectKey(ownerId:string,sampleId:string,_fileName:string):string { return `raw/${ownerId}/${sampleId}/input.wav`; }

/** Object keys enter workflow state; keep all user-provided file names in Postgres metadata only. */
export function isOpaqueRawObjectKey(key:string):boolean { return /^raw\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/input\.wav$/i.test(key); }
