/**
 * A transactional in-memory `RaidGateRepository` for tests and the labelled bench. It keeps the same
 * compare-and-set and all-or-nothing rules a durable adapter must keep, and re-reads every record it stores, so
 * a write the application should never make fails loudly here first. Never bound as production storage.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import {
  RAID_GATE_LIST_LIMIT, readActionRecord, readGatePointer, readMemberRecord, readOutboxRecord,
  type GatePointerRecord, type PartyMemberRecord, type RaidActionRecord, type RaidGateRepository, type RaidGateTransaction, type RaidOutboxRecord,
  type Stored,
} from './repository';

type Table<T> = Map<string, T>;
interface Tables { gates: Table<GatePointerRecord>; actions: Table<RaidActionRecord>; members: Table<PartyMemberRecord>; outbox: Table<RaidOutboxRecord> }
const empty = (): Tables => ({ gates: new Map(), actions: new Map(), members: new Map(), outbox: new Map() });

export interface MemoryRaidGateRepository extends RaidGateRepository {
  /** Committed state only, for assertions. */
  snapshot(): Readonly<{ gates: GatePointerRecord[]; actions: RaidActionRecord[]; members: PartyMemberRecord[]; outbox: RaidOutboxRecord[] }>;
  /** Committed transactions; a test can prove a read did not write. */
  readonly commits: number;
}

function stage<T>(committed: Table<T>, staged: Table<T>, key: string): T | null {
  return staged.get(key) ?? committed.get(key) ?? null;
}

function put<T extends { revision: number }>(committed: Table<T>, staged: Table<T>, key: string, record: T, expected: number, read: (value: unknown) => T | undefined): Stored<T> {
  const current = stage(committed, staged, key);
  if ((current?.revision ?? 0) !== expected || record.revision !== expected + 1) return { kind: 'conflict', current };
  const copy = read(structuredClone(record));
  if (!copy) throw new Error('Refusing to store a malformed Raid Gate record.');
  staged.set(key, copy);
  return { kind: 'stored', record: copy };
}

/** Committed and staged rows of one table, staged winning, filtered and ordered by key like the SQL listing. */
function list<T>(committed: Table<T>, staged: Table<T>, keep: (record: T) => boolean, after: string | null, limit: number): T[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RAID_GATE_LIST_LIMIT) throw new Error('A Raid Gate listing takes 1–100 records.');
  const merged = new Map([...committed, ...staged]);
  return [...merged.keys()].filter(key => after === null || key > after).sort()
    .map(key => merged.get(key)!).filter(keep).slice(0, limit).map(record => structuredClone(record));
}

export function createMemoryRaidGateRepository(): MemoryRaidGateRepository {
  const tables: Tables = empty();
  let queue: Promise<unknown> = Promise.resolve();
  let commits = 0;
  const memberKey = (requestId: string, personId: PersonId) => `${requestId}\u0000${personId}`;

  async function run<T>(work: (tx: RaidGateTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const staged: Tables = empty();
    const tx: RaidGateTransaction = {
      getGate: async (kingdomId: KingdomId) => stage(tables.gates, staged.gates, kingdomId),
      putGate: async (record, expected) => put(tables.gates, staged.gates, record.kingdomId, record, expected, readGatePointer),
      getAction: async requestId => stage(tables.actions, staged.actions, requestId),
      putAction: async (record, expected) => put(tables.actions, staged.actions, record.requestId, record, expected, readActionRecord),
      getMember: async (requestId, personId) => stage(tables.members, staged.members, memberKey(requestId, personId)),
      putMember: async (record, expected) => put(tables.members, staged.members, memberKey(record.requestId, record.personId), record, expected, readMemberRecord),
      getOutbox: async id => stage(tables.outbox, staged.outbox, id),
      putOutbox: async (record, expected) => put(tables.outbox, staged.outbox, record.id, record, expected, readOutboxRecord),
      listOutbox: async (state, after, limit) => list(tables.outbox, staged.outbox, record => record.state === state, after, limit),
      listActions: async (state, after, limit) => list(tables.actions, staged.actions, record => record.state === state, after, limit),
    };
    const result = await work(tx);
    signal.throwIfAborted();
    const writes = staged.gates.size + staged.actions.size + staged.members.size + staged.outbox.size;
    for (const [key, value] of staged.gates) tables.gates.set(key, value);
    for (const [key, value] of staged.actions) tables.actions.set(key, value);
    for (const [key, value] of staged.members) tables.members.set(key, value);
    for (const [key, value] of staged.outbox) tables.outbox.set(key, value);
    if (writes > 0) commits++;
    return result;
  }

  return {
    transaction<T>(work: (tx: RaidGateTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
      const next = queue.then(() => run(work, signal));
      queue = next.catch(() => undefined);
      return next;
    },
    snapshot: () => structuredClone({ gates: [...tables.gates.values()], actions: [...tables.actions.values()], members: [...tables.members.values()], outbox: [...tables.outbox.values()] }),
    get commits() { return commits; },
  };
}
