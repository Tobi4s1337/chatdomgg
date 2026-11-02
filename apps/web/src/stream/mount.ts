import { createKingdomScene, type NameLabel, type SceneOptions } from '../kingdom/scene';
import type { RealmChatFeed } from '../realm/adapters/chat';
import type { SpeechLabel } from '../kingdom/citizen-scene';
import { createOpeningJournal, type OpeningJournal } from '../kingdom/grand-land/opening/journal';

export type KingdomScene = Awaited<ReturnType<typeof createKingdomScene>>;
export type StreamPhase = 'waking' | 'ready' | 'hidden' | 'failed';

/** An expected refusal the stream shows in words (no kingdom chosen); it is not logged as an error. */
export class StreamRefusal extends Error { override name = 'StreamRefusal'; }
type SceneSettings = Omit<SceneOptions, 'signal' | 'onProgress' | 'onNames' | 'onSpeech' | 'onSource' | 'onError' | 'opening'>;
export interface PreparedStreamScene {
  settings: Partial<SceneSettings>;
  chatFeed?: RealmChatFeed;
  /** Transfer shared live feeds only when this scene becomes visible. */
  activate?(): void;
  dispose(reason?: 'scene-revision'): void;
}

/** A ready scene may keep one replacement GPU context warm until its first loaded draw. */
export interface SceneMountStats { mounts: number; alive: number; disposed: number; cancelled: number; lastFailure?: string }

interface Entry {
  canvas: HTMLCanvasElement;
  controller: AbortController;
  scene?: KingdomScene;
  prepared?: PreparedStreamScene;
  offChat?: (() => void) | undefined;
  frame: number;
  timeout?: ReturnType<typeof setTimeout>;
  ready: boolean;
  activating?: boolean;
  resumePrevious?: (() => void) | undefined;
  released: boolean;
  publications: Map<string, () => void>;
  /** What the visible opening has really done; replacements open behind the drawn kingdom and keep none. */
  opening?: OpeningJournal;
}

// A software-rendered first draw can take minutes; the loaded town keeps drawing meanwhile.
const REPLACEMENT_TIMEOUT_MS = 5 * 60_000;

/**
 * A visible kingdom keeps drawing while one replacement prepares behind it. Only
 * a loaded draw transfers the canvas, labels and director to that replacement.
 * Hiding aborts both scenes and returns their WebGL contexts immediately.
 */
export function createSceneMount(hooks: {
  host(): HTMLElement;
  settings(): SceneSettings;
  prepare?(signal: AbortSignal, revision: () => void, unavailable: () => void): Promise<PreparedStreamScene>;
  onPhase(phase: StreamPhase): void;
  onProgress(text: string, fraction: number): void;
  /** A new visible opening began: the loader follows this journal. */
  onOpening?(journal: OpeningJournal): void;
  onSource(label: string): void;
  /** The renderer's permitted public names near the camera. The view decides whether one is shown. */
  onNames(names: NameLabel[]): void;
  onSpeech?(labels: SpeechLabel[]): void;
  onScene(scene: KingdomScene | undefined): void;
  /** A witnessed ceremony owns the camera and must also interrupt pending director cuts. */
  onDirecting?(directing: boolean): void;
}) {
  const stats: SceneMountStats = { mounts: 0, alive: 0, disposed: 0, cancelled: 0 };
  let current: Entry | undefined, pending: Entry | undefined, failed = false;
  const owns = (entry: Entry) => !entry.released && (current === entry || pending === entry);
  const visible = (entry: Entry) => !entry.released && current === entry;

  function publish(entry: Entry, key: string, action: () => void): void {
    if (!owns(entry)) return;
    if (visible(entry)) action();
    else entry.publications.set(key, action);
  }

  function resumePrevious(entry: Entry): void {
    const resume = entry.resumePrevious;
    entry.resumePrevious = undefined;
    resume?.();
  }

  function release(entry: Entry, reason?: 'scene-revision'): void {
    if (entry.released) return;
    entry.released = true;
    resumePrevious(entry);
    cancelAnimationFrame(entry.frame);
    clearTimeout(entry.timeout);
    if (!entry.scene) stats.cancelled++;
    entry.offChat?.();
    entry.publications.clear();
    entry.prepared?.dispose(reason);
    entry.controller.abort(reason);
    entry.scene?.dispose();
    // Explicitly return the renderer's context instead of waiting for collection.
    const gl = entry.canvas.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    entry.canvas.remove();
    stats.alive--;
    stats.disposed++;
  }

  function unmount(phase: Exclude<StreamPhase, 'waking' | 'ready'>): void {
    const old = current, warming = pending;
    current = pending = undefined;
    failed = phase === 'failed';
    if (warming) release(warming);
    if (old) release(old);
    hooks.onScene(undefined);
    hooks.onNames([]);
    hooks.onSpeech?.([]);
    hooks.onDirecting?.(false);
    hooks.onPhase(phase);
  }

  function fail(entry: Entry, reason = 'The kingdom could not be opened just now.'): void {
    if (!owns(entry)) return;
    stats.lastFailure = reason;
    entry.opening?.fail(reason);
    if (pending !== entry) { unmount('failed'); return; }
    pending = undefined;
    release(entry, 'scene-revision');
    // The old picture stays on screen, but a failed refresh must not claim to be
    // current. StreamView's existing failed-state timer calls mount() to retry.
    failed = true;
    hooks.onPhase('failed');
  }

  async function activate(entry: Entry): Promise<void> {
    if (!owns(entry) || pending !== entry || entry.activating) return;
    entry.activating = true;
    const old = current;
    try {
      // Hold the outgoing lens steady while the hidden renderer covers that exact view.
      // Its canvas and live feeds stay owned until the replacement's final draw succeeds.
      if (old?.scene) entry.resumePrevious = old.scene.suspendRendering();
      if (old?.scene) await entry.scene!.handoffView(old.scene.captureView());
      // A watch revision, timeout or hide can win while handoff is awaiting a draw.
      if (!owns(entry) || pending !== entry || current !== old || old?.released) return;
      const citizens = old?.scene?.captureCitizens();
      current = entry;
      pending = undefined;
      clearTimeout(entry.timeout);
      entry.canvas.style.visibility = '';
      // No frame can occur between revealing the loaded canvas and retiring the old one.
      if (old) release(old, 'scene-revision');
      resumePrevious(entry);
      entry.scene!.activateDock?.();
      entry.scene!.restoreCitizens(citizens);
      hooks.onSpeech?.([]);
      for (const action of entry.publications.values()) action();
      entry.publications.clear();
      entry.prepared?.activate?.();
      hooks.onScene(entry.scene);
      if (failed) { failed = false; hooks.onPhase('ready'); }
      hooks.onDirecting?.(entry.scene!.momentDirecting());
    } catch (cause) {
      fail(entry, cause instanceof Error ? cause.message : 'The replacement could not render its final view');
    } finally {
      resumePrevious(entry);
    }
  }

  function revise(entry: Entry): void {
    if (!owns(entry)) return;
    if (current?.ready) {
      // Either watch may witness a newer revision while the candidate is loading.
      // Its predecessor is fully released before another context can be created.
      if (pending) { const old = pending; pending = undefined; release(old, 'scene-revision'); }
      begin(true);
    } else {
      const old = current;
      current = undefined;
      if (old) release(old, 'scene-revision');
      begin(false);
    }
  }

  function begin(replacement: boolean): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'stream-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    if (replacement) canvas.style.visibility = 'hidden';
    hooks.host().append(canvas);
    const entry: Entry = { canvas, controller: new AbortController(), frame: 0, ready: false, released: false, publications: new Map() };
    if (replacement) {
      pending = entry;
      entry.timeout = setTimeout(() => fail(entry, 'The kingdom took too long to refresh.'), REPLACEMENT_TIMEOUT_MS);
    } else {
      current = entry;
      failed = false;
      entry.opening = createOpeningJournal();
      hooks.onPhase('waking');
      hooks.onOpening?.(entry.opening);
    }
    stats.mounts++;
    stats.alive++;
    // Defer prepare so even a synchronous throw or revision belongs to this entry.
    void Promise.resolve().then(() => {
      if (!owns(entry)) throw new DOMException('Stream was cancelled', 'AbortError');
      return hooks.prepare?.(entry.controller.signal, () => revise(entry), () => fail(entry));
    }).then(prepared => {
      if (!owns(entry)) { prepared?.dispose(entry.controller.signal.reason === 'scene-revision' ? 'scene-revision' : undefined); throw new DOMException('Stream was cancelled', 'AbortError'); }
      if (prepared) entry.prepared = prepared;
      if (visible(entry)) prepared?.activate?.();
      if (!owns(entry)) throw new DOMException('Stream was cancelled', 'AbortError');
      const settings = { ...hooks.settings(), ...prepared?.settings };
      const prior = replacement ? current?.scene : undefined;
      return createKingdomScene(canvas, {
        ...settings,
        mode: settings.mode ?? 'stream',
        deferLandPresentation: replacement,
        ...(prior ? { initialView: prior.captureView(), camera: prior.debug.camera, hour: prior.debug.hour, time: settings.time === null ? null : prior.debug.time } : {}),
        // These labels also originate in SceneOptions; a warming scene cannot
        // move live plates or captions belonging to the visible kingdom.
        onArrival: value => publish(entry, 'arrival', () => settings.onArrival?.(value)),
        onWalkers: value => publish(entry, 'walkers', () => settings.onWalkers?.(value)),
        onMomentCaptions: value => publish(entry, 'captions', () => settings.onMomentCaptions?.(value)),
        onReady: () => publish(entry, 'ready', () => settings.onReady?.()),
        onForge: value => publish(entry, 'forge', () => settings.onForge?.(value)),
        onBuild: value => publish(entry, 'build', () => settings.onBuild?.(value)),
        onHousewarming: value => publish(entry, 'housewarming', () => settings.onHousewarming?.(value)),
        signal: entry.controller.signal,
        ...(entry.opening ? { opening: entry.opening } : {}),
        onProgress: (text, fraction) => { if (visible(entry)) hooks.onProgress(text, fraction); },
        onNames: names => publish(entry, 'names', () => hooks.onNames(names)),
        onSpeech: labels => publish(entry, 'speech', () => hooks.onSpeech?.(labels)),
        onSource: label => publish(entry, 'source', () => hooks.onSource(label)),
        onError: message => fail(entry, message),
      });
    }).then(scene => {
      if (!owns(entry)) { scene.dispose(); return; }
      entry.scene = scene;
      entry.offChat = entry.prepared?.chatFeed?.subscribe(message => {
        if (!visible(entry)) return;
        if (message.type === 'chat') scene.receiveChat(message.cue);
        else if (message.type === 'chat.remove') scene.clearChat(message.cueIds);
        else { scene.clearChat(); hooks.onSpeech?.([]); }
      });
      if (visible(entry)) { scene.activateDock?.(); hooks.onScene(scene); }
      let directing = false;
      const opened = () => {
        if (!owns(entry)) return;
        if (!entry.ready && scene.debug.ready) {
          entry.ready = true;
          if (pending === entry) { directing = scene.momentDirecting(); void activate(entry); }
          else hooks.onPhase('ready');
        }
        if (visible(entry)) {
          const next = scene.momentDirecting();
          if (next !== directing) { directing = next; hooks.onDirecting?.(next); }
        }
        if (owns(entry)) entry.frame = requestAnimationFrame(opened);
      };
      entry.frame = requestAnimationFrame(opened);
    }).catch((cause: unknown) => {
      if (!owns(entry)) return;
      if (!(cause instanceof StreamRefusal)) console.error('The stream kingdom could not open', cause);
      fail(entry, cause instanceof Error ? cause.message : 'The kingdom could not be opened just now.');
    });
  }

  function mount(): void {
    if (pending || current && !failed) return;
    begin(!!current?.ready);
  }

  return { stats, mount, unmount, get scene() { return current?.scene; } };
}
