// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('pins a collapsible icon navigation rail with accessible section names', () => {
    request.mockResolvedValue({ items: [], limit: 25, offset: 0 });
    show('/admin/users');
    expect(screen.getByText('PSIU Management')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse administrator navigation' }));
    expect(screen.queryByText('PSIU Management')).toBeNull();
    expect(screen.getByRole('button', { name: 'PSIU Management' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'User Management' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand administrator navigation' }));
    expect(screen.getByText('PSIU Management')).toBeTruthy();
  });

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
  it('maps populated snake_case user directory names before rendering', async () => {
    request.mockResolvedValue({
      items: [{ id: 'ada', email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace', lifecycle: 'active', balance: 0 }],
      limit: 25,
      offset: 0,
      hasNext: false,
    });
    show('/admin/users');
    expect(await screen.findByRole('button', { name: 'Ada Lovelace · ada@example.com' })).toBeTruthy();
  });
  it('ignores stale typeahead responses and errors after the query changes', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: unknown) => void;
    let rejectFirst!: (reason?: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    request.mockImplementation((url: string) => {
      if (url.includes('typeahead?q=al')) return new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
      if (url.includes('typeahead?q=be')) return new Promise((resolve) => { resolveSecond = resolve; });
      return Promise.resolve({ items: [], limit: 25, offset: 0, hasNext: false });
    });
    try {
      show('/admin/credits');
      const input = screen.getByLabelText('Customer');
      fireEvent.change(input, { target: { value: 'al' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      fireEvent.change(input, { target: { value: 'be' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      await act(async () => {
        resolveSecond([{ id: 'beta', email: 'beta@example.com', first_name: 'Beta', last_name: 'Person', lifecycle: 'active', balance: 0 }]);
        await Promise.resolve();
      });
      expect(screen.getByRole('option', { name: 'Beta Person · beta@example.com' })).toBeTruthy();
      await act(async () => {
        rejectFirst(Error('stale request'));
        await Promise.resolve();
      });
      expect(screen.getByRole('option', { name: 'Beta Person · beta@example.com' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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
