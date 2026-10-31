import { createKingdomScene, type NameLabel, type SceneOptions } from '../kingdom/scene';
import type { RealmChatFeed } from '../realm/adapters/chat';
import type { SpeechLabel } from '../kingdom/citizen-scene';

export type KingdomScene = Awaited<ReturnType<typeof createKingdomScene>>;
export type StreamPhase = 'waking' | 'ready' | 'hidden' | 'failed';
type SceneSettings = Omit<SceneOptions, 'signal' | 'onProgress' | 'onNames' | 'onSpeech' | 'onSource' | 'onError'>;
export interface PreparedStreamScene {
  settings: Partial<SceneSettings>;
  chatFeed?: RealmChatFeed;
  dispose(reason?: 'scene-revision'): void;
}

/** What a review can ask of the mount: how many scenes were built and how many still hold a GPU context. */
export interface SceneMountStats { mounts: number; alive: number; disposed: number; cancelled: number }

interface Entry { canvas: HTMLCanvasElement; controller: AbortController; scene?: KingdomScene; prepared?: PreparedStreamScene; offChat?: (() => void) | undefined; frame: number }

/**
 * One kingdom scene per stream mount, and only while someone can see it. Each mount
 * gets a fresh canvas; unmounting cancels construction through the scene's own abort
 * signal, disposes the instance and gives its WebGL context back, so a hidden OBS
 * source keeps no renderer, worker pool, light field or feed subscription alive.
 */
export function createSceneMount(hooks: {
  host(): HTMLElement;
  settings(): SceneSettings;
  prepare?(signal: AbortSignal, revision: () => void, unavailable: () => void): Promise<PreparedStreamScene>;
  onPhase(phase: StreamPhase): void;
  onProgress(text: string, fraction: number): void;
  onSource(label: string): void;
  /** The renderer's permitted public names near the camera. The view decides whether one is shown. */
  onNames(names: NameLabel[]): void;
  onSpeech?(labels: SpeechLabel[]): void;
  onScene(scene: KingdomScene | undefined): void;
  /** A witnessed ceremony owns the camera and must also interrupt pending director cuts. */
  onDirecting?(directing: boolean): void;
}) {
  const stats: SceneMountStats = { mounts: 0, alive: 0, disposed: 0, cancelled: 0 };
  let current: Entry | undefined;

  function release(entry: Entry, reason?: 'scene-revision'): void {
    cancelAnimationFrame(entry.frame);
    if (!entry.scene) stats.cancelled++;
    entry.offChat?.();
    hooks.onSpeech?.([]);
    entry.prepared?.dispose(reason);
    entry.controller.abort(reason);
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
    if (entry) { hooks.onScene(undefined); hooks.onNames([]); release(entry); }
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
    const prepare = hooks.prepare?.(entry.controller.signal, () => {
      if (!own()) return;
      current = undefined; hooks.onScene(undefined); hooks.onNames([]); release(entry, 'scene-revision'); mount();
    }, () => { if (own()) unmount('failed'); });
    void Promise.resolve(prepare).then(prepared => {
      if (!own()) { prepared?.dispose(); throw new DOMException('Stream was cancelled', 'AbortError'); }
      if (prepared) entry.prepared = prepared;
      return createKingdomScene(canvas, {
        ...hooks.settings(),
        ...prepared?.settings,
        signal: entry.controller.signal,
        onProgress: (text, fraction) => { if (own()) hooks.onProgress(text, fraction); },
        onNames: names => { if (own()) hooks.onNames(names); },
        onSpeech: labels => { if (own()) hooks.onSpeech?.(labels); },
        onSource: label => { if (own()) hooks.onSource(label); },
        onError: () => { if (own()) unmount('failed'); },
      });
    }).then(scene => {
      if (!own()) { scene.dispose(); return; }
      entry.scene = scene;
      entry.offChat = entry.prepared?.chatFeed?.subscribe(message => {
        if (!own()) return;
        if (message.type === 'chat') scene.receiveChat(message.cue);
        else if (message.type === 'chat.remove') scene.clearChat(message.cueIds);
        else { scene.clearChat(); hooks.onSpeech?.([]); }
      });
      hooks.onScene(scene);
      // Ready means the renderer drew the loaded town with light from every field.
      let ready = false, directing = false;
      const opened = () => {
        if (!own()) return;
        if (!ready && scene.debug.ready) { ready = true; hooks.onPhase('ready'); }
        const next = scene.momentDirecting();
        if (next !== directing) { directing = next; hooks.onDirecting?.(next); }
        entry.frame = requestAnimationFrame(opened);
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
