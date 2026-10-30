/**
 * Camera-relative walking, resolved in the browser before quantization. Headings follow the citizen renderer:
 * radians about +Y, zero faces +Z, so a heading h looks along (sin h, cos h) and its right hand is (-cos h, sin h).
 * The shared step only ever sees world-relative signed bytes and a yaw byte.
 */
export interface WalkDirection { readonly moveX: number; readonly moveZ: number }

const TAU = Math.PI * 2;
const STILL: WalkDirection = { moveX: 0, moveZ: 0 };

/**
 * `forward` and `right` are intents in [-1, 1] (keys give whole steps, a thumb stick gives fractions).
 * Their combined length is capped at one, so a diagonal never walks faster than a straight line; the
 * shared step normalizes again by max(127, |move|), which absorbs the half-unit of rounding.
 */
export function walkDirection(forward: number, right: number, heading: number): WalkDirection {
  if (!Number.isFinite(forward) || !Number.isFinite(right) || !Number.isFinite(heading)) return STILL;
  let f = clampUnit(forward), r = clampUnit(right);
  const length = Math.hypot(f, r);
  if (length < 1e-6) return STILL;
  if (length > 1) { f /= length; r /= length; }
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const x = sin * f - cos * r, z = cos * f + sin * r;
  return { moveX: byte(x * 127), moveZ: byte(z * 127) };
}

/** The yaw byte that faces an actual world direction, or null while standing still. */
export function facingByte(moveX: number, moveZ: number): number | null {
  if (!moveX && !moveZ) return null;
  return wrapByte(Math.round(Math.atan2(moveX, moveZ) / TAU * 256));
}

export function headingFromByte(yaw: number): number { return wrapByte(Math.round(yaw)) * TAU / 256; }

/** Shortest signed angle from `from` to `to`, in (-π, π]. */
export function angleBetween(from: number, to: number): number {
  const delta = ((to - from) % TAU + TAU) % TAU;
  return delta > Math.PI ? delta - TAU : delta;
}

export function wrapAngle(angle: number): number { return ((angle % TAU) + TAU) % TAU; }

function clampUnit(n: number): number { return Math.max(-1, Math.min(1, n)); }
function byte(n: number): number { const rounded = Math.round(n); return rounded === 0 ? 0 : Math.max(-127, Math.min(127, rounded)); }
function wrapByte(n: number): number { return ((n % 256) + 256) % 256; }
