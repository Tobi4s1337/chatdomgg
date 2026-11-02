/**
 * The walker's journey across pages (spec 23 R6, R7; Moments.md §7): what this page does when the authority moves its
 * person. Travel itself is the authority's (reserve, prepare, commit, acknowledge); this file only decides, from the
 * gate controller's snapshot, when the world should wash into ink, when the page walks into the kingdom the person now
 * stands in, and which gate to ask about a way home once they are abroad.
 *
 * Nothing here is evidence. The remembered home is a hint for which gate to ask: the authority's `whereabouts` decides
 * whether there is a journey at all, so a stale or edited memo shows nothing.
 */
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import type { GateSnapshot, JourneySnapshot } from './controller';
import type { GateKingdom } from './ports';

/** The tab's memory of the gate a journey began at. Session storage only; no person, ticket or token. */
export const JOURNEY_MEMO_KEY = 'chatdom.raid-gate.journey';
/** A journey is remembered this long after its last step; a visit lasts the evening, not the week. */
export const JOURNEY_MEMO_MS = 12 * 60 * 60_000;
/** A page that has just walked in through the gate still opens on the drawing for this long. */
export const ARRIVAL_FRESH_MS = 60_000;

/** The least time the rise and the road stay on screen, so a fast answer never cuts the journey (spec 23 R6). */
export const RISE_MS = 800;
export const ROAD_MS = 2_200;

export type JourneyMemo = Readonly<{
  version: 1;
  /** The gate the journey began at, and so the gate to ask about the way home. */
  home: GateKingdom;
  /** Where the page last walked to, and when; only for opening on the drawing right after a step through. */
  to: KingdomId | null;
  at: number;
}>;

const KINGDOM = /^[1-9][0-9]{0,31}$/u;

function readGateKingdom(value: unknown): GateKingdom | null {
  if (!value || typeof value !== 'object') return null;
  const { kingdomId, name, login } = value as Record<string, unknown>;
  if (typeof kingdomId !== 'string' || !KINGDOM.test(kingdomId)) return null;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 80) return null;
  if (typeof login !== 'string' || login.length > 25 || (login !== '' && !/^[a-z0-9_]{1,25}$/u.test(login))) return null;
  return { kingdomId: kingdomId as KingdomId, name, login };
}

/** Reads the memo strictly; anything malformed, foreign or older than a long evening reads as none. */
export function readJourneyMemo(storage: Storage | null, now: number): JourneyMemo | null {
  if (!storage) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(storage.getItem(JOURNEY_MEMO_KEY) ?? 'null'); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const { version, home, to, at } = parsed as Record<string, unknown>;
  if (version !== 1 || typeof at !== 'number' || !Number.isFinite(at) || at > now + 60_000 || now - at > JOURNEY_MEMO_MS) return null;
  const gate = readGateKingdom(home);
  if (!gate) return null;
  if (to !== null && (typeof to !== 'string' || !KINGDOM.test(to))) return null;
  return { version: 1, home: gate, to: (to as KingdomId | null), at };
}

export function writeJourneyMemo(storage: Storage | null, memo: JourneyMemo): void {
  try { storage?.setItem(JOURNEY_MEMO_KEY, JSON.stringify(memo)); } catch { /* a blocked store only means no way home is offered here */ }
}

export function clearJourneyMemo(storage: Storage | null): void {
  try { storage?.removeItem(JOURNEY_MEMO_KEY); } catch { /* nothing to forget */ }
}

/**
 * Which gate this page asks about: the remembered home when the person is walking somewhere else, otherwise the
 * kingdom they are walking. The home's gate answers `whereabouts` for a person abroad, and offers the way back.
 */
export function gateForPage(here: GateKingdom, memo: JourneyMemo | null): GateKingdom {
  return memo && memo.home.kingdomId !== here.kingdomId ? memo.home : here;
}

/** The ordinary way into a kingdom on foot (the same path the front door's Walk in uses). */
export function walkPath(kingdomId: KingdomId, current: string = globalThis.location?.search ?? ''): string {
  const query = new URLSearchParams({ walk: '1', kingdom: kingdomId });
  // The lane's own mock stack walks on its simulated source; a live page never carries one.
  if (new URLSearchParams(current).get('source') === 'simulated') query.set('source', 'simulated');
  return `/?${query.toString()}`;
}

const UNDER_WAY: ReadonlySet<JourneySnapshot['state']> = new Set(['asking', 'reserved', 'preparing', 'ready', 'committing', 'unknown']);

/** What the journey layer shows now: nothing, the road while the authority answers, or the step through. */
export type JourneyScene =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'road'; journey: JourneySnapshot; stage: 'rise' | 'road' | 'drawing' }>
  | Readonly<{ kind: 'through'; journey: JourneySnapshot; to: KingdomId; home: boolean }>;

/**
 * Reads the scene from the snapshot, for a page that shows `here`. A journey under way draws the road; one committed
 * to somewhere other than this page walks the page there; one that arrived here, turned back or was refused shows
 * nothing (the march call tells it).
 */
export function journeyScene(s: GateSnapshot, here: KingdomId): JourneyScene {
  const j = s.journey;
  if (!j || j.refusal) return { kind: 'none' };
  if (UNDER_WAY.has(j.state)) {
    // Nothing was held yet: the press is being asked about, and the world stays as it is.
    if (j.state === 'asking') return { kind: 'none' };
    const stage = j.state === 'reserved' ? 'rise' : j.state === 'preparing' ? 'road' : 'drawing';
    return { kind: 'road', journey: j, stage };
  }
  if (j.state === 'committed' && j.to !== here) return { kind: 'through', journey: j, to: j.to, home: j.kind === 'return' };
  return { kind: 'none' };
}

/** When the page may walk on: once the authority acknowledged the step, and never before the road has been seen. */
export function stepThroughAt(roadShownAt: number | null, committedAt: number): number {
  if (roadShownAt === null) return committedAt + RISE_MS;
  return Math.max(committedAt, roadShownAt + RISE_MS + ROAD_MS);
}

/** A page that opens right after its person stepped through starts on the drawing and lets it fade into the world. */
export function arrivingHere(memo: JourneyMemo | null, here: KingdomId, now: number): boolean {
  return memo !== null && memo.to === here && now - memo.at >= 0 && now - memo.at <= ARRIVAL_FRESH_MS;
}

/**
 * Whether the Atlas can carry a journey's road: its map is drawn, and it placed both ends on it (`resolve` answered
 * a land that is not off the map's edge). Anything unknown keeps the parchment road; a map is never waited on.
 */
export function mapCarriesJourney(drawn: boolean, placed: ReadonlyMap<KingdomId, boolean>, journey: Pick<JourneySnapshot, 'from' | 'to'>): boolean {
  return drawn && placed.get(journey.from) === true && placed.get(journey.to) === true;
}
