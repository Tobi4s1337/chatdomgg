import { afterEach, expect, it, vi } from 'vitest';
import type { SceneOptions, SceneView } from '../kingdom/scene';
import type { RealmChatMessage } from '../realm/adapters/chat';
import { createSceneMount, StreamRefusal, type KingdomScene, type PreparedStreamScene } from './mount';

const { createScene } = vi.hoisted(() => ({ createScene: vi.fn() }));
vi.mock('../kingdom/scene', () => ({ createKingdomScene: createScene }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

function harness() {
  vi.useFakeTimers();
  const canvases: HTMLCanvasElement[] = [], frames = new Map<number, FrameRequestCallback>();
  let frame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const loseContext = vi.fn();
  vi.stubGlobal('document', { createElement: () => {
    const canvas = {
      className: '', style: { visibility: '' }, setAttribute: vi.fn(),
      getContext: () => ({ getExtension: () => ({ loseContext }) }),
      remove: () => { const index = canvases.indexOf(canvas as unknown as HTMLCanvasElement); if (index >= 0) canvases.splice(index, 1); },
    };
    return canvas;
  } });
  const revisions: (() => void)[] = [], signals: AbortSignal[] = [], preparations: PreparedStreamScene[] = [];
  const scenes: KingdomScene[] = [], options: SceneOptions[] = [];
  const chatReceivers: ((message: RealmChatMessage) => void)[] = [], chatOffs: ReturnType<typeof vi.fn>[] = [];
  const prepare = vi.fn(async (signal: AbortSignal, revision: () => void) => {
    signals.push(signal); revisions.push(revision);
    const index = preparations.length, off = vi.fn(); chatOffs.push(off);
    const prepared: PreparedStreamScene = { settings: {}, dispose: vi.fn(), activate: vi.fn(),
      chatFeed: { subscribe: receive => { chatReceivers[index] = receive; return off; } } };
    preparations.push(prepared);
    return prepared;
  });
  createScene.mockImplementation(async (_canvas: HTMLCanvasElement, settings: SceneOptions) => {
    options.push(settings);
    const scene = {
      debug: { ready: false, camera: 'window', hour: 21.25, time: 17 },
      dispose: vi.fn(), momentDirecting: () => false, receiveChat: vi.fn(), clearChat: vi.fn(),
      captureCitizens: vi.fn(() => undefined), restoreCitizens: vi.fn(),
      captureView: vi.fn(() => ({ eye: [12, 30, 41], target: [1, 2, 3], fov: 43 })),
      handoffView: vi.fn(async () => undefined), suspendRendering: vi.fn(() => vi.fn()),
    } as unknown as KingdomScene;
    scenes.push(scene);
    return scene;
  });
  const hooks = {
    host: () => ({ append: (canvas: HTMLCanvasElement) => canvases.push(canvas) }) as unknown as HTMLElement,
    settings: (): ReturnType<Parameters<typeof createSceneMount>[0]['settings']> => ({ tier: 'hamlet', seed: 'stream', camera: 'hero', hour: 19.5, time: null, source: 'herald' }),
    prepare,
    onPhase: vi.fn(), onProgress: vi.fn(), onSource: vi.fn(), onNames: vi.fn(), onSpeech: vi.fn(), onScene: vi.fn(), onDirecting: vi.fn(),
  };
  const mount = createSceneMount(hooks);
  const draw = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); };
  const ready = async () => { mount.mount(); await settle(); scenes[0]!.debug.ready = true; draw(); };
  return { mount, hooks, canvases, scenes, options, revisions, signals, preparations, prepare, draw, ready, loseContext, chatReceivers, chatOffs };
}

it('keeps the loaded canvas and its labels live until a hidden replacement draws, then swaps and disposes once', async () => {
  const h = harness();
  await h.ready();
  const old = h.scenes[0]!, oldCanvas = h.canvases[0]!;
  h.options[0]!.onSource('LIVE CHAT');
  h.hooks.onPhase.mockClear(); h.hooks.onScene.mockClear(); h.hooks.onSource.mockClear();

  h.revisions[0]!();
  await settle();
  const next = h.scenes[1]!, nextCanvas = h.canvases[1]!;
  h.options[1]!.onSource('STREAM RESTING');
  h.options[1]!.onNames([{ slot: 9, name: 'Pending', x: 1, y: 2 }]);
  h.draw();
  expect(h.mount.scene).toBe(old);
  expect(old.debug.ready).toBe(true);
  expect(h.canvases).toEqual([oldCanvas, nextCanvas]);
  expect(oldCanvas.style.visibility).toBe('');
  expect(nextCanvas.style.visibility).toBe('hidden');
  expect(old.dispose).not.toHaveBeenCalled();
  expect(h.hooks.onPhase).not.toHaveBeenCalled();
  expect(h.hooks.onScene).not.toHaveBeenCalled();
  expect(h.hooks.onSource).not.toHaveBeenCalled();
  expect(h.mount.stats.alive).toBe(2);
  expect(h.preparations[0]!.activate).toHaveBeenCalledOnce();
  expect(h.preparations[1]!.activate).not.toHaveBeenCalled();
  expect(h.options[0]?.deferLandPresentation).toBe(false);
  expect(h.options[1]).toMatchObject({ initialView: old.captureView(), camera: 'window', hour: 21.25, time: null, deferLandPresentation: true });

  h.options[0]!.onSource('LIVE CHAT');
  expect(h.hooks.onSource).toHaveBeenLastCalledWith('LIVE CHAT');
  next.debug.ready = true; h.draw(); await settle();
  expect(h.mount.scene).toBe(next);
  expect(h.canvases).toEqual([nextCanvas]);
  expect(nextCanvas.style.visibility).toBe('');
  expect(old.dispose).toHaveBeenCalledOnce();
  expect(h.preparations[0]!.dispose).toHaveBeenCalledExactlyOnceWith('scene-revision');
  expect(next.handoffView).toHaveBeenCalledExactlyOnceWith(old.captureView());
  expect(h.preparations[1]!.activate).toHaveBeenCalledOnce();
  expect(vi.mocked(h.preparations[0]!.dispose).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(h.preparations[1]!.activate!).mock.invocationCallOrder[0]!);
  expect(h.signals[0]!.aborted).toBe(true);
  expect(h.hooks.onScene).toHaveBeenCalledExactlyOnceWith(next);
  expect(h.hooks.onSource).toHaveBeenLastCalledWith('STREAM RESTING');
  expect(h.hooks.onNames).toHaveBeenLastCalledWith([{ slot: 9, name: 'Pending', x: 1, y: 2 }]);
  expect(h.hooks.onPhase).not.toHaveBeenCalled();
  expect(h.mount.stats).toEqual({ mounts: 2, alive: 1, disposed: 1, cancelled: 0 });
  h.mount.unmount('hidden');
  expect(next.dispose).toHaveBeenCalledOnce();
  expect(h.mount.stats.alive).toBe(0);
});

it('supersedes warming revisions, bounds failed refreshes and releases hidden or late preparations without publishing them', async () => {
  const h = harness();
  await h.ready();
  h.revisions[0]!(); await settle();
  const superseded = h.scenes[1]!;
  // A newer revision from the visible watch cancels its own in-flight candidate.
  h.revisions[0]!(); await settle();
  expect(superseded.dispose).toHaveBeenCalledOnce();
  expect(h.signals[1]!.aborted).toBe(true);
  expect(h.preparations[1]!.dispose).toHaveBeenCalledExactlyOnceWith('scene-revision');
  superseded.debug.ready = true; h.draw();
  expect(h.mount.scene).toBe(h.scenes[0]);
  expect(h.mount.stats.alive).toBe(2);

  // A candidate's watch can also invalidate itself before its first loaded draw.
  h.revisions[2]!(); await settle();
  expect(h.scenes[2]!.dispose).toHaveBeenCalledOnce();
  expect(h.mount.stats.alive).toBe(2);
  vi.advanceTimersByTime(60_000);
  expect(h.mount.stats.alive).toBe(2); // Slow first draws keep their bounded candidate.
  vi.advanceTimersByTime(4 * 60_000);
  expect(h.hooks.onPhase).toHaveBeenLastCalledWith('failed');
  expect(h.mount.scene).toBe(h.scenes[0]);
  expect(h.scenes[0]!.dispose).not.toHaveBeenCalled();
  expect(h.scenes[3]!.dispose).toHaveBeenCalledOnce();
  expect(h.canvases).toHaveLength(1);

  // Existing StreamView retry calls mount(); hiding wins even if preparation
  // ignores abort and resolves after both owned canvases have been released.
  let resolve!: (prepared: PreparedStreamScene) => void;
  h.prepare.mockImplementationOnce(() => new Promise<PreparedStreamScene>(yes => { resolve = yes; }));
  h.mount.mount(); await settle();
  expect(h.mount.stats.alive).toBe(2);
  h.mount.unmount('hidden');
  const late: PreparedStreamScene = { settings: {}, dispose: vi.fn(), activate: vi.fn() };
  resolve(late); await settle();
  expect(late.dispose).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(h.scenes).toHaveLength(4);
  expect(h.canvases).toHaveLength(0);
  expect(h.mount.stats.alive).toBe(0);
  expect(h.loseContext).toHaveBeenCalledTimes(5);
  expect(h.hooks.onScene.mock.calls.filter(([scene]) => !!scene)).toEqual([[h.scenes[0]]]);
  expect(h.hooks.onPhase).toHaveBeenLastCalledWith('hidden');
});

it('preserves an explicitly watching host mode while stream remains the default', async () => {
  const h = harness(), original = h.hooks.settings;
  h.hooks.settings = () => ({ ...original(), mode: 'watching' });
  h.mount.mount(); await settle();
  expect(h.options[0]?.mode).toBe('watching');
  h.mount.unmount('hidden');
});


function finalDraw() {
  let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function heldHandoff() {
  const h = harness(); await h.ready();
  const old = h.scenes[0]!, oldCanvas = h.canvases[0]!, resume = vi.fn();
  vi.mocked(old.suspendRendering).mockReturnValue(resume);
  h.revisions[0]!(); await settle();
  const next = h.scenes[1]!, nextCanvas = h.canvases[1]!, draw = finalDraw();
  vi.mocked(next.handoffView).mockReturnValue(draw.promise);
  const lens: SceneView = { eye: [300, 40, 90], target: [8, 5, 2], fov: 58 };
  vi.mocked(old.captureView).mockClear().mockReturnValue(lens);
  h.hooks.onScene.mockClear(); h.hooks.onSource.mockClear();
  next.debug.ready = true; h.draw();
  return { h, old, oldCanvas, next, nextCanvas, resume, draw, lens };
}

it('holds the outgoing lens and feeds until the candidate has actually rendered that final lens', async () => {
  const { h, old, oldCanvas, next, nextCanvas, resume, draw, lens } = await heldHandoff();
  h.options[1]!.onSource('CANDIDATE');
  // The mount transfers this opaque checkpoint only; the citizen scene validates its contents.
  const latestCitizens = { revision: 'feed-during-handoff' } as ReturnType<KingdomScene['captureCitizens']>;
  let citizens: ReturnType<KingdomScene['captureCitizens']>;
  vi.mocked(old.captureCitizens).mockImplementation(() => citizens);
  vi.mocked(old.clearChat).mockImplementation(() => { citizens = latestCitizens; });
  h.draw(); h.draw(); await settle();
  expect(next.handoffView).toHaveBeenCalledExactlyOnceWith(lens);
  expect(old.suspendRendering).toHaveBeenCalledOnce(); expect(resume).not.toHaveBeenCalled();
  expect(vi.mocked(old.suspendRendering).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(old.captureView).mock.invocationCallOrder[0]!);
  expect(h.mount.scene).toBe(old); expect(h.canvases).toEqual([oldCanvas, nextCanvas]);
  expect(nextCanvas.style.visibility).toBe('hidden'); expect(old.dispose).not.toHaveBeenCalled();
  expect(h.preparations[0]!.dispose).not.toHaveBeenCalled(); expect(h.preparations[1]!.activate).not.toHaveBeenCalled();
  expect(h.chatOffs[0]).not.toHaveBeenCalled(); expect(h.hooks.onSource).not.toHaveBeenCalled();
  expect(old.captureCitizens).not.toHaveBeenCalled();
  h.chatReceivers[0]!({ type: 'chat.clear' }); expect(old.clearChat).toHaveBeenCalledOnce();
  h.chatReceivers[1]!({ type: 'chat.clear' }); expect(next.clearChat).not.toHaveBeenCalled();

  draw.resolve(); await settle();
  expect(h.mount.scene).toBe(next); expect(nextCanvas.style.visibility).toBe('');
  expect(old.captureCitizens).toHaveBeenCalledOnce(); expect(next.restoreCitizens).toHaveBeenCalledExactlyOnceWith(latestCitizens);
  expect(old.dispose).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce();
  expect(h.preparations[1]!.activate).toHaveBeenCalledOnce(); expect(h.chatOffs[0]).toHaveBeenCalledOnce();
  expect(h.hooks.onScene).toHaveBeenCalledExactlyOnceWith(next); expect(h.hooks.onSource).toHaveBeenCalledExactlyOnceWith('CANDIDATE');
  h.draw(); await settle(); expect(next.handoffView).toHaveBeenCalledOnce();
  h.mount.unmount('hidden'); expect(resume).toHaveBeenCalledOnce();
});

it('keeps the outgoing scene and resumes it if the final handoff draw rejects', async () => {
  const { h, old, next, oldCanvas, nextCanvas, resume, draw } = await heldHandoff();
  draw.reject(new Error('Final coverage failed')); await settle();
  expect(h.mount.scene).toBe(old); expect(h.canvases).toEqual([oldCanvas]); expect(oldCanvas.style.visibility).toBe('');
  expect(nextCanvas.style.visibility).toBe('hidden'); expect(next.dispose).toHaveBeenCalledOnce();
  expect(old.dispose).not.toHaveBeenCalled(); expect(resume).toHaveBeenCalledOnce();
  expect(h.chatOffs[0]).not.toHaveBeenCalled(); expect(h.preparations[0]!.dispose).not.toHaveBeenCalled();
  expect(h.preparations[1]!.activate).not.toHaveBeenCalled(); expect(h.hooks.onScene).not.toHaveBeenCalled();
  expect(h.hooks.onPhase).toHaveBeenLastCalledWith('failed'); expect(h.mount.stats.lastFailure).toBe('The kingdom could not refresh just now.'); expect(h.mount.stats.lastCause).toBe('Final coverage failed');
  h.mount.unmount('hidden'); expect(resume).toHaveBeenCalledOnce();
});

it('includes the final handoff in the five-minute timeout and prevents its late promotion', async () => {
  const { h, old, next, oldCanvas, resume, draw } = await heldHandoff();
  vi.advanceTimersByTime(5 * 60_000); await settle();
  expect(h.mount.scene).toBe(old); expect(h.canvases).toEqual([oldCanvas]);
  expect(next.dispose).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce();
  expect(h.preparations[1]!.activate).not.toHaveBeenCalled();
  draw.resolve(); await settle();
  expect(h.mount.scene).toBe(old); expect(h.hooks.onScene).not.toHaveBeenCalled();
  expect(resume).toHaveBeenCalledOnce(); h.mount.unmount('hidden');
});

it('releases a superseded handoff before warming another and ignores the stale resolve microtask', async () => {
  const { h, old, next, resume, draw } = await heldHandoff();
  draw.resolve(); // Continuation is queued, but a newer watch revision wins synchronously.
  h.revisions[0]!();
  expect(resume).toHaveBeenCalledOnce(); expect(next.dispose).toHaveBeenCalledOnce();
  await settle();
  expect(h.mount.scene).toBe(old); expect(h.scenes).toHaveLength(3); expect(h.mount.stats.alive).toBe(2);
  expect(h.preparations[1]!.activate).not.toHaveBeenCalled(); expect(h.hooks.onScene).not.toHaveBeenCalled();
  const newer = h.scenes[2]!, newerDraw = finalDraw(), newerResume = vi.fn();
  vi.mocked(old.suspendRendering).mockReturnValue(newerResume); vi.mocked(newer.handoffView).mockReturnValue(newerDraw.promise);
  newer.debug.ready = true; h.draw(); await settle();
  expect(newer.handoffView).toHaveBeenCalledOnce(); expect(h.mount.scene).toBe(old);
  newerDraw.resolve(); await settle();
  expect(h.mount.scene).toBe(newer); expect(newerResume).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce();
  expect(h.preparations[2]!.activate).toHaveBeenCalledOnce(); h.mount.unmount('hidden');
});

it('releases the outgoing hold exactly once when hidden during the awaited handoff', async () => {
  const { h, old, next, resume, draw } = await heldHandoff();
  h.mount.unmount('hidden');
  expect(old.dispose).toHaveBeenCalledOnce(); expect(next.dispose).toHaveBeenCalledOnce();
  expect(resume).toHaveBeenCalledOnce(); expect(h.mount.stats.alive).toBe(0);
  draw.reject(new Error('Disposed before final draw')); await settle();
  expect(h.mount.scene).toBeUndefined(); expect(h.hooks.onPhase).toHaveBeenLastCalledWith('hidden');
  expect(h.preparations[1]!.activate).not.toHaveBeenCalled(); expect(resume).toHaveBeenCalledOnce();
});

it('shows a refusal in words without logging it as an error, and still logs real failures', async () => {
  const h = harness();
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  h.prepare.mockImplementationOnce(async () => { throw new StreamRefusal('Choose a founded kingdom to watch.'); });
  h.mount.mount(); await settle();
  expect(h.hooks.onPhase).toHaveBeenLastCalledWith('failed');
  expect(logged).not.toHaveBeenCalled(); expect(h.mount.stats.lastFailure).toBe('Choose a founded kingdom to watch.');
  h.prepare.mockImplementationOnce(async () => { throw new Error('The realm answered 500.'); });
  h.mount.mount(); await settle();
  expect(logged).toHaveBeenCalledWith('The stream kingdom could not open', expect.any(Error));
  expect(h.mount.stats.lastFailure).toBe('The kingdom could not be opened just now.'); expect(h.mount.stats.lastCause).toBe('The realm answered 500.');
  h.prepare.mockImplementationOnce(async () => { throw new TypeError("Cannot read properties of undefined (reading 'manifest')"); });
  h.mount.mount(); await settle();
  expect(h.mount.stats.lastFailure).toBe('The kingdom could not be opened just now.');
  logged.mockRestore();
});
