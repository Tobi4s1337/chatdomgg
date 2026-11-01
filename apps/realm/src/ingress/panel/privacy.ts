import type { KingdomId, PersonId } from '@chatdom/shared';
import type { RealmDatabase } from '../../persistence';

/** Main supplies replay-safe, subject-wide erasure. Suppressing a presence record is not erasure. */
export interface RealmForgetAuthority {
  forget(input: {
    readonly personId: PersonId;
    readonly requestedFromKingdomId: KingdomId;
    readonly origin: 'live' | 'simulated';
    readonly requestId: string;
  }): Promise<
    | { readonly status: 'forgotten'; readonly operationId: string; readonly erased: readonly string[]; readonly retained: readonly string[] }
    | { readonly status: 'pending'; readonly operationId: string }
    | { readonly status: 'unavailable' }
  >;
}
export type PersonPrivacy = { readonly quiet: boolean; readonly projection: 'pending'; readonly forgetAvailable: boolean };
type Database = Pick<RealmDatabase, 'query'>;

/** One preference per person, across all kingdoms. No provider profile or content ownership is changed. */
export async function personPrivacy(db: Database, origin: 'live' | 'simulated', personId: PersonId, forgetAvailable: boolean): Promise<PersonPrivacy> {
  const result = await db.query<{ quiet: boolean }>('SELECT quiet FROM realm_panel_privacy WHERE person_id = $1 AND origin = $2', [personId, origin]);
  return { quiet: result.rows[0]?.quiet ?? false, projection: 'pending', forgetAvailable };
}

/** Both panel and chat-command doors must call this function; neither invents another privacy preference. */
export async function setPersonQuiet(db: Database, origin: 'live' | 'simulated', personId: PersonId, quiet: boolean): Promise<void> {
  await db.query(`INSERT INTO realm_panel_privacy (person_id, origin, quiet, updated_ms)
    VALUES ($1, $2, $3, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
    ON CONFLICT (person_id, origin) DO UPDATE SET quiet = excluded.quiet, updated_ms = excluded.updated_ms`, [personId, origin, quiet]);
}

/** No partial deletes or permanent presence tombstone are substituted for the authority's completed erasure. */
export async function forgetPerson(authority: RealmForgetAuthority | undefined, input: Parameters<RealmForgetAuthority['forget']>[0]): ReturnType<RealmForgetAuthority['forget']> {
  return authority ? authority.forget(input) : { status: 'unavailable' };
}
