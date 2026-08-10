import { Alert, Card, CardContent, Grid, Stack, Typography } from '@mui/material';

export function DashboardPage() {
  return (
    <Stack spacing={3}>
      <div><Typography variant="h3">Your listening system</Typography><Typography color="text.secondary">Manage equipment, capture samples, and review analysis.</Typography></div>
      <Alert severity="info">Authentication, commerce, and report APIs are next integration milestones. This UI is a route and workflow foundation.</Alert>
      <Grid container spacing={2}>
        {[['Analysis credits', '0 available'], ['Recent samples', 'No samples uploaded'], ['PSIU status', 'Not connected']].map(([title, value]) => (
          <Grid key={title} size={{ xs: 12, md: 4 }}><Card><CardContent><Typography color="text.secondary">{title}</Typography><Typography variant="h5">{value}</Typography></CardContent></Card></Grid>
        ))}
      </Grid>
    </Stack>
  );
}
