// The story page's live hero (work/lanes/front-door/SEAMS.md §2): a channel's adopted kingdom on its grand land,
// drawn into a canvas the page owns, behind the page's plate. It is the public live view (`live-controller.ts`) with
// the page's parts taken out: the kingdom and hour come from the caller instead of the URL, nothing is written to
// `window`, the canvas never takes input, and the watch and the dock are read-only.
//
// It drives the kingdom scene directly rather than through `createSceneMount`: the mount creates, swaps and removes
// its own canvases inside a host element (and loses their contexts as it retires them), while the hero is handed one
// canvas that the page sizes and places itself. Drawing into that canvas is the only honest fit.
//
// Everything heavy is imported after zod is told to stay jitless. The front page runs under a CSP without
// 'unsafe-eval', and zod probes for its compiler when a schema is built, so the probe must be off before any schema
// module evaluates.
import type { SceneQuality } from '../kingdom/scene';
import type { KingdomScene } from '../stream/mount';

/** The quality the page asks for. The hero never picks a tier of its own. */
export type LandHeroTier = 'high' | 'medium' | 'low' | 'software';

export interface LandHeroOptions {
  /** A Twitch login (or kingdom id) with an adopted grand land: today `tobi4s_`. Any other name rejects the mount. */
  readonly channel: string;
  /** Hour of day, 0 to 24. The hero holds it; nothing changes it after mounting. */
  readonly hour: number;
  /**
   * The scene clock in seconds for the first drawn frame, so the same camera, hour and time open on the same picture.
   * A live kingdom's clock then runs while the hero draws (water, clouds, citizens) and stops while it is paused.
   */
  readonly time: number;
  /** The overview lens's orbit yaw in degrees. Pitch and distance stay the lens's own framing of the land. */
  readonly yaw: number;
  readonly tier: LandHeroTier;
  /** Called exactly once if the hero fails after `mountLandHero` resolved. Never called after `dispose()`. */
  readonly onFailure: (message: string) => void;
}

export interface LandHero {
  /**
   * Resolves at the first frame drawn after this call while the scene is ready: on a fresh mount that is the scene's
   * first fully loaded frame, after `setYaw` it is the first frame drawn from the new camera. The grand land keeps
   * refining its far regions in the background; this does not wait for that. While paused it waits for `resume()`.
   * Rejects with the failure (an `Error` carrying the same message `onFailure` received) if the hero has failed or
   * fails before then, and with an `AbortError` if the hero is disposed first.
   */
  settled(): Promise<void>;
  /** Turns the overview lens to `yaw` degrees, keeping its pitch and distance. Throws a RangeError on a non-finite yaw. */
  setYaw(yaw: number): void;
  /**
   * The canvas changed size. The scene already follows its canvas with its own ResizeObserver, so there is nothing
   * left to do here; it exists so a page can call it unconditionally.
   */
  resize(): void;
  /** Stops the render loop: nothing is drawn and the scene clock stands still until `resume()`. The watch stays open. */
  pause(): void;
  /** Starts the render loop again from where it paused. */
  resume(): void;
  /** Closes the watch and the dock, disposes the scene and releases the canvas's WebGL context. Safe to call twice. */
  dispose(): void;
}

const QUALITY: Readonly<Record<LandHeroTier, SceneQuality>> = { high: 'high', medium: 'balanced', low: 'low', software: 'low' };
// The overview lens wires OrbitControls (and the scene its build and Forge picking) to the canvas. The hero is a picture
// under the page, so every input event stops at the canvas before any of them sees it. Default actions (scrolling the
// page, the context menu) are left alone.
const INPUT = ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu', 'keydown'] as const;
const unreachable = 'The kingdom could not be reached.';

/**
 * Raises `options.channel`'s adopted kingdom on its grand land into `canvas`, framed by the overview lens.
 *
 * The returned promise rejects (and `onFailure` is not called) when the options are invalid, the channel has no adopted
 * grand land, or the hero's code cannot load; nothing touches the network in those cases. Otherwise it resolves at
 * once with the handle while the kingdom raises behind it: every later failure (the watch cannot be reached or
 * confirmed, the scene cannot open or render, the GPU context is lost) tears the hero down, calls `onFailure(message)`
 * exactly once and rejects every pending and future `settled()` with that message.
 *
 * A revision of the kingdom while the hero is up (a home founded, a street grown) keeps the confirmed scene on screen:
 * its windows hold their last witnessed light. The live view swaps in the new revision; the hero, which has a single
 * canvas, is remounted by the page on its next visit.
 */
export async function mountLandHero(canvas: HTMLCanvasElement, options: LandHeroOptions): Promise<LandHero> {
  const quality = qualityFor(options);
  (await import('zod')).config({ jitless: true });
  const { grandLiveSelection } = await import('./live-source');
  const selected = grandLiveSelection(new URLSearchParams({ channel: options.channel }));
  if (!selected) throw new Error(`${options.channel} has no adopted grand land`);
  const [{ createKingdomScene }, { createRealmSpectatorSource }, { createDockConnection }] = await Promise.all([
    import('../kingdom/scene'), import('../kingdom-entry/spectator'), import('../stream/dock-connection')]);

  const kingdomId = selected.kingdomId, abort = new AbortController();
  let disposed = false, tornDown = false, paused = false, sceneStarted = false, failure: Error | null = null, yaw = options.yaw, frame = 0;
  let scene: KingdomScene | undefined, resumeRendering: (() => void) | undefined, offChat: (() => void) | undefined;
  let connection: { dispose(): void } | undefined;
  let waiters: { after: number; resolve(): void; reject(reason: unknown): void }[] = [];
  const block = (event: Event) => event.stopImmediatePropagation();
  for (const type of INPUT) canvas.addEventListener(type, block, { capture: true });
  const watch = createRealmSpectatorSource({ kingdomId });
  const dock = createDockConnection(kingdomId, { readOnly: true });

  function teardown() {
    if (tornDown) return;
    tornDown = true;
    cancelAnimationFrame(frame); frame = 0;
    offChat?.(); offChat = undefined; resumeRendering = undefined;
    abort.abort();
    scene?.dispose(); scene = undefined;
    connection?.dispose(); connection = undefined;
    dock.dispose();
    // Return the GPU context now rather than at collection. Only a context the scene created is touched.
    if (sceneStarted) canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    for (const type of INPUT) canvas.removeEventListener(type, block, { capture: true });
  }
  function fail(message: string) {
    if (disposed || failure) return;
    failure = new Error(message);
    teardown();
    const pending = waiters; waiters = [];
    for (const waiter of pending) waiter.reject(failure);
    try { options.onFailure(message); } catch (error) { console.error('The land hero failure handler threw', error); }
  }
  // Waiters are answered from the scene's own record of its last completed draw, polled only while someone waits.
  function watchFrames() {
    if (frame || !waiters.length || paused || !scene || tornDown) return;
    frame = requestAnimationFrame(checkFrame);
  }
  function checkFrame() {
    frame = 0;
    if (!scene || paused || tornDown) return;
    if (scene.debug.ready) {
      const drawnAt = scene.inspect().renderCompletedAt;
      const due = waiters.filter(waiter => drawnAt > waiter.after);
      waiters = waiters.filter(waiter => drawnAt <= waiter.after);
      for (const waiter of due) waiter.resolve();
    }
    watchFrames();
  }

  async function raise() {
    // A revision keeps the confirmed scene (see above); losing the watch fails the hero.
    const opened = await watch(abort.signal, () => {}, () => fail(unreachable));
    if (disposed || failure) { opened.dispose(); return; }
    connection = opened;
    if (opened.manifest.origin !== 'live' || opened.scene.origin !== 'live' || opened.manifest.kingdomId !== kingdomId || opened.scene.kingdomId !== kingdomId)
      throw new Error('The adopted kingdom could not be confirmed');
    opened.activate();
    const plan = opened.scene.plan;
    sceneStarted = true;
    const next = await createKingdomScene(canvas, {
      mode: 'watching', overview: true, source: 'herald', camera: 'hero', directArrivals: false, hour: options.hour, time: options.time,
      founded: opened.scene, foundedReceipt: opened.manifest, kingdomId, realmName: opened.kingdomName,
      tier: plan.config.tier, seed: plan.config.seed, firstYear: plan.config.firstYear, year: plan.config.year,
      presenceOrigin: 'live', presenceFeed: opened.presenceFeed, growthFeed: opened.growthFeed, growthCeremonies: opened.growthCeremonies,
      forgeFeed: opened.forgeFeed, momentFeed: opened.momentFeed, walkerFeed: opened.walkerFeed, dockFeed: dock, signal: abort.signal,
      // The hero shows no progress, name plates or source line; the page's pictures cover the raise.
      onProgress: () => {}, onNames: () => {}, onSource: () => {},
      onError: message => fail(message),
    });
    if (disposed || failure) { next.dispose(); return; }
    scene = next;
    // The scene returns with its first loaded frame still to draw: quality and camera land before it.
    next.setQuality(quality);
    if (!next.overview) throw new Error('The kingdom’s grand land did not open');
    next.overview.orbit(radians(yaw), null, null);
    next.activateDock?.();
    if (paused) resumeRendering = next.suspendRendering();
    offChat = opened.chatFeed.subscribe(message => {
      if (message.type === 'chat') next.receiveChat(message.cue);
      else if (message.type === 'chat.remove') next.clearChat(message.cueIds);
      else next.clearChat();
    });
    watchFrames();
  }
  void raise().catch((cause: unknown) => {
    if (disposed || failure) return;
    console.error('The land hero could not open', cause);
    fail(cause instanceof Error && cause.message ? cause.message : unreachable);
  });

  return {
    settled() {
      if (failure) return Promise.reject(failure);
      if (disposed) return Promise.reject(new DOMException('The land hero was disposed', 'AbortError'));
      return new Promise<void>((resolve, reject) => { waiters.push({ after: performance.now(), resolve, reject }); watchFrames(); });
    },
    setYaw(value) {
      if (!Number.isFinite(value)) throw new RangeError('The hero yaw must be a finite number of degrees');
      if (disposed || failure) return;
      yaw = value;
      scene?.overview?.orbit(radians(value), null, null);
    },
    resize() {},
    pause() {
      if (disposed || failure || paused) return;
      paused = true;
      cancelAnimationFrame(frame); frame = 0;
      if (scene) resumeRendering = scene.suspendRendering();
    },
    resume() {
      if (disposed || failure || !paused) return;
      paused = false;
      const release = resumeRendering; resumeRendering = undefined;
      release?.();
      watchFrames();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      teardown();
      const pending = waiters; waiters = [];
      const reason = new DOMException('The land hero was disposed', 'AbortError');
      for (const waiter of pending) waiter.reject(reason);
    },
  };
}

function radians(degrees: number) { return degrees * Math.PI / 180; }

function qualityFor(options: LandHeroOptions): SceneQuality {
  if (typeof options?.onFailure !== 'function') throw new TypeError('The land hero needs an onFailure handler');
  if (typeof options.channel !== 'string' || !options.channel.trim()) throw new TypeError('The land hero needs a channel');
  if (!Number.isFinite(options.hour) || options.hour < 0 || options.hour > 24) throw new RangeError('The hero hour must be between 0 and 24');
  if (!Number.isFinite(options.time) || options.time < 0) throw new RangeError('The hero time must be a non-negative number of seconds');
  if (!Number.isFinite(options.yaw)) throw new RangeError('The hero yaw must be a finite number of degrees');
  if (!Object.hasOwn(QUALITY, options.tier)) throw new RangeError(`Unknown hero tier: ${String(options.tier)}`);
  return QUALITY[options.tier];
}
