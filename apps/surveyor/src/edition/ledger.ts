import { assertSettlerIndex, type AtlasEdition, type AtlasSettler } from '@chatdom/shared';
import { sha256 } from '../export/project';
import { LedgerLineSchema, type LedgerHead, type LedgerLine } from './schema';

/**
 * The holding ledger of one edition: one JSON line per event, each naming the SHA-256 of the line before it, so the
 * file can only grow. Replaying it gives the settler index (the shared AtlasSettler order every live frame aligns
 * to), who holds what, and which holdings are tombstoned. Nothing is ever removed: a hidden or gone channel keeps
 * its holding under a tombstone, so no other channel can be granted that land.
 */
export const genesisHash = (worldHash: string) => sha256(`chatdom-atlas-ledger:${worldHash}`);

export type LedgerEvent =
  | Omit<Extract<LedgerLine, { kind: 'settle' }>, 'seq' | 'prev'>
  | Omit<Extract<LedgerLine, { kind: 'tombstone' }>, 'seq' | 'prev'>
  | Omit<Extract<LedgerLine, { kind: 'restore' }>, 'seq' | 'prev'>
  | Omit<Extract<LedgerLine, { kind: 'night' }>, 'seq' | 'prev'>;

export interface Tombstone { cause: 'hidden' | 'gone'; at: number }

export interface LedgerState {
  settlers: AtlasSettler[];
  /** kingdomId → ordinal. */
  owners: Map<string, number>;
  holdings: Set<string>;
  /** kingdomId → its current tombstone. */
  tombstones: Map<string, Tombstone>;
  lastNight: { revision: string; asOf: number } | null;
  lines: number;
  head: string;
}

export function emptyState(worldHash: string): LedgerState {
  return { settlers: [], owners: new Map(), holdings: new Set(), tombstones: new Map(), lastNight: null, lines: 0, head: genesisHash(worldHash) };
}

/** One canonical line: fixed key order (chain first, then the event's own fields), no whitespace. */
export function encodeLine(seq: number, prev: string, event: LedgerEvent): string {
  return JSON.stringify(LedgerLineSchema.parse({ seq, prev, ...event }));
}

/** Applies one event to a state, refusing anything that would give land two owners or move a holding. */
export function applyEvent(state: LedgerState, line: LedgerLine): void {
  switch (line.kind) {
    case 'settle': {
      const settler = line.settler;
      if (settler.ordinal !== state.settlers.length) throw new Error(`settler ${settler.kingdomId} has ordinal ${settler.ordinal}, expected ${state.settlers.length}.`);
      if (state.owners.has(settler.kingdomId)) throw new Error(`channel ${settler.kingdomId} already holds land.`);
      if (state.holdings.has(settler.holdingId)) throw new Error(`holding ${settler.holdingId} already has an owner.`);
      state.settlers.push(settler);
      state.owners.set(settler.kingdomId, settler.ordinal);
      state.holdings.add(settler.holdingId);
      return;
    }
    case 'tombstone': {
      const ordinal = state.owners.get(line.kingdomId);
      if (ordinal === undefined || state.settlers[ordinal]!.holdingId !== line.holdingId) throw new Error(`tombstone for ${line.kingdomId} does not name its holding.`);
      if (state.tombstones.has(line.kingdomId)) throw new Error(`channel ${line.kingdomId} is already tombstoned.`);
      state.tombstones.set(line.kingdomId, { cause: line.cause, at: line.at });
      return;
    }
    case 'restore': {
      const ordinal = state.owners.get(line.kingdomId);
      if (ordinal === undefined || state.settlers[ordinal]!.holdingId !== line.holdingId) throw new Error(`restore for ${line.kingdomId} does not name its holding.`);
      if (!state.tombstones.has(line.kingdomId)) throw new Error(`channel ${line.kingdomId} has no tombstone to lift.`);
      state.tombstones.delete(line.kingdomId);
      return;
    }
    case 'night': {
      if (state.lastNight && line.asOf <= state.lastNight.asOf) throw new Error(`night ${line.revision} is not later than ${state.lastNight.revision}.`);
      state.lastNight = { revision: line.revision, asOf: line.asOf };
    }
  }
}

/** Replays ledger text, verifying the chain, the canonical encoding and every invariant. Throws on the first fault. */
export function replayLedger(text: string, edition: AtlasEdition): LedgerState {
  const state = emptyState(edition.worldHash);
  if (text.length && !text.endsWith('\n')) throw new Error('the ledger ends in a truncated line.');
  const lines = text.split('\n');
  lines.pop();
  for (const [index, raw] of lines.entries()) {
    let line: LedgerLine;
    try {
      line = LedgerLineSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error(`ledger line ${index + 1} is not a valid record.`);
    }
    if (line.seq !== index) throw new Error(`ledger line ${index + 1} has sequence ${line.seq}.`);
    if (line.prev !== state.head) throw new Error(`ledger line ${index + 1} does not continue the chain.`);
    const { seq, prev, ...event } = line;
    if (encodeLine(seq, prev, event as LedgerEvent) !== raw) throw new Error(`ledger line ${index + 1} is not canonically encoded.`);
    applyEvent(state, line);
    state.head = sha256(raw);
    state.lines = index + 1;
  }
  assertSettlerIndex(edition, state.settlers);
  return state;
}

/** Encodes new events after a state and applies them to a copy; the original state is untouched. */
export function extendLedger(state: LedgerState, events: readonly LedgerEvent[]): { text: string; next: LedgerState } {
  const next: LedgerState = {
    settlers: [...state.settlers], owners: new Map(state.owners), holdings: new Set(state.holdings),
    tombstones: new Map(state.tombstones), lastNight: state.lastNight, lines: state.lines, head: state.head,
  };
  let text = '';
  for (const event of events) {
    const raw = encodeLine(next.lines, next.head, event);
    applyEvent(next, LedgerLineSchema.parse(JSON.parse(raw)));
    next.head = sha256(raw);
    next.lines++;
    text += `${raw}\n`;
  }
  return { text, next };
}

/** True when an acknowledged head is still a prefix of the ledger: every address it covered is unchanged. */
export function headHolds(text: string, head: Pick<LedgerHead, 'lines' | 'head' | 'settlers'>): boolean {
  let offset = 0;
  let last = '';
  for (let i = 0; i < head.lines; i++) {
    const end = text.indexOf('\n', offset);
    if (end < 0) return false;
    last = text.slice(offset, end);
    offset = end + 1;
  }
  return head.lines === 0 || sha256(last) === head.head;
}
