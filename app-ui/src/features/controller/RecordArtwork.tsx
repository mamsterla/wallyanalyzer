import { Box, Typography } from '@mui/material';

export type RecordArtworkState = 'stopped' | 'spinning' | 'digitized';

export function RecordArtwork({ state }: { state: RecordArtworkState }) {
  const isSpinning = state === 'spinning';
  const isDigitized = state === 'digitized';

  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 1 }}>
      <Box
        aria-label={`Record is ${state}`}
        sx={{
          width: { xs: 190, sm: 230 },
          aspectRatio: '1',
          borderRadius: '50%',
          position: 'relative',
          animation: isSpinning ? 'wally-record-spin 2.8s linear infinite' : 'none',
          border: `3px solid ${isDigitized ? '#61fff6' : '#ffca66'}`,
          background: isDigitized
            ? 'repeating-radial-gradient(circle, #07161b 0 4px, #50f6ef 5px 6px, #102e37 7px 9px), radial-gradient(circle, #61fff6 0 14%, #071014 15% 100%)'
            : 'repeating-radial-gradient(circle, #080b10 0 4px, #778190 5px 6px, #18202b 7px 9px), radial-gradient(circle, #ffca66 0 14%, #0b0f16 15% 100%)',
          boxShadow: isDigitized ? '0 0 34px rgba(29, 229, 225, .58)' : '0 0 26px rgba(255, 202, 102, .46), 0 18px 30px rgba(0, 0, 0, .5)',
          '&::before': { content: '""', position: 'absolute', top: '7%', left: 'calc(50% - 5px)', width: 10, height: 18, borderRadius: 5, backgroundColor: isDigitized ? '#61fff6' : '#ffca66', boxShadow: `0 0 12px ${isDigitized ? '#61fff6' : '#ffca66'}` },
          '&::after': { content: '""', position: 'absolute', inset: '42%', borderRadius: '50%', backgroundColor: '#111722', border: `2px solid ${isDigitized ? '#61fff6' : '#ffca66'}` },
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {isSpinning ? 'Recording in progress' : isDigitized ? 'Capture digitized' : 'Ready to capture'}
      </Typography>
    </Box>
  );
}
