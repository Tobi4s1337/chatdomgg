import { describe, expect, it } from 'vitest';
import { createEchoFilter, createWalkLook, ECHO, type KeyboardLockLike } from './look';

type Outcome = 'grant' | 'refuse' | 'throw' | 'no-raw' | 'no-raw-event' | 'silent';
function harness(outcomes: Outcome[] = [], options: { keyboardLock?: boolean; fullscreen?: boolean; echoFilter?: boolean } = {}) {
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
  const look = createWalkLook(surface, doc, keyboard, { clock: () => now, keyboardLock, ...(options.echoFilter !== undefined ? { echoFilter: options.echoFilter } : {}) });
  const letGo: string[] = [];
  look.onLetGo(why => letGo.push(why));
  const key = (code: string, init: { repeat?: boolean; ctrlKey?: boolean; target?: unknown } = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, repeat: !!init.repeat, ctrlKey: !!init.ctrlKey, metaKey: false, altKey: false });
    if (init.target) Object.defineProperty(event, 'target', { value: init.target });
    keyboard.dispatchEvent(event);
    return event;
  };
  const move = (movementX: number, movementY = 0, buttons?: number) =>
    doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY, ...(buttons !== undefined ? { buttons } : {}) }));
  const mouseButton = (type: 'mousedown' | 'mouseup', button: number) => (type === 'mousedown' ? surface : doc).dispatchEvent(Object.assign(new Event(type), { button }));
  const contextMenu = () => { const event = new Event('contextmenu', { cancelable: true }); surface.dispatchEvent(event); return event; };
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); pending.splice(0).forEach(fn => fn()); for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const click = (isTrusted = true) => look.capture({ isTrusted, type: 'pointerdown', button: 0 });
  return { look, doc, surface, keyboard, requests, key, move, mouseButton, contextMenu, settle, click, browserRelease, letGo, keyboardCalls, advance: (ms: number) => { now += ms; } };
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
  'a lone big event between still ones': [2, 1, 850, 3, 0, -1],
  'a sign flip mid turn': [120, 130, -700, 125, 118],
  'a Firefox recentre pair mid turn': [8, 8, 300, -300, 8, 8],
};

describe('raw locked movement', () => {
  for (const [name, trace] of Object.entries(FLICKS)) {
    it(`adds every event 1:1, nothing held or dropped (${name})`, async () => {
      const { look, click, move, settle } = harness();
      click(); await settle();
      for (const dx of trace) move(dx, 0);
      expect(look.takeLook()).toEqual({ dx: trace.reduce((a, b) => a + b, 0), dy: 0 });
    });
  }
  it('ignores a movement that is not a number, and nothing while unlocked', async () => {
    const { look, click, move, settle } = harness();
    move(50, 5);
    expect(look.takeLook()).toEqual({ dx: 0, dy: 0 });
    click(); await settle();
    move(Number.NaN, 4); move(3, 1);
    expect(look.takeLook()).toEqual({ dx: 3, dy: 1 });
  });
});

/**
 * Recorded by Tobias in the mouse lab on his own machine (Linux, Firefox 158 on X11, dpr 1, 343 fps), 2 November
 * 2026: every real locked move ([1,0], [0,1]...) is followed by a fake one, the hidden cursor's offset from the
 * re-centre point, drifting by exactly the real movement. The hand moved about x 4, y -3 in all.
 */
const FIREFOX_X11_ECHOES: readonly (readonly [number, number])[] = [[0, 1], [-978, 105], [0, 1], [-978, 106], [1, 0], [-977, 106], [0, 1], [-977, 107],
  [1, 0], [-976, 107], [1, 0], [-974, 107], [1, 0], [-973, 107], [1, 0], [-972, 107], [1, 0], [-971, 107], [-971, 106], [1, 0], [-970, 106], [0, -1],
  [-970, 105], [0, -1], [-970, 104], [0, -1], [-970, 103], [0, -1], [-970, 102], [0, -1], [-970, 101], [0, -1], [-970, 100], [-1, 0], [-971, 100],
  [-1, 0], [-972, 100], [-1, 0], [-973, 100], [-974, 100]];
/** What the hand really did in that trace: every small event, summed. */
const FIREFOX_X11_HAND = FIREFOX_X11_ECHOES.filter(([x, y]) => Math.abs(x) < 50 && Math.abs(y) < 50)
  .reduce((sum, [x, y]) => ({ dx: sum.dx + x, dy: sum.dy + y }), { dx: 0, dy: 0 });

/** Windows and Chrome fast turns, 300 to 800 counts per event, at 60 Hz (one coalesced event a frame) and 1000 Hz. */
const WINDOWS_FLICKS: Record<string, readonly number[]> = {
  '60 Hz ramp to 800': [0, 300, 520, 800, 610, 330, 60, 4],
  '60 Hz ramp to 500, leftwards': [-20, -310, -500, -480, -300, -40],
  '60 Hz, a steady fast turn of equal events': [450, 450, 450, 450, 450, 450, 450, 450],
  '1000 Hz bell to 800': flick(800, 30),
  '60 Hz there and back': [320, 780, 300, -310, -790, -305, 2],
};

describe('the re-centre echo (Firefox on X11)', () => {
  it('turns by the hand only on Tobias\'s recorded trace: every fake re-centre event is dropped', () => {
    expect(FIREFOX_X11_HAND).toEqual({ dx: 4, dy: -3 });
    const filter = createEchoFilter();
    let at = 0;
    for (const [x, y] of FIREFOX_X11_ECHOES) filter.push(x, y, at++);
    expect(filter.take(at)).toEqual(FIREFOX_X11_HAND);
    expect(filter.echoes).toBe(FIREFOX_X11_ECHOES.length - 19);
    expect(filter.take(at + 1000)).toEqual({ dx: 0, dy: 0 });
  });
  it('does the same through the captured mouse, with every event in one instant', async () => {
    const { look, click, move, settle } = harness([], { echoFilter: true });
    click(); await settle();
    for (const [x, y] of FIREFOX_X11_ECHOES) move(x, y);
    expect(look.takeLook()).toEqual(FIREFOX_X11_HAND);
  });
  for (const [name, trace] of Object.entries({ ...WINDOWS_FLICKS, ...FLICKS })) {
    it(`keeps every count of a real fast turn with the filter on, a large event held a moment at most (${name})`, () => {
      const filter = createEchoFilter();
      let at = 0, dx = 0;
      const step = trace.length > 20 ? 1 : 16;
      for (const x of trace) { filter.push(x, 0, at); at += step; dx += filter.take(at).dx; }
      dx += filter.take(at + ECHO.holdMs + 1).dx;
      expect(dx).toBe(trace.reduce((a, b) => a + b, 0));
      expect(filter.echoes).toBe(0);
    });
  }
  it('holds a large event for at most one 60 Hz frame and gives it back whole', () => {
    const filter = createEchoFilter();
    filter.push(700, 0, 0);
    expect(filter.take(2)).toEqual({ dx: 0, dy: 0 });
    expect(filter.take(17)).toEqual({ dx: 700, dy: 0 });
  });
  for (const [name, trace] of Object.entries(WINDOWS_FLICKS)) {
    it(`Chrome has no filter: a fast turn arrives whole in the very frame it happened (${name})`, async () => {
      const { look, click, move, settle } = harness();
      click(); await settle();
      for (const dx of trace) move(dx, 0);
      expect(look.takeLook()).toEqual({ dx: trace.reduce((a, b) => a + b, 0), dy: 0 });
    });
  }
  it('learns afresh on every capture: an old offset never eats a new real move', async () => {
    const { look, click, move, settle, advance } = harness([], { echoFilter: true });
    click(); await settle();
    for (const [x, y] of FIREFOX_X11_ECHOES) move(x, y);
    look.takeLook();
    look.release(); advance(2000);
    click(); await settle();
    move(-975, 100); move(3, 0);
    advance(ECHO.holdMs + 1);
    expect(look.takeLook()).toEqual({ dx: -972, dy: 100 });
  });
  it('says the cursor drifts once echoes keep coming, and the first lock lost then is calm, not a pause', async () => {
    const { look, click, move, settle, browserRelease, letGo, advance } = harness([], { echoFilter: true });
    const views: boolean[] = [];
    look.onChange(view => views.push(view.drifting));
    click(); await settle();
    expect(look.drifting).toBe(false);
    for (const [x, y] of FIREFOX_X11_ECHOES) move(x, y);
    expect(look.drifting).toBe(true);
    expect(views.at(-1)).toBe(true);
    browserRelease();
    expect(letGo).toEqual(['drift']);
    expect(look.mode).toBe('idle');
    // The next time it is the ordinary let-go: the ledger opens as for Escape.
    advance(2000); click(); await settle();
    for (const [x, y] of FIREFOX_X11_ECHOES) move(x, y);
    browserRelease();
    expect(letGo).toEqual(['drift', 'browser']);
    expect(look.drifting).toBe(true);
  });
  it('a few stray echoes are not drift', async () => {
    const { look, click, move, settle, browserRelease, letGo } = harness([], { echoFilter: true });
    click(); await settle();
    for (const [x, y] of FIREFOX_X11_ECHOES.slice(0, 6)) move(x, y);
    expect(look.drifting).toBe(false);
    browserRelease();
    expect(letGo).toEqual(['browser']);
  });
});

describe('right-button look', () => {
  it('turns 1:1 while the right button is held, with the cursor free and no context menu', () => {
    const { look, move, mouseButton, contextMenu } = harness();
    expect(look.mode).toBe('idle');
    move(40, 3, 0);
    expect(look.takeLook()).toEqual({ dx: 0, dy: 0 });
    mouseButton('mousedown', 2);
    move(12, -4, 2); move(30, 1, 2);
    expect(contextMenu().defaultPrevented).toBe(true);
    expect(look.takeLook()).toEqual({ dx: 42, dy: -3 });
    mouseButton('mouseup', 2);
    move(25, 0, 0);
    expect(look.takeLook()).toEqual({ dx: 0, dy: 0 });
    expect(look.mode).toBe('idle');
  });
  it('ends when the button was let go outside the window, and never under a lease or a disabled walk', () => {
    const { look, move, mouseButton } = harness();
    mouseButton('mousedown', 2); move(5, 0, 2); move(9, 0, 0); move(9, 0, 0);
    expect(look.takeLook()).toEqual({ dx: 5, dy: 0 });
    const lease = look.lease('forge');
    mouseButton('mousedown', 2); move(30, 0, 2);
    expect(look.takeLook()).toEqual({ dx: 0, dy: 0 });
    lease.release();
    look.setEnabled(false);
    mouseButton('mousedown', 2); move(30, 0, 2);
    expect(look.takeLook()).toEqual({ dx: 0, dy: 0 });
  });
  it('works where the page can never capture the mouse, and the left button still captures where it can', async () => {
    const { look, move, mouseButton, click, settle } = harness(['throw', 'throw', 'throw']);
    for (let i = 0; i < 3; i++) { click(); await settle(); }
    expect(look.mode).toBe('unavailable');
    mouseButton('mousedown', 2); move(17, 2, 2);
    expect(look.takeLook()).toEqual({ dx: 17, dy: 2 });
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
