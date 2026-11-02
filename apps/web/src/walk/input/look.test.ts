import { describe, expect, it } from 'vitest';
import { createSpikeFilter, createWalkLook, LOOK, type KeyboardLockLike } from './look';

type Outcome = 'grant' | 'refuse' | 'throw' | 'no-raw' | 'no-raw-event' | 'silent';
function harness(outcomes: Outcome[] = [], options: { keyboardLock?: boolean; fullscreen?: boolean } = {}) {
  let now = 1000;
  const requests: ({ unadjustedMovement?: boolean } | undefined)[] = [];
  const keyboardCalls: string[] = [];
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    fullscreenElement: null as unknown,
    fullscreenEnabled: options.fullscreen !== false,
    exitPointerLock() {
      if (doc.pointerLockElement === null) return;
      doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange'));
    },
    exitFullscreen() { doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); },
    documentElement: { requestFullscreen() { doc.fullscreenElement = doc.documentElement; doc.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); } },
  });
  /** The browser's own release: Escape eaten by the browser, focus loss. */
  const browserRelease = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); };
  const grant = () => { doc.pointerLockElement = surface; doc.dispatchEvent(new Event('pointerlockchange')); };
  const pending: (() => void)[] = [];
  const surface = Object.assign(new EventTarget(), {
    requestPointerLock(request?: { unadjustedMovement?: boolean }) {
      requests.push(request);
      const outcome = outcomes.shift() ?? 'grant';
      if (outcome === 'throw') throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
      if (outcome === 'no-raw') return Promise.reject(Object.assign(new Error('raw'), { name: 'NotSupportedError' }));
      if (outcome === 'no-raw-event') {
        // Chromium without raw input: the promise rejects and a pointerlockerror follows a moment later.
        queueMicrotask(() => queueMicrotask(() => doc.dispatchEvent(new Event('pointerlockerror'))));
        return Promise.reject(Object.assign(new Error('raw'), { name: 'NotSupportedError' }));
      }
      if (outcome === 'refuse') {
        // Chrome both rejects the promise and fires pointerlockerror.
        doc.dispatchEvent(new Event('pointerlockerror'));
        return Promise.reject(Object.assign(new Error('cooldown'), { name: 'SecurityError' }));
      }
      // Safari: no promise; the answer arrives as an event.
      if (outcome === 'silent') { pending.push(grant); return undefined; }
      pending.push(grant);
      return Promise.resolve();
    },
  });
  const keyboard = new EventTarget();
  const keyboardLock: KeyboardLockLike | null = options.keyboardLock ? {
    lock() { keyboardCalls.push('lock'); return Promise.resolve(); }, unlock() { keyboardCalls.push('unlock'); },
  } : null;
  const look = createWalkLook(surface, doc, keyboard, { clock: () => now, keyboardLock });
  const letGo: string[] = [];
  look.onLetGo(why => letGo.push(why));
  const key = (code: string, init: { repeat?: boolean; ctrlKey?: boolean; target?: unknown } = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: !!init.repeat, ctrlKey: !!init.ctrlKey, metaKey: false, altKey: false });
    if (init.target) Object.defineProperty(event, 'target', { value: init.target });
    keyboard.dispatchEvent(event);
    return event;
  };
  const move = (movementX: number, movementY = 0) => doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY }));
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); pending.splice(0).forEach(fn => fn()); for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const click = (isTrusted = true) => look.capture({ isTrusted, type: 'pointerdown', button: 0 });
  return { look, doc, surface, keyboard, requests, key, move, settle, click, browserRelease, letGo, keyboardCalls, advance: (ms: number) => { now += ms; } };
}

/**
 * Fast turns as a hand makes them: a bell-shaped speed profile sampled at a mouse's polling rate. These are
 * generated, not recorded on hardware; the shapes follow published mouse traces (a flick ramps up and down over
 * several polls), with peaks between 400 and 900 px per event as the brief asks.
 */
function flick(peak: number, polls: number, sign = 1): number[] {
  return Array.from({ length: polls }, (_, i) => Math.round(sign * peak * Math.sin(Math.PI * (i + .5) / polls) ** 2));
}
const FLICKS: Record<string, number[]> = {
  '125 Hz, 900 px peak': flick(900, 6),
  '125 Hz, 400 px peak, leftwards': flick(400, 5, -1),
  '60 Hz coalesced, 700 px peak': [0, 410, 700, 380, 40],
  '1000 Hz, 450 px peak': flick(450, 24),
  'two flicks back to back': [...flick(600, 5), ...flick(820, 5, -1)],
  'flick straight out of a still hand': [0, 0, 470, 880, 640, 210, 12],
  '60 Hz, a snap from a still hand landing in one frame': [0, 1000, 120, 0],
  '60 Hz, a shorter snap in one frame': [0, 0, 760, 95, 4],
};

describe('the flick filter', () => {
  for (const [name, trace] of Object.entries(FLICKS)) {
    it(`keeps every pixel of a real flick (${name})`, () => {
      const filter = createSpikeFilter();
      let sum = 0, at = 0;
      for (const dx of trace) { sum += filter.push(dx, 0, at).dx; at += 8; }
      sum += filter.flush(at + LOOK.holdMs).dx;
      expect(sum).toBe(trace.reduce((a, b) => a + b, 0));
      expect(filter.rejected).toBe(0);
      expect(Math.max(...trace.map(Math.abs))).toBeGreaterThanOrEqual(400);
    });
  }

  it('drops an isolated warp between still events, and a warp the moment the lock lands', () => {
    const filter = createSpikeFilter();
    let sum = 0, at = 0;
    for (const dx of [2, 1, 850, 3, 0, -1]) { sum += filter.push(dx, 0, at).dx; at += 8; }
    expect(sum).toBe(5);
    filter.reset();
    sum = filter.push(-1200, 640, 0).dx; // the first event after locking, from nowhere
    sum += filter.flush(LOOK.holdMs).dx;
    expect(sum).toBe(0);
    expect(filter.rejected).toBe(2);
  });

  it('drops a warp in the middle of a slow steady turn, which no tail follows', () => {
    const filter = createSpikeFilter();
    let sum = 0, at = 0;
    for (const dx of [10, 12, 1500, 11, 10]) { sum += filter.push(dx, 0, at).dx; at += 8; }
    expect(sum).toBe(43);
    expect(filter.rejected).toBe(1);
  });

  it('drops a sign-flipped spike in the middle of a steady turn, and keeps a real reversal', () => {
    const steady = createSpikeFilter();
    let sum = 0;
    for (const dx of [120, 130, -700, 125, 118]) sum += steady.push(dx, 0, 0).dx;
    expect(sum).toBe(120 + 130 + 125 + 118);
    const reversal = createSpikeFilter();
    sum = 0;
    for (const dx of [120, 130, -700, -650, -300]) sum += reversal.push(dx, 0, 0).dx;
    expect(sum).toBe(120 + 130 - 700 - 650 - 300);
  });

  it('holds a big event at most one neighbour or holdMs, never longer', () => {
    const filter = createSpikeFilter();
    expect(filter.push(0, 0, 0).dx).toBe(0);
    expect(filter.push(500, 0, 8).dx).toBe(0); // held: is it a flick or a warp?
    expect(filter.flush(8 + LOOK.holdMs - 1).dx).toBe(0);
    expect(filter.push(600, 0, 16).dx).toBe(1100); // its neighbour proves the flick: both arrive at once
    expect(filter.push(Number.NaN, 4, 24)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('the captured mouse', () => {
  it('captures with raw input on a trusted press, and gathers every locked event of a slow frame', async () => {
    const { look, click, move, settle, requests } = harness();
    expect(look.mode).toBe('idle');
    expect(click(false)).toBe(false); // synthetic presses never capture
    expect(click()).toBe(true);
    expect(look.mode).toBe('requesting');
    expect(requests).toEqual([{ unadjustedMovement: true }]);
    await settle();
    expect(look.mode).toBe('locked');
    for (const dx of [40, 180, 450, 900, 820, 400, 120]) move(dx, 3);
    expect(look.takeLook()).toEqual({ dx: 40 + 180 + 450 + 900 + 820 + 400 + 120, dy: 21 });
    expect(look.takeLook()).toEqual({ dx: 0, dy: 0 });
  });

  it('retries once without raw input inside the same press when the platform has none, then stops asking for it', async () => {
    const { look, click, settle, requests, browserRelease, advance } = harness(['no-raw', 'grant', 'grant']);
    click();
    await settle();
    expect(requests).toEqual([{ unadjustedMovement: true }, undefined]);
    expect(look.mode).toBe('locked');
    browserRelease(); advance(5000);
    click(); await settle();
    expect(requests.at(-1)).toBeUndefined();
    expect(look.mode).toBe('locked');
  });

  it('locks on the first press when the refused raw request also fires pointerlockerror (Chromium without raw input)', async () => {
    const { look, click, settle, requests } = harness(['no-raw-event', 'grant']);
    click();
    await settle();
    expect(requests).toEqual([{ unadjustedMovement: true }, undefined]);
    expect(look.mode).toBe('locked');
  });

  it('works when the browser answers with events instead of a promise (Safari)', async () => {
    const { look, click, settle } = harness(['silent']);
    click(); await settle();
    expect(look.mode).toBe('locked');
  });

  it('lets go into the ledger when the browser eats Escape, then waits calmly through the re-lock cooldown', async () => {
    const { look, click, settle, browserRelease, letGo, advance } = harness(['grant', 'refuse', 'grant']);
    click(); await settle();
    browserRelease();
    expect(letGo).toEqual(['browser']);
    expect(look.mode).toBe('idle');
    advance(300);
    click(); await settle();
    expect(look.mode).toBe('cooldown'); // calm: the next click asks again
    advance(900);
    click(); await settle();
    expect(look.mode).toBe('locked');
  });

  it('never reports its own release (a panel, a takeover) as the person letting go', async () => {
    const { look, click, settle, letGo } = harness();
    click(); await settle();
    look.release();
    expect(look.mode).toBe('idle');
    expect(letGo).toEqual([]);
  });

  it('holds the cursor for every lease, refuses to capture under one, and returns to click-to-walk when the last goes', async () => {
    const { look, click, settle, letGo } = harness();
    click(); await settle();
    const forge = look.lease('forge'), builder = look.lease('builder');
    expect(look.mode).toBe('leased');
    expect(look.leases).toEqual(['forge', 'builder']);
    expect(click()).toBe(false);
    forge.release(); forge.release();
    expect(look.mode).toBe('leased');
    expect(forge.active).toBe(false);
    builder.release();
    expect(look.mode).toBe('idle');
    expect(letGo).toEqual([]);
    expect(click()).toBe(true);
  });

  it('hands back a lock that lands after a lease took the cursor mid-request', async () => {
    const { look, click, settle, doc } = harness();
    click();
    const lease = look.lease('ledger');
    await settle();
    expect(doc.pointerLockElement).toBeNull();
    expect(look.mode).toBe('leased');
    lease.release();
    expect(look.mode).toBe('idle');
  });

  it('becomes unavailable only after repeated refusals no cooldown explains (a sandboxed frame)', async () => {
    const { look, click, settle } = harness(['throw', 'throw', 'throw']);
    click(); await settle(); expect(look.mode).toBe('idle');
    click(); await settle(); expect(look.mode).toBe('idle');
    click(); await settle(); expect(look.mode).toBe('unavailable');
    expect(click()).toBe(false);
  });

  it('lets go on a disabled walk and captures nothing until enabled again', async () => {
    const { look, click, settle, letGo } = harness();
    click(); await settle();
    look.setEnabled(false);
    expect(look.mode).toBe('idle');
    expect(click()).toBe(false);
    look.setEnabled(true);
    expect(click()).toBe(true);
    expect(letGo).toEqual([]);
  });

  it('takes the keyboard in fullscreen: Escape opens the ledger, browser shortcuts never reach the browser', async () => {
    const { look, click, settle, key, letGo, keyboardCalls } = harness([], { keyboardLock: true });
    expect(look.canFullscreen).toBe(true);
    expect(look.canLockKeyboard).toBe(true);
    await look.toggleFullscreen();
    expect(look.fullscreen).toBe(true);
    expect(look.keyboardLocked).toBe(true);
    click(); await settle();
    const close = key('KeyW', { ctrlKey: true });
    expect(close.defaultPrevented).toBe(true); // Ctrl+W never closes the tab
    const typing = key('KeyC', { ctrlKey: true, target: { tagName: 'INPUT', type: 'text' } });
    expect(typing.defaultPrevented).toBe(false); // copying from a text field still works
    const escape = key('Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(letGo).toEqual(['escape']);
    expect(look.mode).toBe('idle');
    key('Escape', { repeat: true }); // holding Escape is the browser's way out of fullscreen
    expect(letGo).toEqual(['escape']);
    await look.toggleFullscreen();
    expect(look.fullscreen).toBe(false);
    expect(look.keyboardLocked).toBe(false);
    expect(keyboardCalls).toEqual(['lock', 'unlock']);
  });

  it('outside keyboard lock, modifier shortcuts are left to the browser', async () => {
    const { click, settle, key } = harness();
    click(); await settle();
    expect(key('KeyW', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('drops a held key state when the browser leaves fullscreen on its own (held Escape)', async () => {
    const { look, doc, keyboardCalls } = harness([], { keyboardLock: true });
    await look.toggleFullscreen();
    doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange'));
    expect(look.keyboardLocked).toBe(false);
    expect(keyboardCalls).toEqual(['lock', 'unlock']);
  });

  it('reports a page without pointer lock as unavailable from the start', () => {
    const doc = Object.assign(new EventTarget(), { pointerLockElement: null });
    const look = createWalkLook(new EventTarget(), doc, new EventTarget(), { keyboardLock: null });
    expect(look.mode).toBe('unavailable');
    look.dispose();
  });
});
