import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { HttpError } from './auth.js';

const PAGE_MAX = 100;
export type Page = { limit?: number; offset?: number };
export type AdminAddress = { line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; countryCode?: string };
export type AdminProfile = { firstName?: string; lastName?: string; address?: AdminAddress };

export function page(value: Page = {}) {
  const limit = value.limit ?? 25; const offset = value.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) throw new HttpError(400, `limit must be an integer from 1 to ${PAGE_MAX}.`);
  if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'offset must be a nonnegative integer.');
  return { limit, offset };
}

export class PostgresAdminDataRepository {
  constructor(private readonly pool: Pool) {}
  async touchLastActive(ownerId: string) { await this.pool.query(`update users set last_active_at=now() where id=$1 and (last_active_at is null or last_active_at < now()-interval '15 minutes')`, [ownerId]); }
  async users(value: { q?: string } & Page = {}) {
    const p = page(value); const q = (value.q ?? '').trim(); const term = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const r = await this.pool.query(`select u.id,u.email,u.first_name,u.last_name,u.lifecycle,u.created_at,u.last_active_at,coalesce((select l.balance_after from credit_ledger_entries l where l.owner_id=u.id order by l.created_at desc limit 1),0) balance,coalesce(json_agg(json_build_object('id',p.id,'serialNumber',p.serial_number,'status',p.status)) filter(where p.id is not null),'[]') units from users u left join psiu_assignments a on a.user_id=u.id and a.unassigned_at is null left join psiu_units p on p.id=a.psiu_unit_id where u.role='user' and ($1='' or u.email ilike $2 escape '\\' or coalesce(u.first_name,'') ilike $2 escape '\\' or coalesce(u.last_name,'') ilike $2 escape '\\' or exists(select 1 from psiu_assignments aa join psiu_units pp on pp.id=aa.psiu_unit_id where aa.user_id=u.id and aa.unassigned_at is null and pp.serial_number ilike $2 escape '\\')) group by u.id order by u.created_at desc limit $3 offset $4`, [q, term, p.limit, p.offset]);
    return { items: r.rows, limit: p.limit, offset: p.offset };
  }
  async typeahead(q: string) {
    const value = q.trim(); if (value.length < 2) return [];
    const term = `%${value.replace(/[%_\\]/g, '\\$&')}%`;
    const r = await this.pool.query(`select u.id,u.email,u.first_name,u.last_name from users u where u.role='user' and u.lifecycle in ('draft','ready','invited','active') and (u.email ilike $1 escape '\\' or coalesce(u.first_name,'') ilike $1 escape '\\' or coalesce(u.last_name,'') ilike $1 escape '\\' or exists(select 1 from psiu_assignments a join psiu_units p on p.id=a.psiu_unit_id where a.user_id=u.id and a.unassigned_at is null and p.serial_number ilike $1 escape '\\')) order by u.email limit 20`, [term]);
    return r.rows.map(x => ({ ...x, displayName: [x.first_name, x.last_name].filter(Boolean).join(' ') || x.email }));
  }
  async user(id: string) {
    const r = await this.pool.query(`select u.id,u.email,u.first_name,u.last_name,u.lifecycle,u.created_at,u.last_active_at,u.address_line1,u.address_line2,u.address_city,u.address_region,u.address_postal_code,u.address_country_code,coalesce((select l.balance_after from credit_ledger_entries l where l.owner_id=u.id order by l.created_at desc limit 1),0) balance from users u where u.id=$1 and u.role='user'`, [id]);
    if (!r.rowCount) return undefined;
    const units = await this.pool.query(`select p.id,p.serial_number,p.opaque_uid,p.status,a.assigned_at,p.unavailable_at from psiu_units p join psiu_assignments a on a.psiu_unit_id=p.id and a.unassigned_at is null where a.user_id=$1 order by a.assigned_at desc`, [id]);
    return { ...r.rows[0], units: units.rows.map(x => ({ id: x.id, serialNumber: x.serial_number, uid: x.opaque_uid, status: x.status, assignedAt: x.assigned_at?.toISOString(), unavailableAt: x.unavailable_at?.toISOString() })) };
  }
  async updateUser(id: string, actorId: string, value: AdminProfile, requestId?: string) {
    const profile = normalizeProfile(value);
    const r = await this.pool.query(`update users set first_name=$2,last_name=$3,address_line1=$4,address_line2=$5,address_city=$6,address_region=$7,address_postal_code=$8,address_country_code=$9 where id=$1 and role='user' returning id`, [id, profile.firstName, profile.lastName, profile.address.line1, profile.address.line2, profile.address.city, profile.address.region, profile.address.postalCode, profile.address.countryCode]);
    if (!r.rowCount) throw new HttpError(404, 'Customer not found.');
    await this.pool.query(`insert into audit_events(id,actor_id,action,subject_type,subject_id,request_id,metadata) values($1,$2,'customer.profile_updated','user',$3,$4,'{}'::jsonb)`, [randomUUID(), actorId, id, requestId ?? null]);
    return this.user(id);
  }
  async adjustCredits(ownerId: string, actorId: string, value: { delta: number; note: string; kind?: 'grant' | 'administrative_adjustment' }) {
    const delta = value.delta; const note = value.note?.trim();
    if (!Number.isInteger(delta) || !delta || !note || note.length > 2000) throw new HttpError(400, 'Nonblank note and nonzero integer credit amount required.');
    const c = await this.pool.connect(); try { await c.query('begin'); const owner = await c.query(`select id from users where id=$1 and role='user' for update`, [ownerId]); if (!owner.rowCount) throw new HttpError(404, 'Customer not found.'); const prior = await c.query<{ balance_after: number }>(`select balance_after from credit_ledger_entries where owner_id=$1 order by created_at desc limit 1 for update`, [ownerId]); const balance = (prior.rows[0]?.balance_after ?? 0) + delta; if (balance < 0) throw new HttpError(409, 'Credit balance cannot be negative.'); const r = await c.query(`insert into credit_ledger_entries(id,owner_id,kind,delta,balance_after,note,actor_id) values($1,$2,$3,$4,$5,$6,$7) returning id,kind,delta,balance_after,note,created_at`, [randomUUID(), ownerId, value.kind ?? 'administrative_adjustment', delta, balance, note, actorId]); await c.query('commit'); return r.rows[0]; } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  async credits(ownerId: string, value: Page = {}) { const p = page(value); const r = await this.pool.query(`select id,kind,delta,balance_after,note,created_at from credit_ledger_entries where owner_id=$1 order by created_at desc,id desc limit $2 offset $3`, [ownerId, p.limit, p.offset]); const balance = await this.pool.query<{ balance: number }>(`select coalesce((select balance_after from credit_ledger_entries where owner_id=$1 order by created_at desc,id desc limit 1),0) balance`, [ownerId]); return { items: r.rows, balance: balance.rows[0]?.balance ?? 0, limit: p.limit, offset: p.offset }; }
  async creditStats(value: { from?: string; to?: string } = {}) { const r = await this.pool.query(`select date_trunc('day',created_at) day,kind,coalesce(reference_type,'unattributed') product,count(*) entry_count,sum(delta) delta from credit_ledger_entries where ($1::timestamptz is null or created_at >= $1) and ($2::timestamptz is null or created_at < $2) group by 1,2,3 order by day desc,kind`, [value.from ?? null, value.to ?? null]); return r.rows; }
  async units() { const r = await this.pool.query(`select p.id,p.serial_number,p.opaque_uid,p.status,p.unavailable_at,a.assigned_at,u.id customer_id,u.email customer_email,u.first_name customer_first_name,u.last_name customer_last_name from psiu_units p left join psiu_assignments a on a.psiu_unit_id=p.id and a.unassigned_at is null left join users u on u.id=a.user_id order by p.serial_number`); return r.rows.map(x => ({ id:x.id, serialNumber:x.serial_number, uid:x.opaque_uid, status:x.status, unavailableAt:x.unavailable_at?.toISOString(), assignedAt:x.assigned_at?.toISOString(), customer:x.customer_id ? { id:x.customer_id,email:x.customer_email,firstName:x.customer_first_name??undefined,lastName:x.customer_last_name??undefined } : undefined })); }
  async samples(value: { limit?: number; offset?: number; ownerId?: string; psiuUnitId?: string; source?: string; state?: string } = {}) { const p = page(value); const r = await this.pool.query(`select s.id,s.owner_id,s.psiu_unit_id,s.source,s.upload_state,s.metadata,s.system_snapshot,s.recorded_at,s.created_at,s.uploaded_at,u.email,p.serial_number from samples s join users u on u.id=s.owner_id join psiu_units p on p.id=s.psiu_unit_id where ($1::uuid is null or s.owner_id=$1) and ($2::uuid is null or s.psiu_unit_id=$2) and ($3::text is null or s.source=$3) and ($4::text is null or s.upload_state=$4) order by s.created_at desc limit $5 offset $6`, [value.ownerId ?? null, value.psiuUnitId ?? null, value.source ?? null, value.state ?? null, p.limit, p.offset]); return { items:r.rows, limit:p.limit, offset:p.offset }; }
  async sampleStats(adminId: string) { const r = await this.pool.query<{ total:string; d7:string; d14:string; d30:string; ytd:string; fresh:string }>(`select count(*) total,count(*) filter(where created_at>=now()-interval '7 days') d7,count(*) filter(where created_at>=now()-interval '14 days') d14,count(*) filter(where created_at>=now()-interval '30 days') d30,count(*) filter(where created_at>=date_trunc('year',now())) ytd,count(*) filter(where created_at>coalesce((select admin_samples_viewed_at from users where id=$1),'epoch')) fresh from samples`, [adminId]); await this.pool.query(`update users set admin_samples_viewed_at=now() where id=$1`, [adminId]); return r.rows[0]; }
}
function text(value: unknown, max: number, name: string) { if (value === undefined) return undefined; if (typeof value !== 'string') throw new HttpError(400, `${name} must be text.`); const v=value.trim(); if (v.length > max || /[\u0000-\u001f]/.test(v)) throw new HttpError(400, `${name} is invalid.`); return v || undefined; }
function normalizeProfile(value: AdminProfile) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Profile object required.'); const a=value.address ?? {}; if (!a || typeof a !== 'object' || Array.isArray(a)) throw new HttpError(400, 'Address must be an object.'); const country=text(a.countryCode,2,'countryCode')?.toUpperCase(); if (country && !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'countryCode must be ISO 3166-1 alpha-2.'); return { firstName:text(value.firstName,100,'firstName'), lastName:text(value.lastName,100,'lastName'), address:{line1:text(a.line1,200,'line1'),line2:text(a.line2,200,'line2'),city:text(a.city,100,'city'),region:text(a.region,100,'region'),postalCode:text(a.postalCode,40,'postalCode'),countryCode:country} }; }
