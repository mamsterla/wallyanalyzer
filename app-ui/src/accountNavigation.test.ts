// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { accountNavigationItems } from './App.js';

describe('Account navigation', () => {
  it('groups profile and account settings under one Account menu', () => {
    expect(accountNavigationItems).toEqual([
      { path: '/profile', label: 'Profile' },
      { path: '/account', label: 'Account settings' },
    ]);
  });
});
