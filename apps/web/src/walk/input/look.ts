/**
 * Optional mouse look. The free cursor is the default; a real click on the labelled control opts into pointer lock and Escape gives
 * the cursor straight back. Locked movement is filtered against the warps some platforms deliver on lock,
 * monitor crossings and window focus: the first 120 ms after locking are ignored, any event with either axis
 * over 250 px is discarded whole, the rest are clamped to ±100 px, and non-finite values never arrive.
 * Valid events accumulate until the next frame takes them, so a slow frame loses no look.
 *
 * If the browser refuses the lock (unsupported, the brief cooldown after Escape, a sandboxed frame) the mode
 * falls back to the ordinary bounded drag orbit and says so; a fast flick never causes that fallback. The next
 * successful lock clears it.
 */
import type { KeyEventLike } from './keyboard';

export const LOOK = {
  /** Ignore locked movement for this long after the lock lands. */
  settleMs: 120,
  /** An event with either axis beyond this is a warp, not a hand. */
  warpPx: 250,
  /** Every other event is clamped to this per axis. */
  clampPx: 100,
  /** Radians of turn per locked mouse pixel. */
  radiansPerPx: .0024,
} as const;

export type LookMode = 'free' | 'requesting' | 'locked' | 'fallback';

export interface LockSurface extends EventTarget {
  requestPointerLock?(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
}
export interface LockDocument extends EventTarget {
  readonly pointerLockElement: unknown;
  exitPointerLock?(): void;
}
interface MoveEventLike { readonly movementX: number; readonly movementY: number }

/** One locked mouse event as R8 asks: null when discarded, otherwise clamped pixels. */
export function filterLookDelta(dx: number, dy: number, sinceLockMs: number): { dx: number; dy: number } | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !(sinceLockMs >= LOOK.settleMs)) return null;
  if (Math.abs(dx) > LOOK.warpPx || Math.abs(dy) > LOOK.warpPx) return null;
  const clamp = (n: number) => Math.max(-LOOK.clampPx, Math.min(LOOK.clampPx, n));
  return { dx: clamp(dx), dy: clamp(dy) };
}

export interface WalkLook {
  readonly mode: LookMode;
  /** Locked pixels gathered since the last take, already filtered. */
  takeLook(): { readonly dx: number; readonly dy: number };
  /** Only a trusted pointer click on the labelled control may acquire the cursor. Keyboard clicks do not. */
  toggle(event: Pick<MouseEvent, 'type' | 'isTrusted' | 'detail'>): void;
  /** Give the cursor back now and forget any gathered look. Fallback stays labelled until a lock succeeds. */
  exit(): void;
  /** A menu or takeover owns the pointer while disabled: the lock is let go. */
  setEnabled(enabled: boolean): void;
  /** Called whenever the mode changes, for the label. */
  onChange(listener: (mode: LookMode) => void): () => void;
  dispose(): void;
}

export function createWalkLook(surface: LockSurface, doc: LockDocument, keyboard: EventTarget, clock: () => number = () => performance.now()): WalkLook {
  let mode: LookMode = 'free', enabled = true, lockedAt = 0, dx = 0, dy = 0, attempt = 0;
  const listeners = new Set<(mode: LookMode) => void>();
  const set = (next: LookMode) => { if (next === mode) return; mode = next; for (const listener of listeners) listener(mode); };
  const ours = () => doc.pointerLockElement === surface;
  const forget = () => { dx = 0; dy = 0; };
  const exit = () => {
    attempt++;
    forget();
    if (ours()) doc.exitPointerLock?.();
    if (mode === 'locked' || mode === 'requesting') set('free');
  };
  const refuse = (id: number) => { if (id === attempt && mode === 'requesting') { forget(); set('fallback'); } };
  const request = () => {
    if (!surface.requestPointerLock) { set('fallback'); return; }
    const id = ++attempt;
    set('requesting');
    // One standard request per real click. Retrying a rejected raw/cooldown request creates browser spam
    // and can recapture a cursor the person has already released. Drag orbit always remains usable.
    try {
      const result = surface.requestPointerLock();
      if (result && typeof result.then === 'function') result.then(undefined, () => refuse(id));
    } catch { refuse(id); }
  };
  const change = () => {
    if (ours()) {
      // A lock that lands after the walker let go (menu opened mid-request) is handed straight back.
      if (!enabled || mode !== 'requesting') { doc.exitPointerLock?.(); return; }
      lockedAt = clock(); forget(); set('locked');
    } else if (mode === 'locked' || mode === 'requesting') { forget(); set('free'); }
  };
  const error = () => refuse(attempt);
  const move = (raw: Event) => {
    if (mode !== 'locked' || !ours()) return;
    const event = raw as unknown as MoveEventLike;
    const delta = filterLookDelta(event.movementX, event.movementY, clock() - lockedAt);
    if (delta) { dx += delta.dx; dy += delta.dy; }
  };
  const keydown = (raw: Event) => {
    const event = raw as unknown as KeyEventLike;
    if (event.code === 'Escape') { if (mode === 'locked' || mode === 'requesting') exit(); return; }
  };
  const toggle = (event: Pick<MouseEvent, 'type' | 'isTrusted' | 'detail'>) => {
    if (mode === 'locked' || mode === 'requesting') { exit(); return; }
    if (enabled && event.type === 'click' && event.isTrusted && event.detail > 0) request();
  };
  // Focus leaving the window ends a lock (the browser does too) and anything gathered for it.
  const lost = () => { if (mode === 'fallback') forget(); else exit(); };
  doc.addEventListener('pointerlockchange', change);
  doc.addEventListener('pointerlockerror', error);
  doc.addEventListener('mousemove', move);
  keyboard.addEventListener('keydown', keydown);
  keyboard.addEventListener('blur', lost);
  return {
    get mode() { return mode; },
    takeLook() { const delta = { dx, dy }; forget(); return delta; },
    toggle,
    exit,
    setEnabled(value) { enabled = value; if (!value) exit(); },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      exit(); enabled = false; listeners.clear();
      doc.removeEventListener('pointerlockchange', change);
      doc.removeEventListener('pointerlockerror', error);
      doc.removeEventListener('mousemove', move);
      keyboard.removeEventListener('keydown', keydown);
      keyboard.removeEventListener('blur', lost);
    },
  };
}
