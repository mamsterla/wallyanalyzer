import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const migrationsDirectory = process.env.MIGRATIONS_DIRECTORY ?? '/app/migrations';

export async function runMigrations(settings = databaseSettings()): Promise<void> {
  const client = new Client(settings);
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

export function databaseSettings(): { connectionString?: string; host?: string; port?: number; database?: string; user?: string; password?: string; ssl?: { rejectUnauthorized: boolean } } {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  const host = requiredEnvironment('DATABASE_PROXY_HOST');
  return {
    host,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: requiredEnvironment('DATABASE_NAME'),
    user: requiredEnvironment('DATABASE_USERNAME'),
    password: requiredEnvironment('DATABASE_PASSWORD'),
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required database environment variable: ${name}`);
  return value;
}

if (process.argv[1]?.endsWith('migrate.js')) {
  runMigrations().then(() => console.info('Database migrations complete.')).catch((error: unknown) => {
    console.error('Database migration failed.', error);
    process.exitCode = 1;
  });
}
