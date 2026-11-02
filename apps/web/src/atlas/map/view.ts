import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, ImageSource } from 'pixi.js';
import { decodeRings, type Geography, type Ring, type Settler, type SettlerStore } from '../data/model';
import type { Dab, LivePaint } from '../live/paint';
import type { PreviewWorld } from '../data/preview';
import stampSheetUrl from '../assets/stamps.webp?url';
import stampSheet from '../assets/stamps.json';
import { Camera, DISTANCE_STOP, distanceFor, NO_INSETS, type Distance, type Insets, type Viewport } from './camera';
import { Gestures } from './gestures';
import { centreForFocus, easeOut, focusOf, freeWidth, HERO_DRIFT_STEP_PX, heroDrift, insideFree, planAnchoredZoom, planFlight, screenShift, type CameraState, type Flight } from './motion';
import { markedTiers, Overlay } from './overlay';
import type { Stamp } from './paint';
import { pyramidFor } from './pyramid';
import { paintSceneFor } from './scene';
import { INK, PAPER, PAPER_DEEP } from './theme';
import { TILE_BUDGET_BYTES } from './tile-plan';
import { TileFarm, TileLayer } from './tiles';
import { WashLayer } from './wash';
import type { MapLayer } from '../road/layer';

export interface MapEvents {
  /** The map has drawn its first complete view (land, holdings and type). Called once. */
  ready(): void;
  select(settler: Settler | null): void;
  /** A small live channel's pencil flag was chosen. */
  selectDab(dab: Dab): void;
  camera(state: { scale: number; minScale: number; distance: Distance }): void;
  /** A region's towns and villages could not be read; the land stays, its smaller holdings stay unmarked. */
  chunkFailed(region: number): void;
  /** Land tiles that could not be inked after their retries; their ancestors stay drawn. 0 once retried. */
  tilesFailed(count: number): void;
  /** The WebGL context was lost ('lost'), came back ('restored'), or did not come back in time ('failed'). */
  context(state: 'lost' | 'restored' | 'failed'): void;
}

export interface MapData {
  world: PreviewWorld;
  geo: Geography;
  store: SettlerStore;
  loadChunk(region: number): Promise<void>;
}

/** Embed controls; omitted options retain the full-page Atlas's controls. */
export interface MapViewOptions {
  interactive?: boolean;
  wheel?: boolean;
  hero?: boolean;
  signal?: AbortSignal;
}

/** Evidence of the last drawn frame, for the page's test hook and budgets. */
export interface MapStats {
  camera: CameraState;
  distance: Distance;
  flying: boolean;
  gesture: boolean;
  tiles: TileLayer['stats'];
  overlay: Overlay['stats'];
  /** The most visible tiles left uncovered in any frame since the first complete view (must stay 0). */
  maxUncovered: number;
  frames: number;
  contextLosses: number;
}

const stamps = (stampSheet as { stamps: Stamp[] }).stamps;
/** One live query for the page, read every frame; its `matches` follows the preference without a listener. */
let motionQuery: MediaQueryList | null | undefined;
const reduceMotion = (): boolean => {
  if (motionQuery === undefined) motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return motionQuery?.matches ?? false;
};
/** How long a lost context may take to come back before the map is rebuilt from its saved view. */
const CONTEXT_GRACE_MS = 2_500;
/** A selected mark keeps this much paper between it and the card, the sheet or the screen's edge. */
const REVEAL_MARGIN = 56;

async function loadImage(url: string, signal?: AbortSignal): Promise<ImageBitmap | null> {
  try {
    signal?.throwIfAborted();
    const response = await fetch(url, { signal: signal ?? null });
    if (!response.ok) return null;
    const image = await createImageBitmap(await response.blob());
    if (signal?.aborted) {
      image.close();
      signal.throwIfAborted();
    }
    return image;
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

/**
 * A camera move in progress. Focus flights are planned in focus space (see motion.ts) and converted with the insets
 * of each frame; camera moves (anchored zoom steps, key pans) are screen-anchored and need no conversion.
 */
interface Motion { plan: Flight; start: number; space: 'focus' | 'camera' }

const maxInsets = (a: Insets, b: Insets | null): Insets => (b ? {
  left: Math.max(a.left, b.left), right: Math.max(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.max(a.bottom, b.bottom),
} : a);

/**
 * The drawn Atlas: one Pixi stage with the land pyramid, the paper margin and neatline, and the overlay of holdings
 * and type. It renders only when something changed, owns every pointer, wheel and key gesture on the map, and keeps
 * one camera: gestures, flights and resizes all move the same float64 state (Spec 01 R9).
 */
export class MapView {
  private readonly camera: Camera;
  private readonly tiles: TileLayer;
  private readonly farm: TileFarm;
  private readonly overlay: Overlay;
  private readonly wash: WashLayer;
  private readonly gestures: Gestures;
  private readonly frame = new Graphics();
  /** The chosen road, inked under the marks between its two ends (world units), or null. */
  private road: { ax: number; ay: number; bx: number; by: number } | null = null;
  private readonly roadInk = new Graphics();
  /** The coasts as drawn, shared with the live layer's pencil places. */
  readonly rings: Ring[];
  private live: LivePaint | null = null;
  /** A presentation drawn with this camera (the raid road); its parts sit under and over the holdings' marks. */
  private layer: MapLayer | null = null;
  private readonly root = new Container();
  private liveVersion = -1;
  private liveDue = Infinity;
  private backgroundLoading = false;
  private readonly chunks = new Map<number, 'loading' | 'failed'>();
  private readonly observer: ResizeObserver;
  private readonly cleanup: (() => void)[] = [];
  private view: Viewport;
  private dirty = true;
  private raf = 0;
  private readyFired = false;
  private readyFrames = 0;
  private readyNotified = false;
  private selected: Settler | null = null;
  private hovered: Settler | null = null;
  private motion: Motion | null = null;
  /** Space covered by an open card or phone sheet, on top of the page's chrome. */
  private cardInsets: Insets | null = null;
  /** The chosen mark the card describes, kept clear of the card while it is open. */
  private revealing: { x: number; y: number } | null = null;
  private storeVersion = -1;
  private failedTiles = 0;
  private lost = false;
  private lostTimer = 0;
  private contextLosses = 0;
  private maxUncovered = 0;
  /** The kind of the last pointer pressed: a touch double-tap is the gestures' own, not the browser's dblclick. */
  private lastPointer = 'mouse';
  private frames = 0;
  private disposed = false;
  private interactive = true;
  private wheel = true;
  private hero = false;
  private heroBase: CameraState | null = null;
  private heroElapsed = 0;
  private heroComposedLive = false;
  private heroLastFrame = 0;
  /** The drift camera last placed, and the base it drifted from. */
  private heroDrawn: { base: CameraState; at: CameraState } | null = null;
  private livePlacing: boolean | null = null;
  private paused = false;
  private pausedAt: number | null = null;
  private readonly captured = new Set<number>();
  private backgroundCancel: (() => void) | null = null;

  private constructor(private readonly app: Application, private readonly host: HTMLElement, private readonly data: MapData, private readonly sheet: ImageBitmap | null, private readonly events: MapEvents, private readonly pixelRatio: number, private readonly chromeInsets: (view: Viewport) => Insets, initial: CameraState | null, options: MapViewOptions) {
    this.interactive = options.interactive ?? true;
    this.wheel = options.wheel ?? true;
    this.view = { width: host.clientWidth || 1, height: host.clientHeight || 1 };
    this.camera = new Camera(data.geo.bounds);
    this.camera.home(this.view, this.chromeInsets(this.view));
    if (initial) this.place(initial);
    const phone = Math.min(this.view.width, this.view.height) < 600;
    const pyramid = pyramidFor(data.geo.bounds);
    this.rings = decodeRings(data.world);
    const scene = paintSceneFor(data.world, data.geo, this.rings);
    this.farm = new TileFarm(scene, stampSheetUrl, stamps, async () => sheet, pixelRatio);
    this.tiles = new TileLayer(pyramid, this.farm, pixelRatio, phone ? TILE_BUDGET_BYTES.phone : TILE_BUDGET_BYTES.laptop);
    this.tiles.setHome(this.homeCamera().snapshot(), this.view);
    const source = sheet ? new ImageSource({ resource: sheet, resolution: 1, scaleMode: 'linear', autoGenerateMipmaps: true }) : null;
    this.overlay = new Overlay(data.world, data.geo, data.store, source, stamps, pixelRatio);
    this.wash = new WashLayer(this.view, pixelRatio, phone);
    this.gestures = new Gestures(this.camera, {
      view: () => this.view,
      now: () => performance.now(),
      reducedMotion: reduceMotion,
      begin: () => (this.motion = null),
      changed: () => (this.dirty = true),
      tap: (x, y, type) => this.tap(x, y, type),
      doubleTap: (x, y) => this.zoomBy(2, x, y),
    });
    // The wash lies on the land and under the margin, the neatline and every mark and name.
    this.root.addChild(this.tiles.container, this.wash.sprite, this.frame, this.roadInk, this.overlay.container);
    app.stage.addChild(this.root);
    host.appendChild(app.canvas);
    app.canvas.setAttribute('aria-hidden', 'true');
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.bindInput();
    this.bindContext();
    this.setHero(options.hero ?? false);
    if (initial && this.hero) {
      this.place(initial);
      this.heroBase = this.camera.snapshot();
      this.heroComposedLive = true;
    }
    if (document.visibilityState === 'hidden') this.syncPaused();
    else this.loop();
  }

  static async create(host: HTMLElement, data: MapData, events: MapEvents, chromeInsets?: (view: Viewport) => Insets, initial?: CameraState | null, options: MapViewOptions = {}): Promise<MapView> {
    options.signal?.throwIfAborted();
    const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const app = new Application();
    let sheet: ImageBitmap | null = null;
    let mounted: MapView | null = null;
    try {
    await app.init({
      width: host.clientWidth || 1,
      height: host.clientHeight || 1,
      background: PAPER_DEEP,
      antialias: true,
      resolution: pixelRatio,
      autoDensity: true,
      preference: 'webgl',
      autoStart: false,
      sharedTicker: false,
    });
    options.signal?.throwIfAborted();
    sheet = await loadImage(stampSheetUrl, options.signal);
    options.signal?.throwIfAborted();
    mounted = new MapView(app, host, data, sheet, events, pixelRatio, chromeInsets ?? (() => NO_INSETS), initial ?? null, options);
    if (options.signal) mounted.listen(options.signal, 'abort', () => mounted?.dispose(), { once: true });
    options.signal?.throwIfAborted();
    if ((app.renderer as { gl?: WebGLRenderingContext }).gl?.isContextLost()) {
      throw new Error('The WebGL context was lost while mounting the Atlas');
    }
    return mounted;
    } catch (error) {
      // A retry must release the failed renderer and create its own fresh canvas.
      if (mounted) mounted.dispose();
      else {
        sheet?.close();
        try { app.destroy(true, { children: true }); } catch { /* init may have failed before a renderer existed */ }
      }
      throw error;
    }
  }

  private insets(): Insets {
    return maxInsets(this.chromeInsets(this.view), this.cardInsets);
  }

  private place(state: CameraState): void {
    this.camera.x = state.x;
    this.camera.y = state.y;
    this.camera.scale = state.scale;
    this.camera.clamp(this.view);
    this.dirty = true;
  }

  /** Enable direct controls independently of wheel zoom (an embed activates wheel zoom after a click). */
  setInteraction(interactive: boolean, wheel: boolean): void {
    if (this.disposed) return;
    this.interactive = interactive;
    this.wheel = wheel;
    if (!interactive || !wheel) this.resetInput();
  }

  /** A quiet view of live land; leaving hero mode keeps the current camera for exploring in place. */
  setHero(hero: boolean): void {
    if (this.disposed || this.hero === hero) return;
    this.hero = hero;
    this.resetInput();
    this.motion = null;
    this.heroElapsed = 0;
    this.heroLastFrame = 0;
    this.heroComposedLive = false;
    if (hero) this.composeHero();
    else this.heroBase = null;
    this.dirty = true;
  }

  /** Suspend all animation frames while the host is offscreen; document visibility is also observed. */
  setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.paused = paused;
    this.syncPaused();
  }

  private syncPaused(): void {
    if (this.disposed) return;
    const paused = this.paused || document.visibilityState === 'hidden';
    if (paused === (this.pausedAt !== null)) return;
    const now = performance.now();
    if (paused) {
      this.pausedAt = now;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.resetInput();
      this.backgroundCancel?.();
      this.backgroundCancel = null;
      this.backgroundLoading = false;
    } else {
      if (this.motion) this.motion.start += now - Math.max(this.pausedAt!, this.motion.start);
      this.pausedAt = null;
      this.heroLastFrame = 0;
      this.dirty = true;
      this.loop();
    }
  }

  private resetInput(): void {
    this.gestures.reset();
    for (const pointer of this.captured) {
      try { this.host.releasePointerCapture(pointer); } catch { /* The pointer may already have ended. */ }
    }
    this.captured.clear();
    this.hovered = null;
    delete this.host.dataset.dragging;
    delete this.host.dataset.hover;
    this.dirty = true;
  }

  private acceptsInput(): boolean {
    return !this.disposed && this.pausedAt === null && this.interactive && !this.hero;
  }

  private composeHero(transition = false): void {
    const from = transition ? this.camera.snapshot() : null;
    const weights = new Map<number, number>();
    if (this.live?.frame) {
      for (const settler of this.data.store.all) {
        if (this.live.liveClass(settler)) weights.set(settler.region, (weights.get(settler.region) ?? 0) + 1);
      }
      for (const dab of this.live.dabs) weights.set(dab.region, (weights.get(dab.region) ?? 0) + 1);
      this.heroComposedLive = true;
    }
    const region = [...this.data.geo.regions].sort((a, b) =>
      (weights.get(b.index) ?? 0) - (weights.get(a.index) ?? 0) || b.r - a.r || a.index - b.index,
    )[0];
    if (region) {
      // A continent and its neighbouring coasts, with room for the page's invitation over the paper.
      const scale = Math.min(this.view.width, this.view.height) / Math.max(1, region.r * 2.7);
      this.place({ x: region.x, y: region.y, scale: Math.max(this.camera.minScale, scale) });
    }
    this.heroBase = this.camera.snapshot();
    this.heroElapsed = 0;
    this.heroLastFrame = 0;
    if (from) {
      const target = focusOf(this.heroBase, this.view, this.insets());
      this.place(from);
      this.fly(target);
    }
  }

  private driftHero(now: number): boolean {
    if (!this.hero || !this.heroBase || this.motion) return false;
    if (reduceMotion()) {
      this.heroLastFrame = 0;
      return false;
    }
    if (this.heroLastFrame) this.heroElapsed += Math.min(64, Math.max(0, now - this.heroLastFrame));
    this.heroLastFrame = now;
    const next = heroDrift(this.heroBase, this.heroElapsed / 1_000);
    // A new base (composed, flown or resized) is drawn at once; after that only a step someone could see.
    const drawn = this.heroDrawn;
    if (drawn && drawn.base === this.heroBase && screenShift(drawn.at, next, this.view, this.pixelRatio) < HERO_DRIFT_STEP_PX) return false;
    this.heroDrawn = { base: this.heroBase, at: next };
    this.place(next);
    return true;
  }

  // ── Camera commands ────────────────────────────────────────────────────────────────────────────

  /** The camera as it is now (centre and scale), to restore later with `restore`. */
  cameraState(): CameraState {
    return this.camera.snapshot();
  }

  /** Return to a saved camera: a flight unless motion is reduced (then one short composed move). */
  restore(state: CameraState): void {
    this.fly(focusOf(state, this.view, this.insets()), focusOf(this.camera.snapshot(), this.view, this.insets()));
  }

  /** A zoom step around a screen point (buttons and keys use the centre of the free area). */
  zoomBy(factor: number, sx?: number, sy?: number): void {
    this.gestures.stop();
    // Steps continue from where a running step was heading, so quick presses add up.
    const base = this.motion?.space === 'camera' ? this.motion.plan.to.scale : this.camera.scale;
    const target = Math.min(this.camera.maxScale, Math.max(this.camera.minScale, base * factor));
    const insets = this.insets();
    const anchor = sx === undefined || sy === undefined
      ? { x: insets.left + (this.view.width - insets.left - insets.right) / 2, y: insets.top + (this.view.height - insets.top - insets.bottom) / 2 }
      : { x: sx, y: sy };
    const plan = planAnchoredZoom(this.camera.snapshot(), target, anchor, this.view, reduceMotion() ? 120 : undefined);
    this.motion = { plan, start: performance.now(), space: 'camera' };
    this.dirty = true;
  }

  /** The opening view of this screen. */
  home(): void {
    const scratch = this.homeCamera();
    this.camera.minScale = scratch.minScale;
    this.fly(focusOf(scratch.snapshot(), this.view, this.insets()));
  }

  private homeCamera(): Camera {
    const scratch = new Camera(this.data.geo.bounds);
    scratch.home(this.view, this.chromeInsets(this.view));
    return scratch;
  }

  /** Fly to one of the four distances (R7), keeping the middle of the free area where it is. */
  toDistance(distance: Distance): void {
    if (distance === 'world') return this.home();
    const focus = focusOf(this.camera.snapshot(), this.view, this.insets());
    this.fly({ x: focus.x, y: focus.y, scale: DISTANCE_STOP[distance] });
  }

  /** Fly so a world point sits in the middle of the free area at a scale (default: the current one). */
  flyTo(x: number, y: number, scale = this.camera.scale): void {
    this.fly({ x, y, scale: Math.min(this.camera.maxScale, Math.max(this.camera.minScale, scale)) });
  }

  private fly(to: CameraState, from = focusOf(this.camera.snapshot(), this.view, this.insets())): void {
    this.gestures.stop();
    const insets = this.insets();
    const plan = planFlight(from, to, {
      width: freeWidth(this.view, insets),
      // Never wider than the camera can zoom out to, or the clamp would flatten the arc's peak into a kink.
      maxWorldWidth: Math.min(Math.max(this.camera.worldWidth, this.camera.worldHeight) * 1.1, freeWidth(this.view, insets) / this.camera.minScale),
      reducedMotion: reduceMotion(),
    });
    this.motion = { plan, start: performance.now(), space: 'focus' };
    this.dirty = true;
  }

  /** Keyboard pan: a short eased glide by a screen distance. */
  pan(dx: number, dy: number): void {
    this.gestures.stop();
    const from = this.camera.snapshot();
    const to = { x: from.x - dx / from.scale, y: from.y - dy / from.scale, scale: from.scale };
    const duration = reduceMotion() ? 1 : 180;
    const at = (k: number) => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, scale: from.scale });
    this.motion = { plan: { duration, from, to, at: (ms) => (ms >= duration ? { ...to } : at(easeOut(ms / duration))) }, start: performance.now(), space: 'camera' };
    this.dirty = true;
  }

  /**
   * Ink a chosen road between two points (or clear it). With `frame`, fly so both ends sit in the free area with room
   * around them, no closer than kingdom distance; a road whose ends are far apart opens out to show them both.
   */
  setRoad(road: { ax: number; ay: number; bx: number; by: number } | null, frame = false): void {
    this.road = road;
    this.dirty = true;
    if (!road || !frame) return;
    const insets = this.insets();
    const width = Math.max(120, this.view.width - insets.left - insets.right);
    const height = Math.max(120, this.view.height - insets.top - insets.bottom);
    const dx = Math.abs(road.bx - road.ax);
    const dy = Math.abs(road.by - road.ay);
    const fit = Math.min(width / Math.max(1e-6, dx * 1.6), height / Math.max(1e-6, dy * 1.6));
    this.flyTo((road.ax + road.bx) / 2, (road.ay + road.by) / 2, Math.min(DISTANCE_STOP.kingdom, fit));
  }

  /** Lay the live layer over the land (or take it away). Its frames redraw the map through its version. */
  /**
   * Draw a presentation with the map's own camera: its `under` part between the land and the holdings' marks, its
   * `over` part above every mark and name. One layer at a time; null removes it.
   */
  attachLayer(layer: MapLayer | null): void {
    if (this.layer === layer) return;
    if (this.layer) {
      this.root.removeChild(this.layer.under);
      this.root.removeChild(this.layer.over);
    }
    this.layer = layer;
    if (layer) {
      this.root.addChildAt(layer.under, this.root.getChildIndex(this.overlay.container));
      this.root.addChild(layer.over);
    }
    this.dirty = true;
  }

  /** Put the camera exactly here, now (a director's shot), ending any flight or gesture glide. */
  setCamera(state: CameraState): void {
    this.motion = null;
    this.place(state);
    if (this.hero) {
      this.heroBase = this.camera.snapshot();
      this.heroElapsed = 0;
      this.heroLastFrame = 0;
      this.heroComposedLive = true;
    }
  }

  /** Where a world point is on screen in CSS px, with the camera as it is now. */
  screenOf(x: number, y: number): { x: number; y: number } {
    return this.camera.worldToScreen(x, y, this.view);
  }

  /** The drawn view's size in CSS px. */
  viewport(): Viewport {
    return { ...this.view };
  }

  setLive(live: LivePaint | null): void {
    this.live = live;
    this.liveVersion = -1;
    this.overlay.setLive(live);
    if (this.hero && !this.heroComposedLive && live?.frame && !this.readyNotified) this.composeHero();
    this.dirty = true;
  }

  /** Washes, pennants and pencil flags drawn in the last frame, for the page's evidence attributes. */
  liveDrawn(): { washes: number; pennants: number[] } {
    return { washes: this.wash.drawn, pennants: [...this.overlay.pennants] };
  }

  stats(): MapStats {
    return {
      camera: this.camera.snapshot(),
      distance: distanceFor(this.camera.scale),
      flying: !!this.motion,
      gesture: this.gestures.active,
      tiles: { ...this.tiles.stats },
      overlay: { ...this.overlay.stats },
      maxUncovered: this.maxUncovered,
      frames: this.frames,
      contextLosses: this.contextLosses,
    };
  }

  /** Holdings drawn in the last frame with their screen positions, strongest first (evidence for the checks). */
  drawnMarks(limit = 120): { id: string; name: string | null; tier: string; x: number; y: number }[] {
    return this.overlay.drawn.slice(0, limit).map((item) => ({ id: item.settler.id, name: item.settler.name, tier: item.settler.tier, x: item.x, y: item.y }));
  }

  /** Bake again the land tiles that failed; their ancestors stay drawn meanwhile. */
  retryTiles(): void {
    this.tiles.retryFailed();
    this.failedTiles = 0;
    this.events.tilesFailed(0);
    this.dirty = true;
  }

  /**
   * Mark a holding as chosen. With `reveal`, a mark the card or sheet would cover (or off screen) is flown to the
   * middle of the free area at the current scale; one already in clear paper stays where the reader put it.
   */
  select(settler: Settler | null, reveal = false): void {
    this.selected = settler;
    this.revealing = settler && reveal ? settler : null;
    this.dirty = true;
    if (this.revealing) this.reveal(this.revealing);
  }

  /** Keep a point that is not a holding (a pencil flag) clear of the card, as `select` does for holdings. */
  revealPoint(point: { x: number; y: number } | null): void {
    this.revealing = point;
    if (point) this.reveal(point);
  }

  /**
   * The space an open card takes (the laptop card on the right, the phone's bottom sheet), measured by the page.
   * A sheet that grows over the chosen mark moves the map, so the mark stays above it.
   */
  setCardInsets(insets: Insets | null): void {
    const same = insets && this.cardInsets && insets.left === this.cardInsets.left && insets.right === this.cardInsets.right && insets.top === this.cardInsets.top && insets.bottom === this.cardInsets.bottom;
    if (same || (!insets && !this.cardInsets)) return;
    this.cardInsets = insets;
    if (!insets) this.revealing = null;
    if (this.revealing) this.reveal(this.revealing);
  }

  private reveal(point: { x: number; y: number }): void {
    const target = this.motion?.space === 'focus' ? centreForFocus(this.motion.plan.to, this.view, this.insets()) : this.camera.snapshot();
    if (insideFree(point, target, this.view, this.insets(), REVEAL_MARGIN)) return;
    this.flyTo(point.x, point.y, target.scale);
  }

  // ── Frame loop ─────────────────────────────────────────────────────────────────────────────────

  private loop = (): void => {
    if (this.disposed || this.pausedAt !== null) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.lost) return;
    if (this.readyFired && !this.readyNotified && this.readyFrames > 0 && --this.readyFrames === 0) {
      this.readyNotified = true;
      this.events.ready();
      if (this.disposed || this.pausedAt !== null) return;
    }
    const now = performance.now();
    // The live frame can arrive after the first drawing. Settle into its live land once, without a camera cut.
    if (this.hero && !this.heroComposedLive && this.live?.frame) {
      if (this.readyNotified && reduceMotion()) this.heroComposedLive = true;
      else this.composeHero(this.readyNotified);
    }
    let moving = this.gestures.step(now);
    if (this.motion) {
      const { plan, start, space } = this.motion;
      const state = plan.at(now - start);
      this.place(space === 'focus' ? centreForFocus(state, this.view, this.insets()) : state);
      if (now - start >= plan.duration) {
        this.motion = null;
        if (this.hero) {
          this.heroBase = this.camera.snapshot();
          this.heroElapsed = 0;
          this.heroLastFrame = 0;
          this.heroComposedLive = true;
        }
      }
      moving = true;
    }
    if (this.driftHero(now)) moving = true;
    if (this.data.store.version !== this.storeVersion) {
      this.storeVersion = this.data.store.version;
      this.dirty = true;
    }
    const live = this.live;
    if (live) {
      // Pencil places are found a few milliseconds per frame, the regions in view first, and never while moving.
      if ((!moving || this.hero) && !this.gestures.touching) {
        // Checks wait for this before they measure the settled map; it is written only when it changes.
        const placing = live.work(6, this.visibleRegions());
        if (placing !== this.livePlacing) {
          this.livePlacing = placing;
          this.host.dataset.atlasLiveWork = placing ? 'placing' : 'done';
        }
      }
      if (live.version !== this.liveVersion) {
        this.liveVersion = live.version;
        this.dirty = true;
      }
      if (now >= this.liveDue) this.dirty = true;
    }
    if (this.layer?.animating || this.wash.pending) this.dirty = true;
    if (!moving && !this.dirty && this.tiles.complete && !this.overlay.animating) return;
    this.dirty = false;
    this.draw(now);
  };

  private draw(now: number): void {
    this.frames++;
    // While a flight is under way, the land at its destination is baked right after what is on screen.
    const destination = this.motion?.space === 'focus' ? centreForFocus(this.motion.plan.to, this.view, this.insets()) : this.motion?.plan.to ?? null;
    this.tiles.update(this.camera, this.view, now, () => (this.dirty = true), destination);
    if (this.readyFired) this.maxUncovered = Math.max(this.maxUncovered, this.tiles.stats.uncovered);
    if (this.tiles.stats.failed !== this.failedTiles) {
      this.failedTiles = this.tiles.stats.failed;
      this.events.tilesFailed(this.failedTiles);
    }
    this.drawFrame();
    this.drawRoad();
    this.overlay.reduceMotion = reduceMotion();
    this.overlay.update(this.camera, this.view, { selected: this.selected, hovered: this.hovered }, now);
    this.layer?.update(this.camera, this.view, now);
    if (this.live) {
      this.wash.paint(this.app.renderer, this.camera, this.view, this.data.store, this.live, this.live.time());
      const next = this.live.nextChange();
      this.liveDue = Number.isFinite(next) ? now + next : Infinity;
    } else {
      this.wash.sprite.visible = false;
      this.wash.pending = false;
      this.liveDue = Infinity;
    }
    this.requestChunks();
    if (this.readyFired) this.loadInBackground();
    this.app.render();
    const distance = distanceFor(this.camera.scale);
    this.events.camera({ scale: this.camera.scale, minScale: this.camera.minScale, distance });
    if (!this.readyFired && this.tiles.complete && ![...this.chunks.values()].includes('loading')) {
      this.readyFired = true;
      // One more frame so the last fade has reached the canvas before anyone looks.
      this.readyFrames = 2;
    }
  }

  /** The sheet's edge: deeper paper outside the surveyed square and a double neatline around it. */
  private drawFrame(): void {
    const b = this.data.geo.bounds;
    const a = this.camera.worldToScreen(b.minX, b.minY, this.view);
    const c = this.camera.worldToScreen(b.maxX, b.maxY, this.view);
    const g = this.frame;
    g.clear();
    const W = this.view.width;
    const H = this.view.height;
    const outside = PAPER_DEEP;
    if (a.y > 0) g.rect(0, 0, W, a.y).fill(outside);
    if (c.y < H) g.rect(0, c.y, W, H - c.y).fill(outside);
    if (a.x > 0) g.rect(0, Math.max(0, a.y), a.x, Math.min(H, c.y) - Math.max(0, a.y)).fill(outside);
    if (c.x < W) g.rect(c.x, Math.max(0, a.y), W - c.x, Math.min(H, c.y) - Math.max(0, a.y)).fill(outside);
    g.rect(a.x, a.y, c.x - a.x, c.y - a.y).stroke({ color: INK, width: 1.6, alpha: 0.85 });
    g.rect(a.x - 5, a.y - 5, c.x - a.x + 10, c.y - a.y + 10).stroke({ color: INK, width: 0.8, alpha: 0.7 });
  }

  /**
   * The chosen road: a hand-drawn dashed ink arc under the marks, on a pale paper bed so it reads over any wash. The arc
   * bows to one side fixed by the ends' order, so the same road is drawn the same way from either end.
   */
  private drawRoad(): void {
    const g = this.roadInk;
    g.clear();
    const road = this.road;
    if (!road) return;
    const a = this.camera.worldToScreen(road.ax, road.ay, this.view);
    const b = this.camera.worldToScreen(road.bx, road.by, this.view);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 4) return;
    const [p, q] = road.ax < road.bx || (road.ax === road.bx && road.ay <= road.by) ? [a, b] : [b, a];
    const bow = Math.min(90, length * 0.16);
    const cx = (p.x + q.x) / 2 + ((q.y - p.y) / length) * bow;
    const cy = (p.y + q.y) / 2 - ((q.x - p.x) / length) * bow;
    const steps = Math.max(12, Math.ceil(length / 4));
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      points.push({ x: u * u * p.x + 2 * u * t * cx + t * t * q.x, y: u * u * p.y + 2 * u * t * cy + t * t * q.y });
    }
    g.moveTo(points[0]!.x, points[0]!.y);
    for (const point of points.slice(1)) g.lineTo(point.x, point.y);
    g.stroke({ color: PAPER, width: 7, alpha: 0.55, cap: 'round', join: 'round' });
    // Dashes of ink 10 px long with 6 px gaps, measured along the curve.
    const dash = 10;
    const gap = 6;
    let drawing = true;
    let left = dash;
    g.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) {
      let from = points[i - 1]!;
      const to = points[i]!;
      let segment = Math.hypot(to.x - from.x, to.y - from.y);
      while (segment > 0) {
        const take = Math.min(left, segment);
        const k = take / segment;
        const next = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
        if (drawing) g.lineTo(next.x, next.y);
        else g.moveTo(next.x, next.y);
        segment -= take;
        left -= take;
        from = next;
        if (left <= 1e-6) {
          drawing = !drawing;
          left = drawing ? dash : gap;
        }
      }
    }
    g.stroke({ color: INK, width: 2.4, alpha: 0.88, cap: 'round', join: 'round' });
  }

  private visibleRegions(): Set<number> {
    const box = this.camera.visibleBox(this.view, 0);
    const out = new Set<number>();
    for (const region of this.data.geo.regions) {
      if (region.x + region.r < box.minX || region.x - region.r > box.maxX || region.y + region.r < box.minY || region.y - region.r > box.maxY) continue;
      out.add(region.index);
    }
    return out;
  }

  private loadRegion(region: number): Promise<void> {
    this.chunks.set(region, 'loading');
    return this.data.loadChunk(region).then(
      () => {
        if (this.disposed) return;
        this.chunks.delete(region);
        this.live?.regionLoaded(region);
        this.dirty = true;
      },
      (error: unknown) => {
        if (this.disposed) return;
        this.chunks.set(region, 'failed');
        this.events.chunkFailed(region);
        this.dirty = true;
        throw error;
      },
    );
  }

  /**
   * With a live frame on the map, the towns and villages of every land are read quietly after the first view, one
   * land at a time, nearest the centre of the view first: their washes and the pencil places around them need
   * their positions even when the camera is far out. Capitals and cities were already in the first view (R10).
   */
  private loadInBackground(): void {
    if (!this.live?.frame || this.backgroundLoading || [...this.chunks.values()].includes('loading')) return;
    const c = this.camera.screenToWorld(this.view.width / 2, this.view.height / 2, this.view);
    const next = this.data.geo.regions
      .filter((region) => !this.data.store.hasRegion(region.index) && !this.chunks.has(region.index))
      .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - a.r - (Math.hypot(b.x - c.x, b.y - c.y) - b.r) || a.index - b.index)[0];
    if (!next) return;
    this.backgroundLoading = true;
    const run = () => {
      this.backgroundCancel = null;
      if (this.disposed || this.pausedAt !== null) {
        this.backgroundLoading = false;
        return;
      }
      void this.loadRegion(next.index).catch(() => undefined).finally(() => {
        this.backgroundLoading = false;
        if (!this.disposed) this.dirty = true;
      });
    };
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(run, { timeout: 1500 });
      this.backgroundCancel = () => cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(run, 200);
      this.backgroundCancel = () => window.clearTimeout(handle);
    }
  }

  /** Towns and villages arrive per language region once the camera is close enough to mark them. */
  private requestChunks(): void {
    if (markedTiers(this.camera.scale) < 3) return;
    const box = this.camera.visibleBox(this.view, 120);
    for (const region of this.data.geo.regions) {
      if (this.data.store.hasRegion(region.index) || this.chunks.has(region.index)) continue;
      if (region.x + region.r < box.minX || region.x - region.r > box.maxX || region.y + region.r < box.minY || region.y - region.r > box.maxY) continue;
      void this.loadRegion(region.index).catch(() => undefined);
    }
  }

  /**
   * A resize keeps the world point at the middle of the free area where it was (a phone turning, a window
   * dragged), ends any held gesture, and lets a flight in progress land with the new size.
   */
  private resize(): void {
    if (this.disposed) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height || (width === this.view.width && height === this.view.height)) return;
    const focus = focusOf(this.camera.snapshot(), this.view, this.insets());
    this.view = { width, height };
    this.gestures.reset();
    this.app.renderer.resize(width, height);
    this.wash.resize(this.view);
    this.camera.resize(this.view);
    this.tiles.setHome(this.homeCamera().snapshot(), this.view);
    this.place(centreForFocus({ ...focus, scale: this.camera.scale }, this.view, this.insets()));
    if (this.hero) {
      this.heroBase = this.camera.snapshot();
      this.heroElapsed = 0;
      this.heroLastFrame = 0;
    }
  }

  // ── Context loss ───────────────────────────────────────────────────────────────────────────────

  /**
   * Pixi keeps its textures' sources and re-uploads them when the context comes back; the map pauses drawing
   * meanwhile and then repaints everything (the wash is redrawn every frame). If the context does not come back in
   * time, the page rebuilds the map from `cameraState()` and its selection (R10).
   */
  private bindContext(): void {
    const canvas = this.app.canvas;
    this.listen(canvas, 'webglcontextlost', () => {
      if (this.disposed) return;
      this.lost = true;
      this.contextLosses++;
      this.resetInput();
      this.events.context('lost');
      window.clearTimeout(this.lostTimer);
      this.lostTimer = window.setTimeout(() => {
        if (this.lost && !this.disposed) this.events.context('failed');
      }, CONTEXT_GRACE_MS);
    });
    this.listen(canvas, 'webglcontextrestored', () => {
      if (this.disposed) return;
      window.clearTimeout(this.lostTimer);
      if (!this.lost) return;
      this.lost = false;
      this.heroLastFrame = 0;
      this.dirty = true;
      this.events.context('restored');
    });
  }

  // ── Input ──────────────────────────────────────────────────────────────────────────────────────

  private local(event: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private listen<T extends EventTarget>(target: T, type: string, handler: (event: never) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler as EventListener, options);
    this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  private tap(x: number, y: number, type: string): void {
    if (!this.acceptsInput()) return;
    const slop = type === 'mouse' ? 4 : 14;
    const settler = this.overlay.pick(x, y, slop);
    const dab = settler ? null : this.overlay.pickDab(x, y, slop);
    if (dab) this.events.selectDab(dab);
    else this.events.select(settler);
  }

  private bindInput(): void {
    const host = this.host;
    const dragging = () => {
      if (this.gestures.touching) host.dataset.dragging = 'true';
      else delete host.dataset.dragging;
    };
    this.listen(host, 'pointerdown', (event: PointerEvent) => {
      if (!this.acceptsInput()) return;
      this.lastPointer = event.pointerType;
      const p = this.local(event);
      if (!this.gestures.down(event.pointerId, p.x, p.y, event.pointerType, event.button)) return;
      try {
        host.setPointerCapture(event.pointerId);
        this.captured.add(event.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; its up or cancel still arrives.
      }
      dragging();
    });
    this.listen(host, 'pointermove', (event: PointerEvent) => {
      if (!this.acceptsInput()) return;
      const p = this.local(event);
      if (this.gestures.touching) this.gestures.move(event.pointerId, p.x, p.y);
      else if (event.pointerType === 'mouse') this.hover(p.x, p.y);
    });
    this.listen(host, 'pointerup', (event: PointerEvent) => {
      this.captured.delete(event.pointerId);
      if (!this.acceptsInput()) return;
      this.gestures.up(event.pointerId);
      dragging();
    });
    const cancel = (event: PointerEvent) => {
      this.captured.delete(event.pointerId);
      if (!this.acceptsInput()) return;
      this.gestures.cancel(event.pointerId);
      dragging();
    };
    this.listen(host, 'pointercancel', cancel);
    this.listen(host, 'lostpointercapture', cancel);
    this.listen(host, 'pointerleave', () => {
      if (!this.acceptsInput()) return;
      if (this.hovered) {
        this.hovered = null;
        delete host.dataset.hover;
        this.dirty = true;
      }
    });
    const end = () => this.resetInput();
    this.listen(window, 'blur', end);
    this.listen(document, 'visibilitychange', () => {
      this.syncPaused();
    });
    this.listen(host, 'wheel', (event: WheelEvent) => {
      if (!this.acceptsInput() || !this.wheel) return;
      event.preventDefault();
      const p = this.local(event);
      this.gestures.wheel(event.deltaY, event.deltaMode, event.ctrlKey, p.x, p.y);
    }, { passive: false });
    this.listen(host, 'dblclick', (event: MouseEvent) => {
      if (!this.acceptsInput()) return;
      // Mobile browsers also send dblclick for a double tap on an unzoomable page; the tap already zoomed once.
      if (this.lastPointer !== 'mouse') return;
      const p = this.local(event);
      this.zoomBy(event.shiftKey ? 0.5 : 2, p.x, p.y);
    });
    this.listen(host, 'keydown', (event: KeyboardEvent) => {
      if (!this.acceptsInput()) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = Math.round(Math.min(this.view.width, this.view.height) * 0.18);
      switch (event.key) {
        case 'ArrowLeft': this.pan(step, 0); break;
        case 'ArrowRight': this.pan(-step, 0); break;
        case 'ArrowUp': this.pan(0, step); break;
        case 'ArrowDown': this.pan(0, -step); break;
        case '+': case '=': this.zoomBy(1.8); break;
        case '-': case '_': this.zoomBy(1 / 1.8); break;
        case '0': case 'Home': this.home(); break;
        case '1': this.toDistance('world'); break;
        case '2': this.toDistance('continent'); break;
        case '3': this.toDistance('realm'); break;
        case '4': this.toDistance('kingdom'); break;
        default: return;
      }
      event.preventDefault();
    });
  }

  private hover(x: number, y: number): void {
    const settler = this.overlay.pick(x, y, 4);
    const pointing = !!settler || !!this.overlay.pickDab(x, y, 4);
    if (pointing) this.host.dataset.hover = 'true';
    else delete this.host.dataset.hover;
    if (settler === this.hovered) return;
    this.hovered = settler;
    this.dirty = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.lostTimer);
    this.backgroundCancel?.();
    this.backgroundCancel = null;
    this.resetInput();
    this.observer.disconnect();
    delete this.host.dataset.atlasLiveWork;
    for (const undo of this.cleanup) undo();
    this.farm.dispose();
    this.tiles.dispose();
    this.overlay.dispose();
    this.wash.dispose();
    this.app.destroy(true, { children: true });
    this.sheet?.close();
  }
}
