// What the walk-in gate reads from its address and says in each state, kept apart from its drawing.
import { RealmEntryInfoSchema } from '@chatdom/shared/realm';

/**
 * Where the walk-in gate stands. `opening` while the streets are made ready; `waiting` for a visitor who is not
 * signed in; `lost` when the address names no kingdom; `nowhere` when it names one that is not open to visitors;
 * `refused` when the kingdom will not let this visit in; `closed` when something could not be reached. `connected` is
 * the kingdom itself.
 */
export type GateState = 'opening' | 'waiting' | 'lost' | 'nowhere' | 'refused' | 'closed' | 'connected';

const KINGDOM = /^[1-9][0-9]{0,31}$/;

/** The kingdom this gate is for, from its own address (`/?walk=1&kingdom=<id>`), or null when it names none. */
export function gateKingdom(search: string): string | null {
  const id = new URLSearchParams(search).get('kingdom');
  return id && KINGDOM.test(id) ? id : null;
}

/**
 * What the realm's entry read told the gate. `named` carries the kingdom's approved name (any name, even one that
 * reads like a state); `missing` means no kingdom at this address is open to visitors (404: a stale or mistyped link);
 * `unknown` means it cannot say just now, and the gate reads well without a name.
 */
export type GateNaming = { kind: 'named'; name: string } | { kind: 'missing' } | { kind: 'unknown' };

/** Reads the realm's entry answer for this gate's kingdom (see `GateNaming`). */
export function gateName(kingdomId: string, status: number, body: unknown): GateNaming {
  if (status === 404) return { kind: 'missing' };
  if (status < 200 || status > 299) return { kind: 'unknown' };
  const info = RealmEntryInfoSchema.safeParse(body);
  return info.success && info.data.kingdomId === kingdomId ? { kind: 'named', name: info.data.name } : { kind: 'unknown' };
}

/** What the gate says in each state: a heading, what happened, and what to do next, in the kingdom's voice. */
export function gateWords(state: Exclude<GateState, 'connected'>, kingdom: string | null, offline = false): { title: string; words: string } {
  const there = kingdom ?? 'the kingdom';
  switch (state) {
    case 'opening': return { title: 'Finding your way home', words: kingdom ? `The streets of ${kingdom} are being made ready for you.` : 'The streets are being made ready for you.' };
    case 'waiting': return { title: 'Your place is waiting.', words: `Sign in with Twitch to walk into ${there} and find your home. Twitch tells us only your public name.` };
    case 'lost': return { title: 'Which kingdom?', words: 'This gate does not say which kingdom to open. Find one on the Atlas and walk in from its card.' };
    case 'nowhere': return { title: 'This road leads nowhere.', words: 'No kingdom at this address is open to visitors. Find one on the Atlas and walk in from its card.' };
    case 'refused': return { title: 'The gate stays shut.', words: `${kingdom ?? 'The kingdom'} did not let this visit in just now. If that seems wrong, its moderators can help.` };
    case 'closed': return offline
      ? { title: 'The gate could not open.', words: 'You seem to be offline. Your home keeps its place; try the gate again once you are back.' }
      : { title: 'The gate could not open.', words: 'Nothing was lost, and your home keeps its place. Try the gate again in a moment.' };
  }
}
