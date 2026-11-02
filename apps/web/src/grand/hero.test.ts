import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKingdomScene } from '../kingdom/scene';
import { createRealmSpectatorSource } from '../kingdom-entry/spectator';
import { createDockConnection } from '../stream/dock-connection';
import { mountLandHero, type LandHeroOptions } from './hero';

vi.mock('../kingdom/scene', () => ({ createKingdomScene: vi.fn() }));
vi.mock('../kingdom-entry/spectator', () => ({ createRealmSpectatorSource: vi.fn() }));
vi.mock('../stream/dock-connection', () => ({ createDockConnection: vi.fn() }));

const id = '129634568';
const feed = () => ({ marker: Symbol() });
type ChatReceive = (message: { type: string; cue?: unknown; cueIds?: readonly string[] }) => void;

function connection() {
  let receive: ChatReceive | undefined;
  const offChat = vi.fn();
  return {
    manifest: { origin: 'live', kingdomId: id },
    scene: { origin: 'live', kingdomId: id, plan: { config: { tier: 'town', seed: 'founded-seed', firstYear: 2020, year: 2026 } } },
    kingdomName: 'Willowmere', presenceFeed: feed(), growthFeed: feed(), growthCeremonies: feed(), forgeFeed: feed(),
    momentFeed: feed(), walkerFeed: feed(), activate: vi.fn(), dispose: vi.fn(), offChat,
    chatFeed: { subscribe: vi.fn((next: ChatReceive) => { receive = next; return offChat; }) },
    say: (message: Parameters<ChatReceive>[0]) => receive?.(message),
  };
}
let live: ReturnType<typeof connection>;

function fakeScene() {
  const resume = vi.fn();
  const fake = { debug: { ready: false }, drawnAt: 0, resume,
    inspect: vi.fn(() => ({ renderCompletedAt: fake.drawnAt })),
    overview: { orbit: vi.fn() }, setQuality: vi.fn(), activateDock: vi.fn(), suspendRendering: vi.fn(() => resume),
    receiveChat: vi.fn(), clearChat: vi.fn(), dispose: vi.fn() };
  return fake;
}
let scene: ReturnType<typeof fakeScene>;
let sceneOptions: Parameters<typeof createKingdomScene>[1] | undefined;
let watchArgs: { signal: AbortSignal; revision: () => void; lost: () => void } | undefined;
let watch: ReturnType<typeof vi.fn>;
let dock: { dispose: ReturnType<typeof vi.fn> };
let frames: Map<number, FrameRequestCallback>;
let clock: number;
let lose: ReturnType<typeof vi.fn>;
let canvas: HTMLCanvasElement & { listeners: Map<string, EventListener> };

function fakeCanvas() {
  const listeners = new Map<string, EventListener>();
  lose = vi.fn();
  return { listeners,
    addEventListener: vi.fn((type: string, listener: EventListener) => { listeners.set(type, listener); }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => { if (listeners.get(type) === listener) listeners.delete(type); }),
    getContext: vi.fn(() => ({ getExtension: () => ({ loseContext: lose }) })),
  } as unknown as HTMLCanvasElement & { listeners: Map<string, EventListener> };
}
/** Runs one animation frame: the scene draws at `clock` (when it is ready), then queued callbacks run. */
function tick(draw = true) {
  clock += 16;
  if (draw && scene.debug.ready) scene.drawnAt = clock;
  const now = [...frames.values()]; frames.clear();
  for (const callback of now) callback(clock);
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
const options = (overrides: Partial<LandHeroOptions> = {}): LandHeroOptions =>
  ({ channel: 'tobi4s_', hour: 18.2, time: 42, yaw: 120, tier: 'medium', onFailure: vi.fn(), ...overrides });
async function opened(overrides: Partial<LandHeroOptions> = {}) {
  const config = options(overrides), hero = await mountLandHero(canvas, config);
  await flush();
  return { hero, config };
}

beforeEach(() => {
  frames = new Map(); clock = 1000; live = connection(); scene = fakeScene(); sceneOptions = undefined; watchArgs = undefined;
  dock = { dispose: vi.fn() }; canvas = fakeCanvas();
  let next = 0;
  vi.stubGlobal('window', {});
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in this test'); }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.delete(handle); });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  watch = vi.fn((signal: AbortSignal, revision: () => void, lost: () => void) => { watchArgs = { signal, revision, lost }; return Promise.resolve(live); });
  vi.mocked(createRealmSpectatorSource).mockReturnValue(watch as unknown as ReturnType<typeof createRealmSpectatorSource>);
  vi.mocked(createDockConnection).mockReturnValue(dock as unknown as ReturnType<typeof createDockConnection>);
  vi.mocked(createKingdomScene).mockImplementation(async (_canvas, settings) => {
    sceneOptions = settings; return scene as unknown as Awaited<ReturnType<typeof createKingdomScene>>;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('mountLandHero', () => {
  it.each(['unknown_streamer', '123', '', 'tobi4s_x'])('rejects the unadopted channel %j without touching the network', async channel => {
    const config = options({ channel });
    await expect(mountLandHero(canvas, config)).rejects.toThrow(/has no adopted grand land|needs a channel/);
    expect(createRealmSpectatorSource).not.toHaveBeenCalled();
    expect(createDockConnection).not.toHaveBeenCalled();
    expect(createKingdomScene).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(canvas.addEventListener).not.toHaveBeenCalled();
    expect(config.onFailure).not.toHaveBeenCalled();
  });

  it.each([{ hour: 25 }, { hour: NaN }, { time: -1 }, { yaw: Infinity }, { tier: 'ultra' as LandHeroOptions['tier'] }])('rejects invalid options %j', async overrides => {
    await expect(mountLandHero(canvas, options(overrides))).rejects.toThrow(RangeError);
    expect(createRealmSpectatorSource).not.toHaveBeenCalled();
  });

  it('raises the adopted kingdom read-only with the explicit hour, held first-frame time, yaw and quality', async () => {
    const { hero } = await opened({ channel: 'TOBI4S_' });
    expect(createRealmSpectatorSource).toHaveBeenCalledWith({ kingdomId: id });
    expect(createDockConnection).toHaveBeenCalledWith(id, { readOnly: true });
    expect(live.activate).toHaveBeenCalledOnce();
    expect(vi.mocked(createKingdomScene).mock.calls[0]![0]).toBe(canvas);
    expect(sceneOptions).toMatchObject({ mode: 'watching', overview: true, source: 'herald', directArrivals: false,
      hour: 18.2, time: 42, founded: live.scene, foundedReceipt: live.manifest, kingdomId: id, realmName: 'Willowmere',
      tier: 'town', seed: 'founded-seed', firstYear: 2020, year: 2026, presenceOrigin: 'live', presenceFeed: live.presenceFeed,
      growthFeed: live.growthFeed, growthCeremonies: live.growthCeremonies, forgeFeed: live.forgeFeed,
      momentFeed: live.momentFeed, walkerFeed: live.walkerFeed, dockFeed: dock });
    expect(scene.setQuality).toHaveBeenCalledWith('balanced');
    expect(scene.overview.orbit).toHaveBeenCalledWith(120 * Math.PI / 180, null, null);
    expect(scene.activateDock).toHaveBeenCalledOnce();
    hero.setYaw(90);
    expect(scene.overview.orbit).toHaveBeenLastCalledWith(Math.PI / 2, null, null);
    expect(() => hero.setYaw(NaN)).toThrow(RangeError);
    // The canvas takes no input: every input event stops before the scene's own listeners.
    const event = { stopImmediatePropagation: vi.fn() } as unknown as Event;
    for (const type of ['pointerdown', 'wheel', 'click', 'contextmenu', 'keydown']) canvas.listeners.get(type)!(event);
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(5);
    live.say({ type: 'chat', cue: { id: 'cue' } }); expect(scene.receiveChat).toHaveBeenCalledWith({ id: 'cue' });
    live.say({ type: 'chat.remove', cueIds: ['cue'] }); expect(scene.clearChat).toHaveBeenCalledWith(['cue']);
    hero.dispose();
  });

  it.each([['high', 'high'], ['medium', 'balanced'], ['low', 'low'], ['software', 'low']] as const)('maps tier %s to scene quality %s', async (tier, quality) => {
    const { hero } = await opened({ tier });
    expect(scene.setQuality).toHaveBeenCalledWith(quality);
    hero.dispose();
  });

  it('settles on the first loaded frame, then on the first frame drawn after a turn', async () => {
    const { hero } = await opened();
    let first = false;
    void hero.settled().then(() => { first = true; });
    tick(); await flush();
    expect(first).toBe(false); // Not ready yet: the scene has drawn nothing loaded.
    scene.debug.ready = true;
    tick(); await flush();
    expect(first).toBe(true);
    hero.setYaw(150);
    let turned = false;
    void hero.settled().then(() => { turned = true; });
    tick(false); await flush();
    expect(turned).toBe(false); // No frame was drawn since the turn.
    tick(); await flush();
    expect(turned).toBe(true);
    expect(frames.size).toBe(0); // Nobody waits, so nothing polls.
    hero.dispose();
  });

  it('settles a waiter that asked before the scene existed', async () => {
    let release!: () => void;
    watch.mockImplementation((signal: AbortSignal, revision: () => void, lost: () => void) => {
      watchArgs = { signal, revision, lost };
      return new Promise(resolve => { release = () => resolve(live); });
    });
    const hero = await mountLandHero(canvas, options());
    let done = false;
    void hero.settled().then(() => { done = true; });
    release(); await flush();
    scene.debug.ready = true;
    tick(); await flush();
    expect(done).toBe(true);
    hero.dispose();
  });

  it.each([
    ['the watch cannot be reached', () => watch.mockRejectedValue(new Error('The kingdom’s public watch is unavailable.')), 'The kingdom’s public watch is unavailable.'],
    ['the kingdom cannot be confirmed', () => { live.scene.origin = 'simulated'; }, 'The adopted kingdom could not be confirmed'],
    ['the scene cannot open', () => vi.mocked(createKingdomScene).mockRejectedValue(new Error('A kingdom shader could not compile')), 'A kingdom shader could not compile'],
    ['the grand land has no overview', () => { (scene as { overview?: unknown }).overview = undefined; }, 'The kingdom’s grand land did not open'],
  ])('fails once and rejects settled when %s', async (_name, arrange, message) => {
    arrange();
    const config = options(), hero = await mountLandHero(canvas, config);
    const pending = hero.settled();
    pending.catch(() => {});
    await flush();
    await expect(pending).rejects.toThrow(message);
    await expect(hero.settled()).rejects.toThrow(message);
    expect(config.onFailure).toHaveBeenCalledOnce();
    expect(config.onFailure).toHaveBeenCalledWith(message);
    expect((watch.mock.calls[0]![0] as AbortSignal).aborted).toBe(true);
    expect(dock.dispose).toHaveBeenCalledOnce();
    expect(canvas.listeners.size).toBe(0);
    hero.dispose();
    expect(config.onFailure).toHaveBeenCalledOnce();
  });

  it('fails once when the open scene reports a render error and the watch is then lost', async () => {
    const { hero, config } = await opened();
    sceneOptions!.onError('The kingdom lost its rendering context');
    watchArgs!.lost();
    expect(config.onFailure).toHaveBeenCalledOnce();
    expect(config.onFailure).toHaveBeenCalledWith('The kingdom lost its rendering context');
    expect(scene.dispose).toHaveBeenCalled();
    expect(live.dispose).toHaveBeenCalled();
    expect(live.offChat).toHaveBeenCalledOnce();
    expect(lose).toHaveBeenCalledOnce();
    await expect(hero.settled()).rejects.toThrow('rendering context');
    hero.setYaw(10); hero.pause(); hero.resume();
    expect(scene.suspendRendering).not.toHaveBeenCalled();
  });

  it('keeps the confirmed scene drawing through a kingdom revision', async () => {
    const { hero, config } = await opened();
    watchArgs!.revision();
    expect(config.onFailure).not.toHaveBeenCalled();
    expect(scene.dispose).not.toHaveBeenCalled();
    expect(createKingdomScene).toHaveBeenCalledOnce();
    hero.dispose();
  });

  it('pauses by stopping the render loop and resumes drawing', async () => {
    const { hero } = await opened();
    scene.debug.ready = true;
    hero.pause(); hero.pause();
    expect(scene.suspendRendering).toHaveBeenCalledOnce();
    let done = false;
    void hero.settled().then(() => { done = true; });
    expect(frames.size).toBe(0); // Paused: nothing polls and nothing is drawn.
    hero.resume(); hero.resume();
    expect(scene.resume).toHaveBeenCalledOnce();
    tick(); await flush();
    expect(done).toBe(true);
    hero.dispose();
  });

  it('holds a pause taken while the kingdom is still raising', async () => {
    let release!: () => void;
    watch.mockImplementation(() => new Promise(resolve => { release = () => resolve(live); }));
    const hero = await mountLandHero(canvas, options());
    hero.pause();
    release(); await flush();
    expect(scene.suspendRendering).toHaveBeenCalledOnce();
    hero.resume();
    expect(scene.resume).toHaveBeenCalledOnce();
    hero.dispose();
  });

  it('disposes idempotently, aborts pending settles and leaves window globals untouched', async () => {
    const debug = window as Window & { __chatdomReady?: boolean; __chatdomGrand?: unknown };
    const { hero, config } = await opened();
    expect(debug.__chatdomReady).toBeUndefined();
    const pending = hero.settled();
    hero.dispose(); hero.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(hero.settled()).rejects.toMatchObject({ name: 'AbortError' });
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(live.dispose).toHaveBeenCalledOnce();
    expect(live.offChat).toHaveBeenCalledOnce();
    expect(dock.dispose).toHaveBeenCalledOnce();
    expect(watchArgs?.signal.aborted).toBe(true);
    expect(lose).toHaveBeenCalledOnce();
    expect(canvas.listeners.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(config.onFailure).not.toHaveBeenCalled();
    expect(Object.keys(debug)).toEqual([]);
    hero.setYaw(30); hero.pause(); hero.resume();
    expect(scene.overview.orbit).toHaveBeenCalledOnce();
  });

  it('disposes a scene that arrives after the hero was let go, without failing', async () => {
    let release!: () => void;
    vi.mocked(createKingdomScene).mockImplementation(() => new Promise(resolve => {
      release = () => resolve(scene as unknown as Awaited<ReturnType<typeof createKingdomScene>>);
    }));
    const config = options(), hero = await mountLandHero(canvas, config);
    await flush();
    hero.dispose();
    release(); await flush();
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(scene.setQuality).not.toHaveBeenCalled();
    expect(config.onFailure).not.toHaveBeenCalled();
  });
});
