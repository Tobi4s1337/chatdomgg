// What the walk-in gate reads from its address and says in each state, kept apart from its drawing.

/**
 * Where the walk-in gate stands. `opening` while the streets are made ready; `waiting` for a visitor who is not
 * signed in; `lost` when the address names no kingdom; `refused` when the kingdom will not let this visit in;
 * `closed` when something could not be reached. `connected` is the kingdom itself.
 */
export type GateState = 'opening' | 'waiting' | 'lost' | 'refused' | 'closed' | 'connected';

const KINGDOM = /^[1-9][0-9]{0,31}$/;

/** The kingdom this gate is for, from its own address (`/?walk=1&kingdom=<id>`), or null when it names none. */
export function gateKingdom(search: string): string | null {
  const id = new URLSearchParams(search).get('kingdom');
  return id && KINGDOM.test(id) ? id : null;
}

/** What the gate says in each state: a heading, what happened, and what to do next, in the kingdom's voice. */
export function gateWords(state: Exclude<GateState, 'connected'>, kingdom: string | null, offline = false): { title: string; words: string } {
  const there = kingdom ?? 'the kingdom';
  switch (state) {
    case 'opening': return { title: 'Finding your way home', words: kingdom ? `The streets of ${kingdom} are being made ready for you.` : 'The streets are being made ready for you.' };
    case 'waiting': return { title: 'Your place is waiting.', words: `Sign in with Twitch to walk into ${there} and find your home. Twitch tells us only your public name.` };
    case 'lost': return { title: 'Which kingdom?', words: 'This gate does not say which kingdom to open. Find one on the Atlas and walk in from its card.' };
    case 'refused': return { title: 'The gate stays shut.', words: `${kingdom ?? 'The kingdom'} did not let this visit in just now. If that seems wrong, its moderators can help.` };
    case 'closed': return offline
      ? { title: 'The gate could not open.', words: 'You seem to be offline. Your home keeps its place; try the gate again once you are back.' }
      : { title: 'The gate could not open.', words: 'Nothing was lost, and your home keeps its place. Try the gate again in a moment.' };
  }
}
