import { afterEach, expect, it, vi } from 'vitest';
import type { SceneOptions } from '../kingdom/scene';
import { createSceneMount, type KingdomScene, type PreparedStreamScene } from './mount';

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
  const prepare = vi.fn(async (signal: AbortSignal, revision: () => void) => {
    signals.push(signal); revisions.push(revision);
    const prepared: PreparedStreamScene = { settings: {}, dispose: vi.fn(), activate: vi.fn() };
    preparations.push(prepared);
    return prepared;
  });
  createScene.mockImplementation(async (_canvas: HTMLCanvasElement, settings: SceneOptions) => {
    options.push(settings);
    const scene = {
      debug: { ready: false, camera: 'window', hour: 21.25, time: 17 },
      dispose: vi.fn(), momentDirecting: () => false, receiveChat: vi.fn(), clearChat: vi.fn(),
      captureCitizens: () => undefined, restoreCitizens: vi.fn(),
      captureView: () => ({ eye: [12, 30, 41], target: [1, 2, 3], fov: 43 }), handoffView: vi.fn(),
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
  return { mount, hooks, canvases, scenes, options, revisions, signals, preparations, prepare, draw, ready, loseContext };
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
  expect(h.options[1]).toMatchObject({ initialView: old.captureView(), camera: 'window', hour: 21.25, time: null });

  h.options[0]!.onSource('LIVE CHAT');
  expect(h.hooks.onSource).toHaveBeenLastCalledWith('LIVE CHAT');
  next.debug.ready = true; h.draw();
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
