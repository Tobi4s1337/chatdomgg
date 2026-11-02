import type { KingdomId, PersonId, HomePlaceRefusal, RealmHomePlaceReply } from '@chatdom/shared';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from '../../../api/src/realm-auth/presentation';
import type { AllocationService, Deed } from '../allocation';
import type { createRealmCitizens } from '../evening/citizens';
import { decodeIngressCheckpoint, presencePerson } from '../ingress/codec';
import type { DurableKingdom, DurableRealmServices, RealmDatabase } from '../persistence';
import type { LookOrigin } from './ports';

/*
 * "Take your place" from the web game: the signed-in person asks for a home in the kingdom they are walking. It is
 * the panel's claim on the session's own person: their approved sign-in name, then `citizens.settle` inside the
 * kingdom's retained writer, which allocates and installs exactly as chat and the panel do. The installed home is a
 * committed kingdom command, so every walker in the room sees it arrive. The monarch's seat is the castle; they never
 * get a street home in their own kingdom.
 */

export const HOME_PLACE_REASONS: Readonly<Record<HomePlaceRefusal, string>> = {
  unauthenticated: 'Sign in with Twitch to take your place here.',
  forbidden: 'That request did not come from your Chatdom page. Reload the page and try again.',
  malformed: 'That is not a kingdom.',
  unnamed: 'Your Twitch name cannot be shown on a home just now. Sign in again, then take your place.',
  castle: 'This is your own kingdom. The castle is already yours.',
  unfounded: 'This kingdom has not been founded yet, so it has no streets to settle.',
  held: 'You cannot take a place in this kingdom just now.',
  'three-homes': 'You already keep three homes, the most anyone may hold. You are welcome here as a guest.',
  'kingdom-full': 'Every home here is taken for now. You are welcome as a guest until one comes free.',
  busy: 'Your place is already being made ready. Give it a moment.',
  unavailable: 'The kingdom could not settle you just now. Nothing was changed; try again in a moment.',
};

const HTTP: Readonly<Record<HomePlaceRefusal, number>> = {
  unauthenticated: 401, forbidden: 403, malformed: 400, busy: 429, unavailable: 503,
  unnamed: 409, castle: 409, unfounded: 409, held: 409, 'three-homes': 409, 'kingdom-full': 409,
};

export interface HomePlaceOutcome { readonly status: number; readonly reply: RealmHomePlaceReply }

export function placeRefusal(code: HomePlaceRefusal): HomePlaceOutcome {
  return { status: HTTP[code], reply: { version: 1, ok: false, code, reason: HOME_PLACE_REASONS[code] } };
}

export interface HomePlaces {
  /** Grants `personId` a home in `kingdomId`, or says why not. Never throws; storage trouble is `unavailable`. */
  take(personId: PersonId, kingdomId: KingdomId): Promise<HomePlaceOutcome>;
}

export function homePlaceOf(deed: Pick<Deed, 'kingdomId' | 'plotId' | 'placement'>): Extract<RealmHomePlaceReply, { ok: true }>['home'] {
  const street = deed.placement.street;
  return { kingdomId: deed.kingdomId, plotId: deed.plotId, street, place: `Number ${deed.placement.ordinal + 1} on ${street}` };
}

export function createHomePlaces(options: {
  readonly db: Pick<RealmDatabase, 'query'>;
  readonly origin: LookOrigin;
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly allocation: Pick<AllocationService, 'currentLayout' | 'allocate' | 'deedIn'>;
  readonly citizens: Pick<ReturnType<typeof createRealmCitizens>, 'settle'>;
  readonly log?: (line: string) => void;
}): HomePlaces {
  const { db, origin, services, allocation, citizens } = options, log = options.log ?? (() => {});
  /** One claim at a time per person: a second press while the first is settling is told to wait. */
  const settling = new Set<string>();

  /** The approved public name the sign-in recorded for this person, or null. */
  const nameOf = async (personId: PersonId): Promise<string | null> => {
    const row = (await db.query<{ public_name: string | null; name_approval: string | null }>(
      'SELECT public_name, name_approval FROM realm_persons WHERE person_id = $1 AND origin = $2', [personId, origin])).rows[0];
    if (!row || row.name_approval !== DISPLAY_NAME_APPROVAL) return null;
    const name = approvedPublicName(row.public_name);
    return name && name === row.public_name && name.length <= 64 ? name : null;
  };

  const assertCurrent = (kingdom: DurableKingdom) => {
    if (!kingdom.current || kingdom.origin !== origin) throw new Error('The kingdom writer is unavailable.');
  };

  /** Moderation only, as the panel reads it: blocked rights, or a presence restriction still in force. */
  const held = async (kingdom: DurableKingdom, personId: PersonId): Promise<boolean> => {
    if (kingdom.privateState.rights[personId]?.blocked) return true;
    const row = (await db.query<{ revision: string; codec: string; data: Buffer }>(
      'SELECT revision, codec, data FROM realm_ingress_checkpoints WHERE kingdom_id = $1', [kingdom.kingdomId])).rows[0];
    if (!row) return false;
    if (row.codec !== 'presence-v1') throw new Error('The presence checkpoint is unavailable.');
    const checkpoint = decodeIngressCheckpoint({ version: 1, revision: Number(row.revision), codec: 'presence-v1', data: new Uint8Array(row.data) }, kingdom.kingdomId, origin);
    const restriction = presencePerson(checkpoint.presence, personId)?.restriction;
    return !!restriction && (restriction.until === null || restriction.until > kingdom.databaseNow());
  };

  async function settle(personId: PersonId, kingdomId: KingdomId): Promise<HomePlaceOutcome> {
    if (String(personId) === String(kingdomId)) return placeRefusal('castle');
    const name = await nameOf(personId);
    if (!name) return placeRefusal('unnamed');
    // Check the authoritative layout before retaining: opening a missing kingdom must never found one.
    if (!await allocation.currentLayout(kingdomId)) return placeRefusal('unfounded');
    const hold = await services.retain(kingdomId);
    try {
      const kingdom = hold.kingdom;
      assertCurrent(kingdom);
      if (await held(kingdom, personId)) return placeRefusal('held');
      const settled = await citizens.settle(kingdom, { personId, name }, {});
      assertCurrent(kingdom);
      // `settle` returns null for guests; the allocator's idempotent answer says which.
      const result = await allocation.allocate({ kingdomId, personId, evidence: [] });
      if (result.status === 'deed') {
        // A counted but uninstalled deed is not a home yet.
        const deed = await allocation.deedIn(kingdomId, personId);
        if (!deed || deed.status !== 'installed' || deed.origin !== origin) return placeRefusal('unavailable');
        return { status: 200, reply: { version: 1, ok: true, fresh: settled?.fresh === true, home: homePlaceOf(deed) } };
      }
      if (result.status === 'guest') return placeRefusal(result.reason);
      if (result.status === 'castle') return placeRefusal('castle');
      return placeRefusal(result.reason === 'unfounded' ? 'unfounded' : 'unavailable');
    } finally { await hold.release(); }
  }

  return {
    async take(personId, kingdomId) {
      const key = `${personId}:${kingdomId}`;
      if (settling.has(key)) return placeRefusal('busy');
      settling.add(key);
      try { return await settle(personId, kingdomId); }
      catch (error) { log(`take your place failed: ${(error as Error).name}: ${(error as Error).message}`); return placeRefusal('unavailable'); }
      finally { settling.delete(key); }
    },
  };
}
