import type { Role } from '@wally/contracts';
import { HttpError, type AuthenticatedPrincipal } from './auth.js';
import type { AccountRepository } from './accountRepository.js';

export async function requirePrincipal(principal: AuthenticatedPrincipal, repository: AccountRepository): Promise<{ id: string; role: Role }> {
  const account = await repository.findActivePrincipal(principal.subject);
  if (!account || !principal.roles.includes(account.role)) throw new HttpError(403, 'Active account and matching role required.');
  if (account.lifecycle === 'invited') await repository.activate(principal.subject);
  return { id: account.id, role: account.role };
}

export function requireAdmin(account: { role: Role }): void {
  if (account.role !== 'admin') throw new HttpError(403, 'Administrator role required.');
}
