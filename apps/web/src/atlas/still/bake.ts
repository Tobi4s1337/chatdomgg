import type { BakeMessage, BakeReply, InitMessage } from '../map/bake.worker';
import { SOFTWARE, TilePainter, type PaintScene, type Stamp } from '../map/paint';
import { TILE_PX, type TileKey } from '../map/pyramid';

/** A baked land tile: a worker's bitmap, or a canvas painted on the main thread. */
export type Baked = ImageBitmap | HTMLCanvasElement;

/** A baker that has not answered in this long is taken for lost; its tile is tried once more elsewhere. */
const BAKE_TIMEOUT_MS = 45_000;

interface Job { key: TileKey; tries: number; resolve: (tile: Baked | null) => void }
interface Slot { worker: Worker; job: { id: number; job: Job; timer: ReturnType<typeof setTimeout> } | null; dead: boolean }

/**
 * Bakes the still's land with the moving map's own bakers (`map/bake.worker.ts`, the same scene, stamp sheet and
 * TilePainter), so the still is the same drawing of the same revision. The map's TileFarm lives beside its Pixi tile
 * layer, so the still speaks the worker protocol itself and keeps Pixi out of its chunk. A worker that fails to start,
 * errors or goes silent is dropped and its tile handed on; with no worker left (or none possible), the painter runs on
 * the main thread one tile per task, so the page keeps answering while it inks.
 */
export class StillBaker {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private nextId = 1;
  private painter: Promise<TilePainter | null> | null = null;
  private painting = false;
  private disposed = false;

  constructor(private readonly scene: Omit<PaintScene, 'stamps'>, private readonly stampsUrl: string, private readonly stamps: Stamp[], private readonly pixelRatio: number) {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    const count = Math.max(1, Math.min(4, cores - 1));
    for (let i = 0; i < count; i++) {
      let worker: Worker;
      try {
        worker = new Worker(new URL('../map/bake.worker.ts', import.meta.url), { type: 'module', name: `atlas-still-baker-${i}` });
      } catch {
        continue;
      }
      const slot: Slot = { worker, job: null, dead: false };
      worker.onmessage = (event: MessageEvent<BakeReply>) => this.reply(slot, event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        this.lose(slot);
      };
      worker.onmessageerror = () => this.lose(slot);
      worker.postMessage({ type: 'init', scene, stampsUrl, stamps } satisfies InitMessage);
      this.slots.push(slot);
    }
  }

  /** Bake one tile; resolves with null when it could not be baked (the caller falls back to an ancestor). */
  bake(key: TileKey): Promise<Baked | null> {
    if (this.disposed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.queue.push({ key, tries: 0, resolve });
      this.pump();
    });
  }

  private pump(): void {
    if (this.disposed) return;
    const live = this.slots.filter((slot) => !slot.dead);
    if (!live.length) {
      void this.paintHere();
      return;
    }
    for (const slot of live) {
      if (slot.job) continue;
      const job = this.queue.shift();
      if (!job) return;
      const id = this.nextId++;
      slot.job = { id, job, timer: setTimeout(() => this.lose(slot), BAKE_TIMEOUT_MS) };
      slot.worker.postMessage({ type: 'bake', id, key: job.key, pixelRatio: this.pixelRatio } satisfies BakeMessage);
    }
  }

  private reply(slot: Slot, message: BakeReply): void {
    if (message.type === 'ready') return;
    const current = slot.job;
    if (!current || current.id !== message.id || this.disposed) {
      if (message.type === 'baked') message.bitmap.close();
      return;
    }
    clearTimeout(current.timer);
    slot.job = null;
    current.job.resolve(message.type === 'baked' ? message.bitmap : null);
    this.pump();
  }

  private lose(slot: Slot): void {
    if (slot.dead) return;
    slot.dead = true;
    slot.worker.terminate();
    const current = slot.job;
    slot.job = null;
    if (current) {
      clearTimeout(current.timer);
      current.job.tries++;
      if (current.job.tries < 2) this.queue.unshift(current.job);
      else current.job.resolve(null);
    }
    this.pump();
  }

  /** The main-thread painter, with the stamp sheet decoded here (or without stamps if the sheet cannot be read). */
  private mainPainter(): Promise<TilePainter | null> {
    this.painter ??= (async () => {
      let image: CanvasImageSource | null = null;
      try {
        const response = await fetch(this.stampsUrl);
        if (response.ok) image = await createImageBitmap(await response.blob());
      } catch {
        image = null;
      }
      return new TilePainter({ ...this.scene, stamps: image ? { image, stamps: this.stamps } : null }, (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      });
    })().catch(() => null);
    return this.painter;
  }

  private async paintHere(): Promise<void> {
    if (this.painting) return;
    this.painting = true;
    const painter = await this.mainPainter();
    while (!this.disposed) {
      const job = this.queue.shift();
      if (!job) break;
      // One tile per task: the page stays responsive while the land is inked.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.disposed) {
        job.resolve(null);
        break;
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.round(TILE_PX * this.pixelRatio);
      const ctx = canvas.getContext('2d', SOFTWARE) as CanvasRenderingContext2D | null;
      if (!painter || !ctx) {
        job.resolve(null);
        continue;
      }
      try {
        painter.paint(ctx, job.key, this.pixelRatio);
        job.resolve(canvas);
      } catch {
        job.resolve(null);
      }
    }
    this.painting = false;
  }

  /** Stops every baker; tiles still waiting resolve with null. */
  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) {
      if (slot.job) {
        clearTimeout(slot.job.timer);
        slot.job.job.resolve(null);
        slot.job = null;
      }
      slot.worker.terminate();
    }
    for (const job of this.queue.splice(0)) job.resolve(null);
  }
}
