import type { Pool } from 'pg';
import { KingdomIdSchema } from '@chatdom/shared';
import type { CourtState } from './court';

/**
 * The fire's private checkpoint: the running round (or none) at an increasing version. Each accepted change is
 * committed before anything about it is published, so a restart resumes exactly what people last saw.
 */
export interface FireSnapshot { readonly version: number; readonly at: number; readonly court: CourtState | null }
export interface FireStore {
  load(kingdom: string, site: string): Promise<FireSnapshot | null>;
  save(kingdom: string, site: string, expectedVersion: number | null, next: FireSnapshot): Promise<'committed' | 'conflict'>;
}

const MAX_BYTES = 2 * 1024 * 1024;
const SITE = /^[a-z][a-z0-9-]{0,63}$/;
function invalid(): never { throw new Error('Invalid campfire checkpoint.'); }

function encode(kingdom: string, site: string, expected: number | null, next: FireSnapshot): string {
  if (!KingdomIdSchema.safeParse(kingdom).success || !SITE.test(site)) invalid();
  if (!Number.isSafeInteger(next.version) || next.version !== (expected ?? 0) + 1 || !Number.isSafeInteger(next.at) || next.at < 0) invalid();
  const text = JSON.stringify(next);
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) invalid();
  return text;
}
function decode(text: string): FireSnapshot {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) invalid();
  const raw = JSON.parse(text) as FireSnapshot;
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.version) || raw.version < 1 || !Number.isSafeInteger(raw.at)) invalid();
  if (raw.court !== null && (typeof raw.court !== 'object' || typeof raw.court.match !== 'string' || !Array.isArray(raw.court.players))) invalid();
  return raw;
}

/** Explicit test adapter; production installs the Postgres store. */
export class MemoryFireStore implements FireStore {
  private readonly rows = new Map<string, string>();
  /** Test hook: the next `save` fails as if the database were away. */
  failNext = false;
  async load(kingdom: string, site: string): Promise<FireSnapshot | null> {
    const text = this.rows.get(`${kingdom}\n${site}`);
    return text === undefined ? null : decode(text);
  }
  async save(kingdom: string, site: string, expected: number | null, next: FireSnapshot): Promise<'committed' | 'conflict'> {
    const text = encode(kingdom, site, expected, next);
    if (this.failNext) { this.failNext = false; throw new Error('The fire store is unavailable.'); }
    const key = `${kingdom}\n${site}`, current = this.rows.get(key);
    if ((current === undefined ? null : decode(current).version) !== expected) return 'conflict';
    this.rows.set(key, text);
    return 'committed';
  }
}

/** Uses the realm's configured pool and search path (migration `0016b`); the caller owns its lifetime. */
export function createPostgresFireStore(pool: Pool): FireStore {
  return {
    async load(kingdom, site) {
      if (!KingdomIdSchema.safeParse(kingdom).success || !SITE.test(site)) invalid();
      const result = await pool.query<{ version: string; snapshot: string }>(
        'SELECT version, snapshot FROM gather_fire_checkpoints WHERE kingdom_id = $1 AND site = $2', [kingdom, site]);
      const row = result.rows[0];
      if (!row) return null;
      const snapshot = decode(row.snapshot);
      if (snapshot.version !== Number(row.version)) invalid();
      return snapshot;
    },
    async save(kingdom, site, expected, next) {
      const text = encode(kingdom, site, expected, next);
      const result = expected === null
        ? await pool.query(`INSERT INTO gather_fire_checkpoints (kingdom_id, site, version, snapshot, at_ms) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (kingdom_id, site) DO NOTHING`, [kingdom, site, next.version, text, next.at])
        : await pool.query(`UPDATE gather_fire_checkpoints SET version = $3, snapshot = $4, at_ms = $5
            WHERE kingdom_id = $1 AND site = $2 AND version = $6`, [kingdom, site, next.version, text, next.at, expected]);
      return result.rowCount === 1 ? 'committed' : 'conflict';
    },
  };
}
