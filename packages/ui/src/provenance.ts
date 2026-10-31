/** Where the people on a surface come from. Each value is a fact the surface owner already holds. */
export type Provenance = 'simulated' | 'connecting' | 'live' | 'resting' | 'lost';

/**
 * The renderer's exact source words. Nothing else is trusted: an unknown, empty or merely similar string is a
 * connection we cannot vouch for, and reads as lost, never as live.
 */
const SOURCE_WORDS: Readonly<Record<string, Provenance>> = {
  'SIMULATED': 'simulated',
  'CONNECTING': 'connecting',
  'LIVE CHAT': 'live',
  'STREAM RESTING': 'resting',
  'CONNECTION LOST': 'lost',
};

export function provenanceFromSource(source: string): Provenance {
  return Object.hasOwn(SOURCE_WORDS, source) ? SOURCE_WORDS[source]! : 'lost';
}

/** The pressed word for each state, kept identical to the source words so existing readers stay true. */
export const PROVENANCE_WORDS: Readonly<Record<Provenance, string>> = {
  simulated: 'SIMULATED',
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
  /** Practice content on this surface, independent of the feed, which may itself be live or lost. */
  simulated?: boolean;
  /** A product fact the owner supplies; never an inferred provider, save or ownership success. */
  detail?: string;
}

/**
 * Every distinct fact gets its own line. The feed always comes first, so a lost or resting connection is never
 * hidden behind practice content; practice content under a real feed adds a SIMULATED line rather than
 * replacing it.
 */
export function provenanceLines(facts: ProvenanceFacts): readonly ProvenanceLine[] {
  const detail = facts.detail?.trim() || undefined;
  const feed: ProvenanceLine = { seal: facts.state, word: PROVENANCE_WORDS[facts.state] };
  if (facts.state === 'simulated') return [detail ? { ...feed, note: detail } : feed];
  if (!facts.simulated) return [detail ? { ...feed, note: detail } : feed];
  return [feed, { seal: 'simulated', word: PROVENANCE_WORDS.simulated, note: detail ?? 'practice, not chat' }];
}
