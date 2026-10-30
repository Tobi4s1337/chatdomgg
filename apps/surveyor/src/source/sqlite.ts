import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { AtlasError } from '../errors';

/**
 * Read-only snapshot of the running Surveyor's inventories that have no HTTP endpoint.
 *
 * The connection is opened `readOnly`, so SQLite itself refuses any write. Every statement is one of the SELECTs
 * below (tests assert that list is exhaustive and read-only). No PRAGMA is issued: the collector's journal mode,
 * WAL and retention belong to it. All reads happen inside one deferred transaction, which in WAL mode pins a single
 * consistent snapshot while the collector keeps writing; a sweep committed mid-read is simply not part of it.
 */
export const SOURCE_SQL = Object.freeze({
  tables: `SELECT name FROM sqlite_master WHERE type = 'table'`,
  columns: `SELECT name FROM pragma_table_info(?)`,
  sweeps: `SELECT at, streams, calls, ms FROM sweeps ORDER BY at`,
  channels: `SELECT id, login, name, lang, first_seen, last_live, live_min, viewer_min, peak, game_id, game, title, viewers,
    started_at, live, last_sweep, avatar, facts_at, gone_at FROM channels`,
  categories: `SELECT channel, game_id, minutes FROM cat_minutes`,
  games: `SELECT id, name FROM games`,
  raidPairs: `SELECT from_id, to_id, n, viewers, last_at FROM raids`,
  raidObservations: `SELECT at, from_id, to_id, viewers, kept FROM rec_raids ORDER BY at, from_id, to_id`,
  settlers: `SELECT count(*) AS n FROM settlers`,
  recorder: `SELECT count(*) AS frames, min(at) AS first_at, max(at) AS last_at FROM rec_frames`,
});

/** The columns this adapter relies on. A source without them is a different collector, not something to guess at. */
export const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  sweeps: ['at', 'streams', 'calls', 'ms'],
  channels: ['id', 'login', 'name', 'lang', 'first_seen', 'last_live', 'live_min', 'viewer_min', 'peak', 'game_id', 'game',
    'title', 'viewers', 'started_at', 'live', 'last_sweep', 'avatar', 'facts_at', 'gone_at'],
  cat_minutes: ['channel', 'game_id', 'minutes'],
  games: ['id', 'name'],
  raids: ['from_id', 'to_id', 'n', 'viewers', 'last_at'],
  rec_raids: ['at', 'from_id', 'to_id', 'viewers', 'kept'],
  settlers: ['holding', 'channel'],
  rec_frames: ['at'],
});

export interface SourceChannelRow {
  id: unknown; login: unknown; name: unknown; lang: unknown; first_seen: unknown; last_live: unknown;
  live_min: unknown; viewer_min: unknown; peak: unknown; game_id: unknown; game: unknown; title: unknown;
  viewers: unknown; started_at: unknown; live: unknown; last_sweep: unknown; avatar: unknown; facts_at: unknown;
  gone_at: unknown;
}

export interface SourceSnapshot {
  path: string;
  bytes: number;
  walBytes: number | null;
  openedAt: number;
  readMs: number;
  sweeps: { at: unknown; streams: unknown; calls: unknown; ms: unknown }[];
  channels: SourceChannelRow[];
  categories: { channel: unknown; game_id: unknown; minutes: unknown }[];
  games: { id: unknown; name: unknown }[];
  raidPairs: { from_id: unknown; to_id: unknown; n: unknown; viewers: unknown; last_at: unknown }[];
  raidObservations: { at: unknown; from_id: unknown; to_id: unknown; viewers: unknown; kept: unknown }[];
  settlers: number;
  recorder: { frames: number; firstAt: number | null; lastAt: number | null };
}

export interface SnapshotOptions {
  now?: () => number;
  /** Test seam: runs inside the read transaction after the first inventory is read. */
  afterFirstRead?: () => void;
}

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export function readSourceSnapshot(path: string | null, options: SnapshotOptions = {}): SourceSnapshot {
  if (!path) {
    throw new AtlasError('inventory-missing',
      'The Surveyor HTTP API has no channel, category or raid inventory. Set SURVEYOR_DB_PATH to its database or a supplied snapshot, opened read-only.');
  }
  const bytes = sizeOf(path);
  if (bytes === null) throw new AtlasError('inventory-missing', `No source database at SURVEYOR_DB_PATH (${path}).`);
  const now = options.now ?? Date.now;
  const openedAt = now();
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw new AtlasError('inventory-missing', `The source database could not be opened read-only: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    db.exec('BEGIN DEFERRED');
    try {
      const tables = new Set((db.prepare(SOURCE_SQL.tables).all() as { name: string }[]).map((row) => row.name));
      const missing: string[] = [];
      for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
        if (!tables.has(table)) {
          missing.push(`table ${table}`);
          continue;
        }
        const present = new Set((db.prepare(SOURCE_SQL.columns).all(table) as { name: string }[]).map((row) => row.name));
        for (const column of columns) if (!present.has(column)) missing.push(`${table}.${column}`);
      }
      if (missing.length) throw new AtlasError('source-schema', 'The source database is not the expected Surveyor schema.', missing);

      const sweeps = db.prepare(SOURCE_SQL.sweeps).all() as SourceSnapshot['sweeps'];
      options.afterFirstRead?.();
      const channels = db.prepare(SOURCE_SQL.channels).all() as unknown as SourceChannelRow[];
      const categories = db.prepare(SOURCE_SQL.categories).all() as SourceSnapshot['categories'];
      const games = db.prepare(SOURCE_SQL.games).all() as SourceSnapshot['games'];
      const raidPairs = db.prepare(SOURCE_SQL.raidPairs).all() as SourceSnapshot['raidPairs'];
      const raidObservations = db.prepare(SOURCE_SQL.raidObservations).all() as SourceSnapshot['raidObservations'];
      const settlers = Number((db.prepare(SOURCE_SQL.settlers).get() as { n: number }).n);
      const recorderRow = db.prepare(SOURCE_SQL.recorder).get() as { frames: number; first_at: number | null; last_at: number | null };
      return {
        path, bytes, walBytes: sizeOf(`${path}-wal`), openedAt, readMs: Math.max(0, now() - openedAt),
        sweeps, channels, categories, games, raidPairs, raidObservations, settlers,
        recorder: { frames: Number(recorderRow.frames), firstAt: recorderRow.first_at, lastAt: recorderRow.last_at },
      };
    } finally {
      // Ending a read transaction never writes; ROLLBACK also releases the snapshot after an error.
      if (db.isTransaction) db.exec('ROLLBACK');
    }
  } catch (error) {
    if (error instanceof AtlasError) throw error;
    throw new AtlasError('inventory-missing', `The source database could not be read: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db.close();
  }
}
