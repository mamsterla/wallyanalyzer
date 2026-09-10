// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminConsole } from './AdminConsole.js';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../api.js', () => ({ request }));
const user = { id: 'user-1', email: 'person@example.com', firstName: 'Pat', lastName: 'Person', lifecycle: 'active', balance: 10, units: [{ id:'unit-1', serialNumber:'PSIU-1', uid:'uid-1', status:'enabled', assignedAt:'2026-09-10T00:00:00.000Z' }] };
function show(path: string) { return render(<MemoryRouter initialEntries={[path]}><AdminConsole /></MemoryRouter>); }
beforeEach(() => { request.mockReset(); vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(cleanup);

describe('scalable admin directories', () => {
  it('uses two-character typeahead and server cursors for PSIU search', async () => {
    request.mockImplementation((path: string) => path.startsWith('/v1/admin/psiu-units?') ? Promise.resolve({ items: [{ id:'unit-1', serialNumber:'PSIU-1',uid:'uid-1',status:'enabled' }], limit:25, nextCursor:'next' }) : Promise.resolve([]));
    show('/admin/psiu');
    await screen.findByText('PSIU-1 · uid-1 · enabled');
    fireEvent.change(screen.getByLabelText('Search serial, UID, or owner'), { target: { value: 'P' } });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining('q=P'));
    fireEvent.change(screen.getByLabelText('Search serial, UID, or owner'), { target: { value: 'PS' } });
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('q=PS')));
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('cursor=next')));
  });

  it('opens a deep-linked read-only user detail, then exposes editable profile fields', async () => {
    request.mockImplementation((path: string) => path === '/v1/admin/users/user-1' ? Promise.resolve(user) : Promise.resolve(undefined));
    show('/admin/users/user-1?q=Pa');
    await screen.findByText('User detail');
    expect(screen.getByText(/\(read-only\)/)).toBeTruthy();
    expect(screen.queryByLabelText('firstName')).toBeNull();
    expect(screen.getByText(/PSIU-1/)).toBeTruthy();
    fireEvent.click(screen.getByText('Edit user'));
    expect(screen.getByLabelText('firstName')).toBeTruthy();
    expect(screen.queryByLabelText('email')).toBeNull();
  });

  it('uses confirmed active-unit actions from user detail', async () => {
    request.mockImplementation((path: string) => path === '/v1/admin/users/user-1' ? Promise.resolve(user) : Promise.resolve(undefined));
    show('/admin/users/user-1');
    await screen.findByText('Disable capture');
    fireEvent.click(screen.getByText('Disable capture'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/psiu-units/unit-1/disable', { method:'POST' }));
    fireEvent.click(screen.getByText('Deassign'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/admin/psiu-units/unit-1/deassign', { method:'POST' }));
  });

  it('hides reset action for suspended users', async () => {
    request.mockImplementation((path: string) => path === '/v1/admin/users/user-1' ? Promise.resolve({ ...user, lifecycle:'suspended' }) : Promise.resolve(undefined));
    show('/admin/users/user-1');
    await screen.findByText('Restore');
    expect(screen.queryByText('Send password reset')).toBeNull();
  });
});
