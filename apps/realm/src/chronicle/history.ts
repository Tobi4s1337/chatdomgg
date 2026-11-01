import type { GrowthSceneFrame, GrowthCivicPlace, KingdomId } from '@chatdom/shared';
import type { RealmFact, RealmPrivateState } from '@chatdom/shared/realm';
import { applyRealmFact, createRealmState, projectRealmFact } from '@chatdom/world/realm';
import { projectGrowthScene } from '@chatdom/world/growth';
import { sha256Hex } from '../persistence/codec';

export interface StoredHistoryFact { readonly seq: string; readonly fact: string; readonly digest: string }
export interface HistoricalState { readonly state: RealmPrivateState; readonly frame: GrowthSceneFrame; readonly caption: string; readonly nightAt: number }

/** Server-only reconstruction. Private facts never cross the read projection boundary. */
export function reconstructHistory(kingdomId: KingdomId, origin: 'live' | 'simulated', through: number, rows: readonly StoredHistoryFact[]): readonly HistoricalState[] {
  let state = createRealmState(kingdomId, origin), lastAt = 0;
  const nights: HistoricalState[] = [];
  let previousNight: string | undefined;
  for (const row of rows) {
    if (Number(row.seq) !== state.sequence + 1 || sha256Hex(row.fact) !== row.digest) throw new Error('Chronicle history is incomplete.');
    const fact = JSON.parse(row.fact) as RealmFact;
    if (!Number.isSafeInteger(fact.committedAt) || fact.committedAt < lastAt) throw new Error('Chronicle history has invalid clock order.');
    const prior = state;
    state = applyRealmFact(state, fact); lastAt = fact.committedAt;
    if (!state.growth) throw new Error('Chronicle growth reconstruction is unavailable.');
    // Apply every private fact for complete deterministic reconstruction, but expose only facts already
    // admitted to the public projection (and the independently public stream's start/end).
    if (fact.body.type !== 'stream.observe' && projectRealmFact(state, fact, prior).length === 0) continue;
    // A witnessed stream belongs to the UTC day it STARTED, including a marathon crossing midnight.
    // Replace only the contiguous current night; a late fact must never reorder earlier source sequences.
    const frame = { ...projectGrowthScene(state.growth), sequence: fact.seq, asOf: fact.committedAt, beats: [] };
    const witnessedNight = !!state.growth.day && (state.stream.sessionId !== null || fact.body.type === 'stream.observe' && fact.body.sessionId === null && prior.stream.sessionId !== null);
    const key = witnessedNight ? `stream:${state.growth.day!.index}` : `offline:${Math.floor(fact.committedAt / 86_400_000)}`;
    const sameNight = key === previousNight;
    const previous = sameNight ? nights.at(-1) : undefined;
    const civic = (Object.keys(state.growth.civic.levels) as GrowthCivicPlace[]).filter(place => state.growth!.civic.levels[place] > (prior.growth?.civic.levels[place] ?? 1));
    const item = { state, frame, caption: describe(fact, previous?.caption, civic), nightAt: witnessedNight ? state.growth.session!.startedAt : fact.committedAt };
    if (sameNight) nights[nights.length - 1] = item; else nights.push(item);
    previousNight = key;
  }
  if (state.sequence !== through) throw new Error('Chronicle history has a sequence gap.');
  return nights;
}
function describe(fact: RealmFact, earlier?: string, civic: readonly string[] = []): string {
  const remember = (sentence: string) => earlier?.includes(sentence) ? earlier : earlier?.includes('grew') ? `${earlier} ${sentence}` : sentence;
  if (civic.length) return remember(`The ${civic.map(place => place === 'castle-court' ? 'castle courtyard' : place).join(' and ')} grew as citizens shared another night.`);
  switch (fact.body.type) {
    case 'home.growNative': return remember(`A home grew from ${fact.body.fromTier} to ${fact.body.tier}.`);
    case 'home.replaceApproved': return 'A citizen published a new home.';
    case 'home.installAllocated': return earlier ?? 'A citizen settled into their home.';
    case 'castle.installNative': return earlier ?? 'The monarch’s keep took its place in the kingdom.';
    case 'forge.commitApproved': return 'A newly forged piece found its place in the kingdom.';
    case 'presence.confirmInterval': return earlier ?? 'The kingdom witnessed its citizens spending the night together.';
    case 'stream.observe': return earlier ?? (fact.body.sessionId ? 'The stream began and the kingdom woke.' : 'The stream ended and the kingdom rested.');
    default: return earlier ?? 'The kingdom kept the story of this night.';
  }
}
