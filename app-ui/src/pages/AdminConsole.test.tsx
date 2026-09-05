// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminConsole } from './AdminConsole.js';
import { hardDeletePsiuRequest } from './adminActions.js';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../api.js', () => ({ request }));
const unit = { id: 'unit-1', serialNumber: 'PSIU-1', uid: 'uid-1', status: 'enabled' };
const user = { id: 'user-1', email: 'person@example.com', firstName: 'Pat', lastName: 'Person', lifecycle: 'invited', balance: 10 };
function show(path: string) { return render(<MemoryRouter initialEntries={[path]}><AdminConsole /></MemoryRouter>); }

beforeEach(() => { request.mockReset(); vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(cleanup);

describe('admin PSIU destructive action', () => {
  it('uses DELETE for hard deletion', () => expect(hardDeletePsiuRequest('unit-1')).toEqual({ path: '/v1/admin/psiu-units/unit-1', method: 'DELETE' }));

  it('creates units, suppresses unavailable actions, and assigns only the selected unit', async () => {
    request.mockImplementation((path: string) => {
      if (path === '/v1/admin/psiu-units') return Promise.resolve([unit, { ...unit, id: 'unit-2', serialNumber: 'PSIU-2', status: 'unavailable' }]);
      if (path.startsWith('/v1/admin/users/typeahead')) return Promise.resolve([user]);
      return Promise.resolve(undefined);
    });
    show('/admin/psiu');
    await screen.findByText('PSIU-1 · uid-1 · enabled');
    fireEvent.change(screen.getByLabelText('Serial number'), { target: { value: 'PSIU-3' } });
    fireEvent.change(screen.getByLabelText('Firmware UID'), { target: { value: 'uid-3' } });
    fireEvent.click(screen.getByText('Add PSIU'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/psiu-units', expect.objectContaining({ method: 'POST' })));
    expect(screen.queryAllByText('Mark unavailable')).toHaveLength(1);
    fireEvent.click(screen.getByText('Assign user'));
    fireEvent.change(screen.getByLabelText('Search user'), { target: { value: 'Pa' } });
    await screen.findByRole('option', { name: /Pat Person/ });
    fireEvent.click(screen.getByRole('option', { name: /Pat Person/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/psiu-units/unit-1/assign', expect.objectContaining({ method: 'POST' })));
    expect(request).not.toHaveBeenCalledWith('/v1/admin/psiu-units/unit-2/assign', expect.anything());
  });
});

describe('admin user, credit, and sample workflows', () => {
  it('invites users and reloads durable lifecycle after restore', async () => {
    let detailCalls = 0;
    request.mockImplementation((path: string) => {
      if (path.startsWith('/v1/admin/users?')) return Promise.resolve({ items: [{ ...user, lifecycle: 'suspended' }], limit: 25, offset: 0 });
      if (path === '/v1/admin/users/user-1') return Promise.resolve({ ...user, lifecycle: detailCalls++ ? 'invited' : 'suspended' });
      return Promise.resolve(undefined);
    });
    show('/admin/users');
    await screen.findByText(/person@example.com/);
    fireEvent.click(screen.getByText('Details'));
    await screen.findByText('Restore');
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/customers/user-1/restore', { method: 'POST' }));
    await waitFor(() => expect(screen.getByText('Deactivate')).toBeTruthy());
    fireEvent.click(screen.getByText('Invite'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/customers/user-1/invite', { method: 'POST' }));
  });

  it('renders credit stats and posts a noted adjustment', async () => {
    request.mockImplementation((path: string) => {
      if (path === '/v1/admin/credits/stats') return Promise.resolve([{ day: '2026-09-04', kind: 'grant', product: 'admin', entry_count: 1, delta: 5 }]);
      if (path.includes('/credits?')) return Promise.resolve({ balance: 10, items: [] });
      return Promise.resolve(undefined);
    });
    show('/admin/credits');
    await screen.findByText(/2026-09-04 · grant · admin · 1 entries · 5 credits/);
    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('Credit amount (+/-)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Adjustment note/), { target: { value: 'acceptance grant' } });
    fireEvent.click(screen.getByText('Apply adjustment'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/users/user-1/credits', expect.objectContaining({ method: 'POST' })));
  });

  it('filters and paginates sample directory requests', async () => {
    request.mockImplementation((path: string) => path === '/v1/admin/samples/stats' ? Promise.resolve({ total: 30, d7: 2, d30: 5, ytd: 30 }) : Promise.resolve({ items: Array.from({ length: 25 }, (_, i) => ({ id: String(i), email: 'person@example.com', serial_number: 'PSIU-1', source: 'manual_file', upload_state: 'uploaded', recorded_at: 'now' })), limit: 25, offset: 0 }));
    show('/admin/samples');
    await screen.findByText(/Total 30 · 7 days 2/);
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'uploaded' } });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'manual_file' } });
    fireEvent.click(screen.getByText('Filter'));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('state=uploaded&source=manual_file')));
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('offset=25')));
  });
});
