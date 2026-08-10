import { Alert, Stack, Typography } from '@mui/material';

export function ReportsPage() {
  return <Stack spacing={2}><Typography variant="h3">Analysis reports</Typography><Alert severity="info">Reports appear here after a sample is processed. Report data must be scoped to the authenticated owner unless an admin aggregate view is selected.</Alert></Stack>;
}
