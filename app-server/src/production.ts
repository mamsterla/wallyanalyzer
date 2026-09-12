import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminResetUserPasswordCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type {
  AdminFulfillmentRequest,
  AssignPsiuRequest,
  CreateCustomerRequest,
  CreatePsiuRequest,
  CreateSampleUploadBatchRequest,
  CreateSystemRequest,
  UpdateProfileRequest,
  UpdateSystemRequest,
  CreditAdjustmentRequest,
  CreateReportRequest,
} from '@wally/contracts';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Pool } from 'pg';
import {
  HttpError,
  verifyCognitoAccessToken,
  type AuthenticatedPrincipal,
} from './services/auth.js';
import { requireAdmin, requirePrincipal } from './services/accountAuthorization.js';
import {
  PostgresAccountRepository,
  type AccountRepository,
  type CognitoReconciliationJob,
} from './services/accountRepository.js';
import { databaseSettings } from './migrate.js';
import { PostgresSampleRepository, type SampleRepository } from './services/sampleRepository.js';
import { PostgresUserExperienceRepository } from './services/userExperienceRepository.js';
import { PostgresAdminDataRepository } from './services/adminDataRepository.js';
import { PostgresUserAlertsRepository } from './services/userAlertsRepository.js';
import { PostgresReportRepository } from './services/reportRepository.js';
import {
  ACCEPTED_UPLOAD_TAG,
  UNACCEPTED_UPLOAD_TAG,
  UPLOAD_LIFECYCLE_TAG_KEY,
  presignUpload,
  validateUploadBatch,
  verifyWavObject,
} from './services/sampleUploads.js';

const port = Number(process.env.PORT ?? 3000);
export function createProductionServer(dependencies: ProductionDependencies) {
  const pool = dependencies.pool;
  const repository = dependencies.repository ?? new PostgresAccountRepository(pool);
  const samples = dependencies.samples ?? new PostgresSampleRepository(pool);
  const reports = dependencies.reports ?? new PostgresReportRepository(pool);
  const experience = new PostgresUserExperienceRepository(pool);
  const adminData = dependencies.adminData ?? new PostgresAdminDataRepository(pool);
  const alerts = new PostgresUserAlertsRepository(pool);
  const s3 = dependencies.s3 ?? new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
  const bucketName = dependencies.sampleBucketName ?? process.env.SAMPLE_BUCKET_NAME ?? '';
  const cognito = dependencies.cognito ?? new CognitoIdentityProviderClient({});
  const verify = dependencies.verify ?? verifyCognitoAccessToken;
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health')
        return sendJson(response, 200, { status: 'ok', service: 'wally-app-server' });
      const path = new URL(request.url ?? '/', 'http://wally.local').pathname;
      const principal = await verify(bearerToken(request), cognitoSettings());
      if (request.method === 'POST' && path === '/v1/me/confirm-email') {
        const account = await repository.findEmailConfirmationPrincipal(principal.subject);
        if (!account) throw new HttpError(403, 'Account required.');
        const user = await cognito.send(
          new AdminGetUserCommand({ UserPoolId: poolId(), Username: account.email }),
        );
        if (user.UserAttributes?.find((x) => x.Name === 'email_verified')?.Value !== 'true')
          throw new HttpError(403, 'Confirm your email before activating your account.');
        await repository.confirmEmail(principal.subject);
        return sendJson(response, 204);
      }
      const actor = await requirePrincipal(principal, repository);
      if (request.method === 'POST' && path === '/v1/me/last-active') {
        await adminData.touchLastActive(actor.id);
        return sendJson(response, 204);
      }
      if (request.method === 'GET' && path === '/v1/me')
        return sendJson(response, 200, await repository.me(actor.id));
      if (request.method === 'GET' && path === '/v1/me/units')
        return sendJson(response, 200, (await repository.me(actor.id))?.units ?? []);
      if (request.method === 'GET' && path === '/v1/me/alerts')
        return sendJson(response, 200, await alerts.list(actor.id));
      const dismissAlert = path.match(/^\/v1\/me\/alerts\/([^/]+)\/dismiss$/);
      if (request.method === 'POST' && dismissAlert) {
        await alerts.dismiss(actor.id, dismissAlert[1]);
        return sendJson(response, 204);
      }
      if (request.method === 'PUT' && path === '/v1/me/profile')
        return sendJson(
          response,
          200,
          await experience.updateProfile(actor.id, await parseJson<UpdateProfileRequest>(request)),
        );
      if (request.method === 'GET' && path === '/v1/me/systems')
        return sendJson(response, 200, await experience.systems(actor.id));
      if (request.method === 'POST' && path === '/v1/me/systems')
        return sendJson(
          response,
          201,
          await experience.createSystem(actor.id, await parseJson<CreateSystemRequest>(request)),
        );
      const systemUpdate = path.match(/^\/v1\/me\/systems\/([^/]+)$/);
      if (request.method === 'PUT' && systemUpdate)
        return sendJson(
          response,
          200,
          await experience.updateSystem(
            actor.id,
            systemUpdate[1],
            await parseJson<UpdateSystemRequest>(request),
          ),
        );
      if (request.method === 'DELETE' && systemUpdate) {
        await experience.deleteSystem(actor.id, systemUpdate[1]);
        return sendJson(response, 204);
      }
      const activeSystem = path.match(/^\/v1\/me\/systems\/([^/]+)\/active$/);
      if (request.method === 'POST' && activeSystem) {
        await experience.setActive(actor.id, activeSystem[1]);
        return sendJson(response, 204);
      }
      if (request.method === 'GET' && path === '/v1/me/credits')
        return sendJson(
          response,
          200,
          await adminData.credits(
            actor.id,
            pageQuery(new URL(request.url ?? '/', 'http://wally.local').searchParams),
          ),
        );
      if (path.startsWith('/v1/reports'))
        return await reportRoute(
          request,
          response,
          path,
          actor.id,
          reports,
          s3,
          dependencies.reportBucketName ?? process.env.REPORT_BUCKET_NAME ?? '',
        );
      if (path.startsWith('/v1/samples'))
        return await sampleRoute(request, response, path, actor.id, samples, s3, bucketName);
      if (path.startsWith('/v1/admin/')) {
        requireAdmin(actor);
        return await adminRoute(
          request,
          response,
          path,
          actor.id,
          repository,
          cognito,
          s3,
          bucketName,
          adminData,
        );
      }
      return sendJson(response, 404, { message: 'Route not found.' });
    } catch (error) {
      if (error instanceof HttpError)
        return sendJson(response, error.statusCode, { message: error.message });
      console.error('Unhandled production API error', error);
      return sendJson(response, 500, { message: 'Internal server error.' });
    }
  });
}
async function adminRoute(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  actor: string,
  repo: AccountRepository,
  cognito: CognitoIdentityProviderClient,
  s3: S3Client,
  bucketName: string,
  data: PostgresAdminDataRepository,
): Promise<void> {
  const query = new URL(request.url ?? '/', 'http://wally.local').searchParams;
  if (request.method === 'GET' && path === '/v1/admin/users')
    return sendJson(
      response,
      200,
      await data.users({
        q: query.get('q') ?? undefined,
        lifecycle: enumQuery(query, 'lifecycle', [
          'draft',
          'ready',
          'invited',
          'active',
          'suspended',
          'cancelled',
        ]),
        sortBy: query.get('sortBy') ?? undefined,
        sortDirection: query.get('sortDirection') ?? undefined,
        ...pageQuery(query),
      }),
    );
  if (request.method === 'GET' && path === '/v1/admin/users/typeahead')
    return sendJson(response, 200, await data.typeahead(query.get('q') ?? ''));
  if (request.method === 'GET' && path === '/v1/admin/credits')
    return sendJson(
      response,
      200,
      await data.creditEntries({
        sortBy: query.get('sortBy') ?? undefined,
        sortDirection: query.get('sortDirection') ?? undefined,
        ...pageQuery(query),
      }),
    );
  if (request.method === 'GET' && path === '/v1/admin/credits/stats')
    return sendJson(
      response,
      200,
      await data.creditStats({ from: dateQuery(query, 'from'), to: dateQuery(query, 'to') }),
    );
  if (request.method === 'POST' && path.match(/^\/v1\/admin\/users\/[^/]+\/credits$/)) {
    const userId = path.split('/')[4];
    return sendJson(
      response,
      201,
      await data.adjustCredits(userId, actor, await parseJson<CreditAdjustmentRequest>(request)),
    );
  }
  const creditHistory = path.match(/^\/v1\/admin\/users\/([^/]+)\/credits$/);
  if (request.method === 'GET' && creditHistory)
    return sendJson(response, 200, await data.credits(creditHistory[1], pageQuery(query)));
  const userDetail = path.match(/^\/v1\/admin\/users\/([^/]+)$/);
  if (request.method === 'GET' && userDetail) {
    const user = await data.user(userDetail[1]);
    if (!user) throw new HttpError(404, 'Customer not found.');
    return sendJson(response, 200, user);
  }
  if (request.method === 'PUT' && userDetail)
    return sendJson(
      response,
      200,
      await data.updateUser(userDetail[1], actor, await parseJson(request), requestId(request)),
    );
  if (request.method === 'GET' && path === '/v1/admin/samples')
    return sendJson(
      response,
      200,
      await data.samples({
        ownerId: uuidQuery(query, 'ownerId'),
        psiuUnitId: uuidQuery(query, 'psiuUnitId'),
        q: query.get('q') ?? undefined,
        source: enumQuery(query, 'source', ['manual_file', 'psiu_capture']),
        state: enumQuery(query, 'state', ['intent', 'uploaded', 'failed']),
        sortBy: query.get('sortBy') ?? undefined,
        sortDirection: query.get('sortDirection') ?? undefined,
        ...pageQuery(query),
      }),
    );
  if (request.method === 'GET' && path === '/v1/admin/reports')
    return sendJson(
      response,
      200,
      await data.reports({
        q: query.get('q') ?? undefined,
        ownerId: uuidQuery(query, 'ownerId'),
        type: query.get('type') ?? undefined,
        status: enumQuery(query, 'status', [
          'queued',
          'running',
          'completed',
          'failed',
          'cancelled',
        ]),
        preset: query.get('preset') ?? undefined,
        sortBy: query.get('sortBy') ?? undefined,
        sortDirection: query.get('sortDirection') ?? undefined,
        ...pageQuery(query),
      }),
    );
  if (request.method === 'GET' && path === '/v1/admin/samples/stats')
    return sendJson(response, 200, await data.sampleStats(actor));
  const id = path.split('/')[4];
  const reqId = requestId(request);
  if (request.method === 'GET' && path === '/v1/admin/customers')
    return sendJson(response, 200, await repo.customers());
  if (request.method === 'POST' && path === '/v1/admin/customers') {
    const x = await parseJson<CreateCustomerRequest>(request);
    const customer = await repo.createCustomer(email(x.email), actor, reqId);
    await invite(customer.id, actor, repo, cognito, reqId);
    return sendJson(response, 201, await repo.customer(customer.id));
  }
  // Backward-compatible legacy fulfillment: create detached records, assign the unit, then invite.
  if (request.method === 'POST' && path === '/v1/admin/fulfillment') {
    const x = await parseJson<AdminFulfillmentRequest>(request);
    const customer = await repo.createCustomer(email(x.email), actor, reqId);
    const unit = await repo.createUnit(
      identifier(x.psiuSerialNumber, 'PSIU serial number', 128),
      identifier(x.psiuOpaqueUid ?? x.psiuSerialNumber, 'PSIU UID', 256),
      actor,
      reqId,
    );
    await repo.assign(unit.id, customer.id, actor, reqId);
    await invite(customer.id, actor, repo, cognito, reqId);
    const invited = await repo.customer(customer.id);
    return sendJson(response, 201, {
      userId: customer.id,
      psiuUnitId: unit.id,
      accountStatus: 'provisioned',
      lifecycle: invited?.lifecycle,
    });
  }
  if (request.method === 'GET' && path === '/v1/admin/psiu-units')
    return sendJson(
      response,
      200,
      await data.units({
        q: query.get('q') ?? undefined,
        customerId: uuidQuery(query, 'customerId'),
        status: enumQuery(query, 'status', ['enabled', 'disabled', 'unavailable']),
        assignment: enumQuery(query, 'assignment', ['assigned', 'unassigned']),
        sortBy: query.get('sortBy') ?? undefined,
        sortDirection: query.get('sortDirection') ?? undefined,
        ...pageQuery(query),
      }),
    );
  if (request.method === 'POST' && path === '/v1/admin/psiu-units') {
    const x = await parseJson<CreatePsiuRequest>(request);
    return sendJson(
      response,
      201,
      await repo.createUnit(
        identifier(x.serialNumber, 'PSIU serial number', 128),
        identifier(x.uid, 'PSIU UID', 256),
        actor,
        reqId,
      ),
    );
  }
  if (!id) throw new HttpError(404, 'Route not found.');
  if (request.method === 'POST' && path.endsWith('/assign')) {
    const x = await parseJson<AssignPsiuRequest>(request);
    await repo.assign(id, x.customerId, actor, reqId);
    return sendJson(response, 204);
  }
  if (request.method === 'POST' && path.endsWith('/deassign')) {
    await repo.deassign(id, actor, reqId);
    return sendJson(response, 204);
  }
  if (request.method === 'POST' && path.endsWith('/enable')) {
    await repo.setUnitStatus(id, 'enabled', actor, reqId);
    return sendJson(response, 204);
  }
  if (request.method === 'POST' && path.endsWith('/disable')) {
    await repo.setUnitStatus(id, 'disabled', actor, reqId);
    return sendJson(response, 204);
  }
  if (request.method === 'POST' && path.endsWith('/unavailable')) {
    const objectKeys = await repo.markUnitUnavailable(id, actor, reqId);
    await deleteUnavailableUploadObjects(s3, bucketName, objectKeys);
    return sendJson(response, 204);
  }
  if (request.method === 'DELETE' && path === `/v1/admin/psiu-units/${id}`) {
    await repo.hardDeleteUnit(id, actor, reqId);
    return sendJson(response, 204);
  }
  if (request.method === 'POST' && path.endsWith('/invite'))
    return invite(id, actor, repo, cognito, reqId, response);
  if (request.method === 'POST' && path.endsWith('/reconcile')) {
    const job =
      (await repo.pendingCognitoJob(id, 'archive_delete')) ??
      (await repo.pendingCognitoJob(id, 'invite_cleanup'));
    if (!job) throw new HttpError(409, 'No pending Cognito reconciliation.');
    await deleteCognito(job, cognito);
    await repo.completeCognitoJob(job, actor, reqId);
    return sendJson(response, 204);
  }
  if (request.method === 'POST' && path.endsWith('/reset-password'))
    return reset(id, actor, data, cognito, response, reqId);
  if (request.method === 'POST' && path.endsWith('/suspend')) {
    const x = await repo.setCustomerLifecycle(id, 'suspended', actor, reqId);
    if (x.cognitoSubject)
      await cognito.send(new AdminDisableUserCommand({ UserPoolId: poolId(), Username: x.email }));
    return sendJson(response, 204);
  }
  if (request.method === 'POST' && path.endsWith('/restore')) {
    const x = await repo.restoreCustomer(id, actor, reqId);
    if (x.cognitoSubject)
      await cognito.send(new AdminEnableUserCommand({ UserPoolId: poolId(), Username: x.email }));
    return sendJson(response, 204);
  }
  if (request.method === 'DELETE' && path.startsWith('/v1/admin/customers/')) {
    const x = await repo.archive(id, actor, reqId);
    if (x.job)
      try {
        await deleteCognito(x.job, cognito);
        await repo.completeCognitoJob(x.job, actor, reqId);
      } catch {
        /* durable pending job remains for /reconcile */
      }
    return sendJson(response, 204);
  }
  throw new HttpError(404, 'Route not found.');
}
async function invite(
  id: string,
  actor: string,
  repo: AccountRepository,
  cognito: CognitoIdentityProviderClient,
  reqId?: string,
  response?: ServerResponse,
) {
  const customer = await repo.customer(id);
  if (!customer) throw new HttpError(404, 'Customer not found.');
  const pending = await repo.pendingCognitoJob(id, 'invite_cleanup');
  if (pending) {
    await deleteCognito(pending, cognito);
    await repo.completeCognitoJob(pending, actor, reqId);
  }
  if (!['draft', 'ready'].includes(customer.lifecycle))
    throw new HttpError(409, 'Customer cannot be invited.');
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: poolId(),
      Username: customer.email,
      UserAttributes: [
        { Name: 'email', Value: customer.email },
        { Name: 'email_verified', Value: 'false' },
      ],
    }),
  );
  const subject = created.User?.Attributes?.find((x) => x.Name === 'sub')?.Value;
  if (!subject) throw new Error('Cognito did not return a user subject.');
  try {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: poolId(),
        Username: customer.email,
        GroupName: 'user',
      }),
    );
    await repo.markInvited(id, subject, actor, reqId);
  } catch (error) {
    const job = await repo.recordInviteCleanup(id, customer.email, subject, actor, reqId);
    try {
      await deleteCognito(job, cognito);
      await repo.completeCognitoJob(job, actor, reqId);
    } catch {
      /* retryable job is retained */
    }
    throw error;
  }
  if (response) sendJson(response, 202, { status: 'invited' });
}
async function deleteCognito(
  job: CognitoReconciliationJob,
  cognito: CognitoIdentityProviderClient,
) {
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: poolId(), Username: job.email }));
  } catch (error) {
    if (!(
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'UserNotFoundException'
    ))
      throw error;
  }
}
async function deleteUnavailableUploadObjects(
  s3: S3Client,
  bucketName: string,
  objectKeys: string[],
) {
  if (!bucketName) return;
  for (const key of objectKeys)
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    } catch (error) {
      console.error(
        'Failed to clean unavailable PSIU upload object.',
        error instanceof Error ? error.name : 'UnknownError',
      );
    }
}
async function deleteFailedUploadObject(
  samples: SampleRepository,
  ownerId: string,
  sampleId: string,
  s3: S3Client,
  bucketName: string,
) {
  const objectKey = await samples.failedObjectKey(ownerId, sampleId);
  if (objectKey) await deleteUnavailableUploadObjects(s3, bucketName, [objectKey]);
  return Boolean(objectKey);
}
async function setUploadLifecycleTag(
  s3: S3Client,
  bucketName: string,
  objectKey: string,
  value: 'accepted' | 'unaccepted',
) {
  const tag = value === 'accepted' ? ACCEPTED_UPLOAD_TAG : UNACCEPTED_UPLOAD_TAG;
  await s3.send(
    new PutObjectTaggingCommand({
      Bucket: bucketName,
      Key: objectKey,
      Tagging: {
        TagSet: [
          { Key: UPLOAD_LIFECYCLE_TAG_KEY, Value: tag.slice(UPLOAD_LIFECYCLE_TAG_KEY.length + 1) },
        ],
      },
    }),
  );
}
async function reset(
  id: string,
  actor: string,
  data: PostgresAdminDataRepository,
  cognito: CognitoIdentityProviderClient,
  response: ServerResponse,
  reqId?: string,
) {
  const customer = await data.passwordResetCustomer(id);
  if (!['invited', 'active'].includes(customer.lifecycle) || !customer.cognitoSubject)
    throw new HttpError(
      409,
      'Only invited or active Cognito-linked customers can receive a password reset email.',
    );
  await data.auditPasswordReset(id, actor, reqId);
  await cognito.send(
    new AdminResetUserPasswordCommand({ UserPoolId: poolId(), Username: customer.email }),
  );
  sendJson(response, 202, { status: 'reset_requested' });
}
async function sampleRoute(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  ownerId: string,
  samples: SampleRepository,
  s3: S3Client,
  bucketName: string,
): Promise<void> {
  if (request.method === 'POST' && path === '/v1/samples/upload-batches') {
    const value = await parseJson<CreateSampleUploadBatchRequest>(request);
    validateUploadBatch(value);
    const batch = await samples.createBatch(ownerId, value);
    return sendJson(response, 201, {
      batchId: batch.batchId,
      uploads: await Promise.all(
        batch.intents.map((intent) => presignUpload(intent, bucketName, s3)),
      ),
    });
  }
  const match = path.match(/^\/v1\/samples\/([^/]+)\/(complete|download)$/);
  if (!match) {
    if (request.method === 'GET' && path === '/v1/samples')
      return sendJson(response, 200, await samples.list(ownerId));
    throw new HttpError(404, 'Route not found.');
  }
  const [, sampleId, action] = match;
  if (request.method === 'POST' && action === 'complete') {
    const intent = await samples.intent(ownerId, sampleId);
    if (!intent) {
      const completed = await samples.sample(ownerId, sampleId);
      if (completed) return sendJson(response, 200, { sample: completed });
      if (await deleteFailedUploadObject(samples, ownerId, sampleId, s3, bucketName))
        throw new HttpError(
          403,
          'PSIU unit is unavailable or no longer assigned; upload was rejected.',
        );
      throw new HttpError(404, 'Upload intent not found.');
    }
    let metadata;
    try {
      metadata = await verifyWavObject(intent, bucketName, s3);
    } catch (error) {
      await deleteFailedUploadObject(samples, ownerId, sampleId, s3, bucketName);
      throw error;
    }
    let taggedAccepted = false;
    try {
      return sendJson(response, 200, {
        sample: await samples.complete(ownerId, sampleId, metadata, async () => {
          await setUploadLifecycleTag(s3, bucketName, intent.objectKey, 'accepted');
          taggedAccepted = true;
        }),
      });
    } catch (error) {
      if (taggedAccepted)
        try {
          await setUploadLifecycleTag(s3, bucketName, intent.objectKey, 'unaccepted');
        } catch {
          /* Lifecycle cleanup remains best effort after a failed database completion. */
        }
      if (error instanceof HttpError && error.statusCode === 403)
        await deleteUnavailableUploadObjects(s3, bucketName, [intent.objectKey]);
      throw error;
    }
  }
  if (request.method === 'GET' && action === 'download') {
    const objectKey = await samples.objectKey(ownerId, sampleId);
    if (!objectKey) throw new HttpError(404, 'Sample not found.');
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucketName, Key: objectKey }),
      { expiresIn: 900 },
    );
    return sendJson(response, 200, {
      downloadUrl,
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    });
  }
  throw new HttpError(404, 'Route not found.');
}
async function reportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  ownerId: string,
  reports: PostgresReportRepository,
  s3: S3Client,
  bucketName: string,
): Promise<void> {
  if (request.method === 'GET' && path === '/v1/reports/definitions')
    return sendJson(response, 200, await reports.definitions());
  if (request.method === 'POST' && path === '/v1/reports/requests')
    return sendJson(
      response,
      201,
      await reports.create(ownerId, await parseJson<CreateReportRequest>(request)),
    );
  if (request.method === 'GET' && path === '/v1/reports') {
    const query = new URL(request.url ?? '/', 'http://wally.local').searchParams;
    return sendJson(
      response,
      200,
      await reports.history(ownerId, { limit: pageQuery(query).limit, cursor: cursorQuery(query) }),
    );
  }
  const artifact = path.match(
    /^\/v1\/reports\/([^/]+)\/artifacts\/(manifest|metrics_json|graph_svg(?:_[1-9][0-9]*)?|report_pdf)\/download$/,
  );
  if (request.method === 'GET' && artifact) {
    if (!bucketName) throw new HttpError(503, 'Report storage is unavailable.');
    const stored = await reports.artifact(ownerId, artifact[1], artifact[2]);
    if (!stored?.object_version_id) throw new HttpError(404, 'Report artifact not found.');
    return sendJson(response, 200, {
      downloadUrl: await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucketName,
          Key: stored.object_key,
          VersionId: stored.object_version_id,
        }),
        { expiresIn: 900 },
      ),
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    });
  }
  throw new HttpError(404, 'Route not found.');
}
interface ProductionDependencies {
  pool: Pool;
  repository?: AccountRepository;
  samples?: SampleRepository;
  reports?: PostgresReportRepository;
  adminData?: PostgresAdminDataRepository;
  s3?: S3Client;
  sampleBucketName?: string;
  reportBucketName?: string;
  cognito?: CognitoIdentityProviderClient;
  verify?: (
    token: string,
    settings: { userPoolId: string; clientId: string },
  ) => Promise<AuthenticatedPrincipal>;
}
export async function createProductionServerFromEnvironment() {
  return createProductionServer({ pool: new Pool(await databaseSettings()) });
}
function bearerToken(r: IncomingMessage) {
  const v = r.headers.authorization;
  if (!v?.startsWith('Bearer ')) throw new HttpError(401, 'Bearer access token required.');
  const token = v.slice(7).trim();
  if (!token) throw new HttpError(401, 'Bearer access token required.');
  return token;
}
async function parseJson<T>(r: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const x of r) {
    const b = Buffer.from(x);
    if ((n += b.length) > 16_384) throw new HttpError(413, 'Request body too large.');
    chunks.push(b);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as T;
  } catch {
    throw new HttpError(400, 'Valid JSON request body required.');
  }
}
function pageQuery(query: URLSearchParams) {
  const one = (name: string, fallback: number) => {
    const raw = query.get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) throw new HttpError(400, `${name} must be an integer.`);
    const value = Number(raw);
    if ((name === 'limit' && (value < 1 || value > 100)) || (name === 'offset' && value < 0))
      throw new HttpError(400, `${name} is out of bounds.`);
    return value;
  };
  return { limit: one('limit', 25), offset: one('offset', 0) };
}
function cursorQuery(query: URLSearchParams) {
  const value = query.get('cursor');
  if (value === null) return undefined;
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) throw new HttpError(400, 'cursor is invalid.');
  return value;
}
function uuidQuery(query: URLSearchParams, name: string) {
  const value = query.get(name);
  if (value === null) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new HttpError(400, `${name} must be a UUID.`);
  return value;
}
function enumQuery(query: URLSearchParams, name: string, values: string[]) {
  const value = query.get(name);
  if (value === null) return undefined;
  if (!values.includes(value)) throw new HttpError(400, `${name} is invalid.`);
  return value;
}
function dateQuery(query: URLSearchParams, name: string) {
  const value = query.get(name);
  if (value === null) return undefined;
  if (Number.isNaN(Date.parse(value))) throw new HttpError(400, `${name} must be an ISO date.`);
  return value;
}
function cognitoSettings() {
  return { userPoolId: poolId(), clientId: requiredEnvironment('COGNITO_WEB_CLIENT_ID') };
}
function poolId() {
  return requiredEnvironment('COGNITO_USER_POOL_ID');
}
function requiredEnvironment(n: string) {
  const v = process.env[n];
  if (!v) throw new Error(`Missing required environment variable: ${n}`);
  return v;
}
function email(x: string) {
  const v = x.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 320)
    throw new HttpError(400, 'Valid email required.');
  return v;
}
function identifier(x: string, label: string, max: number) {
  const v = x.trim();
  if (!v || v.length > max || /[\u0000-\u001f]/.test(v))
    throw new HttpError(400, `${label} is invalid.`);
  return v;
}
function requestId(r: IncomingMessage) {
  const x = r.headers['x-request-id'];
  return typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x) ? x : undefined;
}
function sendJson(r: ServerResponse, status: number, body?: unknown) {
  r.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  r.end(body === undefined ? '' : JSON.stringify(body));
}
if (process.argv[1]?.endsWith('production.js'))
  createProductionServerFromEnvironment()
    .then((server) =>
      server.listen(port, '0.0.0.0', () =>
        console.info(`Wally private production API listening on port ${port}`),
      ),
    )
    .catch((error) => {
      console.error('Production API startup failed.', error);
      process.exitCode = 1;
    });
