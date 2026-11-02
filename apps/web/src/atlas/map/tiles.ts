import { Container, ImageSource, Sprite, Texture } from 'pixi.js';
import type { Viewport } from './camera';
import type { BakeMessage, BakeReply, InitMessage } from './bake.worker';
import { SOFTWARE, TilePainter, type PaintScene, type Stamp } from './paint';
import { TILE_PX, tileBox, tileKey, type Pyramid, type TileKey } from './pyramid';
import { homeTiles, planTiles, TileCache, tileBytes, type CameraState, type DrawnTile } from './tile-plan';

export type TileImage = ImageBitmap | HTMLCanvasElement;

/** The part of a Worker the farm talks to; tests drive the farm with stand-ins. */
export interface Baker {
  onmessage: ((event: MessageEvent<BakeReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: InitMessage | BakeMessage): void;
  terminate(): void;
}

export interface FarmClock {
  now(): number;
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface FarmOptions {
  /** Starts baker `index`; by default a module worker, when the browser has workers and OffscreenCanvas. */
  spawn?: (index: number) => Baker;
  /** Prepares the main-thread painter, used without workers or once they keep crashing. */
  bakeOnMain?: () => Promise<(key: TileKey) => TileImage>;
  clock?: FarmClock;
  workers?: number;
}

/** A failed tile is tried again after these delays, then reported as failed for good. */
export const RETRY_MS = [1500, 6000] as const;
/** Crashed workers replaced per farm before the main thread takes over. */
export const MAX_RESPAWNS = 3;
/**
 * A worker that stays silent this long is hung, and is treated like a crash (terminated, its tile retried, the
 * worker replaced). A tile paints in tens of milliseconds, so a bake gets 8 s from the moment the worker is ready;
 * getting ready (one same-origin stamp sheet) gets 20 s. A device too starved to meet these paints no worse on
 * the main thread, which is where the farm ends up after MAX_RESPAWNS.
 */
export const BAKE_DEADLINE_MS = 8000;
export const READY_DEADLINE_MS = 20_000;

const SYSTEM_CLOCK: FarmClock = {
  now: () => performance.now(),
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Slot {
  baker: Baker;
  job: { id: number; key: TileKey } | null;
  /** The worker has its scene and stamps; until then a posted bake waits behind them. */
  ready: boolean;
  /** The watchdog: whatever the worker owes next (ready, or the current bake) must come before it fires. */
  watch: unknown;
}

/** Frees a baked image now rather than whenever the collector gets to it. */
export function closeImage(image: TileImage): void {
  if ('close' in image) image.close();
  else image.width = image.height = 0;
}

/**
 * Bakes land tiles off the main thread. The wish list is replaced every frame (what is on screen, nearest the
 * centre first, then a flight's destination); stale wishes never reach a worker. A failed tile is retried after
 * RETRY_MS, then reported through onFailed. A crashed worker fails its tile and is replaced, MAX_RESPAWNS times;
 * after that, or without worker/OffscreenCanvas support, the same painter runs on the main thread, one tile a tick.
 * A worker that hangs without erroring is caught by a watchdog (READY_DEADLINE_MS, BAKE_DEADLINE_MS) and counts
 * as a crash, so no tile waits forever behind it.
 */
export class TileFarm {
  private readonly workers: Slot[] = [];
  private readonly clock: FarmClock;
  private readonly spawn: ((index: number) => Baker) | null;
  private readonly init: InitMessage;
  private readonly bakeOnMain: () => Promise<(key: TileKey) => TileImage>;
  /** The last wish list, and what of it is still to be sent. */
  private wishes: TileKey[] = [];
  private queue: TileKey[] = [];
  private readonly inFlight = new Set<string>();
  private readonly retries = new Map<string, { attempts: number; due: number }>();
  private nextId = 1;
  private spawned = 0;
  private respawns = 0;
  private main: ((key: TileKey) => TileImage) | null = null;
  private mainState: 'off' | 'loading' | 'ready' | 'broken' = 'off';
  private mainTimer: unknown = null;
  private wake: { at: number; handle: unknown } | null = null;
  private disposed = false;

  /** Called with every finished tile; set by the tile layer. */
  onBaked: (key: TileKey, image: TileImage) => void = () => undefined;
  /** Called once a tile has failed every retry. */
  onFailed: (key: TileKey) => void = () => undefined;

  constructor(
    scene: Omit<PaintScene, 'stamps'>,
    stampsUrl: string,
    stamps: Stamp[],
    stampImage: () => Promise<CanvasImageSource | null>,
    private readonly pixelRatio: number,
    options: FarmOptions = {},
  ) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.init = { type: 'init', scene, stampsUrl, stamps };
    const canWork = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    this.spawn = options.spawn ?? (canWork ? spawnWorker : null);
    this.bakeOnMain = options.bakeOnMain ?? (() => mainThreadBaker(scene, stamps, stampImage, pixelRatio));
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    this.count = options.workers ?? Math.max(1, Math.min(4, cores - 1));
  }

  /** How many bakers this farm runs once it has work. */
  private readonly count: number;
  private opened = false;

  /**
   * Bakers start with the first tile anyone wants, not with the farm: a map that took its opening land from the still
   * spends nothing on workers (each a copy of the scene and the stamp sheet) until it pans somewhere new.
   */
  private open(): void {
    if (this.opened || this.disposed) return;
    this.opened = true;
    if (this.spawn) for (let i = 0; i < this.count; i++) this.start();
    if (!this.workers.length) this.toMain();
  }

  private start(): boolean {
    if (!this.spawn) return false;
    let baker: Baker;
    try {
      baker = this.spawn(this.spawned++);
    } catch {
      return false;
    }
    const slot: Slot = { baker, job: null, ready: false, watch: null };
    baker.onmessage = (event) => this.reply(slot, event.data);
    baker.onerror = () => this.crash(slot);
    // The reply could not be read (the worker itself is fine): its tile failed.
    baker.onmessageerror = () => {
      if (!this.workers.includes(slot)) return;
      const job = slot.job;
      slot.job = null;
      this.disarm(slot);
      if (job) this.finish(job.key, null);
      this.pump();
    };
    this.workers.push(slot);
    this.arm(slot, READY_DEADLINE_MS);
    baker.postMessage(this.init);
    return true;
  }

  /** Starts the slot's watchdog over: if the worker says nothing for `ms`, it is hung. */
  private arm(slot: Slot, ms: number): void {
    this.disarm(slot);
    slot.watch = this.clock.set(() => {
      slot.watch = null;
      this.crash(slot);
    }, ms);
  }

  private disarm(slot: Slot): void {
    if (slot.watch === null) return;
    this.clock.clear(slot.watch);
    slot.watch = null;
  }

  private crash(slot: Slot): void {
    const index = this.workers.indexOf(slot);
    if (index < 0 || this.disposed) return;
    this.workers.splice(index, 1);
    this.disarm(slot);
    slot.baker.terminate();
    if (slot.job) this.finish(slot.job.key, null);
    slot.job = null;
    while (this.respawns < MAX_RESPAWNS) {
      this.respawns++;
      if (this.start()) break;
    }
    if (!this.workers.length) this.toMain();
    this.pump();
  }

  private reply(slot: Slot, message: BakeReply): void {
    if (message.type === 'ready') {
      if (slot.ready || this.disposed || !this.workers.includes(slot)) return;
      slot.ready = true;
      // The clock for a bake posted while it was getting ready starts now.
      if (slot.job) this.arm(slot, BAKE_DEADLINE_MS);
      else this.disarm(slot);
      return;
    }
    const job = slot.job;
    if (!job || job.id !== message.id || this.disposed || !this.workers.includes(slot)) {
      if (message.type === 'baked') message.bitmap.close();
      return;
    }
    slot.job = null;
    this.disarm(slot);
    this.finish(job.key, message.type === 'baked' ? message.bitmap : null);
    this.pump();
  }

  /** A tile is done: hand it over, or schedule its retry, or give it up. */
  private finish(key: TileKey, image: TileImage | null): void {
    const id = tileKey(key);
    this.inFlight.delete(id);
    if (image) {
      this.retries.delete(id);
      this.forget(id);
      this.onBaked(key, image);
      return;
    }
    const attempts = (this.retries.get(id)?.attempts ?? 0) + 1;
    const delay = RETRY_MS[attempts - 1];
    if (delay === undefined) {
      this.retries.delete(id);
      this.forget(id);
      this.onFailed(key);
      return;
    }
    this.retries.set(id, { attempts, due: this.clock.now() + delay });
    // Still wished for: back in the queue at its place, to go once its delay is over.
    const queued = new Set(this.queue.map(tileKey));
    this.queue = this.wishes.filter((wish) => queued.has(tileKey(wish)) || tileKey(wish) === id);
    this.schedule();
  }

  /**
   * A tile is settled: drop it from the wishes. Every frame asks again for tiles still baking (they are not in the
   * cache yet), so without this the next pump would bake a just-delivered tile a second time.
   */
  private forget(id: string): void {
    this.wishes = this.wishes.filter((wish) => tileKey(wish) !== id);
    this.queue = this.queue.filter((wish) => tileKey(wish) !== id);
  }

  /** One timer, for the earliest retry still to come. */
  private schedule(): void {
    const now = this.clock.now();
    let at = Infinity;
    for (const retry of this.retries.values()) if (retry.due > now) at = Math.min(at, retry.due);
    if (!Number.isFinite(at) || (this.wake && this.wake.at <= at)) return;
    if (this.wake) this.clock.clear(this.wake.handle);
    const handle = this.clock.set(() => {
      this.wake = null;
      this.pump();
      this.schedule();
    }, at - now);
    this.wake = { at, handle };
  }

  /** Replace the wish list: only these tiles, in this order, are worth baking now (stale wishes are dropped). */
  want(keys: TileKey[]): void {
    if (this.disposed) return;
    if (keys.length) this.open();
    this.wishes = keys.slice();
    this.queue = keys.slice();
    this.pump();
  }

  /** Takes the most wanted tile that is neither being baked nor waiting for its retry. */
  private next(): TileKey | null {
    const now = this.clock.now();
    const index = this.queue.findIndex((key) => {
      const id = tileKey(key);
      return !this.inFlight.has(id) && !((this.retries.get(id)?.due ?? 0) > now);
    });
    return index < 0 ? null : this.queue.splice(index, 1)[0]!;
  }

  private pump(): void {
    if (this.disposed) return;
    if (this.workers.length) {
      for (const slot of this.workers) {
        if (slot.job) continue;
        const key = this.next();
        if (!key) return;
        const id = this.nextId++;
        slot.job = { id, key };
        this.inFlight.add(tileKey(key));
        if (slot.ready) this.arm(slot, BAKE_DEADLINE_MS);
        slot.baker.postMessage({ type: 'bake', id, key, pixelRatio: this.pixelRatio } satisfies BakeMessage);
      }
      return;
    }
    if (this.mainState === 'broken') {
      // Nothing can bake on this device: every wish fails for good, once (the layer stops asking).
      const keys = this.queue;
      this.queue = [];
      for (const key of keys) this.onFailed(key);
      return;
    }
    if (this.mainState !== 'ready' || this.mainTimer !== null || !this.queue.length) return;
    this.mainTimer = this.clock.set(() => {
      this.mainTimer = null;
      const key = this.next();
      if (!key || !this.main || this.disposed) return;
      let image: TileImage | null;
      try {
        image = this.main(key);
      } catch {
        image = null;
      }
      this.finish(key, image);
      this.pump();
    }, 0);
  }

  private toMain(): void {
    if (this.mainState !== 'off' || this.disposed) return;
    this.mainState = 'loading';
    void this.bakeOnMain().then(
      (bake) => {
        this.main = bake;
        this.mainState = 'ready';
        this.pump();
      },
      () => {
        this.mainState = 'broken';
        this.pump();
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    if (this.mainTimer !== null) this.clock.clear(this.mainTimer);
    if (this.wake) this.clock.clear(this.wake.handle);
    for (const slot of this.workers) {
      this.disarm(slot);
      slot.baker.terminate();
    }
    this.workers.length = 0;
    this.wishes = [];
    this.queue = [];
    this.inFlight.clear();
    this.retries.clear();
  }
}

function spawnWorker(index: number): Baker {
  return new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module', name: `atlas-baker-${index}` });
}

async function mainThreadBaker(scene: Omit<PaintScene, 'stamps'>, stamps: Stamp[], stampImage: () => Promise<CanvasImageSource | null>, pixelRatio: number): Promise<(key: TileKey) => TileImage> {
  const image = await stampImage().catch(() => null);
  const makeCanvas = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const painter = new TilePainter({ ...scene, stamps: image ? { image, stamps } : null }, makeCanvas);
  return (key) => {
    const size = Math.round(TILE_PX * pixelRatio);
    const canvas = makeCanvas(size, size);
    const ctx = canvas.getContext('2d', SOFTWARE) as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('No 2D context.');
    painter.paint(ctx, key, pixelRatio);
    return canvas;
  };
}

interface LandTile {
  key: TileKey;
  image: TileImage;
  texture: Texture;
  sprite: Sprite;
  bornAt: number;
  unseen: boolean;
}

export interface TileStats {
  /** Visible tiles with paper showing through (should stay 0 once the root tile is baked). */
  uncovered: number;
  fading: number;
  /** Textures held, and their bytes. */
  tiles: number;
  bytes: number;
  /** Tiles that failed every retry. */
  failed: number;
  wanted: number;
}

function releaseTile(tile: LandTile): void {
  tile.sprite.destroy();
  tile.texture.destroy(true);
  closeImage(tile.image);
}

/**
 * Draws the land pyramid as `planTiles` decides: the level that matches the screen in front, fading in over its
 * stand-ins (ancestors, and on the way out cached descendants), so zooming and panning never show empty paper.
 * Textures live in a byte-bounded LRU that never drops a tile the current frame draws.
 */
export class TileLayer {
  readonly container = new Container();
  private readonly back = new Container();
  private readonly front = new Container();
  private readonly cache: TileCache<LandTile>;
  private readonly failed = new Set<string>();
  private home: TileKey[] = [];
  private onChange: () => void = () => undefined;
  /** True once every tile of the current view is baked and fully faded in. */
  complete = false;
  stats: TileStats = { uncovered: 0, fading: 0, tiles: 0, bytes: 0, failed: 0, wanted: 0 };

  constructor(private readonly pyramid: Pyramid, private readonly farm: TileFarm, private readonly pixelRatio: number, budgetBytes: number) {
    this.container.addChild(this.back, this.front);
    this.cache = new TileCache<LandTile>(budgetBytes, tileBytes(pixelRatio), releaseTile);
    farm.onBaked = (key, image) => {
      const texture = new Texture({ source: new ImageSource({ resource: image, resolution: this.pixelRatio, scaleMode: 'linear' }) });
      this.cache.put(tileKey(key), { key, image, texture, sprite: new Sprite(texture), bornAt: performance.now(), unseen: true });
      this.onChange();
    };
    farm.onFailed = (key) => {
      this.failed.add(tileKey(key));
      this.onChange();
    };
  }

  /**
   * Take tiles already baked elsewhere (the still's, from the same scene at the same pixel ratio), so the opening view
   * is never baked twice. They arrive fully faded in; the layer owns them from here.
   */
  seed(tiles: readonly { key: TileKey; image: TileImage }[]): void {
    for (const { key, image } of tiles) {
      const id = tileKey(key);
      if (this.cache.get(id)) {
        closeImage(image);
        continue;
      }
      const texture = new Texture({ source: new ImageSource({ resource: image, resolution: this.pixelRatio, scaleMode: 'linear' }) });
      // Already on screen as the still: drawn at once, without a fade in.
      this.cache.put(id, { key, image, texture, sprite: new Sprite(texture), bornAt: Number.NEGATIVE_INFINITY, unseen: false });
    }
    if (tiles.length) this.onChange();
  }

  /** Tiles that failed every retry; their stand-ins stay drawn until `retryFailed`. */
  get failures(): number {
    return this.failed.size;
  }

  /** Asks for the failed tiles again (each gets a fresh round of retries). */
  retryFailed(): void {
    if (!this.failed.size) return;
    this.failed.clear();
    this.onChange();
  }

  /** The opening view of this screen: its tiles stay cached, so the way home is never a magnified root. */
  setHome(home: CameraState, view: Viewport): void {
    this.home = homeTiles(this.pyramid, home, view);
    this.onChange();
  }

  /** `prefetch` is the destination of a flight in progress: its tiles are baked after the visible ones. */
  update(camera: CameraState, view: Viewport, now: number, onChange: () => void, prefetch: CameraState | null = null): void {
    this.onChange = onChange;
    const plan = planTiles({ pyramid: this.pyramid, camera, view, now, ready: this.cache, failed: this.failed, prefetch, capacity: this.cache.capacity, home: this.home });
    for (const id of plan.reveal) {
      const tile = this.cache.get(id);
      if (tile) tile.bornAt = now;
    }
    this.cache.use(plan.keep, plan.warm);
    this.back.removeChildren();
    this.front.removeChildren();
    for (const drawn of plan.back) this.draw(drawn, this.back, camera, view);
    for (const drawn of plan.front) this.draw(drawn, this.front, camera, view);
    this.complete = plan.complete;
    this.stats = { uncovered: plan.uncovered, fading: plan.fading, tiles: this.cache.count, bytes: this.cache.bytes, failed: this.failed.size, wanted: plan.wanted.length };
    this.farm.want(plan.wanted);
  }

  /** Edges are rounded from shared screen positions, so neighbours (and stand-ins) meet without a hairline. */
  private draw(drawn: DrawnTile, layer: Container, camera: CameraState, view: Viewport): void {
    const tile = this.cache.get(drawn.id);
    if (!tile) return;
    tile.unseen = false;
    const box = tileBox(this.pyramid, tile.key);
    const snap = (world: number, centre: number, half: number) => Math.round(((world - centre) * camera.scale + half) * this.pixelRatio) / this.pixelRatio;
    const x0 = snap(box.minX, camera.x, view.width / 2);
    const y0 = snap(box.minY, camera.y, view.height / 2);
    const x1 = snap(box.maxX, camera.x, view.width / 2);
    const y1 = snap(box.maxY, camera.y, view.height / 2);
    tile.sprite.position.set(x0, y0);
    tile.sprite.width = x1 - x0;
    tile.sprite.height = y1 - y0;
    tile.sprite.alpha = drawn.alpha;
    layer.addChild(tile.sprite);
  }

  dispose(): void {
    this.back.removeChildren();
    this.front.removeChildren();
    this.cache.clear();
    this.container.destroy({ children: true });
  }
}
