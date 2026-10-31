/**
 * A transactional in-memory `RaidGateRepository` for tests and the labelled bench. It keeps the same
 * compare-and-set and all-or-nothing rules a durable adapter must keep, and re-reads every record it stores, so
 * a write the application should never make fails loudly here first. Never bound as production storage.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import {
  readActionRecord, readGatePointer, readMemberRecord,
  type GatePointerRecord, type PartyMemberRecord, type RaidActionRecord, type RaidGateRepository, type RaidGateTransaction, type Stored,
} from './repository';

type Table<T> = Map<string, T>;
interface Tables { gates: Table<GatePointerRecord>; actions: Table<RaidActionRecord>; members: Table<PartyMemberRecord> }

export interface MemoryRaidGateRepository extends RaidGateRepository {
  /** Committed state only, for assertions. */
  snapshot(): Readonly<{ gates: GatePointerRecord[]; actions: RaidActionRecord[]; members: PartyMemberRecord[] }>;
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

export function createMemoryRaidGateRepository(): MemoryRaidGateRepository {
  const tables: Tables = { gates: new Map(), actions: new Map(), members: new Map() };
  let queue: Promise<unknown> = Promise.resolve();
  let commits = 0;
  const memberKey = (requestId: string, personId: PersonId) => `${requestId}\u0000${personId}`;

  async function run<T>(work: (tx: RaidGateTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const staged: Tables = { gates: new Map(), actions: new Map(), members: new Map() };
    const tx: RaidGateTransaction = {
      getGate: async (kingdomId: KingdomId) => stage(tables.gates, staged.gates, kingdomId),
      putGate: async (record, expected) => put(tables.gates, staged.gates, record.kingdomId, record, expected, readGatePointer),
      getAction: async requestId => stage(tables.actions, staged.actions, requestId),
      putAction: async (record, expected) => put(tables.actions, staged.actions, record.requestId, record, expected, readActionRecord),
      getMember: async (requestId, personId) => stage(tables.members, staged.members, memberKey(requestId, personId)),
      putMember: async (record, expected) => put(tables.members, staged.members, memberKey(record.requestId, record.personId), record, expected, readMemberRecord),
    };
    const result = await work(tx);
    signal.throwIfAborted();
    const writes = staged.gates.size + staged.actions.size + staged.members.size;
    for (const [key, value] of staged.gates) tables.gates.set(key, value);
    for (const [key, value] of staged.actions) tables.actions.set(key, value);
    for (const [key, value] of staged.members) tables.members.set(key, value);
    if (writes > 0) commits++;
    return result;
  }

  return {
    transaction<T>(work: (tx: RaidGateTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
      const next = queue.then(() => run(work, signal));
      queue = next.catch(() => undefined);
      return next;
    },
    snapshot: () => structuredClone({ gates: [...tables.gates.values()], actions: [...tables.actions.values()], members: [...tables.members.values()] }),
    get commits() { return commits; },
  };
}
