// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsPage } from './UserExperiencePages.js';

vi.mock('../auth.js', () => ({ accessToken: vi.fn(async () => 'token') }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function creditsResponse(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })));
}

describe('CreditsPage', () => {
  it('renders an empty API items response without crashing', async () => {
    creditsResponse({ balance: 10, items: [], limit: 25, offset: 0 });
    render(<CreditsPage />);
    await screen.findByText('10');
    expect(screen.getByText('No credit activity yet.')).toBeTruthy();
  });

  it('renders API items in newest-first ledger history', async () => {
    creditsResponse({ balance: 15, items: [{ id: 'credit-1', kind: 'grant', delta: 5, balance_after: 15, note: 'Acceptance grant', created_at: '2026-09-09T12:00:00.000Z' }], limit: 25, offset: 0 });
    render(<CreditsPage />);
    await waitFor(() => expect(screen.getByText(/\+5 · grant — Acceptance grant/)).toBeTruthy());
  });
});
