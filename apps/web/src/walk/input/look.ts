/**
 * The captured mouse (decision 2: always locked). While walking there is no free cursor: one click into the world
 * captures the mouse with raw input where the browser offers it, and the world turns exactly as far as the hand
 * moved. Escape lets the mouse go into the ledger, and one click comes back.
 *
 * Browsers, as handled here (see apps/web/src/walk/README.md, "The captured mouse"):
 * - Chromium asks for `unadjustedMovement` (raw, unaccelerated input). Platforms without it reject with
 *   NotSupportedError; that one request is retried once, at once, without the option, inside the same click.
 * - Chromium refuses a new lock for about a second after the person let one go. That is `cooldown`: calm, and the
 *   next click simply asks again. Firefox and Safari behave the same way with different timing.
 * - Safari has no raw input and may return nothing instead of a promise; its answer comes as
 *   `pointerlockchange` or `pointerlockerror`, which this module listens to either way.
 * - The browser swallows the Escape that ends a lock, so the ledger opens on `pointerlockchange`, never on the key.
 *   In fullscreen with keyboard lock the key does reach the page, and the caller treats it as the same request.
 * - Window focus loss ends the lock everywhere; that also opens the ledger, as a paused game would.
 *
 * Movement is filtered against warps, not against speed: some platforms deliver an isolated jump on lock, on a
 * monitor crossing or on focus. A big event is held for at most one following event (or `holdMs`) and dropped
 * only when it stands alone, far larger than what came before and after, or when it flips direction in the middle
 * of a steady motion. Every real flick ramps up and down through its neighbours, so it survives whole.
 */
import { isEditableTarget, type KeyEventLike } from './keyboard';

export const LOOK = {
  /** Radians of turn per locked mouse pixel at sensitivity 1. */
  radiansPerPx: .0024,
  /** Smaller events are always real; only larger ones are ever held for judgement. */
  spikePx: 160,
  /** A held event is a warp when it is more than this many times larger than both of its neighbours. */
  spikeRatio: 6,
  /**
   * ...unless the next event carries on in the same direction at least this fraction of its size: a snap from a
   * still hand that lands in one coalesced frame and decays over the next is a flick. A warp has no such tail.
   */
  tailFraction: 1 / 12,
  /** A neighbour this small counts as a still hand when judging direction flips. */
  stillPx: 6,
  /** How long a held event waits for its next neighbour before it is judged alone. */
  holdMs: 24,
  /** Nothing a hand can do moves this far in one event. */
  maxPx: 6000,
  /** A refusal this soon after the person let the mouse go is the browser's cooldown, not a refusal. */
  cooldownMs: 1600,
  /** Refusals in a row with no cooldown to explain them mean this page cannot capture the mouse. */
  refusalsUntilUnavailable: 3,
} as const;

/** The capture states this module owns. `touch` is decided by the walk, which knows the device. */
export type LookMode = 'idle' | 'requesting' | 'locked' | 'cooldown' | 'leased' | 'unavailable';

export interface LockSurface extends EventTarget {
  requestPointerLock?(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
}
export interface LockDocument extends EventTarget {
  readonly pointerLockElement: unknown;
  exitPointerLock?(): void;
  readonly fullscreenElement?: unknown;
  exitFullscreen?(): Promise<void> | void;
  readonly fullscreenEnabled?: boolean;
  readonly documentElement?: { requestFullscreen?(options?: { navigationUI?: 'hide' | 'show' | 'auto' }): Promise<void> | void } | null;
}
/** `navigator.keyboard` where the browser has it (Chromium desktop). */
export interface KeyboardLockLike { lock(codes?: readonly string[]): Promise<void>; unlock(): void }
interface MoveEventLike { readonly movementX: number; readonly movementY: number; readonly timeStamp?: number }

// ---------------------------------------------------------------------------------------------------------------
// Spike filter

interface Held { readonly dx: number; readonly dy: number; readonly at: number; readonly before: { dx: number; dy: number }; readonly flip: boolean }

export interface SpikeFilter {
  /** One raw event. Returns what is now certain to be real (possibly an earlier held event too). */
  push(dx: number, dy: number, at: number): { dx: number; dy: number };
  /** Judge a held event that waited `holdMs` without a neighbour. Returns what is real now. */
  flush(at: number): { dx: number; dy: number };
  /** Forget everything (lock gained or lost). The next event has a still hand before it. */
  reset(): void;
  /** Events judged warps since creation, for the debug view. */
  readonly rejected: number;
}

const size = (dx: number, dy: number) => Math.hypot(dx, dy);
const dot = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) => a.dx * b.dx + a.dy * b.dy;

export function createSpikeFilter(): SpikeFilter {
  let before = { dx: 0, dy: 0 }, held: Held | null = null, rejected = 0;
  const isWarp = (h: Held, after: { dx: number; dy: number } | null) => {
    const mag = size(h.dx, h.dy), prev = size(h.before.dx, h.before.dy), next = after ? size(after.dx, after.dy) : 0;
    const tail = !h.flip && !!after && dot(after, h) > 0 && next >= mag * LOOK.tailFraction;
    if (mag > prev * LOOK.spikeRatio && mag > next * LOOK.spikeRatio && !tail) return true;
    // A reversal in the middle of a steady motion that the next event does not continue: the sign-flip warp.
    if (h.flip && after && next >= LOOK.stillPx && dot(after, h.before) > 0 && dot(after, h) <= 0) return true;
    return false;
  };
  const settle = (after: { dx: number; dy: number } | null) => {
    const h = held!; held = null;
    if (isWarp(h, after)) { rejected++; return { dx: 0, dy: 0 }; }
    before = { dx: h.dx, dy: h.dy };
    return { dx: h.dx, dy: h.dy };
  };
  return {
    push(rawX, rawY, at) {
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return { dx: 0, dy: 0 };
      const dx = Math.max(-LOOK.maxPx, Math.min(LOOK.maxPx, rawX)), dy = Math.max(-LOOK.maxPx, Math.min(LOOK.maxPx, rawY));
      let out = { dx: 0, dy: 0 };
      if (held) out = settle({ dx, dy });
      const mag = size(dx, dy), prev = size(before.dx, before.dy);
      const flip = prev >= LOOK.stillPx * 4 && dot({ dx, dy }, before) < -.5 * mag * prev;
      if (mag >= LOOK.spikePx && (mag > prev * LOOK.spikeRatio || flip)) {
        held = { dx, dy, at, before: { ...before }, flip };
        return out;
      }
      before = { dx, dy };
      return { dx: out.dx + dx, dy: out.dy + dy };
    },
    flush(at) {
      if (!held || !(at - held.at >= LOOK.holdMs)) return { dx: 0, dy: 0 };
      const out = settle(null);
      // A hand that stopped after a held event is still now.
      before = { dx: 0, dy: 0 };
      return out;
    },
    reset() { before = { dx: 0, dy: 0 }; held = null; },
    get rejected() { return rejected; },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Capture

export interface CursorLeaseHandle { release(): void; readonly active: boolean }

export interface WalkLookView {
  readonly mode: LookMode;
  readonly fullscreen: boolean;
  readonly keyboardLocked: boolean;
  readonly canFullscreen: boolean;
  readonly canLockKeyboard: boolean;
}

export interface WalkLook extends WalkLookView {
  /** Locked pixels gathered since the last take, already filtered. */
  takeLook(now?: number): { readonly dx: number; readonly dy: number };
  /**
   * A trusted press or click asks for the mouse. Synthetic events, keyboard "clicks" and presses while a lease or a
   * disabled walk holds the cursor never capture. Returns true when a request was made.
   */
  capture(event: { readonly isTrusted: boolean; readonly type?: string; readonly button?: number }): boolean;
  /** Let the mouse go on our own terms (a panel, a takeover). Never reported as the person's Escape. */
  release(): void;
  /** A panel takes the cursor until it releases the lease. The mouse is let go now; the next click takes it back. */
  lease(reason: string): CursorLeaseHandle;
  readonly leases: readonly string[];
  /** The walk handed the camera away: the lock is let go and no click captures until enabled again. */
  setEnabled(enabled: boolean): void;
  /** Enter or leave fullscreen, with keyboard lock where the browser has it. Call from a gesture. */
  toggleFullscreen(): Promise<void>;
  /** The view changed (mode, fullscreen, keyboard lock). */
  onChange(listener: (view: WalkLookView) => void): () => void;
  /**
   * The person let go of the mouse while walking: Escape (eaten by the browser), focus loss, the browser's own
   * release, or Escape reaching the page under keyboard lock. The walk opens the ledger.
   */
  onLetGo(listener: (why: 'escape' | 'browser') => void): () => void;
  readonly rejected: number;
  dispose(): void;
}

export interface WalkLookEnvironment {
  readonly keyboardLock?: KeyboardLockLike | null;
  readonly clock?: () => number;
}

const NAVIGATOR_KEYBOARD = (): KeyboardLockLike | null => {
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { keyboard?: Partial<KeyboardLockLike> };
  return nav?.keyboard && typeof nav.keyboard.lock === 'function' && typeof nav.keyboard.unlock === 'function' ? nav.keyboard as KeyboardLockLike : null;
};

export function createWalkLook(surface: LockSurface, doc: LockDocument, keyboard: EventTarget, environment: WalkLookEnvironment = {}): WalkLook {
  const clock = environment.clock ?? (() => performance.now());
  const keys = environment.keyboardLock === undefined ? NAVIGATOR_KEYBOARD() : environment.keyboardLock;
  const filter = createSpikeFilter();
  let mode: LookMode = surface.requestPointerLock ? 'idle' : 'unavailable';
  let enabled = true, attempt = 0, dx = 0, dy = 0, raw = true, ownExit = false, lastLetGo = -Infinity, refusals = 0;
  /** The attempt whose request returned a promise: its answer comes from the promise, never the error event. */
  let promised = -1;
  let keyboardLocked = false, disposed = false;
  const leases = new Map<number, string>();
  let leaseId = 0;
  const changeListeners = new Set<(view: WalkLookView) => void>();
  const letGoListeners = new Set<(why: 'escape' | 'browser') => void>();
  const ours = () => doc.pointerLockElement === surface;
  const fullscreen = () => !!doc.fullscreenElement;
  const canFullscreen = () => doc.fullscreenEnabled !== false && typeof doc.documentElement?.requestFullscreen === 'function';
  const view = (): WalkLookView => ({ mode, fullscreen: fullscreen(), keyboardLocked, canFullscreen: canFullscreen(), canLockKeyboard: !!keys });
  let lastView = JSON.stringify(view());
  const announce = () => {
    const next = view(), key = JSON.stringify(next);
    if (key === lastView) return;
    lastView = key;
    for (const listener of [...changeListeners]) listener(next);
  };
  const set = (next: LookMode) => { mode = next; announce(); };
  const forget = () => { dx = 0; dy = 0; filter.reset(); };
  const resting = (): LookMode => mode === 'unavailable' ? 'unavailable' : leases.size ? 'leased' : 'idle';
  const exitOwn = () => {
    attempt++;
    forget();
    if (ours()) { ownExit = true; doc.exitPointerLock?.(); }
  };
  const refuse = (id: number) => {
    if (id !== attempt || mode !== 'requesting') return;
    forget();
    if (clock() - lastLetGo < LOOK.cooldownMs) { set('cooldown'); return; }
    refusals++;
    set(refusals >= LOOK.refusalsUntilUnavailable ? 'unavailable' : 'idle');
  };
  const ask = (id: number, withRaw: boolean) => {
    let result: Promise<void> | void;
    try { result = withRaw ? surface.requestPointerLock!({ unadjustedMovement: true }) : surface.requestPointerLock!(); } catch (error) {
      if (withRaw && (error as { name?: string })?.name === 'NotSupportedError') { raw = false; ask(id, false); return; }
      refuse(id); return;
    }
    // A promise answers for this attempt: Chrome also fires pointerlockerror for the refused raw request, which
    // must not end the ordinary retry that follows it in the same click.
    promised = result && typeof result.then === 'function' ? id : promised;
    if (result && typeof result.then === 'function') result.then(undefined, (error: unknown) => {
      // Raw input is not on this platform: once, at once, inside the same click, ask for the ordinary lock.
      if (withRaw && id === attempt && (error as { name?: string })?.name === 'NotSupportedError') { raw = false; ask(id, false); return; }
      refuse(id);
    });
  };
  const capture: WalkLook['capture'] = event => {
    if (disposed || !enabled || leases.size || !event.isTrusted || !surface.requestPointerLock) return false;
    if (event.button !== undefined && event.button !== 0) return false;
    if (mode === 'locked' || mode === 'requesting' || mode === 'unavailable' || ours()) return false;
    const id = ++attempt;
    set('requesting');
    ask(id, raw);
    return true;
  };
  const change = () => {
    if (ours()) {
      // A lock that lands after the walker let go (a panel opened mid-request) is handed straight back.
      if (!enabled || leases.size || mode !== 'requesting') { exitOwn(); set(resting()); return; }
      refusals = 0; forget(); set('locked');
      return;
    }
    const own = ownExit; ownExit = false;
    if (mode === 'locked' || mode === 'requesting') {
      forget();
      if (!own && mode === 'locked') { lastLetGo = clock(); set(resting()); for (const listener of [...letGoListeners]) listener('browser'); }
      else set(resting());
    }
  };
  const error = () => { if (promised !== attempt) refuse(attempt); };
  const move = (rawEvent: Event) => {
    if (mode !== 'locked' || !ours()) return;
    const event = rawEvent as unknown as MoveEventLike;
    const delta = filter.push(event.movementX, event.movementY, clock());
    dx += delta.dx; dy += delta.dy;
  };
  const keydown = (rawEvent: Event) => {
    const event = rawEvent as unknown as KeyEventLike;
    // Under keyboard lock the browser shortcuts reach the page: none of them may close, reload or open anything.
    if (keyboardLocked && (event.ctrlKey || event.metaKey || event.altKey) && event.code !== 'Escape' && !isEditableTarget(event.target)) { event.preventDefault(); return; }
    if (event.code !== 'Escape' || event.repeat) return;
    // Escape only reaches the page while locked when keyboard lock holds it: the same request as the browser's.
    if (mode === 'locked' && ours()) {
      event.preventDefault();
      lastLetGo = clock();
      exitOwn(); set(resting());
      for (const listener of [...letGoListeners]) listener('escape');
    } else if (mode === 'requesting') { exitOwn(); set(resting()); }
  };
  const fullscreenChange = () => {
    if (!fullscreen() && keyboardLocked) { keyboardLocked = false; try { keys?.unlock(); } catch { /* already unlocked */ } }
    announce();
  };
  // Focus leaving the window ends a lock everywhere; the browser's own pointerlockchange then opens the ledger.
  const lost = () => { if (mode === 'requesting') { exitOwn(); set(resting()); } };
  doc.addEventListener('pointerlockchange', change);
  doc.addEventListener('pointerlockerror', error);
  doc.addEventListener('mousemove', move);
  doc.addEventListener('fullscreenchange', fullscreenChange);
  keyboard.addEventListener('keydown', keydown, { capture: true });
  keyboard.addEventListener('blur', lost);
  return {
    get mode() { return mode; },
    get fullscreen() { return fullscreen(); },
    get keyboardLocked() { return keyboardLocked; },
    get canFullscreen() { return canFullscreen(); },
    get canLockKeyboard() { return !!keys; },
    get leases() { return [...leases.values()]; },
    get rejected() { return filter.rejected; },
    takeLook(now = clock()) {
      if (mode === 'locked') { const late = filter.flush(now); dx += late.dx; dy += late.dy; }
      const delta = { dx, dy }; dx = 0; dy = 0;
      return delta;
    },
    capture,
    release() { exitOwn(); if (mode !== 'unavailable') set(resting()); },
    lease(reason) {
      const id = ++leaseId;
      leases.set(id, reason);
      exitOwn();
      if (mode !== 'unavailable') set('leased');
      return {
        release() { if (leases.delete(id) && mode !== 'unavailable' && mode !== 'locked' && mode !== 'requesting') set(resting()); },
        get active() { return leases.has(id); },
      };
    },
    setEnabled(value) {
      enabled = value;
      if (!value) { exitOwn(); if (mode === 'locked' || mode === 'requesting') set(resting()); }
    },
    async toggleFullscreen() {
      if (fullscreen()) {
        if (keyboardLocked) { keyboardLocked = false; try { keys?.unlock(); } catch { /* already unlocked */ } }
        try { await doc.exitFullscreen?.(); } catch { /* the browser left fullscreen itself */ }
        announce();
        return;
      }
      if (!canFullscreen()) return;
      try { await doc.documentElement!.requestFullscreen!({ navigationUI: 'hide' }); } catch { announce(); return; }
      if (keys && fullscreen()) {
        try { await keys.lock(); keyboardLocked = fullscreen(); } catch { keyboardLocked = false; }
      }
      announce();
    },
    onChange(listener) { changeListeners.add(listener); return () => changeListeners.delete(listener); },
    onLetGo(listener) { letGoListeners.add(listener); return () => letGoListeners.delete(listener); },
    dispose() {
      if (disposed) return;
      exitOwn(); disposed = true; enabled = false;
      if (keyboardLocked) { keyboardLocked = false; try { keys?.unlock(); } catch { /* already unlocked */ } }
      changeListeners.clear(); letGoListeners.clear(); leases.clear();
      doc.removeEventListener('pointerlockchange', change);
      doc.removeEventListener('pointerlockerror', error);
      doc.removeEventListener('mousemove', move);
      doc.removeEventListener('fullscreenchange', fullscreenChange);
      keyboard.removeEventListener('keydown', keydown, { capture: true });
      keyboard.removeEventListener('blur', lost);
    },
  };
}
