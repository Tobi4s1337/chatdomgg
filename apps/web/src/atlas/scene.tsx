import { batch, createEffect, createMemo, createSignal, createUniqueId, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import './atlas.css';
import { render } from 'solid-js/web';
import type { AtlasGateEmit, AtlasMountOptions, AtlasReadyState, AtlasScene as SceneHandle, AtlasSceneGate, AtlasTarget, AtlasView } from './embed';
import { AtlasChannelSchema, type AtlasChannel } from '@chatdom/shared';
import type { AtlasTravelStage } from '../raid-gate/ports';
import { fetchBusiest, fetchChannelRoads, fetchFinder, fetchRoadStory, type BusyRoad, type CaravanRaid, type ChannelRoads, type FinderEntry, type FinderReply, type MapPoint, type RoadStory } from './data/roads';
import type { AtlasRaid, KingdomId } from '../../../api/src/raid-gate/contracts';
import { AtlasRoadsLayer, type InkRoad, type JourneyStage } from './road/atlas-roads';
import { FinderBoard, type FinderState } from './gate/FinderBoard';
import { selectable } from './gate/select';
import { LedgerRoads, RoadStoryCard } from './ui/Roads';
import { LatestRequest, savedView } from './saved-view';
import type { HistoryLike } from './ui/history';
import { adoptPreview, loadPreview, type LoadedPreview } from './data/load';
import { dabHashOf, DirectoryError, fetchCard, type CardReply, type CardRoad, type ChannelFace, type Lookup, type PencilPosition, type SearchResult } from './data/directory';
import { decodeRings, geographyOf, labelWorld, SettlerStore, type Geography, type Ring, type Settler } from './data/model';
import { fetchChunk, fetchNames, type PreviewSource } from './data/preview';
import { atlasFailureState, mountAtlasWithRetry } from './recovery';
import { LiveFeed, type LiveStatus } from './live/feed';
import { LivePaint, type Dab } from './live/paint';
import { DISTANCE_STOP, MAX_SCALE, type Distance, type Insets, type Viewport } from './map/camera';
import type { CameraState } from './map/motion';
import { MapView, type MapStats } from './map/view';
import { Still } from './still/Still';
import { stillView } from './still/compose';
import { Card, type NamesState } from './ui/Card';
import { DoorCartouche } from './ui/Door';
import { handOffHolding, holdingPlace, type DoorHolding } from './data/holding';
import { Cartouche, Compass, Controls, Notice, ScaleBar } from './ui/chrome';
import { formatMoment, watchUrl } from './ui/format';
import { CardHistory } from './ui/history';
import { LegendBody } from './ui/Legend';
import { SurveySeal } from './ui/SurveySeal';
import { FooterSlot } from './ui/FooterSlot';
import { AtlasMaterialSound } from './ui/material-sound';
import { DabCard, type LiveSummary } from './ui/Live';
import { faceName, WaitingCard, type RegisterState } from './ui/Register';
import { formatRoute, parseRoute, type AtlasRoute } from './ui/route';
import { Search } from './ui/Search';

type State = 'loading' | 'ready' | 'still' | 'empty' | 'unavailable' | 'invalid' | 'unsupported';

declare global {
  interface Window {
    __chatdomReady?: boolean;
    /** Read-only evidence of the drawn map for the Atlas checks (camera, tiles, overlay budgets). */
    __chatdomAtlas?: { stats(): MapStats | null; marks(limit?: number): ReturnType<MapView['drawnMarks']> };
  }
}

interface NoticeState { text: string; action?: { label: string; run: () => void } }


/** The busiest roads are read again this often: the ledger grows with every witnessed raid. */
const NETWORK_REFRESH_MS = 10 * 60_000;
/** A gate follows a raid's caravan for this long at most while waiting for the public stream to announce it. */
const FOLLOW_WAIT_MS = 120_000;

/** Open maps re-read the names projection this often, so withholding and refreshed names reach them. */
const NAMES_REFRESH_MS = 5 * 60_000;
/** The first view waits this long at most for the live paint; the land never waits on it longer. */
const LIVE_WAIT_MS = 4_000;
const FACES = ['16px "IM Fell English"', 'italic 16px "IM Fell English"', '16px "IM Fell English SC"', '16px "Alegreya"', 'italic 16px "Alegreya"'];
/** Narrower than this the Atlas is laid out for a phone: the card is a bottom sheet, search sits at the top. */
const PHONE_WIDTH = 720;
/** The distance a found holding is shown at, by tier: where its mark and name are drawn (R7), never further out. */
const TIER_STOP = [DISTANCE_STOP.continent, DISTANCE_STOP.continent, DISTANCE_STOP.realm, DISTANCE_STOP.kingdom] as const;

/** A road being opened: its two ends as the reader asked for them (IDs from a card, logins from a route). */
type RoadAsk = { a: { id: string } | { login: string }; b: { id: string } | { login: string } };

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Fonts are part of the drawing: labels are set only once the faces are in (or after a short grace). */
async function loadFaces(signal: AbortSignal): Promise<void> {
  if (!('fonts' in document) || signal.aborted) return;
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 4000);
    signal.addEventListener('abort', finish, { once: true });
    void Promise.all(FACES.map(face => document.fonts.load(face, 'Atlas Кириллица'))).then(finish, finish);
  });
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * The Atlas of Kingdoms: a survey preview of real Twitch channels drawn as draft land. One root element carries
 * `data-chatdom-atlas` and the state; the owning embed is notified when the first coherent frame is drawn. Without WebGL the same survey is drawn as a still.
 */
export function mountScene(element: HTMLElement, options: AtlasMountOptions, ready: (state: AtlasReadyState) => void, gateEmit: AtlasGateEmit = () => undefined): SceneHandle {
  let api!: Omit<SceneHandle, 'dispose'>;
  const dispose = render(() => <AtlasScene options={options} ready={ready} gateEmit={gateEmit} attach={value => { api = value; }} />, element);
  return { ...api, dispose };
}

function AtlasScene(props: { options: AtlasMountOptions; ready(state: AtlasReadyState): void; gateEmit: AtlasGateEmit; attach(api: Omit<SceneHandle, 'dispose'>): void }) {
  // Bloom reads this for every live stain. Keep the query, while its matches value follows preference changes.
  const motionPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduceMotion = () => motionPreference?.matches ?? false;
  const SOURCE: PreviewSource = { base: props.options.base ?? '/map-data', fetch: (input, init) => fetch(input, init) };
  const [mode, setMode] = createSignal(props.options.mode);
  const ownsUrl = props.options.routing === 'url' && props.options.mode === 'explore';
  // The gate is the Raid Gate's own full surface: its map takes the wheel at once.
  const [activated, setActivated] = createSignal(ownsUrl || props.options.mode === 'gate');
  const materialSound = new AtlasMaterialSound();
  const [muted, setMuted] = createSignal(false);
  const mute = () => { const next = !muted(); setMuted(next); materialSound.setMuted(next); if (!next) materialSound.play('press'); };
  const soundFor = (target: EventTarget | null) => {
    if (mode() === 'hero' || !visible() || !(target instanceof Element)) return;
    const fitting = target.closest('button,a,[role="option"]');
    if (!fitting) {
      // A tap into a field opens nothing, so it readies the sound for the cue that follows (never the map: a drag
      // must not wait on an audio device either).
      if (target.closest('input,textarea') && root?.contains(target)) materialSound.prime();
      return;
    }
    if (fitting.matches(':disabled,.atlas-sound-toggle') || !root?.contains(fitting)) return;
    materialSound.play(fitting.matches('.atlas-key-toggle') ? 'shutter' : fitting.matches('.atlas-survey-button,.atlas-search-result,.atlas-door') ? 'wax' : 'press');
  };
  const onMaterialPointer = (event: PointerEvent) => { if (event.isPrimary && event.button === 0) soundFor(event.target); };
  // Typing or moving focus readies the sound too; Enter and Space may themselves select, so they never open the device.
  const onMaterialKey = (event: KeyboardEvent) => {
    if (mode() !== 'hero' && visible() && !event.repeat && event.key !== 'Enter' && event.key !== ' ') materialSound.prime();
  };
  let disposed = false;
  let liveWait: ReturnType<typeof setTimeout> | undefined;
  let backdropTimer: ReturnType<typeof setTimeout> | undefined;
  const noWebgl = !webglAvailable();
  const [backdrop, setBackdrop] = createSignal(true);
  const [stillDrawn, setStillDrawn] = createSignal(false);
  let resizeObserver: ResizeObserver | undefined;
  let visibilityObserver: IntersectionObserver | undefined;
  let inViewport = true;
  const [visible, setVisible] = createSignal(!document.hidden);
  const pendingFlights = new Set<() => void>();
  let root: HTMLDivElement | undefined;
  let host: HTMLDivElement | undefined;
  let view: MapView | null = null;
  /** Every remembered road, the chosen kingdom's roads, caravans and the gate's journey, on the map's own camera. */
  let roadsLayer: AtlasRoadsLayer | null = null;
  let networkTimer: ReturnType<typeof setTimeout> | undefined;
  let networkRoads: InkRoad[] = [];
  let controller: AbortController | null = null;
  let store: SettlerStore | null = null;
  let namesTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let feed: LiveFeed | null = null;
  let paint: LivePaint | null = null;
  let evidenceTimer: ReturnType<typeof setInterval> | undefined;
  /** Rebuilds the map from a saved view after a lost WebGL context did not come back. */
  let rebuild: ((state: CameraState) => Promise<void>) | null = null;
  /** Where focus was when a card opened, so closing it returns there. */
  let opener: HTMLElement | null = null;
  let cardObserver: ResizeObserver | null = null;
  let cardMeasure: (() => void) | null = null;
  /** Reads a region's towns and villages for the current survey (the still reads them in the background too). */
  let loadChunk: (region: number) => Promise<void> = async () => undefined;
  const [state, setState] = createSignal<State>('loading');
  const [loaded, setLoaded] = createSignal<LoadedPreview | null>(null);
  const [selected, setSelected] = createSignal<Settler | null>(null);
  const [selectedDab, setSelectedDab] = createSignal<Dab | null>(null);
  const [geo, setGeo] = createSignal<Geography | null>(null);
  const [settlers, setSettlers] = createSignal<SettlerStore | null>(null);
  const [live, setLive] = createSignal<LiveSummary | null>(null);
  /** Bumped on every live frame, so the open card follows its holding on and off the air. */
  const [liveTick, setLiveTick] = createSignal(0);
  const [drawnLive, setDrawnLive] = createSignal<{ washes: number; pennants: number[] } | null>(null);
  const [scale, setScale] = createSignal(1);
  const [minScale, setMinScale] = createSignal(0);
  const [distance, setDistance] = createSignal<Distance>('world');
  const [keyOpen, setKeyOpen] = createSignal(false);
  const keyBodyId = createUniqueId();
  const [notice, setNotice] = createSignal<NoticeState | null>(null);
  const [phone, setPhone] = createSignal(false);
  const [names, setNames] = createSignal<NamesState>('loading');
  const [context, setContext] = createSignal<'ok' | 'lost'>('ok');
  /** Bumped whenever names change on the same holdings, so the card follows them. */
  const [namesTick, setNamesTick] = createSignal(0);
  /** A named channel without land and not on air, opened from search, a road or a route. */
  const [waiting, setWaiting] = createSignal<ChannelFace | null>(null);
  const [waitingPosition, setWaitingPosition] = createSignal<PencilPosition | null>(null);
  const [waitingScreen, setWaitingScreen] = createSignal<PencilPosition | null>(null);
  /** The gate's source when it has no holding to mark: its pencil place, flagged and named. */
  const [gateSource, setGateSource] = createSignal<{ x: number; y: number; name: string } | null>(null);
  createEffect(() => {
    const point = waiting() ? waitingPosition() : gateSource();
    if (!point || !visible()) { setWaitingScreen(null); return; }
    let frame: number;
    let projection: ReturnType<typeof stillView> | null = null;
    const update = () => {
      const geometry = geo();
      const moving = state() === 'ready' ? view : null;
      const size = { width: root?.clientWidth ?? 1, height: root?.clientHeight ?? 1 };
      if (!moving && geometry && (!projection || projection.view.width !== size.width || projection.view.height !== size.height)) projection = stillView(geometry.bounds, size);
      const screen = moving?.screenOf(point.x, point.y) ?? projection?.camera.worldToScreen(point.x, point.y, size) ?? null;
      setWaitingScreen(screen);
      frame = requestAnimationFrame(update);
    };
    update();
    onCleanup(() => cancelAnimationFrame(frame));
  });
  /** The open road card and the ends it was asked for. */
  const [road, setRoad] = createSignal<{ ask: RoadAsk; state: RegisterState<RoadStory> } | null>(null);
  /** The open card's roads from the road ledger, all drawn on the map while the card is open. */
  const [channelRoads, setChannelRoads] = createSignal<{ id: string; state: RegisterState<ChannelRoads> } | null>(null);
  let roadsController: AbortController | null = null;
  /** Caravans riding now and roads drawn, for the page's evidence attributes. */
  const [roadStats, setRoadStats] = createSignal<AtlasRoadsLayer['stats'] | null>(null);
  // Gate mode: the source, its finder, a name search inside it, and the monarch's pick.
  const [gateFrom, setGateFrom] = createSignal<string | null>(null);
  const [finder, setFinder] = createSignal<FinderState>({ status: 'idle' });
  const [finderSearch, setFinderSearch] = createSignal<FinderState>({ status: 'idle' });
  const [picked, setPicked] = createSignal<string | null>(null);
  const [gateRoads, setGateRoads] = createSignal<{ total: number; since: number } | null>(null);
  /** The open channel card's register entry (stream and roads). */
  const [register, setRegister] = createSignal<RegisterState<CardReply>>({ status: 'loading' });
  let registerController: AbortController | null = null;
  /** Bumped whenever a card opens or closes, so a late register reply never lands on another card. */
  let cardGeneration = 0;
  /** The route the page was opened on, applied once the first view is drawn. */
  let pendingRoute: { route: AtlasRoute; adopted: boolean } | null = null;
  /** The view the page asked to start at (a return from sign-in), used once by the first revision drawn. */
  let startView: unknown = props.options.view ?? null;
  const anyOpen = () => !!selected() || !!selectedDab() || !!waiting() || !!road();

  const settle = () => { if (!disposed) props.ready(state() === 'ready' ? 'map' : state() === 'still' ? 'still' : 'failed'); };

  const measure = () => setPhone((root?.clientWidth ?? 0) < PHONE_WIDTH);

  /** Space the page's own chrome takes from the map: the cartouche and key on a laptop, title and buttons on a phone. */
  const chromeInsets = (size: Viewport): Insets => {
    if (mode() === 'hero') return { left: 0, right: 0, top: 0, bottom: 0 };
    if (mode() === 'gate') {
      // The finder board stands on the right (a bottom sheet on a phone); the source and the pick stay clear of it.
      if (!gateFrom()) return { left: 0, right: 0, top: 0, bottom: 0 };
      const board = root?.querySelector('.atlas-finder')?.getBoundingClientRect();
      const origin = root?.getBoundingClientRect();
      if (size.width < PHONE_WIDTH) return { left: 0, right: 0, top: 0, bottom: board ? Math.max(0, Math.round(size.height - board.top + (origin?.top ?? 0))) : Math.round(size.height * 0.62) };
      return { left: 0, right: board ? Math.max(0, Math.round(size.width - board.left + (origin?.left ?? 0))) : Math.round(Math.min(500, Math.max(330, size.width * 0.25)) + 32), top: 0, bottom: 0 };
    }
    if (size.width < PHONE_WIDTH) {
      const cartouche = root?.querySelector('.atlas-cartouche')?.getBoundingClientRect();
      return { left: 0, right: 0, top: cartouche ? Math.round(cartouche.bottom - (root?.getBoundingClientRect().top ?? 0)) + 4 : 76, bottom: 60 };
    }
    if (size.width >= 1100 && anyOpen()) return { left: 390, right: 0, top: 0, bottom: 0 };
    return { left: 0, right: 0, top: 0, bottom: 0 };
  };

  /** The space an open card takes: its measured box, or a first estimate before it has been laid out. */
  const cardInsets = (card: Element | null): Insets => {
    const width = root?.clientWidth ?? 1;
    const height = root?.clientHeight ?? 1;
    const origin = root?.getBoundingClientRect();
    const box = card?.getBoundingClientRect();
    if (phone()) return { left: 0, right: 0, top: 0, bottom: box ? Math.max(0, Math.round(height - box.top + (origin?.top ?? 0))) : Math.round(Math.min(height * 0.56, 470)) };
    return { left: 0, right: box ? Math.max(0, Math.round(width - box.left + (origin?.left ?? 0))) : 400, top: 0, bottom: 0 };
  };

  let memoryState: unknown = null;
  const memoryHistory: HistoryLike = {
    get state() { return memoryState; },
    pushState(data) { memoryState = data; },
    replaceState(data) { memoryState = data; },
    back() { memoryState = null; },
  };
  const history = new CardHistory(ownsUrl ? window.history : memoryHistory, (before) => {
    // Back: the card closes and the camera returns to where it was before the card moved it.
    clearCards();
    view?.setCardInsets(null);
    view?.restore(before);
    restoreFocus();
  });

  /** Nothing chosen: every card's subject, the chosen mark and an inked road go, and any late register reply is dropped. */
  const clearCards = () => {
    cardGeneration++;
    registerController?.abort();
    registerController = null;
    batch(() => {
      setSelected(null);
      setSelectedDab(null);
      setWaiting(null);
      setWaitingPosition(null);
      setRoad(null);
      setChannelRoads(null);
    });
    roadsController?.abort();
    roadsController = null;
    view?.select(null);
    view?.setRoad(null);
    roadsLayer?.setFocus(null);
    roadsLayer?.setChosen(null);
  };

  /** How far the land spans, so a caravan's ride time follows its distance across the whole map. */
  const worldSpan = () => {
    const bounds = geo()?.bounds;
    return bounds ? Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) : 1;
  };

  /** A new map gets its own roads layer, with the network, the open card's roads and the gate's journey drawn again. */
  const attachRoads = (target: MapView) => {
    dropRoads(target);
    const layer = new AtlasRoadsLayer(target.resolution, Date.now, reduceMotion, worldSpan());
    layer.setNetwork(networkRoads);
    target.attachLayer(layer);
    roadsLayer = layer;
    const open = channelRoads();
    if (open?.state.status === 'ready') focusRoads(open.state.reply);
    const story = road();
    if (story?.state.status === 'ready') chooseRoad(story.state.reply, false);
    const journey = gateJourney;
    if (journey) {
      layer.setJourney(journey.way);
      layer.journeyStage(journey.stage);
    }
    setRoadStats({ ...layer.stats });
  };
  /** Take the roads layer off a map before the map goes, so each is destroyed once. */
  const dropRoads = (target: MapView | null) => {
    target?.attachLayer(null);
    roadsLayer?.dispose();
    roadsLayer = null;
  };

  const inkOf = (road: BusyRoad): InkRoad => ({ a: road.a, b: road.b, pa: road.pa, pb: road.pb, ra: road.ra, rb: road.rb, raids: road.raids, travellers: road.travellers, lastAt: road.lastAt });

  /** The busiest roads of the ledger, read with the map and again every few minutes; a failed read keeps what is drawn. */
  const readNetwork = (worldId: string, signal: AbortSignal) => {
    clearTimeout(networkTimer);
    fetchBusiest(SOURCE, worldId, signal).then((reply) => {
      if (signal.aborted) return;
      networkRoads = reply.roads.map(inkOf);
      roadsLayer?.setNetwork(networkRoads);
    }, (error: unknown) => {
      if (!signal.aborted && (error as Error).name !== 'AbortError') console.warn('Atlas roads could not be read', error);
    }).finally(() => {
      if (!signal.aborted) networkTimer = setTimeout(() => readNetwork(worldId, signal), NETWORK_REFRESH_MS);
    });
  };

  /** Draw every road of the open card's channel over the network, from its place on the map. */
  const focusRoads = (reply: ChannelRoads) => {
    const here = reply.position;
    if (!here) { roadsLayer?.setFocus(null); return; }
    roadsLayer?.setFocus({
      id: reply.channel.id,
      roads: reply.roads.flatMap(entry => (entry.position ? [{
        a: reply.channel.id, b: entry.other.id, pa: here, pb: entry.position, ra: reply.channel.region, rb: entry.other.region,
        raids: entry.sent + entry.received, travellers: entry.travellers, lastAt: entry.lastAt,
      }] : [])),
    });
  };

  /** Read the road ledger's roads of the channel whose card is open. A late reply for another card is dropped. */
  const readChannelRoads = (id: string) => {
    if (channelRoads()?.id === id) return;
    roadsController?.abort();
    const controller = new AbortController();
    roadsController = controller;
    const generation = cardGeneration;
    setChannelRoads({ id, state: { status: 'loading' } });
    fetchChannelRoads(SOURCE, loaded()!.world.id, id, controller.signal).then((reply) => {
      if (generation !== cardGeneration || controller.signal.aborted) return;
      setChannelRoads({ id, state: { status: 'ready', reply } });
      focusRoads(reply);
    }, (error: unknown) => {
      if (generation !== cardGeneration || (error as Error).name === 'AbortError') return;
      // The register's own roads stay on the card; the map draws only the network.
      setChannelRoads({ id, state: error instanceof DirectoryError && error.reason === 'not-found' ? { status: 'missing' } : { status: 'failed', reason: error instanceof DirectoryError ? error.reason : 'unavailable' } });
    });
  };

  /** The open card's roads, from the ledger, once read; until then (or if it cannot be read) the register's own. */
  const ledgerView = createMemo(() => {
    const open = channelRoads();
    const flag = selectedDab() ? register() : null;
    const shown = selected()?.id ?? waiting()?.id ?? (flag?.status === 'ready' ? flag.reply.channel.id : null);
    if (!open || open.state.status !== 'ready' || open.id !== shown) return null;
    const reply = open.state.reply;
    return <LedgerRoads reply={reply} onRoad={(entry) => openRoad({ a: { id: reply.channel.id }, b: { id: entry.other.id } })} />;
  });

  const restoreFocus = () => {
    const target = opener && opener.isConnected ? opener : host;
    opener = null;
    target?.focus({ preventScroll: true });
  };

  /** A card is opening: remember the view and the focus to return to, and give the map its provisional space. */
  const opening = (id: string, url = '/map') => {
    if (!history.isOpen) {
      const active = document.activeElement;
      opener = active instanceof HTMLElement && root?.contains(active) ? active : null;
    }
    history.opened(id, view?.cameraState() ?? { x: 0, y: 0, scale: 1 }, url);
    // The previous card's mark is no longer kept clear: the new estimate must not fly the map back to it.
    view?.revealPoint(null);
    view?.setCardInsets(cardInsets(null));
  };

  const onKey = (event: KeyboardEvent) => {
    if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) soundFor(event.target);
    // The open key is the top surface on a phone when no card is showing; the card handles its own Escape.
    if (event.key === 'Escape' && keyOpen() && !anyOpen()) {
      materialSound.play('shutter');
      setKeyOpen(false);
      root?.querySelector<HTMLButtonElement>('.atlas-key-toggle')?.focus({ preventScroll: true });
    }
  };

  const onPop = () => {
    if (history.popped()) return;
    // Forward onto a card's entry: reopen that card from its route.
    if (history.adopt()) void applyRoute(parseRoute(window.location.pathname), true);
  };

  const urlFor = (login: string | null | undefined) => (login ? formatRoute({ kind: 'channel', login }) : '/map');

  /**
   * Read the open card's register entry (its last stream and roads). A reply for a card that has since closed or
   * changed is dropped. A name the register supplies (a pencil flag's) puts the channel's route in the address bar.
   */
  const readRegister = (lookup: Lookup, cardId: string, fly = true) => {
    registerController?.abort();
    const controller = new AbortController();
    registerController = controller;
    const generation = cardGeneration;
    setRegister({ status: 'loading' });
    if ('id' in lookup) readChannelRoads(lookup.id);
    fetchCard(SOURCE, loaded()!.world.id, lookup, controller.signal).then((reply) => {
      if (generation !== cardGeneration) return;
      setRegister({ status: 'ready', reply });
      readChannelRoads(reply.channel.id);
      if (waiting()?.id === reply.channel.id && reply.position) {
        setWaitingPosition(reply.position);
        // A restored card keeps the saved camera; the flag is only kept clear of the card.
        if (fly) view?.flyTo(reply.position.x, reply.position.y, Math.max(view.cameraState().scale, DISTANCE_STOP.realm));
        view?.revealPoint(reply.position);
      }
      if (reply.channel.login && history.isOpen) history.opened(cardId, view?.cameraState() ?? { x: 0, y: 0, scale: 1 }, urlFor(reply.channel.login));
    }, (error: unknown) => {
      if (generation !== cardGeneration || (error as Error).name === 'AbortError') return;
      if (error instanceof DirectoryError && error.reason === 'not-found') setRegister({ status: 'missing' });
      else setRegister({ status: 'failed', reason: error instanceof DirectoryError ? error.reason : 'unavailable' });
    });
  };

  /** Choose a holding. `fly` (search, roads, routes) flies to the distance its mark is drawn at; a tap keeps the scale. */
  const choose = (settler: Settler | null, fly = false) => {
    if (mode() === 'gate') { if (settler) gateTap(settler.id); return; }
    if (!settler) {
      // A tap on bare paper closes an open card, as its button does.
      if (anyOpen()) closeCard();
      return;
    }
    clearCards();
    setSelected(settler);
    setKeyOpen(false);
    opening(settler.id, urlFor(settler.login));
    readRegister({ id: settler.id }, settler.id);
    if (fly && view) {
      view.select(settler);
      view.flyTo(settler.x, settler.y, Math.max(view.cameraState().scale, TIER_STOP[settler.tierRank] ?? DISTANCE_STOP.kingdom));
    } else {
      view?.select(settler, true);
    }
  };

  // The hand-off carries only the currently served public projection.
  const [entering, setEntering] = createSignal<DoorHolding | null>(null);
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  const enter = (holding: DoorHolding) => {
    if (entering()) return;
    handOffHolding(sessionStore(), holding);
    setEntering(holding);
    const settler = selected();
    if (view && settler) view.flyTo(settler.x, settler.y, MAX_SCALE);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    enterTimer = setTimeout(() => location.assign(`/kingdom/${encodeURIComponent(holding.id)}`), reduce ? 60 : 720);
  };
  onCleanup(() => clearTimeout(enterTimer));
  const onShow = (event: PageTransitionEvent) => { if (event.persisted) setEntering(null); };
  window.addEventListener('pageshow', onShow);
  onCleanup(() => window.removeEventListener('pageshow', onShow));

  /** Choose a pencil flag and read its public register entry. */
  const chooseDab = (dab: Dab, fly = false, face?: ChannelFace) => {
    if (mode() === 'gate') { gateTapDab(dab.hash); return; }
    clearCards();
    setSelectedDab(dab);
    setKeyOpen(false);
    const id = `dab:${dab.hash}`;
    opening(id, urlFor(face?.login));
    readRegister(face ? { id: face.id } : { dab: dab.hash }, id);
    if (fly && view) view.flyTo(dab.x, dab.y, Math.max(view.cameraState().scale, DISTANCE_STOP.realm));
    else if (dab.placed) view?.revealPoint(dab);
  };

  /** A named channel without land: its card and stable pencil point, when the register supplies one. */
  const openWaiting = (face: ChannelFace, position?: PencilPosition, fly = true) => {
    clearCards();
    setWaiting(face);
    setWaitingPosition(position ?? null);
    setKeyOpen(false);
    const id = `waiting:${face.id}`;
    opening(id, urlFor(face.login));
    readRegister({ id: face.id }, id, fly);
    const realm = geo()?.realms[face.realm ?? -1];
    if (!fly) {
      if (position) view?.revealPoint(position);
    } else if (position && view) {
      view.flyTo(position.x, position.y, Math.max(view.cameraState().scale, DISTANCE_STOP.realm));
      view.revealPoint(position);
    } else if (realm && view) view.flyTo(realm.x, realm.y, Math.max(view.cameraState().scale, DISTANCE_STOP.continent));
  };

  /** Where a face is drawn now: its holding (loading its region first), its pencil flag while live, or nowhere. */
  const locate = async (face: ChannelFace): Promise<{ settler: Settler } | { dab: Dab } | null> => {
    const holdings = store;
    if (!holdings || face.place === 'unseen') return null;
    if (face.place === 'mapped' && face.region !== null) {
      if (!holdings.byId.has(face.id) && !holdings.hasRegion(face.region)) await loadChunk(face.region).catch(() => undefined);
      const settler = holdings.byId.get(face.id);
      if (settler && !settler.withheld) return { settler };
      return null;
    }
    if (face.region !== null && !holdings.hasRegion(face.region)) await loadChunk(face.region).catch(() => undefined);
    const hash = dabHashOf(face.id);
    const dab = paint?.dabs.find((candidate) => candidate.hash === hash && candidate.placed);
    return dab ? { dab } : null;
  };

  /**
   * Open any channel the register named (a search result, a road's end, a route): its holding, its flag, or its
   * waiting card. `fly` false (a restored view) opens it where the map already stands. Resolves whether a card opened.
   */
  const openFace = async (face: ChannelFace, position?: PencilPosition, fly = true, signal?: AbortSignal): Promise<boolean> => {
    const generation = ++cardGeneration;
    const place = await locate(face);
    if (generation !== cardGeneration || signal?.aborted) return false;
    if (place && 'settler' in place) { choose(place.settler, fly); return true; }
    if (place && 'dab' in place) { chooseDab(place.dab, fly, face); return true; }
    if (face.place === 'waiting') { openWaiting(face, position, fly); return true; }
    // A holding the map no longer draws (withheld since the register answered) has no card to open.
    setNotice({ text: 'That channel is no longer drawn on this map.' });
    return false;
  };

  const openSearchResult = (result: SearchResult) => {
    if (mode() !== 'hero' && visible()) materialSound.play('wax');
    void openFace(result.channel, result.position);
  };

  /** Whether a search result is on air in the frame shown now (its holding's class, or its pencil flag). */
  const onAirResult = (result: SearchResult): boolean => {
    void liveTick();
    if (!paint?.frame) return false;
    if (result.channel.ordinal !== null) return paint.classAt(result.channel.ordinal) > 0 && !store?.byId.get(result.channel.id)?.withheld;
    const hash = dabHashOf(result.channel.id);
    return paint.dabs.some((dab) => dab.hash === hash);
  };

  const roadUrl = (reply: { a: { login: string | null }; b: { login: string | null } } | null, ask: RoadAsk) => {
    const a = reply?.a.login ?? ('login' in ask.a ? ask.a.login : null);
    const b = reply?.b.login ?? ('login' in ask.b ? ask.b.login : null);
    return a && b ? formatRoute({ kind: 'road', a, b }) : '/map';
  };

  /** Open the road between two channels: its card, both ends inked and framed on the map when both are drawn. */
  const openRoad = (ask: RoadAsk) => {
    clearCards();
    setKeyOpen(false);
    const id = `road:${JSON.stringify(ask)}`;
    setRoad({ ask, state: { status: 'loading' } });
    opening(id, roadUrl(null, ask));
    const controller = new AbortController();
    registerController = controller;
    const generation = cardGeneration;
    fetchRoadStory(SOURCE, loaded()!.world.id, ask.a, ask.b, controller.signal).then((reply) => {
      if (generation !== cardGeneration) return;
      setRoad({ ask, state: { status: 'ready', reply } });
      if (history.isOpen) history.opened(id, view?.cameraState() ?? { x: 0, y: 0, scale: 1 }, roadUrl(reply, ask));
      chooseRoad(reply, true);
    }, (error: unknown) => {
      if (generation !== cardGeneration || (error as Error).name === 'AbortError') return;
      setRoad({ ask, state: error instanceof DirectoryError && error.reason === 'not-found' ? { status: 'missing' } : { status: 'failed', reason: error instanceof DirectoryError ? error.reason : 'unavailable' } });
    });
  };

  /**
   * Ink a road card's road over the others and frame both ends. A road with no witnessed raid is only framed: the
   * Atlas never draws a road it has not seen. An end without land stands at that channel's pencil place.
   */
  function chooseRoad(reply: RoadStory, frame: boolean): void {
    const { pa, pb } = reply;
    const raids = (reply.aToB?.raids ?? 0) + (reply.bToA?.raids ?? 0);
    if (pa && pb && reply.basis !== 'none' && raids > 0 && reply.lastAt !== null && roadsLayer) {
      roadsLayer.setChosen({
        a: reply.a.id, b: reply.b.id, pa, pb, ra: reply.a.region, rb: reply.b.region, raids,
        travellers: (reply.aToB?.travellers ?? 0) + (reply.bToA?.travellers ?? 0), lastAt: reply.lastAt,
      });
    } else {
      roadsLayer?.setChosen(null);
    }
    if (!frame || !view) return;
    if (pa && pb) view.frameRoad({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y });
    else if (pa ?? pb) view.flyTo((pa ?? pb)!.x, (pa ?? pb)!.y, Math.max(view.cameraState().scale, DISTANCE_STOP.realm));
  }

  const openCardRoad = (from: ChannelFace | Settler, road: CardRoad) => openRoad({ a: { id: from.id }, b: { id: road.other.id } });

  /**
   * Open what a route names, once the map is drawn. `adopted` means the route's history entry already exists (a reload
   * or Forward), so the card takes it over rather than pushing another. A route that names nothing on this map says so
   * and leaves the map at its usual view with the address back at `/map`.
   */
  const applyRoute = async (route: AtlasRoute, adopted: boolean): Promise<void> => {
    const drop = (text: string, action?: NoticeState['action']) => {
      if (adopted) history.closed();
      else if (ownsUrl) window.history.replaceState(window.history.state, '', '/map');
      setNotice(action ? { text, action } : { text });
    };
    if (route.kind === 'map') {
      if (adopted) history.closed();
      return;
    }
    if (route.kind === 'channel') {
      try {
        const reply = await fetchCard(SOURCE, loaded()!.world.id, { login: route.login }, controller?.signal);
        await openFace(reply.channel, reply.position);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (error instanceof DirectoryError && error.reason === 'not-found') {
          drop(`“${route.login}” is not on the map yet.`, {
            label: 'Look on Twitch',
            run: () => { const url = watchUrl(route.login); if (url) window.open(url, '_blank', 'noopener,noreferrer'); },
          });
        } else {
          drop(`The register could not be read, so ${route.login}’s card did not open.`, { label: 'Try again', run: () => { setNotice(null); void applyRoute(route, false); } });
        }
      }
      return;
    }
    if (route.kind === 'road') return openRoad({ a: { login: route.a }, b: { login: route.b } });
    if (route.kind === 'line') return drop('Train lines are drawn once raid trains are surveyed; until then the map opens at its usual view.');
    if (route.kind === 'season') return drop('Seasons begin with the first founded edition; until then the map opens at its usual view.');
    drop('That address is not a place on this map, so it opens at its usual view.');
  };

  const closeCard = () => {
    clearCards();
    view?.setCardInsets(null);
    history.closed();
    restoreFocus();
  };

  // The open card's measured box keeps the chosen mark clear of it while it opens, grows and shrinks.
  createEffect(() => {
    const open = anyOpen();
    void phone();
    cardObserver?.disconnect();
    cardObserver = null;
    cardMeasure?.();
    cardMeasure = null;
    if (!open || !root) return;
    queueMicrotask(() => {
      const card = root?.querySelector('.atlas-card');
      if (disposed || !card || !anyOpen()) return;
      const measureCard = () => {
        if (anyOpen()) view?.setCardInsets(cardInsets(card));
      };
      measureCard();
      cardObserver = new ResizeObserver(measureCard);
      cardObserver.observe(card);
      // The phone sheet rises 24 px as it opens, and a transform moves no ResizeObserver: measure it again once it rests.
      card.addEventListener('animationend', measureCard);
      cardMeasure = () => card.removeEventListener('animationend', measureCard);
    });
  });

  /** Names changed under the open map (the view redraws on the store's version): follow them on the card, and drop a withheld selection. */
  const namesChanged = () => {
    setNamesTick(namesTick() + 1);
    if (selected()?.withheld) closeCard();
  };

  /** Drop each name the moment it goes stale, even if the service cannot be reached to say so. */
  const scheduleExpiry = (target: SettlerStore) => {
    clearTimeout(expiryTimer);
    const next = target.expireNames();
    if (Number.isFinite(next)) expiryTimer = setTimeout(() => {
      if (store !== target) return;
      scheduleExpiry(target);
      namesChanged();
    }, Math.min(2_147_000_000, Math.max(1_000, next - Date.now() + 50)));
  };

  /** Read the names projection; a failure keeps the names already held (they still expire on time). */
  async function readNames(target: SettlerStore, worldId: string, signal: AbortSignal): Promise<void> {
    clearTimeout(namesTimer);
    try {
      target.applyNames(await fetchNames(SOURCE, { id: worldId }, signal));
      if (signal.aborted || store !== target) return;
      setNames('ready');
      if (notice()?.text.startsWith('Channel names')) setNotice(null);
    } catch (error) {
      if (signal.aborted || (error as Error).name === 'AbortError' || store !== target) return;
      if (!target.named) {
        setNames('failed');
        setNotice({ text: 'Channel names could not be read. The land and each channel’s arms are drawn; names return when the Atlas service answers.' });
      }
    }
    scheduleExpiry(target);
    namesChanged();
    namesTimer = setTimeout(() => void readNames(target, worldId, signal), NAMES_REFRESH_MS);
  }

  const stopLive = () => {
    feed?.dispose();
    feed = null;
    paint = null;
    clearInterval(evidenceTimer);
    setLive(null);
  };

  /**
   * The live layer of this survey: the feed's last coherent frame painted over the land (or the still). A refused
   * or failed read keeps what is drawn and its own observation time; a held view stops blooming at that time (R11).
   */
  const startLive = (preview: LoadedPreview, settlers: SettlerStore, rings: Ring[], settled: () => void) => {
    stopLive();
    let held: number | null = null;
    const livePaint = new LivePaint(preview.world, settlers, rings, Date.now, reduceMotion, () => held);
    const liveFeed = new LiveFeed(SOURCE, preview.world, preview.pointer.world.sha256, (frame, status: LiveStatus) => {
      if (feed !== liveFeed) return;
      held = frame && status.freshness !== 'fresh' ? frame.asOf : null;
      if (frame && frame !== livePaint.frame) {
        livePaint.apply(frame);
        setLiveTick(liveTick() + 1);
        const dab = selectedDab();
        if (dab) {
          const next = livePaint.dabs.find((candidate) => candidate.hash === dab.hash) ?? null;
          const known = register();
          // A named flag whose stream ended keeps its card, now as a channel waiting off the air.
          if (!next && known.status === 'ready') batch(() => {
            setSelectedDab(null);
            setWaiting(known.reply.channel);
            setWaitingPosition(known.reply.position ?? (dab.placed ? { x: dab.x, y: dab.y } : null));
          });
          else if (!next) closeCard();
          else setSelectedDab(next);
        }
      }
      setLive({ status, holdings: livePaint.liveCount, dabs: livePaint.dabs.length });
      if (frame || status.refused || status.source) settled();
    }, { onRaid: (raid) => { if (feed === liveFeed) rideCaravan(raid); } });
    feed = liveFeed;
    paint = livePaint;
    view?.setLive(livePaint);
    liveFeed.start();
    // Freshness turns stale with time alone, so the seal is re-judged even when nothing arrives.
    evidenceTimer = setInterval(() => {
      if (feed !== liveFeed) return;
      const status = liveFeed.status();
      held = liveFeed.current() && status.freshness !== 'fresh' ? liveFeed.current()!.asOf : null;
      setLive({ status, holdings: livePaint.liveCount, dabs: livePaint.dabs.length });
      if (view) setDrawnLive(view.liveDrawn());
      if (roadsLayer) setRoadStats({ ...roadsLayer.stats });
    }, 5_000);
  };

  /** Raids that have ridden on this page: a caravan rides once, through a redrawn map and whatever the stream repeats. */
  const riddenRaids = new Set<string>();
  /** A gate waiting for the caravan of the raid its party set out on. */
  let pendingFollow: { raid: AtlasRaid; until: number; signal: AbortSignal } | null = null;

  /** Where a channel stands on this map now: the event's own place, its holding, or its pencil flag while live. */
  const placeOf = (face: ChannelFace, given: MapPoint | null): MapPoint | null => {
    if (given) return given;
    const settler = store?.byId.get(face.id);
    if (settler && !settler.withheld) return { x: settler.x, y: settler.y };
    const hash = dabHashOf(face.id);
    const dab = paint?.dabs.find((candidate) => candidate.hash === hash && candidate.placed);
    return dab ? { x: dab.x, y: dab.y } : null;
  };

  /**
   * A fresh raid from the public stream rides once as the caravan, with its source's banner and its travellers. The
   * stream never repeats an old raid to a new page, so nothing is replayed after a reload.
   */
  const rideCaravan = (raid: CaravanRaid) => {
    if (riddenRaids.has(raid.id) || !roadsLayer) return;
    const pa = placeOf(raid.a, raid.pa);
    const pb = placeOf(raid.b, raid.pb);
    if (!pa || !pb) return;
    riddenRaids.add(raid.id);
    roadsLayer.ride({ id: raid.id, from: raid.from, to: raid.to, viewers: raid.viewers, at: raid.at, pa, pb, ra: raid.ra, rb: raid.rb });
    setRoadStats({ ...roadsLayer.stats });
    if (pendingFollow && !pendingFollow.signal.aborted && Date.now() <= pendingFollow.until) {
      if (followCaravan(pendingFollow.raid)) pendingFollow = null;
    }
  };

  /** Keep a witnessed raid's caravan in front and frame its road. False while the stream has not announced it. */
  const followCaravan = (raid: AtlasRaid): boolean => {
    const caravan = roadsLayer?.caravanFor({ id: raid.id, from: raid.fromKingdomId, to: raid.toKingdomId, at: raid.observedAt });
    if (!caravan || !roadsLayer) return false;
    roadsLayer.follow(caravan.id);
    view?.frameRoad({ ax: caravan.pa.x, ay: caravan.pa.y, bx: caravan.pb.x, by: caravan.pb.y }, DISTANCE_STOP.realm);
    return true;
  };

  async function start(): Promise<void> {
    stopLive();
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    clearTimeout(namesTimer);
    clearTimeout(expiryTimer);
    clearTimeout(liveWait);
    rebuild = null;
    setState('loading');
    setNames('loading');
    try {
      let still = noWebgl;
      const [preview] = await Promise.all([loadPreview(SOURCE, sessionStore(), signal), loadFaces(signal).catch(error => console.error('Atlas lettering could not load', error))]);
      if (signal.aborted) return;
      const world = labelWorld(preview.world);
      const holdings = new SettlerStore(world);
      store = holdings;
      const geography = geographyOf(world);
      // Together, so nothing draws the new revision with the old holdings (the still is made once per store).
      batch(() => {
        setLoaded({ ...preview, world });
        setSettlers(holdings);
        setGeo(geography);
      });
      // A saved view is honoured once, and only by the revision it was taken on.
      const resumed = savedView(startView, world.id);
      startView = null;
      // Names travel beside the land: the first view waits for both (or for the names to fail on their own).
      let mapDrawn = false;
      let namesSettled = false;
      // The first view also waits briefly for the live paint, so it does not arrive as a flash after the reveal.
      let liveSettled = false;
      const reveal = () => {
        if (!mapDrawn || !namesSettled || !liveSettled || signal.aborted) return;
        setState(still ? 'still' : 'ready');
        if (!still) backdropTimer = setTimeout(() => setBackdrop(false), reduceMotion() ? 0 : 450);
        settle();
        // The route the page was opened on (a shared link, a reload on a card) opens once the map is there to show it.
        const route = pendingRoute;
        pendingRoute = null;
        // The host may have settled its size since the map was made; the saved view is placed again, exactly, while
        // the still still covers it.
        if (resumed) view?.setCamera(resumed.camera);
        if (route) void applyRoute(route.route, route.adopted);
        else if (resumed?.selected && mode() === 'explore') void openSaved(resumed.selected, signal);
        else if (!resumed && props.options.focus) void flyTo(props.options.focus, { openCard: mode() === 'explore' });
      };
      void readNames(holdings, world.id, signal).then(() => {
        namesSettled = true;
        reveal();
      });
      const liveIn = () => {
        if (liveSettled) return;
        liveSettled = true;
        reveal();
      };
      dropRoads(view);
      view?.dispose();
      view = null;
      networkRoads = [];
      readNetwork(world.id, signal);
      loadChunk = async (region) => {
        holdings.addChunk(await fetchChunk(SOURCE, world, region, signal));
        paint?.regionLoaded(region);
      };
      if (still) {
        // Without WebGL the Still draws this same revision; it calls `stillReady` once composed.
        stillReady = () => {
          mapDrawn = true;
          reveal();
        };
        liveWait = setTimeout(liveIn, LIVE_WAIT_MS);
        startLive(preview, holdings, decodeRings(world), liveIn);
        if (preview.newer) noticeNewer(preview);
        return;
      }
      if (!host) return;
      const mount = async (initial: CameraState | null) => MapView.create(host!, {
        world,
        geo: geography,
        store: holdings,
        loadChunk,
      }, {
        ready: () => {
          mapDrawn = true;
          reveal();
          if (view) setDrawnLive(view.liveDrawn());
        },
        select: choose,
        selectDab: chooseDab,
        camera: (camera) => {
          setScale(camera.scale);
          setMinScale(camera.minScale);
          setDistance(camera.distance);
        },
        chunkFailed: (region) => {
          const name = world.regions[region]?.name ?? 'one land';
          setNotice({ text: `The towns and villages of ${name} could not be read. The land and its cities are still drawn.` });
        },
        tilesFailed: (count) => {
          if (count > 0) setNotice({ text: 'Part of the land could not be inked; the coarser drawing stays in its place.', action: { label: 'Ink it again', run: () => { setNotice(null); view?.retryTiles(); } } });
          else if (notice()?.text.startsWith('Part of the land')) setNotice(null);
        },
        context: (next) => {
          if (next === 'lost') setContext('lost');
          else if (next === 'restored') setContext('ok');
          else if (view) void rebuild?.(view.cameraState());
        },
      }, chromeInsets, initial, { interactive: mode() !== 'hero', wheel: activated(), hero: mode() === 'hero', signal });
      const mounted = await mountAtlasWithRetry(() => mount(resumed?.camera ?? null), error => console.error('Atlas renderer could not mount', error));
      if (signal.aborted) { mounted?.dispose(); return; }
      view = mounted;
      if (view) attachRoads(view);
      view?.setPaused(!inViewport || document.hidden);
      if (!view) {
        if (signal.aborted) return;
        still = true;
        stillReady = () => { mapDrawn = true; reveal(); };
        setContext('ok');
        setState('still');
        liveWait = setTimeout(liveIn, LIVE_WAIT_MS);
        startLive(preview, holdings, decodeRings(world), liveIn);
        if (preview.newer) noticeNewer(preview);
        return;
      }
      if (signal.aborted) {
        view.dispose();
        view = null;
        return;
      }
      // The context did not come back: draw the map again on a new canvas from the same view and selection.
      rebuild = async (camera) => {
        const old = view;
        view = null;
        dropRoads(old);
        old?.dispose();
        let next: MapView;
        try {
          next = await mount(camera);
        } catch (error) {
          console.error('Atlas renderer could not rebuild', error);
          if (signal.aborted) return;
          // No new context either: the still draws this same revision, with the open card kept.
          rebuild = null;
          stillReady = () => undefined;
          setContext('ok');
          setState('still');
          return;
        }
        if (signal.aborted) return next.dispose();
        view = next;
        attachRoads(next);
        next.setPaused(!inViewport || document.hidden);
        if (paint) next.setLive(paint);
        // Read after the wait: Back may have closed the card meanwhile.
        const chosen = selected();
        next.select(chosen);
        if (anyOpen()) next.setCardInsets(cardInsets(root?.querySelector('.atlas-card') ?? null));
        setContext('ok');
      };
      liveWait = setTimeout(liveIn, LIVE_WAIT_MS);
      startLive(preview, holdings, view.rings, liveIn);
      if (preview.newer) noticeNewer(preview);
    } catch (error) {
      if (signal.aborted || (error as Error).name === 'AbortError') return;
      console.error('Atlas could not open', error);
      setState(atlasFailureState(error));
      settle();
    }
  }

  let stillReady: () => void = () => undefined;

  const noticeNewer = (preview: LoadedPreview) => {
    if (!preview.newer) return;
    setNotice({ text: `A newer survey is ready (observed to ${formatMoment(preview.newer.asOf)}).`, action: { label: 'Open it', run: adoptNewer } });
  };

  const pause = () => {
    const paused = !inViewport || document.hidden;
    setVisible(!paused);
    materialSound.setMuted(paused || mode() === 'hero' || muted());
    view?.setPaused(paused);
  };
  /** The channel whose card is open: a holding, a waiting channel, or the channel a pencil flag's register named. */
  const openChannel = (): string | null => {
    const flag = selectedDab() ? register() : null;
    return selected()?.id ?? waiting()?.id ?? (flag?.status === 'ready' ? flag.reply.channel.id : null);
  };
  const currentView = () => ({ ...(view?.cameraState() ?? { x: 0, y: 0, scale: 1 }), selected: openChannel(), mapId: loaded()?.world.id ?? '' });
  /** Only the page's newest restore or flight may still open a card or move the map. */
  const hostRequests = new LatestRequest();
  /**
   * Open a saved view's card where the map stands, unless a newer request began or a card opened or closed meanwhile
   * (the person acted since): a late reply never reopens an earlier selection.
   */
  const openSaved = async (id: string, signal: AbortSignal): Promise<boolean> => {
    const cards = cardGeneration;
    try {
      const reply = await fetchCard(SOURCE, loaded()!.world.id, { id }, signal);
      if (signal.aborted || disposed || cards !== cardGeneration) return false;
      return await openFace(reply.channel, reply.position, false, signal);
    } catch { return false; }
  };
  const restore = async (target: AtlasView, options?: { signal?: AbortSignal }): Promise<boolean> => {
    if (disposed || !loaded() || !controller || options?.signal?.aborted) return false;
    const saved = savedView(target, loaded()!.world.id);
    if (!saved) return false;
    const signal = hostRequests.begin(controller.signal, options?.signal);
    view?.setCamera(saved.camera);
    if (mode() !== 'explore') return true;
    if (!saved.selected) {
      if (anyOpen()) closeCard();
      return true;
    }
    if (openChannel() === saved.selected) return true;
    return openSaved(saved.selected, signal);
  };
  const flyTo = async (target: AtlasTarget, options?: { openCard?: boolean; signal?: AbortSignal }): Promise<boolean> => {
    if (disposed || !loaded() || !controller || options?.signal?.aborted) return false;
    const signal = hostRequests.begin(controller.signal, options?.signal);
    const cards = cardGeneration;
    try {
      const reply = await fetchCard(SOURCE, loaded()!.world.id, 'login' in target ? { login: target.login } : { id: target.channelId }, signal);
      if (signal.aborted || disposed) return false;
      if (options?.openCard !== false && mode() === 'explore') {
        // A card the person opened or closed while the register answered stays as they left it.
        if (cards !== cardGeneration) return false;
        if (!await openFace(reply.channel, reply.position, true, signal)) return false;
      }
      else {
        const place = await locate(reply.channel);
        if (signal.aborted || disposed) return false;
        const point = place ? ('settler' in place ? place.settler : place.dab) : reply.position ?? geo()?.realms[reply.channel.realm ?? -1];
        if (!point) return false;
        view?.flyTo(point.x, point.y, DISTANCE_STOP.realm);
      }
      if (!view) return true;
      return await new Promise<boolean>(resolve => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = () => { clearTimeout(timer); pendingFlights.delete(finish); signal.removeEventListener('abort', finish); resolve(!disposed && !signal.aborted); };
        const poll = () => {
          if (disposed || signal.aborted || !view?.stats().flying) return finish();
          timer = setTimeout(poll, 32);
        };
        pendingFlights.add(finish);
        signal.addEventListener('abort', finish, { once: true });
        timer = setTimeout(poll, 32);
      });
    } catch { return false; }
  };

  // ---- Gate mode (Raid Gate SEAMS §2): the finder, the pick, the journey and the witnessed caravan. Presentation only.
  let gateController: AbortController | null = null;
  let searchController: AbortController | null = null;
  let followTimer: ReturnType<typeof setTimeout> | undefined;
  /** The way the gate is presenting: drawn again on a rebuilt map at the stage it had reached. */
  let gateJourney: { way: { from: string; to: string; pa: MapPoint; pb: MapPoint; ra: number | null; rb: number | null }; stage: JourneyStage } | null = null;

  const finderEntries = (): FinderEntry[] => {
    const all: FinderEntry[] = [];
    for (const state of [finder(), finderSearch()]) if (state.status === 'ready') for (const group of state.reply.groups) all.push(...group.entries);
    return all;
  };
  const finderFrom = (): FinderReply['from'] | null => {
    const state = finder();
    return state.status === 'ready' ? state.reply.from : null;
  };

  /** The channel as raid-show's contract carries it. The Atlas knows no founded kingdom or classification yet. */
  const gateChannel = (face: ChannelFace, language: string | null): AtlasChannel | null => {
    const parsed = AtlasChannelSchema.safeParse({
      kingdomId: face.id, login: face.login, displayName: face.name, language: language && language.length > 0 ? language.slice(0, 16) : 'other',
      founded: false, kingdomName: null, contentClassification: 'unknown',
    });
    return parsed.success ? parsed.data : null;
  };

  const setWay = (way: NonNullable<typeof gateJourney>['way'] | null, stage: JourneyStage = 'pencil') => {
    gateJourney = way ? { way, stage } : null;
    roadsLayer?.setJourney(way);
    if (way) roadsLayer?.journeyStage(stage);
  };
  const wayTo = (entry: FinderEntry): NonNullable<typeof gateJourney>['way'] | null => {
    const from = finderFrom();
    const pa = from ? placeOf(from.channel, from.position) : null;
    const pb = placeOf(entry.channel, entry.position);
    return from && pa && pb ? { from: from.channel.id, to: entry.channel.id, pa, pb, ra: from.channel.region, rb: entry.channel.region } : null;
  };

  /** The monarch chose a live channel on the board or the map: tell the Raid Gate, pencil the way and frame it. */
  const gatePick = (entry: FinderEntry) => {
    if (!selectable(entry) || !gateFrom()) return;
    const channel = gateChannel(entry.channel, entry.language);
    if (!channel) return;
    if (visible()) materialSound.play('wax');
    setPicked(entry.channel.id);
    const way = wayTo(entry);
    setWay(way);
    if (way && view) view.frameRoad({ ax: way.pa.x, ay: way.pa.y, bx: way.pb.x, by: way.pb.y }, DISTANCE_STOP.realm);
    const settler = store?.byId.get(entry.channel.id);
    view?.select(settler && !settler.withheld ? settler : null);
    props.gateEmit({ kind: 'target', channel, land: entry.land });
  };
  /** Hovering a row pencils the way to it until something is picked. */
  const gatePreview = (entry: FinderEntry | null) => {
    if (picked()) return;
    setWay(entry ? wayTo(entry) : null);
  };
  /** A tap on the map picks a live channel the board proposes or found; anything else on the map is only land. */
  const gateTap = (id: string) => {
    const entry = finderEntries().find(candidate => candidate.channel.id === id);
    if (entry && selectable(entry)) gatePick(entry);
  };
  const gateTapDab = (hash: string) => {
    const entry = finderEntries().find(candidate => dabHashOf(candidate.channel.id) === hash);
    if (entry && selectable(entry)) gatePick(entry);
  };

  const readFinder = (from: string, signal: AbortSignal) => {
    setFinder({ status: 'loading' });
    fetchFinder(SOURCE, loaded()!.world.id, from, null, signal).then((reply) => {
      if (signal.aborted) return;
      setFinder({ status: 'ready', reply });
      const source = placeOf(reply.from.channel, reply.from.position);
      const settler = store?.byId.get(from);
      const held = settler && !settler.withheld ? settler : null;
      view?.select(held);
      setGateSource(!held && source ? { ...source, name: faceName(reply.from.channel) } : null);
      if (source && view && !picked()) view.flyTo(source.x, source.y, Math.max(view.cameraState().scale, DISTANCE_STOP.continent));
    }, (error: unknown) => {
      if (signal.aborted || (error as Error).name === 'AbortError') return;
      setFinder({ status: 'failed', reason: error instanceof DirectoryError ? error.reason : 'unavailable' });
    });
    // The source's own roads are drawn while the board is open: the first proposals run along them.
    fetchChannelRoads(SOURCE, loaded()!.world.id, from, signal).then((reply) => {
      if (signal.aborted) return;
      setGateRoads({ total: reply.total, since: reply.since });
      focusRoads(reply);
    }, () => undefined);
  };

  const gateSearch = (query: string) => {
    searchController?.abort();
    const from = gateFrom();
    if (!query || !from || !gateController) { setFinderSearch({ status: 'idle' }); return; }
    const controller = new AbortController();
    searchController = controller;
    const signal = AbortSignal.any([controller.signal, gateController.signal]);
    setFinderSearch({ status: 'loading' });
    fetchFinder(SOURCE, loaded()!.world.id, from, query, signal).then((reply) => {
      if (!signal.aborted) setFinderSearch({ status: 'ready', reply });
    }, (error: unknown) => {
      if (signal.aborted || (error as Error).name === 'AbortError') return;
      setFinderSearch({ status: 'failed', reason: error instanceof DirectoryError ? error.reason : 'unavailable' });
    });
  };

  /** Fold the board away: the map keeps standing where it is, with only the network drawn. */
  const closeGateBoard = () => {
    gateController?.abort();
    gateController = null;
    searchController?.abort();
    searchController = null;
    clearTimeout(followTimer);
    pendingFollow = null;
    batch(() => {
      setGateFrom(null);
      setFinder({ status: 'idle' });
      setFinderSearch({ status: 'idle' });
      setPicked(null);
      setGateRoads(null);
      setGateSource(null);
    });
    setWay(null);
    roadsLayer?.setFocus(null);
    roadsLayer?.follow(null);
    view?.select(null);
  };

  /** Find a channel's place for a journey the gate names by ID (a reload mid-journey has no board to read it from). */
  const placeById = async (id: string, signal: AbortSignal): Promise<{ face: ChannelFace; point: MapPoint } | null> => {
    const known = finderEntries().find(entry => entry.channel.id === id) ?? null;
    const from = finderFrom();
    if (known) { const point = placeOf(known.channel, known.position); if (point) return { face: known.channel, point }; }
    if (from?.channel.id === id) { const point = placeOf(from.channel, from.position); if (point) return { face: from.channel, point }; }
    try {
      const reply = await fetchCard(SOURCE, loaded()!.world.id, { id }, signal);
      const point = placeOf(reply.channel, reply.position ?? null);
      return point ? { face: reply.channel, point } : null;
    } catch { return null; }
  };

  const STAGE: Record<AtlasTravelStage['kind'], JourneyStage> = { rise: 'rise', road: 'road', drawing: 'drawing', arrived: 'arrived', back: 'back' };
  let travelTurn = 0;
  const travel = async (stage: AtlasTravelStage, signal: AbortSignal) => {
    const turn = ++travelTurn;
    const [a, b] = stage.kind === 'back' ? [stage.to, stage.from] : [stage.from, stage.to];
    let way = gateJourney?.way ?? null;
    if (!way || !((way.from === a && way.to === b) || (way.from === b && way.to === a))) {
      const [pa, pb] = await Promise.all([placeById(a, signal), placeById(b, signal)]);
      if (signal.aborted || disposed || turn !== travelTurn || !pa || !pb) return;
      way = { from: a, to: b, pa: pa.point, pb: pb.point, ra: pa.face.region, rb: pb.face.region };
      setWay(way);
    }
    gateJourney = { way, stage: STAGE[stage.kind] };
    roadsLayer?.journeyStage(STAGE[stage.kind]);
    if (!view) return;
    const source = way.from === stage.from ? way.pa : way.pb;
    const destination = way.from === stage.from ? way.pb : way.pa;
    const ends = { ax: way.pa.x, ay: way.pa.y, bx: way.pb.x, by: way.pb.y };
    // The camera rises from the source, opens out over the road while it is drawn, then comes down at the gate.
    if (stage.kind === 'rise') view.flyTo(source.x, source.y, DISTANCE_STOP.continent);
    else if (stage.kind === 'road' || stage.kind === 'back') view.frameRoad(ends, DISTANCE_STOP.realm);
    else view.flyTo(destination.x, destination.y, Math.max(DISTANCE_STOP.realm, Math.min(view.cameraState().scale * 2.2, DISTANCE_STOP.kingdom)));
  };

  const gate: AtlasSceneGate = {
    open: (from: KingdomId, signal: AbortSignal) => {
      if (disposed || signal.aborted || !loaded()) return;
      closeGateBoard();
      const controller = new AbortController();
      gateController = controller;
      // The host's signal ends this opening only: the host asked, so the board folds without saying it closed.
      signal.addEventListener('abort', () => { if (gateController === controller) closeGateBoard(); }, { once: true });
      setGateFrom(from);
      readFinder(from, controller.signal);
    },
    close: () => closeGateBoard(),
    resolve: async (kingdomId: KingdomId, signal: AbortSignal) => {
      if (disposed || !loaded()) return null;
      const known = finderEntries().find(entry => entry.channel.id === kingdomId);
      if (known) { const channel = gateChannel(known.channel, known.language); return channel ? { channel, land: known.land } : null; }
      try {
        const reply = await fetchCard(SOURCE, loaded()!.world.id, { id: kingdomId }, signal);
        const channel = gateChannel(reply.channel, reply.language);
        if (!channel) return null;
        return { channel, land: reply.channel.place === 'unseen' || !placeOf(reply.channel, reply.position ?? null) ? 'edge' as const : 'waiting' as const };
      } catch { return null; }
    },
    follow: (raid: AtlasRaid, signal: AbortSignal) => {
      if (disposed || signal.aborted) return;
      clearTimeout(followTimer);
      pendingFollow = null;
      const release = () => { clearTimeout(followTimer); pendingFollow = null; roadsLayer?.follow(null); };
      signal.addEventListener('abort', release, { once: true });
      if (followCaravan(raid)) return;
      // The stream may announce the raid a moment after the authority saw it: wait for its caravan a while.
      pendingFollow = { raid, until: Date.now() + FOLLOW_WAIT_MS, signal };
      followTimer = setTimeout(() => { if (pendingFollow?.raid === raid) pendingFollow = null; }, FOLLOW_WAIT_MS);
    },
    travel: (stage: AtlasTravelStage, signal: AbortSignal) => {
      if (disposed || signal.aborted || !loaded()) return;
      void travel(stage, signal);
    },
  };

  props.attach({ view: currentView, flyTo, restore, gate, setMode: next => {
    if (disposed) return;
    if (next === 'hero') { clearCards(); setKeyOpen(false); setActivated(false); }
    setMode(next);
    materialSound.setMuted(next === 'hero' || !visible() || muted());
    view?.setHero(next === 'hero');
    view?.setInteraction(next !== 'hero', ownsUrl || activated());
  } });
  const activate = () => {
    if (mode() === 'hero') return;
    setActivated(true);
    view?.setInteraction(true, true);
  };
  onMount(() => {
    measure();
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root!);
    root?.addEventListener('keydown', onKey);
    root?.addEventListener('pointerdown', onMaterialPointer, { capture: true });
    root?.addEventListener('keydown', onMaterialKey, { capture: true });
    if (ownsUrl) {
      window.addEventListener('popstate', onPop);
      const route = parseRoute(window.location.pathname);
      const adopted = history.resume() !== null;
      if (!adopted && route.kind !== 'map') history.arrived();
      pendingRoute = route.kind === 'map' && !adopted ? null : { route, adopted };
      window.__chatdomAtlas = { stats: () => view?.stats() ?? null, marks: limit => view?.drawnMarks(limit) ?? [] };
    }
    visibilityObserver = new IntersectionObserver(entries => {
      inViewport = entries[0]?.isIntersecting ?? true;
      pause();
    });
    visibilityObserver.observe(root!);
    document.addEventListener('visibilitychange', pause);
    void start();
  });
  onCleanup(() => {
    disposed = true;
    cardGeneration++;
    root?.removeEventListener('keydown', onKey);
    root?.removeEventListener('pointerdown', onMaterialPointer, { capture: true });
    root?.removeEventListener('keydown', onMaterialKey, { capture: true });
    materialSound.dispose();
    document.removeEventListener('visibilitychange', pause);
    if (ownsUrl) { window.removeEventListener('popstate', onPop); delete window.__chatdomAtlas; }
    resizeObserver?.disconnect();
    visibilityObserver?.disconnect();
    cardObserver?.disconnect();
    cardMeasure?.();
    clearTimeout(liveWait);
    clearTimeout(backdropTimer);
    clearTimeout(namesTimer);
    clearTimeout(expiryTimer);
    registerController?.abort();
    stopLive();
    store = null;
    rebuild = null;
    controller?.abort();
    for (const finish of pendingFlights) finish();
    clearTimeout(networkTimer);
    roadsController?.abort();
    gateController?.abort();
    dropRoads(view);
    view?.dispose();
    view = null;
  });

  const adoptNewer = () => {
    const newer = loaded()?.newer;
    if (!newer) return;
    adoptPreview(sessionStore(), newer);
    setNotice(null);
    if (anyOpen()) closeCard();
    void start();
  };

  const world = () => loaded()?.world ?? null;
  const asOf = () => {
    const w = world();
    return w ? new Date(w.asOf).toISOString() : undefined;
  };
  const drawn = () => state() === 'ready' || state() === 'still';

  /** Without WebGL the still stands in for the map; once it is drawn, the page's notice hangs from its ribbon. */
  const stillMode = createMemo(() => state() === 'still' || backdrop());
  const stillShown = createMemo(() => stillMode() && !!world() && !!geo() && !!settlers());
  const noticeView = (current: NoticeState) => (
    <Notice action={current.action} onDismiss={() => void setNotice(null)}>
      {current.text}
    </Notice>
  );

  return (
    <div
      ref={(element) => (root = element)}
      class="atlas"
      data-atlas-mode={mode()}
      data-activated={activated() ? 'true' : 'false'}
      on:pointerdown={activate}
      on:focusin={activate}
      data-state={state()}
      data-preview={world()?.id}
      data-revision={world()?.revision}
      data-as-of={asOf()}
      data-distance={distance()}
      data-layout={phone() ? 'phone' : 'laptop'}
      data-names={names()}
      data-context={context()}
      data-live={live()?.status.freshness ?? 'none'}
      data-live-as-of={live()?.status.frameAsOf ? new Date(live()!.status.frameAsOf!).toISOString() : undefined}
      data-live-source={live()?.status.source?.state}
      data-live-holdings={live()?.holdings}
      data-live-dabs={live()?.dabs}
      data-live-drawn={drawnLive() ? `${drawnLive()!.washes}:${drawnLive()!.pennants.join(',')}` : undefined}
      data-roads={roadStats() ? `${roadStats()!.network}:${roadStats()!.dotted}:${roadStats()!.sea}` : undefined}
      data-roads-focus={roadStats()?.focus}
      data-caravans={roadStats()?.caravans}
      data-gate-from={gateFrom() ?? undefined}
      data-gate-picked={picked() ?? undefined}
      data-gate-finder={mode() === 'gate' ? finder().status : undefined}
    >
      <div
        ref={element => (host = element)}
        class="atlas-map"
        tabindex={mode() === 'hero' ? -1 : 0}
        role="application"
        aria-roledescription="map"
        aria-label="The Atlas of Kingdoms. Arrow keys pan, plus and minus zoom, 1 to 4 choose a distance, 0 shows the whole map."
        style={{ visibility: state() === 'still' || noWebgl ? 'hidden' : 'visible' }}
      />
      <Show when={stillMode()}>
        <Show when={world() && geo() ? settlers() : null} keyed>
          {(holdings) => (
          <Still
            world={world()!}
            compactChrome
            geo={geo()!}
            store={holdings}
            paint={(liveTick(), paint)}
            liveTick={liveTick()}
            selected={selected()}
            onSelect={(settler) => choose(settler)}
            onReady={() => { setStillDrawn(true); if (!noWebgl && state() === 'loading') props.ready('still'); stillReady(); }}
            loadChunk={(region) => loadChunk(region)}
            onView={(next) => {
              setScale(next.scale);
              setDistance(next.distance);
            }}
            notice={notice() ? noticeView(notice()!) : undefined}
          />
          )}
        </Show>
      </Show>

      <Show when={waitingScreen()}>{(point) => (
        <svg data-atlas-pencil-place="true" viewBox="0 0 40 52" width="26" height="34" aria-hidden="true"
          style={{ position: 'absolute', left: `${point().x}px`, top: `${point().y}px`, transform: 'translate(-30%, -94%)', 'pointer-events': 'none', color: 'var(--ink)', 'z-index': state() === 'ready' ? 2 : 0, overflow: 'visible' }}>
          <path d="M12 48V8M12.6 9.5c6 1.6 11-1.8 17 .6-2.4 3-2.6 6.4 .4 9.6-6.2-2-11.2 1.4-17.4-.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <ellipse cx="12" cy="48" rx="5" ry="2" fill="none" stroke="currentColor" stroke-width="1" opacity=".5" />
        </svg>
      )}</Show>
      <Show when={!waiting() && waitingScreen() && gateSource() ? waitingScreen() : null}>{(point) => (
        <span class="atlas-gate-source" dir="auto" style={{ left: `${point().x + 12}px`, top: `${point().y - 30}px` }}>{gateSource()!.name}</span>
      )}</Show>

      <Show when={mode() !== 'hero' && world() ? world() : null}>
        {(w) => (
          <>
            <Show when={mode() === 'explore'}>
              <Cartouche world={w()} seal={<SurveySeal world={w()} summary={live()} still={state() === 'still'} />}>
                <Show when={drawn()}>
                  <Search keyboardRoot={root!} source={SOURCE} world={w()} onAir={onAirResult} onChoose={openSearchResult} />
                </Show>
              </Cartouche>
            </Show>
            <Show when={!phone()}><Compass size={92} /></Show>
            <Show when={phone()}><Compass size={46} /></Show>
            <Show when={mode() === 'explore'}>
            <aside class="atlas-key" data-atlas-chrome="key" data-open={keyOpen() ? 'true' : 'false'} aria-label="Key">
              <button type="button" class="atlas-key-toggle" aria-expanded={!phone() || keyOpen()} aria-controls={keyBodyId} on:click={() => setKeyOpen(!keyOpen())}>
                Key
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5L6 4.5l3 3" /></svg>
              </button>
              <div class="atlas-key-body" id={keyBodyId}><LegendBody world={w()} /></div>
            </aside>
            </Show>
            <Show when={mode() === 'gate' && gateFrom()}>
              <FinderBoard
                state={finder()}
                search={finderSearch()}
                picked={picked()}
                onSearch={gateSearch}
                onPick={gatePick}
                onPreview={gatePreview}
                onClose={() => { closeGateBoard(); props.gateEmit({ kind: 'closed' }); }}
                onRetry={() => { const from = gateFrom(); if (from && gateController) readFinder(from, gateController.signal); }}
                sourceRoads={gateRoads()}
              />
            </Show>
            <Show when={mode() === 'explore'}>
            <div class="atlas-bottom" data-atlas-chrome="navigation">
              <ScaleBar scale={scale()} distance={distance()} />
              <Show when={state() !== 'still'}>
                <Controls
                  onZoomIn={() => view?.zoomBy(1.8)}
                  onZoomOut={() => view?.zoomBy(1 / 1.8)}
                  onHome={() => view?.home()}
                  onDistance={(next) => view?.toDistance(next)}
                  distance={distance()}
                  canZoomIn={scale() < MAX_SCALE * 0.999}
                  canZoomOut={scale() > minScale() * 1.001}
                />
              </Show>
              <button type="button" class="atlas-sound-toggle" aria-label={muted() ? 'Unmute map sounds' : 'Mute map sounds'} aria-pressed={muted()} on:click={mute}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" /><Show when={muted()} fallback={<path d="M16 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" />}><path d="m17 9 5 6m0-6-5 6" /></Show></svg>
              </button>
            </div>
            </Show>
            <Show when={mode() === 'explore' ? props.options.slots?.footer : null} keyed>{mount => <FooterSlot mount={mount} />}</Show>
            <Show when={context() === 'lost'}>
              <p class="atlas-redraw" role="status">Redrawing the map…</p>
            </Show>
            <Show when={selected()} keyed>
              {(settler) => (
                <Card
                  settler={settler}
                  name={(namesTick(), settler.name)}
                  login={(namesTick(), settler.login)}
                  names={names()}
                  world={w()}
                  live={(liveTick(), paint?.frame ? { liveClass: paint.liveClass(settler), startedAt: paint.startedAt(settler), asOf: paint.frame.asOf } : null)}
                  register={register()}
                  onClose={closeCard}
                  onRoad={(next) => openCardRoad(settler, next)}
                  ledger={ledgerView}
                  onRetry={() => readRegister({ id: settler.id }, settler.id)}
                  onEnter={enter}
                />
              )}
            </Show>
            <Show when={selectedDab() && geo() ? selectedDab() : null} keyed>
              {(dab) => (
                <Show
                  keyed
                  when={(() => {
                    const known = register();
                    return known.status === 'ready' ? known : null;
                  })()}
                  fallback={<DabCard dab={dab} world={w()} geo={geo()!} asOf={live()?.status.frameAsOf ?? null} onClose={closeCard} />}
                >
                  {(known) => (
                    <WaitingCard
                      face={known.reply.channel}
                      state={known}
                      world={w()}
                      live={{ startedAt: dab.startedAt, asOf: live()?.status.frameAsOf ?? dab.startedAt }}
                      onAir={true}
                      onClose={closeCard}
                      onEnter={enter}
                      onRoad={(next) => openCardRoad(known.reply.channel, next)}
                      ledger={ledgerView}
                      onRetry={() => readRegister({ dab: dab.hash }, `dab:${dab.hash}`)}
                    />
                  )}
                </Show>
              )}
            </Show>
            <Show when={waiting()} keyed>
              {(face) => (
                <WaitingCard
                  face={register().status === 'ready' ? (register() as { reply: CardReply }).reply.channel : face}
                  state={register()}
                  world={w()}
                  live={(liveTick(), paint?.frame ? { startedAt: null, asOf: paint.frame.asOf } : null)}
                  onAir={false}
                  onClose={closeCard}
                  onEnter={enter}
                  onRoad={(next) => openCardRoad(face, next)}
                  ledger={ledgerView}
                  onRetry={() => readRegister({ id: face.id }, `waiting:${face.id}`)}
                />
              )}
            </Show>
            <Show when={road()}>
              {(current) => (
                <RoadStoryCard
                  state={current().state}
                  world={w()}
                  onClose={closeCard}
                  onFollow={(face) => void openFace(face)}
                  onRetry={() => openRoad(current().ask)}
                />
              )}
            </Show>
            <Show when={!stillShown() && notice()}>{(current) => noticeView(current())}</Show>
            <Show when={entering()}>
              {(holding) => (
                <DoorCartouche id={holding().id} name={holding().name} phase="stamp"
                  subtitle={holdingPlace(holding())}
                  steps={[{ text: 'The gate is opened', done: true }, { text: 'The road leads down into the land', done: false }]} />
              )}
            </Show>
          </>
        )}
      </Show>

      <Show when={mode() === 'hero' && drawn()}>
        <button type="button" class="atlas-hero-open" aria-label="Explore the map" on:click={() => props.options.onExplore?.(currentView())} />
      </Show>
      <Switch>
        <Match when={state() === 'loading' && !stillDrawn()}>
          <div class="atlas-veil" aria-live="polite">
            <div class="atlas-veil-inner">
              <p class="atlas-eyebrow">Chatdom</p>
              <p class="atlas-veil-title">The Atlas of Kingdoms</p>
              <svg class="atlas-quill" viewBox="0 0 240 40" aria-hidden="true">
                <path d="M6 26c22-14 38 6 58-4s26-16 44-6 30 10 46 2 30-14 48-4 22 8 32 4" />
              </svg>
              <p class="atlas-veil-text">Inking the coasts…</p>
            </div>
          </div>
        </Match>
        <Match when={state() !== 'loading' && !drawn()}>
          <div class="atlas-veil atlas-failure" role="alert">
            <div class="atlas-veil-inner">
              <p class="atlas-eyebrow">The Atlas of Kingdoms</p>
              <Switch>
                <Match when={state() === 'empty'}>
                  <h1 class="atlas-veil-title">The surveyors are still out</h1>
                  <p class="atlas-veil-text">No survey has been published yet. The first preview is drawn as soon as one arrives.</p>
                </Match>
                <Match when={state() === 'invalid'}>
                  <h1 class="atlas-veil-title">This copy failed its seal</h1>
                  <p class="atlas-veil-text">The survey files did not match the hashes they were published with, so nothing was drawn from them.</p>
                </Match>
                <Match when={state() === 'unsupported'}>
                  <h1 class="atlas-veil-title">This browser cannot draw the map</h1>
                  <p class="atlas-veil-text">The Atlas paints with WebGL, which is switched off or missing here. A current Chrome, Edge, Firefox or Safari will draw it.</p>
                </Match>
                <Match when={true}>
                  <h1 class="atlas-veil-title">The map room is closed</h1>
                  <p class="atlas-veil-text">The Atlas service could not be reached. Nothing has been lost; try again in a moment.</p>
                </Match>
              </Switch>
              <Show when={state() !== 'unsupported'}>
                <button type="button" class="atlas-button" on:click={() => void start()}>Try again</button>
              </Show>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
