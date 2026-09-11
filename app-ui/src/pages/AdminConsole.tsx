import { Alert, Box, Button, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { request } from '../api.js';
import { hardDeletePsiuRequest } from './adminActions.js';
import { createPsuClient } from '../features/controller/psiuClient.js';
import { WallySelect } from '../designSystemSelect.js';
type User = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  lifecycle: string;
  balance: number;
  createdAt?: string;
  lastActiveAt?: string;
  units?: Unit[];
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressRegion?: string;
  addressPostalCode?: string;
  addressCountryCode?: string;
};
type Unit = {
  id: string;
  serialNumber: string;
  uid: string;
  status: 'enabled' | 'disabled' | 'unavailable';
  assignedAt?: string;
  unavailableAt?: string;
  customer?: User;
};
type Page<T> = { items: T[]; limit: number; offset?: number; nextCursor?: string };
type TypeaheadProps={label:string;onSelect:(user:User)=>void;selected?:User;};
const name = (u: Pick<User, 'email' | 'firstName' | 'lastName'>) =>
  `${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email} · ${u.email}`;
const err = (e: unknown) => (e instanceof Error ? e.message : 'Request failed.');
export function AdminConsole() {
  const l = useLocation(),
    n = useNavigate(),
    parts = l.pathname.split('/'),
    s = parts[2] || 'psiu';
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
      <Paper component="nav" sx={{ p: 1, minWidth: 220, height: 'fit-content' }}>
        <Typography variant="h6" sx={{ p: 1 }}>
          Administration
        </Typography>
        {[
          ['psiu', 'PSIU Management'],
          ['users', 'User Management'],
          ['credits', 'Credits'],
          ['samples', 'Samples'],
          ['reports', 'Reports'],
        ].map(([id, text]) => (
          <Button
            key={id}
            fullWidth
            sx={{ justifyContent: 'flex-start' }}
            variant={s === id ? 'contained' : 'text'}
            onClick={() => n(`/admin/${id}`)}
          >
            {text}
          </Button>
        ))}
      </Paper>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {s === 'psiu' ? (
          <Psiu />
        ) : s === 'users' ? (
          <Users userId={parts[3]} />
        ) : s === 'credits' ? (
          <Credits />
        ) : s === 'samples' ? (
          <Samples />
        ) : (
          <Reports />
        )}
      </Box>
    </Stack>
  );
}
function directoryUrl(base: string, q: string, filters: Record<string, string>, cursor?: string) {
  const x = new URLSearchParams({ limit: '25', ...filters });
  if (q.trim()) x.set('q', q.trim());
  if (cursor) x.set('cursor', cursor);
  return `${base}?${x}`;
}
function directoryPath(base: string, q: string, filters: Record<string, string>, cursor?: string) {
  const x = new URLSearchParams();
  if (q.trim()) x.set('q', q.trim());
  for (const [key, value] of Object.entries(filters)) if (value) x.set(key, value);
  if (cursor) x.set('cursor', cursor);
  const search = x.toString();
  return search ? `${base}?${search}` : base;
}
function UserTypeahead({label,onSelect,selected}:TypeaheadProps){const[q,setQ]=useState(''),[items,setItems]=useState<User[]>([]),[loading,setLoading]=useState(false),[active,setActive]=useState(0),version=useRef(0);useEffect(()=>{if(q.trim().length<2){setItems([]);return;}const current=++version.current;setLoading(true);const t=setTimeout(()=>void request<User[]>(`/v1/admin/users/typeahead?q=${encodeURIComponent(q)}`).then(x=>{if(current===version.current){setItems(x);setActive(0);}}).finally(()=>{if(current===version.current)setLoading(false)}),250);return()=>clearTimeout(t)},[q]);if(selected)return <Stack direction="row" spacing={1} alignItems="center"><Typography>{name(selected)}</Typography><Button onClick={()=>{setQ('');setItems([]);onSelect(undefined as never)}}>Clear</Button></Stack>;return <Box><TextField label={label} value={q} onChange={e=>setQ(e.target.value)} helperText={q.length===1?'Enter at least 2 characters.':'Search begins at 2 characters.'} inputProps={{role:'combobox','aria-expanded':items.length>0,'aria-controls':`${label}-options`}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setActive(x=>Math.min(x+1,items.length-1))}if(e.key==='ArrowUp'){e.preventDefault();setActive(x=>Math.max(x-1,0))}if(e.key==='Enter'&&items[active])onSelect(items[active]!);}}/>{loading&&<Typography variant="body2">Searching…</Typography>}{q.length>=2&&!loading&&items.length===0&&<Typography variant="body2">No users found.</Typography>}{items.length>0&&<Paper id={`${label}-options`} role="listbox">{items.map((x,i)=><Button key={x.id} role="option" aria-selected={i===active} fullWidth sx={{justifyContent:'flex-start'}} onClick={()=>onSelect(x)}>{name(x)}</Button>)}</Paper>}</Box>}
function Psiu() {
  const l = useLocation(),
    n = useNavigate(),
    initial = new URLSearchParams(l.search);
  const [page, setPage] = useState<Page<Unit>>({ items: [], limit: 25 }),
    [q, setQ] = useState(initial.get('q') ?? ''),
    [assignQ, setAssignQ] = useState(''),
    [status, setStatus] = useState(initial.get('status') ?? ''),
    [assignment, setAssignment] = useState(initial.get('assignment') ?? ''),
    [cursor, setCursor] = useState(initial.get('cursor') ?? undefined),
    [history, setHistory] = useState<string[]>(() => {
      const value = initial.get('cursor');
      return value ? [value] : [];
    }),
    [people, setPeople] = useState<User[]>([]),
    [selected, setSelected] = useState<string>(),
    [owner, setOwner] = useState<User>(),
    [serial, setSerial] = useState(''),
    [uid, setUid] = useState(''),
    [scanning, setScanning] = useState(false),
    [m, setM] = useState(''),
    [loading, setLoading] = useState(false);
  const requestVersion = useRef(0),
    syncedSearch = useRef(l.search);
  const filters = { status, assignment, customerId: owner?.id ?? '' };
  const navigateDirectory = (
    nextQ: string,
    nextFilters: typeof filters,
    nextCursor?: string,
    replace = true,
  ) => {
    const path = directoryPath('/admin/psiu', nextQ, nextFilters, nextCursor);
    syncedSearch.current = path.slice('/admin/psiu'.length);
    n(path, { replace });
  };
  useEffect(() => {
    if (l.search === syncedSearch.current) return;
    const values = new URLSearchParams(l.search),
      nextCursor = values.get('cursor') ?? undefined;
    syncedSearch.current = l.search;
    setQ(values.get('q') ?? '');
    setStatus(values.get('status') ?? '');
    setAssignment(values.get('assignment') ?? '');
    setCursor(nextCursor);
    setHistory(nextCursor ? [nextCursor] : []);
  }, [l.search]);
  useEffect(() => {
    if (q.trim().length === 1) return;
    const version = ++requestVersion.current;
    setLoading(true);
    const t = setTimeout(
      () =>
        void request<Page<Unit>>(directoryUrl('/v1/admin/psiu-units', q, filters, cursor))
          .then((result) => {
            if (version === requestVersion.current) setPage(result);
          })
          .catch((error) => {
            if (version === requestVersion.current) setM(err(error));
          })
          .finally(() => {
            if (version === requestVersion.current) setLoading(false);
          }),
      250,
    );
    return () => clearTimeout(t);
  }, [q, status, assignment, cursor]);
  useEffect(() => {
    if (!selected || assignQ.trim().length < 2) {
      setPeople([]);
      return;
    }
    const t = setTimeout(
      () =>
        void request<User[]>(`/v1/admin/users/typeahead?q=${encodeURIComponent(assignQ)}`)
          .then(setPeople)
          .catch((error) => setM(err(error))),
      250,
    );
    return () => clearTimeout(t);
  }, [assignQ, selected]);
  const updateFilters = (nextQ = q, nextStatus = status, nextAssignment = assignment) => {
    setQ(nextQ);
    setStatus(nextStatus);
    setAssignment(nextAssignment);
    setCursor(undefined);
    setHistory([]);
    navigateDirectory(nextQ, { status: nextStatus, assignment: nextAssignment, customerId: owner?.id ?? '' });
  };
  const go = (nextCursor: string | undefined, nextHistory: string[]) => {
    setCursor(nextCursor);
    setHistory(nextHistory);
    navigateDirectory(q, filters, nextCursor, false);
  };
  const refresh = () => {
    const version = ++requestVersion.current;
    setLoading(true);
    void request<Page<Unit>>(directoryUrl('/v1/admin/psiu-units', q, filters, cursor))
      .then(setPage)
      .catch((error) => setM(err(error)))
      .finally(() => setLoading(false));
  };
  const post = async (path: string, body?: unknown) => {
    try {
      await request(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setPeople([]);
      setAssignQ('');
      setSelected(undefined);
      refresh();
    } catch (error) {
      setM(err(error));
    }
  };
  const scanUid = async () => {
    setScanning(true);
    setM('');
    try {
      setUid(await createPsuClient().scanUid());
    } catch {
      setM('PSIU UID scan failed. Check power, network, and psiu.local.');
    } finally {
      setScanning(false);
    }
  };
  const markUnavailable = (unit: Unit) => {
    if (
      window.confirm(
        `Mark ${unit.serialNumber} unavailable? This blocks future capture and preserves existing sample provenance.`,
      )
    )
      void post(`/v1/admin/psiu-units/${unit.id}/unavailable`);
  };
  return (
    <Stack spacing={2}>
      <Typography variant="h4">PSIU Management</Typography>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography variant="h6">Local PSIU inventory scan</Typography>
          <Typography variant="body2" color="text.secondary">
            Reads only the immutable UID from psiu.local. Add the scanned UID to inventory with a
            serial number.
          </Typography>
          <Button sx={{ alignSelf: 'start' }} onClick={() => void scanUid()} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan PSIU UID'}
          </Button>
        </Stack>
      </Paper>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <TextField
          label="Serial number"
          value={serial}
          onChange={(event) => setSerial(event.target.value)}
        />
        <TextField
          label="Firmware UID"
          value={uid}
          onChange={(event) => setUid(event.target.value)}
        />
        <Button
          disabled={!serial || !uid}
          onClick={() => void post('/v1/admin/psiu-units', { serialNumber: serial, uid })}
        >
          Add PSIU
        </Button>
      </Stack>
      <UserTypeahead label="Filter by owner" selected={owner} onSelect={(person)=>{setOwner(person);setCursor(undefined);setHistory([]);}}/>
      <TextField
        label="Search serial or UID"
        value={q}
        onChange={(event) => updateFilters(event.target.value)}
        helperText={
          q.trim().length === 1 ? 'Enter at least 2 characters.' : 'Search begins at 2 characters.'
        }
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <WallySelect
          label="Status"
          value={status}
          onChange={(value) => updateFilters(q, value, assignment)}
          minWidth={170}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'enabled', label: 'Enabled' },
            { value: 'disabled', label: 'Disabled' },
            { value: 'unavailable', label: 'Unavailable' },
          ]}
        />
        <WallySelect
          label="Assignment"
          value={assignment}
          onChange={(value) => updateFilters(q, status, value)}
          minWidth={170}
          options={[
            { value: '', label: 'All assignments' },
            { value: 'assigned', label: 'Assigned' },
            { value: 'unassigned', label: 'Unassigned' },
          ]}
        />
      </Stack>
      {m && <Alert severity="error">{m}</Alert>}
      {page.items.map((unit) => (
        <Paper
          key={unit.id}
          sx={{
            p: 2,
            borderLeft: 6,
            borderColor:
              unit.status === 'enabled'
                ? unit.customer
                  ? 'success.main'
                  : 'transparent'
                : 'error.main',
          }}
        >
          <Typography>
            {unit.serialNumber} · {unit.uid} · {unit.status}
          </Typography>
          {unit.customer && (
            <Button
              sx={{ p: 0, textTransform: 'none' }}
              onClick={() =>
                n(
                  `/admin/users/${unit.customer!.id}?returnTo=${encodeURIComponent(directoryPath('/admin/psiu', q, filters, cursor))}`,
                )
              }
            >
              Owner: {name(unit.customer)}
            </Button>
          )}
          {unit.status === 'unavailable' ? (
            <Typography variant="body2">
              Unavailable: provenance preserved; no changes allowed.
            </Typography>
          ) : (
            <>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  onClick={() => {
                    const action = unit.status === 'enabled' ? 'disable' : 'enable';
                    if (
                      action === 'disable' &&
                      !window.confirm(
                        `Disable ${unit.serialNumber}? New captures will be blocked; existing sample provenance remains.`,
                      )
                    )
                      return;
                    void post(`/v1/admin/psiu-units/${unit.id}/${action}`);
                  }}
                >
                  {unit.status === 'enabled' ? 'Disable capture' : 'Enable'}
                </Button>
                <Button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Deassign ${unit.serialNumber}? Capture will be blocked; existing provenance remains.`,
                      )
                    )
                      void post(`/v1/admin/psiu-units/${unit.id}/deassign`);
                  }}
                  disabled={!unit.customer}
                >
                  Deassign
                </Button>
                <Button color="warning" onClick={() => markUnavailable(unit)}>
                  Mark unavailable
                </Button>
                {!unit.customer && (
                  <Button onClick={() => setSelected(selected === unit.id ? undefined : unit.id)}>
                    Assign user
                  </Button>
                )}
                {selected === unit.id && !unit.customer && (
                  <UserTypeahead label="Find user" onSelect={(person)=>void post(`/v1/admin/psiu-units/${unit.id}/assign`,{customerId:person.id})}/>
                )}
              </Stack>
              <Button
                color="error"
                onClick={async () => {
                  if (window.confirm(`Hard delete ${unit.serialNumber}?`))
                    try {
                      const action = hardDeletePsiuRequest(unit.id);
                      await request(action.path, { method: action.method });
                      refresh();
                    } catch (error) {
                      setM(err(error));
                    }
                }}
              >
                Hard delete
              </Button>
            </>
          )}
        </Paper>
      ))}
      <Stack direction="row">
        <Button
          disabled={!history.length || loading}
          onClick={() => {
            const nextHistory = history.slice(0, -1);
            go(nextHistory.at(-1), nextHistory);
          }}
        >
          Previous
        </Button>
        <Button
          disabled={!page.nextCursor || loading}
          onClick={() => {
            const nextHistory = [...history, page.nextCursor!];
            go(page.nextCursor, nextHistory);
          }}
        >
          Next
        </Button>
      </Stack>
    </Stack>
  );
}
function Users({ userId }: { userId?: string }) {
  const l = useLocation(),
    n = useNavigate(),
    initial = new URLSearchParams(l.search);
  const [page, setPage] = useState<Page<User>>({ items: [], limit: 25 }),
    [q, setQ] = useState(initial.get('q') ?? ''),
    [lifecycle, setLifecycle] = useState(initial.get('lifecycle') ?? ''),
    [cursor, setCursor] = useState(initial.get('cursor') ?? undefined),
    [history, setHistory] = useState<string[]>(() => {
      const value = initial.get('cursor');
      return value ? [value] : [];
    }),
    [email, setEmail] = useState(''),
    [creating, setCreating] = useState(false),
    [m, setM] = useState(''),
    [loading, setLoading] = useState(false);
  const requestVersion = useRef(0),
    syncedSearch = useRef(l.search),
    filters = { lifecycle };
  const navigateDirectory = (
    nextQ: string,
    nextLifecycle: string,
    nextCursor?: string,
    replace = true,
  ) => {
    const path = directoryPath('/admin/users', nextQ, { lifecycle: nextLifecycle }, nextCursor);
    syncedSearch.current = path.slice('/admin/users'.length);
    n(path, { replace });
  };
  useEffect(() => {
    if (l.search === syncedSearch.current) return;
    const values = new URLSearchParams(l.search),
      nextCursor = values.get('cursor') ?? undefined;
    syncedSearch.current = l.search;
    setQ(values.get('q') ?? '');
    setLifecycle(values.get('lifecycle') ?? '');
    setCursor(nextCursor);
    setHistory(nextCursor ? [nextCursor] : []);
  }, [l.search]);
  useEffect(() => {
    if (userId || q.trim().length === 1) return;
    const version = ++requestVersion.current;
    setLoading(true);
    const t = setTimeout(
      () =>
        void request<Page<User>>(directoryUrl('/v1/admin/users', q, filters, cursor))
          .then((result) => {
            if (version === requestVersion.current) setPage(result);
          })
          .catch((error) => {
            if (version === requestVersion.current) setM(err(error));
          })
          .finally(() => {
            if (version === requestVersion.current) setLoading(false);
          }),
      250,
    );
    return () => clearTimeout(t);
  }, [q, lifecycle, cursor, userId]);
  const updateFilters = (nextQ = q, nextLifecycle = lifecycle) => {
    setQ(nextQ);
    setLifecycle(nextLifecycle);
    setCursor(undefined);
    setHistory([]);
    navigateDirectory(nextQ, nextLifecycle);
  };
  const go = (nextCursor: string | undefined, nextHistory: string[]) => {
    setCursor(nextCursor);
    setHistory(nextHistory);
    navigateDirectory(q, lifecycle, nextCursor, false);
  };
  if (userId) {
    const returnTo = new URLSearchParams(l.search).get('returnTo');
    return (
      <UserDetail
        id={userId}
        onBack={() => n(returnTo ?? directoryPath('/admin/users', q, filters, cursor))}
      />
    );
  }
  const returnTo = directoryPath('/admin/users', q, filters, cursor);
  return (
    <Stack spacing={2}>
      <Typography variant="h4">User Management</Typography>
      <Button variant="contained" sx={{ alignSelf: 'start' }} onClick={() => setCreating(true)}>
        Create customer
      </Button>
      {creating && (
        <Stack direction="row" spacing={1}>
          <TextField
            label="Customer email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            disabled={!email}
            onClick={async () => {
              try {
                const created = await request<User>('/v1/admin/customers', {
                  method: 'POST',
                  body: JSON.stringify({ email }),
                });
                setEmail('');
                setCreating(false);
                n(`/admin/users/${created.id}?returnTo=${encodeURIComponent(returnTo)}`);
              } catch (error) {
                setM(err(error));
              }
            }}
          >
            Create
          </Button>
          <Button onClick={() => setCreating(false)}>Cancel</Button>
        </Stack>
      )}
      <UserTypeahead label="Find user" onSelect={(person)=>n(`/admin/users/${person.id}?returnTo=${encodeURIComponent(returnTo)}`)}/>
      <TextField
        label="Search name, email, or active PSIU serial"
        value={q}
        onChange={(event) => updateFilters(event.target.value)}
        helperText={
          q.trim().length === 1 ? 'Enter at least 2 characters.' : 'Search begins at 2 characters.'
        }
      />
      <WallySelect
        label="Lifecycle"
        value={lifecycle}
        onChange={(value) => updateFilters(q, value)}
        minWidth={180}
        options={[
          { value: '', label: 'All lifecycles' },
          ...['draft', 'ready', 'invited', 'active', 'suspended', 'cancelled'].map((value) => ({
            value,
            label: value,
          })),
        ]}
      />
      {m && <Alert severity="error">{m}</Alert>}
      {page.items.map((person) => (
        <Paper key={person.id} sx={{ p: 2 }}>
          <Button
            sx={{ p: 0, textTransform: 'none' }}
            onClick={() => n(`/admin/users/${person.id}?returnTo=${encodeURIComponent(returnTo)}`)}
          >
            <Typography>
              {name(person)} · {person.lifecycle} · {person.balance} credits
            </Typography>
          </Button>
        </Paper>
      ))}
      <Stack direction="row">
        <Button
          disabled={!history.length || loading}
          onClick={() => {
            const nextHistory = history.slice(0, -1);
            go(nextHistory.at(-1), nextHistory);
          }}
        >
          Previous
        </Button>
        <Button
          disabled={!page.nextCursor || loading}
          onClick={() => {
            const nextHistory = [...history, page.nextCursor!];
            go(page.nextCursor, nextHistory);
          }}
        >
          Next
        </Button>
      </Stack>
    </Stack>
  );
}
function UserDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [u, setU] = useState<User>(),
    [editing, setEditing] = useState(false),
    [m, setM] = useState('');
  const load = () =>
    void request<User>(`/v1/admin/users/${id}`)
      .then(setU)
      .catch((e) => setM(err(e)));
  useEffect(load, [id]);
  if (!u) return <>{m && <Alert severity="error">{m}</Alert>}</>;
  const save = async () => {
    try {
      setU(
        await request<User>(`/v1/admin/users/${u.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            firstName: u.firstName,
            lastName: u.lastName,
            address: {
              line1: u.addressLine1,
              line2: u.addressLine2,
              city: u.addressCity,
              region: u.addressRegion,
              postalCode: u.addressPostalCode,
              countryCode: u.addressCountryCode,
            },
          }),
        }),
      );
      setEditing(false);
    } catch (e) {
      setM(err(e));
    }
  };
  const customerAction = async (a: string) => {
    try {
      await request(`/v1/admin/customers/${u.id}/${a}`, { method: 'POST' });
      load();
    } catch (e) {
      setM(err(e));
    }
  };
  const unitAction = async (unit: Unit, a: 'disable' | 'deassign' | 'unavailable') => {
    const message =
      a === 'disable'
        ? `Disable ${unit.serialNumber}? New captures will be blocked; existing sample provenance remains.`
        : a === 'deassign'
          ? `Deassign ${unit.serialNumber}? New captures will be blocked; existing sample provenance remains.`
          : `Mark ${unit.serialNumber} unavailable? This blocks future capture and preserves existing sample provenance.`;
    if (!window.confirm(message)) return;
    try {
      await request(`/v1/admin/psiu-units/${unit.id}/${a}`, { method: 'POST' });
      load();
    } catch (e) {
      setM(err(e));
    }
  };
  const fields = [
    'firstName',
    'lastName',
    'addressLine1',
    'addressLine2',
    'addressCity',
    'addressRegion',
    'addressPostalCode',
    'addressCountryCode',
  ] as const;
  return (
    <Stack spacing={2}>
      <Button sx={{ alignSelf: 'start' }} onClick={onBack}>
        Back to users
      </Button>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography variant="h4">User detail</Typography>
          <Typography>
            <strong>Email:</strong> {u.email} (read-only)
          </Typography>
          <Typography>
            <strong>Lifecycle:</strong> {u.lifecycle}
          </Typography>
          {editing
            ? fields.map((k) => (
                <TextField
                  key={k}
                  label={k}
                  value={u[k] ?? ''}
                  onChange={(e) => setU({ ...u, [k]: e.target.value })}
                />
              ))
            : fields.map((k) => (
                <Typography key={k}>
                  <strong>{k}:</strong> {u[k] || 'Not provided'}
                </Typography>
              ))}
          {editing ? (
            <>
              <Button onClick={() => void save()}>Save profile</Button>
              <Button onClick={() => setEditing(false)}>Cancel edit</Button>
            </>
          ) : (
            <Button onClick={() => setEditing(true)}>Edit user</Button>
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {['invited', 'active'].includes(u.lifecycle) && (
              <Button onClick={() => void customerAction('reset-password')}>
                Send password reset
              </Button>
            )}
            <Button
              onClick={() =>
                void customerAction(u.lifecycle === 'suspended' ? 'restore' : 'suspend')
              }
            >
              {u.lifecycle === 'suspended' ? 'Restore' : 'Deactivate'}
            </Button>
          </Stack>
          {m && <Alert severity="error">{m}</Alert>}
        </Stack>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Assigned PSIUs</Typography>
        {u.units?.length ? (
          u.units.map((unit) => (
            <Box key={unit.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Typography>
                {unit.serialNumber} · {unit.status} · assigned{' '}
                {unit.assignedAt ? new Date(unit.assignedAt).toLocaleString() : 'unknown'}
              </Typography>
              {unit.status === 'unavailable' ? (
                <Typography variant="body2">
                  Unavailable: provenance preserved; no changes allowed.
                </Typography>
              ) : (
                <Stack direction="row">
                  <Button
                    disabled={unit.status !== 'enabled'}
                    onClick={() => void unitAction(unit, 'disable')}
                  >
                    Disable capture
                  </Button>
                  <Button onClick={() => void unitAction(unit, 'deassign')}>Deassign</Button>
                  <Button color="warning" onClick={() => void unitAction(unit, 'unavailable')}>
                    Mark unavailable
                  </Button>
                </Stack>
              )}
            </Box>
          ))
        ) : (
          <Typography>No PSIUs assigned.</Typography>
        )}
      </Paper>
    </Stack>
  );
}

function Credits(){const[selected,setSelected]=useState<User>(),[entries,setEntries]=useState<any[]>([]),[balance,setBalance]=useState<number>(),[stats,setStats]=useState<any[]>([]),[delta,setDelta]=useState(''),[note,setNote]=useState(''),[m,setM]=useState('');useEffect(()=>{void request<any[]>('/v1/admin/credits/stats').then(setStats).catch(e=>setM(err(e)))},[]);useEffect(()=>{if(!selected){setEntries([]);setBalance(undefined);return;}void request<any>(`/v1/admin/users/${selected.id}/credits?limit=50`).then(x=>{setEntries(x.items);setBalance(x.balance)}).catch(e=>setM(err(e)))},[selected]);const adjust=async()=>{if(!selected)return;try{await request(`/v1/admin/users/${selected.id}/credits`,{method:'POST',body:JSON.stringify({delta:Number(delta),note,kind:Number(delta)>0?'grant':'administrative_adjustment'})});setDelta('');setNote('');const x=await request<any>(`/v1/admin/users/${selected.id}/credits?limit=50`);setEntries(x.items);setBalance(x.balance)}catch(e){setM(err(e))}};return <Stack spacing={2}><Typography variant="h4">Credits</Typography>{stats.length>0&&<Paper sx={{p:1}}><Typography variant="subtitle2">Credit activity</Typography>{stats.map((x,i)=><Typography key={i} variant="body2">{String(x.day).slice(0,10)} · {x.kind} · {x.delta} credits</Typography>)}</Paper>}<UserTypeahead label="Find user" selected={selected} onSelect={setSelected}/>{selected&&<Typography>Current balance for {name(selected)}: {balance===undefined?'Loading…':balance}</Typography>}<TextField label="Credit amount (+/-)" value={delta} onChange={e=>setDelta(e.target.value)}/><TextField required label="Adjustment note" value={note} onChange={e=>setNote(e.target.value)}/><Button disabled={!selected||!note||!delta} onClick={()=>void adjust()}>Apply adjustment</Button>{m&&<Alert severity="error">{m}</Alert>}{entries.map(x=><Paper key={x.id} sx={{p:1}}>{x.created_at} · {x.kind} · {x.delta} · balance {x.balance_after} · {x.note}</Paper>)}</Stack>}
function Samples(){const[page,setPage]=useState<Page<any>>({items:[],limit:25,offset:0}),[state,setState]=useState(''),[source,setSource]=useState(''),[q,setQ]=useState(''),[owner,setOwner]=useState<User>(),[stats,setStats]=useState<any>(),[m,setM]=useState('');const load=(offset=0)=>{const x=new URLSearchParams({limit:'25',offset:String(offset),state,source,q});if(owner)x.set('ownerId',owner.id);void Promise.all([request<Page<any>>(`/v1/admin/samples?${x}`),request<any>('/v1/admin/samples/stats')]).then(([p,st])=>{setPage(p);setStats(st)}).catch(e=>setM(err(e)))};useEffect(()=>{load()},[]);return <Stack spacing={2}><Typography variant="h4">Samples</Typography><Typography>{stats&&`Total ${stats.total} · 7 days ${stats.d7} · 30 days ${stats.d30} · YTD ${stats.ytd}`}</Typography><UserTypeahead label="Filter by user" selected={owner} onSelect={setOwner}/><TextField label="Search PSIU serial or UID" value={q} onChange={e=>setQ(e.target.value)} helperText={q.length===1?'Enter at least 2 characters.':'Search begins at 2 characters.'}/><Stack direction="row"><TextField label="State" value={state} onChange={e=>setState(e.target.value)}/><TextField label="Source" value={source} onChange={e=>setSource(e.target.value)}/><Button onClick={()=>load()}>Filter</Button></Stack>{m&&<Alert severity="error">{m}</Alert>}{page.items.map(x=><Paper key={x.id} sx={{p:1}}>{x.email} · {x.serial_number} · {x.source} · {x.upload_state} · {x.recorded_at}</Paper>)}<Stack direction="row"><Button disabled={!(page.offset??0)} onClick={()=>load(Math.max(0,(page.offset??0)-page.limit))}>Previous</Button><Button disabled={page.items.length<page.limit} onClick={()=>load((page.offset??0)+page.limit)}>Next</Button></Stack></Stack>}
function Reports(){const n=useNavigate(),[page,setPage]=useState<Page<any>>({items:[],limit:25,offset:0}),[q,setQ]=useState(''),[owner,setOwner]=useState<User>(),[type,setType]=useState(''),[status,setStatus]=useState(''),[m,setM]=useState('');const load=(offset=0)=>{const x=new URLSearchParams({limit:'25',offset:String(offset),q,type,status});if(owner)x.set('ownerId',owner.id);void request<Page<any>>(`/v1/admin/reports?${x}`).then(setPage).catch(e=>setM(err(e)))};useEffect(()=>{load()},[]);const returnTo=()=>`/admin/reports?${new URLSearchParams({q,type,status,...(owner?{ownerId:owner.id}:{})})}`;return <Stack spacing={2}><Typography variant="h4">Reports</Typography><UserTypeahead label="Filter by user" selected={owner} onSelect={setOwner}/><TextField label="Search system information" value={q} onChange={e=>setQ(e.target.value)} helperText={q.length===1?'Enter at least 2 characters.':'Search begins at 2 characters.'}/><Stack direction="row" spacing={1}><TextField label="Report type" value={type} onChange={e=>setType(e.target.value)}/><TextField label="Status" value={status} onChange={e=>setStatus(e.target.value)}/><Button onClick={()=>load()}>Filter</Button></Stack>{m&&<Alert severity="error">{m}</Alert>}{page.items.map(x=><Paper key={x.id} sx={{p:2}}><Typography>{x.reportName} · {x.status}</Typography><Button sx={{p:0,textTransform:'none'}} onClick={()=>n(`/admin/users/${x.owner.id}?returnTo=${encodeURIComponent(returnTo())}`)}>{name(x.owner)}</Button><Typography variant="body2">{x.systemName} · {x.presetName} v{x.presetVersion} · {new Date(x.createdAt).toLocaleString()}</Typography></Paper>)}<Stack direction="row"><Button disabled={!(page.offset??0)} onClick={()=>load(Math.max(0,(page.offset??0)-page.limit))}>Previous</Button><Button disabled={page.items.length<page.limit} onClick={()=>load((page.offset??0)+page.limit)}>Next</Button></Stack></Stack>}
