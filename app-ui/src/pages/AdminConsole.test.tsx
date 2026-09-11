// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminConsole } from './AdminConsole.js';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../api.js', () => ({ request }));
function Probe() {
  const l = useLocation();
  return <output data-testid="location">{`${l.pathname}${l.search}`}</output>;
}
function show(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminConsole />
      <Probe />
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
describe('administrator directory tables', () => {
  it('keeps filters, sorting, page size, and offset in the PSIU URL and request', async () => {
    request.mockResolvedValue({ items: [], limit: 25, offset: 0 });
    show('/admin/psiu');
    await screen.findByLabelText('Search serial or UID');
    fireEvent.change(screen.getByLabelText('Search serial or UID'), { target: { value: 'PS' } });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('q=PS'));
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Firmware UID' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('sortBy=uid'));
    expect(request).toHaveBeenCalledWith(expect.stringContaining('limit=25'));
  });
  it('renders separated PSIU inventory and assignment workspaces', async () => {
    request.mockResolvedValue({
      items: [{ id: 'unit-1', serialNumber: 'PSIU-1', uid: 'uid-1', status: 'enabled' }],
      limit: 25,
      offset: 0,
    });
    show('/admin/psiu');
    await screen.findByText('PSIU-1');
    expect(screen.getByText('Inventory actions')).toBeTruthy();
    fireEvent.click(screen.getByText('Assign'));
    expect(screen.getByText('Assignment workspace: PSIU-1')).toBeTruthy();
    expect(screen.queryByText('Find user')).toBeNull();
  });
  it('renders sortable tables for list pages and disables Next without server hasNext', async () => {
    request.mockResolvedValue({ items: [], limit: 25, offset: 0, hasNext: false });
    show('/admin/samples');
    await screen.findByRole('table', { name: 'Sample directory' });
    expect(screen.getAllByRole('button', { name: /Sort by/ }).length).toBeGreaterThan(1);
    expect(screen.getAllByText('Rows per page').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('maps populated snake_case user detail fields and returns to the validated report list URL', async () => {
    request.mockResolvedValue({ id: 'user-1', email: 'ada@example.com', lifecycle: 'active', first_name: 'Ada', last_name: 'Lovelace', address_line1: '1 Logic Lane', address_city: 'London', address_region: 'London', address_postal_code: 'N1', address_country_code: 'GB', units: [] });
    show('/admin/users/user-1?returnTo=%2Fadmin%2Freports%3Fstatus%3Dcompleted');
    await screen.findByText('Ada');
    expect(screen.getByText('1 Logic Lane')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to users' }));
    expect(screen.getByTestId('location').textContent).toBe('/admin/reports?status=completed');
  });
  it('ignores a stale directory response after the search URL changes', async () => {
    let first!: (value: unknown) => void;
    let second!: (value: unknown) => void;
    request.mockImplementation((url: string) => new Promise((resolve) => {
      if (url.includes('q=first')) first = resolve;
      else if (url.includes('q=second')) second = resolve;
      else resolve({ items: [], limit: 25, offset: 0, hasNext: false });
    }));
    show('/admin/users');
    await screen.findByLabelText('Search name, email, or active PSIU serial');
    fireEvent.change(screen.getByLabelText('Search name, email, or active PSIU serial'), { target: { value: 'first' } });
    await waitFor(() => expect(typeof first).toBe('function'));
    fireEvent.change(screen.getByLabelText('Search name, email, or active PSIU serial'), { target: { value: 'second' } });
    await waitFor(() => expect(typeof second).toBe('function'));
    second({ items: [{ id: 'second', email: 'second@example.com', lifecycle: 'active', balance: 0 }], limit: 25, offset: 0, hasNext: false });
    expect((await screen.findAllByText(/second@example.com/)).length).toBeGreaterThan(0);
    first({ items: [{ id: 'first', email: 'first@example.com', lifecycle: 'active', balance: 0 }], limit: 25, offset: 0, hasNext: false });
    await waitFor(() => expect(screen.queryByText(/first@example.com/)).toBeNull());
  });
});
