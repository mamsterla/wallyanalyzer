import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import type { EquipmentItem } from '@wally/contracts';

const equipment: EquipmentItem[] = [];

export function EquipmentPage() {
  return <Stack spacing={2}><Typography variant="h3">Tracked equipment</Typography><Typography color="text.secondary">Turntables, tonearms, and cartridges influence report interpretation.</Typography><Button variant="contained" sx={{ alignSelf: 'start' }}>Add equipment</Button>{equipment.length === 0 && <Card><CardContent>No equipment recorded yet.</CardContent></Card>}</Stack>;
}
