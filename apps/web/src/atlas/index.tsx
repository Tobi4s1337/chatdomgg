import { batch, createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import './atlas.css';
import { adoptPreview, loadPreview, type LoadedPreview } from './data/load';
import { dabHashOf, DirectoryError, fetchCard, fetchRoad, type CardReply, type CardRoad, type ChannelFace, type Lookup, type RoadReply, type SearchResult } from './data/directory';
import { decodeRings, geographyOf, SettlerStore, type Geography, type Ring, type Settler } from './data/model';
import { fetchChunk, fetchNames, PreviewError, type PreviewSource } from './data/preview';
import { LiveFeed, type LiveStatus } from './live/feed';
import { LivePaint, type Dab } from './live/paint';
import { DISTANCE_STOP, MAX_SCALE, type Distance, type Insets, type Viewport } from './map/camera';
import type { CameraState } from './map/motion';
import { MapView, type MapStats } from './map/view';
import { Still } from './still/Still';
import { Card, type NamesState } from './ui/Card';
import { Cartouche, Compass, Controls, Notice, ScaleBar } from './ui/chrome';
import { formatMoment } from './ui/format';
import { CardHistory } from './ui/history';
import { LegendBody } from './ui/Legend';
import { DabCard, LiveSeal, type LiveSummary } from './ui/Live';
import { RoadCard, WaitingCard, type RegisterState } from './ui/Register';
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

const SOURCE: PreviewSource = { base: '/map-data', fetch: (input, init) => fetch(input, init) };
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
async function loadFaces(): Promise<void> {
  if (!('fonts' in document)) return;
  const all = Promise.all(FACES.map((face) => document.fonts.load(face, 'Atlas Кириллица'))).then(() => undefined);
  await Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The Atlas of Kingdoms: a survey preview of real Twitch channels drawn as draft land. One root element carries
 * `data-chatdom-atlas` and the state; `window.__chatdomReady` turns true when the first view is fully drawn (or
 * when the page has settled on a designed failure state). Without WebGL the same survey is drawn as a still.
 */
export default function Atlas() {
  let root: HTMLDivElement | undefined;
  let host: HTMLDivElement | undefined;
  let view: MapView | null = null;
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
  const [notice, setNotice] = createSignal<NoticeState | null>(null);
  const [phone, setPhone] = createSignal(false);
  const [names, setNames] = createSignal<NamesState>('loading');
  const [context, setContext] = createSignal<'ok' | 'lost'>('ok');
  /** Bumped whenever names change on the same holdings, so the card follows them. */
  const [namesTick, setNamesTick] = createSignal(0);
  /** A named channel without land and not on air, opened from search, a road or a route. */
  const [waiting, setWaiting] = createSignal<ChannelFace | null>(null);
  /** The open road card and the ends it was asked for. */
  const [road, setRoad] = createSignal<{ ask: RoadAsk; state: RegisterState<RoadReply> } | null>(null);
  /** The open channel card's register entry (stream and roads). */
  const [register, setRegister] = createSignal<RegisterState<CardReply>>({ status: 'loading' });
  /** Text handed to the search by a route that found nothing. */
  const [searchSeed, setSearchSeed] = createSignal<{ text: string; at: number } | null>(null);
  let registerController: AbortController | null = null;
  /** Bumped whenever a card opens or closes, so a late register reply never lands on another card. */
  let cardGeneration = 0;
  /** The route the page was opened on, applied once the first view is drawn. */
  let pendingRoute: { route: AtlasRoute; adopted: boolean } | null = null;
  const anyOpen = () => !!selected() || !!selectedDab() || !!waiting() || !!road();

  const settle = () => {
    window.__chatdomReady = true;
  };

  const measure = () => setPhone(window.innerWidth < PHONE_WIDTH);

  /** Space the page's own chrome takes from the map: the cartouche and key on a laptop, title and buttons on a phone. */
  const chromeInsets = (size: Viewport): Insets => {
    if (size.width < PHONE_WIDTH) {
      const cartouche = root?.querySelector('.atlas-cartouche')?.getBoundingClientRect();
      return { left: 0, right: 0, top: cartouche ? Math.round(cartouche.bottom) + 4 : 76, bottom: 60 };
    }
    if (size.width >= 1100) return { left: 370, right: 0, top: 0, bottom: 0 };
    return { left: 0, right: 0, top: 0, bottom: 0 };
  };

  /** The space an open card takes: its measured box, or a first estimate before it has been laid out. */
  const cardInsets = (card: Element | null): Insets => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const box = card?.getBoundingClientRect();
    if (phone()) return { left: 0, right: 0, top: 0, bottom: box ? Math.max(0, Math.round(height - box.top)) : Math.round(Math.min(height * 0.56, 470)) };
    return { left: 0, right: box ? Math.max(0, Math.round(width - box.left)) : 400, top: 0, bottom: 0 };
  };

  const history = new CardHistory(window.history, (before) => {
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
      setRoad(null);
    });
    view?.select(null);
    view?.setRoad(null);
  };

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
    // The open key is the top surface on a phone when no card is showing; the card handles its own Escape.
    if (event.key === 'Escape' && keyOpen() && !anyOpen()) {
      setKeyOpen(false);
      host?.focus({ preventScroll: true });
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
  const readRegister = (lookup: Lookup, cardId: string) => {
    registerController?.abort();
    const controller = new AbortController();
    registerController = controller;
    const generation = cardGeneration;
    setRegister({ status: 'loading' });
    fetchCard(SOURCE, loaded()!.world.id, lookup, controller.signal).then((reply) => {
      if (generation !== cardGeneration) return;
      setRegister({ status: 'ready', reply });
      if (reply.channel.login && history.isOpen) history.opened(cardId, view?.cameraState() ?? { x: 0, y: 0, scale: 1 }, urlFor(reply.channel.login));
    }, (error: unknown) => {
      if (generation !== cardGeneration || (error as Error).name === 'AbortError') return;
      if (error instanceof DirectoryError && error.reason === 'not-found') setRegister({ status: 'missing' });
      else setRegister({ status: 'failed', reason: error instanceof DirectoryError ? error.reason : 'unavailable' });
    });
  };

  /** Choose a holding. `fly` (search, roads, routes) flies to the distance its mark is drawn at; a tap keeps the scale. */
  const choose = (settler: Settler | null, fly = false) => {
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

  /** Choose a pencil flag; its register entry names it when the survey has seen it within a day. */
  const chooseDab = (dab: Dab, fly = false, face?: ChannelFace) => {
    clearCards();
    setSelectedDab(dab);
    setKeyOpen(false);
    const id = `dab:${dab.hash}`;
    opening(id, urlFor(face?.login));
    readRegister(face ? { id: face.id } : { dab: dab.hash }, id);
    if (fly && view) view.flyTo(dab.x, dab.y, Math.max(view.cameraState().scale, DISTANCE_STOP.realm));
    else if (dab.placed) view?.revealPoint(dab);
  };

  /** A named channel without land and off the air: its card, and the map shows the realm it would be pencilled into. */
  const openWaiting = (face: ChannelFace) => {
    clearCards();
    setWaiting(face);
    setKeyOpen(false);
    const id = `waiting:${face.id}`;
    opening(id, urlFor(face.login));
    readRegister({ id: face.id }, id);
    const realm = geo()?.realms[face.realm ?? -1];
    if (realm && view) view.flyTo(realm.x, realm.y, Math.max(view.cameraState().scale, DISTANCE_STOP.continent));
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
    const hash = dabHashOf(face.id);
    const dab = paint?.dabs.find((candidate) => candidate.hash === hash);
    return dab ? { dab } : null;
  };

  /** Open any channel the register named (a search result, a road's end, a route): its holding, its flag, or its waiting card. */
  const openFace = async (face: ChannelFace) => {
    const generation = ++cardGeneration;
    const place = await locate(face);
    if (generation !== cardGeneration) return;
    if (place && 'settler' in place) return choose(place.settler, true);
    if (place && 'dab' in place) return chooseDab(place.dab, true, face);
    if (face.place === 'waiting') return openWaiting(face);
    // A holding the map no longer draws (withheld since the register answered) has no card to open.
    setNotice({ text: 'That channel is no longer drawn on this map.' });
  };

  const openSearchResult = (result: SearchResult) => void openFace(result.channel);

  /** Whether a search result is on air in the frame shown now (its holding's class, or its pencil flag). */
  const onAirResult = (result: SearchResult): boolean => {
    void liveTick();
    if (!paint?.frame) return false;
    if (result.channel.ordinal !== null) return paint.classAt(result.channel.ordinal) > 0 && !store?.byId.get(result.channel.id)?.withheld;
    const hash = dabHashOf(result.channel.id);
    return paint.dabs.some((dab) => dab.hash === hash);
  };

  const roadUrl = (reply: RoadReply | null, ask: RoadAsk) => {
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
    fetchRoad(SOURCE, loaded()!.world.id, ask.a, ask.b, controller.signal).then(async (reply) => {
      if (generation !== cardGeneration) return;
      setRoad({ ask, state: { status: 'ready', reply } });
      if (history.isOpen) history.opened(id, view?.cameraState() ?? { x: 0, y: 0, scale: 1 }, roadUrl(reply, ask));
      const [a, b] = await Promise.all([locate(reply.a), locate(reply.b)]);
      if (generation !== cardGeneration) return;
      const point = (place: Awaited<ReturnType<typeof locate>>) => (place ? ('settler' in place ? place.settler : place.dab) : null);
      const pa = point(a);
      const pb = point(b);
      if (pa && pb) view?.setRoad({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y }, true);
      else if (pa ?? pb) view?.flyTo((pa ?? pb)!.x, (pa ?? pb)!.y, Math.max(view.cameraState().scale, DISTANCE_STOP.realm));
    }, (error: unknown) => {
      if (generation !== cardGeneration || (error as Error).name === 'AbortError') return;
      setRoad({ ask, state: error instanceof DirectoryError && error.reason === 'not-found' ? { status: 'missing' } : { status: 'failed', reason: error instanceof DirectoryError ? error.reason : 'unavailable' } });
    });
  };

  const openCardRoad = (from: ChannelFace | Settler, road: CardRoad) => openRoad({ a: { id: from.id }, b: { id: road.other.id } });

  /**
   * Open what a route names, once the map is drawn. `adopted` means the route's history entry already exists (a reload
   * or Forward), so the card takes it over rather than pushing another. A route that names nothing on this map says so
   * and leaves the map at its usual view with the address back at `/map`.
   */
  const applyRoute = async (route: AtlasRoute, adopted: boolean): Promise<void> => {
    const drop = (text: string, action?: NoticeState['action']) => {
      if (adopted) history.closed();
      else window.history.replaceState(window.history.state, '', '/map');
      setNotice(action ? { text, action } : { text });
    };
    if (route.kind === 'map') {
      if (adopted) history.closed();
      return;
    }
    if (route.kind === 'channel') {
      try {
        const reply = await fetchCard(SOURCE, loaded()!.world.id, { login: route.login });
        await openFace(reply.channel);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (error instanceof DirectoryError && error.reason === 'not-found') {
          drop(`No channel called “${route.login}” is on this survey’s map. Names show only for channels seen live within a day.`, {
            label: 'Search for it',
            run: () => {
              setNotice(null);
              setSearchSeed({ text: route.login, at: Date.now() });
            },
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
      if (!card || !anyOpen()) return;
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
          });
          else if (!next) closeCard();
          else setSelectedDab(next);
        }
      }
      setLive({ status, holdings: livePaint.liveCount, dabs: livePaint.dabs.length });
      if (frame || status.refused || status.source) settled();
    });
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
    }, 5_000);
  };

  async function start(): Promise<void> {
    stopLive();
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    clearTimeout(namesTimer);
    clearTimeout(expiryTimer);
    window.__chatdomReady = false;
    rebuild = null;
    setState('loading');
    setNames('loading');
    try {
      const still = !webglAvailable();
      const [preview] = await Promise.all([loadPreview(SOURCE, sessionStore(), signal), loadFaces()]);
      if (signal.aborted) return;
      const { world } = preview;
      const holdings = new SettlerStore(world);
      store = holdings;
      const geography = geographyOf(world);
      // Together, so nothing draws the new revision with the old holdings (the still is made once per store).
      batch(() => {
        setLoaded(preview);
        setSettlers(holdings);
        setGeo(geography);
      });
      // Names travel beside the land: the first view waits for both (or for the names to fail on their own).
      let mapDrawn = false;
      let namesSettled = false;
      // The first view also waits briefly for the live paint, so it does not arrive as a flash after the reveal.
      let liveSettled = false;
      const reveal = () => {
        if (!mapDrawn || !namesSettled || !liveSettled || signal.aborted) return;
        setState(still ? 'still' : 'ready');
        settle();
        // The route the page was opened on (a shared link, a reload on a card) opens once the map is there to show it.
        const route = pendingRoute;
        pendingRoute = null;
        if (route) void applyRoute(route.route, route.adopted);
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
      view?.dispose();
      view = null;
      loadChunk = async (region) => holdings.addChunk(await fetchChunk(SOURCE, world, region, signal));
      if (still) {
        // Without WebGL the Still draws this same revision; it calls `stillReady` once composed.
        stillReady = () => {
          mapDrawn = true;
          reveal();
        };
        setTimeout(liveIn, LIVE_WAIT_MS);
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
      }, chromeInsets, initial);
      view = await mount(null);
      if (signal.aborted) {
        view.dispose();
        view = null;
        return;
      }
      // The context did not come back: draw the map again on a new canvas from the same view and selection.
      rebuild = async (camera) => {
        const old = view;
        view = null;
        old?.dispose();
        let next: MapView;
        try {
          next = await mount(camera);
        } catch {
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
        if (paint) next.setLive(paint);
        // Read after the wait: Back may have closed the card meanwhile.
        const chosen = selected();
        next.select(chosen);
        if (anyOpen()) next.setCardInsets(cardInsets(root?.querySelector('.atlas-card') ?? null));
        const inked = road();
        if (inked?.state.status === 'ready') void openRoad(inked.ask);
        setContext('ok');
      };
      setTimeout(liveIn, LIVE_WAIT_MS);
      startLive(preview, holdings, view.rings, liveIn);
      if (preview.newer) noticeNewer(preview);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      if (error instanceof PreviewError) setState(error.reason === 'mismatch' ? 'invalid' : error.reason);
      else if (/webgl|context/i.test(String((error as Error).message))) setState('unsupported');
      else setState('unavailable');
      settle();
    }
  }

  let stillReady: () => void = () => undefined;

  const noticeNewer = (preview: LoadedPreview) => {
    if (!preview.newer) return;
    setNotice({ text: `A newer survey is ready (observed to ${formatMoment(preview.newer.asOf)}).`, action: { label: 'Open it', run: adoptNewer } });
  };

  onMount(() => {
    document.title = 'The Atlas of Kingdoms · Chatdom';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#e2d3ae');
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    const route = parseRoute(window.location.pathname);
    const adopted = history.resume() !== null;
    if (!adopted && route.kind !== 'map') history.arrived();
    pendingRoute = route.kind === 'map' && !adopted ? null : { route, adopted };
    window.__chatdomAtlas = { stats: () => view?.stats() ?? null, marks: (limit) => view?.drawnMarks(limit) ?? [] };
    void start();
  });
  onCleanup(() => {
    window.removeEventListener('resize', measure);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    delete window.__chatdomAtlas;
    cardObserver?.disconnect();
    cardMeasure?.();
    clearTimeout(namesTimer);
    clearTimeout(expiryTimer);
    registerController?.abort();
    stopLive();
    store = null;
    rebuild = null;
    controller?.abort();
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
  const stillMode = createMemo(() => state() === 'still' || (state() === 'loading' && !webglAvailable()));
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
      data-chatdom-atlas=""
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
    >
      <Show
        when={stillMode()}
        fallback={
          <div
            ref={(element) => (host = element)}
            class="atlas-map"
            tabindex="0"
            role="application"
            aria-roledescription="map"
            aria-label="The Atlas of Kingdoms, a survey preview. Arrow keys pan, plus and minus zoom, 1 to 4 choose a distance, 0 shows the whole map."
          />
        }
      >
        <Show when={world() && geo() ? settlers() : null} keyed>
          {(holdings) => (
          <Still
            world={world()!}
            geo={geo()!}
            store={holdings}
            paint={(liveTick(), paint)}
            liveTick={liveTick()}
            selected={selected()}
            onSelect={(settler) => choose(settler)}
            onReady={() => stillReady()}
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

      <Show when={world()}>
        {(w) => (
          <>
            <Cartouche world={w()}>
              <Show when={live()}>{(summary) => <LiveSeal summary={summary()} />}</Show>
              <Show when={drawn()}>
                <Search source={SOURCE} world={w()} onAir={onAirResult} onChoose={openSearchResult} seed={searchSeed()} />
              </Show>
            </Cartouche>
            <Show when={!phone()}><Compass size={92} /></Show>
            <Show when={phone()}><Compass size={46} /></Show>
            <aside class="atlas-key" data-open={keyOpen() ? 'true' : 'false'} aria-label="Key">
              <button type="button" class="atlas-key-toggle" aria-expanded={!phone() || keyOpen()} onClick={() => setKeyOpen(!keyOpen())}>
                Key
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5L6 4.5l3 3" /></svg>
              </button>
              <div class="atlas-key-body"><LegendBody world={w()} /></div>
            </aside>
            <div class="atlas-bottom">
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
            </div>
            <Show when={context() === 'lost'}>
              <p class="atlas-redraw" role="status">Redrawing the map…</p>
            </Show>
            <Show when={selected()}>
              {(settler) => (
                <Card
                  settler={settler()}
                  name={(namesTick(), settler().name)}
                  login={(namesTick(), settler().login)}
                  names={names()}
                  world={w()}
                  live={(liveTick(), paint?.frame ? { liveClass: paint.liveClass(settler()), startedAt: paint.startedAt(settler()), asOf: paint.frame.asOf } : null)}
                  register={register()}
                  onClose={closeCard}
                  onRoad={(next) => openCardRoad(settler(), next)}
                  onRetry={() => readRegister({ id: settler().id }, settler().id)}
                />
              )}
            </Show>
            <Show when={selectedDab() && geo() ? selectedDab() : null}>
              {(dab) => (
                <Show
                  when={(() => {
                    const known = register();
                    return known.status === 'ready' ? known : null;
                  })()}
                  fallback={<DabCard dab={dab()} world={w()} geo={geo()!} asOf={live()?.status.frameAsOf ?? null} onClose={closeCard} />}
                >
                  {(known) => (
                    <WaitingCard
                      face={known().reply.channel}
                      state={known()}
                      world={w()}
                      live={{ startedAt: dab().startedAt, asOf: live()?.status.frameAsOf ?? dab().startedAt }}
                      onAir={true}
                      onClose={closeCard}
                      onRoad={(next) => openCardRoad(known().reply.channel, next)}
                      onRetry={() => readRegister({ dab: dab().hash }, `dab:${dab().hash}`)}
                    />
                  )}
                </Show>
              )}
            </Show>
            <Show when={waiting()}>
              {(face) => (
                <WaitingCard
                  face={register().status === 'ready' ? (register() as { reply: CardReply }).reply.channel : face()}
                  state={register()}
                  world={w()}
                  live={(liveTick(), paint?.frame ? { startedAt: null, asOf: paint.frame.asOf } : null)}
                  onAir={false}
                  onClose={closeCard}
                  onRoad={(next) => openCardRoad(face(), next)}
                  onRetry={() => readRegister({ id: face().id }, `waiting:${face().id}`)}
                />
              )}
            </Show>
            <Show when={road()}>
              {(current) => (
                <RoadCard
                  state={current().state}
                  world={w()}
                  onClose={closeCard}
                  onOpen={(face) => void openFace(face)}
                  onRetry={() => openRoad(current().ask)}
                />
              )}
            </Show>
            <Show when={!stillShown() && notice()}>{(current) => noticeView(current())}</Show>
          </>
        )}
      </Show>

      <Switch>
        <Match when={state() === 'loading'}>
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
        <Match when={!drawn()}>
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
                <button type="button" class="atlas-button" onClick={() => void start()}>Try again</button>
              </Show>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
