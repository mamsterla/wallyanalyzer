import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { FulfillmentRepository } from './fulfillment.js';

export interface ActiveAdminRepository {
  findActiveAdminByCognitoSubject(subject: string): Promise<{ id: string } | undefined>;
}

export interface InitialAdminRepository {
  withInitialAdminLock<T>(operation: () => Promise<T>): Promise<T>;
  findInitialAdminByEmail(email: string): Promise<{ id: string } | undefined>;
  createInitialAdmin(input: { cognitoSubject: string; email: string }): Promise<{ id: string }>;
}

export class PostgresFulfillmentRepository implements FulfillmentRepository, ActiveAdminRepository, InitialAdminRepository {
  constructor(private readonly pool: Pool) {}

  async findActiveAdminByCognitoSubject(subject: string): Promise<{ id: string } | undefined> {
    const result = await this.pool.query<{ id: string }>(
      `select id from users where cognito_subject = $1 and role = 'admin' and account_status = 'active'`,
      [subject],
    );
    return result.rows[0];
  }

  async withInitialAdminLock<T>(operation: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`select pg_advisory_lock(hashtext($1))`, ['wally-initial-admin-bootstrap']);
      return await operation();
    } finally {
      await client.query(`select pg_advisory_unlock(hashtext($1))`, ['wally-initial-admin-bootstrap']).catch(() => undefined);
      client.release();
    }
  }

  async findInitialAdminByEmail(email: string): Promise<{ id: string } | undefined> {
    const result = await this.pool.query<{ id: string }>(
      `select id from users where email = $1 and role = 'admin' and account_status = 'active'`,
      [email],
    );
    return result.rows[0];
  }

  async createInitialAdmin(input: { cognitoSubject: string; email: string }): Promise<{ id: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, ['wally-initial-admin']);
      const existingAdmin = await client.query<{ id: string; cognito_subject: string; email: string }>(
        `select id, cognito_subject, email from users where role = 'admin' for update`,
      );
      if (existingAdmin.rowCount) {
        const existing = existingAdmin.rows[0];
        if (existing.cognito_subject === input.cognitoSubject && existing.email === input.email) {
          await client.query('commit');
          return { id: existing.id };
        }
        throw new Error('An initial administrator already exists.');
      }
      const existingIdentity = await client.query(
        `select 1 from users where cognito_subject = $1 or email = $2`,
        [input.cognitoSubject, input.email],
      );
      if (existingIdentity.rowCount) throw new Error('Bootstrap identity is already associated with another account.');

      const id = randomUUID();
      await client.query(
        `insert into users (id, cognito_subject, email, role, account_status, lifecycle)
         values ($1, $2, $3, 'admin', 'active', 'active')`,
        [id, input.cognitoSubject, input.email],
      );
      await insertAuditEvent(client, id, 'admin.bootstrap', 'user', id, undefined, {});
      await client.query('commit');
      return { id };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordProvisionedAccount(input: Parameters<FulfillmentRepository['recordProvisionedAccount']>[0]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into users (id, cognito_subject, email, role, account_status, lifecycle, invited_at)
         values ($1, $2, $3, 'user', 'provisioned', 'invited', now())`,
        [input.userId, input.cognitoSubject, input.email],
      );
      await client.query(
        `insert into psiu_units (id, serial_number, opaque_uid, created_by)
         values ($1, $2, $3, $4)`,
        [input.psiuUnitId, input.serialNumber, input.opaqueUid ?? null, input.assignedByUserId],
      );
      await client.query(
        `insert into psiu_assignments (id, psiu_unit_id, user_id, assigned_by)
         values ($1, $2, $3, $4)`,
        [input.assignmentId, input.psiuUnitId, input.userId, input.assignedByUserId],
      );
      await insertAuditEvent(client, input.assignedByUserId, 'fulfillment.provisioned', 'psiu_assignment', input.assignmentId, input.requestId, {
        userId: input.userId,
        psiuUnitId: input.psiuUnitId,
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertAuditEvent(client: PoolClient, actorId: string, action: string, subjectType: string, subjectId: string, requestId: string | undefined, metadata: Record<string, string>): Promise<void> {
  await client.query(
    `insert into audit_events (id, actor_id, action, subject_type, subject_id, request_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [randomUUID(), actorId, action, subjectType, subjectId, requestId ?? null, JSON.stringify(metadata)],
  );
}
