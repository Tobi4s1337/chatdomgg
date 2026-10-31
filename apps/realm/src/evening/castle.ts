import { createHmac } from 'node:crypto';
import { kingdomForBroadcaster, type KingdomId, type PersonId } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, castleHostId, type RealmDomainCommand } from '@chatdom/shared/realm';
import { approvedPublicName, DISPLAY_NAME_APPROVAL } from '../../../api/src/realm-auth/presentation';
import type { FoundedLayoutSource } from '../founded/load';
import type { FoundedWorldStore } from '../founded/provider';
import type { DurableKingdom } from '../persistence';
import { canonicalJson, digestOf } from '../persistence/codec';
import type { RealmCommitGuard } from '../persistence/postgres-repository';
import { forgeHomeDigest } from '../wiring/forge';

type Install = Extract<RealmDomainCommand, { type: 'castle.installNative' }>;
interface Prepared { readonly command: Install; readonly bytes: string }

/**
 * Trusted chat's broadcaster identity can claim only the actual adopted keep. The pinned native bytes are
 * prepared outside SQL, then the same writer transaction verifies the adopted head and approved provider name.
 * This creates neither a citizen deed nor follow history; presence still earns the night's coal separately.
 */
export function createRealmCastle(options: {
  readonly origin: 'live' | 'simulated';
  readonly kingdomNames: ReadonlyMap<KingdomId, string>;
  readonly safetyKey: Uint8Array;
}) {
  if (options.safetyKey.byteLength < 32) throw new Error('Castle identity requires the realm evidence key.');
  let allocation: FoundedLayoutSource | undefined, store: FoundedWorldStore | undefined;
  const prepared = new Map<KingdomId, Prepared>();
  const guard: RealmCommitGuard = async (tx, fact) => {
    if (fact.body.type !== 'castle.installNative') return 'ok';
    const expected = prepared.get(fact.kingdomId), h = fact.body.castle;
    if (!expected || fact.origin !== options.origin || expected.bytes !== canonicalJson(fact.body)
      || kingdomForBroadcaster(h.ownerId) !== fact.kingdomId) return 'conflict';
    // Same layout lock as allocation, after the kingdom writer row. A concurrent adoption cannot slip through.
    const head = (await tx.query<{ revision: string; origin: string }>(
      'SELECT revision, origin FROM realm_layout_heads WHERE kingdom_id = $1 FOR SHARE', [fact.kingdomId])).rows[0];
    const name = (await tx.query<{ public_name: string; name_approval: string }>(
      'SELECT public_name, name_approval FROM realm_citizen_names WHERE person_id = $1 AND origin = $2',
      [h.ownerId, options.origin])).rows[0];
    return head?.origin === options.origin && head.revision === h.layoutRevision
      && name?.name_approval === DISPLAY_NAME_APPROVAL && name.public_name === h.attribution.makerName ? 'ok' : 'conflict';
  };
  return {
    guard,
    use(next: FoundedLayoutSource, nativeStore: FoundedWorldStore): void {
      if ((allocation && allocation !== next) || (store && store !== nativeStore) || next.origin !== options.origin) {
        throw new Error('Castle authority already belongs to another realm.');
      }
      allocation = next; store = nativeStore;
    },
    /** Called only from gate-admitted, current, named chat, on its already retained kingdom writer. */
    async observe(kingdom: DurableKingdom, personId: PersonId, makerName: string): Promise<void> {
      if (!kingdom.current || kingdom.origin !== options.origin || kingdomForBroadcaster(personId) !== kingdom.kingdomId) return;
      const kingdomName = options.kingdomNames.get(kingdom.kingdomId);
      if (!kingdomName || approvedPublicName(kingdomName) !== kingdomName || kingdomName.length > 64
        || approvedPublicName(makerName) !== makerName || !makerName || makerName.length > 64) return;
      if (!allocation || !store) throw new Error('Castle authority is not composed.');
      if (!kingdom.privateState.castle) {
        const head = await allocation.currentLayout(kingdom.kingdomId);
        if (!head) throw new Error('The castle waits for its adopted kingdom.');
        let pending = prepared.get(kingdom.kingdomId);
        if (!pending || pending.command.castle.layoutRevision !== head.revision
          || pending.command.castle.attribution.makerName !== makerName) {
          const plan = await allocation.layoutPlan(kingdom.kingdomId, head.revision);
          const native = await store.native(kingdom.kingdomId, plan, options.origin);
          const moduleId = plan.castle.beaconModuleId, keep = native.fixtures.find(p => p.id === castleHostId(moduleId));
          if (!keep || keep.blueprint.kind !== 'civic') throw new Error('The actual adopted keep is unavailable.');
          const digest = forgeHomeDigest(keep.blueprint);
          const command: Install = { type: 'castle.installNative', castle: {
            id: castleHostId(moduleId), moduleId, ownerId: personId, slot: REALM_CASTLE_SLOT,
            layoutRevision: head.revision, revision: `native:${digest}`, digest, family: 'tide',
            blueprint: keep.blueprint, attachments: {},
            attribution: { makerName, kingdomName, approvalId: DISPLAY_NAME_APPROVAL },
          } };
          pending = { command, bytes: canonicalJson(command) };
          prepared.delete(kingdom.kingdomId); prepared.set(kingdom.kingdomId, pending);
          while (prepared.size > 64) prepared.delete(prepared.keys().next().value!);
        }
        const result = await kingdom.execute(`castle:native:${digestOf(pending.command)}`, pending.command, 'allocation');
        if (result.status !== 'committed' && !kingdom.privateState.castle) throw new Error('The native castle installation remains held.');
      }
      // The kingdom ID is the broadcaster's provider ID. This intrinsic right is independent of unknown follows.
      const state = kingdom.privateState, previous = state.rights[personId];
      const safetyIdentifier = createHmac('sha256', options.safetyKey).update(`chatdom.safety.v1\n${options.origin}\n${personId}`).digest('hex');
      if (previous?.forge && previous.safetyIdentifier === safetyIdentifier) return;
      const rights = { revision: (previous?.revision ?? 0) + 1, forge: true,
        build: previous?.build ?? true, blocked: previous?.blocked ?? false, safetyIdentifier };
      await kingdom.execute(`monarch:rights:${personId}:${rights.revision}:${digestOf(rights)}`,
        { type: 'citizen.rights', personId, rights }, 'moderation');
    },
  };
}
