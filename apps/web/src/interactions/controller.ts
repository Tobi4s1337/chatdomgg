import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmInteractionAction } from '@chatdom/shared/realm';
import type { InteractionActor, InteractionRecord } from '../../../../packages/world/src/interactions';
import { isClickPress } from '../walk/input/pointer';
import { QUIET } from './copy';
import { bindUseKey, isOtherControl, isTypingTarget } from './keys';
import type { PromptMount, PromptPlacement } from './Prompt';
import type { GamepadLike, InteractionCamera, InteractionPlaces, InteractionView, LookFrame, PointerRay } from './ports';
import { pickInteraction, selectInteraction, type InteractionSelection } from './select';
import type { InteractionSession, InteractionSnapshot } from './session';
import { PROMPT_LIFT, promptView, type PromptView } from './view';

/**
 * The browser's one interaction owner for a kingdom view: the per-frame look, click/tap/gamepad picks through the
 * same registry, E, Escape, the carved prompt and the camera token. It hints and asks; the room decides. It never
 * moves the camera itself: an accepted seat, table or Forge hands the framing to that place (walk-camera's
 * `release()`), and every way of letting go hands it straight back (`resume()`).
 */

/** Gamepad buttons in the standard mapping: West (X / Square) uses, East (B / Circle) leaves. South stays jump. */
export const GAMEPAD_USE = 2;
export const GAMEPAD_LEAVE = 1;
/** A tap on something out of reach says so this long, quietly. */
export const HINT_MS = 1800;
const LEAVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface InteractionFrame {
  readonly now: number;
  /** Feet as drawn this frame and the camera's view direction. */
  readonly look: LookFrame;
  readonly records: readonly InteractionRecord[];
  readonly world: CollisionWorld | null;
  /** Who is looking. The interaction state comes from the session, never from here. */
  readonly actor: Omit<InteractionActor, 'state'>;
  /** CSS px of a world point inside `host`, or null when it is behind the camera. */
  project(point: Vec3): PromptPlacement | null;
  /** The camera ray through CSS px of `surface`, or null. Without it clicks and taps on the world pick nothing. */
  ray?(x: number, y: number): PointerRay | null;
}
export interface InteractionControllerOptions {
  /** Draws the prompt; `mountInteractionController` passes the carved prompt in the kingdom root. */
  readonly prompt: (onUse: () => void) => PromptMount;
  /** The world surface (canvas): clicks and taps on it pick targets. */
  readonly surface: Pick<HTMLElement, 'addEventListener' | 'removeEventListener' | 'getBoundingClientRect'>;
  readonly session: InteractionSession;
  /** Walk-camera's controller (`release`/`resume`/`owner`). */
  readonly camera: InteractionCamera;
  readonly places?: InteractionPlaces;
  /** Default window. */
  readonly keyboard?: EventTarget;
  /** Default document. */
  readonly page?: { readonly hidden: boolean } & EventTarget;
  /** Default `navigator.getGamepads`. */
  readonly gamepads?: () => readonly (GamepadLike | null)[];
}
export interface InteractionControllerDebug {
  focus: string | null;
  action: RealmInteractionAction | null;
  prompt: Pick<PromptView, 'tone' | 'words' | 'actionable'> | null;
  self: { mode: string; targetId: string | null };
  seats: InteractionSnapshot['seats'];
  /** The place view this controller holds the camera for, if any. */
  held: { targetId: string; action: RealmInteractionAction } | null;
  /** The home whose interior presentation is open because the room says you are inside it. */
  home: string | null;
  /** Use (key, tap, click or button) → pending prompt in the DOM, in ms. Local only, not the room. */
  localResponse: number | null;
  /** Last pick from a click or tap: the target it meant and whether it was used. */
  pick: { targetId: string; used: boolean } | null;
}
export interface InteractionController {
  /** Once per rendered frame, after the camera is placed. */
  frame(frame: InteractionFrame): void;
  /** Use the focused target (what E, a tap on the prompt or the gamepad do). False when nothing was sent. */
  use(): boolean;
  /** Escape / Leave: let go of the camera at once, ask to stand if seated, forget a pending request. */
  leave(): boolean;
  readonly debug: InteractionControllerDebug;
  /** Unbinds every listener, closes a held view, hands the camera back and removes the prompt. */
  dispose(): void;
}

interface Held { readonly targetId: string; readonly action: RealmInteractionAction; view: InteractionView | null; live: boolean }

export function createInteractionController(options: InteractionControllerOptions): InteractionController {
  const { session, camera } = options;
  const keyboard = options.keyboard ?? window;
  const page = options.page ?? document;
  const gamepads = options.gamepads ?? (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
  let last: InteractionFrame | null = null;
  let selection: InteractionSelection = { focus: null, quiet: null };
  let held: Held | null = null;
  let hint: { record: InteractionRecord; reason: keyof typeof QUIET; until: number } | null = null;
  let pressedAt: number | null = null;
  let disposed = false;
  const pads = new Map<number, boolean[]>();
  let press: { id: number; x: number; y: number; at: number } | null = null;
  const debug: InteractionControllerDebug = { focus: null, action: null, prompt: null, self: { mode: 'standing', targetId: null }, seats: [], held: null, home: null, localResponse: null, pick: null };
  let home: { readonly plotId: string; readonly view: { close(): void } | null } | null = null;

  const prompt = options.prompt(() => { use(); });

  /** Interactions own input while walking, and while holding the camera for a seat. Build mode, a menu: not ours. */
  const active = () => !disposed && (held !== null ? held.action !== 'forge' : camera.owner === 'walking');
  const actorOf = (frame: InteractionFrame, snapshot: InteractionSnapshot): InteractionActor => ({ ...frame.actor, state: snapshot.self });

  function releaseHeld(): void {
    const token = held;
    if (!token) return;
    held = null; token.live = false;
    token.view?.close();
    if (camera.owner === 'released') camera.resume();
    debug.held = null;
  }
  /**
   * The home's interior presentation follows the room's word only: open while the self state says you are at home on
   * that plot (including after a reload), closed on the way out, on a disconnect and on dispose. It holds no camera.
   */
  function reconcileHome(snapshot: InteractionSnapshot): void {
    const plotId = !disposed && snapshot.connected && snapshot.self.mode === 'interior' ? snapshot.self.plotId : null;
    if (home?.plotId === plotId) return;
    home?.view?.close();
    home = null;
    if (plotId) {
      const door = last?.records.find(record => record.target.kind === 'home-door' && record.target.plotId === plotId) ?? null;
      home = { plotId, view: options.places?.home?.({ plotId, door }) ?? null };
    }
    debug.home = home?.plotId ?? null;
  }
  /** A seat's view lasts exactly as long as the room says you sit there; anything else (stand, revoke, host end) lets go. */
  function reconcile(snapshot: InteractionSnapshot): void {
    reconcileHome(snapshot);
    if (!held) return;
    if (!snapshot.connected) { releaseHeld(); return; }
    if ((held.action === 'sit' || held.action === 'tavern') && !(snapshot.self.mode === 'seated' && snapshot.self.targetId === held.targetId)) releaseHeld();
  }

  function paint(): void {
    const frame = last;
    const snapshot = session.snapshot();
    debug.self = { mode: snapshot.self.mode, targetId: snapshot.self.targetId }; debug.seats = snapshot.seats;
    if (!frame || !active()) { prompt.update(null, null); debug.prompt = null; return; }
    let view = promptView(selection, snapshot, frame.records);
    if (hint && hint.until > frame.now && (!view || view.tone === 'quiet') && snapshot.phase.kind === 'idle' && !selection.focus) {
      const p = hint.record.target.position;
      view = { tone: 'quiet', words: QUIET[hint.reason], caption: null, actionable: false, targetId: hint.record.target.id, anchor: [p[0], p[1] + PROMPT_LIFT, p[2]] };
    }
    prompt.update(view, view ? frame.project(view.anchor) : null);
    debug.prompt = view ? { tone: view.tone, words: view.words, actionable: view.actionable } : null;
    if (pressedAt !== null && view?.tone === 'pending') { debug.localResponse = performance.now() - pressedAt; pressedAt = null; }
  }

  function send(targetId: string, action: RealmInteractionAction): boolean {
    pressedAt = performance.now();
    // Standing lets go of the seat's view at once; the room's answer is still what moves the body.
    if (action === 'stand') releaseHeld();
    const sent = session.request(targetId, action);
    if (!sent) pressedAt = null;
    paint();
    return sent;
  }
  function use(): boolean {
    if (!active()) return false;
    const focus = selection.focus;
    return focus ? send(focus.record.target.id, focus.action) : false;
  }
  function leave(): boolean {
    if (disposed) return false;
    const snapshot = session.snapshot();
    const hadView = held !== null;
    releaseHeld();
    if (snapshot.phase.kind === 'pending') {
      // Already getting up: the camera is back, the room's answer is awaited honestly.
      if (snapshot.phase.action !== 'stand') session.abandon();
      paint();
      return true;
    }
    if (snapshot.connected && snapshot.self.mode === 'seated' && snapshot.self.targetId) return send(snapshot.self.targetId, 'stand') || hadView;
    paint();
    return hadView;
  }

  const stopAccepted = session.onAccepted(accepted => {
    if (disposed || (accepted.action !== 'sit' && accepted.action !== 'tavern' && accepted.action !== 'forge')) return;
    const record = last?.records.find(r => r.target.id === accepted.targetId);
    // Another surface already holds the camera (build mode, a menu): the room's state stands, the view is not forced.
    if (!record || held || camera.owner !== 'walking') return;
    if (accepted.action !== 'forge' && !(accepted.state.mode === 'seated' && accepted.state.targetId === accepted.targetId)) return;
    const token: Held = { targetId: accepted.targetId, action: accepted.action, view: null, live: true };
    held = token;
    const view = options.places?.open({ action: accepted.action, record }, () => {
      if (!token.live) return;
      token.view = null;
      if (held === token) releaseHeld();
    }) ?? null;
    if (!view || !token.live) { if (held === token) { held = null; token.live = false; view?.close(); } paint(); return; }
    token.view = view;
    camera.release();
    debug.held = { targetId: token.targetId, action: token.action };
    paint();
  });
  const stopSession = session.subscribe(snapshot => { reconcile(snapshot); paint(); });

  const stopKey = bindUseKey(() => { use(); }, { keyboard, page, owned: active });
  const keydown = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
    // An Escape something else already handled (a Forge dialog, a menu) is theirs.
    if (event.code === 'Escape') { if (!event.defaultPrevented && leave()) event.preventDefault(); return; }
    // Walking away from a seat gets you up: the first step asks the room to stand. At the anvil it closes the visit.
    if (!LEAVE_CODES.has(event.code) || isOtherControl(event.target)) return;
    if (held?.action === 'forge') { leave(); return; }
    if (active() && session.snapshot().self.mode === 'seated' && session.snapshot().phase.kind === 'idle') leave();
  };
  // Leaving the tab lets go of what was pending; an accepted seat or open Forge stays (alt-tab to copy a line).
  // A pending stand stays: the seat's view is already gone and the room's answer is only awaited.
  const letGo = () => { press = null; const phase = session.snapshot().phase; if (phase.kind === 'pending' && phase.action !== 'stand') session.abandon(); };
  const visibility = () => { if (page.hidden) letGo(); };
  keyboard.addEventListener('keydown', keydown);
  keyboard.addEventListener('blur', letGo);
  page.addEventListener('visibilitychange', visibility);

  // Clicks and taps on the world: a short press (walk-camera's rule) picks through the same registry and rules.
  const down = (raw: Event) => {
    const event = raw as PointerEvent;
    press = event.isPrimary && (event.pointerType !== 'mouse' || event.button === 0) ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp } : null;
  };
  const up = (raw: Event) => {
    const event = raw as PointerEvent;
    const start = press; press = null;
    if (!start || start.id !== event.pointerId || !isClickPress(event.clientX - start.x, event.clientY - start.y, event.timeStamp - start.at)) return;
    pickAt(event.clientX, event.clientY);
  };
  const cancel = () => { press = null; };
  function pickAt(clientX: number, clientY: number): void {
    const frame = last;
    if (!frame?.ray || !active()) return;
    const rect = options.surface.getBoundingClientRect();
    const ray = frame.ray(clientX - rect.left, clientY - rect.top);
    if (!ray) return;
    const snapshot = session.snapshot();
    const picked = pickInteraction({ ray, feet: frame.look.feet, records: frame.records, world: frame.world, actor: actorOf(frame, snapshot), seats: snapshot.seats });
    if (!picked) return;
    if (picked.candidate) {
      debug.pick = { targetId: picked.record.target.id, used: true };
      hint = null;
      send(picked.record.target.id, picked.candidate.action);
      return;
    }
    debug.pick = { targetId: picked.record.target.id, used: false };
    if (picked.hold) { hint = { record: picked.record, reason: picked.hold, until: frame.now + HINT_MS }; paint(); }
  }
  options.surface.addEventListener('pointerdown', down);
  options.surface.addEventListener('pointerup', up);
  options.surface.addEventListener('pointercancel', cancel);

  function pollPads(): void {
    const list = gamepads();
    for (let index = 0; index < list.length; index++) {
      const pad = list[index];
      if (!pad?.connected) { pads.delete(index); continue; }
      const was = pads.get(index) ?? [];
      const now = pad.buttons.map(button => button.pressed);
      pads.set(index, now);
      if (now[GAMEPAD_USE] && !was[GAMEPAD_USE]) use();
      if (now[GAMEPAD_LEAVE] && !was[GAMEPAD_LEAVE] && (active() || held?.action === 'forge')) leave();
    }
  }

  return {
    frame(frame) {
      if (disposed) return;
      last = frame;
      held?.view?.frame?.(frame.now);
      session.tick(frame.now);
      pollPads();
      const snapshot = session.snapshot();
      reconcile(snapshot);
      if (hint && hint.until <= frame.now) hint = null;
      selection = active()
        ? selectInteraction({ frame: frame.look, records: frame.records, world: frame.world, actor: actorOf(frame, snapshot), seats: snapshot.seats, previous: selection.focus?.record.target.id ?? null })
        : { focus: null, quiet: null };
      debug.focus = selection.focus?.record.target.id ?? null; debug.action = selection.focus?.action ?? null;
      paint();
    },
    use,
    leave,
    debug,
    dispose() {
      if (disposed) return;
      releaseHeld();
      disposed = true;
      reconcileHome(session.snapshot());
      stopKey(); stopAccepted(); stopSession();
      keyboard.removeEventListener('keydown', keydown);
      keyboard.removeEventListener('blur', letGo);
      page.removeEventListener('visibilitychange', visibility);
      options.surface.removeEventListener('pointerdown', down);
      options.surface.removeEventListener('pointerup', up);
      options.surface.removeEventListener('pointercancel', cancel);
      prompt.dispose();
    },
  };
}
