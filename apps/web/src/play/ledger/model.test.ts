import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KingdomId } from '@chatdom/shared';
import type { CursorView, PlayHost } from '../host';
import { createPlaySettings, PLAY_SETTINGS_KEY } from '../settings';
import { registerActionBinding, registerForgeEntry, registerLedgerPage, type LedgerPageProvider, type PlayContext } from '../slots';
import { bindingTarget, createLedger } from './model';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}

function fakePlay(options: { mode?: PlayContext['mode']; storage?: ReturnType<typeof memory> } = {}) {
  const storage = options.storage ?? memory();
  const settings = createPlaySettings(storage);
  const cues: string[] = [];
  const leases: { reason: string; released: boolean }[] = [];
  const cursor: CursorView = { state: 'idle', fullscreen: false, keyboardLocked: false, canFullscreen: true, canLockKeyboard: true };
  const ctx: PlayContext = {
    kingdomId: '1' as KingdomId, self: { personId: 'p1', publicName: 'Rowan', lookToken: 'starter-1' }, live: false,
    mode: options.mode ?? 'walking', settings,
    requestCursor(reason) { const lease = { reason, released: false }; leases.push(lease); return { release() { lease.released = true; }, get active() { return !lease.released; } }; },
    closeLedger() {},
    requestInput: () => ({ active: true, onKey: () => () => {}, onPointer: () => () => {}, release() {} }),
    hideSelf: () => ({ release() {} }),
  };
  const play = {
    ctx, settings, cursor, onCursor: () => () => {},
    resume: vi.fn(), toggleFullscreen: vi.fn(), wayHome: () => null,
    build: { open: vi.fn(), note: '' }, volumes: [], cue: (surface: string) => { cues.push(surface); },
    prompt: null, onPrompt: () => () => {}, usePrompt: vi.fn(),
  } satisfies PlayHost;
  return { play, cues, leases, storage, settings };
}

const page = (id: string, order: number, available = () => true): LedgerPageProvider =>
  ({ id, title: `Page ${id}`, order, available, mount: () => () => {} });

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

describe('the ledger pages', () => {
  it('shows only pages that have a provider, in order, and adds or drops tabs live while open', () => {
    const { play } = fakePlay();
    const ledger = createLedger(play);
    cleanups.push(() => ledger.dispose());
    ledger.open();
    expect(ledger.state.tabs.map(tab => tab.id)).toEqual(['settings', 'card', 'way-home', 'build', 'help']);
    expect(ledger.state.tabs.some(tab => tab.id === 'look')).toBe(false);

    const offLook = registerLedgerPage(page('look', 15));
    const offRaid = registerLedgerPage(page('raid-gate', 40));
    cleanups.push(offLook, offRaid);
    expect(ledger.state.tabs.map(tab => tab.id)).toEqual(['settings', 'card', 'look', 'way-home', 'build', 'raid-gate', 'help']);

    ledger.select('look');
    offLook();
    expect(ledger.state.tabs.map(tab => tab.id)).toEqual(['settings', 'card', 'way-home', 'build', 'raid-gate', 'help']);
    // The page in view went away: the reader lands on the nearest earlier page, never on a blank.
    expect(ledger.state.page).toBe('card');
  });

  it('leaves out a page that says it is not available, and one that may not replace a page of its own', () => {
    let live = false;
    const offForged = registerLedgerPage(page('forged', 50, () => live));
    const offSettings = registerLedgerPage(page('settings', 5));
    cleanups.push(offForged, offSettings);
    const { play } = fakePlay();
    const ledger = createLedger(play);
    cleanups.push(() => ledger.dispose());
    ledger.open();
    expect(ledger.state.tabs.map(tab => tab.id)).toEqual(['settings', 'card', 'way-home', 'build', 'help']);
    expect(ledger.state.tabs[0]!.provider).toBeNull();
    live = true;
    ledger.refresh();
    expect(ledger.state.tabs.map(tab => tab.id)).toContain('forged');
  });

  it('offers the Forge as a way out only when forge-wish has no page of its own, and hands over before closing', () => {
    const openForge = vi.fn();
    cleanups.push(registerForgeEntry({ available: () => true, openForge }));
    const { play, leases } = fakePlay();
    const ledger = createLedger(play);
    cleanups.push(() => ledger.dispose());
    ledger.open();
    expect(ledger.state.forge).not.toBeNull();
    const offPage = registerLedgerPage(page('forge', 35));
    expect(ledger.state.forge).toBeNull();
    offPage();
    expect(ledger.state.forge).not.toBeNull();
    openForge.mockImplementation(() => expect(leases[0]!.released).toBe(false));
    ledger.openForge();
    expect(openForge).toHaveBeenCalledWith({ from: 'ledger', ctx: play.ctx });
    expect(ledger.state.open).toBe(false);
    expect(leases[0]!.released).toBe(true);
  });

  it('opens the build rack only where the engine offers it, then closes', () => {
    const { play } = fakePlay();
    const ledger = createLedger(play);
    ledger.open('build');
    ledger.openBuild();
    expect(play.build.open).toHaveBeenCalledTimes(1);
    expect(ledger.state.open).toBe(false);
  });
});

describe('opening, closing and the cursor', () => {
  it('takes the cursor lease while open, gives it back on close, and sounds the shutter both ways', () => {
    const { play, cues, leases } = fakePlay();
    const ledger = createLedger(play);
    const seen: boolean[] = [];
    ledger.subscribe(state => seen.push(state.open));
    ledger.open('help');
    expect(ledger.state).toMatchObject({ open: true, page: 'help' });
    expect(leases).toEqual([{ reason: 'ledger', released: false }]);
    ledger.close();
    expect(leases[0]!.released).toBe(true);
    expect(cues).toEqual(['wood', 'wood']);
    // It reopens where the reader left it.
    ledger.open();
    expect(ledger.state.page).toBe('help');
    expect(seen.filter((open, i) => open !== seen[i - 1])).toEqual([true, false, true]);
  });

  it('never opens in the stream view', () => {
    const { play, leases } = fakePlay({ mode: 'stream' });
    const ledger = createLedger(play);
    ledger.open();
    expect(ledger.state.open).toBe(false);
    expect(leases).toEqual([]);
  });

  it('goes back to the street only from a trusted click', () => {
    const { play } = fakePlay();
    const ledger = createLedger(play);
    ledger.open();
    expect(ledger.resume({ isTrusted: false })).toBe(false);
    expect(play.resume).not.toHaveBeenCalled();
    expect(ledger.state.open).toBe(true);
    const click = { isTrusted: true };
    expect(ledger.resume(click)).toBe(true);
    expect(play.resume).toHaveBeenCalledWith(click);
    expect(ledger.state.open).toBe(false);
  });

  it('peels Escape a layer at a time: a listening key plate first, then the ledger', () => {
    const { play, settings } = fakePlay();
    const ledger = createLedger(play);
    expect(ledger.escape()).toBe(false);
    ledger.open('settings');
    ledger.beginCapture('jump');
    expect(ledger.state.capture).toBe('jump');
    expect(ledger.escape()).toBe(true);
    expect(ledger.state).toMatchObject({ open: true, capture: null });
    expect(settings.current.keys.jump).toBe('Space');
    expect(ledger.escape()).toBe(true);
    expect(ledger.state.open).toBe(false);
    expect(ledger.escape()).toBe(false);
  });

  it('cancels a capture with the Escape key itself, keeping the old key', () => {
    const { play, settings } = fakePlay();
    const ledger = createLedger(play);
    ledger.open('settings');
    ledger.beginCapture('use');
    expect(ledger.pressKey('Escape')).toBe('cancelled');
    expect(ledger.state.capture).toBeNull();
    expect(settings.current.keys.use).toBe('KeyE');
    expect(ledger.state.open).toBe(true);
  });
});

describe('the card and the map', () => {
  it('shows your card to a signed-in walker and the map only where the walk lends one, never as a stand-in', () => {
    const { play } = fakePlay();
    const withMap = { ...play, map: () => null };
    const ledger = createLedger(withMap);
    cleanups.push(() => ledger.dispose());
    ledger.open('map');
    expect(ledger.state.tabs.map(tab => tab.id)).toEqual(['settings', 'card', 'way-home', 'map', 'build', 'help']);
    expect(ledger.state.page).toBe('map');
    const visitor = createLedger({ ...play, ctx: { ...play.ctx, self: null } });
    cleanups.push(() => visitor.dispose());
    visitor.open('card');
    expect(visitor.state.tabs.map(tab => tab.id)).toEqual(['settings', 'way-home', 'build', 'help']);
    expect(visitor.state.page).toBe('settings');
  });

  it('never lets another lane take the card or the map', () => {
    cleanups.push(registerLedgerPage(page('map', 1)), registerLedgerPage(page('card', 2)));
    const { play } = fakePlay();
    const ledger = createLedger({ ...play, map: () => null });
    cleanups.push(() => ledger.dispose());
    ledger.open();
    expect(ledger.state.tabs.filter(tab => tab.id === 'map' || tab.id === 'card').every(tab => tab.provider === null)).toBe(true);
  });
});

describe('keyboard roaming between tabs', () => {
  it('moves with the arrows (wrapping), Home and End, and ignores other keys', () => {
    const { play } = fakePlay();
    const ledger = createLedger(play);
    ledger.open();
    expect(ledger.step('settings', 'ArrowDown')).toBe('card');
    expect(ledger.step('settings', 'ArrowRight')).toBe('card');
    expect(ledger.step('settings', 'ArrowUp')).toBe('help');
    expect(ledger.step('help', 'ArrowDown')).toBe('settings');
    expect(ledger.step('build', 'Home')).toBe('settings');
    expect(ledger.step('build', 'End')).toBe('help');
    expect(ledger.step('build', 'KeyW')).toBeNull();
  });

  it('turns the page forward or back with the parchment sound', () => {
    const { play, cues } = fakePlay();
    const ledger = createLedger(play);
    ledger.open();
    cues.length = 0;
    ledger.select('help');
    expect(ledger.state.turn).toEqual({ dir: 1, n: 1 });
    ledger.select('way-home');
    expect(ledger.state.turn).toEqual({ dir: -1, n: 2 });
    ledger.select('way-home');
    ledger.select('no-such-page');
    expect(ledger.state.page).toBe('way-home');
    expect(cues).toEqual(['parchment', 'parchment']);
  });
});

describe('settings written from the ledger', () => {
  it('apply through the store, persist on the device, and sound once per change', () => {
    const storage = memory();
    const { play, cues, settings } = fakePlay({ storage });
    const ledger = createLedger(play);
    const heard = vi.fn();
    settings.subscribe(heard);
    ledger.open();
    cues.length = 0;
    ledger.change({ view: 'first' }, 'wood');
    ledger.change({ fov: 82 }, 'brass');
    ledger.change({ invertY: true }, 'brass');
    ledger.change({ volume: { voice: .35 } }, 'brass');
    ledger.change({ labels: 'few', bubbles: 'nearby' }, 'wood');
    ledger.change({ view: 'first' }, 'wood');
    expect(settings.current).toMatchObject({ view: 'first', fov: 82, invertY: true, labels: 'few', bubbles: 'nearby' });
    expect(settings.current.volume.voice).toBe(.35);
    expect(heard).toHaveBeenCalledTimes(5);
    expect(cues[0]).toBe('wood');
    expect(cues.filter(cue => cue === 'wood')).toHaveLength(2);
    const again = createPlaySettings(storage);
    expect(again.current).toMatchObject({ view: 'first', fov: 82, invertY: true, labels: 'few', bubbles: 'nearby' });
    expect(JSON.parse(storage.data.get(PLAY_SETTINGS_KEY)!).volume.voice).toBe(.35);
  });

  it('ticks a dragged slider like a ratchet, not on every stop', () => {
    const { play, cues } = fakePlay();
    const ledger = createLedger(play);
    ledger.open();
    cues.length = 0;
    for (let fov = 56; fov <= 70; fov++) ledger.change({ fov }, 'brass');
    expect(cues.length).toBeGreaterThanOrEqual(1);
    expect(cues.length).toBeLessThan(15);
    expect(play.settings.current.fov).toBe(70);
  });

  it('rebinds a key from its plate, swapping with the action that held it, and restores the usual keys', () => {
    const storage = memory();
    const { play, settings } = fakePlay({ storage });
    const ledger = createLedger(play);
    ledger.open('settings');
    ledger.beginCapture('jump');
    expect(ledger.pressKey('KeyJ')).toEqual({ kind: 'bound', target: 'jump', code: 'KeyJ' });
    expect(settings.current.keys.jump).toBe('KeyJ');
    ledger.beginCapture('sprint');
    expect(ledger.pressKey('KeyJ')).toEqual({ kind: 'bound', target: 'sprint', code: 'KeyJ', moved: 'jump' });
    expect(settings.current.keys).toMatchObject({ sprint: 'KeyJ', jump: 'ShiftLeft' });
    expect(createPlaySettings(storage).current.keys.sprint).toBe('KeyJ');
    ledger.restoreKeys();
    expect(settings.current.keys).toMatchObject({ sprint: 'ShiftLeft', jump: 'Space' });
  });

  it('keeps listening when a key belongs to the browser or the ledger', () => {
    const { play, settings } = fakePlay();
    const ledger = createLedger(play);
    ledger.open('settings');
    ledger.beginCapture('use');
    expect(ledger.pressKey('Tab')).toEqual({ kind: 'reserved', target: 'use', code: 'Tab' });
    expect(ledger.pressKey('ControlLeft')).toMatchObject({ kind: 'reserved' });
    expect(ledger.state.capture).toBe('use');
    expect(ledger.pressKey('KeyR')).toMatchObject({ kind: 'bound', code: 'KeyR' });
    expect(settings.current.keys.use).toBe('KeyR');
  });

  it('rebinds another lane\'s key, refuses one of play\'s own, and leaves a displaced binding needing a key', () => {
    cleanups.push(registerActionBinding({ id: 'bag', label: 'Open your bag', defaultCode: 'KeyB', onPress() {} }));
    cleanups.push(registerActionBinding({ id: 'chart', label: 'Unroll the chart', defaultCode: 'KeyN', onPress() {} }));
    const { play, settings } = fakePlay();
    const ledger = createLedger(play);
    ledger.open('settings');
    ledger.beginCapture(bindingTarget('bag'));
    expect(ledger.pressKey('KeyW')).toEqual({ kind: 'taken', target: 'binding:bag', code: 'KeyW', holder: 'forward' });
    expect(ledger.state.capture).toBe('binding:bag');
    expect(ledger.pressKey('KeyN')).toEqual({ kind: 'bound', target: 'binding:bag', code: 'KeyN', moved: 'binding:chart' });
    expect(settings.current.actionKeys).toMatchObject({ bag: 'KeyN', chart: '' });
    // A play action taking a binding's key leaves that binding without one.
    ledger.beginCapture('use');
    expect(ledger.pressKey('KeyN')).toEqual({ kind: 'bound', target: 'use', code: 'KeyN', moved: 'binding:bag' });
    ledger.restoreKeys();
    expect(settings.current.actionKeys).toEqual({});
    ledger.beginCapture(bindingTarget('nobody'));
    expect(ledger.state.capture).toBeNull();
  });
});
