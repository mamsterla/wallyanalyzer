import { randomUUID } from 'node:crypto';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { AdminFulfillmentRequest, AdminFulfillmentResult } from '@wally/contracts';
import { HttpError } from './auth.js';

export interface FulfillmentRepository {
  recordProvisionedAccount(input: {
    userId: string;
    cognitoSubject: string;
    email: string;
    psiuUnitId: string;
    assignmentId: string;
    serialNumber: string;
    opaqueUid?: string;
    assignedByUserId: string;
    requestId?: string;
  }): Promise<void>;
}

/**
 * Creates a suppressed Cognito account and atomically records the fulfillment
 * relationship. Invitation delivery is intentionally disabled until SES is
 * configured. Callers must expose this only to an active Postgres admin.
 */
export async function provisionFulfillment(
  request: AdminFulfillmentRequest,
  dependencies: {
    userPoolId: string;
    cognito: CognitoIdentityProviderClient;
    repository: FulfillmentRepository;
    assignedByUserId: string;
    requestId?: string;
  },
): Promise<AdminFulfillmentResult> {
  const email = normalizeEmail(request.email);
  const serialNumber = normalizeIdentifier(request.psiuSerialNumber, 'PSIU serial number', 128);
  const opaqueUid = request.psiuOpaqueUid ? normalizeIdentifier(request.psiuOpaqueUid, 'PSIU opaque UID', 256) : undefined;

  const created = await dependencies.cognito.send(new AdminCreateUserCommand({
    UserPoolId: dependencies.userPoolId,
    Username: email,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'false' },
    ],
    MessageAction: 'SUPPRESS',
  }));
  const cognitoSubject = created.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  if (!cognitoSubject) throw new Error('Cognito did not return a user subject.');

  try {
    await dependencies.cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: dependencies.userPoolId,
      Username: email,
      GroupName: 'user',
    }));

    const result: AdminFulfillmentResult = {
      userId: randomUUID(),
      cognitoSubject,
      psiuUnitId: randomUUID(),
      assignmentId: randomUUID(),
      accountStatus: 'provisioned',
    };
    await dependencies.repository.recordProvisionedAccount({
      userId: result.userId,
      cognitoSubject: result.cognitoSubject,
      psiuUnitId: result.psiuUnitId,
      assignmentId: result.assignmentId,
      email,
      serialNumber,
      opaqueUid,
      assignedByUserId: dependencies.assignedByUserId,
      requestId: dependencies.requestId,
    });
    return result;
  } catch (error) {
    // Compensation prevents a usable Cognito account when durable ownership
    // recording fails. Operations must reconcile a failed disable operation.
    await dependencies.cognito.send(new AdminDisableUserCommand({
      UserPoolId: dependencies.userPoolId,
      Username: email,
    })).catch(() => undefined);
    throw error;
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new HttpError(400, 'Valid email required.');
  }
  return email;
}

function normalizeIdentifier(value: string, label: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximumLength || /[\u0000-\u001f]/.test(normalized)) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return normalized;
}
