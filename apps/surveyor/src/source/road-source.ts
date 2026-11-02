import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { AtlasRaidSchema, EpochMsSchema, type AtlasRaid } from '@chatdom/shared';
import { AtlasError } from '../errors';
import { RaidPairSchema, type RaidPair } from '../export/schema';

/** The recorder adapter never reads the channel inventory or changes collector settings. */
export const ROAD_SOURCE_SQL = Object.freeze({
  tables: `SELECT name FROM sqlite_master WHERE type = 'table'`,
  columns: `SELECT name FROM pragma_table_info(?)`,
  observations: `SELECT at, from_id, to_id, viewers, kept FROM rec_raids ORDER BY at, from_id, to_id, viewers, kept`,
  pairs: `SELECT from_id, to_id, n, viewers, last_at FROM raids ORDER BY from_id, to_id, n, viewers, last_at`,
});

const REQUIRED_COLUMNS = Object.freeze({
  rec_raids: ['at', 'from_id', 'to_id', 'viewers', 'kept'],
  raids: ['from_id', 'to_id', 'n', 'viewers', 'last_at'],
});

interface RecorderRow {
  at: unknown;
  from_id: unknown;
  to_id: unknown;
  viewers: unknown;
  kept: unknown;
}

interface PairRow {
  from_id: unknown;
  to_id: unknown;
  n: unknown;
  viewers: unknown;
  last_at: unknown;
}

export interface RoadSourceSnapshot {
  cutAt: number;
  raids: AtlasRaid[];
  pairs: RaidPair[];
  /** Opaque content identity, with no source path or upstream cursor claim. */
  reference: string;
  /** Bounds of retained, eligible recorder observations, not lifetime road coverage. */
  firstAt: number | null;
  lastAt: number | null;
  /** Valid rows outside the cut are retried on a later read, never silently treated as current. */
  futureRows: number;
}

export interface RoadSourceOptions {
  now?: () => number;
  /** Runs after the first SELECT pins the deferred transaction's snapshot. */
  afterFirstRead?: () => void;
}

function invalidRows(): AtlasError {
  return new AtlasError('inventory-invalid', 'The road source contains invalid raid rows.');
}

/** Only fixed messages escape this boundary: SQLite errors can contain source paths or source text. */
function readRows(path: string, options: RoadSourceOptions): { observations: RecorderRow[]; pairs: PairRow[] } {
  let db: DatabaseSync | undefined;
  try {
    try {
      if (typeof path !== 'string' || path.length === 0) throw new Error('Missing source.');
      db = new DatabaseSync(path, { readOnly: true });
      db.exec('BEGIN DEFERRED');
      const tables = new Set((db.prepare(ROAD_SOURCE_SQL.tables).all() as { name: string }[]).map((row) => row.name));
      options.afterFirstRead?.();
      for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
        if (!tables.has(table)) throw new AtlasError('source-schema', 'The road source database is not the expected Surveyor schema.');
        const present = new Set((db.prepare(ROAD_SOURCE_SQL.columns).all(table) as { name: string }[]).map((row) => row.name));
        if (columns.some((column) => !present.has(column))) {
          throw new AtlasError('source-schema', 'The road source database is not the expected Surveyor schema.');
        }
      }
      return {
        observations: db.prepare(ROAD_SOURCE_SQL.observations).all() as unknown as RecorderRow[],
        pairs: db.prepare(ROAD_SOURCE_SQL.pairs).all() as unknown as PairRow[],
      };
    } finally {
      if (db) {
        try {
          if (db.isTransaction) db.exec('ROLLBACK');
        } finally {
          db.close();
        }
      }
    }
  } catch (error) {
    if (error instanceof AtlasError && error.code === 'source-schema') {
      throw new AtlasError('source-schema', 'The road source database is not the expected Surveyor schema.');
    }
    throw new AtlasError('inventory-missing', 'The road source database could not be read read-only.');
  }
}

/**
 * Capture one read-only SQLite snapshot of both road tables. Validate every row, including rows beyond the cut,
 * before returning anything to the writer. Close the read transaction before normalization or ledger work.
 */
export function readRoadSource(path: string, options: RoadSourceOptions = {}): RoadSourceSnapshot {
  const parsedCut = EpochMsSchema.safeParse((options.now ?? Date.now)());
  if (!parsedCut.success) throw invalidRows();
  const cutAt = parsedCut.data;
  const rows = readRows(path, options);
  const raids: AtlasRaid[] = [];
  const pairs: RaidPair[] = [];
  const seenRaids = new Set<string>();
  const seenPairs = new Map<string, string>();
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let futureRows = 0;
  for (const row of rows.observations) {
    if (row.kept !== 0 && row.kept !== 1) throw invalidRows();
    const at = EpochMsSchema.safeParse(row.at);
    if (!at.success) throw invalidRows();
    // Exactly the importer's legacy content key; the recorder has no upstream message identity.
    const id = `recorder:${at.data}:${String(row.from_id)}:${String(row.to_id)}:${String(row.viewers)}`;
    const parsed = AtlasRaidSchema.safeParse({
      version: 1, id, fromKingdomId: row.from_id, toKingdomId: row.to_id, viewers: row.viewers,
      observedAt: at.data, occurredAt: null, evidence: { kind: 'observed', asOf: at.data },
      delivery: 'resumable', source: 'surveyor-recorder',
    });
    if (!parsed.success) throw invalidRows();
    if (parsed.data.observedAt > cutAt) { futureRows++; continue; }
    if (seenRaids.has(id)) continue;
    seenRaids.add(id);
    raids.push(parsed.data);
    firstAt = Math.min(firstAt ?? parsed.data.observedAt, parsed.data.observedAt);
    lastAt = Math.max(lastAt ?? parsed.data.observedAt, parsed.data.observedAt);
  }
  for (const row of rows.pairs) {
    const parsed = RaidPairSchema.safeParse({
      fromKingdomId: row.from_id, toKingdomId: row.to_id, raids: row.n, viewersTotal: row.viewers, lastAt: row.last_at,
    });
    if (!parsed.success) throw invalidRows();
    const pair = parsed.data;
    if (pair.lastAt > cutAt) { futureRows++; continue; }
    const key = `${pair.fromKingdomId}>${pair.toKingdomId}`;
    const canonical = JSON.stringify(pair);
    const previous = seenPairs.get(key);
    if (previous !== undefined) {
      if (previous !== canonical) throw invalidRows();
      continue;
    }
    seenPairs.set(key, canonical);
    pairs.push(pair);
  }
  const hash = createHash('sha256').update(JSON.stringify([raids, pairs, futureRows])).digest('hex');
  return { cutAt, raids, pairs, reference: `db-${cutAt}-${hash}`, firstAt, lastAt, futureRows };
}
