import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Client, type ClientConfig } from 'pg';

const migrationsDirectory = process.env.MIGRATIONS_DIRECTORY ?? '/app/migrations';

export interface DatabaseSecretClient {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
}

export interface DatabaseSettingsDependencies {
  secrets?: DatabaseSecretClient;
  environment?: NodeJS.ProcessEnv;
}

export async function runMigrations(settings?: ClientConfig): Promise<void> {
  const client = new Client(settings ?? await databaseSettings());
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', ['wally-schema-migrations']);
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const names = (await readdir(migrationsDirectory))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    for (const name of names) {
      const sql = await readFile(join(migrationsDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await client.query<{ checksum: string }>('select checksum from schema_migrations where name = $1', [name]);
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`Migration checksum changed: ${name}`);
        continue;
      }
      if (name === '0001_initial.sql' && await tableExists(client, 'users')) {
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [name, checksum]);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [name, checksum]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', ['wally-schema-migrations']).catch(() => undefined);
    await client.end();
  }
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>('select to_regclass($1) is not null as exists', [`public.${table}`]);
  return result.rows[0]?.exists === true;
}

/** Resolves database credentials at runtime; secret values never enter task definitions. */
export async function databaseSettings(dependencies: DatabaseSettingsDependencies = {}): Promise<ClientConfig> {
  const environment = dependencies.environment ?? process.env;
  const secretArn = requiredEnvironment(environment, 'DATABASE_SECRET_ARN');
  const secrets = dependencies.secrets ?? new SecretsManagerClient({});
  const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!response.SecretString) throw new Error('Database secret must use SecretString.');
  const secret = parseDatabaseSecret(response.SecretString);
  return {
    host: environment.DATABASE_PROXY_HOST || secret.host,
    port: Number(environment.DATABASE_PORT ?? secret.port ?? 5432),
    database: environment.DATABASE_NAME || secret.dbname,
    user: secret.username,
    password: secret.password,
    ssl: environment.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
  };
}

export function parseDatabaseSecret(value: string): { username: string; password: string; host?: string; port?: number; dbname?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('Database secret must contain valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Database secret must be an object.');
  const secret = parsed as Record<string, unknown>;
  if (typeof secret.username !== 'string' || !secret.username || typeof secret.password !== 'string' || !secret.password) {
    throw new Error('Database secret must contain non-empty username and password strings.');
  }
  if (secret.host !== undefined && (typeof secret.host !== 'string' || !secret.host)) throw new Error('Database secret host must be a non-empty string.');
  if (secret.dbname !== undefined && (typeof secret.dbname !== 'string' || !secret.dbname)) throw new Error('Database secret dbname must be a non-empty string.');
  if (secret.port !== undefined && (!Number.isInteger(secret.port) || (secret.port as number) < 1 || (secret.port as number) > 65535)) throw new Error('Database secret port must be a valid integer.');
  return { username: secret.username, password: secret.password, host: secret.host as string | undefined, port: secret.port as number | undefined, dbname: secret.dbname as string | undefined };
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`Missing required database environment variable: ${name}`);
  return value;
}

if (process.argv[1]?.endsWith('migrate.js')) {
  runMigrations().then(() => {
    console.info('Database migrations complete.');
  }).catch((error: unknown) => {
    console.error('Database migration failed.', error);
    process.exitCode = 1;
  });
}
