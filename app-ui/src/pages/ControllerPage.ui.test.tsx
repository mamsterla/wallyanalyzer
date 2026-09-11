// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PsiuStatus } from '@wally/contracts';
import { ControllerPage } from './ControllerPage.js';

vi.mock('../auth.js', () => ({ accessToken: vi.fn(async () => 'token') }));

const ready: PsiuStatus = { uid: 'uid-1', uptimeMs: 1, sampleRateHz: 48_000, recording: false, xlr: false, bufferCount: 0, recorderState: 'idle', pagesWritten: 0, droppedHalves: 0, badBlockCount: 0, dmaErrors: 0, i2sErrors: 0, recordingCount: 0 };
const recording: PsiuStatus = { ...ready, recording: true, recorderState: 'recording' };
const client = { getStatus: vi.fn(async () => ready), startCapture: vi.fn(async () => recording), stopCapture: vi.fn(async () => ready), getCompletedCapture: vi.fn(async () => new Blob(['RIFF____WAVE'], { type: 'audio/wav' })) };
vi.mock('../features/controller/psiuClient.js', () => ({ createPsuClient: () => client, PsiuUnavailableError: class PsiuUnavailableError extends Error {} }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const units = [{ id: 'unit-1', serialNumber: 'serial-1', uid: 'uid-1', status: 'enabled' as const }];
const systems = [{ id: 'system-1', name: 'Reference system', notes: '', components: { turntable: 'TT', tonearm: 'Arm', cartridge: 'Cart' }, active: true, createdAt: '2026-01-01T00:00:00.000Z' }];

function renderController() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.endsWith('/v1/me/systems') ? systems : [];
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return render(<MemoryRouter><ControllerPage units={units} systems={systems} /></MemoryRouter>);
}

describe('Sample Capture upload panel', () => {
  it('renders manual WAV upload controls below the PSIU controller', async () => {
    renderController();
    await screen.findByRole('button', { name: 'Start capture' });
    expect(screen.getByRole('heading', { name: 'PSIU connection' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Capture control' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Upload and Process' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select WAV files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Process and Report' })).toBeTruthy();
  });

  it('adds a completed PSIU WAV to the controller upload panel without navigating home', async () => {
    renderController();
    fireEvent.click(await screen.findByRole('button', { name: 'Start capture' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop capture' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add to batch' }));
    expect(await screen.findByText(/psiu-uid-1-.*\.wav/)).toBeTruthy();
    expect(screen.getByText('Capture added below. Upload and verify it before selecting a report.')).toBeTruthy();
    expect(screen.queryByText('Continue from your account page.')).toBeNull();
  });
});
