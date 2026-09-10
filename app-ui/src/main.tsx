import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { App } from './App.js';
import './features/controller/recordAnimation.css';

const theme = createTheme({
  palette: { mode: 'dark', primary: { main: '#d8a54b' }, background: { default: '#111315', paper: '#1d1d1f' }, text: { primary: '#f5f2ec' } },
  shape: { borderRadius: 10 },
  components: {
    MuiSelect: { styleOverrides: { select: { display: 'flex', alignItems: 'center' } } },
    MuiMenu: { styleOverrides: { paper: { backgroundColor: '#1d1d1f', border: '1px solid #8d6a2c', boxShadow: '0 12px 28px rgba(0,0,0,.5)' } } },
    MuiMenuItem: { styleOverrides: { root: { color: '#f5f2ec', '&.Mui-selected': { backgroundColor: 'rgba(216,165,75,.24)', color: '#fff' }, '&.Mui-selected:hover, &:hover': { backgroundColor: 'rgba(216,165,75,.34)' }, '&.Mui-focusVisible': { outline: '2px solid #d8a54b', outlineOffset: '-2px' } } } },
    MuiOutlinedInput: { styleOverrides: { root: { '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#d8a54b' } } } },
  },
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
