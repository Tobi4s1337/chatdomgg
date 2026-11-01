import type { GrowthSceneFrame, KingdomId } from '@chatdom/shared';
import type { RealmFact, RealmPrivateState } from '@chatdom/shared/realm';
import { applyRealmFact, createRealmState } from '@chatdom/world/realm';
import { projectGrowthScene } from '@chatdom/world/growth';
import { sha256Hex } from '../persistence/codec';

export interface StoredHistoryFact { readonly seq: string; readonly fact: string; readonly digest: string }
export interface HistoricalState { readonly state: RealmPrivateState; readonly frame: GrowthSceneFrame; readonly caption: string }

/** Server-only reconstruction. Private facts never cross the read projection boundary. */
export function reconstructHistory(kingdomId: KingdomId, origin: 'live' | 'simulated', through: number, rows: readonly StoredHistoryFact[]): readonly HistoricalState[] {
  let state = createRealmState(kingdomId, origin), lastAt = 0;
  const nights = new Map<number, HistoricalState>();
  for (const row of rows) {
    if (Number(row.seq) !== state.sequence + 1 || sha256Hex(row.fact) !== row.digest) throw new Error('Chronicle history is incomplete.');
    const fact = JSON.parse(row.fact) as RealmFact;
    if (!Number.isSafeInteger(fact.committedAt) || fact.committedAt < lastAt) throw new Error('Chronicle history has invalid clock order.');
    state = applyRealmFact(state, fact); lastAt = fact.committedAt;
    if (!state.growth) throw new Error('Chronicle growth reconstruction is unavailable.');
    // Every chosen scene is complete state at the LAST committed fact of its UTC night. No recent-tail inference.
    const frame = { ...projectGrowthScene(state.growth), sequence: fact.seq, asOf: fact.committedAt, beats: [] };
    const previous = nights.get(Math.floor(fact.committedAt / 86_400_000));
    nights.set(Math.floor(fact.committedAt / 86_400_000), { state, frame, caption: describe(fact, previous?.caption) });
  }
  if (state.sequence !== through) throw new Error('Chronicle history has a sequence gap.');
  return [...nights.values()];
}
function describe(fact: RealmFact, earlier?: string): string {
  switch (fact.body.type) {
    case 'home.growNative': return `A home grew from ${fact.body.fromTier} to ${fact.body.tier}.`;
    case 'home.replaceApproved': return 'A citizen published a new home.';
    case 'home.installAllocated': return earlier ?? 'A citizen settled into their home.';
    case 'castle.installNative': return earlier ?? 'The monarch’s keep took its place in the kingdom.';
    case 'forge.commitApproved': return 'A newly forged piece found its place in the kingdom.';
    case 'presence.confirmInterval': return earlier ?? 'The kingdom witnessed its citizens spending the night together.';
    case 'stream.observe': return earlier ?? (fact.body.sessionId ? 'The stream began and the kingdom woke.' : 'The stream ended and the kingdom rested.');
    default: return earlier ?? 'The kingdom kept the story of this night.';
  }
}
