import { createHash, randomUUID } from 'node:crypto';
import { ServerError } from '@colyseus/core';
import type { Pool } from 'pg';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { RealmJoinSchema, type RealmAuthenticator, type RealmJoin, type RealmPrincipal } from '@chatdom/shared/realm';

/** Shown for everyone without an approved public name or look. Never derived from browser input. */
export const REALM_ANONYMOUS_PRESENTATION = { publicName: 'Citizen', look: 'neutral' } as const;

export interface RealmAuthenticatorOptions {
  /** A pool whose search_path is the shared realm schema the API issues into. */
  readonly pool: Pool;
  /** Live realms accept only live sessions; a SIMULATED realm accepts only simulated ones. */
  readonly origin: 'live' | 'simulated';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXPIRED_TICKET = 'This entry ticket was already used or has expired. Ask for a new one.';
const ENDED_SESSION = 'Your Chatdom session has ended. Sign in again to walk here.';

interface ConsumedTicket {
  readonly session_id: string; readonly person_id: string; readonly kingdom_id: string; readonly protocol: number;
  readonly origin: string; readonly ticket_live: boolean; readonly session_person: string; readonly session_origin: string;
  readonly session_live: boolean; readonly revoked: boolean; readonly session_expires_ms: string;
  readonly person_origin: string; readonly public_name: string | null;
}

/**
 * The realm's half of entry. A ticket is burned by the first presentation, whatever happens next, so a leaked or
 * mistargeted ticket can never be retried. Identity comes only from the session row the API created after verified
 * sign-in; nothing in the join chooses a person. Database failure refuses entry and never grants it.
 *
 * The principal's `sessionId` is a fresh entry id (`realm_entries`), not the Chatdom session id. Colyseus adopts it as
 * the walker's room id, which every client in the room sees; a per-entry id keeps the session id private and gives
 * each window its own seat id. `current` resolves the entry back to its session on every check.
 */
export function createRealmAuthenticator({ pool, origin }: RealmAuthenticatorOptions): RealmAuthenticator {
  return {
    async authenticate(join: RealmJoin): Promise<RealmPrincipal> {
      const parsed = RealmJoinSchema.safeParse(join);
      if (!parsed.success) throw new ServerError(400, 'This kingdom entry is malformed');
      const ticketHash = createHash('sha256').update(parsed.data.ticket).digest();
      let row: ConsumedTicket | undefined;
      try {
        const result = await pool.query<ConsumedTicket>(`
          with burned as (
            update realm_tickets set consumed_at = now()
            where ticket_hash = $1 and consumed_at is null
            returning session_id, person_id, kingdom_id, protocol, origin, expires_at > now() as ticket_live)
          select b.session_id::text, b.person_id, b.kingdom_id, b.protocol, b.origin, b.ticket_live,
            s.person_id as session_person, s.origin as session_origin, s.expires_at > now() as session_live,
            s.revoked_at is not null as revoked, floor(extract(epoch from s.expires_at) * 1000)::bigint::text as session_expires_ms,
            p.origin as person_origin, p.public_name
          from burned b join realm_sessions s on s.session_id = b.session_id join realm_persons p on p.person_id = b.person_id`,
        [ticketHash]);
        row = result.rows[0];
      } catch {
        throw new ServerError(503, 'Kingdom entry is unavailable right now. Nothing has changed; try again shortly.');
      }
      if (!row || !row.ticket_live || row.kingdom_id !== parsed.data.kingdomId || row.protocol !== parsed.data.protocol) throw new ServerError(403, EXPIRED_TICKET);
      if (row.origin !== origin || row.session_origin !== origin || row.person_origin !== origin) throw new ServerError(403, 'This realm does not accept that kind of entry');
      if (row.revoked || !row.session_live || row.session_person !== row.person_id) throw new ServerError(403, ENDED_SESSION);
      const entryId = randomUUID();
      try {
        await pool.query('insert into realm_entries (entry_id, session_id, person_id, kingdom_id, origin) values ($1, $2, $3, $4, $5)',
          [entryId, row.session_id, row.person_id, row.kingdom_id, origin]);
      } catch {
        throw new ServerError(503, 'Kingdom entry is unavailable right now. Nothing has changed; try again shortly.');
      }
      return {
        personId: PersonIdSchema.parse(row.person_id), kingdomId: KingdomIdSchema.parse(row.kingdom_id),
        sessionId: entryId, expiresAt: Number(row.session_expires_ms), origin,
        publicName: row.public_name ?? REALM_ANONYMOUS_PRESENTATION.publicName, look: REALM_ANONYMOUS_PRESENTATION.look,
      };
    },
    async current(principal: RealmPrincipal, now: number): Promise<boolean> {
      if (principal.origin !== origin || !UUID.test(principal.sessionId) || !Number.isFinite(now)) return false;
      const result = await pool.query(`
        select 1 from realm_entries e join realm_sessions s on s.session_id = e.session_id join realm_persons p on p.person_id = s.person_id
        where e.entry_id = $1 and e.person_id = $2 and e.kingdom_id = $5 and e.origin = $3 and s.person_id = $2 and s.origin = $3 and p.origin = $3
          and s.revoked_at is null and s.expires_at > greatest(now(), to_timestamp($4::double precision / 1000))`,
      [principal.sessionId, principal.personId, origin, now, principal.kingdomId]);
      return result.rowCount === 1;
    },
  };
}
