// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminConsole } from './AdminConsole.js';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../api.js', () => ({ request }));
const user = {
  id: 'user-1',
  email: 'person@example.com',
  firstName: 'Pat',
  lastName: 'Person',
  lifecycle: 'active',
  balance: 10,
  units: [
    {
      id: 'unit-1',
      serialNumber: 'PSIU-1',
      uid: 'uid-1',
      status: 'enabled',
      assignedAt: '2026-09-10T00:00:00.000Z',
    },
  ],
};
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}
function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminConsole />
      <LocationProbe />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});
afterEach(cleanup);

describe('scalable admin directories', () => {
  it('uses two-character typeahead and server cursors for PSIU search', async () => {
    request.mockImplementation((path: string) =>
      path.startsWith('/v1/admin/psiu-units?')
        ? Promise.resolve({
            items: [{ id: 'unit-1', serialNumber: 'PSIU-1', uid: 'uid-1', status: 'enabled' }],
            limit: 25,
            nextCursor: 'next',
          })
        : Promise.resolve([]),
    );
    show('/admin/psiu');
    await screen.findByText('PSIU-1 · uid-1 · enabled');
    fireEvent.change(screen.getByLabelText('Search serial, UID, or owner'), {
      target: { value: 'P' },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining('q=P'));
    fireEvent.change(screen.getByLabelText('Search serial, UID, or owner'), {
      target: { value: 'PS' },
    });
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('q=PS')));
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(expect.stringContaining('cursor=next')),
    );
  });

  it('opens a deep-linked read-only user detail, then exposes editable profile fields', async () => {
    request.mockImplementation((path: string) =>
      path === '/v1/admin/users/user-1' ? Promise.resolve(user) : Promise.resolve(undefined),
    );
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
    request.mockImplementation((path: string) =>
      path === '/v1/admin/users/user-1' ? Promise.resolve(user) : Promise.resolve(undefined),
    );
    show('/admin/users/user-1');
    await screen.findByText('Disable capture');
    fireEvent.click(screen.getByText('Disable capture'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/v1/admin/psiu-units/unit-1/disable', {
        method: 'POST',
      }),
    );
    fireEvent.click(screen.getByText('Deassign'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/v1/admin/psiu-units/unit-1/deassign', {
        method: 'POST',
      }),
    );
  });

  it('hides reset action for suspended users', async () => {
    request.mockImplementation((path: string) =>
      path === '/v1/admin/users/user-1'
        ? Promise.resolve({ ...user, lifecycle: 'suspended' })
        : Promise.resolve(undefined),
    );
    show('/admin/users/user-1');
    await screen.findByText('Restore');
    expect(screen.queryByText('Send password reset')).toBeNull();
  });

  it('restores PSIU directory filters and cursor from the URL', async () => {
    request.mockResolvedValue({ items: [], limit: 25 });
    show('/admin/psiu?q=PS&status=disabled&assignment=assigned&cursor=page-2');
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('q=PS')));
    expect(request).toHaveBeenCalledWith(expect.stringContaining('status=disabled'));
    expect(request).toHaveBeenCalledWith(expect.stringContaining('assignment=assigned'));
    expect(request).toHaveBeenCalledWith(expect.stringContaining('cursor=page-2'));
  });

  it('marks active PSIUs unavailable with provenance confirmation and restricts unavailable actions', async () => {
    request.mockResolvedValue({
      items: [{ id: 'unit-1', serialNumber: 'PSIU-1', uid: 'uid-1', status: 'enabled' }],
      limit: 25,
    });
    show('/admin/psiu');
    await screen.findByText('Mark unavailable');
    fireEvent.click(screen.getByText('Mark unavailable'));
    expect(globalThis.confirm).toHaveBeenCalledWith(
      'Mark PSIU-1 unavailable? This blocks future capture and preserves existing sample provenance.',
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/v1/admin/psiu-units/unit-1/unavailable', {
        method: 'POST',
      }),
    );
  });

  it('synchronizes directory search and cursor state to the location', async () => {
    request.mockImplementation((path: string) =>
      path.startsWith('/v1/admin/psiu-units?')
        ? Promise.resolve({ items: [], limit: 25, nextCursor: 'page-2' })
        : Promise.resolve([]),
    );
    show('/admin/psiu');
    await waitFor(() => expect(request).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Search serial, UID, or owner'), {
      target: { value: 'PS' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/psiu?q=PS'),
    );
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('q=PS')));
    await waitFor(() => expect((screen.getByText('Next') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/psiu?q=PS&cursor=page-2'),
    );
  });

  it('synchronizes user directory search and cursor state to the location', async () => {
    request.mockImplementation((path: string) =>
      path.startsWith('/v1/admin/users?')
        ? Promise.resolve({ items: [], limit: 25, nextCursor: 'user-page-2' })
        : Promise.resolve([]),
    );
    show('/admin/users');
    await waitFor(() => expect(request).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Search name, email, or active PSIU serial'), {
      target: { value: 'Pa' },
    });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/admin/users?q=Pa'));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('q=Pa')));
    await waitFor(() => expect((screen.getByText('Next') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/users?q=Pa&cursor=user-page-2'),
    );
  });

  it('preserves user directory state when creating a new customer detail route', async () => {
    request.mockImplementation((path: string) =>
      path === '/v1/admin/customers'
        ? Promise.resolve({ id: 'new-user' })
        : Promise.resolve({ items: [], limit: 25 }),
    );
    show('/admin/users?q=Pa&lifecycle=active&cursor=page-2');
    fireEvent.click(screen.getByText('Create customer'));
    fireEvent.change(screen.getByLabelText('Customer email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/admin/users/new-user?returnTo=%2Fadmin%2Fusers%3Fq%3DPa%26lifecycle%3Dactive%26cursor%3Dpage-2',
      ),
    );
  });

  it('does not expose destructive actions for unavailable PSIUs and confirms capture blocking before disable', async () => {
    request.mockResolvedValue({
      items: [{ id: 'unit-1', serialNumber: 'PSIU-1', uid: 'uid-1', status: 'unavailable' }],
      limit: 25,
    });
    show('/admin/psiu');
    await screen.findByText(/Unavailable: provenance preserved/);
    expect(screen.queryByText('Hard delete')).toBeNull();
    expect(screen.queryByText('Mark unavailable')).toBeNull();

    cleanup();
    request.mockReset();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    request.mockResolvedValue({
      items: [{ id: 'unit-1', serialNumber: 'PSIU-1', uid: 'uid-1', status: 'enabled' }],
      limit: 25,
    });
    show('/admin/psiu');
    await screen.findByText('Disable capture');
    fireEvent.click(screen.getByText('Disable capture'));
    expect(globalThis.confirm).toHaveBeenCalledWith(
      expect.stringContaining('New captures will be blocked'),
    );
    expect(request).not.toHaveBeenCalledWith(
      '/v1/admin/psiu-units/unit-1/disable',
      expect.anything(),
    );
  });
});
