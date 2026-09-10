// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { actionIsDismissible } from './App.js';

describe('home action dismissal', () => {
  it('renders a dismiss control only for dismissible alerts', () => {
    expect(actionIsDismissible({ dismissible: true })).toBe(true);
    expect(actionIsDismissible({ dismissible: false })).toBe(false);
  });
});
