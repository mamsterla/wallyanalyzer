// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerUnit } from '@wally/contracts';
import { App, Home, psiuBridgeStoreUrl } from './App.js';

vi.mock('./auth.js', () => ({ accessToken: vi.fn(async () => 'token') }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const units: CustomerUnit[] = [];

function responseFor(url: string) {
  if (url.endsWith('/v1/me/alerts')) return [];
  if (url.endsWith('/v1/me/credits')) return { balance: 8, items: [], limit: 25, offset: 0 };
  if (url.endsWith('/v1/samples')) return [{ id: 'sample-1', uploadState: 'uploaded' }];
  if (url.endsWith('/v1/me/systems')) return [];
  if (url.includes('/v1/reports?')) return { items: [{ id: 'report-1', reportTitle: 'Ortofon calibration', reportType: 'Yaw Angle Report', status: 'queued', createdAt: '2026-01-02T03:04:05.000Z' }] };
  return {};
}

describe('Privacy policy', () => {
  it('is publicly available at /privacy and linked from the site footer', () => {
    window.history.pushState({}, '', '/privacy');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeTruthy();
    expect(screen.getAllByText(/privacy@wally-analytics\.app/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
  });
});

describe('Home', () => {
  it('uses the official Chrome Store listing and does not claim support for other browsers', () => {
    expect(psiuBridgeStoreUrl('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36')).toBe('https://chromewebstore.google.com/detail/wally-psiu-bridge/finhaggoihbejjpmhpgkicnifllfaiop');
    expect(psiuBridgeStoreUrl('Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0')).toBeUndefined();
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
    expect(await screen.findByText(/Ortofon calibration · queued/)).toBeTruthy();
    expect(screen.getByText('Yaw Angle Report')).toBeTruthy();
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
