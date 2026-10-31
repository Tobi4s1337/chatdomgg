import { createNativeForgeHost } from '@chatdom/forge';
import { PRESENCE_LEASE_MS, type KingdomId, type PresenceInput, type PersonId } from '@chatdom/shared';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from '../../../api/src/realm-auth/presentation';
import { AllocationUnavailableError, type AllocationService, type HomeFurnisher } from '../allocation';
import type { DurableKingdom, DurableRealmServices, RealmDatabase } from '../persistence';
import { forgeHomeDigest } from '../wiring/forge';

export interface RealmCitizensOptions {
  readonly db: Pick<RealmDatabase, 'query'>;
  readonly origin: 'live' | 'simulated';
  /** Explicit host-approved names, the same map used by the kingdom entry surface. */
  readonly kingdomNames: ReadonlyMap<KingdomId, string>;
  /** Same retained writer, after provider-name persistence; never open a second authority. */
  readonly castle?: (kingdom: DurableKingdom, personId: PersonId, name: string) => Promise<void>;
}

/**
 * Composes existing allocation with provider-name evidence and the registry's single retained writer.
 * This is an internal callback AFTER Herald's ingress gate, never a public identity/allocation endpoint.
 * Chat witnesses no follow date or subscription history and grants no Forge/build rights or coal.
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

  return {
    furnish,
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
      try {
        const kingdom = hold.kingdom, now = kingdom.databaseNow();
        if (!kingdom.current || kingdom.origin !== options.origin) throw new AllocationUnavailableError('The citizen writer is unavailable.');
        if (input.observedAt > now || now - input.observedAt >= PRESENCE_LEASE_MS) return;
        for (const person of input.people) {
          if (person.disclosure !== 'named') continue;
          const name = approvedPublicName(person.displayName);
          if (!name || name.length > 64) continue;
          // Independent of sign-in rows: chat evidence must never pretend to be an OIDC authentication.
          await options.db.query(`INSERT INTO realm_citizen_names AS n (person_id, origin, public_name, name_approval, observed_ms)
            VALUES ($1, $2, $3, $4, $5) ON CONFLICT (person_id, origin) DO UPDATE
            SET public_name = excluded.public_name, name_approval = excluded.name_approval, observed_ms = excluded.observed_ms
            WHERE n.observed_ms < excluded.observed_ms`, [person.personId, options.origin, name, DISPLAY_NAME_APPROVAL, input.observedAt]);
        }
        // Prepared commands carry fixed bytes; names persisted before allocation also recover the smaller
        // crash window between a pending deed's commit and its first command preparation.
        await allocation.recover(kingdom);
        for (const person of input.people) {
          const result = await allocation.allocate({ kingdomId: input.kingdomId, personId: person.personId, evidence: [] });
          if (result.status === 'castle' && person.disclosure === 'named') {
            const name = approvedPublicName(person.displayName);
            if (name && name.length <= 64) await options.castle?.(kingdom, person.personId, name);
          }
          if (result.status !== 'deed') continue; // The existing service owns castle, guest-cap and origin rules.
          const installed = await allocation.install(kingdom, result.deed);
          if (installed.status !== 'installed') throw new AllocationUnavailableError(`The citizen home remains ${installed.status}.`);
        }
      } finally { await hold.release(); }
    },
  };
}
