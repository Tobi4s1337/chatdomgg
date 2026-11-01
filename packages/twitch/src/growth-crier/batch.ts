import { GrowthSceneFrameSchema, type GrowthSceneBeat, type GrowthSceneFrame } from '@chatdom/shared';
import { formatGrowthBeat } from './format';

export interface GrowthBatchConfig {
  readonly quietWindowMs: number;
  readonly maxMessageLength: number;
  /** At least one complete shared-schema frame (128 beats) must fit. */
  readonly maxPending: number;
}

export interface GrowthBatch {
  readonly origin: GrowthSceneFrame['origin'];
  readonly text: string;
  readonly evidence: readonly GrowthSceneBeat[];
}

/** Keep this state across reconnects. A new state is only for a different stream/session. */
export interface GrowthBatcher {
  readonly config: GrowthBatchConfig;
  readonly sessionId: string;
  readonly kingdomId: GrowthSceneFrame['kingdomId'] | null;
  readonly origin: GrowthSceneFrame['origin'] | null;
  readonly sequence: number | null;
  readonly pending: readonly GrowthSceneBeat[];
  /** Pins a refused frame until it can be retried; later snapshots cannot skip it. */
  readonly blockedKey: string | null;
  readonly readyAt: number | null;
  readonly lastNow: number | null;
}

export type IngestStatus = 'baseline' | 'accepted' | 'unchanged' | 'backpressure' | 'invalid';
export interface IngestResult { readonly state: GrowthBatcher; readonly status: IngestStatus }
export interface FlushResult { readonly state: GrowthBatcher; readonly batch: GrowthBatch | null }

function integer(value: number, min: number): boolean {
  return Number.isSafeInteger(value) && value >= min;
}

export function createGrowthBatcher(config: GrowthBatchConfig, sessionId: string): GrowthBatcher {
  if (!integer(config.quietWindowMs, 1) || !integer(config.maxMessageLength, 128)
    || !integer(config.maxPending, 128) || !sessionId.trim()) {
    throw new Error('Invalid growth crier configuration or session');
  }
  return { config: { ...config }, sessionId, kingdomId: null, origin: null, sequence: null,
    pending: [], blockedKey: null, readyAt: null, lastNow: null };
}

/** Explicitly discard this session's pending work only when starting another session. */
export function resetGrowthBatcher(state: GrowthBatcher, nextSessionId: string): GrowthBatcher {
  if (nextSessionId === state.sessionId) throw new Error('A reset requires a different session');
  return createGrowthBatcher(state.config, nextSessionId);
}

function validTime(state: GrowthBatcher, now: number): boolean {
  return integer(now, 0) && (state.lastNow === null || now >= state.lastNow)
    && Number.isSafeInteger(now + state.config.quietWindowMs);
}

// Include all public fields: two distinct facts may share a source sequence (and timestamp).
function identity(beat: GrowthSceneBeat): string {
  switch (beat.kind) {
    case 'home-grown': return JSON.stringify([beat.kind, beat.sourceSeq, beat.at, beat.plotId, beat.from, beat.to, beat.qualifiedDays]);
    case 'civic-levelled': return JSON.stringify([beat.kind, beat.sourceSeq, beat.at, beat.place, beat.from, beat.to]);
    case 'streak-reached': return JSON.stringify([beat.kind, beat.sourceSeq, beat.at, beat.plotId, beat.days]);
  }
}
function compare(a: GrowthSceneBeat, b: GrowthSceneBeat): number {
  return a.sourceSeq - b.sourceSeq || a.at - b.at || (identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0);
}
function frameKey(frame: GrowthSceneFrame): string {
  return JSON.stringify([frame.kingdomId, frame.origin, frame.sequence,
    [...new Set(frame.beats.map(identity))].sort()]);
}

/** Reconnect snapshots are a fresh baseline, not evidence of live delivery. */
export function rebaselineGrowthFrame(state: GrowthBatcher, input: unknown, now: number): IngestResult {
  if (!validTime(state, now) || state.blockedKey !== null) return { state, status: 'invalid' };
  const parsed = GrowthSceneFrameSchema.safeParse(input);
  if (!parsed.success) return { state, status: 'invalid' };
  const frame = parsed.data;
  if (state.sequence !== null && (frame.kingdomId !== state.kingdomId || frame.origin !== state.origin
    || frame.sequence < state.sequence)) return { state, status: 'invalid' };
  return { state: { ...state, kingdomId: frame.kingdomId, origin: frame.origin,
    sequence: frame.sequence, lastNow: now }, status: 'baseline' };
}

/**
 * Accept a complete snapshot atomically. The first snapshot is a baseline, never a live
 * announcement. Only sequences beyond the previously accepted snapshot can be new;
 * equal/older tails on reconnect are ignored, even if their contents differ. The feed
 * cannot prove that a late addition at an already observed sequence is fresh.
 * On backpressure retain and retry the same frame after draining; do not skip ahead.
 */
export function ingestGrowthFrame(state: GrowthBatcher, input: unknown, now: number): IngestResult {
  if (!validTime(state, now)) return { state, status: 'invalid' };
  const parsed = GrowthSceneFrameSchema.safeParse(input);
  if (!parsed.success) return { state, status: 'invalid' };
  const frame = parsed.data;
  const key = frameKey(frame);
  if (state.blockedKey !== null && key !== state.blockedKey) return { state, status: 'backpressure' };
  if (state.sequence === null) {
    return rebaselineGrowthFrame(state, frame, now);
  }
  if (frame.kingdomId !== state.kingdomId || frame.origin !== state.origin) return { state, status: 'invalid' };
  if (frame.sequence <= state.sequence) return { state: { ...state, lastNow: now }, status: 'unchanged' };
  const unique = new Map<string, GrowthSceneBeat>();
  for (const beat of frame.beats) {
    if (beat.sourceSeq > state.sequence) unique.set(identity(beat), beat);
  }
  const additions = [...unique.values()].sort(compare);
  if (state.pending.length + additions.length > state.config.maxPending) {
    return { state: { ...state, blockedKey: key }, status: 'backpressure' };
  }
  // No accepted fact may become impossible to present within the configured limit.
  if (additions.some(beat => formatGrowthBeat(beat, frame.origin).text.length > state.config.maxMessageLength)) {
    return { state, status: 'invalid' };
  }
  return { state: { ...state, sequence: frame.sequence, lastNow: now, blockedKey: null,
    pending: [...state.pending, ...additions],
    readyAt: additions.length ? now + state.config.quietWindowMs : state.readyAt },
  status: additions.length ? 'accepted' : 'unchanged' };
}

/** Pull a candidate only after a quiet window; this is not a send or an acknowledgement. */
export function flushGrowthBatch(state: GrowthBatcher, now: number): FlushResult {
  if (!validTime(state, now)) throw new Error('Invalid or backwards crier clock');
  if (state.readyAt === null || now < state.readyAt || state.origin === null) {
    return { state: { ...state, lastNow: now }, batch: null };
  }
  const prefix = state.origin === 'simulated' ? 'SIMULATED: ' : '';
  let text = prefix;
  const evidence: GrowthSceneBeat[] = [];
  for (const beat of state.pending) {
    const line = formatGrowthBeat(beat, 'live').text;
    const next = text + (evidence.length ? ' ' : '') + line;
    if (next.length > state.config.maxMessageLength) break;
    text = next;
    evidence.push(beat);
  }
  const pending = state.pending.slice(evidence.length);
  return { state: { ...state, pending, lastNow: now, readyAt: pending.length ? now + state.config.quietWindowMs : null },
    batch: { origin: state.origin, text, evidence } };
}
