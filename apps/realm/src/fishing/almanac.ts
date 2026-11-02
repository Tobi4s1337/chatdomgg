import type { Pool, PoolClient } from 'pg';
import { KingdomIdSchema, kingdomHoldsFish, type FishingPierSite, type KingdomId, type PersonId, type PierAlmanac,
  type PierAlmanacEntry, type PierAlmanacFact, type PierAlmanacMark } from '@chatdom/shared';
import { fishMountId } from '../../../../packages/content/src/keepsakes';
import type { FishingSpecies } from './species';

/** One fact row as the store reads it: a person id stays here and never reaches a public page. */
export interface AlmanacFactRow {
  readonly speciesId: string; readonly ownerId: string; readonly at: number; readonly via: 'pier' | 'chat';
  readonly name: string | null; readonly hidden: boolean; readonly weightG?: number; readonly lengthMm?: number;
}
export interface AlmanacRows {
  readonly counts: ReadonlyMap<string, number>;
  readonly firsts: readonly AlmanacFactRow[];
  readonly biggest: readonly AlmanacFactRow[];
  readonly mounts: ReadonlyMap<string, number>;
}
/** The water at the kingdom's pier: every founded pier stands on its lake; null where none stands. */
export type AlmanacWater = { readonly water: FishingPierSite['water']; readonly biome: string | null } | null;

const fact = (row: AlmanacFactRow): PierAlmanacFact => ({ name: row.hidden ? null : row.name, at: row.at, via: row.via });

/** Pure assembly: every authored species gets a page, in catalogue order. Approved names only; no person ids. */
export function assembleAlmanac(input: { kingdomId: KingdomId; kingdom: string; asOf: number; species: FishingSpecies;
  water: AlmanacWater; rows: AlmanacRows }): PierAlmanac {
  const { species, water, rows } = input;
  const firsts = new Map(rows.firsts.map(row => [row.speciesId, row]));
  const biggest = new Map(rows.biggest.map(row => [row.speciesId, row]));
  let caught = 0, catches = 0;
  const entries = species.all().map((fish): PierAlmanacEntry => {
    const count = rows.counts.get(fish.id) ?? 0;
    catches += count;
    if (count > 0) caught++;
    const status = count > 0 ? 'caught'
      : water && species.lives(fish, water.water, water.biome) && kingdomHoldsFish(input.kingdomId, fish) ? 'waiting' : 'elsewhere';
    const first = firsts.get(fish.id), big = biggest.get(fish.id);
    return { speciesId: fish.id, status, count,
      first: count > 0 && first ? fact(first) : null,
      biggest: count > 0 && big && big.weightG !== undefined && big.lengthMm !== undefined
        ? { ...fact(big), weightG: big.weightG, lengthMm: big.lengthMm } : null,
      mounts: rows.mounts.get(fishMountId(fish.id)) ?? 0 };
  });
  return { version: 1, kingdomId: input.kingdomId, kingdom: input.kingdom, asOf: input.asOf, water: water?.water ?? null,
    entries, caught, catches };
}

const HIDDEN = `(EXISTS (SELECT 1 FROM realm_pier_hidden_names h WHERE h.kingdom_id=c.kingdom_id AND h.origin=c.origin AND h.person_id=c.owner_id)
  OR EXISTS (SELECT 1 FROM realm_item_hidden_names f WHERE f.person_id=c.owner_id))`;
const NAME = `COALESCE(c.record->>'name', i.record->'story'->'by'->>'name')`;
const VIA = `COALESCE(c.record->>'via', 'pier')`;
type Query = Pick<Pool | PoolClient, 'query'>;

export interface PierAlmanacStore {
  rows(kingdomId: KingdomId): Promise<AlmanacRows>;
  marks(kingdomId: KingdomId, personId: PersonId, sql?: Query): Promise<readonly PierAlmanacMark[]>;
  hidden(kingdomId: KingdomId, personId: PersonId): Promise<boolean>;
  hide(kingdomId: KingdomId, personId: PersonId, at: number): Promise<void>;
}

/** Bounded reads of the catch ledger. The public projection is `assembleAlmanac`. */
export function createPostgresPierAlmanacStore(options: { pool: Pool; origin: 'live' | 'simulated' }): PierAlmanacStore {
  const { pool, origin } = options;
  const row = (r: Record<string, unknown>): AlmanacFactRow => ({ speciesId: String(r.species_id), ownerId: String(r.owner_id),
    at: Number(r.caught_ms), via: r.via === 'chat' ? 'chat' : 'pier', name: typeof r.name === 'string' && r.name.trim() ? r.name : null,
    hidden: r.hidden === true, ...(r.weight_g === undefined ? {} : { weightG: Number(r.weight_g), lengthMm: Number(r.length_mm) }) });
  return {
    async rows(raw) {
      const kingdomId = KingdomIdSchema.parse(raw);
      const [counts, firsts, biggest, mounts] = await Promise.all([
        pool.query<{ species_id: string; n: number }>(`SELECT species_id, count(*)::integer AS n FROM realm_fishing_catches
          WHERE kingdom_id=$1 AND origin=$2 GROUP BY species_id LIMIT 64`, [kingdomId, origin]),
        pool.query(`SELECT c.species_id, c.owner_id, c.caught_ms, ${VIA} AS via, ${NAME} AS name, ${HIDDEN} AS hidden
          FROM realm_fishing_catches c JOIN realm_items i ON i.id=c.item_id
          WHERE c.kingdom_id=$1 AND c.origin=$2 AND c.kingdom_first LIMIT 64`, [kingdomId, origin]),
        pool.query(`SELECT DISTINCT ON (c.species_id) c.species_id, c.owner_id, c.caught_ms, ${VIA} AS via, ${NAME} AS name, ${HIDDEN} AS hidden,
            (c.record->'fish'->>'weightG')::integer AS weight_g, (c.record->'fish'->>'lengthMm')::integer AS length_mm
          FROM realm_fishing_catches c JOIN realm_items i ON i.id=c.item_id
          WHERE c.kingdom_id=$1 AND c.origin=$2
          ORDER BY c.species_id, (c.record->'fish'->>'weightG')::integer DESC, c.caught_ms ASC LIMIT 64`, [kingdomId, origin]),
        pool.query<{ def_id: string; number: number }>(`SELECT def_id, number FROM realm_item_numbers
          WHERE kingdom_id=$1 AND def_id LIKE 'keepsake:mount.%' LIMIT 64`, [kingdomId]),
      ]);
      return { counts: new Map(counts.rows.map(r => [r.species_id, Number(r.n)])),
        firsts: firsts.rows.map(row), biggest: biggest.rows.map(row),
        mounts: new Map(mounts.rows.map(r => [r.def_id, Number(r.number)])) };
    },
    async marks(raw, personId, sql = pool) {
      const kingdomId = KingdomIdSchema.parse(raw);
      const result = await sql.query<{ species_id: string; n: number; first_ms: string; best_g: number; best_mm: number; first_kingdom: boolean }>(`
        SELECT species_id, count(*)::integer AS n, min(caught_ms) AS first_ms,
          max((record->'fish'->>'weightG')::integer) AS best_g, max((record->'fish'->>'lengthMm')::integer) AS best_mm,
          bool_or(kingdom_first) AS first_kingdom
        FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin=$2 AND owner_id=$3 GROUP BY species_id LIMIT 64`, [kingdomId, origin, personId]);
      return result.rows.map(r => Object.freeze({ speciesId: r.species_id, count: Number(r.n), firstAt: Number(r.first_ms),
        bestWeightG: Number(r.best_g), bestLengthMm: Number(r.best_mm), kingdomFirst: r.first_kingdom === true }))
        .sort((a, b) => a.speciesId < b.speciesId ? -1 : 1);
    },
    async hidden(raw, personId) {
      const kingdomId = KingdomIdSchema.parse(raw);
      const result = await pool.query(`SELECT 1 FROM realm_pier_hidden_names WHERE kingdom_id=$1 AND origin=$2 AND person_id=$3
        UNION ALL SELECT 1 FROM realm_item_hidden_names WHERE person_id=$3 LIMIT 1`, [kingdomId, origin, personId]);
      return (result.rowCount ?? 0) > 0;
    },
    async hide(raw, personId, at) {
      const kingdomId = KingdomIdSchema.parse(raw);
      await pool.query(`INSERT INTO realm_pier_hidden_names (kingdom_id, origin, person_id, hidden_ms) VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`, [kingdomId, origin, personId, at]);
    },
  };
}
