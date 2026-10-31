import type { Vec3 } from '@chatdom/shared';
import type { RealmIntent, RealmPrivateMessage, RealmReceipt, RealmTransientMessage } from '@chatdom/shared/realm';

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

/** The existing audio bus's small UI cues. No new AudioContext and never a microphone prompt. */
export interface InteractionFeedback {
  cue(kind: 'pending' | 'accepted' | 'refused'): void;
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
