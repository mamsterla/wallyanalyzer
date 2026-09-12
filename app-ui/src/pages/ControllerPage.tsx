import { Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Stack, Typography } from '@mui/material';
import type { CreateReportRequest, CreateSampleUploadBatchResponse, CustomerUnit, PsiuStatus, ReportDefinition, UserSystem } from '@wally/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accessToken } from '../auth.js';
import { RecordArtwork } from '../features/controller/RecordArtwork.js';
import { createPsuClient, PsiuUnavailableError } from '../features/controller/psiuClient.js';
import { apiBaseUrl as api } from '../runtimeConfig.js';
import { ReportPicker } from './SampleUploadPanel.js';

type CapturePhase = 'checking' | 'unavailable' | 'ready' | 'starting' | 'capturing' | 'stopping' | 'completed' | 'processing';

export function queueCapturedPsiuWav(file: File, psiuUnitId: string, observedPsiuUid: string, units: CustomerUnit[]) {
  if (!psiuUnitId || !observedPsiuUid || !units.some(unit => unit.id === psiuUnitId && unit.uid === observedPsiuUid && unit.status === 'enabled')) throw new PsiuUnavailableError();
  return { file, clientFileId: crypto.randomUUID().replaceAll('-', ''), psiuUnitId, observedPsiuUid, recordedAt: new Date(file.lastModified).toISOString(), source: 'psiu_capture' as const };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!response.ok) throw Error((await response.json().catch(() => ({}))).message ?? 'Request failed.');
  return response.status === 204 ? undefined as T : response.json();
}

export function captureEligibility(status: PsiuStatus, units: CustomerUnit[], systems: UserSystem[]): { ok: true; unit: CustomerUnit } | { ok: false; message: string } {
  if (!systems.some(item => item.active)) return { ok: false, message: 'Create and select an active system before capture.' };
  const unit = eligibleUnit(status, units);
  return unit ? { ok: true, unit } : { ok: false, message: 'This PSIU UID is not assigned and enabled for capture.' };
}
function eligibleUnit(status: PsiuStatus, units: CustomerUnit[]) { return units.find(item => item.uid === status.uid && item.status === 'enabled'); }

export function ControllerPage({ units, systems }: { units: CustomerUnit[]; systems: UserSystem[] }) {
  const client = useMemo(() => createPsuClient(), []);
  const navigate = useNavigate();
  const [phase, setPhase] = useState<CapturePhase>('checking');
  const [status, setStatus] = useState<PsiuStatus | null>(null);
  const [unit, setUnit] = useState<CustomerUnit>();
  const [notice, setNotice] = useState('Connecting to the local PSIU bridge.');
  const [dialog, setDialog] = useState(false);
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const next = await client.getStatus();
      setStatus(next);
      const assignedUnit = eligibleUnit(next, units);
      if (next.recording && !assignedUnit) {
        setUnit(undefined); setPhase('unavailable'); setNotice('PSIU is recording, but its enabled assignment is unavailable. Restore the assignment before stopping and processing this capture.'); return;
      }
      if (assignedUnit) setUnit(assignedUnit);
      const eligibility = captureEligibility(next, units, systems);
      setPhase(next.recording ? 'capturing' : 'ready');
      setNotice(next.recording ? 'PSIU is recording.' : eligibility.ok ? 'PSIU is ready to capture.' : eligibility.message);
    } catch { setPhase('unavailable'); setNotice('PSIU is unavailable. Check the temporary direct browser connection and device.'); }
  }, [client, units, systems]);
  useEffect(() => { void refresh(); }, [refresh]);

  const start = async () => {
    setPhase('starting'); setError('');
    try {
      const checked = await client.getStatus();
      const eligibility = captureEligibility(checked, units, systems);
      if (!eligibility.ok) { setStatus(checked); setPhase('ready'); setNotice(eligibility.message); return; }
      const next = await client.startCapture(); setStatus(next); setUnit(eligibility.unit);
      if (!next.recording) { setPhase('ready'); setNotice('PSIU did not confirm recording. Capture was not started.'); return; }
      setPhase('capturing'); setNotice('PSIU is recording. Monitor progress, then stop capture.');
    } catch { setPhase('unavailable'); setNotice('Capture did not start. Check the temporary direct browser connection and PSIU.'); }
  };
  const stop = async () => {
    setPhase('stopping'); setError('');
    try {
      const next = await client.stopCapture(); setStatus(next);
      if (next.recording) { setPhase('capturing'); setNotice('PSIU still reports recording. Wait briefly, then stop capture again.'); return; }
      const assignedUnit = unit ?? eligibleUnit(next, units);
      if (!assignedUnit) { setPhase('unavailable'); setNotice('PSIU stopped, but its enabled assignment is unavailable. Restore the assignment before processing this capture.'); return; }
      setUnit(assignedUnit); setDefinitions(await request<ReportDefinition[]>('/v1/reports/definitions')); setPhase('completed'); setDialog(true); setNotice('Capture complete. Choose reports to process or discard it.');
    } catch { setPhase('unavailable'); setNotice('Capture could not be stopped through the temporary direct browser connection.'); }
  };
  useEffect(() => {
    if (phase !== 'capturing') return;
    const timer = window.setInterval(() => void client.getStatus().then(next => {
      setStatus(next);
      if (!next.recording) { setPhase('ready'); setNotice('PSIU stopped recording. Press Start capture only after resolving the completed recording.'); }
    }).catch(() => setNotice('PSIU status update delayed.')), 2000);
    return () => window.clearInterval(timer);
  }, [client, phase]);

  const discard = () => { setDialog(false); setPhase('ready'); setUnit(undefined); setError(''); setNotice('Capture discarded. PSIU is ready to capture.'); };
  const process = async (reports: CreateReportRequest['reports']) => {
    if (!unit || !status) return;
    setError(''); setPhase('processing');
    try {
      const wav = await client.getCompletedCapture(); if (!wav) throw Error('PSIU has no completed WAV file.');
      const file = new File([wav], `psiu-${status.uid}-${Date.now()}.wav`, { type: 'audio/wav' });
      const idempotencyKey = crypto.randomUUID().replaceAll('-', '');
      const batch = await request<CreateSampleUploadBatchResponse>('/v1/samples/upload-batches', { method: 'POST', body: JSON.stringify({ idempotencyKey, psiuUnitId: unit.id, systemId: systems.find(item => item.active)?.id, source: 'psiu_capture', observedPsiuUid: status.uid, files: [{ clientFileId: crypto.randomUUID().replaceAll('-', ''), fileName: file.name, contentType: 'audio/wav', byteLength: file.size, recordedAt: new Date().toISOString(), source: 'psiu_capture' }] }) });
      const intent = batch.uploads[0]; if (!intent) throw Error('Upload intent is unavailable.');
      const put = await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.requiredHeaders, body: file }); if (!put.ok) throw Error('Capture upload failed.');
      await request(`/v1/samples/${intent.sampleId}/complete`, { method: 'POST' });
      await request('/v1/reports/requests', { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID().replaceAll('-', ''), batchId: batch.batchId, reports }) });
      setDialog(false); setPhase('ready'); setNotice('Processing queued. Track progress in the Home activity queue.'); navigate('/');
    } catch (reason) { setPhase('completed'); setError(reason instanceof Error ? reason.message : 'Unable to process this sample.'); }
  };
  const eligibility = status ? captureEligibility(status, units, systems) : { ok: false as const, message: 'Checking PSIU connection.' };
  const busy = ['checking', 'starting', 'stopping', 'processing'].includes(phase);
  return <Stack spacing={3}><Box><Typography variant="h3">Sample Capture</Typography><Typography color="text.secondary">Temporary direct-browser PSIU mode. WAV files can only be processed from this PSIU.</Typography></Box><Alert severity={phase === 'unavailable' || !eligibility.ok ? 'info' : 'success'} action={phase === 'unavailable' ? <Button color="inherit" onClick={() => void refresh()}>Retry PSIU</Button> : undefined}>{notice}</Alert><Grid container spacing={3}><Grid size={{ xs: 12, md: 5 }}><Card><CardContent><Typography variant="h6">PSIU connection</Typography>{status ? <Stack mt={2} spacing={1}><Detail label="Unit ID" value={status.uid}/><Detail label="Recorder" value={status.recorderState}/><Detail label="Sample rate" value={`${status.sampleRateHz} Hz`}/></Stack> : <Typography mt={2}>No PSIU connection.</Typography>}</CardContent></Card></Grid><Grid size={{ xs: 12, md: 7 }}><Card><CardContent><Stack spacing={2} alignItems="center"><Typography variant="h6" alignSelf="start">Capture control</Typography><RecordArtwork state={phase === 'capturing' || busy ? 'spinning' : 'stopped'}/>{phase === 'capturing' ? <Button variant="contained" color="secondary" size="large" onClick={() => void stop()}>Stop capture</Button> : <Button variant="contained" size="large" disabled={busy || phase === 'unavailable' || !eligibility.ok} onClick={() => void start()}>Start capture</Button>}{phase === 'capturing' && status && <Typography>Pages written: {status.pagesWritten} · Dropped halves: {status.droppedHalves}</Typography>}</Stack></CardContent></Card></Grid></Grid><ReportPicker open={dialog} definitions={definitions} error={error} onClose={discard} onSubmit={process} cancelLabel="Discard"/></Stack>;
}
function Detail({ label, value }: { label: string; value: string }) { return <Box><Typography variant="caption" color="text.secondary">{label}</Typography><Typography>{value}</Typography></Box>; }
