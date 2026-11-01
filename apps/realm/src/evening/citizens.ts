import { createNativeForgeHost } from '@chatdom/forge';
import { PRESENCE_LEASE_MS, type KingdomId, type PresenceInput, type PersonId } from '@chatdom/shared';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from '../../../api/src/realm-auth/presentation';
import { AllocationUnavailableError, signTenureEvidence, type AllocationService, type HomeFurnisher, type TenureEvidence } from '../allocation';
import type { DurableKingdom, DurableRealmServices, RealmDatabase } from '../persistence';
import { forgeHomeDigest } from '../wiring/forge';

export interface RealmCitizensOptions {
  readonly db: Pick<RealmDatabase, 'query'>;
  readonly origin: 'live' | 'simulated';
  /** Explicit host-approved names, the same map used by the kingdom entry surface. */
  readonly kingdomNames: ReadonlyMap<KingdomId, string>;
  /** Same retained writer, after provider-name persistence; never open a second authority. */
  readonly castle?: (kingdom: DurableKingdom, personId: PersonId, name: string) => Promise<void>;
  /** The realm's tenure evidence key: a follow or a sub the Herald witnessed is signed with it before allocation. */
  readonly evidenceKey?: Uint8Array;
  /**
   * After a chat observation settled its people (writer released): each person with a home, and whether that home is
   * new. The town hears it as people coming home tonight. Never awaited into presence: it must not fail chat.
   */
  readonly homecoming?: (kingdomId: KingdomId, people: readonly { readonly personId: PersonId; readonly fresh: boolean }[], at: number) => Promise<void>;
}

/**
 * Composes existing allocation with provider-name evidence and the registry's single retained writer.
 * This is an internal callback AFTER Herald's ingress gate, never a public identity/allocation endpoint.
 * Chat witnesses no follow date or subscription history and grants no Forge/build rights or coal. A follow or a shared
 * sub does: `settle` signs exactly what the Herald saw (the follow time, the months) and places the home by it.
 */
export function createRealmCitizens(options: RealmCitizensOptions) {
  let allocation: AllocationService | undefined, services: DurableRealmServices | undefined;

  const furnish: HomeFurnisher = async deed => {
    if (deed.origin !== options.origin) throw new AllocationUnavailableError('The deed belongs to another realm origin.');
    const row = (await options.db.query<{ public_name: string; name_approval: string }>(
      'SELECT public_name, name_approval FROM realm_citizen_names WHERE person_id = $1 AND origin = $2',
      [deed.personId, options.origin])).rows[0];
    const makerName = row?.name_approval === DISPLAY_NAME_APPROVAL ? approvedPublicName(row.public_name) : null;
    const kingdomName = options.kingdomNames.get(deed.kingdomId);
    if (!makerName || makerName !== row?.public_name || makerName.length > 64
      || !kingdomName || approvedPublicName(kingdomName) !== kingdomName || kingdomName.length > 64) {
      throw new AllocationUnavailableError('The native home waits for its actual approved provider and kingdom names.');
    }
    // Exactly the approved native home already standing on this deed's immutable placement.
    const host = createNativeForgeHost(deed.placement), digest = forgeHomeDigest(host.blueprint);
    return { revision: `native:${digest}`, digest, family: host.family, blueprint: host.blueprint,
      attribution: { makerName, kingdomName, approvalId: DISPLAY_NAME_APPROVAL } };
  };

  const persistName = (personId: PersonId, name: string, at: number) => options.db.query(`INSERT INTO realm_citizen_names AS n (person_id, origin, public_name, name_approval, observed_ms)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (person_id, origin) DO UPDATE
    SET public_name = excluded.public_name, name_approval = excluded.name_approval, observed_ms = excluded.observed_ms
    WHERE n.observed_ms < excluded.observed_ms`, [personId, options.origin, name, DISPLAY_NAME_APPROVAL, at]);

  return {
    furnish,
    /**
     * A follow, a kingdom reward or a shared sub names a real person: settle them now, inside the caller's retained
     * writer, with the tenure the act itself witnessed. Someone already settled keeps their home. Null when nobody can
     * be settled (the monarch, a guest, a name that is not approved, a full kingdom).
     */
    async settle(kingdom: DurableKingdom, person: { readonly personId: PersonId; readonly name: string },
      tenure: { readonly followedAt?: number; readonly months?: number }): Promise<{ readonly fresh: boolean } | null> {
      if (!allocation) throw new AllocationUnavailableError('Citizen allocation is not composed.');
      if (!kingdom.current || kingdom.origin !== options.origin) throw new AllocationUnavailableError('The citizen writer is unavailable.');
      const name = approvedPublicName(person.name);
      if (!name || name.length > 64 || String(person.personId) === String(kingdom.kingdomId)) return null;
      const now = Math.floor(kingdom.databaseNow());
      await persistName(person.personId, name, now);
      const evidence: TenureEvidence[] = [];
      const base = { version: 1 as const, kingdomId: kingdom.kingdomId, personId: person.personId, origin: options.origin, observedAt: now };
      if (options.evidenceKey && tenure.followedAt !== undefined && tenure.followedAt <= now) {
        evidence.push(signTenureEvidence(options.evidenceKey, { ...base, kind: 'follow', source: 'eventsub.follow', followedAt: tenure.followedAt }));
      }
      if (options.evidenceKey && tenure.months !== undefined && tenure.months >= 1) {
        evidence.push(signTenureEvidence(options.evidenceKey, { ...base, kind: 'subscription', source: 'eventsub.subscription-message', months: Math.min(1_200, Math.floor(tenure.months)) }));
      }
      await allocation.recover(kingdom);
      const result = await allocation.allocate({ kingdomId: kingdom.kingdomId, personId: person.personId, evidence });
      if (result.status !== 'deed') return null;
      const installed = await allocation.install(kingdom, result.deed);
      if (installed.status !== 'installed') throw new AllocationUnavailableError(`The citizen home remains ${installed.status}.`);
      return { fresh: result.fresh };
    },
    /** Called once after boot has constructed the allocation service and the exact public registry. */
    use(nextAllocation: AllocationService, nextServices: DurableRealmServices): void {
      if ((allocation && allocation !== nextAllocation) || (services && services !== nextServices)) {
        throw new Error('Citizen allocation already belongs to a realm registry.');
      }
      if (nextAllocation.origin !== options.origin) throw new Error('Citizen allocation belongs to another origin.');
      allocation = nextAllocation; services = nextServices;
    },
    /** Registry afterOpen hook: no retain here, which would recursively wait on the opening itself. */
    async recover(kingdom: DurableKingdom): Promise<void> {
      if (!allocation) throw new AllocationUnavailableError('Citizen allocation is not composed.');
      if (kingdom.origin !== options.origin || !kingdom.current) throw new AllocationUnavailableError('The citizen writer is unavailable.');
      await allocation.recover(kingdom);
    },
    /** Only gate-admitted, current chat evidence may settle its real people before presence is accepted. */
    async observe(input: PresenceInput): Promise<void> {
      if (input.kind !== 'observe' || input.source !== 'chat' || input.origin !== options.origin) return;
      if (!allocation || !services) throw new AllocationUnavailableError('Citizen allocation is not composed.');
      const hold = await services.retain(input.kingdomId);
      const home: { personId: PersonId; fresh: boolean }[] = [];
      try {
        const kingdom = hold.kingdom, now = kingdom.databaseNow();
        if (!kingdom.current || kingdom.origin !== options.origin) throw new AllocationUnavailableError('The citizen writer is unavailable.');
        if (input.observedAt > now || now - input.observedAt >= PRESENCE_LEASE_MS) return;
        for (const person of input.people) {
          if (person.disclosure !== 'named') continue;
          const name = approvedPublicName(person.displayName);
          if (!name || name.length > 64) continue;
          // Independent of sign-in rows: chat evidence must never pretend to be an OIDC authentication.
          await persistName(person.personId, name, input.observedAt);
        }
        // Prepared commands carry fixed bytes; names persisted before allocation also recover the smaller
        // crash window between a pending deed's commit and its first command preparation.
        await allocation.recover(kingdom);
        for (const person of input.people) {
          const result = await allocation.allocate({ kingdomId: input.kingdomId, personId: person.personId, evidence: [] });
          if (result.status === 'deed') home.push({ personId: person.personId, fresh: result.fresh });
          if (result.status === 'castle' && person.disclosure === 'named') {
            const name = approvedPublicName(person.displayName);
            if (name && name.length <= 64) await options.castle?.(kingdom, person.personId, name);
          }
          if (result.status !== 'deed') continue; // The existing service owns castle, guest-cap and origin rules.
          const installed = await allocation.install(kingdom, result.deed);
          if (installed.status !== 'installed') throw new AllocationUnavailableError(`The citizen home remains ${installed.status}.`);
        }
      } finally { await hold.release(); }
      // Outside the writer: the town takes its own hold, and a homecoming never fails the chat that caused it.
      if (home.length && options.homecoming) void options.homecoming(input.kingdomId, home, input.observedAt).catch(() => undefined);
    },
  };
}
