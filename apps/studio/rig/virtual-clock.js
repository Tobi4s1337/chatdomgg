// The studio's virtual clock, injected before any page script runs in every frame of a recording
// (Page.addScriptToEvaluateOnNewDocument reaches same-origin frames too).
//
// Time stands still until the recorder advances it. `__virtualClock.advance(ms)` moves the clock forward,
// fires every timer that falls due in order (each sees the time it was due at), then runs one round of
// requestAnimationFrame callbacks at the new time and seeks every Web Animation (CSS animations and
// transitions included) to it. Network, workers and promises still run on the real event loop between
// steps, so the recorder can wait for a frame to settle before it captures; the picture never depends
// on how fast the host is.
//
// One clock leads: the top frame's. Same-origin child frames register with it, start at its current time
// and advance with it. The configuration comes from `globalThis.__VIRTUAL_CLOCK_CONFIG__` if the recorder
// sets it in an earlier init script: { epoch: ms since 1970 at t = 0, origin: performance.now() at t = 0 }.
/* global window, document, performance, addEventListener -- runs in the page */
(() => {
  if (globalThis.__virtualClock) return;
  const config = globalThis.__VIRTUAL_CLOCK_CONFIG__ ?? {};
  const EPOCH = Number.isFinite(config.epoch) ? config.epoch : Date.UTC(2026, 10, 2, 19, 30, 0);
  const ORIGIN = Number.isFinite(config.origin) ? config.origin : 1000;

  const RealDate = Date;
  const real = {
    setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
    performanceNow: performance.now.bind(performance),
  };

  let leader = null;
  try { if (window.top !== window && window.top.__virtualClock) leader = window.top.__virtualClock; } catch { leader = null; }

  // Virtual milliseconds since t = 0. Child frames start where the leader stands.
  let now = leader ? leader.now() : 0;
  let nextId = 1;
  const timers = new Map(); // id → { due, seq, fn, args, interval }
  let seq = 0;
  let frameCallbacks = new Map();
  const animationStarts = new WeakMap();
  const followers = new Set();

  function schedule(fn, delay, args, interval) {
    const id = nextId++;
    const ms = Math.max(0, Number(delay) || 0);
    timers.set(id, { due: now + ms, seq: seq++, fn, args, interval: interval ? Math.max(1, ms) : 0 });
    return id;
  }
  function call(fn, args) {
    try { if (typeof fn === 'function') fn(...args); else (0, eval)(String(fn)); }
    catch (error) { real.setTimeout(() => { throw error; }); }
  }
  function nextDue(limit) {
    let best = null;
    for (const [id, timer] of timers) {
      if (timer.due > limit) continue;
      if (!best || timer.due < best[1].due || (timer.due === best[1].due && timer.seq < best[1].seq)) best = [id, timer];
    }
    return best;
  }

  globalThis.setTimeout = (fn, delay, ...args) => schedule(fn, delay, args, false);
  globalThis.setInterval = (fn, delay, ...args) => schedule(fn, delay, args, true);
  globalThis.clearTimeout = globalThis.clearInterval = id => { timers.delete(id); };
  globalThis.requestAnimationFrame = fn => { const id = nextId++; frameCallbacks.set(id, fn); return id; };
  globalThis.cancelAnimationFrame = id => { frameCallbacks.delete(id); };
  if ('requestIdleCallback' in globalThis) {
    globalThis.requestIdleCallback = (fn, options) => schedule(() => fn({ didTimeout: false, timeRemaining: () => 8 }), Math.min(options?.timeout ?? 1, 1), [], false);
    globalThis.cancelIdleCallback = id => { timers.delete(id); };
  }
  performance.now = () => ORIGIN + now;

  class VirtualDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(EPOCH + now); else super(...args); }
    static now() { return EPOCH + now; }
  }
  VirtualDate.parse = RealDate.parse; VirtualDate.UTC = RealDate.UTC;
  globalThis.Date = VirtualDate;

  function seekAnimations() {
    if (typeof document === 'undefined' || !document.getAnimations) return;
    for (const animation of document.getAnimations()) {
      if (!animationStarts.has(animation)) { animationStarts.set(animation, now); animation.pause(); }
      const local = now - animationStarts.get(animation);
      try { animation.currentTime = local; } catch { /* finished animations without fill may refuse */ }
    }
  }

  /** Advance this frame's clock to `target` virtual ms: timers in order, then one animation frame. */
  function stepTo(target) {
    for (;;) {
      const due = nextDue(target);
      if (!due) break;
      const [id, timer] = due;
      now = Math.max(now, timer.due);
      if (timer.interval) { timer.due += timer.interval; timer.seq = seq++; }
      else timers.delete(id);
      call(timer.fn, timer.args ?? []);
    }
    now = target;
    const callbacks = frameCallbacks;
    frameCallbacks = new Map();
    const stamp = ORIGIN + now;
    for (const fn of callbacks.values()) call(fn, [stamp]);
    seekAnimations();
  }

  const clock = {
    now: () => now,
    seconds: () => now / 1000,
    pendingTimers: () => timers.size,
    register(follower) { followers.add(follower); return () => followers.delete(follower); },
    /** Advances by `ms` here and in every registered same-origin frame; returns the new time in ms. */
    advance(ms) {
      const target = now + Math.max(0, Number(ms) || 0);
      stepTo(target);
      for (const follower of [...followers]) {
        try { follower.stepTo(target); } catch { followers.delete(follower); }
      }
      return now;
    },
    stepTo,
    /** Real wall time, for the recorder's own waits; never used by a page. */
    realNow: () => real.performanceNow(),
    realSleep: ms => new Promise(resolve => real.setTimeout(resolve, ms)),
  };
  Object.defineProperty(globalThis, '__virtualClock', { value: clock, configurable: false, enumerable: false, writable: false });
  if (leader) {
    const unregister = leader.register(clock);
    addEventListener('pagehide', unregister, { once: true });
  }
})();
