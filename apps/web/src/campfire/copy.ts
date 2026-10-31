import type { CampfirePhaseId, CampfirePublicView, DuskCourtRole } from './ports';

/* The campfire's words. Plain, warm and exact: only what the public view actually says. */

export const PHASE_NAMES: Record<CampfirePhaseId, string> = {
  dusk: 'Dusk', night: 'Night', dawn: 'Dawn', discussion: 'Discussion', ballot: 'The ballot', runoff: 'The runoff', verdict: 'The verdict', ending: 'The last word',
};

export const ROLE_NAMES: Record<DuskCourtRole, string> = { snuffer: 'Snuffer', watchman: 'Watchman', lamplighter: 'Lamplighter', fool: 'Fool', townsfolk: 'Townsfolk' };

export const ROLE_LINES: Record<DuskCourtRole, string> = {
  snuffer: 'Each night the Snuffers choose one lantern to put out. They win once they match everyone else around the fire.',
  watchman: 'Each night asks after one person, and learns privately at dawn whether they are a Snuffer.',
  lamplighter: 'Each night guards one lantern, even their own, though never the same one two nights running.',
  fool: 'Has no night power. Wins alone if the circle banishes them by ballot.',
  townsfolk: 'No night power, and the same voice and the same vote as anyone.',
};

const PHASE_LINES: Record<CampfirePhaseId, string> = {
  dusk: 'Every seat is dealt a sealed card.',
  night: 'Every card is sealed. Choices are private and land together at dawn.',
  dawn: 'The night is told as it happened.',
  discussion: 'Talk it through. Everything said at the fire is public.',
  ballot: 'Each living player votes once, or abstains.',
  runoff: 'One more ballot between the tied. A second tie spares everyone.',
  verdict: 'The circle has decided.',
  ending: 'Every card is turned over.',
};

/** mm:ss, never negative; hours never occur in a finite Dusk Court phase. */
export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export interface StateWords { readonly eyebrow: string; readonly title: string; readonly line: string }

/** What the fire is doing, for the plate under the circle. */
export function stateWords(view: CampfirePublicView): StateWords {
  const textOnly = view.voice.mode === 'text';
  switch (view.lifecycle) {
    case 'closed':
      return { eyebrow: 'The fire is banked', title: 'No gathering tonight', line: 'The Magistrate has closed the campfire. The logs will be here when it is lit again.' };
    case 'gathering':
      return { eyebrow: 'The fire is lit', title: 'Sit a while', line: 'No game yet. The Magistrate can open Dusk Court whenever the circle is ready.' };
    case 'seating': {
      const seating = view.seating!;
      const left = seating.seats - seating.accepted;
      return { eyebrow: 'Dusk Court is open', title: `${seating.accepted} of ${seating.seats} seats taken`, line: left > 0 ? `Type !join in chat to enter the draw for ${left === 1 ? 'the last seat' : `the ${left} seats left`}. Every name has the same chance.` : 'Every seat is taken. The game begins when the Magistrate starts it.' };
    }
    case 'playing':
    case 'paused': {
      const phase = view.phase!;
      const voice = textOnly ? ' This fire talks in chat tonight: every seat plays by text, with the same say.' : '';
      return { eyebrow: `Dusk Court · Day ${phase.day}${view.lifecycle === 'paused' ? ' · paused' : ''}`, title: PHASE_NAMES[phase.id], line: view.lifecycle === 'paused' ? 'The fire waits for the stream to return. Every timer is held.' : `${PHASE_LINES[phase.id]}${phase.id === 'night' || phase.id === 'dusk' ? voice : ''}` };
    }
    case 'ended': {
      const outcome = view.result!.outcome;
      const title = outcome === 'town' ? 'The town keeps its lanterns' : outcome === 'snuffers' ? 'The Snuffers have the night' : outcome === 'fool' ? 'The Fool is banished, and wins' : 'Eight days, and no one prevailed';
      return { eyebrow: `Dusk Court · Day ${view.result!.day}`, title, line: 'Thank you for sitting at the fire. The circle returns to the same clearing.' };
    }
    case 'interrupted':
      return { eyebrow: 'Dusk Court', title: 'The night was interrupted', line: 'This game ends without a winner. Thank you for sitting at the fire.' };
  }
}

/** The Gallery's invitation, only while its suspicion window is open. */
export function galleryWords(view: CampfirePublicView): string | null {
  if (!view.gallery?.open) return null;
  return 'Watching on Twitch? Type !sus and a name. Suspicion glows by their log; only the seated vote.';
}

export function remaining(view: CampfirePublicView, atMs: number): number | null {
  if (view.lifecycle === 'paused') return view.phase?.pausedRemainingMs ?? null;
  if (view.lifecycle === 'playing' && view.phase?.deadlineMs) return view.phase.deadlineMs - atMs;
  if (view.lifecycle === 'seating' && view.seating?.deadlineMs) return view.seating.deadlineMs - atMs;
  return null;
}
