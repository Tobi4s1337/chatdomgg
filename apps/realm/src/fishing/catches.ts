import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { EpochMsSchema, FISHING_HOURS, FISHING_MOODS, FISHING_PROFILES, KingdomIdSchema, PersonIdSchema, fishingHash,
  type FishSpecies, type FishingEnvironment, type FishingRoll, type ItemRecord, type KingdomId, type PersonId, type Vec3 } from '@chatdom/shared';
import type { ItemCatalogue, RealmItems } from '../items';
import { postgresItemClient, postgresItemCommitGuard } from '../items/postgres';
import { ItemCommitUncertainError, type ItemStore, type ItemTransaction } from '../items/store';
import { RealmStorageUnavailableError } from '../persistence/database';
import type { RealmChannelSender } from '../room-channels';
import type { FishingCandidate } from './cast';
import { MAX_FIGHT_TICKS, verifyFight, type FightInput, type FightState } from './fight';
import type { FishingSpecies } from './species';
import { fishMountId } from '../../../../packages/content/src/keepsakes';

/** Structural view of the actual retained DurableKingdom, not a newly acquired writer. */
export interface FishingCatchAuthority {
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly writerEpoch: string;
  readonly current: boolean;
}

/** Private durable evidence. Never publish this record on a room channel. */
export interface FishingCatchRecord {
  readonly version: 1;
  readonly id: string;
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly ownerId: PersonId;
  readonly speciesId: string;
  readonly itemId: string;
  readonly grantKey: string;
  readonly caughtAt: number;
  readonly personalFirst: boolean;
  readonly kingdomFirst: boolean;
  readonly rarity: FishSpecies['rarity'];
  readonly fish: FishingRoll;
  readonly environment: FishingEnvironment;
  readonly float: Vec3;
  readonly anchor: Vec3;
  readonly collisionRevision: number;
  /** The approved name at the catch; public pages still hide it when the person is hidden. */
  readonly name?: string;
  /** How it was caught: a walker's rod on the pier, or a chat line. Absent on early pier catches. */
  readonly via?: 'pier' | 'chat';
  readonly proof: {
    /** V1 is durable replay grammar: mechanics changes need a new version and a retained V1 reader. */
    readonly version: 1;
    readonly castSeed: number;
    readonly fightSeed: number;
    readonly inputs: readonly FightInput[];
    readonly result: FightState;
  };
}

export type FishingCatchResult =
  | { readonly status: 'kept'; readonly catch: FishingCatchRecord; readonly item: ItemRecord; readonly replayed: boolean;
      /** The numbered mount a rare catch or a kingdom first leaves; null for an ordinary catch. */
      readonly keepsake: ItemRecord | null }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'uncertain'; readonly castId: string; readonly message: string };

export interface FishingCatchWriterOptions {
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly store: ItemStore;
  readonly items: RealmItems;
  readonly catalogue: ItemCatalogue;
  readonly species: FishingSpecies;
  readonly where: string;
  authority(): FishingCatchAuthority | null;
  candidate(personId: PersonId): FishingCandidate | null;
  finish(personId: PersonId, castId: string): boolean;
  admit(from: RealmChannelSender, tx: ItemTransaction): Promise<{ name: string } | null>;
}
export interface FishingCatchWriter { keep(from: RealmChannelSender, castId: string): Promise<FishingCatchResult> }

const REFUSAL = 'That catch cannot be kept here. Cast again when you are ready.';
const UNAVAILABLE = 'The catch could not be stored. Try keeping it again.';
const NOW_MS = 'floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint';
const MAX_RECORD_BYTES = 24 * 1024;
const HOURS = { dawn: 'at dawn', day: 'by day', dusk: 'at dusk', night: 'at night' } as const;
const MOODS = { clear: 'clear weather', breeze: 'a light breeze', mist: 'the mist', rain: 'the rain' } as const;
const castIdSchema = z.string().uuid();
const seed = z.number().int().min(0).max(0xffff_ffff);
const speciesId = z.string().regex(/^fish:[a-z][a-z0-9-]{0,63}$/);
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const environment = z.strictObject({ water: z.enum(['lake', 'river', 'sea']), biome: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  depthM: z.number().finite().min(1).max(10_000), hour: z.enum(FISHING_HOURS), mood: z.enum(FISHING_MOODS) });
const fish = z.strictObject({ speciesId, lengthMm: z.number().int().min(1).max(1_000_000),
  weightG: z.number().int().min(1).max(1_000_000), fight: z.enum(FISHING_PROFILES), strikeMs: z.union([z.literal(900), z.literal(1050), z.literal(1200)]) });
const inputs = z.array(z.strictObject({ tick: z.number().int().min(1).max(MAX_FIGHT_TICKS), reel: z.boolean() })).max(MAX_FIGHT_TICKS);
const candidateSchema = z.strictObject({ version: z.literal(1), castId: castIdSchema, personId: PersonIdSchema, kingdomId: KingdomIdSchema,
  at: EpochMsSchema, float: vector, anchor: vector, collisionRevision: revision, environment, fish, castSeed: seed,
  fightSeed: seed, inputs, result: z.unknown() });
const recordSchema = z.strictObject({ version: z.literal(1), id: castIdSchema, kingdomId: KingdomIdSchema,
  origin: z.enum(['live', 'simulated']), ownerId: PersonIdSchema, speciesId, itemId: z.string().uuid(),
  grantKey: z.string().min(1).max(256), caughtAt: EpochMsSchema, personalFirst: z.boolean(), kingdomFirst: z.boolean(),
  rarity: z.enum(['common', 'uncommon', 'rare']), fish, environment, float: vector, anchor: vector, collisionRevision: revision,
  name: z.string().trim().min(1).max(128).optional(), via: z.enum(['pier', 'chat']).optional(),
  proof: z.strictObject({ version: z.literal(1), castSeed: seed, fightSeed: seed, inputs, result: z.unknown() }) });

class CatchRefused extends Error {}
const refuse = (): never => { throw new CatchRefused(); };
const grantKey = (castId: string) => `fishing:catch:1:${castId}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function frozenCopy<T>(value: T): T {
  const copied = structuredClone(value);
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(copied);
  return copied;
}
function proofValid(castSeed: number, fightSeed: number, fish: FishingRoll, inputs: readonly FightInput[], result: unknown): result is FightState {
  if (fightSeed !== fishingHash(`fight:1:${castSeed}`) || !result || typeof result !== 'object') return false;
  const terminal = result as FightState;
  return terminal.outcome === 'landed' && verifyFight({ seed: fightSeed, profile: fish.fight, inputs,
    throughTick: terminal.tick, claimed: result });
}
function bounded(value: unknown): boolean {
  // Stored JSON and trusted domain snapshots only; no browser objects or submitted replay enter this path.
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_RECORD_BYTES; } catch { return false; }
}
function catchRecord(value: unknown): FishingCatchRecord {
  if (!bounded(value)) throw new RealmStorageUnavailableError(UNAVAILABLE);
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) throw new RealmStorageUnavailableError(UNAVAILABLE);
  const r = parsed.data;
  if (r.speciesId !== r.fish.speciesId || r.grantKey !== grantKey(r.id) ||
      !proofValid(r.proof.castSeed, r.proof.fightSeed, r.fish, r.proof.inputs, r.proof.result)) {
    throw new RealmStorageUnavailableError(UNAVAILABLE);
  }
  return frozenCopy(r) as FishingCatchRecord;
}

interface CatchContext {
  readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated'; readonly where: string;
  readonly items: RealmItems; readonly catalogue: ItemCatalogue; readonly species: FishingSpecies;
}
/** The audited candidate both writers keep: a walker's landed cast or a chat line's steady hand. */
export type CatchCandidate = Pick<FishingCandidate, 'castId' | 'personId' | 'kingdomId' | 'at' | 'float' | 'anchor'
  | 'collisionRevision' | 'environment' | 'fish' | 'castSeed' | 'fightSeed' | 'inputs' | 'result'>;
export const mountGrantKey = (castId: string) => `fishing:mount:1:${castId}`;

/** Rare catches and a kingdom's firsts become numbered mounts; the item service numbers them gaplessly. */
async function grantMount(ctx: CatchContext, tx: ItemTransaction, input: { ownerId: PersonId; name: string; candidate: CatchCandidate;
  kingdomFirst: boolean; rarity: FishSpecies['rarity'] }): Promise<ItemRecord | null> {
  if (input.rarity !== 'rare' && !input.kingdomFirst) return null;
  const c = input.candidate, defId = fishMountId(c.fish.speciesId), definition = ctx.catalogue.get(defId);
  if (!definition?.keepsake) throw new RealmStorageUnavailableError(UNAVAILABLE);
  const shelf = await tx.atPlace(input.ownerId, ctx.origin, 'shelf');
  return ctx.items.grant({ key: mountGrantKey(c.castId), ownerId: input.ownerId, kingdomId: ctx.kingdomId, origin: ctx.origin, defId,
    place: shelf.length < 64 ? 'shelf' : 'bag',
    story: { by: { personId: input.ownerId, name: input.name }, kingdomId: ctx.kingdomId, where: ctx.where, at: c.at,
      line: `Caught ${HOURS[c.environment.hour]} in ${MOODS[c.environment.mood]}.` },
    source: { kind: 'fishing', ref: c.castId },
    detail: { speciesId: c.fish.speciesId, lengthMm: c.fish.lengthMm, weightG: c.fish.weightG, hour: c.environment.hour,
      mood: c.environment.mood, kingdomFirst: input.kingdomFirst ? 1 : 0 } }, tx);
}

/** Firsts, fish, mount, catch row and history, all on the caller's one kingdom transaction. */
async function writeCatch(ctx: CatchContext, tx: ItemTransaction, input: { ownerId: PersonId; name: string; via: 'pier' | 'chat';
  candidate: CatchCandidate; check: () => void }): Promise<{ kept: FishingCatchRecord; item: ItemRecord; keepsake: ItemRecord | null }> {
  const sql = postgresItemClient(tx), c = input.candidate, ownerId = input.ownerId, { kingdomId, origin } = ctx;
  const firsts = await sql.query<{ personal_first: boolean; kingdom_first: boolean }>(`SELECT
    NOT EXISTS (SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin=$2 AND species_id=$3 AND owner_id=$4) AS personal_first,
    NOT EXISTS (SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin=$2 AND species_id=$3) AS kingdom_first`,
  [kingdomId, origin, c.fish.speciesId, ownerId]);
  input.check();
  const first = firsts.rows[0]!;
  const species = ctx.species.get(c.fish.speciesId)!;
  const item = await ctx.items.grant({ key: grantKey(c.castId), ownerId, kingdomId, origin, defId: c.fish.speciesId,
    place: 'bag', count: 1, ...(first.personal_first || species.rarity === 'rare' ? { storied: true as const } : {}),
    story: { by: { personId: ownerId, name: input.name }, kingdomId, where: ctx.where, at: c.at,
      line: `Caught ${HOURS[c.environment.hour]} in ${MOODS[c.environment.mood]}.` },
    source: { kind: 'fishing', ref: c.castId }, detail: { lengthMm: c.fish.lengthMm, weightG: c.fish.weightG,
      hour: c.environment.hour, mood: c.environment.mood, water: c.environment.water } }, tx);
  input.check();
  const keepsake = await grantMount(ctx, tx, { ownerId, name: input.name, candidate: c, kingdomFirst: first.kingdom_first, rarity: species.rarity });
  input.check();
  const kept = catchRecord({ version: 1, id: c.castId, kingdomId, origin, ownerId, speciesId: c.fish.speciesId,
    itemId: item.id, grantKey: grantKey(c.castId), caughtAt: c.at, personalFirst: first.personal_first,
    kingdomFirst: first.kingdom_first, rarity: species.rarity, fish: c.fish, environment: c.environment,
    float: c.float, anchor: c.anchor, collisionRevision: c.collisionRevision, name: input.name, via: input.via,
    proof: { version: 1, castSeed: c.castSeed, fightSeed: c.fightSeed, inputs: c.inputs, result: c.result } });
  await sql.query(`INSERT INTO realm_fishing_catches
    (kingdom_id,origin,id,owner_id,species_id,item_id,grant_key,caught_ms,personal_first,kingdom_first,record)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [kingdomId, origin, c.castId, ownerId, kept.speciesId, item.id, kept.grantKey, kept.caughtAt, kept.personalFirst, kept.kingdomFirst, kept]);
  input.check();
  return { kept, item, keepsake };
}

/** A confirmed retry reads its committed receipts, including a moved or spent stack. It never grants again. */
async function recoverCatch(ctx: CatchContext, tx: ItemTransaction, ownerId: PersonId, castId: string, stored: unknown,
  check: () => void): Promise<{ kept: FishingCatchRecord; item: ItemRecord; keepsake: ItemRecord | null }> {
  const { kingdomId, origin } = ctx;
  const kept = catchRecord(stored);
  if (kept.id !== castId || kept.ownerId !== ownerId || kept.kingdomId !== kingdomId || kept.origin !== origin) {
    throw new RealmStorageUnavailableError(UNAVAILABLE);
  }
  const receipt = await tx.receipt(ownerId, origin, kept.grantKey);
  check();
  if (!receipt || receipt.itemId !== kept.itemId) throw new RealmStorageUnavailableError(UNAVAILABLE);
  const item = await tx.get(kept.itemId);
  check();
  if (!item || item.ownerId !== ownerId || item.kingdomId !== kingdomId || item.origin !== origin || item.defId !== kept.speciesId) {
    throw new RealmStorageUnavailableError(UNAVAILABLE);
  }
  const mountReceipt = await tx.receipt(ownerId, origin, mountGrantKey(castId));
  check();
  const keepsake = mountReceipt ? await tx.get(mountReceipt.itemId) : null;
  check();
  if (mountReceipt && (!keepsake || keepsake.ownerId !== ownerId || keepsake.defId !== fishMountId(kept.speciesId))) {
    throw new RealmStorageUnavailableError(UNAVAILABLE);
  }
  return { kept, item, keepsake };
}

/** One kingdom item transaction owns admission, epoch fences, catch ledger, item, receipt and history. */
export function createPostgresFishingCatchWriter(options: FishingCatchWriterOptions): FishingCatchWriter {
  const kingdomId = KingdomIdSchema.parse(options.kingdomId), origin = z.enum(['live', 'simulated']).parse(options.origin);
  const where = z.string().trim().min(1).max(200).parse(options.where);
  const ctx: CatchContext = { kingdomId, origin, where, items: options.items, catalogue: options.catalogue, species: options.species };
  return {
    async keep(from, requestedId) {
      const id = castIdSchema.safeParse(requestedId);
      if (!id.success) return Object.freeze({ status: 'refused', message: REFUSAL });
      const castId = id.data, principal = from.principal, ownerId = principal.personId;
      let result: Extract<FishingCatchResult, { status: 'kept' }>;
      try {
        const retained = options.authority(), epoch = retained?.writerEpoch;
        const local = () => {
          if (!retained || !epoch || options.authority() !== retained || !retained.current || retained.writerEpoch !== epoch ||
              retained.kingdomId !== kingdomId || retained.origin !== origin || from.principal !== principal ||
              principal.personId !== ownerId || principal.kingdomId !== kingdomId || principal.origin !== origin || !from.present()) refuse();
        };
        local();
        result = await options.store.transaction(kingdomId, async tx => {
          const sql = postgresItemClient(tx);
          local();
          const locked = await sql.query<{ mine: boolean }>(`SELECT (writer_epoch=$2 AND origin=$3 AND lease_expires_ms>${NOW_MS}) IS TRUE AS mine
            FROM realm_kingdoms WHERE kingdom_id=$1 FOR UPDATE`, [kingdomId, epoch, origin]);
          local();
          if (locked.rows[0]?.mine !== true) refuse();
          const admitted = await options.admit(from, tx);
          local();
          if (!admitted) return refuse();
          const name = z.string().trim().min(1).max(128).parse(admitted.name);
          const existing = await sql.query<{ owner_id: string; record: unknown }>(
            'SELECT owner_id,record FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin=$2 AND id=$3', [kingdomId, origin, castId]);
          local();
          let kept: FishingCatchRecord, item: ItemRecord, original: FishingCandidate | null = null, snapshot: FishingCandidate | null = null;
          const audit = (): FishingCandidate => {
            local();
            const current = options.candidate(ownerId);
            if (!current || (original && current !== original) || !Array.isArray(current.inputs) ||
                current.inputs.length > MAX_FIGHT_TICKS || !bounded(current)) return refuse();
            const parsed = candidateSchema.safeParse(current);
            if (!parsed.success) return refuse();
            const c = parsed.data;
            if (c.castId !== castId || c.personId !== ownerId || c.kingdomId !== kingdomId ||
                !proofValid(c.castSeed, c.fightSeed, c.fish, c.inputs, c.result)) return refuse();
            const rolled = options.species.roll(c.environment, fishingHash(`roll:1:${c.castSeed}`));
            if (!rolled || !same(rolled, c.fish)) return refuse();
            const species = options.species.get(c.fish.speciesId), definition = options.catalogue.get(c.fish.speciesId);
            if (!species || !definition || definition.id !== c.fish.speciesId || definition.branch !== 'gathered' || definition.keepsake ||
                !definition.places.includes('bag') || (species.rarity === 'rare' ? definition.stack !== null : definition.stack === null)) return refuse();
            const copied = frozenCopy(c) as FishingCandidate;
            if (snapshot && !same(snapshot, copied)) return refuse();
            original = current;
            return copied;
          };
          // Runs synchronously at the store's actual COMMIT boundary, after its await of this callback.
          // It closes the microtask gap after our final SQL without adding another query or connection.
          postgresItemCommitGuard(tx, () => { local(); if (snapshot) audit(); return true; });
          let keepsake: ItemRecord | null;
          if (existing.rows[0]) {
            const row = existing.rows[0];
            if (row.owner_id !== ownerId) refuse();
            ({ kept, item, keepsake } = await recoverCatch(ctx, tx, ownerId, castId, row.record, local));
          } else {
            snapshot = audit();
            ({ kept, item, keepsake } = await writeCatch(ctx, tx, { ownerId, name, via: 'pier', candidate: snapshot, check: () => { audit(); } }));
          }
          item = await tx.visible(item);
          if (keepsake) keepsake = await tx.visible(keepsake);
          local();
          if (snapshot) audit();
          const finalAdmission = await options.admit(from, tx);
          local();
          if (!finalAdmission) refuse();
          if (snapshot) audit();
          const reply = frozenCopy({ status: 'kept' as const, catch: kept, item, keepsake, replayed: !!existing.rows[0] });
          // LAST SQL before COMMIT. The retained row lock orders any takeover after this transaction;
          // neither this fence nor the catch ledger changes the world's reducer sequence.
          const fenced = await sql.query(`SELECT 1 FROM realm_kingdoms
            WHERE kingdom_id=$1 AND origin=$3 AND writer_epoch=$2 AND lease_expires_ms>${NOW_MS}`, [kingdomId, epoch, origin]);
          local();
          if (fenced.rowCount !== 1) refuse();
          if (snapshot) audit();
          return reply;
        });
      } catch (error) {
        if (error instanceof CatchRefused) return Object.freeze({ status: 'refused', message: REFUSAL });
        if (error instanceof ItemCommitUncertainError) return Object.freeze({ status: 'uncertain', castId,
          message: 'The kingdom is checking this catch. Try keeping the same catch again.' });
        throw new RealmStorageUnavailableError(UNAVAILABLE);
      }
      // A failed cleanup cannot turn an already committed catch into an apparent storage failure.
      try { options.finish(ownerId, castId); } catch { /* A confirmed retry can finish this same cast. */ }
      return result;
    },
  };
}

export interface ChatCatchWriterOptions {
  readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated';
  readonly store: ItemStore; readonly items: RealmItems; readonly catalogue: ItemCatalogue;
  /** This kingdom's own water view: the same one that rolled the chat line. */
  readonly species: FishingSpecies;
  readonly where: string;
  /** The actual retained kingdom, never another writer. */
  authority(): FishingCatchAuthority | null;
}

/**
 * Keeps one chat line's catch. The realm itself played the line (`chatFight`), so the audit is the same as a walker's:
 * the roll must match the seed and the whole fight must replay. A chat-only person is a light, never a session, so
 * admission is the lit window Herald proved before the cast; the writer still fences the kingdom's writer lease.
 */
export function createPostgresChatCatchWriter(options: ChatCatchWriterOptions) {
  const kingdomId = KingdomIdSchema.parse(options.kingdomId), origin = z.enum(['live', 'simulated']).parse(options.origin);
  const where = z.string().trim().min(1).max(200).parse(options.where);
  const ctx: CatchContext = { kingdomId, origin, where, items: options.items, catalogue: options.catalogue, species: options.species };
  return {
    async keep(raw: CatchCandidate, rawName: string | null): Promise<
      | { readonly status: 'kept'; readonly catch: FishingCatchRecord; readonly item: ItemRecord; readonly keepsake: ItemRecord | null; readonly replayed: boolean }
      | { readonly status: 'refused' } | { readonly status: 'uncertain' }> {
      const parsed = candidateSchema.safeParse({ version: 1, ...raw });
      if (!parsed.success || !bounded(raw)) return { status: 'refused' };
      const c = parsed.data as unknown as CatchCandidate;
      const name = z.string().trim().min(1).max(128).safeParse(rawName).data ?? 'a citizen';
      if (c.kingdomId !== kingdomId || !proofValid(c.castSeed, c.fightSeed, c.fish, c.inputs, c.result)) return { status: 'refused' };
      const rolled = options.species.roll(c.environment, fishingHash(`roll:1:${c.castSeed}`));
      const species = options.species.get(c.fish.speciesId), definition = options.catalogue.get(c.fish.speciesId);
      if (!rolled || !same(rolled, c.fish) || !species || species.legend || !definition || definition.branch !== 'gathered') return { status: 'refused' };
      const retained = options.authority(), epoch = retained?.writerEpoch;
      const local = () => {
        if (!retained || !epoch || options.authority() !== retained || !retained.current || retained.writerEpoch !== epoch
          || retained.kingdomId !== kingdomId || retained.origin !== origin) refuse();
      };
      try {
        local();
        const result = await options.store.transaction(kingdomId, async tx => {
          const sql = postgresItemClient(tx);
          const locked = await sql.query<{ mine: boolean }>(`SELECT (writer_epoch=$2 AND origin=$3 AND lease_expires_ms>${NOW_MS}) IS TRUE AS mine
            FROM realm_kingdoms WHERE kingdom_id=$1 FOR UPDATE`, [kingdomId, epoch, origin]);
          local();
          if (locked.rows[0]?.mine !== true) refuse();
          postgresItemCommitGuard(tx, () => { local(); return true; });
          const existing = await sql.query<{ owner_id: string; record: unknown }>(
            'SELECT owner_id,record FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin=$2 AND id=$3', [kingdomId, origin, c.castId]);
          local();
          const row = existing.rows[0];
          if (row && row.owner_id !== c.personId) refuse();
          let { kept, item, keepsake } = row
            ? await recoverCatch(ctx, tx, c.personId, c.castId, row.record, local)
            : await writeCatch(ctx, tx, { ownerId: c.personId, name, via: 'chat', candidate: c, check: local });
          item = await tx.visible(item);
          if (keepsake) keepsake = await tx.visible(keepsake);
          const reply = frozenCopy({ status: 'kept' as const, catch: kept, item, keepsake, replayed: !!row });
          const fenced = await sql.query(`SELECT 1 FROM realm_kingdoms
            WHERE kingdom_id=$1 AND origin=$3 AND writer_epoch=$2 AND lease_expires_ms>${NOW_MS}`, [kingdomId, epoch, origin]);
          local();
          if (fenced.rowCount !== 1) refuse();
          return reply;
        });
        return result;
      } catch (error) {
        if (error instanceof CatchRefused) return { status: 'refused' };
        if (error instanceof ItemCommitUncertainError) return { status: 'uncertain' };
        throw new RealmStorageUnavailableError(UNAVAILABLE);
      }
    },
  };
}
export type ChatCatchWriter = ReturnType<typeof createPostgresChatCatchWriter>;
