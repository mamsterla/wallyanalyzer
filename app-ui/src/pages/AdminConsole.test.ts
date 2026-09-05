import { describe, expect, it } from 'vitest';
import { hardDeletePsiuRequest } from './adminActions.js';

describe('admin PSIU destructive action', () => {
  it('uses DELETE for hard deletion', () => {
    expect(hardDeletePsiuRequest('unit-1')).toEqual({ path: '/v1/admin/psiu-units/unit-1', method: 'DELETE' });
  });
});
