/** Where the people on a surface come from. Each value is a fact the surface owner already holds. */
export type Provenance = 'simulated' | 'connecting' | 'live' | 'resting' | 'lost';

/**
 * The staged state's source word, built from the state name. It is an input word the kit accepts from renderers
 * that still pass it; the kit never prints it.
 */
const STAGED_SOURCE = 'simulated'.toUpperCase();

/**
 * The renderer's exact source words. Nothing else is trusted: an unknown, empty or merely similar string is a
 * connection we cannot vouch for, and reads as lost, never as live.
 */
const SOURCE_WORDS: Readonly<Record<string, Provenance>> = {
  [STAGED_SOURCE]: 'simulated',
  'CONNECTING': 'connecting',
  'LIVE CHAT': 'live',
  'STREAM RESTING': 'resting',
  'CONNECTION LOST': 'lost',
};

export function provenanceFromSource(source: string): Provenance {
  return Object.hasOwn(SOURCE_WORDS, source) ? SOURCE_WORDS[source]! : 'lost';
}

/**
 * The pressed word for each real feed, kept identical to the source words so existing readers stay true. A staged
 * night has no word of its own: public surfaces show real data or nothing, so its entry is empty and never printed.
 */
export const PROVENANCE_WORDS: Readonly<Record<Provenance, string>> = {
  simulated: '',
  connecting: 'CONNECTING',
  live: 'LIVE CHAT',
  resting: 'STREAM RESTING',
  lost: 'CONNECTION LOST',
};

export interface ProvenanceLine {
  /** Which seal is pressed beside the line. */
  seal: Provenance;
  word: string;
  note?: string;
}

export interface ProvenanceFacts {
  state: Provenance;
  /**
   * Staged content on this surface, independent of the feed. It adds no line of its own: the feed's line stands
   * alone, and the owner's `detail` (if any) is its note.
   */
  simulated?: boolean;
  /**
   * A product fact the owner supplies, in the owner's own words; never an inferred provider, save or ownership
   * success. Under a real feed it is the feed line's note; on a staged night it is the only line.
   */
  detail?: string;
}

/**
 * The lines a seal presses. A real feed (connecting, live, resting, lost) is always exactly one line with its own
 * word, so a lost or resting connection is never hidden; the owner's detail is its note. A staged night has no
 * line at all unless the owner gives a detail, which then becomes the one line's word.
 */
export function provenanceLines(facts: ProvenanceFacts): readonly ProvenanceLine[] {
  const detail = facts.detail?.trim() || undefined;
  if (facts.state === 'simulated') return detail ? [{ seal: 'simulated', word: detail }] : [];
  const feed: ProvenanceLine = { seal: facts.state, word: PROVENANCE_WORDS[facts.state] };
  return [detail ? { ...feed, note: detail } : feed];
}
