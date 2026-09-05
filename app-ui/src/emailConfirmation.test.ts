import { describe, expect, it } from 'vitest';
import { completeEmailConfirmation, requestEmailConfirmation } from './emailConfirmation.js';

describe('email confirmation flow', () => {
  it('requests a Cognito verification code', async () => {
    const calls: string[] = [];
    await requestEmailConfirmation({ requestCode: async () => { calls.push('request-code'); } });
    expect(calls).toEqual(['request-code']);
  });

  it('verifies the attribute, refreshes the session, then activates durably', async () => {
    const calls: string[] = [];
    await completeEmailConfirmation('123456', {
      verifyAttribute: async (code) => { calls.push(`verify:${code}`); },
      refreshSession: async () => { calls.push('refresh'); },
      confirmDurably: async () => { calls.push('confirm'); },
    });
    expect(calls).toEqual(['verify:123456', 'refresh', 'confirm']);
  });

  it('does not activate durably when Cognito attribute verification fails', async () => {
    const calls: string[] = [];
    await expect(completeEmailConfirmation('bad', {
      verifyAttribute: async () => { throw Error('Code mismatch'); },
      refreshSession: async () => { calls.push('refresh'); },
      confirmDurably: async () => { calls.push('confirm'); },
    })).rejects.toThrow('Code mismatch');
    expect(calls).toEqual([]);
  });
});
