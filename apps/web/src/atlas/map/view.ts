import { Application, Container, Graphics, ImageSource } from 'pixi.js';
import { decodeRings, type Geography, type Settler, type SettlerStore } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import stampSheetUrl from '../assets/stamps.webp?url';
import stampSheet from '../assets/stamps.json';
import { Camera, distanceFor, NO_INSETS, type Distance, type Insets, type Viewport } from './camera';
import { markedTiers, Overlay } from './overlay';
import type { Stamp } from './paint';
import { pyramidFor } from './pyramid';
import { paintSceneFor } from './scene';
import { INK, PAPER_DEEP } from './theme';
import { TileFarm, TileLayer } from './tiles';

export interface MapEvents {
  /** The map has drawn its first complete view (land, holdings and type). Called once. */
  ready(): void;
  select(settler: Settler | null): void;
  camera(state: { scale: number; minScale: number; distance: Distance }): void;
  /** A region's towns and villages could not be read; the land stays, its smaller holdings stay unmarked. */
  chunkFailed(region: number): void;
}

export interface MapData {
  world: PreviewWorld;
  geo: Geography;
  store: SettlerStore;
  loadChunk(region: number): Promise<void>;
}

const stamps = (stampSheet as { stamps: Stamp[] }).stamps;
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

async function loadImage(url: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

interface ZoomFlight { from: number; to: number; sx: number; sy: number; start: number; duration: number }
interface PanFlight { fromX: number; fromY: number; toX: number; toY: number; start: number; duration: number }

/**
 * The drawn Atlas: one Pixi stage with the land pyramid, the paper margin and neatline, and the overlay of holdings
 * and type. It renders only when something changed, and owns every pointer, wheel and key gesture on the map.
 */
export class MapView {
  private readonly camera: Camera;
  private readonly tiles: TileLayer;
  private readonly farm: TileFarm;
  private readonly overlay: Overlay;
  private readonly frame = new Graphics();
  private readonly pointers = new Map<number, { x: number; y: number; type: string; downX: number; downY: number; at: number }>();
  private readonly chunks = new Map<number, 'loading' | 'failed'>();
  private readonly observer: ResizeObserver;
  private readonly cleanup: (() => void)[] = [];
  private view: Viewport;
  private dirty = true;
  private raf = 0;
  private readyFired = false;
  private selected: Settler | null = null;
  private hovered: Settler | null = null;
  private pinch: { distance: number; x: number; y: number } | null = null;
  private velocity = { x: 0, y: 0, at: 0 };
  private inertia: { vx: number; vy: number; last: number } | null = null;
  private zoomFlight: ZoomFlight | null = null;
  private panFlight: PanFlight | null = null;
  private storeVersion = -1;
  private disposed = false;

  private constructor(private readonly app: Application, private readonly host: HTMLElement, private readonly data: MapData, sheet: ImageBitmap | null, private readonly events: MapEvents, private readonly pixelRatio: number, private readonly homeInsets: (view: Viewport) => Insets) {
    this.view = { width: host.clientWidth || 1, height: host.clientHeight || 1 };
    this.camera = new Camera(data.geo.bounds);
    this.camera.home(this.view, this.insets());
    const phone = Math.min(this.view.width, this.view.height) < 600;
    const pyramid = pyramidFor(data.geo.bounds);
    const scene = paintSceneFor(data.world, data.geo, decodeRings(data.world));
    this.farm = new TileFarm(scene, stampSheetUrl, stamps, async () => sheet, pixelRatio);
    this.tiles = new TileLayer(pyramid, this.farm, pixelRatio, phone ? 140 : 260);
    const source = sheet ? new ImageSource({ resource: sheet, resolution: 1, scaleMode: 'linear', autoGenerateMipmaps: true }) : null;
    this.overlay = new Overlay(data.world, data.geo, data.store, source, stamps, pixelRatio);
    const root = new Container();
    root.addChild(this.tiles.container, this.frame, this.overlay.container);
    app.stage.addChild(root);
    host.appendChild(app.canvas);
    app.canvas.setAttribute('aria-hidden', 'true');
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.bindInput();
    this.loop();
  }

  private insets(): Insets {
    return this.homeInsets(this.view);
  }

  static async create(host: HTMLElement, data: MapData, events: MapEvents, homeInsets?: (view: Viewport) => Insets): Promise<MapView> {
    const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const app = new Application();
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
    const sheet = await loadImage(stampSheetUrl);
    return new MapView(app, host, data, sheet, events, pixelRatio, homeInsets ?? (() => NO_INSETS));
  }

  // ── Camera commands ────────────────────────────────────────────────────────────────────────────

  zoomBy(factor: number, sx = this.view.width / 2, sy = this.view.height / 2): void {
    this.stopMotion();
    const target = Math.min(this.camera.maxScale, Math.max(this.camera.minScale, this.camera.scale * factor));
    if (reduceMotion()) {
      this.camera.zoomAt(target / this.camera.scale, sx, sy, this.view);
      this.dirty = true;
      return;
    }
    this.zoomFlight = { from: this.camera.scale, to: target, sx, sy, start: performance.now(), duration: 260 };
    this.dirty = true;
  }

  home(): void {
    this.stopMotion();
    const before = this.camera.snapshot();
    this.camera.home(this.view, this.insets());
    const after = this.camera.snapshot();
    if (reduceMotion()) {
      this.dirty = true;
      return;
    }
    this.camera.x = before.x;
    this.camera.y = before.y;
    this.camera.scale = before.scale;
    this.flyTo(after.x, after.y, after.scale);
  }

  /** A short eased flight (no van Wijk yet): pan and zoom together, interruptible by any gesture. */
  private flyTo(x: number, y: number, scale: number): void {
    const start = performance.now();
    this.panFlight = { fromX: this.camera.x, fromY: this.camera.y, toX: x, toY: y, start, duration: 420 };
    this.zoomFlight = { from: this.camera.scale, to: scale, sx: this.view.width / 2, sy: this.view.height / 2, start, duration: 420 };
    this.dirty = true;
  }

  pan(dx: number, dy: number): void {
    this.stopMotion();
    this.camera.panBy(dx, dy, this.view);
    this.dirty = true;
  }

  select(settler: Settler | null, reveal?: { right: number; bottom: number }): void {
    this.selected = settler;
    this.dirty = true;
    if (!settler || !reveal) return;
    const at = this.camera.worldToScreen(settler.x, settler.y, this.view);
    const pad = 64;
    const maxX = this.view.width - reveal.right - pad;
    const maxY = this.view.height - reveal.bottom - pad;
    let dx = 0;
    let dy = 0;
    if (at.x > maxX) dx = at.x - maxX;
    if (at.x < pad) dx = at.x - pad;
    if (at.y > maxY) dy = at.y - maxY;
    if (at.y < pad + 60) dy = at.y - pad - 60;
    if (!dx && !dy) return;
    const toX = this.camera.x + dx / this.camera.scale;
    const toY = this.camera.y + dy / this.camera.scale;
    if (reduceMotion()) {
      this.camera.x = toX;
      this.camera.y = toY;
      return;
    }
    this.panFlight = { fromX: this.camera.x, fromY: this.camera.y, toX, toY, start: performance.now(), duration: 380 };
  }

  private stopMotion(): void {
    this.inertia = null;
    this.zoomFlight = null;
    this.panFlight = null;
  }

  // ── Frame loop ─────────────────────────────────────────────────────────────────────────────────

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let moving = false;
    if (this.zoomFlight) {
      const f = this.zoomFlight;
      const t = Math.min(1, (now - f.start) / f.duration);
      const target = f.from * (f.to / f.from) ** easeOut(t);
      if (this.panFlight) this.camera.scale = target;
      else this.camera.zoomAt(target / this.camera.scale, f.sx, f.sy, this.view);
      if (t >= 1) this.zoomFlight = null;
      moving = true;
    }
    if (this.panFlight) {
      const f = this.panFlight;
      const t = Math.min(1, (now - f.start) / f.duration);
      const e = easeOut(t);
      this.camera.x = f.fromX + (f.toX - f.fromX) * e;
      this.camera.y = f.fromY + (f.toY - f.fromY) * e;
      this.camera.clamp(this.view);
      if (t >= 1) this.panFlight = null;
      moving = true;
    }
    if (this.inertia) {
      const dt = Math.min(48, now - this.inertia.last);
      this.inertia.last = now;
      const decay = Math.exp(-dt / 260);
      this.camera.panBy(this.inertia.vx * dt, this.inertia.vy * dt, this.view);
      this.inertia.vx *= decay;
      this.inertia.vy *= decay;
      if (Math.hypot(this.inertia.vx, this.inertia.vy) < 0.02) this.inertia = null;
      moving = true;
    }
    if (this.data.store.version !== this.storeVersion) {
      this.storeVersion = this.data.store.version;
      this.dirty = true;
    }
    if (!moving && !this.dirty && this.tiles.complete) return;
    this.dirty = false;
    this.draw(now);
  };

  private draw(now: number): void {
    this.tiles.update(this.camera, this.view, now, () => (this.dirty = true));
    this.drawFrame();
    this.overlay.update(this.camera, this.view, { selected: this.selected, hovered: this.hovered });
    this.requestChunks();
    this.app.render();
    const distance = distanceFor(this.camera.scale);
    this.events.camera({ scale: this.camera.scale, minScale: this.camera.minScale, distance });
    if (!this.readyFired && this.tiles.complete && ![...this.chunks.values()].includes('loading')) {
      this.readyFired = true;
      // One more frame so the last fade has reached the canvas before anyone looks.
      requestAnimationFrame(() => requestAnimationFrame(() => this.events.ready()));
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

  /** Towns and villages arrive per language region once the camera is close enough to mark them. */
  private requestChunks(): void {
    if (markedTiers(this.camera.scale) < 3) return;
    const box = this.camera.visibleBox(this.view, 120);
    for (const region of this.data.geo.regions) {
      if (this.data.store.hasRegion(region.index) || this.chunks.has(region.index)) continue;
      if (region.x + region.r < box.minX || region.x - region.r > box.maxX || region.y + region.r < box.minY || region.y - region.r > box.maxY) continue;
      this.chunks.set(region.index, 'loading');
      this.data.loadChunk(region.index).then(
        () => {
          this.chunks.delete(region.index);
          this.dirty = true;
        },
        () => {
          this.chunks.set(region.index, 'failed');
          this.events.chunkFailed(region.index);
          this.dirty = true;
        },
      );
    }
  }

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height || (width === this.view.width && height === this.view.height)) return;
    this.view = { width, height };
    this.app.renderer.resize(width, height);
    this.camera.resize(this.view);
    this.dirty = true;
  }

  // ── Input ──────────────────────────────────────────────────────────────────────────────────────

  private local(event: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private listen<K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler as EventListener, options);
    this.cleanup.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  private bindInput(): void {
    const host = this.host;
    this.listen(host, 'pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      host.setPointerCapture(event.pointerId);
      this.stopMotion();
      const p = this.local(event);
      this.pointers.set(event.pointerId, { ...p, type: event.pointerType, downX: p.x, downY: p.y, at: performance.now() });
      this.velocity = { x: 0, y: 0, at: performance.now() };
      if (this.pointers.size === 2) this.pinch = this.pinchState();
      host.dataset.dragging = 'true';
    });
    this.listen(host, 'pointermove', (event) => {
      const p = this.local(event);
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) {
        if (event.pointerType === 'mouse') this.hover(p.x, p.y);
        return;
      }
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      pointer.x = p.x;
      pointer.y = p.y;
      if (this.pointers.size === 1) {
        this.camera.panBy(dx, dy, this.view);
        const now = performance.now();
        const dt = Math.max(1, now - this.velocity.at);
        this.velocity = { x: this.velocity.x * 0.6 + (dx / dt) * 0.4, y: this.velocity.y * 0.6 + (dy / dt) * 0.4, at: now };
      } else if (this.pointers.size === 2 && this.pinch) {
        const next = this.pinchState();
        this.camera.panBy(next.x - this.pinch.x, next.y - this.pinch.y, this.view);
        this.camera.zoomAt(next.distance / this.pinch.distance, next.x, next.y, this.view);
        this.pinch = next;
      }
      this.dirty = true;
    });
    const release = (event: PointerEvent, cancelled: boolean) => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) delete host.dataset.dragging;
      if (cancelled) return;
      const moved = Math.hypot(pointer.x - pointer.downX, pointer.y - pointer.downY);
      const held = performance.now() - pointer.at;
      if (moved < 6 && held < 600 && this.pointers.size === 0) {
        const settler = this.overlay.pick(pointer.x, pointer.y, pointer.type === 'mouse' ? 4 : 14);
        this.events.select(settler);
        return;
      }
      if (this.pointers.size === 0 && performance.now() - this.velocity.at < 80 && !reduceMotion()) {
        const speed = Math.hypot(this.velocity.x, this.velocity.y);
        if (speed > 0.15) this.inertia = { vx: this.velocity.x, vy: this.velocity.y, last: performance.now() };
      }
    };
    this.listen(host, 'pointerup', (event) => release(event, false));
    this.listen(host, 'pointercancel', (event) => release(event, true));
    this.listen(host, 'lostpointercapture', (event) => release(event, true));
    this.listen(host, 'pointerleave', () => {
      if (this.hovered) {
        this.hovered = null;
        delete host.dataset.hover;
        this.dirty = true;
      }
    });
    this.listen(window, 'blur', () => {
      this.pointers.clear();
      this.pinch = null;
      delete host.dataset.dragging;
    });
    this.listen(host, 'wheel', (event) => {
      event.preventDefault();
      this.stopMotion();
      const p = this.local(event);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.view.height : 1;
      const k = event.ctrlKey ? 0.01 : 0.0016;
      this.camera.zoomAt(Math.exp(-event.deltaY * unit * k), p.x, p.y, this.view);
      this.dirty = true;
    }, { passive: false });
    this.listen(host, 'dblclick', (event) => {
      const p = this.local(event);
      this.zoomBy(event.shiftKey ? 0.5 : 2, p.x, p.y);
    });
    this.listen(host, 'keydown', (event) => {
      const step = 96;
      switch (event.key) {
        case 'ArrowLeft': this.pan(step, 0); break;
        case 'ArrowRight': this.pan(-step, 0); break;
        case 'ArrowUp': this.pan(0, step); break;
        case 'ArrowDown': this.pan(0, -step); break;
        case '+': case '=': this.zoomBy(1.6); break;
        case '-': case '_': this.zoomBy(1 / 1.6); break;
        case '0': case 'Home': this.home(); break;
        default: return;
      }
      event.preventDefault();
    });
  }

  private hover(x: number, y: number): void {
    const settler = this.overlay.pick(x, y, 4);
    if (settler === this.hovered) return;
    this.hovered = settler;
    if (settler) this.host.dataset.hover = 'true';
    else delete this.host.dataset.hover;
    this.dirty = true;
  }

  private pinchState(): { distance: number; x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { distance: 1, x: 0, y: 0 };
    return { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    for (const undo of this.cleanup) undo();
    this.farm.dispose();
    this.tiles.dispose();
    this.overlay.dispose();
    this.app.destroy(true, { children: true });
  }
}
