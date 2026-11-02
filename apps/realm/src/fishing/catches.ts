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
  | { readonly status: 'kept'; readonly catch: FishingCatchRecord; readonly item: ItemRecord; readonly replayed: boolean }
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

/** One kingdom item transaction owns admission, epoch fences, catch ledger, item, receipt and history. */
export function createPostgresFishingCatchWriter(options: FishingCatchWriterOptions): FishingCatchWriter {
  const kingdomId = KingdomIdSchema.parse(options.kingdomId), origin = z.enum(['live', 'simulated']).parse(options.origin);
  const where = z.string().trim().min(1).max(200).parse(options.where);
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
          if (existing.rows[0]) {
            const row = existing.rows[0];
            if (row.owner_id !== ownerId) refuse();
            kept = catchRecord(row.record);
            if (kept.id !== castId || kept.ownerId !== ownerId || kept.kingdomId !== kingdomId || kept.origin !== origin) {
              throw new RealmStorageUnavailableError(UNAVAILABLE);
            }
            const receipt = await tx.receipt(ownerId, origin, kept.grantKey);
            local();
            if (!receipt || receipt.itemId !== kept.itemId) throw new RealmStorageUnavailableError(UNAVAILABLE);
            const stored = await tx.get(kept.itemId);
            local();
            if (!stored || stored.ownerId !== ownerId || stored.kingdomId !== kingdomId || stored.origin !== origin || stored.defId !== kept.speciesId) {
              throw new RealmStorageUnavailableError(UNAVAILABLE);
            }
            // Read the retained record, including a moved or spent stack. Never replay the grant to resurrect it.
            item = stored;
          } else {
            snapshot = audit();
            const firsts = await sql.query<{ personal_first: boolean; kingdom_first: boolean }>(`SELECT
              NOT EXISTS (SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin=$2 AND species_id=$3 AND owner_id=$4) AS personal_first,
              NOT EXISTS (SELECT 1 FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin=$2 AND species_id=$3) AS kingdom_first`,
            [kingdomId, origin, snapshot.fish.speciesId, ownerId]);
            audit();
            const first = firsts.rows[0]!;
            const species = options.species.get(snapshot.fish.speciesId)!;
            item = await options.items.grant({ key: grantKey(castId), ownerId, kingdomId, origin, defId: snapshot.fish.speciesId,
              place: 'bag', count: 1, ...(first.personal_first || species.rarity === 'rare' ? { storied: true as const } : {}),
              story: { by: { personId: ownerId, name }, kingdomId, where, at: snapshot.at,
                line: `Caught ${HOURS[snapshot.environment.hour]} in ${MOODS[snapshot.environment.mood]}.` },
              source: { kind: 'fishing', ref: castId }, detail: { lengthMm: snapshot.fish.lengthMm, weightG: snapshot.fish.weightG,
                hour: snapshot.environment.hour, mood: snapshot.environment.mood, water: snapshot.environment.water } }, tx);
            audit();
            kept = catchRecord({ version: 1, id: castId, kingdomId, origin, ownerId, speciesId: snapshot.fish.speciesId,
              itemId: item.id, grantKey: grantKey(castId), caughtAt: snapshot.at, personalFirst: first.personal_first,
              kingdomFirst: first.kingdom_first, rarity: species.rarity, fish: snapshot.fish, environment: snapshot.environment,
              float: snapshot.float, anchor: snapshot.anchor, collisionRevision: snapshot.collisionRevision,
              proof: { version: 1, castSeed: snapshot.castSeed, fightSeed: snapshot.fightSeed, inputs: snapshot.inputs, result: snapshot.result } });
            await sql.query(`INSERT INTO realm_fishing_catches
              (kingdom_id,origin,id,owner_id,species_id,item_id,grant_key,caught_ms,personal_first,kingdom_first,record)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [kingdomId, origin, castId, ownerId, kept.speciesId, item.id, kept.grantKey, kept.caughtAt, kept.personalFirst, kept.kingdomFirst, kept]);
            audit();
          }
          item = await tx.visible(item);
          local();
          if (snapshot) audit();
          const finalAdmission = await options.admit(from, tx);
          local();
          if (!finalAdmission) refuse();
          if (snapshot) audit();
          const reply = frozenCopy({ status: 'kept' as const, catch: kept, item, replayed: !!existing.rows[0] });
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
