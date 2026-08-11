import { HttpError, type AuthenticatedPrincipal } from './auth.js';
import type { ActiveAdminRepository } from './fulfillmentRepository.js';

export async function requireActiveFulfillmentAdmin(
  principal: AuthenticatedPrincipal,
  repository: ActiveAdminRepository,
): Promise<{ id: string }> {
  if (!principal.roles.includes('admin')) throw new HttpError(403, 'Administrator role required.');
  const actor = await repository.findActiveAdminByCognitoSubject(principal.subject);
  if (!actor) throw new HttpError(403, 'Active administrator account required.');
  return actor;
}
