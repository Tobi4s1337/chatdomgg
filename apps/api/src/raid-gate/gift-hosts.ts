/**
 * The gifts' host directory (`GiftHosts`) over the realm-auth tables, read the way `session.ts` reads them: always of
 * this gate's origin, so a live gift never finds a SIMULATED host or name, and the reverse.
 *
 * - `standing` is `monarch` for the channel's own Twitch account and `citizen` for a person with a deed that is not void
 *   in that kingdom, and both only for a realm kingdom of this origin. Anyone else is `none`.
 * - `names` are approved public names: the signed-in person's own (`realm_persons`) before the one chat showed
 *   (`realm_citizen_names`). A preferred name that does not read as display text is not swapped for the other; that
 *   person is shown anonymously. At most `GIFT_NAME_BATCH` people per query.
 */
import { KingdomIdSchema, PersonIdSchema, kingdomForBroadcaster, type KingdomId, type PersonId } from '../../../../packages/shared/src/identity';
import { DISPLAY_NAME_APPROVAL } from '../realm-auth/presentation';
import { displayText } from './contracts';
import type { GiftHosts } from './gifts';
import type { RecordOrigin } from './repository';
import type { SqlQueryable } from './session';

export type RealmGiftHostsOptions = Readonly<{ pool: SqlQueryable; origin: RecordOrigin }>;

/** People per name query. */
export const GIFT_NAME_BATCH = 100;

type StandingRow = { kingdom?: unknown; citizen?: unknown };
type NameRow = { person_id?: unknown; person_name?: unknown; citizen_name?: unknown };

export function createRealmGiftHosts(options: RealmGiftHostsOptions): GiftHosts {
  const { pool, origin } = options;
  if (origin !== 'live' && origin !== 'simulated') throw new Error('The gift host directory origin is live or simulated.');

  return {
    origin,
    async standing(personId: PersonId, kingdomId: KingdomId, signal: AbortSignal) {
      signal.throwIfAborted();
      if (!PersonIdSchema.safeParse(personId).success || !KingdomIdSchema.safeParse(kingdomId).success) return 'none';
      const result = await pool.query(`
        select exists (select 1 from realm_kingdoms k where k.kingdom_id = $2 and k.origin = $3) as kingdom,
          exists (select 1 from realm_deeds d where d.kingdom_id = $2 and d.person_id = $1 and d.origin = $3 and d.status <> 'void') as citizen`,
        [personId, kingdomId, origin]);
      signal.throwIfAborted();
      const row = result.rows[0] as StandingRow | undefined;
      if (row?.kingdom !== true) return 'none';
      if (kingdomForBroadcaster(personId) === kingdomId) return 'monarch';
      return row.citizen === true ? 'citizen' : 'none';
    },

    async names(personIds: readonly PersonId[], signal: AbortSignal) {
      signal.throwIfAborted();
      const asked = [...new Set(personIds)].filter(id => PersonIdSchema.safeParse(id).success);
      const found = new Map<PersonId, string>();
      for (let at = 0; at < asked.length; at += GIFT_NAME_BATCH) {
        const batch = asked.slice(at, at + GIFT_NAME_BATCH);
        signal.throwIfAborted();
        const result = await pool.query(`
          select ids.person_id, p.public_name as person_name, c.public_name as citizen_name
          from unnest($1::text[]) as ids (person_id)
          left join realm_persons p on p.person_id = ids.person_id and p.origin = $2 and p.public_name is not null and p.name_approval = $3
          left join realm_citizen_names c on c.person_id = ids.person_id and c.origin = $2 and c.name_approval = $3
          where p.public_name is not null or c.public_name is not null`, [batch, origin, DISPLAY_NAME_APPROVAL]);
        signal.throwIfAborted();
        for (const row of result.rows as NameRow[]) {
          const id = batch.find(each => each === row.person_id);
          const name = displayText(row.person_name ?? row.citizen_name);
          if (id !== undefined && name !== undefined) found.set(id, name);
        }
      }
      return found;
    },
  };
}
