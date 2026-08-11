import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { provisionFulfillment } from './fulfillment.js';
import { requireActiveFulfillmentAdmin } from './fulfillmentAuthorization.js';

test('provisions a suppressed Cognito account and records a PSIU assignment', async () => {
  const commands: unknown[] = [];
  const recorded: unknown[] = [];
  const cognito = {
    async send(command: unknown) {
      commands.push(command);
      if (command instanceof AdminCreateUserCommand) return { User: { Attributes: [{ Name: 'sub', Value: 'cognito-subject' }] } };
      if (command instanceof AdminAddUserToGroupCommand) return {};
      return {};
    },
  };
  const result = await provisionFulfillment({
    email: 'Customer@example.com',
    psiuSerialNumber: 'PSIU-001',
    psiuOpaqueUid: 'opaque-device-id',
  }, {
    userPoolId: 'us-east-1_example',
    cognito: cognito as never,
    repository: { async recordProvisionedAccount(input) { recorded.push(input); } },
    assignedByUserId: 'admin-id',
  });

  assert.equal(result.cognitoSubject, 'cognito-subject');
  assert.equal(result.accountStatus, 'provisioned');
  assert.equal(commands.length, 2);
  assert.equal((commands[0] as AdminCreateUserCommand).input.MessageAction, 'SUPPRESS');
  assert.equal((commands[1] as AdminAddUserToGroupCommand).input.GroupName, 'user');
  assert.deepEqual(recorded[0], {
    userId: result.userId,
    cognitoSubject: 'cognito-subject',
    email: 'customer@example.com',
    psiuUnitId: result.psiuUnitId,
    assignmentId: result.assignmentId,
    serialNumber: 'PSIU-001',
    opaqueUid: 'opaque-device-id',
    assignedByUserId: 'admin-id',
    requestId: undefined,
  });
});

test('rejects malformed fulfillment values before Cognito is called', async () => {
  const dependencies = {
    userPoolId: 'us-east-1_example',
    cognito: { async send() { throw new Error('must not call Cognito'); } } as never,
    repository: { async recordProvisionedAccount() { throw new Error('must not persist'); } },
    assignedByUserId: 'admin-id',
  };
  await assert.rejects(() => provisionFulfillment({ email: 'not-an-email', psiuSerialNumber: 'PSIU-001' }, dependencies), { message: 'Valid email required.' });
  await assert.rejects(() => provisionFulfillment({ email: 'customer@example.com', psiuSerialNumber: 'x'.repeat(129) }, dependencies), { message: 'PSIU serial number is invalid.' });
});

test('requires both an admin token group and an active database admin bound to its subject', async () => {
  const repository = { async findActiveAdminByCognitoSubject(subject: string) { return subject === 'active-admin' ? { id: 'database-admin-id' } : undefined; } };
  await assert.rejects(() => requireActiveFulfillmentAdmin({ subject: 'active-admin', roles: ['user'] }, repository), { message: 'Administrator role required.' });
  await assert.rejects(() => requireActiveFulfillmentAdmin({ subject: 'suspended-admin', roles: ['admin'] }, repository), { message: 'Active administrator account required.' });
  await assert.doesNotReject(() => requireActiveFulfillmentAdmin({ subject: 'active-admin', roles: ['admin'] }, repository));
});
