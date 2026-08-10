import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Role } from '@wally/contracts';

const ROLE_PRECEDENCE: Record<Role, number> = { user: 1, installer: 2, admin: 3 };

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
