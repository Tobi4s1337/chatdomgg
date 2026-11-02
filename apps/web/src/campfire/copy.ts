import { DUSK_COURT, type CampfireFrame, type CampfireSelf, type DuskCourtRole, type DuskCourtView } from '@chatdom/shared';

/* The fire's words. Plain, warm and exact: only what the frame and your own card say. */

export const ROLE_NAMES: Record<DuskCourtRole, string> = { wolf: 'Wolf', watchman: 'Watchman', townsfolk: 'Townsfolk' };

export const ROLE_LINES: Record<DuskCourtRole, string> = {
  wolf: 'Each night, tap one lantern to snuff it. You win when the Wolves equal everyone else still lit.',
  watchman: 'Each night, ask the fire about one person. At dawn it tells you, and only you, whether they are a Wolf.',
  townsfolk: 'No night tap. Talk, watch the lanterns and vote the Wolf out.',
};

/** The rules on one carved card. */
export const RULES: readonly { readonly mark: 'wolf' | 'watchman' | 'lantern'; readonly title: string; readonly line: string }[] = [
  { mark: 'wolf', title: 'The Wolf', line: `One of the circle (two from ${DUSK_COURT.secondWolfAt} players). Each night they snuff a lantern.` },
  { mark: 'watchman', title: 'The Watchman', line: 'Each night they ask the fire about one person, and learn alone if that person is a Wolf.' },
  { mark: 'lantern', title: 'The lanterns', line: 'A snuffed lantern stays in the circle, dark: it watches and no longer votes. By day the circle talks, then votes; the most votes is sent away, a tie sends nobody.' },
];
export const RULES_WIN = `The town wins when every Wolf is out. The Wolves win when they equal the rest, or after night ${DUSK_COURT.nights}.`;

/** mm:ss, never negative. */
export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const nameAt = (frame: CampfireFrame | null, seat: number | null): string | null => {
  if (seat === null || !frame) return null;
  return frame.court?.players.find(p => p.seat === seat)?.name ?? frame.seated.find(s => s.seat === seat)?.name ?? null;
};

export interface PhaseWords { readonly eyebrow: string; readonly title: string; readonly line: string }

const RESULT_TITLES = {
  caught: 'The town has found its Wolf', outnumbered: 'The Wolves have the night', lanterns: 'The lanterns ran out', left: 'The round is over',
} as const;

function resultWords(court: DuskCourtView): PhaseWords {
  const result = court.result;
  const wolves = court.players.filter(p => p.role === 'wolf').map(p => p.name);
  const named = wolves.length === 0 ? '' : wolves.length === 1 ? `${wolves[0]} was the Wolf.` : `${wolves.join(' and ')} were the Wolves.`;
  if (!result) return { eyebrow: 'Dusk Court', title: 'The round is over', line: named };
  const line = result.reason === 'caught' ? `${named} The town wins.`
    : result.reason === 'outnumbered' ? `${named} They equal everyone still lit, and win.`
    : result.reason === 'lanterns' ? `Night ${DUSK_COURT.nights} has passed with a Wolf still in the circle. ${named} The Wolves win.`
    : `Too few are left at the fire to go on. ${named} Nobody wins this one.`;
  return { eyebrow: 'Dusk Court', title: RESULT_TITLES[result.reason], line: line.trim() };
}

/** What the fire is doing, for the plate. Public: never reads a card. */
export function phaseWords(frame: CampfireFrame | null): PhaseWords {
  if (!frame) return { eyebrow: 'The campfire', title: 'The fire is lit', line: 'Warm yourself a while.' };
  const court = frame.court;
  if (!court) {
    const sitting = frame.seated.filter(s => s.seat !== 0).length;
    const line = sitting >= DUSK_COURT.minPlayers ? 'Enough are sitting for a round of Dusk Court. Anyone on a log can ask the fire.'
      : `Dusk Court needs ${DUSK_COURT.minPlayers} on the logs. Sit down and wait for company.`;
    return { eyebrow: frame.magistrate ? `${frame.magistrate} sits in the Magistrate’s chair` : 'The campfire', title: sitting ? 'Sitting by the fire' : 'The fire is lit', line };
  }
  const night = `Night ${court.night} of ${DUSK_COURT.nights}`;
  if (court.waiting) return { eyebrow: `Dusk Court · ${night}`, title: 'Waiting for the Magistrate', line: 'The Magistrate reads this one aloud. If they do not, the fire goes on by itself in a moment.' };
  switch (court.phase) {
    case 'call': return { eyebrow: 'Dusk Court', title: 'A round is called', line: 'Sit down now to play. Whoever is on a log when the call ends is dealt a card.' };
    case 'deal': return { eyebrow: 'Dusk Court', title: 'Turn your card', line: `${court.wolves === 2 ? 'Two Wolves' : 'One Wolf'} and one Watchman are among you. Keep your card to yourself.` };
    case 'night': return { eyebrow: `Dusk Court · ${night}`, title: 'Night falls', line: 'Eyes on the fire. The Wolf chooses a lantern; the Watchman asks about someone.' };
    case 'dawn': {
      const out = court.dawn?.night === court.night ? nameAt(frame, court.dawn.seat) : null;
      return { eyebrow: `Dusk Court · ${night}`, title: 'Dawn', line: out ? `${out}’s lantern was snuffed in the night.` : 'Every lantern made it through the night.' };
    }
    case 'talk': return { eyebrow: `Dusk Court · ${night}`, title: 'Talk it through', line: 'Who snuffed it? Everything said at the fire is public. The ballot follows.' };
    case 'ballot': return { eyebrow: `Dusk Court · ${night}`, title: 'The ballot', line: 'Everyone still lit taps one name, or abstains. The most votes is sent away.' };
    case 'verdict': {
      const verdict = court.verdict?.night === court.night ? court.verdict : null;
      const sent = verdict && nameAt(frame, verdict.seat);
      const role = verdict && court.players.find(p => p.seat === verdict.seat)?.role;
      const line = !verdict ? 'The circle has decided.' : sent ? `${sent} is sent away from the circle.${role ? ` They were ${role === 'townsfolk' ? 'Townsfolk' : `the ${ROLE_NAMES[role]}`}.` : ''}`
        : verdict.tie ? 'A tie. Nobody is sent away tonight.' : 'Nobody voted. Nobody is sent away tonight.';
      return { eyebrow: `Dusk Court · ${night}`, title: 'The verdict', line };
    }
    case 'ended': return resultWords(court);
  }
}

/** Your own card's words. Private: shown only on your own screen. */
export function cardWords(frame: CampfireFrame | null, self: CampfireSelf): { readonly title: string; readonly line: string; readonly notes: readonly string[] } | null {
  if (!self.role) return null;
  const notes: string[] = [];
  if (self.role === 'wolf' && self.wolves.length) {
    const names = self.wolves.map(seat => nameAt(frame, seat)).filter((n): n is string => !!n);
    if (names.length) notes.push(`Your fellow Wolf: ${names.join(' and ')}.`);
  }
  if (self.role === 'watchman') for (const answer of self.answers) {
    const name = nameAt(frame, answer.seat) ?? `Seat ${answer.seat}`;
    notes.push(`Night ${answer.night}: ${name} ${answer.wolf ? 'is a Wolf.' : 'is not a Wolf.'}`);
  }
  return { title: self.role === 'townsfolk' ? 'You are Townsfolk' : `You are the ${ROLE_NAMES[self.role]}`, line: ROLE_LINES[self.role], notes };
}

/** The open choice's prompt and its rest/abstain word. */
export const CHOICE_WORDS = {
  snuff: { title: 'Snuff a lantern', rest: 'Leave it to the wind', hint: 'Tap a lantern. If you tap nobody, the wind snuffs one for you.' },
  watch: { title: 'Ask the fire about someone', rest: 'Ask about nobody', hint: 'Tap a name. The fire answers you alone at dawn.' },
  vote: { title: 'Cast your vote', rest: 'Abstain', hint: 'Tap a name. You can change it until the ballot closes.' },
} as const;

/** The Magistrate's one call for the current phase. */
export function callWords(court: DuskCourtView | null): string {
  if (!court) return 'Call a round';
  return court.phase === 'dawn' ? 'Read the dawn' : court.phase === 'talk' ? 'End the talk' : court.phase === 'verdict' ? 'Read the verdict' : 'Call the next phase';
}

export const ASK_WORDS = 'Ask the fire for a round';
export const GALLERY_WORDS = 'Watching on Twitch? Type !sus and a name. An ember glows by their log. Only the circle votes.';

/** Why you can see but not play this round. */
export function watchWords(frame: CampfireFrame | null, self: CampfireSelf | null): string | null {
  const court = frame?.court;
  if (!court || court.phase === 'ended' || !self) return null;
  if (self.seat === null) return 'Sit on a free log to play the next round.';
  if (self.seat === 0) return null;
  const mine = court.players.find(p => p.seat === self.seat);
  if (!mine) return 'This round started without you. You can watch, and play the next.';
  if (mine.lantern !== 'lit') return 'Your lantern is dark. You watch the rest of the round and no longer vote.';
  return null;
}
