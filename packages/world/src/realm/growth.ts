import type { RealmFact, RealmPrivateState } from '@chatdom/shared/realm';
import { createGrowthState, GROWTH_POLICY_V1, reduceGrowth, type GrowthObservation, type GrowthTransition } from '../growth';

/** Derive growth only from the same committed facts that own stream and interval authority. */
export function growRealmFact(prior: RealmPrivateState, next: RealmPrivateState, fact: RealmFact): GrowthTransition {
  const state = prior.growth ?? createGrowthState(prior.kingdomId, prior.origin);
  const unchanged = { state, milestones: [] };
  const command = fact.body;
  const base = { kingdomId: fact.kingdomId, origin: fact.origin, seq: fact.seq, at: fact.committedAt };
  let observation: GrowthObservation;
  switch (command.type) {
    case 'stream.observe':
      if (command.sessionId === null || state.session?.id === command.sessionId
        || state.session && command.startedAt < state.session.startedAt) return unchanged;
      // Older realm histories can contain delayed stream observations. They are immutable facts,
      // but cannot reopen an earlier growth day or qualify its late presence evidence.
      observation = { ...base, type: 'stream-observed', sessionId: command.sessionId, startedAt: command.startedAt };
      break;
    case 'presence.confirmInterval': {
      const key = `${command.personId}:${command.streamSessionId}`;
      const before = prior.qualification[key]?.coveredMs ?? 0;
      const after = next.qualification[key]?.coveredMs ?? 0;
      if (before >= GROWTH_POLICY_V1.qualifiedPresenceMs || after < GROWTH_POLICY_V1.qualifiedPresenceMs
        || state.session?.id !== command.streamSessionId) return unchanged;
      observation = { ...base, type: 'presence-qualified', personId: command.personId, sessionId: command.streamSessionId,
        source: 'observed-presence', coveredMs: after, evidenceReceipt: command.evidenceReceipt };
      break;
    }
    case 'growth.bindHome': {
      const home = Object.hasOwn(next.homes, command.homeId) ? next.homes[command.homeId] : undefined;
      if (!home) throw new TypeError('Growth binding requires its allocated home');
      observation = { ...base, type: 'home-bound', personId: home.ownerId, plotId: home.id, installedTier: command.installedTier };
      break;
    }
    default: return unchanged;
  }
  return reduceGrowth(state, observation);
}
