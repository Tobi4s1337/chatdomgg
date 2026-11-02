/**
 * The Raid Gate's stamps in the passport (RS12, spec 45 R1–R3, spec 23 R8).
 *
 * The gate's stamp authority (`RaidGuestAuthority`, 0011d) already records a verified stamp for every raider who
 * walked in with a witnessed raid (a visit) and every citizen of the raiding kingdom who chatted at its destination
 * within ten minutes (a raid). This module reads that history for the passport reader of `apps/api/src/passport`:
 *
 * - `stamps`: one page of the holder's stamps, newest first, as the gate's minimal `PassportStamp`. The reader
 *   enriches them only from the records below, which correspond to the stamp itself.
 * - `visits`: the kingdoms those stamps reached, first and last arrival, newest first.
 * - `kingdoms`: each kingdom's name as the witnessed raid named its channel, and its arms exactly as the Atlas and
 *   the caravan draw them (seeded from the channel ID), in the passport's crest grammar.
 * - `roads`: the witnessed raid's road (its Atlas road ID, from, to). The leader stays unknown: Twitch never says who
 *   led, and it is never filled from the broadcaster.
 * - `gifts`: none. No accepted gift receipt is linked to a guest stamp, and none is invented.
 *
 * "Hide my travels" is the holder's own choice, kept beside the stamps (0011f). While it is hidden the stamps port
 * answers hidden (so the whole book closes) and the visits port refuses, read in the same snapshot as the history,
 * so a late page can never reopen what was closed. The card source folds the choice into `travelsHidden` and its
 * person revision (`cardTravels`), which is what the reader checks before and after every read.
 */
import type { PassportCrest, PassportKingdom } from '@chatdom/shared/passport';
import { PassportKingdomSchema } from '@chatdom/shared/passport';
import { HERALDRY_VERSION, TINCTURES, shieldDesign, type PartitionLine } from '../../../web/src/atlas/heraldry/design';
import type { ChargeKind } from '../../../web/src/atlas/heraldry/charges';
import type { PassportItem } from '../passport/contracts';
import type { WitnessedRoad } from '../passport/gate';
import type { PassportPorts, RevisionedPage } from '../passport/read';
import type { PassportStamp as GateStamp, PassportView, PersonId } from './contracts';
import { RaidGuestStampSchema, type RaidGuestStamp } from './guest-contracts';
import type { SqlClient, SqlPool } from './postgres-repository';

/** The holder's choice as the gate last recorded it. Never chosen is shown, at change time 0. */
export interface GateTravelChoice { readonly hidden: boolean; readonly changedAt: number }
export const SHOWN: GateTravelChoice = Object.freeze({ hidden: false, changedAt: 0 });

/** One witnessed raid as the passport needs it: its channels and their witnessed display names. */
export interface GateRaidRoad {
  readonly raidId: string;
  readonly from: Readonly<{ kingdomId: string; name: string }>;
  readonly to: Readonly<{ kingdomId: string; name: string }>;
}

/** What the gate's tables hold for the passport. Each method is one consistent read. */
export interface GatePassportStore {
  readonly origin: 'live' | 'simulated';
  /** The choice, the stamp head and up to `limit` stamps with a sequence below `before`, newest first. */
  stamps(person: PersonId, before: number | null, limit: number): Promise<Readonly<{
    choice: GateTravelChoice; head: number; items: readonly Readonly<{ sequence: number; stamp: RaidGuestStamp }>[];
  }>>;
  /** The choice, the stamp head and the kingdoms the stamps reached (newest last arrival first) from `offset`. */
  visits(person: PersonId, offset: number, limit: number): Promise<Readonly<{
    choice: GateTravelChoice; head: number; items: readonly Readonly<{ kingdomId: string; firstAt: number; lastAt: number }>[];
  }>>;
  /** The latest witnessed display name of each channel ID that appears in a witnessed raid. */
  channels(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  raids(raidIds: readonly string[]): Promise<ReadonlyMap<string, GateRaidRoad>>;
  choice(person: PersonId): Promise<GateTravelChoice>;
  /** Records the choice; a change always moves `changedAt` forward. Answers the choice as it now stands. */
  choose(person: PersonId, hidden: boolean, now: number): Promise<GateTravelChoice>;
}

export class GatePassportHidden extends Error {
  constructor() { super('The holder keeps their travels private.'); this.name = 'GatePassportHidden'; }
}

// ---------------------------------------------------------------- arms

/**
 * The Atlas's charges in the passport's four. A shield without a charge takes its line of partition: a wavy line is
 * water, an indented or embattled one a mountain, an engrailed one a leaf, a straight one a star.
 */
const CHARGE_OF: Readonly<Record<ChargeKind, PassportCrest['charge']>> = {
  mullet: 'star', sun: 'star', crossPattee: 'star', lozenge: 'star', mascle: 'star', roundel: 'star', annulet: 'star', martlet: 'star',
  lily: 'oak', tree: 'oak', trefoil: 'oak',
  fish: 'wave', crescent: 'wave',
  tower: 'mountain', anvil: 'mountain', bell: 'mountain',
};
const LINE_CHARGE: Readonly<Record<PartitionLine, PassportCrest['charge']>> = {
  wavy: 'wave', indented: 'mountain', embattled: 'mountain', engrailed: 'oak', straight: 'star',
};

/**
 * A channel's arms in the passport's crest grammar: the Atlas heater in the Atlas's own two pigments, field first,
 * with the charge the shield carries (or its line). Null for anything that is not a channel ID: no arms are invented.
 */
export function gateCrest(kingdomId: string): PassportCrest | null {
  let design;
  try { design = shieldDesign(kingdomId); } catch { return null; }
  return {
    key: `atlas-arms.${HERALDRY_VERSION}.${kingdomId}`, shape: 'heater',
    charge: design.charge ? CHARGE_OF[design.charge.kind] : LINE_CHARGE[design.line],
    colours: [TINCTURES[design.field].pigment, TINCTURES[design.second].pigment],
    assetHash: null,
  };
}

/** A kingdom as the passport draws it, or null when the name or the arms cannot be had honestly. */
export function gateKingdom(kingdomId: string, name: string | undefined): PassportKingdom | null {
  const crest = gateCrest(kingdomId);
  if (!crest || !name) return null;
  const parsed = PassportKingdomSchema.safeParse({ kingdomId, name, crest });
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------- the reader's ports

/** Stamps on one page of the book (the frozen page holds at most 50). */
export const GATE_PASSPORT_PAGE = 24;
const STAMP_CURSOR = /^gate-stamps\.([1-9][0-9]{0,15})$/u;
const VISIT_CURSOR = /^gate-visits\.([1-9][0-9]{0,15})$/u;

const toGateStamp = (stamp: RaidGuestStamp): GateStamp => ({
  id: stamp.id, kingdomId: stamp.kingdomId as GateStamp['kingdomId'], occurredAt: stamp.occurredAt, kind: stamp.kind, raidId: stamp.raidId,
});

export type GatePassportPorts = Pick<PassportPorts, 'stamps' | 'visits' | 'kingdoms' | 'roads' | 'gifts'>;

/** The parts of `PassportPorts` the gate answers, from its own witnessed records. */
export function gatePassportPorts(store: GatePassportStore, options: { pageSize?: number } = {}): GatePassportPorts {
  const size = options.pageSize ?? GATE_PASSPORT_PAGE;
  if (!Number.isInteger(size) || size < 1 || size > 50) throw new RangeError('A passport page holds 1–50 records.');
  const alive = (signal: AbortSignal) => { if (signal.aborted) throw new Error('aborted'); };
  const position = (cursor: string | null, pattern: RegExp) => {
    if (cursor === null) return null;
    const match = pattern.exec(cursor);
    if (!match) throw new Error('The passport cursor is not the gate’s.');
    return Number(match[1]);
  };

  return {
    async stamps(person, cursor, signal): Promise<PassportView> {
      const before = position(cursor, STAMP_CURSOR);
      const read = await store.stamps(person, before, size + 1);
      alive(signal);
      if (read.choice.hidden) return { hidden: true, revision: read.head, stamps: [], nextCursor: null };
      const page = read.items.slice(0, size);
      const more = read.items.length > size;
      return { hidden: false, revision: read.head, stamps: page.map(item => toGateStamp(item.stamp)),
        nextCursor: more ? `gate-stamps.${page.at(-1)!.sequence}` : null };
    },
    async visits(person, cursor, signal): Promise<RevisionedPage<PassportItem<'kingdoms'>>> {
      const offset = position(cursor, VISIT_CURSOR) ?? 0;
      const read = await store.visits(person, offset, size + 1);
      alive(signal);
      // Kept private: nothing of where they went leaves, not even an empty page that could read as "nowhere".
      if (read.choice.hidden) throw new GatePassportHidden();
      const page = read.items.slice(0, size);
      const names = page.length ? await store.channels(page.map(item => item.kingdomId)) : new Map<string, string>();
      alive(signal);
      const items = page.map(item => {
        const kingdom = gateKingdom(item.kingdomId, names.get(item.kingdomId));
        if (!kingdom) throw new Error(`The gate cannot name kingdom ${item.kingdomId}.`);
        return { kingdom, firstAt: item.firstAt, lastAt: item.lastAt };
      });
      return { revision: read.head, items, nextCursor: read.items.length > size ? `gate-visits.${offset + size}` : null };
    },
    async kingdoms(ids, signal) {
      const names = await store.channels(ids);
      alive(signal);
      const out = new Map<string, PassportKingdom>();
      for (const id of ids) { const kingdom = gateKingdom(id, names.get(id)); if (kingdom) out.set(id, kingdom); }
      return out;
    },
    async roads(raidIds, signal) {
      const raids = await store.raids(raidIds);
      alive(signal);
      const out = new Map<string, WitnessedRoad>();
      for (const [raidId, raid] of raids) {
        out.set(raidId, { raidId, road: { id: raidId, from: raid.from.kingdomId as GateStamp['kingdomId'], to: raid.to.kingdomId as GateStamp['kingdomId'] }, leader: null });
      }
      return out;
    },
    gifts: async () => [],
  };
}

/**
 * The choice folded into a card source: `travelsHidden`, and a person revision that has moved past the change, so
 * the reader's never-backwards rule keeps a stale "shown" from undoing a newer "hidden".
 */
export function cardTravels(choice: GateTravelChoice, personRevision: number): { travelsHidden: boolean; personRevision: number } {
  return { travelsHidden: choice.hidden, personRevision: Math.max(personRevision, choice.changedAt) };
}

// ---------------------------------------------------------------- Postgres

type Row = Record<string, unknown>;
const integer = (value: unknown) => {
  const n = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('A gate passport number is out of range.');
  return n;
};
const choiceOf = (row: Row | undefined): GateTravelChoice => (row ? { hidden: row.hidden === true, changedAt: integer(row.changed_ms) } : SHOWN);
function readStamp(row: Row): RaidGuestStamp {
  const stamp = RaidGuestStampSchema.parse(JSON.parse(String(row.record)));
  if (stamp.kind !== row.kind || stamp.kingdomId !== row.kingdom_id || stamp.occurredAt !== integer(row.at_ms)
    || (stamp.raidId ?? stamp.arrivedWith?.raidId) !== row.raid_id) throw new Error('A stored gate stamp failed its reader.');
  return stamp;
}
function channel(value: unknown): { kingdomId: string; name: string } {
  const v = value as { kingdomId?: unknown; name?: unknown } | null;
  if (!v || typeof v.kingdomId !== 'string' || typeof v.name !== 'string' || !v.name) throw new Error('A witnessed raid lost its channel.');
  return { kingdomId: v.kingdomId, name: v.name };
}

export function createPostgresGatePassportStore(options: Readonly<{ pool: SqlPool; origin: 'live' | 'simulated' }>): GatePassportStore {
  const { pool, origin } = options;
  /** One snapshot: the choice, the head and the history agree with each other. */
  async function snapshot<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }
  const head = async (client: SqlClient, person: PersonId) => {
    const row = (await client.query('SELECT stamp_sequence FROM realm_raid_guest_heads WHERE origin = $1 AND person_id = $2', [origin, person])).rows[0] as Row | undefined;
    return row ? integer(row.stamp_sequence) : 0;
  };
  const privacy = async (client: SqlClient, person: PersonId) =>
    choiceOf((await client.query('SELECT hidden, changed_ms FROM realm_raid_passport_privacy WHERE origin = $1 AND person_id = $2', [origin, person])).rows[0] as Row | undefined);

  return {
    origin,
    stamps: (person, before, limit) => snapshot(async client => {
      const choice = await privacy(client, person);
      const at = await head(client, person);
      if (choice.hidden) return { choice, head: at, items: [] };
      const rows = (await client.query(`SELECT sequence, raid_id, kingdom_id, kind, at_ms, record FROM realm_raid_guest_stamps
        WHERE origin = $1 AND person_id = $2 AND ($3::bigint IS NULL OR sequence < $3) ORDER BY sequence DESC LIMIT $4`,
      [origin, person, before, limit])).rows as Row[];
      return { choice, head: at, items: rows.map(row => ({ sequence: integer(row.sequence), stamp: readStamp(row) })) };
    }),
    visits: (person, offset, limit) => snapshot(async client => {
      const choice = await privacy(client, person);
      const at = await head(client, person);
      if (choice.hidden) return { choice, head: at, items: [] };
      const rows = (await client.query(`SELECT kingdom_id, min(at_ms) AS first_ms, max(at_ms) AS last_ms FROM realm_raid_guest_stamps
        WHERE origin = $1 AND person_id = $2 GROUP BY kingdom_id ORDER BY max(at_ms) DESC, kingdom_id OFFSET $3 LIMIT $4`,
      [origin, person, offset, limit])).rows as Row[];
      return { choice, head: at, items: rows.map(row => ({ kingdomId: String(row.kingdom_id), firstAt: integer(row.first_ms), lastAt: integer(row.last_ms) })) };
    }),
    async channels(ids) {
      if (!ids.length) return new Map();
      const client = await pool.connect();
      try {
        // The newest witnessed raid that names each channel, on either side of the road.
        const rows = (await client.query(`SELECT DISTINCT ON (id) id, name FROM (
            SELECT from_kingdom_id AS id, observation::jsonb #>> '{from,name}' AS name, sequence FROM realm_raid_observations
              WHERE origin = $1 AND from_kingdom_id = ANY($2::text[])
            UNION ALL
            SELECT to_kingdom_id AS id, observation::jsonb #>> '{to,name}' AS name, sequence FROM realm_raid_observations
              WHERE origin = $1 AND to_kingdom_id = ANY($2::text[])) named
          ORDER BY id, sequence DESC`, [origin, [...new Set(ids)]])).rows as Row[];
        return new Map(rows.filter(row => typeof row.name === 'string' && row.name).map(row => [String(row.id), String(row.name)]));
      } finally { client.release(); }
    },
    async raids(raidIds) {
      if (!raidIds.length) return new Map();
      const client = await pool.connect();
      try {
        const rows = (await client.query(`SELECT raid_id, observation FROM realm_raid_observations WHERE origin = $1 AND raid_id = ANY($2::text[])`,
          [origin, [...new Set(raidIds)]])).rows as Row[];
        return new Map(rows.map(row => {
          const observation = JSON.parse(String(row.observation)) as { from?: unknown; to?: unknown };
          return [String(row.raid_id), { raidId: String(row.raid_id), from: channel(observation.from), to: channel(observation.to) }];
        }));
      } finally { client.release(); }
    },
    async choice(person) {
      const client = await pool.connect();
      try { return await privacy(client, person); } finally { client.release(); }
    },
    async choose(person, hidden, now) {
      if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('A choice needs a moment.');
      const client = await pool.connect();
      try {
        // A change moves forward even against a clock that stepped back; the same choice again changes nothing.
        const changed = (await client.query(`INSERT INTO realm_raid_passport_privacy AS p (origin, person_id, hidden, revision, changed_ms)
            VALUES ($1, $2, $3, 1, $4)
          ON CONFLICT (origin, person_id) DO UPDATE SET hidden = EXCLUDED.hidden, revision = p.revision + 1,
            changed_ms = greatest(EXCLUDED.changed_ms, p.changed_ms + 1)
            WHERE p.hidden IS DISTINCT FROM EXCLUDED.hidden
          RETURNING hidden, changed_ms`, [origin, person, hidden, now])).rows[0] as Row | undefined;
        return changed ? choiceOf(changed) : await privacy(client, person);
      } finally { client.release(); }
    },
  };
}

// ---------------------------------------------------------------- in memory (tests and private benches)

export interface MemoryGatePassport {
  readonly store: GatePassportStore;
  /** Adds a witnessed raid's channels, as the observation ledger holds them. */
  witness(raid: GateRaidRoad): void;
  /** Adds a stamp the gate's authority recorded for this person. */
  stamp(person: PersonId, stamp: RaidGuestStamp): void;
}

/** The same store over plain records, for unit tests and `/-/` benches. Its origin is always simulated. */
export function createMemoryGatePassport(): MemoryGatePassport {
  const raids = new Map<string, GateRaidRoad>();
  const books = new Map<string, { sequence: number; stamp: RaidGuestStamp }[]>();
  const choices = new Map<string, GateTravelChoice>();
  const order: GateRaidRoad[] = [];
  const book = (person: string) => books.get(person) ?? [];
  const store: GatePassportStore = {
    origin: 'simulated',
    async stamps(person, before, limit) {
      const choice = choices.get(person) ?? SHOWN, all = book(person);
      if (choice.hidden) return { choice, head: all.length, items: [] };
      const items = all.filter(item => before === null || item.sequence < before).sort((a, b) => b.sequence - a.sequence).slice(0, limit);
      return { choice, head: all.length, items };
    },
    async visits(person, offset, limit) {
      const choice = choices.get(person) ?? SHOWN, all = book(person);
      if (choice.hidden) return { choice, head: all.length, items: [] };
      const reached = new Map<string, { kingdomId: string; firstAt: number; lastAt: number }>();
      for (const { stamp } of all) {
        const seen = reached.get(stamp.kingdomId);
        reached.set(stamp.kingdomId, seen
          ? { ...seen, firstAt: Math.min(seen.firstAt, stamp.occurredAt), lastAt: Math.max(seen.lastAt, stamp.occurredAt) }
          : { kingdomId: stamp.kingdomId, firstAt: stamp.occurredAt, lastAt: stamp.occurredAt });
      }
      const items = [...reached.values()].sort((a, b) => b.lastAt - a.lastAt || (a.kingdomId < b.kingdomId ? -1 : 1)).slice(offset, offset + limit);
      return { choice, head: all.length, items };
    },
    async channels(ids) {
      const out = new Map<string, string>();
      for (const raid of order) for (const side of [raid.from, raid.to]) if (ids.includes(side.kingdomId)) out.set(side.kingdomId, side.name);
      return out;
    },
    async raids(raidIds) {
      return new Map(raidIds.flatMap(id => (raids.has(id) ? [[id, raids.get(id)!] as const] : [])));
    },
    async choice(person) { return choices.get(person) ?? SHOWN; },
    async choose(person, hidden, now) {
      const prior = choices.get(person) ?? SHOWN;
      if (prior.hidden === hidden) return prior;
      const next = { hidden, changedAt: Math.max(now, prior.changedAt + 1) };
      choices.set(person, next);
      return next;
    },
  };
  return {
    store,
    witness(raid) { raids.set(raid.raidId, raid); order.push(raid); },
    stamp(person, stamp) {
      const parsed = RaidGuestStampSchema.parse(stamp);
      const all = book(person);
      if (all.some(item => item.stamp.id === parsed.id)) return;
      books.set(person, [...all, { sequence: all.length + 1, stamp: parsed }]);
    },
  };
}
