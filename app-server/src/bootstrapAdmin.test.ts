import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { bootstrapInitialAdmin, parseBootstrapAdminSecret } from './bootstrapAdmin.js';

const secret = { email: 'Admin@example.com', temporaryPassword: 'TemporaryPassword1!' };
const poolId = 'us-east-1_example';

function userNotFound(): Error {
  const error = new Error('not found');
  error.name = 'UserNotFoundException';
  return error;
}

test('creates an admin only after Cognito lookup reports it absent', async () => {
  const commands: unknown[] = [];
  const repositoryCalls: unknown[] = [];
  const result = await bootstrapInitialAdmin(secret, {
    userPoolId: poolId,
    cognito: {
      async send(command: unknown) {
        commands.push(command);
        if (command instanceof AdminGetUserCommand) throw userNotFound();
        if (command instanceof AdminCreateUserCommand) return { User: { Attributes: [{ Name: 'sub', Value: 'admin-subject' }] } };
        return {};
      },
    } as never,
    repository: repository({
      createInitialAdmin: async (input) => { repositoryCalls.push(input); return { id: 'admin-id' }; },
    }),
  });

  assert.deepEqual(result, { userId: 'admin-id', created: true });
  assert.ok(commands[0] instanceof AdminGetUserCommand);
  assert.equal((commands[1] as AdminCreateUserCommand).input.MessageAction, 'SUPPRESS');
  assert.equal((commands[1] as AdminCreateUserCommand).input.TemporaryPassword, 'TemporaryPassword1!');
  assert.ok(commands[2] instanceof AdminAddUserToGroupCommand);
  assert.deepEqual(repositoryCalls, [{ cognitoSubject: 'admin-subject', email: 'admin@example.com' }]);
});

test('reuses a durable administrator only when its Cognito identity exists', async () => {
  const commands: unknown[] = [];
  const result = await bootstrapInitialAdmin(secret, {
    userPoolId: poolId,
    cognito: { async send(command: unknown) { commands.push(command); return cognitoUser(); } } as never,
    repository: repository({ findInitialAdminByEmail: async () => ({ id: 'admin-id' }) }),
  });

  assert.deepEqual(result, { userId: 'admin-id', created: false });
  assert.equal(commands.length, 2);
  assert.ok(commands[0] instanceof AdminGetUserCommand);
  assert.ok(commands[1] instanceof AdminAddUserToGroupCommand);
});

test('reconciles a Cognito user left by a prior partial attempt without creating it again', async () => {
  const commands: unknown[] = [];
  const result = await bootstrapInitialAdmin(secret, {
    userPoolId: poolId,
    cognito: { async send(command: unknown) { commands.push(command); return cognitoUser(); } } as never,
    repository: repository({ createInitialAdmin: async () => ({ id: 'reconciled-admin-id' }) }),
  });

  assert.deepEqual(result, { userId: 'reconciled-admin-id', created: false });
  assert.equal(commands.length, 2);
  assert.ok(commands[0] instanceof AdminGetUserCommand);
  assert.ok(commands[1] instanceof AdminAddUserToGroupCommand);
  assert.equal(commands.some((command) => command instanceof AdminCreateUserCommand), false);
});

test('deletes only a newly created Cognito user when Postgres persistence fails', async () => {
  const commands: unknown[] = [];
  await assert.rejects(() => bootstrapInitialAdmin(secret, {
    userPoolId: poolId,
    cognito: {
      async send(command: unknown) {
        commands.push(command);
        if (command instanceof AdminGetUserCommand) throw userNotFound();
        if (command instanceof AdminCreateUserCommand) return { User: { Attributes: [{ Name: 'sub', Value: 'admin-subject' }] } };
        return {};
      },
    } as never,
    repository: repository({ createInitialAdmin: async () => { throw new Error('Postgres unavailable'); } }),
  }), { message: 'Postgres unavailable' });

  assert.ok(commands.at(-1) instanceof AdminDeleteUserCommand);
});

test('retries safely after compensation failure by reconciling the existing Cognito user', async () => {
  const commands: unknown[] = [];
  let lookupCount = 0;
  let repositoryAttempts = 0;
  const cognito = {
    async send(command: unknown) {
      commands.push(command);
      if (command instanceof AdminGetUserCommand) {
        lookupCount += 1;
        if (lookupCount === 1) throw userNotFound();
        return cognitoUser();
      }
      if (command instanceof AdminCreateUserCommand) return { User: { Attributes: [{ Name: 'sub', Value: 'admin-subject' }] } };
      if (command instanceof AdminDeleteUserCommand) throw new Error('Cognito delete unavailable');
      return {};
    },
  } as never;
  const repo = repository({
    createInitialAdmin: async () => {
      repositoryAttempts += 1;
      if (repositoryAttempts === 1) throw new Error('Postgres unavailable');
      return { id: 'reconciled-admin-id' };
    },
  });

  await assert.rejects(() => bootstrapInitialAdmin(secret, { userPoolId: poolId, cognito, repository: repo }), {
    message: 'Initial administrator persistence failed and Cognito compensation failed: Cognito delete unavailable',
  });
  const result = await bootstrapInitialAdmin(secret, { userPoolId: poolId, cognito, repository: repo });

  assert.deepEqual(result, { userId: 'reconciled-admin-id', created: false });
  assert.equal(commands.filter((command) => command instanceof AdminCreateUserCommand).length, 1);
  assert.equal(commands.filter((command) => command instanceof AdminDeleteUserCommand).length, 1);
});

test('rejects malformed bootstrap secrets and unsafe temporary passwords', async () => {
  assert.throws(() => parseBootstrapAdminSecret('not json'), { message: 'Bootstrap secret must contain valid JSON.' });
  assert.throws(() => parseBootstrapAdminSecret('{"email":"admin@example.com"}'), { message: 'Bootstrap secret must contain email and temporaryPassword strings.' });
  await assert.rejects(() => bootstrapInitialAdmin({ email: 'bad', temporaryPassword: 'short' }, {
    userPoolId: poolId,
    cognito: { async send() { throw new Error('must not call Cognito'); } } as never,
    repository: repository(),
  }), { message: 'Bootstrap administrator email is invalid.' });
});

function cognitoUser() {
  return { UserAttributes: [{ Name: 'sub', Value: 'admin-subject' }] };
}

function repository(overrides: Partial<{
  findInitialAdminByEmail: () => Promise<{ id: string } | undefined>;
  createInitialAdmin: (input: { cognitoSubject: string; email: string }) => Promise<{ id: string }>;
}> = {}) {
  return {
    async withInitialAdminLock<T>(operation: () => Promise<T>) { return operation(); },
    async findInitialAdminByEmail() { return overrides.findInitialAdminByEmail?.() ?? undefined; },
    async createInitialAdmin(input: { cognitoSubject: string; email: string }) { return overrides.createInitialAdmin?.(input) ?? { id: 'admin-id' }; },
  };
}
