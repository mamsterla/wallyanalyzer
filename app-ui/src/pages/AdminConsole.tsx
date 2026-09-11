import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from '@mui/material';
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
  created_at?: string;
  createdAt?: string;
  last_active_at?: string;
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
type Page<T> = { items: T[]; limit: number; offset?: number; hasNext?: boolean };
type TypeaheadProps = { label: string; onSelect: (user: User) => void; selected?: User };
const name = (u: Pick<User, 'email' | 'firstName' | 'lastName'>) =>
  `${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email} · ${u.email}`;
const err = (e: unknown) => (e instanceof Error ? e.message : 'Request failed.');
const adminUser = (value: any): User => ({
  ...value,
  firstName: value.firstName ?? value.first_name,
  lastName: value.lastName ?? value.last_name,
  createdAt: value.createdAt ?? value.created_at,
  lastActiveAt: value.lastActiveAt ?? value.last_active_at,
  addressLine1: value.addressLine1 ?? value.address_line1,
  addressLine2: value.addressLine2 ?? value.address_line2,
  addressCity: value.addressCity ?? value.address_city,
  addressRegion: value.addressRegion ?? value.address_region,
  addressPostalCode: value.addressPostalCode ?? value.address_postal_code,
  addressCountryCode: value.addressCountryCode ?? value.address_country_code,
});
const validReturnTo = (value: string | null) =>
  value?.startsWith('/admin/') ? value : '/admin/users';
const labels: Record<string, string> = {
  psiu: 'PSIU Management',
  users: 'User Management',
  credits: 'Credits',
  samples: 'Samples',
  reports: 'Reports',
};
export function AdminConsole() {
  const l = useLocation(),
    n = useNavigate(),
    parts = l.pathname.split('/'),
    section = parts[2] || 'psiu';
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      <Paper
        component="nav"
        aria-label="Administrator sections"
        sx={{
          p: 1,
          width: { md: 72 },
          minWidth: { md: 72 },
          '&:hover,&:focus-within': { width: { md: 208 } },
          overflow: 'hidden',
          transition: 'width 160ms',
          height: 'fit-content',
        }}
      >
        <Typography variant="subtitle1" sx={{ p: 1, whiteSpace: 'nowrap' }}>
          Admin
        </Typography>
        {Object.entries(labels).map(([id, text]) => (
          <Button
            key={id}
            fullWidth
            aria-current={section === id ? 'page' : undefined}
            sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}
            variant={section === id ? 'contained' : 'text'}
            onClick={() => n(`/admin/${id}`)}
          >
            {text}
          </Button>
        ))}
      </Paper>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {section === 'psiu' ? (
          <Psiu />
        ) : section === 'users' ? (
          <Users userId={parts[3]} />
        ) : section === 'credits' ? (
          <Credits />
        ) : section === 'samples' ? (
          <Samples />
        ) : (
          <Reports />
        )}
      </Box>
    </Stack>
  );
}
function params(values: Record<string, string | number | undefined>) {
  const x = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (v !== undefined && v !== '') x.set(k, String(v));
  });
  return x.toString();
}
function TableView({
  label,
  columns,
  items,
  sortBy,
  sortDirection,
  onSort,
}: {
  label: string;
  columns: Array<{
    id: string;
    label: string;
    sortable?: boolean;
    cell: (x: any) => React.ReactNode;
  }>;
  items: any[];
  sortBy: string;
  sortDirection: 'asc' | 'desc';
  onSort: (id: string) => void;
}) {
  return (
    <TableContainer component={Paper} sx={{ width: '100%', overflowX: 'auto' }}>
      <Table size="small" stickyHeader aria-label={label} sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell
                key={c.id}
                sortDirection={
                  c.sortable === false ? false : sortBy === c.id ? sortDirection : false
                }
              >
                {c.sortable === false ? (
                  <Typography variant="body2">{c.label}</Typography>
                ) : (
                  <TableSortLabel
                    active={sortBy === c.id}
                    direction={sortBy === c.id ? sortDirection : 'asc'}
                    onClick={() => onSort(c.id)}
                    aria-label={`Sort by ${c.label}`}
                  >
                    {c.label}
                  </TableSortLabel>
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((x) => (
            <TableRow hover key={x.id}>
              {columns.map((c) => (
                <TableCell key={c.id}>{c.cell(x)}</TableCell>
              ))}
            </TableRow>
          ))}
          {!items.length && (
            <TableRow>
              <TableCell colSpan={columns.length}>No results.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
function Pager({
  page,
  onPage,
  onLimit,
}: {
  page: Page<any>;
  onPage: (offset: number) => void;
  onLimit: (limit: number) => void;
}) {
  const offset = page.offset ?? 0;
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <WallySelect
        label="Rows per page"
        value={String(page.limit)}
        minWidth={145}
        onChange={(v) => onLimit(Number(v))}
        options={[25, 50, 100].map((v) => ({ value: String(v), label: String(v) }))}
      />
      <Button disabled={!offset} onClick={() => onPage(Math.max(0, offset - page.limit))}>
        Previous
      </Button>
      <Typography variant="body2">
        {offset + 1}–{offset + page.items.length}
      </Typography>
      <Button disabled={!page.hasNext} onClick={() => onPage(offset + page.limit)}>
        Next
      </Button>
    </Stack>
  );
}
function UserTypeahead({ label, onSelect, selected }: TypeaheadProps) {
  const [q, setQ] = useState(''),
    [items, setItems] = useState<User[]>([]),
    requestVersion = useRef(0);
  useEffect(() => {
    const version = ++requestVersion.current;
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(
      () =>
        void request<User[]>(`/v1/admin/users/typeahead?q=${encodeURIComponent(q)}`)
          .then((result) => {
            if (version === requestVersion.current) setItems(result.map(adminUser));
          })
          .catch(() => {
            if (version === requestVersion.current) setItems([]);
          }),
      250,
    );
    return () => clearTimeout(t);
  }, [q]);
  if (selected)
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography>{name(selected)}</Typography>
        <Button onClick={() => onSelect(undefined as never)}>Clear</Button>
      </Stack>
    );
  return (
    <Box>
      <TextField
        label={label}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        helperText={
          q.length === 1 ? 'Enter at least 2 characters.' : 'Search begins at 2 characters.'
        }
        inputProps={{
          role: 'combobox',
          'aria-expanded': items.length > 0,
          'aria-controls': `${label}-options`,
        }}
      />
      {items.length > 0 && (
        <Paper id={`${label}-options`} role="listbox">
          {items.map((x) => (
            <Button
              key={x.id}
              role="option"
              fullWidth
              sx={{ justifyContent: 'flex-start' }}
              onClick={() => onSelect(x)}
            >
              {name(x)}
            </Button>
          ))}
        </Paper>
      )}
    </Box>
  );
}
function useDirectory(path: string, endpoint: string, defaults: Record<string, string>) {
  const l = useLocation(),
    n = useNavigate();
  const initial = (): Record<string, string> & { sortDirection: 'asc' | 'desc' } => {
    const q = new URLSearchParams(l.search),
      defaultSort = defaults.sortBy ?? 'created';
    return {
      ...defaults,
      ...Object.fromEntries(Object.keys(defaults).map((k) => [k, q.get(k) ?? defaults[k]])),
      limit: q.get('limit') ?? '25',
      offset: q.get('offset') ?? '0',
      sortBy: q.get('sortBy') ?? defaultSort,
      sortDirection: (q.get('sortDirection') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
    };
  };
  const [state, setState] = useState(initial),
    [page, setPage] = useState<Page<any>>({
      items: [],
      limit: Number(initial().limit),
      offset: Number(initial().offset),
    }),
    [message, setMessage] = useState('');
  useEffect(() => {
    const next = initial();
    let active = true;
    setState(next);
    void request<Page<any>>(`${endpoint}?${params(next)}`)
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((e) => {
        if (active) setMessage(err(e));
      });
    return () => {
      active = false;
    };
  }, [l.search]);
  const apply = (next: Record<string, string | number>) => n(`${path}?${params(next)}`);
  return { state, page, message, setMessage, apply };
}

function Psiu() {
  const d = useDirectory('/admin/psiu', '/v1/admin/psiu-units', {
      q: '',
      status: '',
      assignment: '',
      customerId: '',
      sortBy: 'serial',
    }),
    [owner, setOwner] = useState<User>(),
    [serial, setSerial] = useState(''),
    [uid, setUid] = useState(''),
    [assignment, setAssignment] = useState<Unit>(),
    [scanning, setScanning] = useState(false);
  useEffect(() => {
    if (!d.state.customerId) {
      setOwner(undefined);
      return;
    }
    let active = true;
    void request<User>(`/v1/admin/users/${d.state.customerId}`)
      .then((value) => {
        if (active) setOwner(adminUser(value));
      })
      .catch(() => {
        if (active) setOwner(undefined);
      });
    return () => {
      active = false;
    };
  }, [d.state.customerId]);
  const update = (extra: Record<string, string | number>) => d.apply({ ...d.state, ...extra });
  const post = async (path: string, body?: unknown) => {
    try {
      await request(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      update({});
    } catch (e) {
      d.setMessage(err(e));
    }
  };
  const scan = async () => {
    setScanning(true);
    try {
      setUid(await createPsuClient().scanUid());
    } catch {
      d.setMessage('PSIU UID scan failed. Check power, network, and psiu.local.');
    } finally {
      setScanning(false);
    }
  };
  const columns = [
    { id: 'serial', label: 'Serial', cell: (u: Unit) => u.serialNumber },
    { id: 'uid', label: 'Firmware UID', cell: (u: Unit) => u.uid },
    {
      id: 'status',
      label: 'Status',
      cell: (u: Unit) =>
        u.status === 'unavailable'
          ? 'Unavailable: provenance preserved; no changes allowed.'
          : u.status,
    },
    {
      id: 'owner',
      label: 'Owner',
      cell: (u: Unit) => (u.customer ? name(u.customer) : 'Unassigned'),
    },
    {
      id: 'assigned',
      label: 'Assigned',
      cell: (u: Unit) => (u.assignedAt ? new Date(u.assignedAt).toLocaleString() : '—'),
    },
    {
      id: 'unavailable',
      label: 'Unavailable',
      cell: (u: Unit) => (u.unavailableAt ? new Date(u.unavailableAt).toLocaleString() : '—'),
    },
    {
      id: 'actions',
      label: 'Actions',
      sortable: false,
      cell: (u: Unit) =>
        u.status === 'unavailable' ? (
          'Read-only'
        ) : (
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            <Button
              size="small"
              onClick={() => {
                const action = u.status === 'enabled' ? 'disable' : 'enable';
                if (
                  action === 'disable' &&
                  !window.confirm(
                    `Disable ${u.serialNumber}? New captures will be blocked; existing sample provenance remains.`,
                  )
                )
                  return;
                void post(`/v1/admin/psiu-units/${u.id}/${action}`);
              }}
            >
              {u.status === 'enabled' ? 'Disable capture' : 'Enable'}
            </Button>
            {u.customer ? (
              <Button
                size="small"
                onClick={() =>
                  window.confirm(
                    `Deassign ${u.serialNumber}? Capture will be blocked; existing provenance remains.`,
                  ) && void post(`/v1/admin/psiu-units/${u.id}/deassign`)
                }
              >
                Deassign
              </Button>
            ) : (
              <Button size="small" onClick={() => setAssignment(u)}>
                Assign
              </Button>
            )}
            <Button
              size="small"
              color="warning"
              onClick={() =>
                window.confirm(
                  `Mark ${u.serialNumber} unavailable? This blocks future capture and preserves provenance.`,
                ) && void post(`/v1/admin/psiu-units/${u.id}/unavailable`)
              }
            >
              Mark unavailable
            </Button>
            <Button
              size="small"
              color="error"
              onClick={async () => {
                if (window.confirm(`Hard delete ${u.serialNumber}?`))
                  try {
                    const x = hardDeletePsiuRequest(u.id);
                    await request(x.path, { method: x.method });
                    update({});
                  } catch (e) {
                    d.setMessage(err(e));
                  }
              }}
            >
              Delete
            </Button>
          </Stack>
        ),
    },
  ];
  return (
    <Stack spacing={2}>
      <Typography variant="h4">PSIU Management</Typography>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Inventory actions</Typography>
        <Typography variant="body2" color="text.secondary">
          Scan a local PSIU UID, then add it to inventory. These actions do not affect list filters.
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 1 }}>
          <Button onClick={() => void scan()} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan PSIU UID'}
          </Button>
          <TextField
            label="Serial number"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
          />
          <TextField label="Firmware UID" value={uid} onChange={(e) => setUid(e.target.value)} />
          <Button
            variant="contained"
            disabled={!serial || !uid}
            onClick={() => void post('/v1/admin/psiu-units', { serialNumber: serial, uid })}
          >
            Add PSIU
          </Button>
        </Stack>
      </Paper>
      {assignment && (
        <Paper sx={{ p: 2, border: 2, borderColor: 'primary.main' }}>
          <Typography variant="h6">Assignment workspace: {assignment.serialNumber}</Typography>
          <Typography variant="body2">
            Select a customer to assign this PSIU. Inventory filtering remains unchanged.
          </Typography>
          <UserTypeahead
            label="Assign to customer"
            onSelect={(person) =>
              void post(`/v1/admin/psiu-units/${assignment.id}/assign`, { customerId: person.id })
            }
          />
          <Button onClick={() => setAssignment(undefined)}>Close assignment workspace</Button>
        </Paper>
      )}
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Inventory filters</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 1 }}>
          <TextField
            label="Search serial or UID"
            value={d.state.q}
            onChange={(e) => update({ q: e.target.value, offset: 0 })}
          />
          <WallySelect
            label="Status"
            value={d.state.status}
            minWidth={160}
            onChange={(v) => update({ status: v, offset: 0 })}
            options={[
              { value: '', label: 'All statuses' },
              ...['enabled', 'disabled', 'unavailable'].map((v) => ({ value: v, label: v })),
            ]}
          />
          <WallySelect
            label="Assignment"
            value={d.state.assignment}
            minWidth={170}
            onChange={(v) => update({ assignment: v, offset: 0 })}
            options={[
              { value: '', label: 'All assignments' },
              { value: 'assigned', label: 'Assigned' },
              { value: 'unassigned', label: 'Unassigned' },
            ]}
          />
          <UserTypeahead
            label="Filter by owner"
            selected={owner}
            onSelect={(x) => {
              setOwner(x);
              update({ customerId: x?.id ?? '', offset: 0 });
            }}
          />
        </Stack>
      </Paper>
      {d.message && <Alert severity="error">{d.message}</Alert>}
      <TableView
        label="PSIU inventory"
        columns={columns}
        items={d.page.items}
        sortBy={d.state.sortBy}
        sortDirection={d.state.sortDirection}
        onSort={(id) =>
          update({
            sortBy: id,
            sortDirection:
              d.state.sortBy === id && d.state.sortDirection === 'asc' ? 'desc' : 'asc',
            offset: 0,
          })
        }
      />
      <Pager
        page={d.page}
        onPage={(offset) => update({ offset })}
        onLimit={(limit) => update({ limit, offset: 0 })}
      />
    </Stack>
  );
}
function Users({ userId }: { userId?: string }) {
  const d = useDirectory('/admin/users', '/v1/admin/users', { q: '', lifecycle: '' }),
    n = useNavigate(),
    l = useLocation(),
    [email, setEmail] = useState(''),
    [creating, setCreating] = useState(false);
  if (userId)
    return (
      <UserDetail
        id={userId}
        onBack={() => n(validReturnTo(new URLSearchParams(l.search).get('returnTo')))}
      />
    );
  const update = (x: Record<string, string | number>) => d.apply({ ...d.state, ...x });
  const returnTo = `/admin/users?${params(d.state)}`;
  const columns = [
    {
      id: 'name',
      label: 'Name',
      cell: (u: User) => (
        <Button
          size="small"
          onClick={() => n(`/admin/users/${u.id}?returnTo=${encodeURIComponent(returnTo)}`)}
        >
          {name(u)}
        </Button>
      ),
    },
    { id: 'email', label: 'Email', cell: (u: User) => u.email },
    { id: 'lifecycle', label: 'Lifecycle', cell: (u: User) => u.lifecycle },
    { id: 'balance', label: 'Credits', cell: (u: User) => u.balance },
    {
      id: 'created',
      label: 'Created',
      cell: (u: User) =>
        u.created_at || u.createdAt ? new Date(u.created_at || u.createdAt!).toLocaleString() : '—',
    },
    {
      id: 'lastActive',
      label: 'Last active',
      cell: (u: User) =>
        u.last_active_at || u.lastActiveAt
          ? new Date(u.last_active_at || u.lastActiveAt!).toLocaleString()
          : '—',
    },
  ];
  return (
    <Stack spacing={2}>
      <Typography variant="h4">User Management</Typography>
      <Paper sx={{ p: 2 }}>
        <Button variant="contained" onClick={() => setCreating(!creating)}>
          Create customer
        </Button>
        {creating && (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField
              label="Customer email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              onClick={async () => {
                try {
                  const u = await request<User>('/v1/admin/customers', {
                    method: 'POST',
                    body: JSON.stringify({ email }),
                  });
                  n(`/admin/users/${u.id}?returnTo=${encodeURIComponent(returnTo)}`);
                } catch (e) {
                  d.setMessage(err(e));
                }
              }}
            >
              Create
            </Button>
          </Stack>
        )}
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">User filters</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <TextField
            label="Search name, email, or active PSIU serial"
            value={d.state.q}
            onChange={(e) => update({ q: e.target.value, offset: 0 })}
          />
          <WallySelect
            label="Lifecycle"
            value={d.state.lifecycle}
            minWidth={180}
            onChange={(v) => update({ lifecycle: v, offset: 0 })}
            options={[
              { value: '', label: 'All lifecycles' },
              ...['draft', 'ready', 'invited', 'active', 'suspended', 'cancelled'].map((v) => ({
                value: v,
                label: v,
              })),
            ]}
          />
        </Stack>
      </Paper>
      {d.message && <Alert severity="error">{d.message}</Alert>}
      <TableView
        label="User directory"
        columns={columns}
        items={d.page.items.map(adminUser)}
        sortBy={d.state.sortBy}
        sortDirection={d.state.sortDirection}
        onSort={(id) =>
          update({
            sortBy: id,
            sortDirection:
              d.state.sortBy === id && d.state.sortDirection === 'asc' ? 'desc' : 'asc',
            offset: 0,
          })
        }
      />
      <Pager
        page={d.page}
        onPage={(offset) => update({ offset })}
        onLimit={(limit) => update({ limit, offset: 0 })}
      />
    </Stack>
  );
}
function UserDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [u, setU] = useState<User>(),
    [editing, setEditing] = useState(false),
    [m, setM] = useState('');
  const load = () =>
    void request<User>(`/v1/admin/users/${id}`)
      .then((value) => setU(adminUser(value)))
      .catch((e) => setM(err(e)));
  useEffect(load, [id]);
  if (!u) return <>{m && <Alert severity="error">{m}</Alert>}</>;
  const save = async () => {
    try {
      setU(
        adminUser(
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
        ),
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
function Credits() {
  const d = useDirectory('/admin/credits', '/v1/admin/credits', {}),
    [selected, setSelected] = useState<User>(),
    [delta, setDelta] = useState(''),
    [note, setNote] = useState('');
  const update = (x: Record<string, string | number>) => d.apply({ ...d.state, ...x });
  const adjust = async () => {
    if (!selected) return;
    try {
      await request(`/v1/admin/users/${selected.id}/credits`, {
        method: 'POST',
        body: JSON.stringify({
          delta: Number(delta),
          note,
          kind: Number(delta) > 0 ? 'grant' : 'administrative_adjustment',
        }),
      });
      setDelta('');
      setNote('');
      update({});
    } catch (e) {
      d.setMessage(err(e));
    }
  };
  const columns = [
    { id: 'owner', label: 'Customer', cell: (x: any) => x.email },
    { id: 'created', label: 'Date', cell: (x: any) => new Date(x.created_at).toLocaleString() },
    { id: 'kind', label: 'Kind', cell: (x: any) => x.kind },
    { id: 'delta', label: 'Change', cell: (x: any) => x.delta },
    { id: 'balance', label: 'Balance', cell: (x: any) => x.balance_after },
    { id: 'note', label: 'Note', cell: (x: any) => x.note },
  ];
  return (
    <Stack spacing={2}>
      <Typography variant="h4">Credits</Typography>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Credit adjustment</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <UserTypeahead label="Customer" selected={selected} onSelect={setSelected} />
          <TextField
            label="Credit amount (+/-)"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
          />
          <TextField
            required
            label="Adjustment note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            variant="contained"
            disabled={!selected || !delta || !note}
            onClick={() => void adjust()}
          >
            Apply adjustment
          </Button>
        </Stack>
      </Paper>
      {d.message && <Alert severity="error">{d.message}</Alert>}
      <TableView
        label="Credit ledger"
        columns={columns}
        items={d.page.items}
        sortBy={d.state.sortBy}
        sortDirection={d.state.sortDirection}
        onSort={(id) =>
          update({
            sortBy: id,
            sortDirection:
              d.state.sortBy === id && d.state.sortDirection === 'asc' ? 'desc' : 'asc',
            offset: 0,
          })
        }
      />
      <Pager
        page={d.page}
        onPage={(offset) => update({ offset })}
        onLimit={(limit) => update({ limit, offset: 0 })}
      />
    </Stack>
  );
}
function Samples() {
  const d = useDirectory('/admin/samples', '/v1/admin/samples', {
      q: '',
      source: '',
      state: '',
      ownerId: '',
    }),
    [owner, setOwner] = useState<User>();
  useEffect(() => {
    if (!d.state.ownerId) {
      setOwner(undefined);
      return;
    }
    let active = true;
    void request<User>(`/v1/admin/users/${d.state.ownerId}`)
      .then((value) => {
        if (active) setOwner(adminUser(value));
      })
      .catch(() => {
        if (active) setOwner(undefined);
      });
    return () => {
      active = false;
    };
  }, [d.state.ownerId]);
  const update = (x: Record<string, string | number>) => d.apply({ ...d.state, ...x });
  const columns = [
    { id: 'owner', label: 'Owner', cell: (x: any) => x.email },
    { id: 'psiu', label: 'PSIU', cell: (x: any) => x.serial_number },
    { id: 'source', label: 'Source', cell: (x: any) => x.source },
    { id: 'state', label: 'Upload state', cell: (x: any) => x.upload_state },
    {
      id: 'recorded',
      label: 'Recorded',
      cell: (x: any) => (x.recorded_at ? new Date(x.recorded_at).toLocaleString() : '—'),
    },
    {
      id: 'uploaded',
      label: 'Uploaded',
      cell: (x: any) => (x.uploaded_at ? new Date(x.uploaded_at).toLocaleString() : '—'),
    },
    { id: 'created', label: 'Created', cell: (x: any) => new Date(x.created_at).toLocaleString() },
  ];
  return (
    <Stack spacing={2}>
      <Typography variant="h4">Samples</Typography>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Sample filters</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <TextField
            label="Search PSIU serial or UID"
            value={d.state.q}
            onChange={(e) => update({ q: e.target.value, offset: 0 })}
          />
          <UserTypeahead
            label="Filter by user"
            selected={owner}
            onSelect={(x) => {
              setOwner(x);
              update({ ownerId: x?.id ?? '', offset: 0 });
            }}
          />
          <WallySelect
            label="Source"
            value={d.state.source}
            minWidth={160}
            onChange={(v) => update({ source: v, offset: 0 })}
            options={[
              { value: '', label: 'All sources' },
              { value: 'manual_file', label: 'Manual file' },
              { value: 'psiu_capture', label: 'PSIU capture' },
            ]}
          />
          <WallySelect
            label="State"
            value={d.state.state}
            minWidth={160}
            onChange={(v) => update({ state: v, offset: 0 })}
            options={[
              { value: '', label: 'All states' },
              ...['intent', 'uploaded', 'failed'].map((v) => ({ value: v, label: v })),
            ]}
          />
        </Stack>
      </Paper>
      {d.message && <Alert severity="error">{d.message}</Alert>}
      <TableView
        label="Sample directory"
        columns={columns}
        items={d.page.items}
        sortBy={d.state.sortBy}
        sortDirection={d.state.sortDirection}
        onSort={(id) =>
          update({
            sortBy: id,
            sortDirection:
              d.state.sortBy === id && d.state.sortDirection === 'asc' ? 'desc' : 'asc',
            offset: 0,
          })
        }
      />
      <Pager
        page={d.page}
        onPage={(offset) => update({ offset })}
        onLimit={(limit) => update({ limit, offset: 0 })}
      />
    </Stack>
  );
}
function Reports() {
  const d = useDirectory('/admin/reports', '/v1/admin/reports', {
      q: '',
      type: '',
      status: '',
      ownerId: '',
    }),
    n = useNavigate(),
    [owner, setOwner] = useState<User>();
  useEffect(() => {
    if (!d.state.ownerId) {
      setOwner(undefined);
      return;
    }
    let active = true;
    void request<User>(`/v1/admin/users/${d.state.ownerId}`)
      .then((value) => {
        if (active) setOwner(adminUser(value));
      })
      .catch(() => {
        if (active) setOwner(undefined);
      });
    return () => {
      active = false;
    };
  }, [d.state.ownerId]);
  const update = (x: Record<string, string | number>) => d.apply({ ...d.state, ...x });
  const columns = [
    { id: 'report', label: 'Report', cell: (x: any) => x.reportName },
    {
      id: 'owner',
      label: 'Owner',
      cell: (x: any) => (
        <Button
          size="small"
          onClick={() =>
            n(
              `/admin/users/${x.owner.id}?returnTo=${encodeURIComponent(`/admin/reports?${params(d.state)}`)}`,
            )
          }
        >
          {name(x.owner)}
        </Button>
      ),
    },
    { id: 'system', label: 'System', cell: (x: any) => x.systemName },
    { id: 'preset', label: 'Preset', cell: (x: any) => `${x.presetName} v${x.presetVersion}` },
    { id: 'status', label: 'Status', cell: (x: any) => x.status },
    { id: 'created', label: 'Created', cell: (x: any) => new Date(x.createdAt).toLocaleString() },
  ];
  return (
    <Stack spacing={2}>
      <Typography variant="h4">Reports</Typography>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">Report filters</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
          <TextField
            label="Search system information"
            value={d.state.q}
            onChange={(e) => update({ q: e.target.value, offset: 0 })}
          />
          <UserTypeahead
            label="Filter by user"
            selected={owner}
            onSelect={(x) => {
              setOwner(x);
              update({ ownerId: x?.id ?? '', offset: 0 });
            }}
          />
          <TextField
            label="Report type"
            value={d.state.type}
            onChange={(e) => update({ type: e.target.value, offset: 0 })}
          />
          <WallySelect
            label="Status"
            value={d.state.status}
            minWidth={160}
            onChange={(v) => update({ status: v, offset: 0 })}
            options={[
              { value: '', label: 'All statuses' },
              ...['queued', 'running', 'completed', 'failed', 'cancelled'].map((v) => ({
                value: v,
                label: v,
              })),
            ]}
          />
        </Stack>
      </Paper>
      {d.message && <Alert severity="error">{d.message}</Alert>}
      <TableView
        label="Report directory"
        columns={columns}
        items={d.page.items}
        sortBy={d.state.sortBy}
        sortDirection={d.state.sortDirection}
        onSort={(id) =>
          update({
            sortBy: id,
            sortDirection:
              d.state.sortBy === id && d.state.sortDirection === 'asc' ? 'desc' : 'asc',
            offset: 0,
          })
        }
      />
      <Pager
        page={d.page}
        onPage={(offset) => update({ offset })}
        onLimit={(limit) => update({ limit, offset: 0 })}
      />
    </Stack>
  );
}
