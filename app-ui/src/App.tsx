import {
  AppBar,
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Checkbox,
  Grid,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type {
  CreditsResponse,
  CustomerSummary,
  CustomerUnit,
  CreateReportRequest,
  CreateSampleUploadBatchResponse,
  MeResponse,
  SampleSummary,
  UserSystem,
  UserAlert,
  ReportDefinition,
} from '@wally/contracts';
import {
  accessToken,
  changePassword,
  completeTemporaryPassword,
  configured,
  confirmEmailAttribute,
  forgotPassword,
  login,
  logout,
  refreshSession,
  requestEmailVerificationCode,
  resetPassword,
} from './auth.js';
import { completeEmailConfirmation, requestEmailConfirmation } from './emailConfirmation.js';
import { apiBaseUrl as api } from './runtimeConfig.js';
import { ControllerPage } from './pages/ControllerPage.js';
import { WallySelect } from './designSystemSelect.js';
import { CreditsPage, ProfilePage, ReportsPage, SystemsPage } from './pages/UserExperiencePages.js';
import { AdminConsole } from './pages/AdminConsole.js';
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const r = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
  if (!r.ok) throw Error((await r.json().catch(() => ({}))).message ?? 'Request failed.');
  return r.status === 204 ? (undefined as T) : r.json();
}
function Login({ done }: { done: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'login' | 'reset' | 'temporary' | 'confirm'>('login');

  const durableConfirm = async () => {
    const token = await accessToken();
    const response = await fetch(`${api}/v1/me/confirm-email`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok)
      throw Error(
        (await response.json().catch(() => ({}))).message ?? 'Email confirmation failed.',
      );
  };
  const sendConfirmationCode = async () => {
    setVerificationCode('');
    setMode('confirm');
    await requestEmailConfirmation({ requestCode: requestEmailVerificationCode });
    setMessage('Email verification code sent. Enter it to activate your Wally account.');
  };
  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  return (
    <Paper sx={{ p: 3, maxWidth: 420, mx: 'auto' }}>
      <Typography variant="h5">Wally sign in</Typography>
      {!configured() && (
        <Alert severity="warning" sx={{ my: 2 }}>
          Cognito browser configuration is required.
        </Alert>
      )}
      <Stack spacing={2} mt={2}>
        <TextField
          label="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={mode === 'confirm'}
        />
        {(mode === 'reset' || mode === 'confirm') && (
          <TextField
            label="Verification code"
            value={verificationCode}
            onChange={(event) => setVerificationCode(event.target.value)}
          />
        )}
        {mode === 'login' && (
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
        {mode === 'temporary' && (
          <>
            <TextField
              label="Temporary password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </>
        )}
        {mode === 'reset' && (
          <TextField
            label="New password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        )}
        <Button
          variant="contained"
          onClick={async () => {
            try {
              if (mode === 'reset') {
                await resetPassword(email, verificationCode, newPassword);
                setMode('login');
                setPassword('');
                setNewPassword('');
                setVerificationCode('');
                setMessage('Password reset. Sign in.');
              } else if (mode === 'temporary') {
                await completeTemporaryPassword(email, password, newPassword);
                await sendConfirmationCode();
              } else if (mode === 'confirm') {
                await completeEmailConfirmation(verificationCode, {
                  verifyAttribute: confirmEmailAttribute,
                  refreshSession,
                  confirmDurably: durableConfirm,
                });
                await done();
              } else {
                await login(email, password);
                try {
                  await durableConfirm();
                  await done();
                } catch (error) {
                  if (error instanceof Error && error.message.includes('Confirm your email'))
                    await sendConfirmationCode();
                  else throw error;
                }
              }
            } catch (error) {
              if (
                mode === 'login' &&
                error instanceof Error &&
                error.message.includes('Temporary password')
              )
                setMode('temporary');
              setMessage(errorMessage(error, 'Sign-in failed.'));
            }
          }}
        >
          {mode === 'reset'
            ? 'Reset password'
            : mode === 'temporary'
              ? 'Set password'
              : mode === 'confirm'
                ? 'Confirm email'
                : 'Sign in'}
        </Button>
        {mode === 'confirm' ? (
          <Button
            onClick={() =>
              void sendConfirmationCode().catch((error) =>
                setMessage(errorMessage(error, 'Email verification failed.')),
              )
            }
          >
            Resend verification code
          </Button>
        ) : (
          <Button
            onClick={async () => {
              try {
                await forgotPassword(email);
                setMode('reset');
                setMessage('Check your email for the verification code.');
              } catch (error) {
                setMessage(errorMessage(error, 'Password reset failed.'));
              }
            }}
          >
            Forgot password
          </Button>
        )}
        {message && <Alert severity="info">{message}</Alert>}
      </Stack>
    </Paper>
  );
}
export function actionIsDismissible(alert: Pick<UserAlert, 'dismissible'>) {
  return alert.dismissible;
}
const dashboardTitleSx = { color: 'primary.main', fontWeight: 700, letterSpacing: '.03em' };
const dashboardRowSx = {
  border: '1px solid',
  borderColor: 'rgba(216, 165, 75, .38)',
  borderRadius: 1,
  p: 1.5,
};
function Actions() {
  const [a, setA] = useState<UserAlert[]>([]);
  useEffect(() => {
    void request<UserAlert[]>('/v1/me/alerts').then(setA);
  }, []);
  return (
    <Paper component="section" aria-labelledby="home-actions-title" sx={{ p: 2, height: '100%' }}>
      <Typography id="home-actions-title" variant="h5" sx={dashboardTitleSx}>
        Actions
      </Typography>
      <Stack spacing={1} mt={1.5}>
        {a.length ? (
          a.map((x) => (
            <Box component="article" key={x.id} sx={dashboardRowSx}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                alignItems={{ sm: 'center' }}
              >
                <Box sx={{ flexGrow: 1 }}>
                  <Typography fontWeight={700}>{x.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {x.message}
                  </Typography>
                </Box>
                {x.actionRoute && <Button href={x.actionRoute}>{x.actionLabel}</Button>}
                {actionIsDismissible(x) && (
                  <Button
                    onClick={async () => {
                      await request(`/v1/me/alerts/${x.id}/dismiss`, { method: 'POST' });
                      setA((v) => v.filter((y) => y.id !== x.id));
                    }}
                  >
                    Dismiss
                  </Button>
                )}
              </Stack>
            </Box>
          ))
        ) : (
          <Box data-testid="home-actions-empty-row" sx={dashboardRowSx}>
            <Typography color="text.secondary">No actions waiting.</Typography>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
function News() {
  return (
    <Paper component="section" aria-labelledby="home-news-title" sx={{ p: 2, height: '100%' }}>
      <Typography id="home-news-title" variant="h5" sx={dashboardTitleSx}>
        News
      </Typography>
      <Stack spacing={1} mt={1.5}>
        <Box component="article" data-testid="home-news-row" sx={dashboardRowSx}>
          <Typography fontWeight={700}>Wally Analyzer updates</Typography>
          <Typography variant="body2" color="text.secondary">
            Product updates and report announcements will appear here.
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
function AccountOverview() {
  const [credits, setCredits] = useState<number>();
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  useEffect(() => {
    void request<CreditsResponse>('/v1/me/credits')
      .then((value) => setCredits(value.balance))
      .catch(() => setCredits(undefined));
    void request<SampleSummary[]>('/v1/samples')
      .then(setSamples)
      .catch(() => setSamples([]));
  }, []);
  const verifiedSamples = samples.filter((sample) => sample.uploadState === 'uploaded').length;
  const nav = useNavigate();
  return (
    <Paper component="section" aria-labelledby="home-credits-title" sx={{ p: 2, height: '100%' }}>
      <Typography id="home-credits-title" variant="h5" sx={dashboardTitleSx}>
        Credits
      </Typography>
      <Grid container spacing={2} mt={0}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Typography color="text.secondary">Current credits</Typography>
          <Typography variant="h4">{credits === undefined ? '—' : credits}</Typography>
          <Button size="small" onClick={() => nav('/credits')}>
            Buy credits
          </Button>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Typography color="text.secondary">Usage history</Typography>
          <Typography variant="h4">{verifiedSamples}</Typography>
          <Typography variant="body2" color="text.secondary">
            Verified samples ready for reporting
          </Typography>
        </Grid>
      </Grid>
    </Paper>
  );
}
export function Home() {
  return (
    <Stack spacing={2}>
      <Grid container spacing={2} data-testid="home-dashboard-grid">
        <Grid size={{ xs: 12, md: 6 }}>
          <Actions />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <News />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <AccountOverview />
        </Grid>
      </Grid>
    </Stack>
  );
}
function Units({ units }: { units: CustomerUnit[] }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Your PSIUs</Typography>
      {units.length ? (
        units.map((u) => (
          <Box key={u.id} py={1}>
            <Typography>
              {u.serialNumber} · firmware UID {u.uid}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {u.status}
              {u.assignedAt ? ` · assigned ${new Date(u.assignedAt).toLocaleDateString()}` : ''}
            </Typography>
          </Box>
        ))
      ) : (
        <Typography color="text.secondary">No PSIUs assigned.</Typography>
      )}
    </Paper>
  );
}
function Account({ me }: { me: MeResponse }) {
  const [o, setO] = useState('');
  const [n, setN] = useState('');
  const [m, setM] = useState('');
  return (
    <Stack spacing={2}>
      <Typography variant="h4">Account</Typography>
      <Paper sx={{ p: 2 }}>
        <Typography>Email: {me.email}</Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          Email changes are unavailable until the approved mutable-email Cognito migration is
          complete.
        </Alert>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Change password</Typography>
        <Stack spacing={1} mt={1}>
          <TextField
            type="password"
            label="Current password"
            value={o}
            onChange={(e) => setO(e.target.value)}
          />
          <TextField
            type="password"
            label="New password"
            value={n}
            onChange={(e) => setN(e.target.value)}
          />
          <Button
            onClick={async () => {
              try {
                await changePassword(o, n);
                setM('Password changed.');
              } catch (e) {
                setM(e instanceof Error ? e.message : 'Failed.');
              }
            }}
          >
            Change password
          </Button>
          {m && <Alert severity="info">{m}</Alert>}
        </Stack>
      </Paper>
      <Units units={me.units} />
    </Stack>
  );
}
function LegacyAdmin() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [units, setUnits] = useState<CustomerUnit[]>([]);
  const [email, setEmail] = useState('');
  const [serial, setSerial] = useState('');
  const [uid, setUid] = useState('');
  const load = () =>
    Promise.all([
      request<CustomerSummary[]>('/v1/admin/customers'),
      request<CustomerUnit[]>('/v1/admin/psiu-units'),
    ]).then(([c, u]) => {
      setCustomers(c);
      setUnits(u);
    });
  useEffect(() => {
    void load();
  }, []);
  return (
    <Stack spacing={3}>
      <Typography variant="h4">Administration</Typography>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Customers</Typography>
        <Stack direction="row" spacing={1} mt={1}>
          <TextField
            label="Customer email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button
            onClick={async () => {
              await request('/v1/admin/customers', {
                method: 'POST',
                body: JSON.stringify({ email }),
              });
              setEmail('');
              await load();
            }}
          >
            Create customer
          </Button>
        </Stack>
        {customers.map((c) => (
          <Box key={c.id} py={1}>
            {c.email} · {c.lifecycle}{' '}
            <Button
              size="small"
              onClick={async () => {
                await request(`/v1/admin/customers/${c.id}/invite`, { method: 'POST' });
                await load();
              }}
            >
              Invite
            </Button>
            <Button
              size="small"
              onClick={async () => {
                await request(`/v1/admin/customers/${c.id}/reset-password`, { method: 'POST' });
              }}
            >
              Reset password
            </Button>
            <Button
              size="small"
              onClick={async () => {
                await request(
                  `/v1/admin/customers/${c.id}/${c.lifecycle === 'suspended' ? 'restore' : 'suspend'}`,
                  { method: 'POST' },
                );
                await load();
              }}
            >
              {c.lifecycle === 'suspended' ? 'Restore' : 'Disable'}
            </Button>
            <Button
              size="small"
              onClick={async () => {
                await request(`/v1/admin/customers/${c.id}`, { method: 'DELETE' });
                await load();
              }}
            >
              Archive
            </Button>
          </Box>
        ))}
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">PSIU inventory</Typography>
        <Stack direction="row" spacing={1} mt={1}>
          <TextField
            label="Serial number"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
          />
          <TextField
            label="Firmware /status UID"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
          />
          <Button
            onClick={async () => {
              await request('/v1/admin/psiu-units', {
                method: 'POST',
                body: JSON.stringify({ serialNumber: serial, uid }),
              });
              setSerial('');
              setUid('');
              await load();
            }}
          >
            Add PSIU
          </Button>
        </Stack>
        {units.map((u) => (
          <Box key={u.id} py={1}>
            {u.serialNumber} · {u.uid} · {u.status}
            {u.unavailableAt && ` · unavailable ${new Date(u.unavailableAt).toLocaleString()}`}{' '}
            {u.status !== 'unavailable' && (
              <>
                <Button
                  size="small"
                  onClick={async () => {
                    await request(
                      `/v1/admin/psiu-units/${u.id}/${u.status === 'enabled' ? 'disable' : 'enable'}`,
                      { method: 'POST' },
                    );
                    await load();
                  }}
                >
                  {u.status === 'enabled' ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Mark ${u.serialNumber} unavailable? Existing history is retained and new uploads are blocked.`,
                      )
                    )
                      return;
                    await request(`/v1/admin/psiu-units/${u.id}/unavailable`, { method: 'POST' });
                    await load();
                  }}
                >
                  Mark unavailable
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    const customerId = window.prompt('Customer ID');
                    if (customerId) {
                      await request(`/v1/admin/psiu-units/${u.id}/assign`, {
                        method: 'POST',
                        body: JSON.stringify({ customerId }),
                      });
                      await load();
                    }
                  }}
                >
                  Assign
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    await request(`/v1/admin/psiu-units/${u.id}/deassign`, { method: 'POST' });
                    await load();
                  }}
                >
                  Deassign
                </Button>
              </>
            )}
            <Button
              size="small"
              color="error"
              onClick={async () => {
                if (
                  !window.confirm(
                    `Hard delete ${u.serialNumber}? This only succeeds when it has no assignment or sample history.`,
                  )
                )
                  return;
                try {
                  await request(`/v1/admin/psiu-units/${u.id}`, { method: 'DELETE' });
                  await load();
                } catch (error) {
                  window.alert(
                    error instanceof Error
                      ? error.message
                      : 'Hard delete failed. Mark unavailable to retain history.',
                  );
                }
              }}
            >
              Hard delete
            </Button>
          </Box>
        ))}
      </Paper>
    </Stack>
  );
}
export const accountNavigationItems = [
  { path: '/profile', label: 'Profile' },
  { path: '/account', label: 'Account settings' },
] as const;
function Shell() {
  const [me, setMe] = useState<MeResponse>();
  const [systems, setSystems] = useState<UserSystem[]>([]);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const [mobileAnchor, setMobileAnchor] = useState<HTMLElement | null>(null);
  const nav = useNavigate();
  const load = async () => {
    try {
      const next = await request<MeResponse>('/v1/me');
      setMe(next);
      void request<UserSystem[]>('/v1/me/systems')
        .then(setSystems)
        .catch(() => setSystems([]));
    } catch {
      setMe(undefined);
      throw Error('Your account is not ready. Confirm your email to continue.');
    }
  };
  useEffect(() => {
    void load().catch(() => {});
  }, []);
  if (!me) return <Login done={load} />;
  const navigateMobile = (path: string) => {
    setMobileAnchor(null);
    nav(path);
  };
  const navItems = [
    { path: '/', label: 'Home' },
    { path: '/systems', label: 'Systems' },
    { path: '/credits', label: 'Credits' },
    { path: '/reports', label: 'Reports' },
    { path: '/controller', label: 'Sample Capture' },
    ...(me.role === 'admin' ? [{ path: '/admin', label: 'Administrator' }] : []),
    ...accountNavigationItems,
  ];
  return (
    <>
      <AppBar position="static" color="transparent">
        <Container maxWidth="lg">
          <Toolbar disableGutters>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              Wally Analyzer
            </Typography>
            <Box sx={{ display: { xs: 'none', md: 'flex' } }}>
              <Button onClick={() => nav('/')}>Home</Button>
              <Button
                aria-controls={accountAnchor ? 'account-menu' : undefined}
                aria-haspopup="menu"
                aria-expanded={Boolean(accountAnchor)}
                onClick={(event) => setAccountAnchor(event.currentTarget)}
              >
                Account
              </Button>
              <Menu
                id="account-menu"
                anchorEl={accountAnchor}
                open={Boolean(accountAnchor)}
                onClose={() => setAccountAnchor(null)}
                MenuListProps={{ 'aria-label': 'Account navigation' }}
              >
                {accountNavigationItems.map((item) => (
                  <MenuItem
                    key={item.path}
                    onClick={() => {
                      setAccountAnchor(null);
                      nav(item.path);
                    }}
                  >
                    {item.label}
                  </MenuItem>
                ))}
              </Menu>
              <Button onClick={() => nav('/systems')}>Systems</Button>
              <Button onClick={() => nav('/credits')}>Credits</Button>
              <Button onClick={() => nav('/reports')}>Reports</Button>
              <Button onClick={() => nav('/controller')}>Sample Capture</Button>
              {me.role === 'admin' && <Button onClick={() => nav('/admin')}>Administrator</Button>}
              <Button
                onClick={() => {
                  logout();
                  setMe(undefined);
                }}
              >
                Logout
              </Button>
            </Box>
            <Box sx={{ display: { xs: 'block', md: 'none' } }}>
              <Button
                aria-label="Open navigation menu"
                aria-controls={mobileAnchor ? 'mobile-navigation-menu' : undefined}
                aria-haspopup="menu"
                aria-expanded={Boolean(mobileAnchor)}
                onClick={(event) => setMobileAnchor(event.currentTarget)}
              >
                Menu
              </Button>
              <Menu
                id="mobile-navigation-menu"
                anchorEl={mobileAnchor}
                open={Boolean(mobileAnchor)}
                onClose={() => setMobileAnchor(null)}
                MenuListProps={{ 'aria-label': 'Mobile navigation' }}
              >
                {navItems.map((item) => (
                  <MenuItem key={item.path} onClick={() => navigateMobile(item.path)}>
                    {item.label}
                  </MenuItem>
                ))}
                <MenuItem
                  onClick={() => {
                    setMobileAnchor(null);
                    logout();
                    setMe(undefined);
                  }}
                >
                  Logout
                </MenuItem>
              </Menu>
            </Box>
          </Toolbar>
        </Container>
      </AppBar>
      <Box component="main" py={5}>
        <Container maxWidth="lg">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route
              path="/controller"
              element={<ControllerPage units={me.units} systems={systems} />}
            />
            <Route path="/account" element={<Account me={me} />} />
            <Route path="/profile" element={<ProfilePage me={me} onSaved={load} />} />
            <Route path="/systems" element={<SystemsPage />} />
            <Route path="/credits" element={<CreditsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route
              path="/admin/*"
              element={me.role === 'admin' ? <AdminConsole /> : <Navigate to="/" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Container>
      </Box>
    </>
  );
}
export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
