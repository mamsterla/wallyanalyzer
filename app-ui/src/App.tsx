import { AppBar, Box, Button, Container, Stack, Toolbar, Typography } from '@mui/material';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { ControllerPage } from './pages/ControllerPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { EquipmentPage } from './pages/EquipmentPage.js';
import { ReportsPage } from './pages/ReportsPage.js';

function Navigation() {
  const navigate = useNavigate();
  return (
    <AppBar position="static" color="transparent" elevation={0}>
      <Container maxWidth="lg">
        <Toolbar disableGutters>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Wally Analyzer</Typography>
          <Stack direction="row" spacing={1}>
            {['Dashboard', 'Reports', 'Equipment', 'PSIU Controller'].map((label) => (
              <Button key={label} color="inherit" onClick={() => navigate(label === 'Dashboard' ? '/' : `/${label.toLowerCase().replace(' ', '-')}`)}>{label}</Button>
            ))}
          </Stack>
        </Toolbar>
      </Container>
    </AppBar>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Navigation />
      <Box component="main" py={5}><Container maxWidth="lg"><Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/equipment" element={<EquipmentPage />} />
        <Route path="/psiu-controller" element={<ControllerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Container></Box>
    </BrowserRouter>
  );
}
