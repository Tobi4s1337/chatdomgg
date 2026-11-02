/**
 * The Raid Gate in the walking view (SEAMS §4 `RaidCall` and `RaidJourney`): the march call in play's HUD, the journey
 * layer over the world, and the Atlas's gate mode underneath it, for the kingdom being walked. A person abroad after a
 * raid is answered by their home gate (the authority's `whereabouts`), so the way home is offered where they stand.
 *
 * Only the authority moves anyone. This file wires presentation to it and walks the page on once a step is
 * acknowledged; nothing here is evidence.
 */
import { REALM_ENTRY_ROUTE, RealmEntryInfoSchema } from '@chatdom/shared/realm';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import { deferGateAtlas, gateAtlasBundled, type GateAtlasModules } from './atlas-gate';
import type { GateSnapshot } from './controller';
import type { RaidGateController } from './controller';
import { gateForPage, mapCarriesJourney, readJourneyMemo } from './journey';
import type { JourneyLayer } from './JourneyLayer';
import { mountRaidMarchCall } from './march-call';
import type { GateKingdom, RaidGateApi } from './ports';

/** A kingdom's approved name is asked once; a walk never waits on it longer than this. */
const NAME_TIMEOUT_MS = 4_000;

export type WalkGateOptions = Readonly<{
  /** The kingdom being walked. */
  kingdomId: KingdomId;
  /** play's HUD region host for the march call. */
  host: HTMLElement;
  /** The walking key shown on the primary button. */
  keyHint?: () => string | null;
  /** Hears the controller once it exists, so a walking key can press it. */
  onController?: (controller: RaidGateController | null) => void;
  origin?: 'live' | 'simulated';
  storage?: Storage | null;
  clock?: () => number;
  navigate?: (path: string) => void;
  api?: RaidGateApi;
  /** Reads a kingdom's approved name; defaults to the realm's entry route. */
  readName?: (kingdomId: KingdomId, signal: AbortSignal) => Promise<string | null>;
  /** Whether the Atlas's gate mode may ride the journey; defaults to whether this build carries it. */
  mapBundled?: boolean;
}>;

function sessionStore(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

/** The walk's own origin: the lane's mock stack walks on a simulated source, everything else is live. */
export function walkOrigin(search: string = globalThis.location?.search ?? ''): 'live' | 'simulated' {
  return new URLSearchParams(search).get('source') === 'simulated' ? 'simulated' : 'live';
}

async function readRealmName(kingdomId: KingdomId, signal: AbortSignal): Promise<string | null> {
  const timeout = AbortSignal.timeout(NAME_TIMEOUT_MS);
  const response = await fetch(REALM_ENTRY_ROUTE.replace(':kingdomId', encodeURIComponent(kingdomId)), {
    signal: AbortSignal.any([signal, timeout]), credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' },
  });
  if (!response.ok) return null;
  const info = RealmEntryInfoSchema.safeParse(await response.json() as unknown);
  return info.success && info.data.kingdomId === kingdomId ? info.data.name : null;
}

/** A build without the map: nothing to load. */
const NO_MAP: GateAtlasModules = {};

/** Whether this viewer may soon travel: they chose to march, may follow the party, are under way, or are abroad. */
export function mayTravel(s: GateSnapshot): boolean {
  return s.joined || s.canTravel || s.journey !== null || s.welcome !== null;
}

/**
 * Mounts the gate for one walk. Returns its disposer. The march call appears only when the authority has something
 * to say to this person; the journey layer covers the world only while a place is held for them.
 */
export function mountWalkGate(options: WalkGateOptions): () => void {
  const life = new AbortController();
  const storage = options.storage === undefined ? sessionStore() : options.storage;
  const clock = options.clock ?? (() => Date.now());
  const origin = options.origin ?? walkOrigin();
  const readName = options.readName ?? readRealmName;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let layer: JourneyLayer | null = null;
  let disposeCall: (() => void) | null = null;
  /** Whether the warmed map is drawn, and which kingdoms it could place (asked once each). */
  let drawn = false;
  const placed = new Map<KingdomId, boolean>();

  void (async () => {
    // The layer is loaded with the walk, not with the page: a walk that never meets the gate costs one small chunk.
    const { mountJourneyLayer } = await import('./JourneyLayer');
    if (life.signal.aborted) return;
    const journey = layer = mountJourneyLayer({
      here: options.kingdomId, storage, clock, reducedMotion: reduced, mapCarries: journey => mapCarriesJourney(drawn, placed, journey),
      ...(options.navigate ? { navigate: options.navigate } : {}),
    });
    const memo = readJourneyMemo(storage, clock());
    const name = await readName(options.kingdomId, life.signal).catch(() => null);
    if (life.signal.aborted) return;
    const here: GateKingdom = { kingdomId: options.kingdomId, name: name ?? 'this kingdom', login: '' };
    const gate = gateForPage(here, memo);
    const withMap = options.mapBundled ?? gateAtlasBundled();
    const atlas = withMap
      ? deferGateAtlas(() => journey.mapHost, life.signal, undefined, { onReady: state => { drawn = state === 'map'; } })
      : deferGateAtlas(() => journey.mapHost, life.signal, NO_MAP);
    let warmed = false;
    const place = (kingdomId: KingdomId | null | undefined) => {
      if (!atlas || !kingdomId || placed.has(kingdomId)) return;
      placed.set(kingdomId, false);
      void atlas.resolve(kingdomId, life.signal).then(found => { if (found && found.land !== 'edge') placed.set(kingdomId, true); }, () => undefined);
    };
    disposeCall = mountRaidMarchCall({
      kingdomId: gate.kingdomId, source: gate, origin, signal: life.signal, parent: options.host, placement: 'slot', atlas, clock,
      ...(options.api ? { api: options.api } : {}),
      ...(options.keyHint ? { keyHint: options.keyHint } : {}),
      onSnapshot: snapshot => {
        // The map is drawn ahead of the rise for anyone who may travel, so the journey rides on it from its first step.
        if (atlas && !warmed && mayTravel(snapshot)) { warmed = true; atlas.warm(); }
        // Both ends are looked up on the map ahead of the road, so the journey knows whether the map can carry it.
        if (warmed) for (const end of [snapshot.source.kingdomId, snapshot.destination?.target.kingdomId, snapshot.journey?.from, snapshot.journey?.to]) place(end);
        journey.follow(snapshot);
      },
      onMount(piece, controller) {
        options.onController?.(controller);
        // While the world is inked the piece speaks from the foot of the journey; afterwards it goes back to the HUD.
        const place = (covering: boolean) => {
          piece.dataset.place = covering ? 'page' : 'slot';
          (covering ? journey.wordsHost : options.host).append(piece);
        };
        place(journey.covering());
        const stop = journey.onCovering(place);
        life.signal.addEventListener('abort', stop, { once: true });
      },
    });
  })();

  return () => {
    if (life.signal.aborted) return;
    life.abort();
    options.onController?.(null);
    disposeCall?.();
    layer?.dispose();
  };
}
