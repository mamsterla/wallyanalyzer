import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAdmin, requirePrincipal } from './accountAuthorization.js';

test('requires matching durable active account role and activates invited users', async () => {
  const activated: string[] = [];
  const repository = {
    async findActivePrincipal(subject: string) { return subject === 'invited' ? { id: 'customer', role: 'user' as const, lifecycle: 'invited' } : undefined; },
    async activate(subject: string) { activated.push(subject); },
  };
  const account = await requirePrincipal({ subject: 'invited', roles: ['user'] }, repository as never);
  assert.deepEqual(account, { id: 'customer', role: 'user' });
  assert.deepEqual(activated, ['invited']);
  await assert.rejects(() => requirePrincipal({ subject: 'invited', roles: ['admin'] }, repository as never), { message: 'Active account and matching role required.' });
  assert.throws(() => requireAdmin({ role: 'user' }), { message: 'Administrator role required.' });
});
