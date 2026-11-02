import { describe, expect, it, vi } from 'vitest';
import { createPlaySettings, DEFAULT_PLAY_SETTINGS, normalisePlaySettings, PLAY_SETTINGS_KEY } from './settings';

function memory(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[PLAY_SETTINGS_KEY, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe('play settings', () => {
  it('persist per device and come back on the next visit', () => {
    const storage = memory();
    const first = createPlaySettings(storage);
    first.set({ sensitivity: 1.6, invertY: true, fov: 82, view: 'first', volume: { world: .3 }, bubbles: 'few' });
    const second = createPlaySettings(storage);
    expect(second.current).toMatchObject({ sensitivity: 1.6, invertY: true, fov: 82, view: 'first', bubbles: 'few' });
    expect(second.current.volume).toEqual({ ...DEFAULT_PLAY_SETTINGS.volume, world: .3 });
  });

  it('apply live: every listener hears a change at once, and only a real change', () => {
    const settings = createPlaySettings(memory());
    const heard = vi.fn();
    settings.subscribe(heard);
    settings.set({ sensitivity: 2 });
    settings.set({ sensitivity: 2 });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0]![0].sensitivity).toBe(2);
    expect(settings.get('sensitivity')).toBe(2);
  });

  it('clamp anything stored or asked for, and survive a broken or foreign record', () => {
    expect(normalisePlaySettings({ sensitivity: 99, fov: 10, view: 'top', volume: { master: -1, voice: 7 }, labels: 'none', keys: { forward: 'Escape' } }))
      .toMatchObject({ sensitivity: 4, fov: 55, view: 'third', volume: { master: 0, voice: 1 }, labels: 'all', keys: { forward: 'KeyW' } });
    expect(createPlaySettings(memory('{not json')).current).toEqual(DEFAULT_PLAY_SETTINGS);
    const throwing = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('full'); } };
    const settings = createPlaySettings(throwing);
    expect(settings.set({ fov: 60 }).fov).toBe(60);
  });

  it('bind keys by swapping with whatever held the key, and never bind reserved keys', () => {
    const settings = createPlaySettings(memory());
    expect(settings.bind('jump', 'KeyW')).toBe(true);
    expect(settings.get('keys')).toMatchObject({ jump: 'KeyW', forward: 'Space' });
    expect(settings.bind('ledger', 'Escape')).toBe(false);
    expect(settings.bind('view', 'ControlLeft')).toBe(false);
    const codes = Object.values(settings.get('keys')).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
    settings.reset();
    expect(settings.get('keys')).toEqual(DEFAULT_PLAY_SETTINGS.keys);
  });
});

describe('keys other lanes add', () => {
  it('answer to their default until the person picks one, and play keys always win', async () => {
    const { actionCode } = await import('./settings');
    const store = createPlaySettings(null);
    const bag = { id: 'bag', defaultCode: 'KeyB' }, slot = { id: 'hotbar.1', defaultCode: 'Digit1' }, clash = { id: 'map', defaultCode: 'KeyW' };
    expect([actionCode(store.current, bag), actionCode(store.current, clash)]).toEqual(['KeyB', '']);
    expect(store.bindAction('bag', 'KeyW')).toBe(false);
    expect(store.bindAction('hotbar.1', 'KeyB', { bag: 'KeyB', 'hotbar.1': 'Digit1' })).toBe(true);
    expect([actionCode(store.current, bag), actionCode(store.current, slot)]).toEqual(['', 'KeyB']);
    const reloaded = createPlaySettings({ getItem: () => JSON.stringify(store.current), setItem() {} });
    expect(reloaded.current.actionKeys).toEqual({ bag: '', 'hotbar.1': 'KeyB' });
  });
});
