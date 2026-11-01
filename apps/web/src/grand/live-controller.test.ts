import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSceneMount } from '../stream/mount';
import { createRealmSpectatorSource } from '../kingdom-entry/spectator';
import { createDockConnection } from '../stream/dock-connection';
import { createGrandLiveController, type GrandLiveState } from './live-controller';

vi.mock('../stream/mount', () => ({ createSceneMount: vi.fn() }));
vi.mock('../kingdom-entry/spectator', () => ({ createRealmSpectatorSource: vi.fn() }));
vi.mock('../stream/dock-connection', () => ({ createDockConnection: vi.fn() }));

const id = '129634568';
const feed = () => ({ marker: Symbol() });
function connection() {
  return { manifest: { origin: 'live', kingdomId: id }, scene: { origin: 'live', kingdomId: id,
    plan: { config: { tier: 'town', seed: 'founded-seed', firstYear: 2020, year: 2026 } } }, kingdomName: 'Willowmere',
    presenceFeed: feed(), growthFeed: feed(), growthCeremonies: feed(), forgeFeed: feed(), momentFeed: feed(),
    walkerFeed: feed(), chatFeed: feed(), activate: vi.fn(), dispose: vi.fn() };
}

type Hooks = Parameters<typeof createSceneMount>[0];
let hooks: Hooks;
let states: GrandLiveState[];
let watch: ReturnType<typeof vi.fn>;
let mount: { mount: ReturnType<typeof vi.fn>; unmount: ReturnType<typeof vi.fn>; scene: undefined };
let dock: { dispose: ReturnType<typeof vi.fn> };
let doc: EventTarget & { hidden: boolean };

function setup(query = '') {
  vi.stubGlobal('location', { search: query });
  const controller = createGrandLiveController({ host: () => ({} as HTMLElement), onState: state => states.push(state) });
  controller.start();
  return controller;
}
function prepare(signal = new AbortController().signal) {
  return hooks.prepare!(signal, vi.fn(), vi.fn());
}

beforeEach(() => {
  states = []; watch = vi.fn(); dock = { dispose: vi.fn() };
  doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', doc); vi.stubGlobal('window', {});
  mount = { mount: vi.fn(), unmount: vi.fn(), scene: undefined };
  vi.mocked(createSceneMount).mockImplementation(options => { hooks = options; return mount as unknown as ReturnType<typeof createSceneMount>; });
  vi.mocked(createRealmSpectatorSource).mockReturnValue(watch as ReturnType<typeof createRealmSpectatorSource>);
  vi.mocked(createDockConnection).mockReturnValue(dock as unknown as ReturnType<typeof createDockConnection>);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('grand live controller', () => {
  it.each(['?channel=unknown', '?channel=tobi4s_&kingdom=123'])('refuses unadopted identity %s without connecting or mounting', query => {
    const controller = setup(query);
    expect(states.at(-1)?.phase).toBe('unavailable');
    expect(states.at(-1)?.canRetry).toBe(false);
    expect(createRealmSpectatorSource).not.toHaveBeenCalled();
    expect(createDockConnection).not.toHaveBeenCalled();
    expect(mount.mount).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('binds the exact verified founded scene and live feeds, without local seed overrides', async () => {
    const live = connection(); watch.mockResolvedValue(live);
    const controller = setup('?seed=other&source=simulated&bench=1');
    expect(createRealmSpectatorSource).toHaveBeenCalledWith({ kingdomId: id });
    expect(createDockConnection).toHaveBeenCalledWith(id, { readOnly: true });
    expect(mount.mount).toHaveBeenCalledOnce();
    const prepared = await prepare();
    expect(prepared.settings).toMatchObject({ founded: live.scene, kingdomId: id, realmName: 'Willowmere', tier: 'town',
      seed: 'founded-seed', firstYear: 2020, year: 2026, presenceOrigin: 'live', presenceFeed: live.presenceFeed,
      growthFeed: live.growthFeed, growthCeremonies: live.growthCeremonies, forgeFeed: live.forgeFeed,
      momentFeed: live.momentFeed, walkerFeed: live.walkerFeed, dockFeed: dock });
    expect(prepared.chatFeed).toBe(live.chatFeed);
    expect(live.activate).not.toHaveBeenCalled();
    prepared.activate?.();
    expect(live.activate).toHaveBeenCalledOnce();
    expect(states.at(-1)).toMatchObject({ title: 'Willowmere', biome: 'woodland' });
    controller.dispose();
  });

  it.each(['manifest-origin', 'scene-origin', 'manifest-id', 'scene-id'])('disposes and rejects a mismatched %s', async kind => {
    const live = connection();
    if (kind === 'manifest-origin') live.manifest.origin = 'simulated';
    if (kind === 'scene-origin') live.scene.origin = 'simulated';
    if (kind === 'manifest-id') live.manifest.kingdomId = '123';
    if (kind === 'scene-id') live.scene.kingdomId = '123';
    watch.mockResolvedValue(live);
    const controller = setup();
    await expect(prepare()).rejects.toThrow('could not be confirmed');
    expect(live.dispose).toHaveBeenCalledOnce();
    expect(live.activate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('disposes a late connection after cancellation', async () => {
    const live = connection(); let resolve!: (value: typeof live) => void;
    watch.mockReturnValue(new Promise<typeof live>(done => { resolve = done; }));
    const controller = setup(), abort = new AbortController(), pending = prepare(abort.signal);
    abort.abort(); resolve(live);
    await expect(pending).rejects.toThrow('could not be confirmed');
    expect(live.dispose).toHaveBeenCalledOnce(); expect(live.activate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('reports readiness only on mount ready and clears it on failure, hide, and disposal', () => {
    const controller = setup();
    const debug = window as Window & { __chatdomReady?: boolean; __chatdomGrand?: unknown };
    expect(debug.__chatdomReady).toBe(false);
    hooks.onProgress('loading', 0.5); expect(debug.__chatdomReady).toBe(false);
    hooks.onPhase('ready'); expect(debug.__chatdomReady).toBe(true); expect(states.at(-1)?.phase).toBe('ready');
    hooks.onPhase('failed'); expect(debug.__chatdomReady).toBe(false); expect(states.at(-1)?.phase).toBe('unavailable');
    hooks.onPhase('ready'); hooks.onPhase('hidden'); expect(debug.__chatdomReady).toBe(false);
    hooks.onPhase('ready'); controller.dispose();
    expect(debug.__chatdomReady).toBe(false); expect(debug.__chatdomGrand).toBeUndefined();
    expect(dock.dispose).toHaveBeenCalledOnce();
    const count = mount.mount.mock.calls.length; doc.dispatchEvent(new Event('visibilitychange'));
    expect(mount.mount).toHaveBeenCalledTimes(count);
    controller.dispose(); expect(dock.dispose).toHaveBeenCalledOnce();
  });

  it('bounds hour controls and mounts only while visible', () => {
    const controller = setup();
    controller.setHour(24); expect(states.at(-1)?.hour).toBe(24);
    for (const value of [-1, 25, NaN, Infinity]) controller.setHour(value);
    expect(states.at(-1)?.hour).toBe(24);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    expect(mount.unmount).toHaveBeenCalledWith('hidden');
    doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
    expect(mount.mount).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
