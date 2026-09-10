// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@wally/contracts';
import { Home } from './App.js';

vi.mock('./auth.js', () => ({ accessToken: vi.fn(async () => 'token') }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const me: MeResponse = { id: 'user-1', email: 'listener@example.com', role: 'user', lifecycle: 'active', units: [], emailChangeAvailable: false };

function responseFor(url: string) {
  if (url.endsWith('/v1/me/alerts')) return [];
  if (url.endsWith('/v1/me/credits')) return { balance: 8, items: [], limit: 25, offset: 0 };
  if (url.endsWith('/v1/samples')) return [{ id: 'sample-1', uploadState: 'uploaded' }];
  if (url.endsWith('/v1/me/systems')) return [];
  return {};
}

describe('Home', () => {
  it('groups Actions and News above recording and Credits in the responsive dashboard grid', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(responseFor(String(input))), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<MemoryRouter><Home me={me} onCaptureConsumed={() => {}} /></MemoryRouter>);
    await screen.findByText('8');
    const grid = screen.getByTestId('home-dashboard-grid');
    expect(grid.children).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Actions' }).compareDocumentPosition(screen.getByRole('heading', { name: 'News' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('heading', { name: 'Ready to record?' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Credits' })).toBeTruthy();
    expect(screen.getByTestId('home-actions-empty-row')).toBeTruthy();
    expect(screen.getByTestId('home-news-row')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record a new sample' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Buy credits' })).toBeTruthy();
    expect(screen.getByText('Verified samples ready for reporting')).toBeTruthy();
  });
});
