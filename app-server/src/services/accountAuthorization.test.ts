import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAdmin, requirePrincipal } from './accountAuthorization.js';

test('requires matching durable verified active account role', async () => {
  const repository = {
    async findActivePrincipal(subject: string) { return subject === 'active' ? { id: 'customer', role: 'user' as const, lifecycle: 'active', emailConfirmedAt: new Date() } : subject === 'unconfirmed' ? { id: 'unconfirmed', role: 'user' as const, lifecycle: 'active', emailConfirmedAt: null } : subject === 'invited' ? { id: 'pending', role: 'user' as const, lifecycle: 'invited', emailConfirmedAt: null } : undefined; },
  };
  assert.deepEqual(await requirePrincipal({ subject: 'active', roles: ['user'] }, repository as never), { id: 'customer', role: 'user' });
  await assert.rejects(() => requirePrincipal({ subject: 'invited', roles: ['user'] }, repository as never), { message: 'Verified active account required.' });
  await assert.rejects(() => requirePrincipal({ subject: 'unconfirmed', roles: ['user'] }, repository as never), { message: 'Verified active account required.' });
  await assert.rejects(() => requirePrincipal({ subject: 'active', roles: ['admin'] }, repository as never), { message: 'Active account and matching role required.' });
  assert.throws(() => requireAdmin({ role: 'user' }), { message: 'Administrator role required.' });
});
