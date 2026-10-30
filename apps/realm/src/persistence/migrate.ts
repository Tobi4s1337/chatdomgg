import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * Additive, ordered SQL migrations for the one realm schema the realm and the API share.
 * Files are embedded at build time, so a bundled server migrates exactly the schema it was built against.
 * An applied migration is never edited: a changed checksum stops startup instead of silently diverging.
 */
const FILES = import.meta.glob<string>('./migrations/*.sql', { query: '?raw', import: 'default', eager: true });

export interface RealmMigration { readonly id: string; readonly sql: string; readonly checksum: string }
export const REALM_MIGRATIONS: readonly RealmMigration[] = Object.entries(FILES)
  .map(([path, sql]) => ({ id: path.replace(/^.*\/(.+)\.sql$/, '$1'), sql, checksum: createHash('sha256').update(sql).digest('hex') }))
  .sort((a, b) => a.id.localeCompare(b.id));

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
export function realmSchemaName(schema: string): string {
  if (!SCHEMA_NAME.test(schema) || schema.startsWith('pg_')) throw new Error('The realm database schema name must be a lowercase identifier');
  return schema;
}

/** Applies every missing migration in one transaction under a database-wide advisory lock. Returns the applied IDs. */
export async function migrateRealmSchema(pool: Pool, schema: string): Promise<string[]> {
  const name = realmSchemaName(schema), client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('chatdom.realm.migrate'))");
    await client.query(`create schema if not exists "${name}"`);
    await client.query(`set local search_path to "${name}"`);
    await client.query(`create table if not exists realm_schema_migrations (
      id text primary key, checksum text not null check (checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz not null default now())`);
    const applied = await appliedMigrations(client), ran: string[] = [];
    for (const migration of REALM_MIGRATIONS) {
      const checksum = applied.get(migration.id);
      if (checksum === migration.checksum) continue;
      if (checksum !== undefined) throw new Error(`Realm migration ${migration.id} changed after it was applied; add a new migration instead`);
      await client.query(migration.sql);
      await client.query('insert into realm_schema_migrations (id, checksum) values ($1, $2)', [migration.id, migration.checksum]);
      ran.push(migration.id);
    }
    const unknown = [...applied.keys()].filter(id => !REALM_MIGRATIONS.some(m => m.id === id));
    if (unknown.length) throw new Error(`The realm schema has migrations this build does not know (${unknown.join(', ')}); deploy the newer build`);
    await client.query('commit');
    return ran;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function appliedMigrations(client: PoolClient): Promise<Map<string, string>> {
  const rows = await client.query<{ id: string; checksum: string }>('select id, checksum from realm_schema_migrations');
  return new Map(rows.rows.map(row => [row.id, row.checksum]));
}
