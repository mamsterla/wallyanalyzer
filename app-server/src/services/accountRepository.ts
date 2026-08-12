import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { CustomerSummary, CustomerUnit, MeResponse, PsiuUnitStatus, Role } from '@wally/contracts';
import { HttpError } from './auth.js';

export interface AccountRepository {
  findActivePrincipal(subject: string): Promise<{ id: string; role: Role; lifecycle: string } | undefined>;
  me(id: string): Promise<MeResponse | undefined>;
  customers(): Promise<CustomerSummary[]>;
  units(): Promise<CustomerUnit[]>;
  createCustomer(email: string, actorId: string, requestId?: string): Promise<CustomerSummary>;
  createUnit(serialNumber: string, uid: string, actorId: string, requestId?: string): Promise<CustomerUnit>;
  setUnitStatus(unitId: string, status: PsiuUnitStatus, actorId: string, requestId?: string): Promise<void>;
  assign(unitId: string, customerId: string, actorId: string, requestId?: string): Promise<void>;
  deassign(unitId: string, actorId: string, requestId?: string): Promise<void>;
  markInvited(customerId: string, subject: string, actorId: string, requestId?: string): Promise<void>;
  activate(subject: string): Promise<void>;
  setCustomerLifecycle(customerId: string, lifecycle: 'suspended' | 'ready', actorId: string, requestId?: string): Promise<{ email: string; cognitoSubject?: string }>;
  archive(customerId: string, actorId: string, requestId?: string): Promise<{ email: string; cognitoSubject?: string }>;
}

type UserRow = { id: string; email: string; role: Role; lifecycle: MeResponse['lifecycle']; invited_at: Date | null };
type UnitRow = { id: string; serial_number: string; opaque_uid: string; status: PsiuUnitStatus; assigned_at: Date | null };

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}
  async findActivePrincipal(subject: string) {
    const r = await this.pool.query<{ id: string; role: Role; lifecycle: string }>(`select id, role, lifecycle from users where cognito_subject=$1 and lifecycle in ('invited','active')`, [subject]);
    return r.rows[0];
  }
  async me(id: string): Promise<MeResponse | undefined> {
    const r = await this.pool.query<UserRow>(`select id,email,role,lifecycle,invited_at from users where id=$1`, [id]);
    if (!r.rowCount) return undefined;
    const u = r.rows[0]; return { id: u.id, email: u.email, role: u.role, lifecycle: u.lifecycle, units: await this.unitsFor(id), emailChangeAvailable: false };
  }
  async customers(): Promise<CustomerSummary[]> {
    const r = await this.pool.query<UserRow>(`select id,email,role,lifecycle,invited_at from users where role='user' and lifecycle <> 'cancelled' order by email`);
    return Promise.all(r.rows.map(async u => ({ id:u.id,email:u.email,lifecycle:u.lifecycle,invitedAt:u.invited_at?.toISOString(),units:await this.unitsFor(u.id) })));
  }
  async units(): Promise<CustomerUnit[]> { return this.allUnits(); }
  async createCustomer(email: string, actorId: string, requestId?: string): Promise<CustomerSummary> {
    const id=randomUUID(); const r=await this.pool.query<UserRow>(`insert into users(id,email,cognito_subject,role,lifecycle) values($1,$2,null,'user','draft') returning id,email,role,lifecycle,invited_at`,[id,email]);
    await this.audit(actorId,'customer.created','user',id,requestId,{email}); const u=r.rows[0]; return {id:u.id,email:u.email,lifecycle:u.lifecycle,units:[]};
  }
  async createUnit(serialNumber:string,uid:string,actorId:string,requestId?:string):Promise<CustomerUnit>{
    const id=randomUUID(); const r=await this.pool.query<UnitRow>(`insert into psiu_units(id,serial_number,opaque_uid,created_by) values($1,$2,$3,$4) returning id,serial_number,opaque_uid,status,null::timestamptz assigned_at`,[id,serialNumber,uid,actorId]);
    await this.audit(actorId,'psiu.created','psiu_unit',id,requestId,{serialNumber,uid}); return unit(r.rows[0]);
  }
  async setUnitStatus(id:string,status:PsiuUnitStatus,actorId:string,requestId?:string):Promise<void>{ const r=await this.pool.query(`update psiu_units set status=$2,disabled_at=case when $2='disabled' then now() else null end,disabled_by=case when $2='disabled' then $3 else null end where id=$1`,[id,status,actorId]); if(!r.rowCount) throw new HttpError(404,'PSIU unit not found.'); await this.audit(actorId,`psiu.${status}`,'psiu_unit',id,requestId,{}); }
  async assign(unitId:string,customerId:string,actorId:string,requestId?:string):Promise<void>{ const c=await this.pool.connect();try{await c.query('begin');const unit=await c.query(`select id from psiu_units where id=$1 and status='enabled' for update`,[unitId]);if(!unit.rowCount)throw new HttpError(400,'Enabled PSIU unit required.');const user=await c.query(`select id from users where id=$1 and role='user' and lifecycle in ('draft','ready','invited','active') for update`,[customerId]);if(!user.rowCount)throw new HttpError(400,'Assignable customer required.');await c.query(`update psiu_assignments set unassigned_at=now(),unassigned_by=$2 where psiu_unit_id=$1 and unassigned_at is null`,[unitId,actorId]);await c.query(`update psiu_assignments set unassigned_at=now(),unassigned_by=$2 where user_id=$1 and unassigned_at is null`,[customerId,actorId]);await c.query(`insert into psiu_assignments(id,psiu_unit_id,user_id,assigned_by) values($1,$2,$3,$4)`,[randomUUID(),unitId,customerId,actorId]);await this.auditClient(c,actorId,'psiu.assigned','psiu_unit',unitId,requestId,{customerId});await c.query('commit')}catch(e){await c.query('rollback');throw e}finally{c.release()} }
  async deassign(unitId:string,actorId:string,requestId?:string):Promise<void>{const r=await this.pool.query(`update psiu_assignments set unassigned_at=now(),unassigned_by=$2 where psiu_unit_id=$1 and unassigned_at is null`,[unitId,actorId]);if(!r.rowCount)throw new HttpError(404,'Active PSIU assignment not found.');await this.audit(actorId,'psiu.deassigned','psiu_unit',unitId,requestId,{});}
  async markInvited(id:string,subject:string,actorId:string,requestId?:string):Promise<void>{const r=await this.pool.query(`update users set cognito_subject=$2,lifecycle='invited',invited_at=now() where id=$1 and lifecycle in ('draft','ready')`,[id,subject]);if(!r.rowCount)throw new HttpError(409,'Customer cannot be invited.');await this.audit(actorId,'customer.invited','user',id,requestId,{});}
  async activate(subject:string):Promise<void>{ await this.pool.query(`update users set lifecycle='active',account_status='active' where cognito_subject=$1 and lifecycle='invited'`,[subject]); }
  async setCustomerLifecycle(id:string,lifecycle:'suspended'|'ready',actorId:string,requestId?:string):Promise<{email:string;cognitoSubject?:string}>{const r=await this.pool.query<{email:string;cognito_subject:string|null}>(`update users set lifecycle=$2,account_status=case when $2='suspended' then 'suspended' else account_status end where id=$1 and role='user' and lifecycle <> 'cancelled' returning email,cognito_subject`,[id,lifecycle]);if(!r.rowCount)throw new HttpError(404,'Customer not found.');await this.audit(actorId,`customer.${lifecycle}`,'user',id,requestId,{});return{email:r.rows[0].email,cognitoSubject:r.rows[0].cognito_subject??undefined};}
  async archive(id:string,actorId:string,requestId?:string){const c=await this.pool.connect();try{await c.query('begin');const r=await c.query<{email:string;cognito_subject:string|null}>(`update users set lifecycle='cancelled',archived_at=now(),account_status='cancelled' where id=$1 and role='user' and lifecycle <> 'cancelled' returning email,cognito_subject`,[id]);if(!r.rowCount)throw new HttpError(404,'Active customer not found.');await c.query(`update psiu_assignments set unassigned_at=now(),unassigned_by=$2 where user_id=$1 and unassigned_at is null`,[id,actorId]);await this.auditClient(c,actorId,'customer.archived','user',id,requestId,{});await c.query('commit');return {email:r.rows[0].email,cognitoSubject:r.rows[0].cognito_subject??undefined}}catch(e){await c.query('rollback');throw e}finally{c.release()}}
  private async unitsFor(userId:string){const r=await this.pool.query<UnitRow>(`select p.id,p.serial_number,p.opaque_uid,p.status,a.assigned_at from psiu_units p join psiu_assignments a on a.psiu_unit_id=p.id and a.unassigned_at is null where a.user_id=$1 order by a.assigned_at desc`,[userId]);return r.rows.map(unit)}
  private async allUnits(){const r=await this.pool.query<UnitRow>(`select p.id,p.serial_number,p.opaque_uid,p.status,a.assigned_at from psiu_units p left join psiu_assignments a on a.psiu_unit_id=p.id and a.unassigned_at is null order by p.serial_number`);return r.rows.map(unit)}
  private audit(actor:string,action:string,type:string,id:string,requestId:string|undefined,metadata:Record<string,string>){return this.auditClient(this.pool,actor,action,type,id,requestId,metadata)}
  private auditClient(c:Pool|PoolClient,actor:string,action:string,type:string,id:string,requestId:string|undefined,metadata:Record<string,string>){return c.query(`insert into audit_events(id,actor_id,action,subject_type,subject_id,request_id,metadata) values($1,$2,$3,$4,$5,$6,$7::jsonb)`,[randomUUID(),actor,action,type,id,requestId??null,JSON.stringify(metadata)])}
}
function unit(r:UnitRow):CustomerUnit{return{id:r.id,serialNumber:r.serial_number,uid:r.opaque_uid,status:r.status,assignedAt:r.assigned_at?.toISOString()}}
