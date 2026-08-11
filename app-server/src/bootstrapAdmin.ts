import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Pool } from 'pg';
import { databaseSettings } from './migrate.js';
import { PostgresFulfillmentRepository, type InitialAdminRepository } from './services/fulfillmentRepository.js';

export interface BootstrapAdminSecret {
  email: string;
  temporaryPassword: string;
}

export interface BootstrapAdminResult {
  userId: string;
  created: boolean;
}

export async function bootstrapInitialAdmin(
  secret: BootstrapAdminSecret,
  dependencies: {
    userPoolId: string;
    cognito: CognitoIdentityProviderClient;
    repository: InitialAdminRepository;
  },
): Promise<BootstrapAdminResult> {
  const email = normalizeEmail(secret.email);
  validateTemporaryPassword(secret.temporaryPassword);

  return dependencies.repository.withInitialAdminLock(async () => {
    const existingCognitoUser = await findCognitoUser(dependencies.cognito, dependencies.userPoolId, email);
    const existingAdmin = await dependencies.repository.findInitialAdminByEmail(email);

    if (existingAdmin) {
      if (!existingCognitoUser) throw new Error('Durable administrator exists but its Cognito identity is missing.');
      await addToAdminGroup(dependencies.cognito, dependencies.userPoolId, email);
      return { userId: existingAdmin.id, created: false };
    }

    if (existingCognitoUser) {
      await addToAdminGroup(dependencies.cognito, dependencies.userPoolId, email);
      const user = await dependencies.repository.createInitialAdmin({
        cognitoSubject: cognitoSubject(existingCognitoUser),
        email,
      });
      return { userId: user.id, created: false };
    }

    const created = await dependencies.cognito.send(new AdminCreateUserCommand({
      UserPoolId: dependencies.userPoolId,
      Username: email,
      TemporaryPassword: secret.temporaryPassword,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'false' },
      ],
      MessageAction: 'SUPPRESS',
    }));

    try {
      const cognitoSubject = created.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value;
      if (!cognitoSubject) throw new Error('Cognito did not return a user subject.');
      await addToAdminGroup(dependencies.cognito, dependencies.userPoolId, email);
      const user = await dependencies.repository.createInitialAdmin({ cognitoSubject, email });
      return { userId: user.id, created: true };
    } catch (error) {
      await compensateCreatedUser(dependencies.cognito, dependencies.userPoolId, email, error);
      throw error;
    }
  });
}

async function findCognitoUser(cognito: CognitoIdentityProviderClient, userPoolId: string, email: string) {
  try {
    return await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
  } catch (error) {
    if (isUserNotFound(error)) return undefined;
    throw error;
  }
}

async function addToAdminGroup(cognito: CognitoIdentityProviderClient, userPoolId: string, email: string): Promise<void> {
  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username: email,
    GroupName: 'admin',
  }));
}

async function compensateCreatedUser(cognito: CognitoIdentityProviderClient, userPoolId: string, email: string, originalError: unknown): Promise<void> {
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }));
  } catch (compensationError) {
    const detail = compensationError instanceof Error ? compensationError.message : 'unknown error';
    const error = new Error(`Initial administrator persistence failed and Cognito compensation failed: ${detail}`);
    error.cause = originalError;
    throw error;
  }
}

function cognitoSubject(user: { UserAttributes?: Array<{ Name?: string; Value?: string }> }): string {
  const subject = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  if (!subject) throw new Error('Cognito user does not contain a subject.');
  return subject;
}

function isUserNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'UserNotFoundException';
}

export function parseBootstrapAdminSecret(value: string): BootstrapAdminSecret {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Bootstrap secret must contain valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Bootstrap secret must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.email !== 'string' || typeof record.temporaryPassword !== 'string') {
    throw new Error('Bootstrap secret must contain email and temporaryPassword strings.');
  }
  return { email: record.email, temporaryPassword: record.temporaryPassword };
}

export async function runBootstrapAdminTask(dependencies: Partial<{
  secrets: SecretsManagerClient;
  cognito: CognitoIdentityProviderClient;
  repository: InitialAdminRepository;
}> = {}): Promise<BootstrapAdminResult> {
  const secretArn = requiredEnvironment('BOOTSTRAP_ADMIN_SECRET_ARN');
  const secrets = dependencies.secrets ?? new SecretsManagerClient({});
  const secretResponse = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!secretResponse.SecretString) throw new Error('Bootstrap secret must use SecretString.');
  const pool = dependencies.repository ? undefined : new Pool(databaseSettings());
  try {
    return await bootstrapInitialAdmin(parseBootstrapAdminSecret(secretResponse.SecretString), {
      userPoolId: requiredEnvironment('COGNITO_USER_POOL_ID'),
      cognito: dependencies.cognito ?? new CognitoIdentityProviderClient({}),
      repository: dependencies.repository ?? new PostgresFulfillmentRepository(pool!),
    });
  } finally {
    await pool?.end();
  }
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error('Bootstrap administrator email is invalid.');
  }
  return email;
}

function validateTemporaryPassword(value: string): void {
  if (value.length < 14 || value.length > 256 || /[\r\n]/.test(value)) {
    throw new Error('Bootstrap temporary password is invalid.');
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

if (process.argv[1]?.endsWith('bootstrapAdmin.js')) {
  runBootstrapAdminTask().then(() => {
    console.info('Bootstrap administrator task completed.');
  }).catch(() => {
    console.error('Bootstrap administrator task failed. Review CloudWatch and AWS API audit events.');
    process.exitCode = 1;
  });
}
