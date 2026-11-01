import type { Vec3 } from '@chatdom/shared';
import type { RealmInteractionAction, RealmIntent, RealmPrivateMessage, RealmReceipt, RealmTransientMessage } from '@chatdom/shared/realm';
import type { InteractionRecord } from '../../../../packages/world/src/interactions';

/**
 * Browser-side seams. Each is satisfied by an existing owner's export; the integrator binds them (README).
 * Nothing the browser computes here is authority: the room re-decides every request from its own state.
 */

export type InteractIntent = Extract<RealmIntent, { type: 'interact' }>;
export type SeatsMessage = Extract<RealmTransientMessage, { type: 'seats' }>;
export type InteractionMessage = Extract<RealmPrivateMessage, { type: 'interaction' }>;

/**
 * The walk-camera controller's camera/input token (`createWalkController` from `apps/web/src/walk`, spec 35):
 * `release()` hands camera and input to a seated framing, the Forge or a table; `resume()` takes them back.
 * The prompt never creates a rig of its own.
 */
export interface InteractionCamera {
  release(): void;
  resume(): void;
  readonly owner: 'walking' | 'released' | 'disposed';
}

/** The connected realm client: one strict intent out, receipts and room messages in. */
export interface InteractionRealm {
  send(intent: InteractIntent): void;
}

/** What a cue answers: the press itself, the room's yes, its no, or its "not now". */
export type InteractionCueKind = 'pending' | 'accepted' | 'refused' | 'unavailable';
/** The existing audio bus's small UI cues (`interactionSound` adapts the kingdom's). No new AudioContext, no microphone. */
export interface InteractionFeedback {
  cue(kind: InteractionCueKind, action: RealmInteractionAction): void;
}

/**
 * A place that takes the framing once the room accepted its action: the campfire's seated view, the table host's
 * table, the existing Forge (IN04 binds the actual producers). `open` returns the place's own close, or null when
 * that place has no view of its own, in which case the walking camera simply stays. `closed` is for the place to
 * call when it closes itself (Forge closed, table left); the controller then hands the camera back.
 */
export interface InteractionPlaces {
  open(accepted: { readonly action: RealmInteractionAction; readonly record: InteractionRecord }, closed: () => void): InteractionView | null;
  /**
   * The room says you are at home on this plot (after "Go inside", or a reload that put you back inside). The home's
   * interior presentation runs for exactly as long as that holds; walking and the walking camera carry on. `door` is
   * the record you came in by, with the installed home revision. Null when no interior presentation is installed.
   */
  home?(home: { readonly plotId: string; readonly door: InteractionRecord | null }): { close(): void } | null;
}
export interface InteractionView {
  /**
   * The place's tick while it holds the camera (its framing eases the scene camera here). Called first in the
   * controller's frame, so the look, picks and the prompt use the camera that draws this frame.
   */
  frame?(now: number): void;
  /** Close presentation only. Never cancels durable work (a Forge request in flight, a game in progress). */
  close(): void;
}

/** A camera ray in world space, from the scene's camera through a point on the surface. */
export interface PointerRay {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** The parts of the Gamepad API the controller reads, polled once per frame. */
export interface GamepadLike {
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean }[];
}

/**
 * What the selector needs from this frame: the authoritative-looking feet of the local body (predicted or drawn)
 * and the camera's view direction. Neither crosses the wire.
 */
export interface LookFrame {
  readonly feet: Vec3;
  /** The camera's forward vector in world space; only its horizontal part is used. */
  readonly forward: Vec3;
}

/** Room deliveries the session consumes, exactly as `RealmRoomHandle.bindTransient`/private send them. */
export type InteractionInbound =
  | { readonly type: 'receipt'; readonly receipt: RealmReceipt }
  | InteractionMessage
  | SeatsMessage;
