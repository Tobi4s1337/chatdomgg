import type { AudioCue, AudioCueOptions } from '@chatdom/audio';
import type { RealmInteractionAction } from '@chatdom/shared/realm';
import type { InteractionCueKind, InteractionFeedback } from './ports';

/** The kingdom's one sound owner (`createKingdomSound` in `apps/web/src/kingdom/sound.ts`), or anything with its `cue`. */
export interface InteractionSoundBus {
  cue(kind: AudioCue, options?: AudioCueOptions): boolean;
}

/** What the thing you used sounds like when the room says yes: a log or chair takes your weight, iron rings, a door. */
const SETTLES: Readonly<Record<RealmInteractionAction, AudioCueOptions & { readonly kind: AudioCue }>> = {
  sit: { kind: 'place', material: 'wood' },
  tavern: { kind: 'place', material: 'wood' },
  stand: { kind: 'remove', material: 'wood' },
  forge: { kind: 'place', material: 'metal' },
  'enter-home': { kind: 'wood', ui: 'wood' },
  'exit-home': { kind: 'wood', ui: 'wood' },
};

/**
 * Interaction cues on the existing kingdom bus, with finished families only: the brass key on the press, the place's
 * own material when the room accepts, parchment when it refuses or cannot answer. Nothing is cued before the room
 * says so, and a locked or muted bus simply stays quiet.
 */
export function interactionSound(bus: InteractionSoundBus): InteractionFeedback {
  return {
    cue(kind: InteractionCueKind, action: RealmInteractionAction) {
      if (kind === 'pending') bus.cue('wood', { ui: 'brass' });
      else if (kind === 'accepted') { const { kind: cue, ...options } = SETTLES[action]; bus.cue(cue, options); }
      else bus.cue('wood', { ui: 'parchment' });
    },
  };
}
