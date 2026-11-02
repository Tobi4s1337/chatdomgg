import { describe, expect, it, vi } from 'vitest';
import type { KingdomId } from '@chatdom/shared';
import { createWalkLook } from '../walk/input/look';
import type { WalkController } from '../walk';
import { createPlaySession } from './session';
import { createPlaySettings } from './settings';
import { equipTool, registerActionBinding, registerArrivalStep, registerHeldTool, registerWorldPrompt } from './slots';
import type { PlayWorld } from './tools';
import type { PlayHost, PlayHud } from './host';

function harness(world?: PlayWorld) {
  const doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    exitPointerLock() { if (doc.pointerLockElement) { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); } },
  });
  const surface = Object.assign(new EventTarget(), {
    requestPointerLock() { doc.pointerLockElement = surface; doc.dispatchEvent(new Event('pointerlockchange')); },
  });
  const keyboard = windowKeys();
  const cursor = createWalkLook(surface, doc, keyboard, { keyboardLock: null });
  let held = false, sink: ((dx: number, dy: number) => void) | null = null;
  const controller = { cursor, touch: false, owner: 'walking', hold: vi.fn((value: boolean) => { held = value; }), get held() { return held; },
    divertLook: (next: typeof sink) => { sink = next; } } as unknown as WalkController;
  let open = false, capturing = false, host: PlayHost | undefined, lease: { release(): void } | null = null;
  const ledger = new Set<(open: boolean) => void>();
  // Like the real ledger, it takes the cursor through the context while it is open.
  const hud: PlayHud = {
    openLedger: vi.fn(() => { if (!open) { open = true; lease = host!.ctx.requestCursor('ledger'); for (const l of ledger) l(true); } }),
    closeLedger: vi.fn(() => { if (open) { open = false; capturing = false; lease?.release(); lease = null; for (const l of ledger) l(false); } }),
    get ledgerOpen() { return open; },
    get keyCapture() { return open && capturing; },
    onLedger(listener) { ledger.add(listener); return () => ledger.delete(listener); },
    escape: vi.fn(() => { if (!open) return false; hud.closeLedger(); return true; }),
    dispose: vi.fn(),
  };
  const settings = createPlaySettings(null);
  const cue = vi.fn(), use = vi.fn();
  const session = createPlaySession({ host: {} as HTMLElement, controller, kingdomId: '1' as KingdomId, self: null, live: () => true,
    wayHome: () => null, build: { open: null, note: 'Not yet.' }, cue, use, settings, keyboard, ...(world ? { world } : {}),
    mountHud: (_host, play) => { host = play; return hud; } });
  const key = (code: string, init: { repeat?: boolean; type?: 'keydown' | 'keyup'; panel?: (event: Event) => void } = {}) => {
    const event = Object.assign(new Event(init.type ?? 'keydown', { cancelable: true }), { code, repeat: !!init.repeat, ctrlKey: false, metaKey: false, altKey: false, isComposing: false });
    keyboard.press(event, init.panel);
    return event;
  };
  const listenForKey = (on: boolean) => { capturing = on; };
  const lock = () => cursor.capture({ isTrusted: true, type: 'pointerdown', button: 0 });
  /** The browser's own release: it ate Escape. */
  const browserEscape = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); };
  return { session, controller, cursor, hud, settings, key, lock, browserEscape, cue, use, host: () => host!, doc, listenForKey,
    moveMouse: (dx: number, dy: number) => sink?.(dx, dy) };
}

/**
 * The window as keys reach it: its capture listeners, then the page in between (a panel on the document or the
 * focused element, which may take the press and stop it), then its bubble listeners.
 */
function windowKeys() {
  type Entry = { type: string; listener: EventListenerOrEventListenerObject; capture: boolean };
  const entries: Entry[] = [];
  const capture = (options?: boolean | AddEventListenerOptions) => typeof options === 'boolean' ? options : !!options?.capture;
  const call = (entry: Entry, event: Event) => typeof entry.listener === 'function' ? entry.listener(event) : entry.listener.handleEvent(event);
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (listener) entries.push({ type, listener, capture: capture(options) });
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      const at = entries.findIndex(entry => entry.type === type && entry.listener === listener && entry.capture === capture(options));
      if (at >= 0) entries.splice(at, 1);
    },
    dispatchEvent(event: Event) { this.press(event); return !event.defaultPrevented; },
    press(event: Event, panel?: (event: Event) => void) {
      let stopped = false;
      const stop = event.stopPropagation.bind(event), stopNow = event.stopImmediatePropagation.bind(event);
      event.stopPropagation = () => { stopped = true; stop(); };
      event.stopImmediatePropagation = () => { stopped = true; stopNow(); };
      for (const entry of entries.filter(e => e.type === event.type && e.capture)) { if (stopped) return; call(entry, event); }
      if (stopped) return;
      panel?.(event);
      for (const entry of entries.filter(e => e.type === event.type && !e.capture)) { if (stopped) return; call(entry, event); }
    },
  };
}

describe('the play session', () => {
  it('opens the ledger when the browser eats Escape, holding the walk and the cursor until it closes', async () => {
    const { session, hud, cursor, controller, lock, browserEscape } = harness();
    await session.arrived;
    lock();
    expect(cursor.mode).toBe('locked');
    browserEscape();
    expect(hud.ledgerOpen).toBe(true);
    expect(cursor.mode).toBe('leased');
    expect(controller.held).toBe(true);
    hud.closeLedger();
    expect(cursor.mode).toBe('idle');
    expect(controller.held).toBe(false);
  });

  it('closes the ledger with Escape into the calm click-to-walk state, and opens it again from there', async () => {
    const { session, hud, cursor, key } = harness();
    await session.arrived;
    hud.openLedger();
    expect(key('Escape').defaultPrevented).toBe(true);
    expect([hud.ledgerOpen, cursor.mode]).toEqual([false, 'idle']);
    key('Escape');
    expect(hud.ledgerOpen).toBe(true);
  });

  it('lets the top panel take Escape first: a panel that closes on it keeps the ledger shut', async () => {
    const { session, hud, key, lock, browserEscape } = harness();
    await session.arrived;
    lock(); browserEscape(); hud.closeLedger();
    // A gesture panel open over the free cursor closes on Escape and takes the press, as walk/gestures does.
    let panelOpen = true;
    const panel = (event: Event) => { if (!panelOpen) return; panelOpen = false; event.preventDefault(); event.stopPropagation(); };
    key('Escape', { panel });
    expect([panelOpen, hud.ledgerOpen]).toEqual([false, false]);
    // A panel that ignores Escape leaves it to the ledger.
    key('Escape', { panel });
    expect(hud.ledgerOpen).toBe(true);
  });

  it('gives a listening key plate every key, the ledger key included', async () => {
    const { session, hud, key, listenForKey } = harness();
    await session.arrived;
    hud.openLedger();
    listenForKey(true);
    key('KeyP');
    key('Escape');
    expect(hud.ledgerOpen).toBe(true);
    listenForKey(false);
    key('KeyP');
    expect(hud.ledgerOpen).toBe(false);
  });

  it('comes back to the street and captures the mouse in one trusted click, never from a script', async () => {
    const { session, hud, cursor, host } = harness();
    await session.arrived;
    hud.openLedger();
    host().resume({ isTrusted: false });
    expect(hud.ledgerOpen).toBe(true);
    host().resume({ isTrusted: true });
    expect([hud.ledgerOpen, cursor.mode]).toEqual([false, 'locked']);
  });

  it('toggles first and third person on the bound view key, never while the ledger is open', async () => {
    const { session, settings, key, hud, cue } = harness();
    await session.arrived;
    key('KeyV');
    expect(settings.get('view')).toBe('first');
    expect(cue).toHaveBeenCalledWith('wood');
    key('KeyV', { repeat: true });
    expect(settings.get('view')).toBe('first');
    hud.openLedger();
    key('KeyV');
    expect(settings.get('view')).toBe('first');
    hud.closeLedger();
    settings.bind('view', 'KeyC');
    key('KeyV');
    expect(settings.get('view')).toBe('first');
    key('KeyC');
    expect(settings.get('view')).toBe('third');
  });

  it('opens and closes the ledger on its key, and uses through a rebound use key', async () => {
    const { session, hud, key, settings, use, lock, cursor } = harness();
    await session.arrived;
    lock();
    key('KeyP');
    expect(hud.ledgerOpen).toBe(true);
    expect(cursor.mode).toBe('leased');
    key('KeyP');
    expect(hud.ledgerOpen).toBe(false);
    key('KeyE');
    expect(use).not.toHaveBeenCalled(); // E belongs to the interaction owner itself
    settings.bind('use', 'KeyG');
    key('KeyG');
    expect(use).toHaveBeenCalledOnce();
  });

  it('gives panels the cursor through leases from the context', async () => {
    const { session, cursor, lock } = harness();
    await session.arrived;
    lock();
    const lease = session.ctx.requestCursor('forge');
    expect(cursor.mode).toBe('leased');
    lease.release();
    expect(cursor.mode).toBe('idle');
  });

  it('runs arrival steps first, holding the walk and the cursor, and never opens the ledger over them', async () => {
    let finish!: () => void;
    const off = registerArrivalStep({ id: 'mirror-test', order: 1, wanted: () => true, run: () => new Promise<void>(resolve => { finish = resolve; }) });
    const { session, controller, cursor, hud, key } = harness();
    expect(controller.held).toBe(true);
    expect(cursor.mode).toBe('leased');
    key('Escape');
    expect(hud.ledgerOpen).toBe(false);
    finish();
    await session.arrived;
    expect(controller.held).toBe(false);
    expect(cursor.mode).toBe('idle');
    off();
  });

  it('lets go of everything on dispose', async () => {
    const { session, hud, controller, key, settings } = harness();
    await session.arrived;
    hud.openLedger();
    session.dispose();
    expect(hud.dispose).toHaveBeenCalledOnce();
    expect(controller.held).toBe(false);
    key('KeyV');
    expect(settings.get('view')).toBe('third');
  });

  it('lends keys and the captured mouse to a seated game, newest first, and the walk takes them back on release', async () => {
    const { session, controller, cursor, key, lock, moveMouse, cue, hud } = harness();
    await session.arrived;
    lock();
    const cards = session.ctx.requestInput('cards'), heard: string[] = [], moved: number[][] = [];
    cards.onKey((code, down) => heard.push(`${code}:${down}`));
    cards.onPointer((dx, dy, buttons) => moved.push([dx, dy, buttons]));
    expect([cards.active, controller.held, cursor.mode]).toEqual([true, true, 'locked']);
    key('KeyW'); key('KeyW', { repeat: true }); key('KeyW', { type: 'keyup' }); key('Escape');
    expect(hud.ledgerOpen).toBe(false);
    lock();
    key('KeyV');
    expect(heard).toEqual(['KeyW:true', 'KeyW:false', 'KeyV:true']);
    expect(cue).not.toHaveBeenCalled();
    moveMouse(12, -3);
    expect(session.pointer('down', 0, 1)).toBe(true);
    expect(moved).toEqual([[12, -3, 0], [0, 0, 1]]);
    const dice = session.ctx.requestInput('dice');
    expect([cards.active, dice.active]).toEqual([false, true]);
    dice.release();
    expect(cards.active).toBe(true);
    cards.release(); cards.release();
    expect([cards.active, controller.held, session.pointer('down', 0, 1)]).toEqual([false, false, false]);
  });

  it('a seated game and the ledger hold the walk together: closing one never frees the other', async () => {
    const { session, controller, hud } = harness();
    await session.arrived;
    const game = session.ctx.requestInput('cards');
    hud.openLedger(); hud.closeLedger();
    expect(controller.held).toBe(true);
    game.release();
    expect(controller.held).toBe(false);
  });

  it('hides your own body only while some view asks for it', async () => {
    const { session } = harness();
    await session.arrived;
    const table = session.ctx.hideSelf('table'), other = session.ctx.hideSelf('cards');
    expect(session.selfHidden).toBe(true);
    table.release();
    expect(session.selfHidden).toBe(true);
    other.release();
    expect(session.selfHidden).toBe(false);
  });

  it('hands the captured mouse to the tool in hand, and the use key to the nearest world prompt', async () => {
    let focused = false;
    const clock = 100;
    const posed: unknown[] = [];
    const world = { room: { onMessage: () => () => {}, send: vi.fn() }, pose: () => ({ position: [0, 0, 0] as const, yaw: 0, lookUp: 0, grounded: true }),
      hand: () => null, holdPose: (pose: unknown) => posed.push(pose), scene: {} as never, camera: {} as never, now: () => clock, interactionFocused: () => focused } as PlayWorld;
    const calls: string[] = [];
    const stopTool = registerHeldTool({ id: 'rod', equip(ctx) {
      ctx.holdPose('hold');
      return { press: at => calls.push(`press@${at}`), release: at => calls.push(`release@${at}`), cancel: () => calls.push('cancel'), update: () => {}, dispose: () => calls.push('down') };
    } });
    const rack = { prompt: () => ({ label: 'Take a rod', at: [2, 0, 0] as const }), use: vi.fn() };
    const far = { prompt: () => ({ label: 'Read the Almanac', at: [9, 0, 0] as const }), use: vi.fn() };
    const stopPrompts = [registerWorldPrompt({ id: 'rack', ...rack }), registerWorldPrompt({ id: 'almanac', ...far })];
    try {
      const { session, key, host, hud, use } = harness(world);
      await session.arrived;
      expect(session.pointer('down', 0, 1)).toBe(false);
      equipTool('rod');
      expect(session.tools?.tool).toBe('rod');
      expect([session.pointer('down', 0, 1), session.pointer('up', 0, 0), session.pointer('down', 2, 2)]).toEqual([true, true, true]);
      expect(calls).toEqual(['press@100', 'release@100', 'cancel']);
      session.frame(.25);
      expect(host().prompt).toEqual({ id: 'rack', label: 'Take a rod' });
      key('KeyE');
      expect(rack.use).toHaveBeenCalledTimes(1);
      focused = true;
      key('KeyE');
      expect(rack.use).toHaveBeenCalledTimes(1);
      expect(use).not.toHaveBeenCalled();
      hud.openLedger(); session.frame(.25);
      expect([host().prompt, session.pointer('down', 0, 1)]).toEqual([null, false]);
      expect(calls.at(-1)).toBe('cancel');
      hud.closeLedger();
      equipTool(null);
      expect(calls.at(-1)).toBe('down');
      expect(posed).toEqual(['hold', null]);
    } finally { stopTool(); for (const stop of stopPrompts) stop(); equipTool(null); }
  });

  it('hears other lanes\' keys on the person\'s binding, never over play\'s own', async () => {
    const pressed = vi.fn();
    const stop = registerActionBinding({ id: 'bag', label: 'Open your bag', defaultCode: 'KeyB', onPress: pressed });
    try {
      const { session, key, settings } = harness();
      await session.arrived;
      key('KeyB');
      expect(pressed).toHaveBeenCalledTimes(1);
      settings.bindAction('bag', 'KeyI');
      key('KeyB'); key('KeyI');
      expect(pressed).toHaveBeenCalledTimes(2);
    } finally { stop(); }
  });
});
