import type { RealmInteractionState } from '@chatdom/shared/realm';
import type { InteractionAccepted, InteractionSnapshot } from '../interactions/session';

/** A fresh authoritative bootstrap may restore a chair once the local interaction owner is ready. */
export function createRetainedSeatRestore(): {
  witness(state: RealmInteractionState): void;
  clear(): void;
  next(snapshot: InteractionSnapshot, owner: string): InteractionAccepted | null;
} {
  let targetId: string | null = null;
  return {
    witness(state) { targetId = state.mode === 'seated' && state.targetId ? state.targetId : null; },
    clear() { targetId = null; },
    next(snapshot, owner) {
      if (!targetId) return null;
      if (snapshot.phase.kind !== 'idle' && snapshot.phase.action === 'stand') {
        targetId = null;
        return null;
      }
      if (!snapshot.connected) return null;
      if (snapshot.self.mode !== 'seated' || snapshot.self.targetId !== targetId) {
        targetId = null;
        return null;
      }
      if (snapshot.phase.kind !== 'idle' || owner !== 'walking') return null;
      const accepted: InteractionAccepted = { requestId: 'restored-seat', targetId, action: 'tavern', state: snapshot.self };
      targetId = null;
      return accepted;
    },
  };
}
