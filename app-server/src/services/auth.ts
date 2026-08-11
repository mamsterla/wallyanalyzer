import type { APIGatewayProxyEvent } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Role } from '@wally/contracts';

const ROLE_PRECEDENCE: Record<Role, number> = { user: 1, installer: 2, admin: 3 };
const accessTokenVerifiers = new Map<string, ReturnType<typeof CognitoJwtVerifier.create>>();

export interface AuthenticatedPrincipal {
  subject: string;
  roles: Role[];
}

/**
 * Verifies a Cognito access token before a private ECS/API route uses its claims.
 * Authorization remains a Postgres query over this subject, not a JWT claim.
 */
export async function verifyCognitoAccessToken(
  accessToken: string,
  settings: { userPoolId: string; clientId: string },
): Promise<AuthenticatedPrincipal> {
  const key = `${settings.userPoolId}:${settings.clientId}`;
  let verifier = accessTokenVerifiers.get(key);
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: settings.userPoolId,
      tokenUse: 'access',
      clientId: settings.clientId,
    });
    accessTokenVerifiers.set(key, verifier);
  }

  let payload;
  try {
    payload = await verifier.verify(accessToken);
  } catch {
    throw new HttpError(401, 'Invalid access token.');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new HttpError(401, 'Access token subject required.');
  }
  const groups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [];
  return { subject: payload.sub, roles: groups.filter(isRole) };
}

export function authenticatedSubject(event: APIGatewayProxyEvent): string {
  const subject = event.requestContext.authorizer?.claims?.sub;
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new HttpError(401, 'Authentication required.');
  }
  return subject;
}

export function requireRole(event: APIGatewayProxyEvent, minimumRole: Role): Role {
  const groups = event.requestContext.authorizer?.claims?.['cognito:groups'];
  const currentRoles = (typeof groups === 'string' ? groups.split(',') : []).filter(isRole);
  const highest = currentRoles.sort((a, b) => ROLE_PRECEDENCE[b] - ROLE_PRECEDENCE[a])[0];

  if (!highest || ROLE_PRECEDENCE[highest] < ROLE_PRECEDENCE[minimumRole]) {
    throw new HttpError(403, 'Insufficient role.');
  }
  return highest;
}

function isRole(value: string): value is Role {
  return value === 'user' || value === 'installer' || value === 'admin';
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
