import { fishingRodHistory, type FishingRodHistory, type KingdomId, type PersonId } from '@chatdom/shared';
import type { Pool } from 'pg';
import type { FishingSpecies } from './species';

/**
 * A walker's rod history in one kingdom (PI12), from the kingdom's own catch records: every fish they landed on the pier
 * (chat lines are not a rod) and the first legend among them. One rod per person and kingdom, so the person's pier
 * catches are the rod's.
 */
export async function readRodHistory(pool: Pick<Pool, 'query'>, input: { readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated';
  readonly ownerId: PersonId; readonly species: FishingSpecies }): Promise<FishingRodHistory> {
  const legends = input.species.all().filter(fish => fish.legend).map(fish => fish.id);
  const result = await pool.query<{ catches: number; legend: { speciesId: string; at: string | number } | null }>(`
    SELECT count(*)::integer AS catches,
      (SELECT jsonb_build_object('speciesId', l.species_id, 'at', l.caught_ms) FROM realm_fishing_catches l
        WHERE l.kingdom_id=$1 AND l.origin=$2 AND l.owner_id=$3 AND coalesce(l.record->>'via', 'pier')='pier'
          AND l.species_id = ANY($4::text[]) ORDER BY l.caught_ms, l.id LIMIT 1) AS legend
    FROM realm_fishing_catches c
    WHERE c.kingdom_id=$1 AND c.origin=$2 AND c.owner_id=$3 AND coalesce(c.record->>'via', 'pier')='pier'`,
  [input.kingdomId, input.origin, input.ownerId, legends]);
  const row = result.rows[0];
  const legend = row?.legend ? { speciesId: String(row.legend.speciesId), at: Number(row.legend.at) } : null;
  return fishingRodHistory(row?.catches ?? 0, legend && Number.isSafeInteger(legend.at) ? legend : null);
}
