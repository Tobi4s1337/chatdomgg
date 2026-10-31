import type { Insets, Viewport } from './camera';

/**
 * Camera motion that keeps its promise (Spec 01 R9): van Wijk–Nuij flights bounded below three seconds, anchored
 * zoom steps, and the padding that keeps a target clear of a card or a phone's bottom sheet. Everything here is pure
 * and works on float64 world coordinates; the map view samples it once per frame.
 *
 * Flights are planned in focus coordinates: the world point at the centre of the free part of the screen (the view
 * minus its insets). The view converts focus to camera centre every frame with the insets of that frame, so a
 * resize or a sheet opening during a flight still lands the target where it was promised.
 */
export interface CameraState { x: number; y: number; scale: number }

export interface Flight {
  /** Milliseconds from start to arrival. */
  readonly duration: number;
  readonly from: CameraState;
  readonly to: CameraState;
  /** The focus at a time since the start; exactly `to` from `duration` on. */
  at(ms: number): CameraState;
}

/** Curve (rho) and speed of the arc. MapLibre's defaults are 1.42 and 1.2; ours is a little lower and calmer. */
export const FLIGHT = { curve: 1.36, speed: 1.25, minMs: 420, maxMs: 2_600, reducedMs: 200 } as const;
/** Zoom steps (buttons, keys, double-click) and the smoothing of a notched mouse wheel. */
export const ZOOM_STEP_MS = 260;

/** Smooth in and out, so the camera neither jerks away nor lands with a bump. */
export const easeInOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3);

export interface FlightOptions {
  /** Width of the free part of the screen, CSS px: what "one screen" means for the path. */
  width: number;
  /** The widest view (world units across the free width) the arc may rise to; usually the whole map. */
  maxWorldWidth?: number;
  reducedMotion?: boolean;
  curve?: number;
  speed?: number;
}

/**
 * The van Wijk and Nuij optimal path between two views: zoom out just enough to see both, travel, zoom in. Its length
 * S sets the duration (S / speed seconds), bounded to [minMs, maxMs]. The arc's peak is bounded by `maxWorldWidth`
 * by lowering the curve, as MapLibre does for its minZoom. Equal centres reduce to a pure zoom; equal views take the
 * minimum time and stay put. With reduced motion the camera makes one short composed move with no arc.
 */
export function planFlight(from: CameraState, to: CameraState, options: FlightOptions): Flight {
  const width = Math.max(1, options.width);
  const w0 = width / from.scale;
  const w1 = width / to.scale;
  const u1 = Math.hypot(to.x - from.x, to.y - from.y);
  const done = (duration: number, path: (k: number) => CameraState): Flight => ({
    duration,
    from,
    to,
    at: (ms) => (ms >= duration ? { ...to } : path(easeInOut(Math.max(0, ms) / duration))),
  });

  if (options.reducedMotion) {
    return done(FLIGHT.reducedMs, (k) => ({
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k,
      scale: from.scale * (to.scale / from.scale) ** k,
    }));
  }

  let rho = options.curve ?? FLIGHT.curve;
  const speed = options.speed ?? FLIGHT.speed;
  // Below a hundredth of a pixel of travel the path is a pure zoom (or no move at all).
  if (u1 * Math.min(from.scale, to.scale) < 0.01) {
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    const duration = bounded(S / speed);
    return done(duration, (k) => ({
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k,
      scale: from.scale * (to.scale / from.scale) ** k,
    }));
  }

  const peak = (r: number) => {
    const r0 = arcR(w0, w1, u1, r, 0);
    // w(s) = w0·cosh(r0)/cosh(ρs + r0) peaks at ρs + r0 = 0 when that lies on the path (r0 ≤ 0 ≤ r1).
    return r0 < 0 && arcR(w0, w1, u1, r, 1) > 0 ? w0 * Math.cosh(r0) : Math.max(w0, w1);
  };
  if (options.maxWorldWidth && options.maxWorldWidth > Math.max(w0, w1) && peak(rho) > options.maxWorldWidth) {
    // The peak width is about u1·ρ²/2 for long hops; lower ρ until the arc stays inside the map.
    let lo = 0.05;
    let hi = rho;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (peak(mid) > options.maxWorldWidth) hi = mid;
      else lo = mid;
    }
    rho = lo;
  }
  const r0 = arcR(w0, w1, u1, rho, 0);
  const r1 = arcR(w0, w1, u1, rho, 1);
  const S = (r1 - r0) / rho;
  if (!Number.isFinite(S) || S <= 0) {
    return done(bounded(0), (k) => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, scale: from.scale * (to.scale / from.scale) ** k }));
  }
  const rho2 = rho * rho;
  const dx = (to.x - from.x) / u1;
  const dy = (to.y - from.y) / u1;
  const coshR0 = Math.cosh(r0);
  const sinhR0 = Math.sinh(r0);
  return done(bounded(S / speed), (k) => {
    const s = k * S;
    const u = (w0 / rho2) * (coshR0 * Math.tanh(rho * s + r0) - sinhR0);
    const w = (w0 * coshR0) / Math.cosh(rho * s + r0);
    return { x: from.x + dx * u, y: from.y + dy * u, scale: width / w };
  });
}

function bounded(seconds: number): number {
  return Math.min(FLIGHT.maxMs, Math.max(FLIGHT.minMs, seconds * 1000));
}

/** r(i) of van Wijk and Nuij (2003), eq. 9, computed in the stable form ln(√(b²+1) − b). */
function arcR(w0: number, w1: number, u1: number, rho: number, i: 0 | 1): number {
  const wi = i === 0 ? w0 : w1;
  const b = (w1 * w1 - w0 * w0 + (i === 0 ? 1 : -1) * rho ** 4 * u1 * u1) / (2 * wi * rho * rho * u1);
  return b >= 0 ? -Math.log(b + Math.sqrt(b * b + 1)) : Math.log(-b + Math.sqrt(b * b + 1));
}

/**
 * A zoom step around a screen anchor: the world point under the anchor stays under it for the whole move, and the
 * scale moves evenly in log space. Returns camera centres (not focus): the anchor is a screen point.
 */
export function planAnchoredZoom(from: CameraState, toScale: number, anchor: { x: number; y: number }, view: Viewport, duration = ZOOM_STEP_MS): Flight {
  const wx = from.x + (anchor.x - view.width / 2) / from.scale;
  const wy = from.y + (anchor.y - view.height / 2) / from.scale;
  const at = (k: number): CameraState => {
    const scale = from.scale * (toScale / from.scale) ** k;
    return { x: wx - (anchor.x - view.width / 2) / scale, y: wy - (anchor.y - view.height / 2) / scale, scale };
  };
  const to = at(1);
  return { duration, from, to, at: (ms) => (ms >= duration ? { ...to } : at(easeOut(Math.max(0, ms) / duration))) };
}

/** Screen offset (CSS px) of the free area's centre from the view's centre. */
export function focusOffset(view: Viewport, insets: Insets): { x: number; y: number } {
  return { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 };
}

/** Width of the free part of the screen. */
export function freeWidth(view: Viewport, insets: Insets): number {
  return Math.max(1, view.width - insets.left - insets.right);
}

/** The camera centre that puts a focus (world point) at the centre of the free area. */
export function centreForFocus(focus: CameraState, view: Viewport, insets: Insets): CameraState {
  const o = focusOffset(view, insets);
  return { x: focus.x - o.x / focus.scale, y: focus.y - o.y / focus.scale, scale: focus.scale };
}

/** The world point at the centre of the free area for a camera. */
export function focusOf(camera: CameraState, view: Viewport, insets: Insets): CameraState {
  const o = focusOffset(view, insets);
  return { x: camera.x + o.x / camera.scale, y: camera.y + o.y / camera.scale, scale: camera.scale };
}

/**
 * Whether a world point sits comfortably inside the free area (view minus insets minus a margin), so a card or a
 * phone sheet never covers the mark it describes.
 */
export function insideFree(point: { x: number; y: number }, camera: CameraState, view: Viewport, insets: Insets, margin: number): boolean {
  const sx = (point.x - camera.x) * camera.scale + view.width / 2;
  const sy = (point.y - camera.y) * camera.scale + view.height / 2;
  const left = insets.left + margin;
  const right = view.width - insets.right - margin;
  const top = insets.top + margin;
  const bottom = view.height - insets.bottom - margin;
  // A free area too small for the margin still has a middle: accept only that.
  const okX = left <= right ? sx >= left && sx <= right : Math.abs(sx - (insets.left + view.width - insets.right) / 2) < 1;
  const okY = top <= bottom ? sy >= top && sy <= bottom : Math.abs(sy - (insets.top + view.height - insets.bottom) / 2) < 1;
  return okX && okY;
}
