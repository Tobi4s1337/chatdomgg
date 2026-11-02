import type { KingdomId } from '@chatdom/shared';
import type { WalkController } from '../walk';
import { isEditableTarget } from '../walk/input/keyboard';
import type { CursorState, CursorView, PlayBuildEntry, PlayCue, PlayHost, PlayHud, PlayMapView, PlayVolume, PlayWayHomeLights, WayHome } from './host';
import { sharedPlaySettings, type PlaySettingsStore } from './settings';
import { actionCode } from './settings';
import { actionBindings, wantedArrivalSteps, type CursorLease, type InputLease, type PlayContext } from './slots';
import { createToolRuntime, type PlayWorld, type ToolRuntime } from './tools';
import { createWalkFeatures, type WalkFeatureRuntime, type WalkFeatureWorld } from './features';

/**
 * One walking session's play layer: the captured mouse meets the ledger here. The walk owns input and camera;
 * the HUD owns drawing. This module only routes between them:
 * - the person letting go of the mouse (Escape, focus loss) opens the ledger, which holds the cursor and the walk;
 * - the ledger key, V (first or third person) and the fullscreen key are heard here, from the person's bindings;
 * - panels take the cursor through `requestCursor` leases and give it back;
 * - arrival steps (the mirror) run once, before the walker takes control.
 */

export interface PlaySessionOptions {
  readonly host: HTMLElement;
  readonly controller: WalkController;
  readonly kingdomId: KingdomId;
  readonly self: PlayContext['self'];
  /** Read live: the stream is live right now. */
  readonly live: () => boolean;
  readonly wayHome: () => WayHome | null;
  /** The map (PL12); without it the HUD has no minimap and the ledger no map page. */
  readonly map?: () => PlayMapView | null;
  /** The lantern path home (PL12). */
  readonly lights?: PlayWayHomeLights;
  readonly build: PlayBuildEntry;
  /** The volumes the kingdom's sound applies live (see `PlayHost.volumes`). Default none. */
  readonly volumes?: readonly PlayVolume[];
  readonly cue: (surface: PlayCue) => void;
  /** Use the highlighted thing; called when the person's use key is not the interaction owner's own E. */
  readonly use?: () => void;
  readonly mountHud: (host: HTMLElement, play: PlayHost) => PlayHud;
  readonly settings?: PlaySettingsStore;
  /** Where keys are heard. Defaults to `window`. */
  readonly keyboard?: EventTarget;
  /** What held tools and world prompts need from the walked world. Without it there are no tools or prompts. */
  readonly world?: PlayWorld;
  /** What walk features read beyond the world (pier's SEAMS 2a). With `world`, every registered walk feature mounts. */
  readonly features?: WalkFeatureWorld;
}

export interface PlaySession {
  readonly ctx: PlayContext;
  readonly play: PlayHost;
  readonly hud: PlayHud;
  readonly arrived: Promise<void>;
  /** Once per frame from the walk: notices owner and touch changes the cursor itself does not announce. */
  frame(dt?: number): void;
  /**
   * A press or release of the captured mouse. True when play took it: a seated game's input lease, or the tool in
   * hand. Otherwise the world uses it (the highlighted target).
   */
  pointer(type: 'down' | 'up', button: number, buttons: number): boolean;
  /** The use action (E, the rebound use key, a click with nothing in hand). True when a world prompt took it. */
  use(): boolean;
  /** Held tools and world prompts; null when the session has no world. */
  readonly tools: ToolRuntime | null;
  /** Walk features; null when the session has no world or no feature facts. */
  readonly features: WalkFeatureRuntime | null;
  /** Your own body is hidden from your own camera (a seated table view). */
  readonly selfHidden: boolean;
  dispose(): void;
}

interface HeldInput { readonly reason: string; readonly keys: Set<(code: string, down: boolean) => void>; readonly pointer: Set<(dx: number, dy: number, buttons: number) => void>; released: boolean }

interface KeyLike { readonly code: string; readonly repeat: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly altKey: boolean; readonly isComposing?: boolean; readonly defaultPrevented: boolean; readonly target: unknown; preventDefault(): void }

export function createPlaySession(options: PlaySessionOptions): PlaySession {
  const { controller } = options;
  const cursor = controller.cursor;
  const settings = options.settings ?? sharedPlaySettings();
  const keyboard = options.keyboard ?? window;
  let disposed = false, arriving = false;
  // Everything that holds the walk (the ledger, an arrival step, a seated game) by reason: it walks again only when
  // none is left.
  const holds = new Set<string>();
  const hold = (reason: string, on: boolean) => {
    if (on) holds.add(reason); else holds.delete(reason);
    if (!disposed) controller.hold(holds.size > 0);
  };
  const inputs: HeldInput[] = [];
  const topInput = () => inputs[inputs.length - 1];
  const hidden = new Set<symbol>();
  const requestInput = (reason: string): InputLease => {
    const held: HeldInput = { reason, keys: new Set(), pointer: new Set(), released: disposed };
    if (!disposed) {
      inputs.push(held);
      hold('input', true);
      controller.divertLook((dx, dy) => { for (const listener of [...(topInput()?.pointer ?? [])]) listener(dx, dy, 0); });
    }
    return {
      get active() { return !held.released && topInput() === held; },
      onKey(listener) { held.keys.add(listener); return () => held.keys.delete(listener); },
      onPointer(listener) { held.pointer.add(listener); return () => held.pointer.delete(listener); },
      release() {
        if (held.released) return;
        held.released = true;
        inputs.splice(inputs.indexOf(held), 1);
        if (!inputs.length) { controller.divertLook(null); hold('input', false); }
      },
    };
  };
  const hideSelf = (reason: string) => {
    const token = Symbol(reason);
    if (!disposed) hidden.add(token);
    return { release() { hidden.delete(token); } };
  };
  const cursorListeners = new Set<(view: CursorView) => void>();
  const cursorView = (): CursorView => ({
    // A place view or another owner holding the camera holds the cursor too: never "click to walk" over it.
    state: (controller.touch ? 'touch' : controller.owner !== 'walking' && cursor.mode !== 'unavailable' ? 'leased' : cursor.mode) as CursorState,
    fullscreen: cursor.fullscreen, keyboardLocked: cursor.keyboardLocked, canFullscreen: cursor.canFullscreen, canLockKeyboard: cursor.canLockKeyboard,
    ...(cursor.drifting ? { drifting: true } : {}),
  });
  let announced = '';
  const announce = () => {
    const view = cursorView(), key = JSON.stringify(view);
    if (key === announced) return;
    announced = key;
    for (const listener of [...cursorListeners]) listener(view);
  };
  const requestCursor = (reason: string): CursorLease => {
    if (disposed) return { release() {}, active: false };
    return cursor.lease(reason);
  };
  // Mounted below, once `play` exists; `closeLedger` may be asked for while the HUD mounts.
  const mountedHud: { current: PlayHud | null } = { current: null };
  const ctx: PlayContext = {
    kingdomId: options.kingdomId,
    self: options.self,
    get live() { return options.live(); },
    mode: 'walking',
    settings,
    requestCursor,
    closeLedger: () => mountedHud.current?.closeLedger(),
    requestInput,
    hideSelf,
  };
  const play: PlayHost = {
    ctx, settings,
    get cursor() { return cursorView(); },
    onCursor(listener) { cursorListeners.add(listener); return () => cursorListeners.delete(listener); },
    resume(event) {
      if (disposed || !event.isTrusted) return;
      if (mountedHud.current?.ledgerOpen) mountedHud.current.closeLedger();
      cursor.capture({ isTrusted: true, type: 'click', button: 0 });
    },
    toggleFullscreen() { void cursor.toggleFullscreen().then(announce); },
    wayHome: options.wayHome,
    ...(options.map ? { map: options.map } : {}),
    ...(options.lights ? { lights: options.lights } : {}),
    build: options.build,
    volumes: Object.freeze([...(options.volumes ?? [])]),
    cue: options.cue,
    get prompt() { const shown = tools?.prompt; return shown ? { id: shown.id, label: shown.label } : null; },
    onPrompt(listener) { return tools ? tools.onPrompt(shown => listener(shown ? { id: shown.id, label: shown.label } : null)) : () => {}; },
    usePrompt() { if (!disposed) tools?.use(); },
  };
  const tools: ToolRuntime | null = options.world ? createToolRuntime(ctx, options.world) : null;
  const features: WalkFeatureRuntime | null = options.world && options.features ? createWalkFeatures(ctx, options.world, options.features) : null;
  const hud = options.mountHud(options.host, play);
  mountedHud.current = hud;
  // The ledger takes the cursor itself through ctx.requestCursor when it opens; here it only holds the walk.
  let ledgerHeld = false;
  const stopLedger = hud.onLedger(open => {
    if (open !== ledgerHeld) { ledgerHeld = open; hold('ledger', open); }
  });
  const stopCursor = cursor.onChange(announce);
  // The person let the mouse go (the browser ate Escape, or focus left): the ledger opens, as a paused game would.
  // Seated at a game, Escape is the interaction owner's: it stands you up first, and the ledger waits for the next one.
  // The first capture lost to a drifting cursor (Firefox on X11) is not a pause: the street stays, with one calm line.
  const stopLetGo = cursor.onLetGo(why => { if (why !== 'drift' && !disposed && !arriving && !topInput()) hud.openLedger(); });

  const plain = (event: KeyLike) => !event.repeat && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditableTarget(event.target);
  // A seated game hears its keys first; Escape is never its own (the interaction owner stands you up with it).
  const toInput = (event: KeyLike, down: boolean) => {
    const held = topInput();
    if (!held || hud.ledgerOpen || event.code === 'Escape' || isEditableTarget(event.target) || (down && event.repeat)) return false;
    for (const listener of [...held.keys]) listener(event.code, down);
    return true;
  };
  const keyup = (raw: Event) => { if (!disposed) toInput(raw as unknown as KeyLike, false); };
  // Escape is heard last, in the bubble phase on the window: the top panel (a gesture panel, a place view, a seat, a
  // Forge dialog, the ledger's own book) closes first and takes the press, and only an untaken Escape reaches here.
  const escape = (raw: Event) => {
    const event = raw as unknown as KeyLike;
    if (disposed || arriving || controller.owner !== 'walking' || event.code !== 'Escape') return;
    if (event.defaultPrevented || event.repeat || hud.keyCapture) return;
    if (hud.ledgerOpen) { if (hud.escape()) event.preventDefault(); return; }
    if (topInput()) return;
    // Unlocked with the ledger closed (after Escape closed it, or a cooldown): Escape opens it again.
    if (cursor.mode !== 'locked' && cursor.mode !== 'requesting') { event.preventDefault(); hud.openLedger(); }
  };
  const keydown = (raw: Event) => {
    const event = raw as unknown as KeyLike;
    if (disposed || arriving || controller.owner !== 'walking' || event.code === 'Escape') return;
    // A key plate listening in the ledger hears every key first, the ledger key too.
    if (hud.keyCapture) return;
    if (event.code !== settings.get('keys').ledger && toInput(event, true)) return;
    const keys = settings.get('keys');
    if (event.defaultPrevented || !plain(event)) return;
    if (event.code === keys.ledger) {
      event.preventDefault();
      if (hud.ledgerOpen) hud.closeLedger(); else hud.openLedger();
      return;
    }
    if (event.code === keys.map && play.map) {
      event.preventDefault();
      hud.openLedger('map');
      return;
    }
    if (hud.ledgerOpen) return;
    if (event.code === keys.view) {
      event.preventDefault();
      settings.set({ view: settings.get('view') === 'first' ? 'third' : 'first' });
      options.cue('wood');
      return;
    }
    if (event.code === keys.fullscreen && cursor.canFullscreen) {
      event.preventDefault();
      play.toggleFullscreen();
      return;
    }
    if (event.code === keys.use) {
      // A world prompt answers first when no realm target is highlighted; E is otherwise the interaction owner's own.
      if (tools?.use()) { event.preventDefault(); (raw as Event).stopImmediatePropagation(); return; }
      if (keys.use !== 'KeyE' && options.use) { event.preventDefault(); options.use(); }
      return;
    }
    for (const binding of actionBindings()) {
      if (actionCode(settings.current, binding) !== event.code) continue;
      event.preventDefault();
      try { binding.onPress(ctx); } catch (error) { console.error(`The key binding ${binding.id} failed`, error); }
      return;
    }
  };
  // Capture, so a world prompt can take E before the interaction owner hears it.
  keyboard.addEventListener('keydown', keydown, { capture: true });
  keyboard.addEventListener('keydown', escape);
  keyboard.addEventListener('keyup', keyup);

  // Arrival steps (the mirror first) run once, holding the cursor and the walk, before the walker takes control.
  const arrived = (async () => {
    const steps = wantedArrivalSteps(ctx);
    if (!steps.length) return;
    arriving = true; hold('arrival', true);
    try {
      for (const step of steps) {
        if (disposed) return;
        const lease = cursor.lease(`arrival:${step.id}`);
        try { await step.run(options.host, ctx); } catch (error) { console.error(`The arrival step ${step.id} failed`, error); } finally { lease.release(); }
      }
    } finally {
      arriving = false;
      hold('arrival', false);
    }
  })();

  return {
    ctx, play, hud, arrived,
    tools, features,
    frame(dt = 0) {
      if (disposed) return;
      announce();
      tools?.pause(hud.ledgerOpen || arriving || !!topInput() || controller.owner !== 'walking');
      tools?.frame(dt);
      features?.frame(dt, performance.now());
    },
    pointer(type, button, buttons) {
      if (disposed || hud.ledgerOpen) return false;
      const held = topInput();
      if (held) { for (const listener of [...held.pointer]) listener(0, 0, buttons); return true; }
      return tools?.pointer(type, button) ?? false;
    },
    use() { return !disposed && !!tools?.use(); },
    get selfHidden() { return hidden.size > 0; },
    dispose() {
      if (disposed) return;
      disposed = true;
      keyboard.removeEventListener('keydown', keydown, { capture: true });
      keyboard.removeEventListener('keydown', escape);
      keyboard.removeEventListener('keyup', keyup);
      for (const held of inputs) held.released = true;
      inputs.length = 0; hidden.clear(); holds.clear();
      controller.divertLook(null);
      stopLedger(); stopCursor(); stopLetGo();
      features?.dispose();
      tools?.dispose();
      cursorListeners.clear();
      hud.dispose();
      controller.hold(false);
    },
  };
}
