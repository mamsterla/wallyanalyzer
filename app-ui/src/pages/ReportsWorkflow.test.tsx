// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReportDefinition, ReportHistoryPage } from '@wally/contracts';
import { ReportPicker } from './SampleUploadPanel.js';
import { ReportsPage } from './UserExperiencePages.js';

vi.mock('../auth.js', () => ({ accessToken: vi.fn(async () => 'token') }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const definitions: ReportDefinition[] = [
  { key: 'tracking-error', displayName: 'Tracking Error', algorithmVersion: '0.1.0', presets: [{ key: 'rti-demo', displayName: 'RTI Test 1', version: '1', notice: 'Uses fixed demonstration alignment assumptions.' }] },
  { key: 'future-report', displayName: 'Future Report', algorithmVersion: '2.0.0', presets: [{ key: 'future-preset', displayName: 'Future preset', version: '1', notice: 'Future fixed assumption.' }] },
];

describe('ReportPicker', () => {
  it('requires one selection and submits all selected definition/preset pairs', async () => {
    const submit = vi.fn(async () => {});
    render(<MemoryRouter><ReportPicker open definitions={definitions} onSubmit={submit} onClose={vi.fn()} /></MemoryRouter>);
    const queue = screen.getByRole('button', { name: 'Queue reports' });
    expect(queue.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tracking Error' }));
    expect(screen.getByText('Uses fixed demonstration alignment assumptions.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Future Report' }));
    fireEvent.click(screen.getByRole('button', { name: 'Queue 2 reports' }));
    expect(submit).toHaveBeenCalledWith([{ definitionKey: 'tracking-error', presetKey: 'rti-demo' }, { definitionKey: 'future-report', presetKey: 'future-preset' }]);
  });
});

const report=(id:string,status:'queued'|'completed',withPdf:boolean)=>({ id, requestId: 'request', reportType: 'Tracking Error', algorithmVersion: '0.1.0', presetName: 'RTI Test 1', presetVersion: '1', status, createdAt: '2026-01-02T03:04:05.000Z', systemName: 'Reference system', artifacts: withPdf ? [{ kind: 'report_pdf' as const, contentType: 'application/pdf', createdAt: '2026-01-02T03:05:05.000Z' }] : [] });
const first:ReportHistoryPage={items:[report('one','completed',true),report('two','queued',true)],limit:10,nextCursor:'next'};
const second:ReportHistoryPage={items:[report('three','completed',false)],limit:10};

describe('ReportsPage', () => {
  it('shows report history fields, completed PDF availability, and keyset paging', async () => {
    const calls:string[]=[];
    vi.stubGlobal('fetch', vi.fn(async (input:RequestInfo | URL) => { const url=String(input); calls.push(url); const body=url.includes('cursor=next') ? second : first; return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }));
    render(<MemoryRouter><ReportsPage /></MemoryRouter>);
    await screen.findAllByText(/Reference system/);
    expect(screen.getAllByText(/RTI Test 1 v1/)).toHaveLength(2);
    expect(screen.getAllByText('Download PDF')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.some(url => url.includes('/v1/reports?limit=10&cursor=next'))).toBe(true));
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(calls.filter(url => url.includes('/v1/reports?limit=10')).length).toBeGreaterThan(2));
  });
});

describe('ReportPicker recovery controls', () => {
  it('exposes a cancel action and an announced active-dialog error', () => {
    const close=vi.fn();
    render(<MemoryRouter><ReportPicker open definitions={definitions} onSubmit={vi.fn(async()=>{})} onClose={close} error="Queue failed. Retry safely." /></MemoryRouter>);
    expect(screen.getByRole('alert').textContent).toContain('Queue failed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
  });
});
