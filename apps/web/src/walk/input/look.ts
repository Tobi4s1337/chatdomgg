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
 *
 * The one exception is the re-centre echo (`createEchoFilter`). Firefox on X11 (seen on Linux, Firefox 158) does not
 * really re-centre the hidden cursor while locked, and after each real move it reports the cursor's offset from the
 * centre as movement: [1,0], [-977,106], [0,1], [-977,107]... That offset drifts by exactly the real movement, so
 * the next echo is predictable, and only events that match that prediction are dropped. Everything else stays 1:1.
 * When echoes keep coming the cursor is drifting and the lock breaks at the window's edge; the first such loss is
 * reported as `drift`, not as the person's Escape, and the view says `drifting` so the ledger can say why.
 *
 * Holding the right mouse button looks around without any capture (the cursor stays, no context menu): the way to
 * look in a browser that cannot hold the mouse still.
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

// ---------------------------------------------------------------------------------------------------------------
// The re-centre echo

export const ECHO = {
  /** With no echo learnt, an event this large (counts, either axis) is held until its twin proves it an echo. */
  learnPx: 200,
  /**
   * A learnt echo matches its prediction within 3 counts plus 2 % of the predicted offset, on both axes. Proving an
   * echo (a held twin, a chain link) takes the exact sum, within `chainSlackPx`: two of Firefox-on-Windows's re-centre
   * pairs close together come within 2 % of a twin.
   */
  slackPx: 3,
  slackShare: .02,
  /** A large event this close to the last echo is the same echo after a missed event. */
  relearnPx: 40,
  /** An unproven large event is the hand's own after this long, or after this many smaller events. */
  holdMs: 12,
  holdEvents: 3,
  /** A learnt echo is forgotten after this long without one. */
  forgetMs: 1000,
  /** Echoes in one capture that mean the browser lets the hidden cursor drift. */
  driftEchoes: 6,
  /**
   * Below `learnPx` (the lock began with the hidden cursor near the centre) an echo is the size of a hand's move, so
   * it is learnt from its arithmetic instead: `chainLinks` events in a row, each the one before plus the small real
   * movement between them (at most `chainShare` of it, from `chainPx` counts up, within `chainSlackPx`).
   * The links that already turned the world are then taken back, so the turn ends exactly the hand's.
   */
  chainPx: 6,
  /** Once a chain (or a held twin) is proven, earlier links are taken back too: from this size, with up to this share between. */
  chainTailPx: 2,
  chainTailShare: 1,
  chainShare: .5,
  chainSlackPx: 1,
  chainLinks: 3,
  /** Real events that may sit between two links, and how far back (events and ms) a chain is looked for. */
  chainGap: 3,
  chainEvents: 12,
  chainMs: 250,
  /** Under this size (counts, larger axis) a learnt echo matches within `chainSlackPx`, not `slackPx`. */
  smallPx: 32,
  /** A learnt echo is forgotten after this many real events in a row with no echo among them. */
  missEvents: 8,
} as const;

interface Delta { x: number; y: number }

export interface EchoFilter {
  /** One locked movement event at `at` ms. Real movement is kept; a matching echo is dropped. */
  push(dx: number, dy: number, at: number): void;
  /** The real movement since the last take. An unproven event older than `ECHO.holdMs` is released into it. */
  take(at: number): { readonly dx: number; readonly dy: number };
  /** Echoes dropped since the last reset. */
  readonly echoes: number;
  /** A new capture: nothing learnt, nothing held, nothing gathered. */
  reset(): void;
}

/**
 * Firefox's fake re-centre events, dropped exactly (after Tobias's mouse lab, mode 8). An echo is the hidden cursor's
 * offset W from the centre; after real movement r the next echo is W + r. The first echo cannot be predicted, so a
 * large event with nothing learnt is held for a moment: if a second large event arrives that equals it plus the small
 * real movement between them, both were echoes and W is learnt; otherwise it is released whole. A steady fast turn
 * (equal large events with nothing between) never pairs up, and a flick's events are only held, never lost.
 * A small offset (the lock began near the centre) is learnt from a chain of three echoes, each the last plus the
 * small real movement between, and the two that already turned the world are taken back.
 */
export function createEchoFilter(): EchoFilter {
  let out: Delta = { x: 0, y: 0 };
  let echo: (Delta & { at: number }) | null = null;
  let since: Delta = { x: 0, y: 0 };
  /** An unproven large event; `mark` is how many events `recent` held when it came. */
  let held: (Delta & { at: number; events: number; since: Delta; mark: number }) | null = null;
  let echoes = 0, misses = 0;
  /** How far the hand's last small move went (counts): how far an echo may lead its prediction when its own move never came. */
  let pace = 0;
  /** The last kept events, newest last, each still part of the turn: where a missed chain of echoes is found. */
  let recent: (Delta & { at: number })[] = [];
  const size = (x: number, y: number) => Math.max(Math.abs(x), Math.abs(y));
  const big = (x: number, y: number) => size(x, y) > ECHO.learnPx;
  const near = (v: number, predicted: number, slack: number = ECHO.slackPx) => Math.abs(v - predicted) <= slack + Math.abs(predicted) * ECHO.slackShare;
  /** Proof is exact: a twin or a chain link adds up to the count, give or take one. */
  const exact = (v: number, predicted: number) => Math.abs(v - predicted) <= ECHO.chainSlackPx;
  const learn = (x: number, y: number, at: number, count: number) => { echo = { x, y, at }; since = { x: 0, y: 0 }; echoes += count; misses = 0; };
  const keep = (x: number, y: number, at: number) => {
    out.x += x; out.y += y; since.x += x; since.y += y;
    if (held) { held.since.x += x; held.since.y += y; }
    if (echo && ++misses >= ECHO.missEvents) echo = null;
    if (size(x, y) < ECHO.smallPx) pace = size(x, y);
    recent.push({ x, y, at });
    if (recent.length > ECHO.chainEvents) forgetOldest();
  };
  const forgetOldest = () => { recent.shift(); if (held) held.mark = Math.max(0, held.mark - 1); };
  const release = () => {
    if (!held) return;
    const { x, y, at } = held; held = null;
    keep(x, y, at);
  };
  /**
   * The index of the event in `recent` before `before` that `e` echoes: it plus the small real movement between.
   * With `adjacent`, `e` may also follow its echo directly, ahead of it by 1 to that many counts (an echo whose own
   * move never came; never by nothing, which is a steady real turn or a dead-centre start's first real move).
   */
  const link = (e: Delta, before: number, least: number, share: number, adjacent?: number): number => {
    let bx = 0, by = 0;
    for (let j = before - 1; j >= 0 && before - 1 - j <= ECHO.chainGap; j--) {
      const candidate = recent[j]!;
      if (j === before - 1 && adjacent !== undefined && size(candidate.x, candidate.y) >= Math.max(least, 2 * adjacent)
        && size(e.x - candidate.x, e.y - candidate.y) <= adjacent && size(e.x - candidate.x, e.y - candidate.y) > 0) return j;
      if (j < before - 1) {
        const offset = size(candidate.x, candidate.y), between = size(bx, by);
        if (offset >= least && between > 0 && between <= offset * share
          && exact(e.x, candidate.x + bx) && exact(e.y, candidate.y + by)) return j;
      }
      bx += candidate.x; by += candidate.y;
    }
    return -1;
  };
  /** Earlier links of a proven echo `e` (seen when `recent` held `before` events), ready to leave the turn. */
  const tail = (e: Delta, before: number): number[] => {
    const links: number[] = [];
    const next = () => link(e, before, ECHO.chainTailPx, ECHO.chainTailShare, ECHO.chainSlackPx + pace);
    for (let j = next(); j >= 0; j = next()) {
      links.push(j); e = recent[j]!; before = j;
    }
    return links;
  };
  /** Takes these kept events back out of the turn: they were echoes. */
  const takeBack = (links: readonly number[]) => {
    for (const j of links) { out.x -= recent[j]!.x; out.y -= recent[j]!.y; }
    recent = recent.filter((_, j) => !links.includes(j));
    return links.length;
  };
  /** A chain of echoes ending in this event, each the one before plus the small real movement between. */
  const chain = (x: number, y: number, at: number): boolean => {
    const links: number[] = [];
    let e: Delta = { x, y }, before = recent.length;
    for (let j = link(e, before, ECHO.chainPx, ECHO.chainShare); j >= 0 && links.length + 1 < ECHO.chainLinks;
      j = link(e, before, ECHO.chainPx, ECHO.chainShare)) { links.push(j); e = recent[j]!; before = j; }
    if (links.length + 1 < ECHO.chainLinks) return false;
    learn(x, y, at, 1 + takeBack([...links, ...tail(e, before)]));
    return true;
  };
  return {
    push(x, y, at) {
      if (echo && at - echo.at > ECHO.forgetMs) echo = null;
      while (recent.length && at - recent[0]!.at > ECHO.chainMs) forgetOldest();
      if (echo) {
        const px = echo.x + since.x, py = echo.y + since.y, small = size(px, py) < ECHO.smallPx;
        // A small echo is only told from the hand's own move once the hand has moved since the last one.
        // A large one may lead its prediction by the hand's last move: the echo of a move whose own event never came.
        const lead = since.x || since.y ? 0 : pace;
        const matches = small ? (since.x || since.y) && near(x, px, ECHO.chainSlackPx) && near(y, py, ECHO.chainSlackPx)
          : near(x, px, ECHO.slackPx + lead) && near(y, py, ECHO.slackPx + lead);
        const again = big(x, y) && Math.abs(x - echo.x) < ECHO.relearnPx && Math.abs(y - echo.y) < ECHO.relearnPx;
        if (matches || again) { learn(x, y, at, 1); return; }
      }
      if (held) {
        const between = held.since, heldSize = size(held.x, held.y);
        // Its twin: the held offset moved by exactly the small real movement since. Both were echoes.
        const twin = (between.x || between.y) && size(between.x, between.y) <= heldSize * .25
          && exact(x, held.x + between.x) && exact(y, held.y + between.y);
        if (twin) { const back = takeBack(tail(held, held.mark)); held = null; learn(x, y, at, 2 + back); return; }
        if (big(x, y)) { release(); held = { x, y, at, events: 0, since: { x: 0, y: 0 }, mark: recent.length }; return; }
        keep(x, y, at);
        if (held && (++held.events >= ECHO.holdEvents || at - held.at > ECHO.holdMs)) release();
        return;
      }
      if (big(x, y)) { held = { x, y, at, events: 0, since: { x: 0, y: 0 }, mark: recent.length }; return; }
      if (!echo && chain(x, y, at)) return;
      keep(x, y, at);
    },
    take(at) {
      if (held && at - held.at > ECHO.holdMs) release();
      const delta = { dx: out.x, dy: out.y };
      out = { x: 0, y: 0 };
      return delta;
    },
    get echoes() { return echoes; },
    reset() { out = { x: 0, y: 0 }; echo = null; since = { x: 0, y: 0 }; held = null; echoes = 0; misses = 0; pace = 0; recent = []; },
  };
}

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
interface MoveEventLike { readonly movementX: number; readonly movementY: number; readonly buttons?: number }

// ---------------------------------------------------------------------------------------------------------------
// Capture

export interface CursorLeaseHandle { release(): void; readonly active: boolean }

export type LetGo = 'escape' | 'browser' | 'drift';

export interface WalkLookView {
  readonly mode: LookMode;
  readonly fullscreen: boolean;
  readonly keyboardLocked: boolean;
  readonly canFullscreen: boolean;
  readonly canLockKeyboard: boolean;
  /** This browser lets the hidden cursor drift while locked (re-centre echoes kept coming). Sticky for the page. */
  readonly drifting: boolean;
}

export interface WalkLook extends WalkLookView {
  /** Locked movement and right-button drag (counts) gathered since the last take, 1:1 less re-centre echoes. */
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
   * release, or Escape reaching the page under keyboard lock. The walk opens the ledger. `drift`: the first lock
   * lost after re-centre echoes kept coming, most likely the drifting cursor reaching the window's edge; the walk
   * stays calm ("click to walk") rather than open the ledger.
   */
  onLetGo(listener: (why: LetGo) => void): () => void;
  dispose(): void;
}

export interface WalkLookEnvironment {
  readonly keyboardLock?: KeyboardLockLike | null;
  readonly clock?: () => number;
  /** Watch for re-centre echoes. Defaults to Firefox (Gecko), the only engine seen sending them. */
  readonly echoFilter?: boolean;
}

/** Firefox, on any platform: the engine whose locked stream carries re-centre echoes. Chromium stays pure 1:1. */
const GECKO = (): boolean => typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent ?? '');

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
  const echo = createEchoFilter(), filtering = environment.echoFilter ?? GECKO();
  let drifting = false, driftReported = false, dragging = false;
  const leases = new Map<number, string>();
  let leaseId = 0;
  const changeListeners = new Set<(view: WalkLookView) => void>();
  const letGoListeners = new Set<(why: LetGo) => void>();
  const ours = () => doc.pointerLockElement === surface;
  const fullscreen = () => !!doc.fullscreenElement;
  const canFullscreen = () => doc.fullscreenEnabled !== false && typeof doc.documentElement?.requestFullscreen === 'function';
  const view = (): WalkLookView => ({ mode, fullscreen: fullscreen(), keyboardLocked, canFullscreen: canFullscreen(), canLockKeyboard: !!keys, drifting });
  let lastView = JSON.stringify(view());
  const announce = () => {
    const next = view(), key = JSON.stringify(next);
    if (key === lastView) return;
    lastView = key;
    for (const listener of [...changeListeners]) listener(next);
  };
  const set = (next: LookMode) => { mode = next; announce(); };
  const forget = () => { dx = 0; dy = 0; echo.reset(); };
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
      refusals = 0; dragging = false; forget(); set('locked');
      return;
    }
    const own = ownExit; ownExit = false;
    if (mode === 'locked' || mode === 'requesting') {
      if (!own && mode === 'locked') {
        // Echoes kept coming in this capture: the drifting cursor most likely left the window. Said once, calmly.
        const why: LetGo = drifting && !driftReported && echo.echoes >= ECHO.driftEchoes ? 'drift' : 'browser';
        if (why === 'drift') driftReported = true;
        forget(); lastLetGo = clock(); set(resting());
        for (const listener of [...letGoListeners]) listener(why);
      }
      else { forget(); set(resting()); }
    }
  };
  const error = () => { if (promised !== attempt) refuse(attempt); };
  const move = (rawEvent: Event) => {
    const { movementX, movementY, buttons } = rawEvent as unknown as MoveEventLike;
    if (!Number.isFinite(movementX) || !Number.isFinite(movementY)) return;
    if (mode === 'locked' && ours()) {
      if (!filtering) { dx += movementX; dy += movementY; return; }
      echo.push(movementX, movementY, clock());
      if (!drifting && echo.echoes >= ECHO.driftEchoes) { drifting = true; announce(); }
      return;
    }
    if (!dragging) return;
    // A right button let go outside the window never sends mouseup; the next move arrives without it.
    if (buttons !== undefined && (buttons & 2) === 0) { dragging = false; return; }
    if (!enabled || leases.size || mode === 'locked' || mode === 'leased') { dragging = false; return; }
    dx += movementX; dy += movementY;
  };
  // Right-button drag looks without capture: the cursor stays where it is and no context menu opens over the world.
  // Pointer and mouse events both start and end it: a pointerdown handled elsewhere may suppress the mouse events.
  const rightDown = (rawEvent: Event) => {
    const event = rawEvent as unknown as { readonly button: number; readonly pointerType?: string };
    if (event.button !== 2 || (event.pointerType !== undefined && event.pointerType !== 'mouse') || disposed || !enabled || leases.size || mode === 'locked' || mode === 'leased' || ours()) return;
    dragging = true;
  };
  const rightUp = (rawEvent: Event) => { if ((rawEvent as unknown as { readonly button: number }).button === 2) dragging = false; };
  const contextMenu = (rawEvent: Event) => { if (!disposed && enabled) rawEvent.preventDefault(); };
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
  const lost = () => { dragging = false; if (mode === 'requesting') { exitOwn(); set(resting()); } };
  doc.addEventListener('pointerlockchange', change);
  doc.addEventListener('pointerlockerror', error);
  doc.addEventListener('mousemove', move);
  doc.addEventListener('fullscreenchange', fullscreenChange);
  doc.addEventListener('mouseup', rightUp);
  surface.addEventListener('mousedown', rightDown);
  surface.addEventListener('pointerdown', rightDown);
  doc.addEventListener('pointerup', rightUp);
  surface.addEventListener('contextmenu', contextMenu);
  keyboard.addEventListener('keydown', keydown, { capture: true });
  keyboard.addEventListener('blur', lost);
  return {
    get mode() { return mode; },
    get fullscreen() { return fullscreen(); },
    get keyboardLocked() { return keyboardLocked; },
    get canFullscreen() { return canFullscreen(); },
    get canLockKeyboard() { return !!keys; },
    get drifting() { return drifting; },
    get leases() { return [...leases.values()]; },
    takeLook() {
      const locked = echo.take(clock());
      const delta = { dx: dx + locked.dx, dy: dy + locked.dy }; dx = 0; dy = 0;
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
      doc.removeEventListener('mouseup', rightUp);
      surface.removeEventListener('mousedown', rightDown);
      surface.removeEventListener('pointerdown', rightDown);
      doc.removeEventListener('pointerup', rightUp);
      surface.removeEventListener('contextmenu', contextMenu);
      keyboard.removeEventListener('keydown', keydown, { capture: true });
      keyboard.removeEventListener('blur', lost);
    },
  };
}
