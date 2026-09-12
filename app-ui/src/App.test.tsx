// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerUnit } from '@wally/contracts';
import { Home, psiuBridgeStoreUrl } from './App.js';

vi.mock('./auth.js', () => ({ accessToken: vi.fn(async () => 'token') }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const units: CustomerUnit[] = [];

function responseFor(url: string) {
  if (url.endsWith('/v1/me/alerts')) return [];
  if (url.endsWith('/v1/me/credits')) return { balance: 8, items: [], limit: 25, offset: 0 };
  if (url.endsWith('/v1/samples')) return [{ id: 'sample-1', uploadState: 'uploaded' }];
  if (url.endsWith('/v1/me/systems')) return [];
  if (url.includes('/v1/reports?')) return { items: [] }; 
  return {};
}

describe('Home', () => {
  it('routes Chrome and Edge users to their respective extension stores', () => {
    expect(psiuBridgeStoreUrl('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36')).toContain('chromewebstore.google.com');
    expect(psiuBridgeStoreUrl('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0')).toContain('microsoftedge.microsoft.com');
    expect(psiuBridgeStoreUrl('Mozilla/5.0 Firefox/140.0')).toBeUndefined();
  });

  it('groups Actions and News above Credits without a redundant recording call to action', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(responseFor(String(input))), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<MemoryRouter><Home /></MemoryRouter>);
    await screen.findByText('8');
    const grid = screen.getByTestId('home-dashboard-grid');
    expect(grid.children).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Actions' }).compareDocumentPosition(screen.getByRole('heading', { name: 'News' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('heading', { name: 'Credits' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Activity queue' })).toBeTruthy();
    expect(screen.getByTestId('home-actions-empty-row')).toBeTruthy();
    expect(screen.getByTestId('home-news-row')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buy credits' })).toBeTruthy();
    expect(screen.getByText('Verified samples ready for reporting')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your Wally system' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sample Capture' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select WAV files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Process and Report' })).toBeNull();
    expect(screen.queryByLabelText('Filter unit')).toBeNull();
    expect(screen.queryByLabelText('Filter state')).toBeNull();
    expect(screen.queryByLabelText('Sort')).toBeNull();
    expect(screen.queryByText('No samples uploaded.')).toBeNull();
  });
});
