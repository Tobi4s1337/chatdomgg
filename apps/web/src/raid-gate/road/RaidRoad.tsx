import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { AtlasChannelSchema, type PresenceFeed } from '@chatdom/shared';
import type { KingdomId, PersonId } from '../../../../api/src/raid-gate/contracts';
import { openRoadAtlas, RoadAtlasError, type RoadAtlas } from '../../atlas/road';
import { createKingdomScene } from '../../kingdom/scene';
import { installFrameGate, type FrameGate } from './frames';
import type { BenchCast, GateBench } from '../bench';
import { createRaidGateController, type GateSnapshot, type RaidGateController } from '../controller';
import { incoming } from '../welcome';
import { GateDefs, RaidGatePane } from '../RaidGatePane';
import { Seal } from '../Seal';
import { CHAPTERS, chapterOf, mapFrame, momentAt, REDUCED_TIMING, ROAD_TIMING, type RoadFacts, type RoadMoment, type RoadTiming } from './director';
import { emptyPresence, ROAD_PAIR, roadLand, type RoadLand } from './lands';
import { RoadDefs, ramp } from './procession';
import { Arrival, Gathering, type Words } from './tableaux';
import { createRoadArrivalFeed } from './arrival-feed';
import { sourceGateShot } from './gate-shot';
import '../raid-gate.css';
import '../welcome.css';
import './road.css';

/**
 * The raid road (Moments.md §7, Atlas.md §7.5–7.6, spec 23 R3/R6): one continuous journey from the leaving kingdom's
 * Raid Gate, along the Atlas road between two real holdings, to the destination's gate, its welcome and its gift.
 *
 * Its two ends are real Twitch channels on the real survey (their positions, names and arms), whose land is grown from
 * each channel's own seed as the Genesis previews grow it. The real gate application runs against private
 * simulated Twitch, rooms, people and things; internal origins remain isolated without visible provenance chips.
 * The director holds each act until the fact behind the next one is observed; nothing moves on a timer alone.
 *
 * `?capture=1` freezes the presentation clock and hands it to `window.__raidRoad.seek(t)`, so captures are exact.
 */

type RoadWindow = Window & { __chatdomReady?: boolean; __raidRoad?: RoadHook };
type RoadHook = {
  seek(t: number): Promise<void>;
  state(): { t: number; act: string; progress: number; holding: boolean; facts: RoadFacts; sourceReady: boolean; destReady: boolean; mapSettled: boolean; mapError: string | null; mapCause: string | null; worldError: string | null; snapshot: GateSnapshot | null };
  spans(): ReturnType<typeof momentAt>['spans'];
  timing: RoadTiming;
  /** Under `capture=1` only: the page's animation frames, let go only as the capture asks. */
  frames: FrameGate | null;
};

/** Installed once per page, the first time the route opens under `capture=1`. */
let frameGate: FrameGate | undefined;

/** SIMULATED travellers on stream for this rehearsal (the public `channel.raid` count; it draws nobody). */
const RIDERS = 612;
/** SIMULATED walkers who choose to march, besides this viewer, and when each chooses. */
const WALKER_CUES = [1.1, 2.0, 3.6, 4.4, 5.6];
const SIMULATED_HOST = '53000001' as PersonId;
/** Waits before asking the survey again after a read that failed or ran out of time. */
const MAP_RETRIES = [1500, 4000, 9000];

function castFor(from: RoadLand, to: RoadLand): BenchCast {
  const channel = AtlasChannelSchema.parse({ kingdomId: to.id, login: to.login, displayName: to.name, language: 'en', founded: true, kingdomName: to.name, contentClassification: 'general' });
  return {
    source: { kingdomId: from.id as KingdomId, name: from.name, login: from.login },
    destinations: [{ channel, land: 'founded', live: true, group: 'road' }],
    rooms: [from.id as KingdomId, to.id as KingdomId],
    welcome: { kingdomId: to.id as KingdomId, name: to.name, host: SIMULATED_HOST, things: { hostGift: 'Lantern of the rose-lit river', monarchGift: 'River-reed welcome loaf' } },
    names: { [to.id]: to.name, [SIMULATED_HOST]: 'Ash of the Mill', [from.id]: from.name, '52000001': 'Wren', '52000002': 'Tamsin' },
    carried: { crafted: 'A pawn carved from mountain pine', forged: 'Citadel-glass lantern' },
  };
}

const sceneFeed = (id: string): PresenceFeed => ({ label: 'SIMULATED', subscribe(receive) { receive(emptyPresence(id, Date.now())); return () => undefined; } });

export default function RaidRoad() {
  const query = new URLSearchParams(location.search);
  const capture = query.get('capture') === '1';
  const captureFrames = capture ? (frameGate ??= installFrameGate()) : null;
  const reduced = query.get('motion') === 'reduced' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const timing: RoadTiming = reduced ? REDUCED_TIMING : ROAD_TIMING;
  const from = roadLand(ROAD_PAIR.from), to = roadLand(ROAD_PAIR.to);
  const life = new AbortController();
  /** The destination's own raid arrival: the road hands it the witnessed raid when the guests reach its gate. */
  const arrival = createRoadArrivalFeed();

  const [t, setT] = createSignal(0);
  // The SIMULATED authority keeps the presentation's time, so a call's countdown, a preview's life and every receipt
  // read the same however slowly a frame is drawn; live, the clock is the server's.
  const opened = Date.now();
  const clock = () => opened + Math.round(t() * 1000);
  const [snap, setSnap] = createSignal<GateSnapshot | null>(null);
  const [controller, setController] = createSignal<RaidGateController | null>(null);
  const [facts, setFacts] = createSignal<RoadFacts>({ departedAt: null, mapReadyAt: null, arrivedAt: null, welcomedAt: null });
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
  const [seats, setSeats] = createSignal<number[]>([]);
  const [you, setYou] = createSignal<number | null>(null);
  const [marks, setMarks] = createSignal<ReturnType<RoadAtlas['marks']> | null>(null);

  const effective = () => ({ ...timing, ride: reduced ? timing.ride : rideSeconds() });
  const moment = createMemo<RoadMoment>(() => momentAt(facts(), effective(), t()));
  const act = () => moment().act;
  const progressOf = (name: RoadMoment['act']) => {
    const span = moment().spans.find(each => each.act === name);
    if (!span) return 0;
    return span.length > 0 ? Math.min(1, Math.max(0, (t() - span.start) / span.length)) : 1;
  };

  let srcCanvas!: HTMLCanvasElement, dstCanvas!: HTMLCanvasElement, mapHost!: HTMLDivElement;
  let bench: GateBench | null = null;
  let disposeSource: (() => void) | undefined, disposeDest: (() => void) | undefined;

  const note = (key: keyof RoadFacts) => setFacts(current => current[key] === null ? { ...current, [key]: t() } : current);

  /** Observes the authority's answers and turns them into the director's facts and the party's places. */
  const observe = (next: GateSnapshot) => {
    setSnap(next);
    const count = next.optedIn;
    setSeats(current => {
      if (count <= current.length) return current;
      const grown = [...current];
      while (grown.length < count) grown.push(t());
      return grown;
    });
    if (next.joined && you() === null) setYou(Math.max(0, count - 1));
    // The party sets out on Twitch's witnessed raid, never on the press of a button.
    if (next.raid) note('departedAt');
    if (next.journey?.kind === 'raid' && next.journey.state === 'committed' && destReady()) note('arrivedAt');
    if (next.welcome?.status === 'ready' && next.welcome.view) note('welcomedAt');
  };

  // ── The SIMULATED world around this viewer, on the presentation clock ───────────────────────────────────────
  type Cue = { at: number; done: boolean; run: () => Promise<void> };
  const cues: Cue[] = [];
  let requestId: string | null = null;
  let queue: Promise<void> = Promise.resolve();
  let followed = false, welcomed = false, accepted = false;
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
      // The marcher goes through the gate with the column, once it has walked into the arch: the journey's own stages
      // then run while the road is drawn, and the destination's acknowledgment is what ends the ride.
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
    });
    return queue;
  };

  const startSource = () => {
    void createKingdomScene(srcCanvas, {
      signal: life.signal, potential: from.potential, nativeStyle: from.potential.style, forgeFamily: from.potential.style,
      tier: from.potential.plan.config.tier, seed: from.potential.plan.config.seed, realmName: from.name, kingdomId: from.id as KingdomId,
      presenceFeed: sceneFeed(from.id), presenceOrigin: 'simulated', hour: 19.6, time: null, camera: 'hero', source: 'simulated',
      onProgress: () => undefined, onNames: () => undefined, onSource: () => undefined, onError: message => failWorld(from.name, message),
    }).then(scene => {
      if (life.signal.aborted) { scene.dispose(); return; }
      disposeSource = () => scene.dispose();
      // Stand at the gate the party will leave by, looking in over the dressed near streets to the town in its haze.
      const shot = sourceGateShot(scene.layout, window.innerHeight > window.innerWidth);
      if (shot) scene.pose(shot.eye, shot.target, shot.fov);
      const settle = () => { if (life.signal.aborted || !disposeSource) return; if (scene.debug.ready && scene.debug.fieldSettled) setSourceReady(true); else requestAnimationFrame(settle); };
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

  /** Everything that follows the presentation clock: the map's frame, the second world, the cues. */
  const frame = () => {
    const m = moment();
    const map = atlas();
    if (map) {
      const f = mapFrame(m);
      map.show({ ...f, time: t() });
      setMarks(map.marks());
    }
    // The destination's world is readied while the column rides; the source's world is let go once out of sight.
    if ((m.act === 'ride' || m.act === 'hold') && !destStarted()) startDest();
    if (m.act !== 'gather' && m.act !== 'setout' && m.act !== 'rise' && disposeSource) { disposeSource(); disposeSource = undefined; }
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
      bench = createGateBench({ viewer: 'walker', authority: 'ready', clock, cast: castFor(from, to) });
      const made = bench;
      const gate = createRaidGateController({ api: made.api, atlas: made.atlas, source: made.source, clock, account: { reconnect: () => made.reconnect() } });
      setController(gate);
      gate.subscribe(observe);
      observe(gate.snapshot());
      cues.push(
        { at: 0.2, done: false, run: async () => { const reply = await made.monarchPreview(to.id as KingdomId); if (reply.kind === 'preview') requestId = reply.value.requestId; await gate.refresh(); } },
        ...WALKER_CUES.map((at, index) => ({ at, done: false, run: async () => { if (requestId) { await made.walkersJoin(index + 1, requestId); await gate.refresh(); } } })),
        { at: 2.8, done: false, run: async () => { await gate.join(); } },
        { at: 6.2, done: false, run: async () => { if (requestId) { await made.monarchStart(requestId); await gate.refresh(); } } },
        { at: reduced ? 3.6 : 8.4, done: false, run: async () => { if (requestId) { await made.witness(requestId, RIDERS); await gate.refresh(); } } },
      );
      cues.sort((a, b) => a.at - b.at);
      void advance();
    })();
    let last = performance.now(), raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!capture && sourceReady() && controller()) setT(value => value + dt);
      frame();
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => cancelAnimationFrame(raf));
    roadWindow.__raidRoad = {
      timing: effective(),
      async seek(value) { setT(value); frame(); await advance(); await advance(); frame(); },
      state: () => ({ t: t(), act: act(), progress: moment().progress, holding: moment().holding, facts: facts(), sourceReady: sourceReady(), destReady: destReady(), mapSettled: atlas()?.settled() ?? false, mapError: mapError(), mapCause: mapCause(), worldError: worldError(), snapshot: snap() }),
      spans: () => moment().spans,
      frames: captureFrames,
    };
    const ready = window.setInterval(() => { if (!worldError() && sourceReady() && controller()) { roadWindow.__chatdomReady = true; window.clearInterval(ready); } }, 100);
    onCleanup(() => window.clearInterval(ready));
  });
  onCleanup(() => {
    life.abort(); controller()?.dispose(); disposeSource?.(); disposeDest?.(); atlas()?.dispose();
    (window as RoadWindow).__chatdomReady = false; document.body.classList.remove('rg-page', 'rr-page');
  });

  // ── What each layer shows ──────────────────────────────────────────────────────────────────────────────────
  const rise = () => progressOf('rise');
  const wake = () => progressOf('wake');
  const onRoad = () => ['rise', 'ride', 'hold', 'wake'].includes(act());
  const chapter = () => chapterOf(act());
  const raid = () => snap()?.raid ?? null;
  const party = () => snap()?.welcome?.view?.party ?? 0;
  const welcomeView = () => snap()?.welcome?.view ?? null;
  const giver = () => {
    const view = welcomeView();
    const offer = view?.offers.find(each => incoming(view, each) && each.from !== view.monarch.personId);
    return offer ? { name: offer.fromName ?? 'A host', title: offer.story.title, taken: offer.receipt !== null } : null;
  };
  const gatherWords = (): Words => {
    const s = snap();
    const n = s?.optedIn ?? 0;
    const eyebrow = `The Raid Gate of ${from.name}`;
    if (act() === 'setout' || s?.raid) {
      const viewers = s?.raid?.viewers;
      return { eyebrow, title: `The party sets out for ${to.name}`, line: `Twitch confirmed the raid${viewers ? `, ${viewers.toLocaleString('en')} viewers riding along on stream` : ''}. ${n} of ${from.name}'s people march under its banner${s?.joined ? ', and you walk with them' : ''}.` };
    }
    if (s?.state === 'pending' || s?.state === 'dispatching') return { eyebrow, title: 'Twitch counts down to the raid', line: `${n} wait at the gate to march to ${to.name}. They leave when Twitch says the raid has begun, not before.` };
    if (!s?.requestId) return { eyebrow, title: `${from.name}'s gate wakes`, line: `The braziers are lit. The monarch is choosing where the night's road leads.` };
    return { eyebrow, title: `${from.name} calls the party to the gate`, line: n === 0 ? `The road leads to ${to.name}. Anyone walking may choose to march.` : `${n} ${n === 1 ? 'has' : 'have'} chosen to march to ${to.name}${s.joined ? ', you among them' : ''}. Whoever stays keeps their evening.` };
  };
  const arrivalWords = (): Words => {
    const view = welcomeView();
    const monarch = view?.monarch.name ?? `${to.name}'s monarch`;
    const g = giver();
    const n = party();
    const walk = n <= 1 ? `You walk in under ${from.name}'s banner.` : `You and ${n - 1} more of ${from.name}'s party walk in under its banner.`;
    const receive = ` ${monarch} receives you at the gate${g ? `, with ${g.name}` : ''}.`;
    const gift = g?.taken ? ` ${g.name}'s gift, ${g.title}, goes home with you, its story kept.` : '';
    return { eyebrow: `The gate of ${to.name}`, title: `${to.name} welcomes the guests of ${from.name}`, line: walk + receive + gift };
  };
  const caravanLabel = () => {
    const m = marks();
    if (!m?.head.visible || !onRoad()) return null;
    return m.head;
  };
  const destMask = () => {
    const m = marks();
    const p = wake();
    if (act() === 'welcome') return 'none';
    const x = m?.to.x ?? window.innerWidth / 2, y = m?.to.y ?? window.innerHeight / 2;
    const r = Math.max(0, p * 1.15) * Math.hypot(window.innerWidth, window.innerHeight);
    return `radial-gradient(circle at ${x}px ${y}px, #000 ${Math.max(0, r - 120)}px, #0000 ${r + 40}px)`;
  };

  return <div class="rg-route rr-route" data-act={act()} classList={{ 'rr-reduced': reduced }}>
    <GateDefs />
    <RoadDefs />
    <div class="rr-map" ref={element => { mapHost = element; }} aria-label={`The Atlas: the road from ${from.name} to ${to.name}`}
      style={{ opacity: act() === 'gather' || act() === 'setout' ? 0 : String(ramp(0.05, 0.7, rise())) }} />
    <canvas class="rr-world rr-source" ref={element => { srcCanvas = element; }} aria-label={`${from.name}'s land at dusk, by its Raid Gate`}
      style={{ opacity: String(1 - ramp(0.1, 0.85, rise())), filter: `sepia(${ramp(0, 0.6, rise()) * 0.85}) saturate(${1 - ramp(0, 0.7, rise()) * 0.6}) brightness(${1 + ramp(0.2, 0.9, rise()) * 0.35})`, transform: `scale(${1 + ramp(0, 1, rise()) * 0.08})`, visibility: onRoad() && rise() >= 1 ? 'hidden' : 'visible' }} />
    <canvas class="rr-world rr-dest" ref={element => { dstCanvas = element; }} aria-label={`${to.name}'s land at dusk, by its gate`}
      style={{ visibility: act() === 'wake' || act() === 'welcome' ? 'visible' : 'hidden', '-webkit-mask-image': destMask(), 'mask-image': destMask(),
        filter: act() === 'wake' ? `sepia(${(1 - wake()) * 0.8}) saturate(${0.45 + wake() * 0.55})` : 'none' }} />
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

    <Show when={act() === 'gather' || act() === 'setout' || (act() === 'rise' && rise() < 0.6)}>
      <Gathering kingdomId={from.id} name={from.name} seats={seats()} you={you()} time={t()} setout={act() === 'setout' ? moment().progress : act() === 'rise' ? 1 : 0}
        words={gatherWords()} simulated fade={act() === 'rise' ? ramp(0, 0.6, rise()) : 0} />
    </Show>

    <Show when={caravanLabel()}>{head => <div class="rr-caravan" style={{ transform: `translate(${Math.round(head().x)}px, ${Math.round(head().y)}px)` }}>
      <div class="rr-caravan-tag">
        <Seal kingdomId={from.id} size={34} />
        <span><b>{from.name}'s raid</b><small>{act() === 'hold' ? `Waiting at ${to.name}'s gate while its land is drawn` : `${(raid()?.viewers ?? RIDERS).toLocaleString('en')} travellers · to ${to.name}`}</small></span>
      </div>
    </div>}</Show>
    <Show when={mapError() && onRoad()}><p class="rr-map-note" role="status">{mapError()}</p></Show>

    <Show when={act() === 'welcome' || (act() === 'wake' && wake() > 0.55)}>
      <Arrival hostName={to.name} words={arrivalWords()} simulated reveal={act() === 'welcome' ? 1 : ramp(0.55, 1, wake())} />
    </Show>

    <Show when={controller() && (act() === 'gather' || act() === 'setout' || act() === 'welcome')}>
      <div class="rr-board" classList={{ 'rr-board-late': act() === 'welcome' }}><RaidGatePane controller={controller()!} clock={clock} /></div>
    </Show>
    <Show when={worldError() || !sourceReady()}><div class="rg-veil" role="status"><p>{worldError() ?? `Unfolding ${from.name}'s land…`}</p></div></Show>
  </div>;
}
