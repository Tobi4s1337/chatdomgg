import type { Camera, Viewport } from './camera';
import { easeOut } from './motion';

/**
 * Every pointer and wheel gesture on the map, as one state machine over the float64 camera (Spec 01 R9; the
 * handler discipline of MapLibre's HandlerManager and OpenLayers' PinchZoom, reimplemented). It owns no DOM: the
 * view feeds it local CSS-px positions and a clock, and it moves the camera.
 *
 * - One pointer pans; the world point under it stays under it. Release with recent motion coasts (inertia).
 * - Two pointers pinch: the world point under their first centroid follows the centroid while the scale follows
 *   their spread, solved from the pinch's start every move, so it never drifts. Lifting one finger hands over to a
 *   pan from where that finger is, with no jump, no tap and no inertia from the pinch itself.
 * - A notched mouse wheel glides to its target around the pointer; a trackpad's fine deltas apply at once.
 * - Pointer cancel, lost capture, blur, hide and reset end every gesture: nothing keeps moving afterwards.
 */
export interface GestureHost {
  view(): Viewport;
  now(): number;
  reducedMotion(): boolean;
  /** A gesture began: stop any flight. */
  begin(): void;
  /** The camera moved. */
  changed(): void;
  /** A short press without movement (mouse click or touch tap). */
  tap(x: number, y: number, pointerType: string): void;
  /** A second touch tap close to the first: zoom in there. */
  doubleTap(x: number, y: number): void;
}

/** Movement under which a press is still a tap, by pointer type (CSS px); and the longest tap. */
export const TAP_SLOP = { mouse: 5, touch: 12 } as const;
export const TAP_MS = 600;
export const DOUBLE_TAP = { ms: 320, px: 32 } as const;
/** Inertia: samples from the last 100 ms, nothing if the pointer rested ≥ 60 ms, speed cap and decay time. */
export const INERTIA = { windowMs: 100, restMs: 60, minSpeed: 0.12, maxSpeed: 2.6, tau: 300, stopSpeed: 0.015 } as const;
/** Wheel: zoom per pixel of delta for a notched wheel and for a trackpad/ctrl pinch, and the glide time. */
export const WHEEL = { notch: 0.0021, fine: 0.0042, pinch: 0.011, glideMs: 200 } as const;

interface Pointer { id: number; x: number; y: number; downX: number; downY: number; at: number; type: string }
interface Pinch { wx: number; wy: number; distance: number; scale: number }
interface Glide { from: number; to: number; start: number; ax: number; ay: number; wx: number; wy: number }

/** A wheel event whose delta is a whole notch (lines, pages, or large integer pixel steps) rather than a trackpad. */
export function isNotched(deltaY: number, deltaMode: number): boolean {
  if (deltaMode !== 0) return true;
  const d = Math.abs(deltaY);
  // Chrome and Firefox report a mouse notch as 100/120 px (or ~4.000244 multiples on macOS); trackpads send small
  // and fractional deltas.
  return d >= 50 && (Number.isInteger(d) || Math.abs(d / 4.000244140625 - Math.round(d / 4.000244140625)) < 1e-6);
}

export class Gestures {
  private readonly pointers = new Map<number, Pointer>();
  private pinch: Pinch | null = null;
  /** True once this gesture has had two fingers down: it can no longer be a tap. */
  private pinched = false;
  private samples: { x: number; y: number; at: number }[] = [];
  private inertia: { vx: number; vy: number; last: number } | null = null;
  private glide: Glide | null = null;
  private lastTap: { x: number; y: number; at: number } | null = null;

  constructor(private readonly camera: Camera, private readonly host: GestureHost) {}

  /** A pointer is down or the camera is still coasting/gliding from one. */
  get active(): boolean {
    return this.pointers.size > 0 || !!this.inertia || !!this.glide;
  }

  get touching(): number {
    return this.pointers.size;
  }

  down(id: number, x: number, y: number, type: string, button = 0): boolean {
    if (type === 'mouse' && button !== 0) return false;
    // A third finger is ignored; the pinch stays with the first two.
    if (this.pointers.size >= 2) return false;
    this.host.begin();
    this.inertia = null;
    this.glide = null;
    const now = this.host.now();
    this.pointers.set(id, { id, x, y, downX: x, downY: y, at: now, type });
    this.samples = [{ x, y, at: now }];
    if (this.pointers.size === 2) this.startPinch();
    return true;
  }

  move(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    const view = this.host.view();
    if (this.pointers.size === 1) {
      if (!dx && !dy) return;
      this.camera.panBy(dx, dy, view);
      const now = this.host.now();
      this.samples.push({ x, y, at: now });
      while (this.samples.length > 2 && now - this.samples[0]!.at > INERTIA.windowMs) this.samples.shift();
    } else if (this.pinch) {
      const [a, b] = [...this.pointers.values()] as [Pointer, Pointer];
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const scale = Math.min(this.camera.maxScale, Math.max(this.camera.minScale, this.pinch.scale * (distance / this.pinch.distance)));
      this.camera.scale = scale;
      this.camera.x = this.pinch.wx - (cx - view.width / 2) / scale;
      this.camera.y = this.pinch.wy - (cy - view.height / 2) / scale;
      this.camera.clamp(view);
    }
    this.host.changed();
  }

  up(id: number): void {
    this.release(id, false);
  }

  cancel(id: number): void {
    this.release(id, true);
  }

  /** Blur, hidden page, resize of the host or unmount: every gesture ends where it is. */
  reset(): void {
    this.pointers.clear();
    this.pinch = null;
    this.pinched = false;
    this.samples = [];
    this.inertia = null;
    this.glide = null;
  }

  /** Stop coasting and gliding (a flight or a key took over); held pointers stay held. */
  stop(): void {
    this.inertia = null;
    this.glide = null;
  }

  wheel(deltaY: number, deltaMode: number, ctrlKey: boolean, x: number, y: number): void {
    this.host.begin();
    this.inertia = null;
    const view = this.host.view();
    const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? view.height : 1;
    const delta = deltaY * unit;
    const notched = !ctrlKey && isNotched(deltaY, deltaMode);
    const k = ctrlKey ? WHEEL.pinch : notched ? WHEEL.notch : WHEEL.fine;
    const factor = Math.exp(-delta * k);
    if (!notched || this.host.reducedMotion()) {
      this.glide = null;
      this.camera.zoomAt(factor, x, y, view);
      this.host.changed();
      return;
    }
    // A notch glides: successive notches extend the same glide, always around the latest pointer position.
    const current = this.camera.scale;
    const base = this.glide ? this.glide.to : current;
    const to = Math.min(this.camera.maxScale, Math.max(this.camera.minScale, base * factor));
    const anchor = this.camera.screenToWorld(x, y, view);
    this.glide = { from: current, to, start: this.host.now(), ax: x, ay: y, wx: anchor.x, wy: anchor.y };
    this.host.changed();
  }

  /** Advance inertia and wheel glides; true while the camera is moving by itself. */
  step(now: number): boolean {
    const view = this.host.view();
    let moving = false;
    if (this.glide) {
      const g = this.glide;
      const t = Math.min(1, (now - g.start) / WHEEL.glideMs);
      const scale = g.from * (g.to / g.from) ** easeOut(t);
      this.camera.scale = scale;
      this.camera.x = g.wx - (g.ax - view.width / 2) / scale;
      this.camera.y = g.wy - (g.ay - view.height / 2) / scale;
      this.camera.clamp(view);
      if (t >= 1) this.glide = null;
      moving = true;
    }
    if (this.inertia) {
      const dt = Math.min(48, Math.max(0, now - this.inertia.last));
      this.inertia.last = now;
      this.camera.panBy(this.inertia.vx * dt, this.inertia.vy * dt, view);
      const decay = Math.exp(-dt / INERTIA.tau);
      this.inertia.vx *= decay;
      this.inertia.vy *= decay;
      if (Math.hypot(this.inertia.vx, this.inertia.vy) < INERTIA.stopSpeed) this.inertia = null;
      moving = true;
    }
    if (moving) this.host.changed();
    return moving;
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()] as [Pointer, Pointer];
    const view = this.host.view();
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const anchor = this.camera.screenToWorld(cx, cy, view);
    this.pinch = { wx: anchor.x, wy: anchor.y, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: this.camera.scale };
    this.pinched = true;
    this.samples = [];
  }

  private release(id: number, cancelled: boolean): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    this.pointers.delete(id);
    const now = this.host.now();
    if (this.pointers.size === 1) {
      // Pinch to pan: the remaining finger pans from where it is now, with fresh samples.
      this.pinch = null;
      const rest = [...this.pointers.values()][0]!;
      this.samples = [{ x: rest.x, y: rest.y, at: now }];
      return;
    }
    const pinched = this.pinched;
    this.pinch = null;
    this.pinched = false;
    const samples = this.samples;
    this.samples = [];
    if (cancelled) return;
    const moved = Math.hypot(pointer.x - pointer.downX, pointer.y - pointer.downY);
    const slop = pointer.type === 'mouse' ? TAP_SLOP.mouse : TAP_SLOP.touch;
    if (!pinched && moved < slop && now - pointer.at < TAP_MS) {
      const last = this.lastTap;
      if (pointer.type !== 'mouse' && last && now - last.at < DOUBLE_TAP.ms && Math.hypot(pointer.x - last.x, pointer.y - last.y) < DOUBLE_TAP.px) {
        this.lastTap = null;
        this.host.doubleTap(pointer.x, pointer.y);
      } else {
        this.lastTap = { x: pointer.x, y: pointer.y, at: now };
        this.host.tap(pointer.x, pointer.y, pointer.type);
      }
      return;
    }
    if (pinched || this.host.reducedMotion()) return;
    const velocity = releaseVelocity(samples, now);
    if (velocity) this.inertia = { ...velocity, last: now };
  }
}

/** The pan velocity (CSS px per ms) at release, or null when the pointer had come to rest or barely moved. */
export function releaseVelocity(samples: readonly { x: number; y: number; at: number }[], now: number): { vx: number; vy: number } | null {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1]!;
  if (now - last.at >= INERTIA.restMs) return null;
  const recent = samples.filter((sample) => last.at - sample.at <= INERTIA.windowMs);
  const first = recent[0]!;
  const dt = last.at - first.at;
  if (dt <= 0) return null;
  let vx = (last.x - first.x) / dt;
  let vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);
  if (speed < INERTIA.minSpeed) return null;
  if (speed > INERTIA.maxSpeed) {
    vx *= INERTIA.maxSpeed / speed;
    vy *= INERTIA.maxSpeed / speed;
  }
  return { vx, vy };
}
