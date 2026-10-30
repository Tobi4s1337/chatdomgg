/**
 * Free-cursor camera input (mouse and pen): drag to orbit, wheel to zoom. Nothing here is needed to walk, and a short press
 * stays a click for the interaction owner (under 8 px and under 300 ms). A press that became an orbit drag
 * swallows its trailing click so a camera turn never also opens a door.
 */
export interface PointerEventLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly timeStamp: number;
}
export interface WheelEventLike { readonly deltaY: number; readonly deltaMode: number; preventDefault(): void }
export interface PointerSurface extends EventTarget {
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  hasPointerCapture?(pointerId: number): boolean;
}

export const CLICK_SLOP_PX = 8;
export const CLICK_MS = 300;
/** Wheel pixels per DOM_DELTA_LINE and DOM_DELTA_PAGE, and the largest single event we accept. */
const LINE_PX = 16, PAGE_PX = 800, WHEEL_EVENT_PX = 240;

export interface WalkPointer {
  /** Orbit drag in CSS pixels accumulated since the last take, so slow frames lose nothing. */
  takeOrbit(): { readonly dx: number; readonly dy: number };
  /** Wheel travel in CSS pixels since the last take; positive pulls the camera back. */
  takeZoom(): number;
  readonly dragging: boolean;
  setEnabled(enabled: boolean): void;
  /** While mouse look holds the pointer, presses never start a drag. Switching either way drops a drag. */
  setLocked(locked: boolean): void;
  clear(): void;
  dispose(): void;
}

/** True when a press is still a click: little travel and a short hold. */
export function isClickPress(dx: number, dy: number, ms: number): boolean {
  return Math.hypot(dx, dy) < CLICK_SLOP_PX && ms < CLICK_MS;
}

export function wheelPixels(event: WheelEventLike): number {
  const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1;
  const px = event.deltaY * scale;
  return Number.isFinite(px) ? Math.max(-WHEEL_EVENT_PX, Math.min(WHEEL_EVENT_PX, px)) : 0;
}

export function createWalkPointer(surface: PointerSurface, keyboard: EventTarget): WalkPointer {
  let press: { id: number; x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null = null;
  let orbitX = 0, orbitY = 0, zoom = 0, enabled = true, locked = false, swallowClick = false;
  const end = () => {
    if (!press) return;
    if (press.dragging) { swallowClick = true; if (surface.hasPointerCapture?.(press.id)) surface.releasePointerCapture?.(press.id); }
    press = null;
  };
  const clear = () => { end(); swallowClick = false; orbitX = 0; orbitY = 0; zoom = 0; };
  const down = (raw: Event) => {
    const event = raw as unknown as PointerEventLike;
    swallowClick = false;
    // Touch belongs to touch.ts (stick, orbit, pinch); this is mouse and pen.
    if (!enabled || locked || press || event.pointerType === 'touch' || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragging: false };
  };
  const move = (raw: Event) => {
    const event = raw as unknown as PointerEventLike;
    if (!press || event.pointerId !== press.id) return;
    // A mouse released outside the window never sends pointerup; its next move arrives with no button held.
    if (event.pointerType === 'mouse' && event.buttons === 0) { end(); return; }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < CLICK_SLOP_PX) return;
      press.dragging = true;
      surface.setPointerCapture?.(press.id);
    }
    orbitX += event.clientX - press.lastX; orbitY += event.clientY - press.lastY;
    press.lastX = event.clientX; press.lastY = event.clientY;
  };
  const up = (raw: Event) => { if (press && (raw as unknown as PointerEventLike).pointerId === press.id) end(); };
  const click = (event: Event) => {
    if (!swallowClick) return;
    swallowClick = false; event.preventDefault(); event.stopImmediatePropagation();
  };
  const wheel = (raw: Event) => {
    if (!enabled) return;
    const event = raw as unknown as WheelEventLike;
    event.preventDefault();
    zoom += wheelPixels(event);
  };
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', up);
  surface.addEventListener('lostpointercapture', up);
  surface.addEventListener('click', click, { capture: true });
  surface.addEventListener('wheel', wheel, { passive: false });
  keyboard.addEventListener('blur', clear);
  return {
    takeOrbit() { const delta = { dx: orbitX, dy: orbitY }; orbitX = 0; orbitY = 0; return delta; },
    takeZoom() { const delta = zoom; zoom = 0; return delta; },
    get dragging() { return press?.dragging ?? false; },
    setEnabled(value) { enabled = value; if (!value) clear(); },
    setLocked(value) { if (value !== locked) { locked = value; end(); orbitX = 0; orbitY = 0; } },
    clear,
    dispose() {
      clear(); enabled = false;
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointercancel', up);
      surface.removeEventListener('lostpointercapture', up);
      surface.removeEventListener('click', click, { capture: true });
      surface.removeEventListener('wheel', wheel);
      keyboard.removeEventListener('blur', clear);
    },
  };
}
