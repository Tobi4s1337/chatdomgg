import type { EventCause, KingdomId } from '@chatdom/shared';
import { MOMENT_FACT_TYPE, TwitchMomentFactSchema, type MomentOrigin, type TwitchMomentBody, type TwitchMomentFact } from '../../../web/src/twitch-moments/contracts';
import type { FactClocks, MomentClock, MomentRecordPort, MomentRecordTransaction } from './ports';

/**
 * A process-local record port for tests and SIMULATED benches. It honours the same contract as main's durable
 * core binding (serial transactions, atomic commit, core-assigned seq) but is not durable: losing the process
 * loses it. It never stands in for the production store.
 */
export function createMemoryMomentRecords(clock: MomentClock, options: { firstSeq?: number } = {}) {
  const kingdoms = new Map<KingdomId, { values: Map<string, unknown>; seq: number }>();
  let chain: Promise<unknown> = Promise.resolve(), failNext: string | null = null, transactions = 0;
  const kingdom = (id: KingdomId) => {
    let entry = kingdoms.get(id);
    if (!entry) { entry = { values: new Map(), seq: (options.firstSeq ?? 1) - 1 }; kingdoms.set(id, entry); }
    return entry;
  };
  const port: MomentRecordPort = {
    transact<T>(kingdomId: KingdomId, work: (tx: MomentRecordTransaction) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const committed = kingdom(kingdomId), staged = new Map<string, unknown>(), facts: TwitchMomentFact[] = [];
        let seq = committed.seq;
        const tx: MomentRecordTransaction = {
          async get(key) { return structuredClone(staged.has(key) ? staged.get(key) : committed.values.get(key)); },
          async put(key, value) { staged.set(key, structuredClone(value)); },
          async claim(key) {
            if (staged.has(key) || committed.values.has(key)) return false;
            staged.set(key, true); return true;
          },
          async appendFact(body: TwitchMomentBody, clocks: FactClocks, cause: EventCause, origin: MomentOrigin) {
            const fact = TwitchMomentFactSchema.parse({ version: 1, kingdomId, seq: ++seq, occurredAt: clocks.occurredAt, receivedAt: clocks.receivedAt,
              committedAt: Math.max(clocks.receivedAt, clock.now()), origin, type: MOMENT_FACT_TYPE, actor: null, body, cause });
            facts.push(fact); return structuredClone(fact);
          },
        };
        const result = await work(tx);
        transactions++;
        if (failNext) { const reason = failNext; failNext = null; throw new Error(reason); }
        for (const [key, value] of staged) committed.values.set(key, value);
        committed.seq = seq;
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return {
    port,
    /** Make the next commit fail after its work ran, as a crashed or conflicting store would. */
    failNextCommit(reason = 'Simulated commit failure') { failNext = reason; },
    /** Inspection for tests: every key and value as stored. */
    dump: (kingdomId: KingdomId) => [...kingdom(kingdomId).values.entries()],
    get transactions() { return transactions; },
  };
}
