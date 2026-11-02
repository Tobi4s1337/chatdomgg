import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { AtlasChannelSchema, type PresenceFeed, type RaidChatFeed, type RaidPartyPublicFeed, type RaidPartyPublicFrame, type RaidPennantFeed } from '@chatdom/shared';
import type { KingdomId, PersonId } from '../../../../api/src/raid-gate/contracts';
import { openRoadAtlas, RoadAtlasError, type RoadAtlas } from '../../atlas/road';
import { createKingdomScene } from '../../kingdom/scene';
import { installFrameGate, type FrameGate } from './frames';
import type { BenchCast, GateBench } from '../bench';
import { createRaidGateController, type GateSnapshot, type RaidGateController } from '../controller';
import { incoming } from '../welcome';
import { GateDefs, RaidGatePane } from '../RaidGatePane';
import { Seal } from '../Seal';
import { twitchChannelUrl } from '../march-call';
import { CHAPTERS, chapterOf, mapFrame, momentAt, ramp, REDUCED_TIMING, ROAD_TIMING, type RoadFacts, type RoadMoment, type RoadTiming } from './director';
import { emptyPresence, ROAD_PAIR, roadLand, type RoadLand } from './lands';
import { createRoadArrivalFeed, type RoadArrivalFeed } from './arrival-feed';
import { sourceGateShot } from './gate-shot';
import '../raid-gate.css';
import '../welcome.css';
import './road.css';

/**
 * The raid road (Moments.md §7, Atlas.md §7.5–7.6, spec 23 R3/R6/R7): one continuous journey from the leaving
 * kingdom's Raid Gate, along the Atlas road between two real holdings, to the destination's gate and its welcome, or
 * to its waiting land, and home again.
 *
 * The gathering is the kingdom's own world: the party stands at the real gate anchor in the scene, drawn by the
 * moment view's party layer from the gate's public party frame (the same frame and rule the realm serves at
 * `/realm/raid-party/:kingdomId`), lit by the gate's braziers and the light field, and the view's own gate shot frames
 * it. Nobody is drawn from a count. Its two ends are real Twitch channels on the real survey, their land grown from
 * each channel's own seed as the Genesis previews grow it; the real gate application runs against private simulated
 * Twitch, rooms, people and things, whose internal origins stay isolated without visible provenance chips.
 * The director holds each act until the fact behind the next one is observed; nothing moves on a timer alone.
 *
 * `?to=waiting` rides to the destination as waiting land (no world is entered, nothing reserved). `?capture=1`
 * freezes the presentation clock and hands it to `window.__raidRoad.seek(t)`, so captures are exact.
 */

type RoadWindow = Window & { __chatdomReady?: boolean; __raidRoad?: RoadHook };
type RoadHook = {
  seek(t: number): Promise<void>;
  state(): {
    t: number; act: string; progress: number; holding: boolean; facts: RoadFacts; sourceReady: boolean; destReady: boolean; homeReady: boolean;
    mapSettled: boolean; mapError: string | null; mapCause: string | null; worldError: string | null; snapshot: GateSnapshot | null;
    party: { phase: string; marchers: number } | null; directing: boolean;
  };
  spans(): ReturnType<typeof momentAt>['spans'];
  timing: RoadTiming;
  /** Under `capture=1` only: the page's animation frames, let go only as the capture asks. */
  frames: FrameGate | null;
};

/** Installed once per page, the first time the route opens under `capture=1`. */
let frameGate: FrameGate | undefined;

/** SIMULATED travellers on stream for this rehearsal (the public `channel.raid` count; it draws nobody). */
const RIDERS = 612;
/** SIMULATED walkers who choose to march, besides this viewer and the monarch, and when each chooses. */
const WALKER_CUES = [1.1, 2.0, 3.6, 4.4, 5.6];
/** When the monarch presses Start a Raid, and when Twitch's raid is witnessed (the countdown between is held). */
const START_AT = 7.2, WITNESS_AT = 15.5, REDUCED_START_AT = 2.8, REDUCED_WITNESS_AT = 3.6;
/** How long the walker lingers before choosing to come home. */
const LINGER = { welcome: 11, land: 9 } as const;
const SIMULATED_HOST = '53000001' as PersonId;
/** Waits before asking the survey again after a read that failed or ran out of time. */
const MAP_RETRIES = [1500, 4000, 9000];
const PARTY_POLL_MS = 400;

function castFor(from: RoadLand, to: RoadLand, land: 'founded' | 'waiting'): BenchCast {
  const founded = land === 'founded';
  const channel = AtlasChannelSchema.parse({ kingdomId: to.id, login: to.login, displayName: to.name, language: 'en', founded,
    kingdomName: founded ? to.name : null, contentClassification: 'general' });
  return {
    source: { kingdomId: from.id as KingdomId, name: from.name, login: from.login },
    destinations: [{ channel, land, live: true, group: 'road' }],
    rooms: founded ? [from.id as KingdomId, to.id as KingdomId] : [from.id as KingdomId],
    welcome: { kingdomId: to.id as KingdomId, name: to.name, host: SIMULATED_HOST, things: { hostGift: 'Lantern of the rose-lit river', monarchGift: 'River-reed welcome loaf' } },
    names: { [to.id]: to.name, [SIMULATED_HOST]: 'Ash of the Mill', [from.id]: from.name, '52000001': 'Wren', '52000002': 'Tamsin',
      '52000003': 'Oswin', '52000004': 'Brannoc', '52000005': 'Ysolde', '52000006': 'Corwen' },
    carried: { crafted: 'A pawn carved from mountain pine', forged: 'Citadel-glass lantern' },
  };
}

const sceneFeed = (id: string): PresenceFeed => ({ label: 'SIMULATED', subscribe(receive) { receive(emptyPresence(id, Date.now())); return () => undefined; } });
/** A kingdom on this route has no raid chat and its pennant wall is not the story here: both read as empty. */
const quietChat = (id: string): RaidChatFeed => ({ origin: 'simulated', subscribe(receive) {
  receive({ version: 1, kingdomId: id as KingdomId, origin: 'simulated', asOf: Date.now(), lights: [], cues: [] }); return () => undefined;
} });
const quietPennants = (id: string): RaidPennantFeed => ({ origin: 'simulated', subscribe(receive) {
  receive({ version: 1, origin: 'simulated', kingdomId: id as KingdomId, asOf: Date.now(), items: [] }); return () => undefined;
} });
const noParty: RaidPartyPublicFeed = { origin: 'simulated', subscribe(receive) { receive(null); return () => undefined; } };
function momentsFor(id: string, epoch: string, party: RaidPartyPublicFeed): RoadArrivalFeed {
  return Object.assign(createRoadArrivalFeed(epoch), { raidParty: party, raidChat: quietChat(id), raidPennants: quietPennants(id) });
}

type Words = Readonly<{ eyebrow: string; title: string; line: string }>;
type Scene = Awaited<ReturnType<typeof createKingdomScene>>;

export default function RaidRoad() {
  const query = new URLSearchParams(location.search);
  const capture = query.get('capture') === '1';
  const captureFrames = capture ? (frameGate ??= installFrameGate()) : null;
  const reduced = query.get('motion') === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const land: 'founded' | 'waiting' = query.get('to') === 'waiting' ? 'waiting' : 'founded';
  const timing: RoadTiming = reduced ? REDUCED_TIMING : ROAD_TIMING;
  const from = roadLand(ROAD_PAIR.from), to = roadLand(ROAD_PAIR.to);
  const life = new AbortController();
  /** The destination's own raid arrival: the road hands it the witnessed raid when the guests reach its gate. */
  const arrival = momentsFor(to.id, 'raid-road', noParty);

  const [t, setT] = createSignal(0);
  // The SIMULATED authority keeps the presentation's time, so a call's countdown, a preview's life, the party's frames
  // and every receipt read the same however slowly a frame is drawn. Outside captures the presentation clock is the
  // wall clock from the moment the gate first shows, so the scene's own moments and the party agree to the frame.
  let opened = Date.now(), started: number | null = null;
  const clock = () => opened + Math.round(t() * 1000);
  const [snap, setSnap] = createSignal<GateSnapshot | null>(null);
  const [controller, setController] = createSignal<RaidGateController | null>(null);
  const [facts, setFacts] = createSignal<RoadFacts>({ departedAt: null, mapReadyAt: null, arrivedAt: null, welcomedAt: null, land, homeAt: null });
  const [rideSeconds, setRideSeconds] = createSignal(timing.ride);
  const [atlas, setAtlas] = createSignal<RoadAtlas | null>(null);
  const [mapError, setMapError] = createSignal<string | null>(null);
  /** Why the last read of the survey failed, for captures and diagnosis (never shown as the road's words). */
  const [mapCause, setMapCause] = createSignal<string | null>(null);
  const [worldError, setWorldError] = createSignal<string | null>(null);
  const failWorld = (name: string, error: unknown) => {
    if (!life.signal.aborted) setWorldError(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  };
  const [sourceReady, setSourceReady] = createSignal(false);
  const [destReady, setDestReady] = createSignal(false);
  const [destStarted, setDestStarted] = createSignal(false);
  const [homeReady, setHomeReady] = createSignal(false);
  const [homeStarted, setHomeStarted] = createSignal(false);
  const [marks, setMarks] = createSignal<ReturnType<RoadAtlas['marks']> | null>(null);
  const [party, setParty] = createSignal<RaidPartyPublicFrame | null>(null);

  const effective = () => ({ ...timing, ride: reduced ? timing.ride : rideSeconds() });
  const moment = createMemo<RoadMoment>(() => momentAt(facts(), effective(), t()));
  const act = () => moment().act;
  const progressOf = (name: RoadMoment['act']) => {
    const span = moment().spans.find(each => each.act === name);
    if (!span) return 0;
    return span.length > 0 ? Math.min(1, Math.max(0, (t() - span.start) / span.length)) : 1;
  };

  let srcCanvas!: HTMLCanvasElement, dstCanvas!: HTMLCanvasElement, homeCanvas!: HTMLCanvasElement, mapHost!: HTMLDivElement;
  let bench: GateBench | null = null;
  let source: Scene | undefined, disposeSource: (() => void) | undefined, disposeDest: (() => void) | undefined, disposeHome: (() => void) | undefined;
  /** The gate shot the leaving kingdom stands at before its party gathers and if the party's own shot cannot be found. */
  let gateShot: ReturnType<typeof sourceGateShot> = null, posed = false, partySince: number | null = null;
  /** The gate shot is handed to the party once, on its first frame; after that only the fallback below poses it. */
  let handed = false;

  const note = (key: 'departedAt' | 'mapReadyAt' | 'arrivedAt' | 'welcomedAt' | 'homeAt') =>
    setFacts(current => (current[key] ?? null) === null ? { ...current, [key]: t() } : current);

  /** Observes the authority's answers and turns them into the director's facts. */
  const observe = (next: GateSnapshot) => {
    setSnap(next);
    // The party sets out on Twitch's witnessed raid, never on the press of a button.
    if (next.raid) note('departedAt');
    if (next.journey?.kind === 'raid' && next.journey.state === 'committed' && destReady()) note('arrivedAt');
    if (next.welcome?.status === 'ready' && next.welcome.view) note('welcomedAt');
    if (next.journey?.kind === 'return' && next.journey.state === 'committed') note('homeAt');
  };

  /**
   * The gate party, read from the bench's own gate records by the realm's rule, as the realm's public reader does.
   * Its first frame hands the camera to the party's own gate shot.
   */
  const partyFeed: RaidPartyPublicFeed = { origin: 'simulated', subscribe(receive) {
    let stopped = false, timer = 0;
    const poll = async () => {
      if (stopped) return;
      const frame = bench ? await bench.partyFrame().catch(() => null) : null;
      if (stopped) return;
      setParty(frame); receive(frame);
      if (frame && !handed && posed && source) { source.pose(null); posed = false; handed = true; partySince = t(); }
      timer = window.setTimeout(() => void poll(), PARTY_POLL_MS);
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  } };

  // ── The SIMULATED world around this viewer, on the presentation clock ───────────────────────────────────────
  type Cue = { at: number; done: boolean; run: () => Promise<void> };
  const cues: Cue[] = [];
  let requestId: string | null = null;
  let queue: Promise<void> = Promise.resolve();
  let followed = false, welcomed = false, accepted = false, returning = false;
  const advance = () => {
    queue = queue.then(async () => {
      const gate = controller();
      if (!gate || !bench) return;
      for (const cue of cues) {
        if (cue.done || cue.at > t()) continue;
        cue.done = true;
        try { await cue.run(); } catch { /* a SIMULATED cue that fails leaves the authority's last answer on screen */ }
      }
      const s = gate.snapshot();
      // The marcher goes through the gate with the column, once it has walked out of the arch: the journey's own
      // stages then run while the road is drawn, and the destination's acknowledgment is what ends the ride.
      const past = moment().act;
      if (!followed && s.raid && s.canTravel && past !== 'gather' && past !== 'setout') { followed = true; void gate.travel(); }
      // Once the destination acknowledged this arrival, the rest of the party follows and a host comes to greet them.
      if (!welcomed && s.journey?.kind === 'raid' && s.journey.state === 'committed' && s.raid && requestId) {
        welcomed = true;
        await bench.partyTravel(requestId, s.raid.id, WALKER_CUES.length);
        await bench.hostOffer('ash');
        await gate.refreshWelcome();
      }
      const m = moment();
      if (!accepted && m.act === 'welcome' && m.elapsed > (reduced ? 1.5 : 4.2)) {
        const view = gate.snapshot().welcome?.view;
        const offer = view?.offers.find(each => incoming(view, each) && each.state === 'offered');
        if (offer) { accepted = true; await gate.acceptGift(offer.offerId); }
      }
      // The walker has seen enough and comes home: through the authority from a founded kingdom (a second journey),
      // straight off the map from waiting land, where they never left their own kingdom's room.
      if (!returning && m.act === 'welcome' && m.elapsed > (reduced ? 4 : LINGER.welcome)) { returning = true; await gate.returnHome(); }
      if (!returning && m.act === 'land' && m.elapsed > (reduced ? 3 : LINGER.land)) { returning = true; note('homeAt'); }
    });
    return queue;
  };

  const startSource = () => {
    void createKingdomScene(srcCanvas, {
      signal: life.signal, potential: from.potential, nativeStyle: from.potential.style, forgeFamily: from.potential.style,
      tier: from.potential.plan.config.tier, seed: from.potential.plan.config.seed, realmName: from.name, kingdomId: from.id as KingdomId,
      presenceFeed: sceneFeed(from.id), presenceOrigin: 'simulated', momentFeed: momentsFor(from.id, 'raid-road-gate', partyFeed),
      hour: 19.6, time: null, camera: 'hero', source: 'simulated',
      onProgress: () => undefined, onNames: () => undefined, onSource: () => undefined, onError: message => failWorld(from.name, message),
    }).then(scene => {
      if (life.signal.aborted) { scene.dispose(); return; }
      source = scene;
      disposeSource = () => { scene.dispose(); source = undefined; };
      // Stand at the gate the party will gather at, looking in over the dressed near streets to the town in its haze,
      // until the party's own gate shot takes the camera.
      gateShot = sourceGateShot(scene.layout, window.innerHeight > window.innerWidth);
      if (gateShot && !party()) { scene.pose(gateShot.eye, gateShot.target, gateShot.fov); posed = true; }
      const settle = () => {
        if (life.signal.aborted || !disposeSource) return;
        // The gate's parts (braziers, standard, the party's torches) are meshed after the world opens.
        const parts = scene.inspect().moments as { preparation?: string; preparationError?: string | null } | undefined;
        if (parts?.preparation === 'failed') { failWorld(from.name, parts.preparationError ?? 'its gate could not be prepared'); return; }
        if (scene.debug.ready && scene.debug.fieldSettled && parts?.preparation === 'ready') setSourceReady(true); else requestAnimationFrame(settle);
      };
      settle();
    }, error => failWorld(from.name, error));
  };
  const startDest = () => {
    if (destStarted()) return;
    setDestStarted(true);
    void createKingdomScene(dstCanvas, {
      signal: life.signal, potential: to.potential, nativeStyle: to.potential.style, forgeFamily: to.potential.style,
      tier: to.potential.plan.config.tier, seed: to.potential.plan.config.seed, realmName: to.name, kingdomId: to.id as KingdomId,
      presenceFeed: sceneFeed(to.id), presenceOrigin: 'simulated', momentFeed: arrival, hour: 19.8, time: null, camera: 'hero', source: 'simulated',
      onProgress: () => undefined, onNames: () => undefined, onSource: () => undefined, onError: message => failWorld(to.name, message),
    }).then(scene => {
      if (life.signal.aborted) { scene.dispose(); return; }
      disposeDest = () => scene.dispose();
      const settle = () => {
        if (life.signal.aborted) return;
        // The gate's raid parts are meshed after the world opens; the guests may arrive only once they can be drawn.
        const parts = (scene.inspect().moments as { preparation?: string; preparationError?: string | null } | undefined);
        if (parts?.preparation === 'failed' || parts?.preparation === 'disposed') { failWorld(to.name, parts.preparationError ?? 'its gate could not be prepared'); return; }
        if (scene.debug.ready && scene.debug.fieldSettled && parts?.preparation === 'ready') { setDestReady(true); const s = snap(); if (s) observe(s); } else requestAnimationFrame(settle);
      };
      settle();
    }, error => failWorld(to.name, error));
  };
  /** Home again: the leaving kingdom's own world at its gate, quiet now that its party has gone. */
  const startHome = () => {
    if (homeStarted()) return;
    setHomeStarted(true);
    void createKingdomScene(homeCanvas, {
      signal: life.signal, potential: from.potential, nativeStyle: from.potential.style, forgeFamily: from.potential.style,
      tier: from.potential.plan.config.tier, seed: from.potential.plan.config.seed, realmName: from.name, kingdomId: from.id as KingdomId,
      presenceFeed: sceneFeed(from.id), presenceOrigin: 'simulated', momentFeed: momentsFor(from.id, 'raid-road-home', noParty),
      hour: 19.9, time: null, camera: 'hero', source: 'simulated',
      onProgress: () => undefined, onNames: () => undefined, onSource: () => undefined, onError: message => failWorld(from.name, message),
    }).then(scene => {
      if (life.signal.aborted) { scene.dispose(); return; }
      disposeHome = () => scene.dispose();
      const shot = sourceGateShot(scene.layout, window.innerHeight > window.innerWidth);
      if (shot) scene.pose(shot.eye, shot.target, shot.fov);
      const settle = () => { if (life.signal.aborted || !disposeHome) return; if (scene.debug.ready && scene.debug.fieldSettled) setHomeReady(true); else requestAnimationFrame(settle); };
      settle();
    }, error => failWorld(from.name, error));
  };

  /** Everything that follows the presentation clock: the map's frame, the other worlds, the cues. */
  const frame = () => {
    const m = moment();
    const map = atlas();
    if (map && m.act !== 'home') {
      const f = mapFrame(m);
      map.show({ ...f, time: t() });
      setMarks(map.marks());
    }
    // If the party's own shot could not be found, the gate's standing shot keeps the party in the picture.
    if (source && !posed && partySince !== null && gateShot && (m.act === 'gather' || m.act === 'setout')
        && t() - partySince > 1.5 && !source.momentDirecting()) { source.pose(gateShot.eye, gateShot.target, gateShot.fov); posed = true; }
    // The destination's world is readied while the column rides; the source's world is let go once out of sight.
    if (land === 'founded' && (m.act === 'ride' || m.act === 'hold') && !destStarted()) startDest();
    if (m.act !== 'gather' && m.act !== 'setout' && m.act !== 'rise' && disposeSource) { disposeSource(); disposeSource = undefined; }
    // Home is readied as soon as the walker turns for it; the far end is let go once home shows.
    if ((facts().homeAt ?? null) !== null && !homeStarted()) startHome();
    if (m.act === 'home' && homeReady()) {
      if (disposeDest) { disposeDest(); disposeDest = undefined; }
      if (map) { map.dispose(); setAtlas(null); }
    }
    if (m.act === 'welcome' && map) { map.dispose(); setAtlas(null); }
    // The guests reach the destination's gate as its world wakes: the kingdom raises its gate under the leaving
    // kingdom's banner and the caravan rolls in, sized by Twitch's own count for the witnessed raid.
    const witnessed = snap()?.raid;
    if ((m.act === 'wake' || m.act === 'welcome') && destReady() && witnessed) {
      arrival.arrive({ raidId: witnessed.id, kingdomId: to.id, from: { kingdomId: from.id, name: from.name }, viewers: witnessed.viewers, founded: true }, Date.now());
    }
    void advance();
  };

  onMount(() => {
    const roadWindow = window as RoadWindow;
    roadWindow.__chatdomReady = false;
    document.body.classList.add('rg-page', 'rr-page');
    // The survey is read before the kingdom unfolds: a software-drawn kingdom can hold the page for many seconds at a
    // time, and the survey's reads have deadlines. The gate opens either way; a road that cannot be drawn says so.
    let unfolding = false;
    const unfold = () => { if (!unfolding && !life.signal.aborted) { unfolding = true; startSource(); } };
    // A slow or dropped read of the survey is asked again a few times before the road says it cannot be drawn; a
    // channel off the survey or withheld from it is an answer, not a failure, and is never asked again.
    void (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const map = await openRoadAtlas(mapHost, { from: from.id, to: to.id, viewers: RIDERS, signal: life.signal, reduceMotion: () => reduced });
          if (life.signal.aborted) { map.dispose(); return; }
          setAtlas(map); setRideSeconds(map.rideSeconds);
          unfold();
          await map.ready;
          note('mapReadyAt');
          return;
        } catch (error) {
          if (life.signal.aborted) return;
          const retry = error instanceof RoadAtlasError && error.reason === 'unavailable' && attempt < MAP_RETRIES.length;
          const cause = error instanceof Error ? error.cause ?? error : error;
          setMapCause(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause));
          if (!retry) { setMapError(error instanceof RoadAtlasError ? error.message : 'The Atlas could not be drawn just now.'); unfold(); return; }
          await new Promise(resolve => setTimeout(resolve, MAP_RETRIES[attempt]));
        }
      }
    })();
    void (async () => {
      const { createGateBench } = await import('../bench');
      bench = createGateBench({ viewer: 'walker', authority: 'ready', clock, cast: castFor(from, to, land) });
      const made = bench;
      const gate = createRaidGateController({ api: made.api, atlas: made.atlas, source: made.source, clock, account: { reconnect: () => made.reconnect() } });
      setController(gate);
      gate.subscribe(observe);
      observe(gate.snapshot());
      cues.push(
        { at: 0.2, done: false, run: async () => {
          const reply = await made.monarchPreview(to.id as KingdomId);
          if (reply.kind === 'preview') { requestId = reply.value.requestId; await made.monarchJoin(requestId); }
          await gate.refresh();
        } },
        ...WALKER_CUES.map((at, index) => ({ at, done: false, run: async () => { if (requestId) { await made.walkersJoin(index + 1, requestId); await gate.refresh(); } } })),
        { at: 2.8, done: false, run: async () => { await gate.join(); } },
        { at: reduced ? REDUCED_START_AT : START_AT, done: false, run: async () => { if (requestId) { await made.monarchStart(requestId); await gate.refresh(); } } },
        { at: reduced ? REDUCED_WITNESS_AT : WITNESS_AT, done: false, run: async () => { if (requestId) { await made.witness(requestId, RIDERS); await gate.refresh(); } } },
      );
      cues.sort((a, b) => a.at - b.at);
      void advance();
    })();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!capture && sourceReady() && controller()) {
        // The wall clock from the first shown frame: the presentation and the scene's own moments never drift apart.
        if (started === null) { started = Date.now() - t() * 1000; opened = started; }
        setT((Date.now() - started) / 1000);
      }
      frame();
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(raf));
    roadWindow.__raidRoad = {
      timing: effective(),
      async seek(value) { setT(value); frame(); await advance(); await advance(); frame(); },
      state: () => {
        const p = party();
        return { t: t(), act: act(), progress: moment().progress, holding: moment().holding, facts: facts(), sourceReady: sourceReady(), destReady: destReady(),
          homeReady: homeReady(), mapSettled: atlas()?.settled() ?? false, mapError: mapError(), mapCause: mapCause(), worldError: worldError(), snapshot: snap(),
          party: p ? { phase: p.phase, marchers: p.marchers.length } : null, directing: source?.momentDirecting() ?? false };
      },
      spans: () => moment().spans,
      frames: captureFrames,
    };
    const ready = window.setInterval(() => { if (!worldError() && sourceReady() && controller()) { roadWindow.__chatdomReady = true; window.clearInterval(ready); } }, 100);
    onCleanup(() => window.clearInterval(ready));
  });
  onCleanup(() => {
    life.abort(); controller()?.dispose(); disposeSource?.(); disposeDest?.(); disposeHome?.(); atlas()?.dispose();
    (window as RoadWindow).__chatdomReady = false; document.body.classList.remove('rg-page', 'rr-page');
  });

  // ── What each layer shows ──────────────────────────────────────────────────────────────────────────────────
  const rise = () => progressOf('rise');
  const wake = () => progressOf('wake');
  const homeIn = () => (act() === 'home' && homeReady() ? Math.min(1, moment().elapsed / 1.4) : 0);
  const onRoad = () => ['rise', 'ride', 'hold', 'wake', 'land'].includes(act());
  const atGate = () => act() === 'gather' || act() === 'setout';
  const chapter = () => chapterOf(act());
  const raid = () => snap()?.raid ?? null;
  const partySize = () => snap()?.welcome?.view?.party ?? 0;
  const welcomeView = () => snap()?.welcome?.view ?? null;
  const giver = () => {
    const view = welcomeView();
    const offer = view?.offers.find(each => incoming(view, each) && each.from !== view.monarch.personId);
    return offer ? { name: offer.fromName ?? 'A host', title: offer.story.title, taken: offer.receipt !== null } : null;
  };
  const countdown = () => {
    const ends = snap()?.countdownEndsAt;
    if (!ends || snap()?.raid) return null;
    const left = Math.max(0, Math.ceil((ends - clock()) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  const gatherWords = (): Words => {
    const s = snap();
    const n = s?.optedIn ?? 0;
    const eyebrow = `The Raid Gate of ${from.name}`;
    if (act() === 'setout' || s?.raid) {
      return { eyebrow, title: `The party sets out for ${to.name}`, line: `Twitch confirmed the raid. ${n} of ${from.name}'s people march out under its banner${s?.joined ? ', and you walk with them' : ''}, the monarch at their head.` };
    }
    if (s?.state === 'pending' || s?.state === 'dispatching') return { eyebrow, title: 'Twitch counts down to the raid', line: `${n} wait at the gate to march to ${to.name}. They leave when Twitch says the raid has begun, not before.` };
    if (!s?.requestId) return { eyebrow, title: `${from.name}'s gate wakes`, line: 'The braziers are lit. The monarch is choosing where the night’s road leads.' };
    return { eyebrow, title: `${from.name} calls the party to the gate`, line: n === 0 ? `The road leads to ${to.name}. Anyone walking may choose to march.` : `${n} ${n === 1 ? 'has' : 'have'} chosen to march to ${to.name}${s.joined ? ', you among them' : ''}. Whoever stays keeps their evening.` };
  };
  const arrivalWords = (): Words => {
    const view = welcomeView();
    const monarch = view?.monarch.name ?? `${to.name}'s monarch`;
    const g = giver();
    const n = partySize();
    const walk = n <= 1 ? `You walk in under ${from.name}'s banner.` : `You and ${n - 1} more of ${from.name}'s party walk in under its banner.`;
    const receive = ` ${monarch} receives you at the gate${g ? `, with ${g.name}` : ''}.`;
    const gift = g?.taken ? ` ${g.name}'s gift, ${g.title}, goes home with you, its story kept.` : '';
    return { eyebrow: `The gate of ${to.name}`, title: `${to.name} welcomes the guests of ${from.name}`, line: walk + receive + gift };
  };
  const homeWords = (): Words => land === 'waiting'
    ? { eyebrow: `The gate of ${from.name}`, title: `Home in ${from.name}`, line: `The party came back through the gate. The raid stays on ${to.name}'s channel and on the Atlas road.` }
    : { eyebrow: `The gate of ${from.name}`, title: `Home in ${from.name}`, line: `You walked back in through your own gate, with what ${to.name} gave you. Your home and your light were kept.` };
  const words = (): Words | null => {
    if (atGate() || (act() === 'rise' && rise() < 0.6)) return gatherWords();
    if (act() === 'welcome' || (act() === 'wake' && wake() > 0.55)) return arrivalWords();
    if (act() === 'home' && homeReady()) return homeWords();
    return null;
  };
  const wordsReveal = () => act() === 'rise' ? 1 - ramp(0, 0.6, rise()) : act() === 'wake' ? ramp(0.55, 1, wake()) : act() === 'home' ? homeIn() : 1;
  const caravanLabel = () => {
    const m = marks();
    if (!m?.head.visible || !onRoad()) return null;
    return m.head;
  };
  const caravanLine = () => act() === 'hold' ? `Waiting at ${to.name}'s gate while its land is drawn`
    : act() === 'land' ? `At ${to.name}'s waiting land`
    : `${(raid()?.viewers ?? RIDERS).toLocaleString('en')} travellers · to ${to.name}`;
  const destMask = () => {
    const m = marks();
    const p = wake();
    if (act() === 'welcome') return 'none';
    const x = m?.to.x ?? window.innerWidth / 2, y = m?.to.y ?? window.innerHeight / 2;
    const r = Math.max(0, p * 1.15) * Math.hypot(window.innerWidth, window.innerHeight);
    return `radial-gradient(circle at ${x}px ${y}px, #000 ${Math.max(0, r - 120)}px, #0000 ${r + 40}px)`;
  };
  const sourceShown = () => act() === 'gather' || act() === 'setout' || act() === 'rise';
  const destShown = () => act() === 'wake' || act() === 'welcome' || (act() === 'home' && homeIn() < 1);

  return <div class="rr-route" classList={{ 'rg-route': true, 'rr-reduced': reduced }} data-act={act()} data-land={land}>
    <GateDefs />
    <div class="rr-map" ref={element => { mapHost = element; }} aria-label={`The Atlas: the road from ${from.name} to ${to.name}`}
      style={{ opacity: atGate() ? 0 : act() === 'home' ? String(1 - homeIn()) : String(ramp(0.05, 0.7, rise())) }} />
    <canvas class="rr-world rr-source" ref={element => { srcCanvas = element; }} aria-label={`${from.name}'s gate at dusk, its party gathered`}
      style={{ opacity: String(1 - ramp(0.1, 0.85, rise())), filter: `sepia(${ramp(0, 0.6, rise()) * 0.85}) saturate(${1 - ramp(0, 0.7, rise()) * 0.6}) brightness(${1 + ramp(0.2, 0.9, rise()) * 0.35})`, transform: `scale(${1 + ramp(0, 1, rise()) * 0.08})`, visibility: sourceShown() && !(act() === 'rise' && rise() >= 1) ? 'visible' : 'hidden' }} />
    <canvas class="rr-world rr-dest" ref={element => { dstCanvas = element; }} aria-label={`${to.name}'s land at dusk, by its gate`}
      style={{ visibility: destShown() ? 'visible' : 'hidden', '-webkit-mask-image': destMask(), 'mask-image': destMask(),
        filter: act() === 'wake' ? `sepia(${(1 - wake()) * 0.8}) saturate(${0.45 + wake() * 0.55})` : 'none' }} />
    <canvas class="rr-world rr-home" ref={element => { homeCanvas = element; }} aria-label={`${from.name}'s gate at dusk, home again`}
      style={{ visibility: act() === 'home' && homeReady() ? 'visible' : 'hidden', opacity: String(homeIn()) }} />
    <div class="rg-shade rr-shade" aria-hidden="true" />

    <header class="rr-header">
      <Show when={chapter() === 'road'} fallback={<Seal kingdomId={chapter() === 'welcome' ? to.id : from.id} size={46} />}>
        <span class="rr-pair"><Seal kingdomId={from.id} size={40} /><i aria-hidden="true" /><Seal kingdomId={to.id} size={40} /></span>
      </Show>
      <div>
        <ol class="rr-chapters">
          <For each={CHAPTERS}>{(c, i) => <li classList={{ 'rr-now': chapter() === c.id, 'rr-past': CHAPTERS.findIndex(x => x.id === chapter()) > i() }}><span>{['I', 'II', 'III'][i()]}</span>{c.title}</li>}</For>
        </ol>
        <h1>{chapter() === 'gate' ? from.name : chapter() === 'welcome' ? to.name : `${from.name} to ${to.name}`}</h1>
      </div>
    </header>

    <Show when={words()}>{w => <section class="rr-stage" aria-label={w().title} style={{ '--reveal': String(wordsReveal()) }}>
      <header class="rr-words" aria-live="polite">
        <p class="rr-eyebrow">{w().eyebrow}</p>
        <h2 class="rr-title">{w().title}</h2>
        <p class="rr-line">{w().line}</p>
        <Show when={atGate() && countdown()}>{left => <p class="rr-count" aria-label={`Twitch raids in ${left()}`}><span>Twitch raids in</span><b>{left()}</b></p>}</Show>
      </header>
    </section>}</Show>

    <Show when={caravanLabel()}>{head => <div class="rr-caravan" style={{ transform: `translate(${Math.round(head().x)}px, ${Math.round(head().y)}px)` }}>
      <div class="rr-caravan-tag">
        <Seal kingdomId={from.id} size={34} />
        <span><b>{from.name}'s raid</b><small>{caravanLine()}</small></span>
      </div>
    </div>}</Show>
    <Show when={mapError() && onRoad()}><p class="rr-map-note" role="status">{mapError()}</p></Show>

    <Show when={act() === 'land'}>
      <aside class="rr-land" aria-label={`${to.name}'s waiting land`}>
        <Seal kingdomId={to.id} size={58} />
        <p class="rr-eyebrow">Waiting land</p>
        <h2>{to.name} has no kingdom yet</h2>
        <p>The raid landed on {to.name}'s Twitch channel. Here, their land waits in pencil until they found a kingdom live on stream, and when they do, anyone who came tonight can pitch a tent at its edge.</p>
        <div class="rr-land-acts">
          <a class="rr-land-watch" href={twitchChannelUrl(to.login)} target="_blank" rel="noopener noreferrer">Watch {to.name} on Twitch <span aria-hidden="true">↗</span></a>
          <button type="button" class="rr-land-home" onClick={() => { returning = true; note('homeAt'); }}>Come home to {from.name}</button>
        </div>
      </aside>
    </Show>

    <Show when={controller() && (atGate() || act() === 'welcome' || (act() === 'home' && land === 'founded'))}>
      <div class="rr-board" classList={{ 'rr-board-late': act() === 'welcome' }}><RaidGatePane controller={controller()!} clock={clock} /></div>
    </Show>
    <Show when={worldError() || !sourceReady()}><div class="rg-veil" role="status"><p>{worldError() ?? `Unfolding ${from.name}'s land…`}</p></div></Show>
  </div>;
}
