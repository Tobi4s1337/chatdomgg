import type { RealmInteractionAction, RealmInteractionState, RealmReceipt, RealmSeat } from '@chatdom/shared/realm';
import { STANDING } from '../../../../packages/world/src/interactions';
import type { InteractionFeedback, InteractionInbound, InteractionRealm, InteractionMessage } from './ports';

/**
 * The local side of one request at a time. E sends exactly one strict intent and shows pending at once; the
 * room's receipt or self state decides what happened. Nothing here claims success before the room says so.
 */

/** How long a refusal stays readable before the prompt returns to the look. */
export const REFUSAL_MS = 3200;
/** A request the room never answers stops blocking E after this long and says so honestly. */
export const PENDING_LIMIT_MS = 8000;
/** Said when the room has not answered within `PENDING_LIMIT_MS`. */
export const UNANSWERED = 'The kingdom has not answered yet. Nothing is assumed.';

export type InteractionPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending'; readonly requestId: string; readonly targetId: string; readonly action: RealmInteractionAction; readonly since: number }
  /** The room's no (`refused`), or its "not now" (`unavailable`: a missing host, a closed room, no answer). */
  | { readonly kind: 'refused'; readonly outcome: 'refused' | 'unavailable'; readonly requestId: string; readonly targetId: string; readonly action: RealmInteractionAction; readonly message: string; readonly at: number };

export interface InteractionAccepted {
  readonly requestId: string; readonly targetId: string; readonly action: RealmInteractionAction; readonly state: RealmInteractionState;
}
export interface InteractionSnapshot {
  readonly connected: boolean;
  readonly writerEpoch: string | null;
  readonly phase: InteractionPhase;
  /** Self state as the room last delivered it. */
  readonly self: RealmInteractionState;
  readonly seats: readonly RealmSeat[];
  readonly seatsRevision: number;
}
export interface InteractionSession {
  /** One E press or tap. False when a request is still pending, nothing is connected, or the press is dropped. */
  request(targetId: string, action: RealmInteractionAction): boolean;
  receive(message: InteractionInbound): void;
  /** Advance local timers (refusal fade, unanswered request). */
  tick(now: number): void;
  /**
   * Escape/blur/Leave: forget the pending request locally. Its reply still updates self state truthfully but can
   * never fire `onAccepted`, so a late reply does not take the camera back.
   */
  abandon(): void;
  connect(writerEpoch: string): void;
  /** Transport dropped or authority unknown: no actionable UI, nothing pending, no claim that the room agreed. */
  disconnect(): void;
  snapshot(): InteractionSnapshot;
  subscribe(listener: (snapshot: InteractionSnapshot) => void): () => void;
  /** Accepted outcomes of requests still owned by this session (not abandoned). */
  onAccepted(listener: (accepted: InteractionAccepted) => void): () => void;
}

export function createInteractionSession(options: {
  readonly realm: InteractionRealm;
  readonly clock: () => number;
  /** Request IDs must be realm tokens and unique per person; the default is time + counter. */
  readonly nextId?: () => string;
  readonly feedback?: InteractionFeedback;
}): InteractionSession {
  let counter = 0;
  const nextId = options.nextId ?? (() => `i${Math.floor(options.clock()).toString(36)}-${(++counter).toString(36)}`);
  let state: InteractionSnapshot = { connected: false, writerEpoch: null, phase: { kind: 'idle' }, self: STANDING, seats: [], seatsRevision: -1 };
  const listeners = new Set<(snapshot: InteractionSnapshot) => void>();
  const accepted = new Set<(accepted: InteractionAccepted) => void>();
  const set = (next: Partial<InteractionSnapshot>) => { state = { ...state, ...next }; for (const listener of listeners) listener(state); };

  function adoptSelf(message: Pick<InteractionMessage, 'writerEpoch' | 'state'>): boolean {
    if (message.writerEpoch !== state.writerEpoch) return false;
    // Duplicate or outdated revisions are dropped; a reconnect snapshot of the same revision changes nothing.
    if (state.self !== STANDING && message.state.revision <= state.self.revision) return false;
    set({ self: message.state });
    return true;
  }
  function settle(receipt: RealmReceipt): void {
    const phase = state.phase;
    const mine = phase.kind === 'pending' && phase.requestId === receipt.id;
    if (receipt.status === 'applied') {
      if (receipt.writerEpoch !== state.writerEpoch) return;
      if (receipt.state.revision >= state.self.revision) set({ self: receipt.state });
      if (mine) {
        set({ phase: { kind: 'idle' } });
        options.feedback?.cue('accepted', phase.action);
        const outcome = { requestId: receipt.id, targetId: phase.targetId, action: phase.action, state: receipt.state };
        for (const listener of accepted) listener(outcome);
      }
      return;
    }
    if (receipt.status === 'refused' || receipt.status === 'unavailable') {
      if (!mine) return;
      set({ phase: { kind: 'refused', outcome: receipt.status, requestId: receipt.id, targetId: phase.targetId, action: phase.action, message: receipt.message, at: options.clock() } });
      options.feedback?.cue(receipt.status, phase.action);
    }
  }

  return {
    request(targetId, action) {
      if (!state.connected || state.phase.kind === 'pending') return false;
      const requestId = nextId();
      set({ phase: { kind: 'pending', requestId, targetId, action, since: options.clock() } });
      options.feedback?.cue('pending', action);
      options.realm.send({ version: 1, type: 'interact', id: requestId, targetId, action });
      return true;
    },
    receive(message) {
      if (!state.connected) return;
      if (message.type === 'receipt') settle(message.receipt);
      else if (message.type === 'interaction') adoptSelf(message);
      else if (message.writerEpoch === state.writerEpoch && message.revision > state.seatsRevision) set({ seats: message.seats, seatsRevision: message.revision });
    },
    tick(now) {
      const phase = state.phase;
      if (phase.kind === 'refused' && now - phase.at >= REFUSAL_MS) set({ phase: { kind: 'idle' } });
      if (phase.kind === 'pending' && now - phase.since >= PENDING_LIMIT_MS) {
        set({ phase: { kind: 'refused', outcome: 'unavailable', requestId: phase.requestId, targetId: phase.targetId, action: phase.action, message: UNANSWERED, at: now } });
        options.feedback?.cue('unavailable', phase.action);
      }
    },
    abandon() {
      const phase = state.phase;
      // The request stays with the room; only this view lets go of it.
      if (phase.kind !== 'idle') set({ phase: { kind: 'idle' } });
    },
    connect(writerEpoch) {
      // A new writer epoch is a new room: earlier self state and seats belong to the old one.
      if (writerEpoch !== state.writerEpoch) set({ connected: true, writerEpoch, self: STANDING, seats: [], seatsRevision: -1, phase: { kind: 'idle' } });
      else set({ connected: true });
    },
    disconnect() {
      set({ connected: false, phase: { kind: 'idle' } });
    },
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onAccepted(listener) { accepted.add(listener); return () => { accepted.delete(listener); }; },
  };
}
