import type { Pool } from 'pg';
import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, TokenSchema } from '@chatdom/shared';
import type { RealmRoomServices } from '../ports';

export interface GatherParticipant { readonly person: string; readonly name: string; readonly seat: number }
export interface GatherSnapshot {
  readonly table: string; readonly version: number; readonly kind: 'pong' | 'stones' | 'hearth-dice';
  readonly match: string; readonly players: readonly GatherParticipant[]; readonly state: unknown; readonly at: number;
}
export interface GatherCommandRecord { readonly id: string; readonly actor: string | null; readonly payload: string; readonly at: number }
export interface GatherStore {
  load(kingdom: string): Promise<readonly GatherSnapshot[]>;
  commit(kingdom: string, expectedVersion: number | null, next: GatherSnapshot, command: GatherCommandRecord): Promise<'committed' | 'duplicate' | 'conflict'>;
}

const MAX_JSON_BYTES = 64 * 1024;
const versionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const snapshotSchema = z.strictObject({
  table: TokenSchema, version: versionSchema, kind: z.enum(['pong', 'stones', 'hearth-dice']), match: TokenSchema,
  players: z.array(z.strictObject({ person: TokenSchema, name: DisplayNameSchema, seat: z.number().int().min(0).max(3) })).max(4),
  state: z.unknown(), at: EpochMsSchema,
});
const commandSchema = z.strictObject({ id: TokenSchema, actor: TokenSchema.nullable(), payload: z.string(), at: EpochMsSchema });
const servicesStores = new WeakMap<RealmRoomServices, GatherStore>();
export function installGatherStore(services: RealmRoomServices, store: GatherStore): void { servicesStores.set(services, store); }
export function gatherStoreFor(services: RealmRoomServices): GatherStore | undefined { return servicesStores.get(services); }

function invalid(): never { throw new Error('Invalid gather storage record.'); }
function validKingdom(kingdom: string): void { if (!TokenSchema.safeParse(kingdom).success) invalid(); }
function bounded(text: string): void { if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) invalid(); }

/** Reject lossy JSON (including non-finite numbers), prototypes, cycles and excessive nesting before encoding. */
function jsonText(value: unknown): string {
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (depth > 64) invalid();
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) invalid(); return; }
    if (typeof item !== 'object' || ancestors.has(item)) invalid();
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) invalid();
    ancestors.add(item);
    // Only data properties are accepted: serialization must never execute getters or a custom toJSON.
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) invalid();
      if (Array.isArray(item) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) invalid();
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length) invalid();
    ancestors.delete(item);
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  if (typeof text !== 'string') invalid();
  bounded(text);
  return text;
}
function decode(text: string): GatherSnapshot {
  bounded(text);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { invalid(); }
  jsonText(raw);
  const result = snapshotSchema.safeParse(raw);
  if (!result.success) invalid();
  const players = result.data.players;
  if (new Set(players.map(player => player.person)).size !== players.length || new Set(players.map(player => player.seat)).size !== players.length) invalid();
  return result.data;
}
interface Prepared { readonly snapshot: GatherSnapshot; readonly text: string; readonly command: GatherCommandRecord; readonly actorKey: string }
function prepare(kingdom: string, expectedVersion: number | null, next: GatherSnapshot, command: GatherCommandRecord): Prepared {
  validKingdom(kingdom);
  if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) invalid();
  const text = jsonText(next), snapshot = decode(text);
  if (snapshot.version !== (expectedVersion ?? 0) + 1) invalid();
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) invalid();
  bounded(parsed.data.payload);
  try { jsonText(JSON.parse(parsed.data.payload)); } catch { invalid(); }
  return { snapshot, text, command: parsed.data, actorKey: parsed.data.actor === null ? 'system' : `user:${parsed.data.actor}` };
}
interface Receipt { readonly table: string; readonly expectedVersion: number | null; readonly payload: string }
function sameReceipt(receipt: Receipt, expectedVersion: number | null, prepared: Prepared): boolean {
  return receipt.table === prepared.snapshot.table && receipt.expectedVersion === expectedVersion && receipt.payload === prepared.command.payload;
}

/** Explicit test adapter. Production must install the Postgres store, never silently fall back to this one. */
export class MemoryGatherStore implements GatherStore {
  private readonly kingdoms = new Map<string, { checkpoints: Map<string, string>; moves: Map<string, Receipt & { snapshot: string; command: GatherCommandRecord }> }>();
  async load(kingdom: string): Promise<readonly GatherSnapshot[]> {
    validKingdom(kingdom);
    return [...(this.kingdoms.get(kingdom)?.checkpoints.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => decode(text));
  }
  async commit(kingdom: string, expectedVersion: number | null, next: GatherSnapshot, command: GatherCommandRecord): Promise<'committed' | 'duplicate' | 'conflict'> {
    const prepared = prepare(kingdom, expectedVersion, next, command);
    const data = this.kingdoms.get(kingdom) ?? { checkpoints: new Map(), moves: new Map() };
    const key = JSON.stringify([prepared.actorKey, prepared.command.id]), receipt = data.moves.get(key);
    if (receipt) return sameReceipt(receipt, expectedVersion, prepared) ? 'duplicate' : 'conflict';
    const previous = data.checkpoints.get(prepared.snapshot.table);
    if ((previous === undefined ? null : decode(previous).version) !== expectedVersion) return 'conflict';
    // All validation and copying precede the synchronous atomic publication of both records.
    data.checkpoints.set(prepared.snapshot.table, prepared.text);
    data.moves.set(key, { table: prepared.snapshot.table, expectedVersion, payload: prepared.command.payload, snapshot: prepared.text, command: prepared.command });
    this.kingdoms.set(kingdom, data);
    return 'committed';
  }
}

/** Uses the realm's configured pool and search path; the caller owns its lifetime. */
export function createPostgresGatherStore(pool: Pool): GatherStore {
  return {
    async load(kingdom) {
      validKingdom(kingdom);
      const result = await pool.query<{ table_id: string; version: string; snapshot: string }>(
        'SELECT table_id, version, snapshot FROM gather_table_checkpoints WHERE kingdom_id = $1 ORDER BY table_id', [kingdom]);
      return result.rows.map(row => {
        const snapshot = decode(row.snapshot);
        if (snapshot.table !== row.table_id || snapshot.version !== Number(row.version)) invalid();
        return snapshot;
      });
    },
    async commit(kingdom, expectedVersion, next, command) {
      const prepared = prepare(kingdom, expectedVersion, next, command), { snapshot } = prepared;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Separate advisory-lock namespaces prevent a receipt/table hash collision from reversing lock order.
        await client.query('SELECT pg_advisory_xact_lock(7141, hashtext($1))', [JSON.stringify([kingdom, prepared.actorKey, prepared.command.id])]);
        const prior = await client.query<{ table_id: string; expected_version: string | null; payload: string }>(
          'SELECT table_id, expected_version, payload FROM gather_table_moves WHERE kingdom_id = $1 AND actor_key = $2 AND command_id = $3',
          [kingdom, prepared.actorKey, prepared.command.id]);
        const row = prior.rows[0];
        if (row) {
          const same = sameReceipt({ table: row.table_id, expectedVersion: row.expected_version === null ? null : Number(row.expected_version), payload: row.payload }, expectedVersion, prepared);
          await client.query('ROLLBACK');
          return same ? 'duplicate' : 'conflict';
        }
        await client.query('SELECT pg_advisory_xact_lock(7142, hashtext($1))', [JSON.stringify([kingdom, snapshot.table])]);
        const checkpoint = expectedVersion === null
          ? await client.query(`INSERT INTO gather_table_checkpoints (kingdom_id, table_id, version, snapshot, at_ms)
              VALUES ($1, $2, $3, $4, $5) ON CONFLICT (kingdom_id, table_id) DO NOTHING RETURNING table_id`,
          [kingdom, snapshot.table, snapshot.version, prepared.text, snapshot.at])
          : await client.query(`UPDATE gather_table_checkpoints SET version = $3, snapshot = $4, at_ms = $5
              WHERE kingdom_id = $1 AND table_id = $2 AND version = $6 RETURNING table_id`,
          [kingdom, snapshot.table, snapshot.version, prepared.text, snapshot.at, expectedVersion]);
        if (checkpoint.rowCount !== 1) { await client.query('ROLLBACK'); return 'conflict'; }
        await client.query(`INSERT INTO gather_table_moves
          (kingdom_id, actor_key, command_id, actor_id, table_id, expected_version, version, payload, snapshot, at_ms)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [kingdom, prepared.actorKey, prepared.command.id, prepared.command.actor, snapshot.table, expectedVersion, snapshot.version, prepared.command.payload, prepared.text, prepared.command.at]);
        await client.query('COMMIT');
        return 'committed';
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },
  };
}
