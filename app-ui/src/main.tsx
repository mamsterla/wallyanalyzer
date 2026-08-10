import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { App } from './App.js';
import './features/controller/recordAnimation.css';

const theme = createTheme({
  palette: { mode: 'dark', primary: { main: '#d8a54b' }, background: { default: '#111315' } },
  shape: { borderRadius: 10 },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
