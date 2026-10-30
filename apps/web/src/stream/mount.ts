import { createKingdomScene, type SceneOptions } from '../kingdom/scene';

export type KingdomScene = Awaited<ReturnType<typeof createKingdomScene>>;
export type StreamPhase = 'waking' | 'ready' | 'hidden' | 'failed';
type SceneSettings = Omit<SceneOptions, 'signal' | 'onProgress' | 'onNames' | 'onSource' | 'onError'>;

/** What a review can ask of the mount: how many scenes were built and how many still hold a GPU context. */
export interface SceneMountStats { mounts: number; alive: number; disposed: number; cancelled: number }

interface Entry { canvas: HTMLCanvasElement; controller: AbortController; scene?: KingdomScene; frame: number }

/**
 * One kingdom scene per stream mount, and only while someone can see it. Each mount
 * gets a fresh canvas; unmounting cancels construction through the scene's own abort
 * signal, disposes the instance and gives its WebGL context back, so a hidden OBS
 * source keeps no renderer, worker pool, light field or feed subscription alive.
 */
export function createSceneMount(hooks: {
  host(): HTMLElement;
  settings(): SceneSettings;
  onPhase(phase: StreamPhase): void;
  onProgress(text: string, fraction: number): void;
  onSource(label: string): void;
  onScene(scene: KingdomScene | undefined): void;
}) {
  const stats: SceneMountStats = { mounts: 0, alive: 0, disposed: 0, cancelled: 0 };
  let current: Entry | undefined;

  function release(entry: Entry): void {
    cancelAnimationFrame(entry.frame);
    if (!entry.scene) stats.cancelled++;
    entry.controller.abort();
    entry.scene?.dispose();
    // The renderer has already let go of its resources and listeners. Losing the
    // context now returns it to the browser instead of waiting for collection.
    const gl = entry.canvas.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    entry.canvas.remove();
    stats.alive--;
    stats.disposed++;
  }

  function unmount(phase: Exclude<StreamPhase, 'waking' | 'ready'>): void {
    const entry = current;
    current = undefined;
    if (entry) { hooks.onScene(undefined); release(entry); }
    hooks.onPhase(phase);
  }

  function mount(): void {
    if (current) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'stream-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    hooks.host().append(canvas);
    const entry: Entry = { canvas, controller: new AbortController(), frame: 0 };
    current = entry;
    stats.mounts++;
    stats.alive++;
    hooks.onPhase('waking');
    const own = () => current === entry;
    createKingdomScene(canvas, {
      ...hooks.settings(),
      signal: entry.controller.signal,
      onProgress: (text, fraction) => { if (own()) hooks.onProgress(text, fraction); },
      onNames: () => { /* Personal labels are the director's to place, not the frame's. */ },
      onSource: label => { if (own()) hooks.onSource(label); },
      onError: () => { if (own()) unmount('failed'); },
    }).then(scene => {
      if (!own()) { scene.dispose(); return; }
      entry.scene = scene;
      hooks.onScene(scene);
      // Ready means the renderer drew the loaded town with light from every field.
      const opened = () => {
        if (!own()) return;
        if (!scene.debug.ready) { entry.frame = requestAnimationFrame(opened); return; }
        hooks.onPhase('ready');
      };
      entry.frame = requestAnimationFrame(opened);
    }).catch((cause: unknown) => {
      if (!own()) return;
      console.error('The stream kingdom could not open', cause);
      unmount('failed');
    });
  }

  return { stats, mount, unmount, get scene() { return current?.scene; } };
}
