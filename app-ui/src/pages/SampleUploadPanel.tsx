import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Paper, Stack, Typography } from '@mui/material';
import type { CreateReportRequest, CreateSampleUploadBatchResponse, CustomerUnit, ReportDefinition, UserSystem } from '@wally/contracts';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accessToken } from '../auth.js';
import { WallySelect } from '../designSystemSelect.js';
import { apiBaseUrl as api } from '../runtimeConfig.js';
import type { CapturedPsiuFile } from './ControllerPage.js';

type QueuedFile = { file: File; clientFileId: string; recordedAt: string; source: 'manual_file' | 'psiu_capture'; psiuUnitId?: string; observedPsiuUid?: string };
type UploadBatch = { idempotencyKey: string; psiuUnitId: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${api}${path}`, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!response.ok) throw Error((await response.json().catch(() => ({}))).message ?? 'Request failed.');
  return response.status === 204 ? undefined as T : response.json();
}

export function SampleUploadPanel({ units, captured, onCaptureConsumed }: { units: CustomerUnit[]; captured?: CapturedPsiuFile; onCaptureConsumed: () => void }) {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [batch, setBatch] = useState<UploadBatch>();
  const [unit, setUnit] = useState('');
  const [systems, setSystems] = useState<UserSystem[]>([]);
  const [system, setSystem] = useState('');
  const [message, setMessage] = useState('');
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [pickerBatch, setPickerBatch] = useState('');
  const [pickerRequestKey, setPickerRequestKey] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    void request<UserSystem[]>('/v1/me/systems').then(nextSystems => {
      setSystems(nextSystems);
      const active = nextSystems.find(item => item.active);
      if (active) setSystem(current => current || active.id);
    }).catch(error => setMessage(error instanceof Error ? error.message : 'Failed to load recording systems.'));
  }, []);

  useEffect(() => {
    if (!captured) return;
    setFiles(current => current.some(file => file.clientFileId === captured.clientFileId) ? current : [...current, captured]);
    setUnit(captured.psiuUnitId);
    setBatch(undefined);
    setMessage('PSIU capture added. Upload when ready.');
    onCaptureConsumed();
  }, [captured, onCaptureConsumed]);

  const selectFiles = (next: File[]) => {
    setFiles(next.map(file => ({ file, clientFileId: crypto.randomUUID().replace(/-/g, ''), recordedAt: new Date(file.lastModified || Date.now()).toISOString(), source: 'manual_file' })));
    setBatch(undefined);
    setMessage('');
  };

  const upload = async () => {
    try {
      if (!files.length) throw Error('Select one or more WAV files.');
      if (new Set(files.map(file => file.source)).size !== 1) throw Error('Upload PSIU captures and manually selected files in separate batches.');
      if (!unit) throw Error('Select an assigned enabled PSIU.');
      if (!system) throw Error('Create and select an active recording system before processing.');
      const activeBatch = batch && batch.psiuUnitId === unit ? batch : { idempotencyKey: crypto.randomUUID().replace(/-/g, ''), psiuUnitId: unit };
      if (!batch) setBatch(activeBatch);
      const inputs = await Promise.all(files.map(async item => ({ clientFileId: item.clientFileId, fileName: item.file.name, contentType: item.file.type || 'audio/wav', byteLength: item.file.size, sha256Base64: await digest(item.file), recordedAt: item.recordedAt })));
      const observedPsiuUid = files.find(file => file.psiuUnitId === unit)?.observedPsiuUid;
      const response = await request<CreateSampleUploadBatchResponse>('/v1/samples/upload-batches', { method: 'POST', body: JSON.stringify({ idempotencyKey: activeBatch.idempotencyKey, psiuUnitId: unit, systemId: system, source: files[0]?.source, ...(observedPsiuUid ? { observedPsiuUid } : {}), files: inputs.map((input, index) => ({ ...input, source: files[index]!.source })) }) });
      for (const intent of response.uploads) {
        const file = files.find(item => item.clientFileId === intent.clientFileId)?.file;
        if (!file) throw Error('Selected file changed during upload.');
        const put = await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.requiredHeaders, body: file });
        if (!put.ok) throw Error(`Upload failed for ${file.name}.`);
        await request(`/v1/samples/${intent.sampleId}/complete`, { method: 'POST' });
      }
      setFiles([]);
      setBatch(undefined);
      setDefinitions(await request<ReportDefinition[]>('/v1/reports/definitions'));
      setPickerBatch(response.batchId);
      setPickerRequestKey(crypto.randomUUID().replace(/-/g, ''));
      setPickerError('');
      setPickerOpen(true);
      setMessage('Uploads verified. Choose a report to process.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed. Retry uses the same upload batch.');
    }
  };

  return <Paper component="section" aria-labelledby="sample-upload-title" sx={{ p: 2 }}>
    <Typography id="sample-upload-title" variant="h6">Upload and Process</Typography>
    <Stack spacing={2} mt={1}>
      <WallySelect label="Assigned PSIU" value={unit} onChange={value => { setUnit(value); setBatch(undefined); }} options={[{ value: '', label: 'Select PSIU' }, ...units.filter(item => item.status === 'enabled').map(item => ({ value: item.id, label: `${item.serialNumber} · ${item.uid}` }))]} />
      <WallySelect label="Recording system" value={system} onChange={value => { setSystem(value); setBatch(undefined); }} options={[{ value: '', label: 'Create or select a system' }, ...systems.map(item => ({ value: item.id, label: `${item.name}${item.active ? ' · Active' : ''}` }))]} />
      {!systems.length && <Alert severity="info">Create a system before processing a capture.</Alert>}
      <Button component="label" variant="outlined">Select WAV files<input hidden type="file" accept="audio/wav,audio/wave,.wav" multiple onChange={event => selectFiles(Array.from(event.target.files ?? []))} /></Button>
      {files.length > 0 && <Typography>{files.map(file => file.file.name).join(', ')}</Typography>}
      <Button variant="contained" disabled={!files.length || !unit} onClick={() => void upload()}>{batch ? 'Retry Process and Report' : 'Process and Report'}</Button>
      {message && <Alert severity="info">{message}</Alert>}
    </Stack>
    <ReportPicker open={pickerOpen} definitions={definitions} error={pickerError} onClose={() => { setPickerOpen(false); setPickerRequestKey(''); setPickerError(''); }} onSubmit={async reports => {
      try {
        if (!reports.length) throw Error('Select at least one report.');
        await request('/v1/reports/requests', { method: 'POST', body: JSON.stringify({ idempotencyKey: pickerRequestKey, batchId: pickerBatch, reports } satisfies CreateReportRequest) });
        setPickerOpen(false);
        setPickerRequestKey('');
        setPickerError('');
        nav('/reports');
      } catch (error) {
        setPickerError(error instanceof Error ? error.message : 'Unable to queue reports.');
      }
    }} />
  </Paper>;
}

export function ReportPicker({ open, definitions, onSubmit, onClose, error }: { open: boolean; definitions: ReportDefinition[]; onSubmit: (reports: CreateReportRequest['reports']) => Promise<void>; onClose: () => void; error?: string }) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const count = Object.keys(selected).length;
  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"><DialogTitle>Choose reports</DialogTitle><DialogContent><Typography color="text.secondary" mb={2}>Choose one or more reports. Each report runs independently after upload verification.</Typography>{error && <Alert severity="error" role="alert" sx={{ mb: 1 }}>{error}</Alert>}{definitions.map(definition => {
    const presetKey = selected[definition.key] ?? definition.presets[0]?.key ?? '';
    const active = Boolean(selected[definition.key]);
    const preset = definition.presets.find(item => item.key === presetKey);
    return <Paper key={definition.key} variant="outlined" sx={{ p: 2, mb: 1, borderColor: active ? 'primary.main' : 'divider' }}><FormControlLabel control={<Checkbox checked={active} onChange={event => setSelected(current => { const next = { ...current }; if (event.target.checked) next[definition.key] = current[definition.key] ?? definition.presets[0]?.key ?? ''; else delete next[definition.key]; return next; })} />} label={<Typography variant="h6">{definition.displayName}</Typography>} /><Typography variant="body2">Algorithm {definition.algorithmVersion}</Typography>{active && <WallySelect label={`${definition.displayName} preset`} value={presetKey} onChange={value => setSelected(current => ({ ...current, [definition.key]: value }))} options={definition.presets.map(item => ({ value: item.key, label: `${item.displayName} v${item.version}` }))} />}{active && preset?.notice && <Alert severity="info" sx={{ mt: 1 }}>{preset.notice}</Alert>}</Paper>;
  })}</DialogContent><DialogActions><Button onClick={onClose}>Cancel</Button><Button disabled={!count} variant="contained" onClick={() => void onSubmit(Object.entries(selected).map(([definitionKey, presetKey]) => ({ definitionKey, presetKey })))}>Queue {count ? `${count} ` : ''}report{count === 1 ? '' : 's'}</Button></DialogActions></Dialog>;
}

async function digest(file: File) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  let binary = '';
  for (let offset = 0; offset < hash.length; offset += 8192) binary += String.fromCharCode(...hash.subarray(offset, offset + 8192));
  return btoa(binary);
}
