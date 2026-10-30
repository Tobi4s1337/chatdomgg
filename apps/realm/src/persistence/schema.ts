import type pg from 'pg';
import { RealmStorageUnavailableError } from './database';
import { REALM_MIGRATIONS } from './migrate';

/**
 * Startup check: serve only a schema that holds exactly the migrations this build carries. The server never
 * migrates on its own; `apps/realm/scripts/migrate.mjs` does, under its advisory lock.
 */
export async function assertRealmSchema(pool: Pick<pg.Pool, 'query'>): Promise<void> {
  const present = await pool.query<{ present: boolean }>(`SELECT to_regclass('realm_schema_migrations') IS NOT NULL AS present`);
  if (!present.rows[0]?.present) throw new RealmStorageUnavailableError('The realm schema is not migrated. Run apps/realm/scripts/migrate.mjs first.');
  const rows = await pool.query<{ id: string; checksum: string }>('SELECT id, checksum FROM realm_schema_migrations');
  const applied = new Map(rows.rows.map(row => [row.id, row.checksum]));
  for (const migration of REALM_MIGRATIONS) {
    const checksum = applied.get(migration.id);
    if (checksum === undefined) throw new RealmStorageUnavailableError(`Realm migration ${migration.id} is not applied. Run apps/realm/scripts/migrate.mjs first.`);
    if (checksum !== migration.checksum) throw new RealmStorageUnavailableError(`Applied realm migration ${migration.id} differs from this build; migrations are append-only.`);
  }
  const unknown = [...applied.keys()].filter(id => !REALM_MIGRATIONS.some(m => m.id === id));
  if (unknown.length) throw new RealmStorageUnavailableError(`The realm schema has migrations this build does not know (${unknown.join(', ')}); deploy the newer build.`);
}
