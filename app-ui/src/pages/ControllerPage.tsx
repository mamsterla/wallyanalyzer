import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import type { PsiuCaptureInfo, PsiuStatus } from '@wally/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RecordArtwork } from '../features/controller/RecordArtwork.js';
import { createPsuClient, PsiuUnavailableError } from '../features/controller/psiuClient.js';

type CapturePhase = 'checking' | 'unavailable' | 'ready' | 'starting' | 'capturing' | 'stopping' | 'completed';

export function ControllerPage() {
  const [phase, setPhase] = useState<CapturePhase>('checking');
  const [status, setStatus] = useState<PsiuStatus | null>(null);
  const [capture, setCapture] = useState<PsiuCaptureInfo | null>(null);
  const [showUploadPrompt, setShowUploadPrompt] = useState(false);
  const [notice, setNotice] = useState('Checking for PSIU on your local network.');

  const client = useMemo(() => createPsuClient(), []);

  const refresh = useCallback(async () => {
    setPhase('checking');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const nextStatus = await client.getStatus();
        setStatus(nextStatus);
        setPhase(nextStatus.recording ? 'capturing' : 'ready');
        setNotice(nextStatus.recording ? captureNotice(nextStatus) : 'PSIU is ready to capture.');
        return;
      } catch (error) {
        if (attempt < 3) {
          setNotice(`Waiting for PSIU status (${attempt}/3)…`);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 2_000));
          continue;
        }
        setStatus(null);
        setPhase('unavailable');
        setNotice(error instanceof PsiuUnavailableError ? 'PSIU unit unavailable. Check power, network, and device address.' : 'PSIU unit unavailable.');
      }
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startCapture = async () => {
    setPhase('starting');
    setNotice('Starting capture…');
    try {
      const nextStatus = await client.startCapture();
      setStatus(nextStatus);
      setCapture(null);
      setShowUploadPrompt(false);
      setPhase('capturing');
      setNotice(captureNotice(nextStatus));
    } catch {
      setPhase('unavailable');
      setNotice('PSIU unit unavailable. Capture did not start.');
    }
  };

  const completeCapture = async () => {
    setPhase('stopping');
    setNotice('Completing capture…');
    try {
      const nextStatus = await client.stopCapture();
      const completedAt = new Date().toISOString();
      const completedCapture = await client.getCompletedCapture(completedAt);
      setStatus(nextStatus);
      setCapture(completedCapture);
      setShowUploadPrompt(Boolean(completedCapture));
      setPhase(completedCapture ? 'completed' : 'ready');
      setNotice(completedCapture ? 'Capture complete. Recording details are ready.' : 'Capture stopped. PSIU has no completed recording metadata yet.');
    } catch {
      setPhase('unavailable');
      setNotice('PSIU unit unavailable while completing capture.');
    }
  };

  useEffect(() => {
    if (phase !== 'capturing') return;
    let cancelled = false;
    let failedPolls = 0;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const nextStatus = await client.getStatus();
        if (cancelled) return;
        failedPolls = 0;
        setStatus(nextStatus);
        if (nextStatus.recording) {
          setNotice(captureNotice(nextStatus));
        } else {
          setPhase('ready');
          setNotice('PSIU is ready to capture.');
          return;
        }
      } catch {
        if (cancelled) return;
        failedPolls += 1;
        if (failedPolls >= 3) {
          setPhase('unavailable');
          setNotice('PSIU unit unavailable after three consecutive status checks.');
          return;
        }
        setNotice(`PSIU status update delayed (${failedPolls}/3). Capture remains active while retrying.`);
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2_000);
    };

    timer = window.setTimeout(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [client, phase]);

  const recordState = phase === 'capturing' || phase === 'starting' || phase === 'stopping'
    ? 'spinning'
    : phase === 'completed'
      ? 'digitized'
      : 'stopped';
  const isBusy = phase === 'checking' || phase === 'starting' || phase === 'stopping';
  const isUnavailable = phase === 'unavailable';

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h3">PSIU local capture</Typography>
        <Typography color="text.secondary">Connect to a PSIU on this network. Nothing is uploaded in this milestone.</Typography>
      </Box>

      <Alert severity={isUnavailable ? 'info' : 'success'}>{notice}</Alert>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card><CardContent><Stack spacing={2}>
            <Typography variant="h6">PSIU connection</Typography>
            <Typography variant="body2" color="text.secondary">This local application reaches the configured LAN PSIU through its same-origin local proxy. Capture status refreshes every two seconds while PSIU is active.</Typography>
            <Divider />
            <UnitSummary status={status} unavailable={isUnavailable} />
          </Stack></CardContent></Card>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Card><CardContent><Stack spacing={2} alignItems="center">
            <Typography variant="h6" alignSelf="start">Capture control</Typography>
            <RecordArtwork state={recordState} />
            {phase === 'capturing' ? (
              <Button variant="contained" color="secondary" size="large" onClick={() => void completeCapture()} disabled={isBusy}>Stop capture</Button>
            ) : (
              <Button variant="contained" size="large" onClick={() => void startCapture()} disabled={isBusy || isUnavailable}>Start capture</Button>
            )}
            {phase === 'capturing' && status && <LiveCaptureProgress status={status} />}
            {capture && <CaptureSummary capture={capture} />}
            <Dialog open={showUploadPrompt} onClose={() => setShowUploadPrompt(false)}><DialogTitle>Upload this capture?</DialogTitle><DialogContent><DialogContentText>This capture is complete. Upload is not enabled in this milestone, so no recording will be sent from this application.</DialogContentText></DialogContent><DialogActions><Button onClick={() => setShowUploadPrompt(false)}>Not now</Button><Button variant="contained" onClick={() => setShowUploadPrompt(false)}>Upload when available</Button></DialogActions></Dialog>
          </Stack></CardContent></Card>
        </Grid>
      </Grid>
    </Stack>
  );
}

function captureNotice(status: PsiuStatus): string {
  if (status.recorderState === 'wait_half') return 'PSIU is armed and waiting for audio input. Start the record or cancel capture.';
  return 'PSIU is recording. Keep the record playing until complete.';
}

function UnitSummary({ status, unavailable }: { status: PsiuStatus | null; unavailable: boolean }) {
  if (!status) return <Typography color="text.secondary">{unavailable ? 'No PSIU unit detected.' : 'Waiting for unit status…'}</Typography>;
  return <Stack spacing={1.25}>
    <Chip label={status.recording ? 'Recording now' : 'Ready'} color={status.recording ? 'warning' : 'success'} sx={{ alignSelf: 'start' }} />
    <Detail label="Unit ID" value={status.uid} />
    <Detail label="Sample rate" value={`${formatNumber(status.sampleRateHz)} Hz`} />
    <Detail label="Input" value={status.xlr ? 'Balanced XLR' : 'RCA'} />
    <Detail label="Recorder" value={humanize(status.recorderState)} />
    <Detail label="Uptime" value={formatDuration(status.uptimeMs)} />
    <Detail label="Completed recordings" value={String(status.recordingCount)} />
  </Stack>;
}

function LiveCaptureProgress({ status }: { status: PsiuStatus }) {
  const bytesWritten = status.pagesWritten * 2_048 * 2;
  return <Box width="100%" pt={1}><Divider sx={{ mb: 2 }} /><Typography variant="subtitle1" gutterBottom>Live capture progress</Typography><Grid container spacing={1}><Grid size={6}><Detail label="Pages written" value={formatNumber(status.pagesWritten)} /></Grid><Grid size={6}><Detail label="Estimated bytes captured" value={formatBytes(bytesWritten)} /></Grid><Grid size={6}><Detail label="Buffer wraps" value={formatNumber(status.bufferCount)} /></Grid><Grid size={6}><Detail label="Dropped halves" value={formatNumber(status.droppedHalves)} /></Grid><Grid size={6}><Detail label="DMA errors" value={formatNumber(status.dmaErrors)} /></Grid><Grid size={6}><Detail label="I²S errors" value={formatNumber(status.i2sErrors)} /></Grid></Grid><Typography variant="caption" color="text.secondary">Calculated as 2,048 words per page × 2 bytes per word.</Typography></Box>;
}

function CaptureSummary({ capture }: { capture: PsiuCaptureInfo }) {
  const bitrate = capture.sampleRateHz * capture.channels * capture.bits;
  return <Box width="100%" pt={1}><Divider sx={{ mb: 2 }} /><Typography variant="subtitle1" gutterBottom>Capture details</Typography><Grid container spacing={1}><Grid size={6}><Detail label="Duration" value={formatDuration(capture.durationMs)} /></Grid><Grid size={6}><Detail label="Bytes captured" value={formatBytes(capture.dataBytes)} /></Grid><Grid size={6}><Detail label="Bit rate" value={`${(bitrate / 1_000_000).toFixed(2)} Mbps`} /></Grid><Grid size={6}><Detail label="Format" value={`${capture.sampleRateHz / 1000} kHz · ${capture.bits}-bit · ${capture.channels} ch`} /></Grid><Grid size={12}><Detail label="Completed" value={new Date(capture.completedAt).toLocaleString()} /></Grid></Grid></Box>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <Box><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2">{value}</Typography></Box>;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${formatNumber(value)} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / (1_024 * 1_024)).toFixed(2)} MiB`;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
