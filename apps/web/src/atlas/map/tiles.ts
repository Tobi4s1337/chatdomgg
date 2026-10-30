import { Container, ImageSource, Sprite, Texture } from 'pixi.js';
import type { Box, Camera, Viewport } from './camera';
import type { BakeMessage, BakeReply, InitMessage } from './bake.worker';
import { SOFTWARE, TilePainter, type PaintScene, type Stamp } from './paint';
import { TILE_PX, levelFor, parentOf, tileBox, tileKey, tilesFor, type Pyramid, type TileKey } from './pyramid';

/**
 * Bakes land tiles off the main thread. Requests are re-prioritised every frame (what is on screen, nearest the
 * centre first); stale requests are dropped before they reach a worker. Without worker/OffscreenCanvas support
 * the same painter runs on the main thread, one tile per frame.
 */
export class TileFarm {
  private readonly workers: { worker: Worker; busy: boolean }[] = [];
  private readonly pending = new Map<number, TileKey>();
  private queue: TileKey[] = [];
  private readonly inFlight = new Set<string>();
  private nextId = 1;
  private fallback: TilePainter | null = null;
  private fallbackTimer = 0;
  private disposed = false;

  /** Called with every finished tile (or failure); set by the tile layer. */
  onBaked: (key: TileKey, bitmap: ImageBitmap | HTMLCanvasElement) => void = () => undefined;
  onFailed: (key: TileKey) => void = () => undefined;

  constructor(scene: Omit<PaintScene, 'stamps'>, stampsUrl: string, stamps: Stamp[], stampImage: () => Promise<CanvasImageSource | null>, private readonly pixelRatio: number) {
    const canWork = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    if (canWork) {
      const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
      const count = Math.max(1, Math.min(4, cores - 1));
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module', name: `atlas-baker-${i}` });
        const slot = { worker, busy: false };
        worker.onmessage = (event: MessageEvent<BakeReply>) => this.reply(slot, event.data);
        worker.onerror = () => {
          slot.busy = false;
        };
        worker.postMessage({ type: 'init', scene, stampsUrl, stamps } satisfies InitMessage);
        this.workers.push(slot);
      }
    } else {
      void stampImage().then((image) => {
        this.fallback = new TilePainter({ ...scene, stamps: image ? { image, stamps } : null }, (width, height) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          return canvas;
        });
        this.pump();
      });
    }
  }

  private reply(slot: { busy: boolean }, message: BakeReply): void {
    if (message.type === 'ready') return;
    slot.busy = false;
    const key = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (key && !this.disposed) {
      this.inFlight.delete(tileKey(key));
      if (message.type === 'baked') this.onBaked(key, message.bitmap);
      else this.onFailed(key);
    } else if (message.type === 'baked') message.bitmap.close();
    this.pump();
  }

  /** Replace the wish list: only these tiles, in this order, are worth baking now (stale wishes are dropped). */
  want(keys: TileKey[]): void {
    this.queue = keys.filter((key) => !this.inFlight.has(tileKey(key)));
    this.pump();
  }

  private pump(): void {
    if (this.disposed) return;
    if (this.workers.length) {
      for (const slot of this.workers) {
        if (slot.busy) continue;
        const key = this.queue.shift();
        if (!key) return;
        const id = this.nextId++;
        slot.busy = true;
        this.inFlight.add(tileKey(key));
        this.pending.set(id, key);
        slot.worker.postMessage({ type: 'bake', id, key, pixelRatio: this.pixelRatio } satisfies BakeMessage);
      }
      return;
    }
    if (!this.fallback || this.fallbackTimer) return;
    this.fallbackTimer = window.setTimeout(() => {
      this.fallbackTimer = 0;
      const key = this.queue.shift();
      if (!key || !this.fallback || this.disposed) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.round(TILE_PX * this.pixelRatio);
      const ctx = canvas.getContext('2d', SOFTWARE) as CanvasRenderingContext2D | null;
      if (ctx) {
        this.fallback.paint(ctx, key, this.pixelRatio);
        this.onBaked(key, canvas);
      } else this.onFailed(key);
      this.pump();
    }, 0);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.fallbackTimer);
    for (const slot of this.workers) slot.worker.terminate();
    this.pending.clear();
    this.queue = [];
  }
}

interface CachedTile {
  key: TileKey;
  texture: Texture;
  sprite: Sprite;
  bornAt: number;
  usedAt: number;
}

const FADE_MS = 240;

/**
 * Draws the land pyramid: the level that matches the screen, with the nearest baked ancestor beneath any tile
 * that is still being inked, so zooming never shows empty paper. Textures live in a bounded LRU.
 */
export class TileLayer {
  readonly container = new Container();
  private readonly back = new Container();
  private readonly front = new Container();
  private readonly cache = new Map<string, CachedTile>();
  private readonly failed = new Set<string>();
  private onChange: () => void = () => undefined;
  /** True once every tile of the current view is baked and fully faded in. */
  complete = false;

  constructor(private readonly pyramid: Pyramid, private readonly farm: TileFarm, private readonly pixelRatio: number, private readonly capacity: number) {
    this.container.addChild(this.back, this.front);
    farm.onBaked = (key, bitmap) => {
      const id = tileKey(key);
      const texture = new Texture({ source: new ImageSource({ resource: bitmap, resolution: this.pixelRatio, scaleMode: 'linear' }) });
      const old = this.cache.get(id);
      if (old) {
        old.sprite.destroy();
        old.texture.destroy(true);
      }
      const now = performance.now();
      this.cache.set(id, { key, texture, sprite: new Sprite(texture), bornAt: now, usedAt: now });
      this.onChange();
    };
    farm.onFailed = (key) => {
      this.failed.add(tileKey(key));
      this.onChange();
    };
  }

  /** Tiles that could not be baked; they are not retried in this session and their ancestors stay drawn. */
  get failures(): number {
    return this.failed.size;
  }

  update(camera: Camera, view: Viewport, now: number, onChange: () => void): void {
    this.onChange = onChange;
    // Tiles are baked at the device density already, so the level is chosen per CSS pixel (ratio 1).
    const level = levelFor(this.pyramid, camera.scale, 1);
    const box: Box = camera.visibleBox(view, 8);
    const keys = tilesFor(this.pyramid, level, box);
    this.back.removeChildren();
    this.front.removeChildren();
    const wanted: TileKey[] = [];
    const ancestors = new Map<string, CachedTile>();
    let complete = true;
    for (const key of keys) {
      const id = tileKey(key);
      const tile = this.cache.get(id);
      if (tile) {
        tile.usedAt = now;
        const alpha = Math.min(1, (now - tile.bornAt) / FADE_MS);
        if (alpha < 1) complete = false;
        this.place(tile, camera, view, alpha);
        this.front.addChild(tile.sprite);
        if (alpha < 1) this.fallbackFor(key, ancestors, now);
        continue;
      }
      this.fallbackFor(key, ancestors, now);
      if (this.failed.has(id)) continue;
      complete = false;
      wanted.push(key);
    }
    for (const tile of [...ancestors.values()].sort((a, b) => a.key.level - b.key.level)) {
      this.place(tile, camera, view, 1);
      this.back.addChild(tile.sprite);
    }
    this.complete = complete;
    this.farm.want(wanted);
    this.evict(now);
  }

  private fallbackFor(key: TileKey, ancestors: Map<string, CachedTile>, now: number): void {
    for (let parent = parentOf(key); parent; parent = parentOf(parent)) {
      const id = tileKey(parent);
      const tile = this.cache.get(id);
      if (tile && now - tile.bornAt >= FADE_MS) {
        tile.usedAt = now;
        ancestors.set(id, tile);
        return;
      }
    }
  }

  /** Edges are rounded from shared screen positions, so neighbours meet without a hairline. */
  private place(tile: CachedTile, camera: Camera, view: Viewport, alpha: number): void {
    const box = tileBox(this.pyramid, tile.key);
    const a = camera.worldToScreen(box.minX, box.minY, view);
    const b = camera.worldToScreen(box.maxX, box.maxY, view);
    const x0 = Math.round(a.x * this.pixelRatio) / this.pixelRatio;
    const y0 = Math.round(a.y * this.pixelRatio) / this.pixelRatio;
    const x1 = Math.round(b.x * this.pixelRatio) / this.pixelRatio;
    const y1 = Math.round(b.y * this.pixelRatio) / this.pixelRatio;
    tile.sprite.position.set(x0, y0);
    tile.sprite.width = x1 - x0;
    tile.sprite.height = y1 - y0;
    tile.sprite.alpha = alpha;
  }

  private evict(now: number): void {
    if (this.cache.size <= this.capacity) return;
    const old = [...this.cache.entries()].filter(([, tile]) => tile.usedAt < now).sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [id, tile] of old.slice(0, this.cache.size - this.capacity)) {
      tile.sprite.destroy();
      tile.texture.destroy(true);
      this.cache.delete(id);
    }
  }

  dispose(): void {
    for (const tile of this.cache.values()) {
      tile.sprite.destroy();
      tile.texture.destroy(true);
    }
    this.cache.clear();
    this.container.destroy({ children: true });
  }
}
