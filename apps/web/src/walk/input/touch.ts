/**
 * Phone walking on the world surface. A thumb that lands in the lower-left of the world becomes a floating
 * stick centred where it landed; a finger anywhere else orbits; two orbit fingers pinch the boom in and out.
 * Everything listens on the surface only, so buttons, cards and menus drawn above it keep their own taps, and a
 * short touch that never travelled stays a click for the interaction owner (under 8 px and under 300 ms).
 * Mouse and pen are left to `pointer.ts`.
 */
import { CLICK_SLOP_PX, type PointerEventLike, type PointerSurface } from './pointer';

export const TOUCH = {
  /** The stick region: the left share of the width, below the top share of the height. */
  stickWidth: .46,
  stickTop: .34,
  /** Stick throw in CSS px, the centre dead zone and the overshoot past the rim that sprints. */
  radius: 52,
  deadZone: .16,
  sprintAt: 1.3,
  /** The stick's centre keeps this far from the surface edges so the ring is never cut off. */
  edge: 14,
  /** Pinch spread in CSS px to wheel pixels (negative leans in, like the wheel). */
  pinchZoom: 3,
} as const;

export interface TouchSurface extends PointerSurface {
  getBoundingClientRect?(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly style?: { touchAction: string };
}

export interface TouchStick {
  /** Where the ring is drawn (surface CSS px) and where the knob sits inside it. */
  readonly x: number; readonly y: number;
  readonly knobX: number; readonly knobY: number;
  /** Walking intent in [-1, 1], forward up the screen and right to the right. */
  readonly forward: number; readonly right: number;
  readonly sprint: boolean;
}

export interface WalkTouch {
  readonly stick: TouchStick | null;
  readonly forward: number;
  readonly right: number;
  readonly sprint: boolean;
  /** One finger is turning the view: auto-follow waits. */
  readonly orbiting: boolean;
  /** Seen a touch on the surface since creation (show the phone controls). */
  readonly used: boolean;
  takeOrbit(): { readonly dx: number; readonly dy: number };
  takeZoom(): number;
  /** Which part of the surface a touch at (x, y) CSS px of a w × h surface belongs to. */
  regionAt(x: number, y: number, width: number, height: number): 'stick' | 'orbit';
  setEnabled(enabled: boolean): void;
  clear(): void;
  onChange(listener: () => void): () => void;
  dispose(): void;
}

/** `x, y` is where the finger landed; `ox, oy` the stick centre it pushes against, both in client px. */
interface Finger { id: number; role: 'stick' | 'orbit'; x: number; y: number; ox: number; oy: number; lastX: number; lastY: number; travelled: boolean }

export function stickRegion(x: number, y: number, width: number, height: number): 'stick' | 'orbit' {
  return x < width * TOUCH.stickWidth && y > height * TOUCH.stickTop ? 'stick' : 'orbit';
}

/** Thumb offset from the stick centre to intent, with the dead zone rescaled away so motion starts gently. */
export function stickIntent(dx: number, dy: number): { forward: number; right: number; sprint: boolean; knobX: number; knobY: number } {
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!(length > 0) || !Number.isFinite(length)) return { forward: 0, right: 0, sprint: false, knobX: 0, knobY: 0 };
  const reach = length / TOUCH.radius;
  const strength = reach <= TOUCH.deadZone ? 0 : Math.min(1, (reach - TOUCH.deadZone) / (1 - TOUCH.deadZone));
  const ux = dx / length, uy = dy / length, knob = Math.min(length, TOUCH.radius);
  return { forward: -uy * strength || 0, right: ux * strength || 0, sprint: reach >= TOUCH.sprintAt, knobX: ux * knob, knobY: uy * knob };
}

export function createWalkTouch(surface: TouchSurface, keyboard: EventTarget): WalkTouch {
  const fingers = new Map<number, Finger>();
  const listeners = new Set<() => void>();
  let enabled = true, used = false, orbitX = 0, orbitY = 0, zoom = 0, swallowClick = false;
  let stick: (TouchStick & { id: number; cx: number; cy: number }) | null = null;
  let pinch: { a: number; b: number; spread: number } | null = null;
  const previousTouchAction = surface.style?.touchAction;
  if (surface.style) surface.style.touchAction = 'none';
  const changed = () => { for (const listener of listeners) listener(); };
  const local = (event: PointerEventLike) => {
    const rect = surface.getBoundingClientRect?.();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0), width: rect?.width ?? 0, height: rect?.height ?? 0 };
  };
  const orbitFingers = () => [...fingers.values()].filter(f => f.role === 'orbit');
  const spreadOf = (a: Finger, b: Finger) => Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
  const startPinch = () => {
    const [a, b] = orbitFingers();
    pinch = a && b ? { a: a.id, b: b.id, spread: spreadOf(a, b) } : null;
  };
  const release = (finger: Finger) => {
    fingers.delete(finger.id);
    if (finger.travelled) swallowClick = true;
    if (stick?.id === finger.id) { stick = null; changed(); }
    if (pinch && (pinch.a === finger.id || pinch.b === finger.id)) {
      pinch = null;
      // The finger left behind continues as an orbit from where it is, with no jump.
      startPinch();
    }
  };
  const clear = () => {
    const had = stick !== null || fingers.size > 0;
    fingers.clear(); stick = null; pinch = null; orbitX = 0; orbitY = 0; zoom = 0; swallowClick = false;
    if (had) changed();
  };
  const down = (raw: Event) => {
    const event = raw as unknown as PointerEventLike;
    if (event.pointerType !== 'touch') return;
    swallowClick = false;
    if (!used) { used = true; changed(); }
    if (!enabled || fingers.has(event.pointerId) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const at = local(event);
    const role = !stick && stickRegion(at.x, at.y, at.width, at.height) === 'stick' ? 'stick' : 'orbit';
    const finger: Finger = { id: event.pointerId, role, x: event.clientX, y: event.clientY, ox: event.clientX, oy: event.clientY, lastX: event.clientX, lastY: event.clientY, travelled: false };
    fingers.set(finger.id, finger);
    if (role === 'stick') {
      const margin = TOUCH.radius + TOUCH.edge;
      const cx = at.width > 2 * margin ? Math.max(margin, Math.min(at.width - margin, at.x)) : at.x;
      const cy = at.height > 2 * margin ? Math.max(margin, Math.min(at.height - margin, at.y)) : at.y;
      // A thumb that landed near the edge starts already leaning that way, as if the ring were under it.
      const intent = stickIntent(at.x - cx, at.y - cy);
      stick = { id: finger.id, cx, cy, x: cx, y: cy, ...intent };
      finger.ox += cx - at.x; finger.oy += cy - at.y;
      changed();
    } else if (orbitFingers().length === 2) startPinch();
  };
  const move = (raw: Event) => {
    const event = raw as unknown as PointerEventLike;
    const finger = fingers.get(event.pointerId);
    if (!finger || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const starting = !finger.travelled && Math.hypot(event.clientX - finger.x, event.clientY - finger.y) >= CLICK_SLOP_PX;
    if (starting) finger.travelled = true;
    // The turn includes the slop travelled before it began, so the view stays under the finger.
    const lastX = starting ? finger.x : finger.lastX, lastY = starting ? finger.y : finger.lastY;
    finger.lastX = event.clientX; finger.lastY = event.clientY;
    if (finger.role === 'stick' && stick?.id === finger.id) {
      stick = { ...stick, ...stickIntent(event.clientX - finger.ox, event.clientY - finger.oy) };
      changed();
      return;
    }
    if (pinch && (pinch.a === finger.id || pinch.b === finger.id)) {
      const a = fingers.get(pinch.a), b = fingers.get(pinch.b);
      if (!a || !b) return;
      const spread = spreadOf(a, b);
      zoom -= (spread - pinch.spread) * TOUCH.pinchZoom;
      pinch.spread = spread;
      return;
    }
    if (!finger.travelled) return;
    orbitX += event.clientX - lastX; orbitY += event.clientY - lastY;
  };
  const up = (raw: Event) => {
    const finger = fingers.get((raw as unknown as PointerEventLike).pointerId);
    if (finger) release(finger);
  };
  const click = (event: Event) => {
    if (!swallowClick) return;
    swallowClick = false; event.preventDefault(); event.stopImmediatePropagation();
  };
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', up);
  surface.addEventListener('lostpointercapture', up);
  surface.addEventListener('click', click, { capture: true });
  keyboard.addEventListener('blur', clear);
  return {
    get stick() { return stick; },
    get forward() { return stick?.forward ?? 0; },
    get right() { return stick?.right ?? 0; },
    get sprint() { return stick?.sprint ?? false; },
    get orbiting() { for (const finger of fingers.values()) if (finger.role === 'orbit' && finger.travelled) return true; return false; },
    get used() { return used; },
    takeOrbit() { const delta = { dx: orbitX, dy: orbitY }; orbitX = 0; orbitY = 0; return delta; },
    takeZoom() { const delta = zoom; zoom = 0; return delta; },
    regionAt: stickRegion,
    setEnabled(value) { enabled = value; if (!value) clear(); },
    clear,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      clear(); enabled = false; listeners.clear();
      if (surface.style && previousTouchAction !== undefined) surface.style.touchAction = previousTouchAction;
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', up);
      surface.removeEventListener('lostpointercapture', up);
      surface.removeEventListener('click', click, { capture: true });
      keyboard.removeEventListener('blur', clear);
    },
  };
}
