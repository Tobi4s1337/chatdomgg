/**
 * The captured mouse (decision 2: always locked). While walking there is no free cursor: one click into the world
 * captures the mouse with raw input where the browser offers it, and the world turns exactly as far as the hand
 * moved. Escape lets the mouse go into the ledger, and one click comes back.
 *
 * Browsers, as handled here (see apps/web/src/walk/README.md, "The captured mouse"):
 * - Every request asks for `unadjustedMovement` (raw, unaccelerated input: Chromium, and Firefox 152+ on Windows).
 *   Platforms without it reject with NotSupportedError (Firefox on Linux does, then also fires pointerlockerror);
 *   that one request is retried once, at once, without the option, inside the same click.
 * - Chromium refuses a new lock for about a second after the person let one go. That is `cooldown`: calm, and the
 *   next click simply asks again. Firefox and Safari behave the same way with different timing.
 * - Safari has no raw input and may return nothing instead of a promise; its answer comes as
 *   `pointerlockchange` or `pointerlockerror`, which this module listens to either way.
 * - The browser swallows the Escape that ends a lock, so the ledger opens on `pointerlockchange`, never on the key.
 *   In fullscreen with keyboard lock the key does reach the page, and the caller treats it as the same request.
 * - Window focus loss ends the lock everywhere; that also opens the ledger, as a paused game would.
 *
 * Movement is summed raw, 1:1, like every PC game and three.js PointerLockControls: each locked `mousemove`'s
 * movementX/Y adds to the turn, nothing is held, smoothed or dropped. An earlier warp filter judged big events
 * against their neighbours and dropped the "odd" ones; Firefox on Windows locks by re-centring the hidden cursor
 * and its stream can carry a large delta with its equal and opposite correction, so dropping either half turned
 * the world by hundreds of pixels the hand never moved (work/lanes/play/MOUSE-LOOK.md).
 */
import { isEditableTarget, type KeyEventLike } from './keyboard';

export const LOOK = {
  /**
   * Radians of turn per locked mouse count at sensitivity 1. With `unadjustedMovement` movementX/Y are
   * raw device counts, so the turn per centimetre of hand depends on the mouse's DPI: .001 rad (0.057°) is about
   * 20 cm per full turn at 800 DPI and 10 cm at 1600, a shipped shooter's default (CS2 at 2.5 is 0.055°/count).
   * The old .0024 (PointerLockControls' 0.002 per accelerated desktop pixel) was 4 cm per turn on a 1600 DPI
   * mouse: a nudge spun the world. The ledger's sensitivity (0.25×..4×) covers 5 to 80 cm per turn at 800 DPI.
   */
  radiansPerPx: .001,
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
interface MoveEventLike { readonly movementX: number; readonly movementY: number }

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
  /** Locked movement (counts) gathered since the last take, raw. */
  takeLook(): { readonly dx: number; readonly dy: number };
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
  const forget = () => { dx = 0; dy = 0; };
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
    const { movementX, movementY } = rawEvent as unknown as MoveEventLike;
    if (Number.isFinite(movementX) && Number.isFinite(movementY)) { dx += movementX; dy += movementY; }
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
    takeLook() {
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
