import type { KingdomId } from '@chatdom/shared';
import {
  RealmSupportObservationSchema, type RealmBootstrap, type RealmPublicDelivery, type RealmPublicMessage, type RealmSupportObservation,
} from '@chatdom/shared/realm';
import type { TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import { createMemoryMomentRecords } from '../../../herald/src/twitch-moments/memory';
import { applyChatNotice } from '../../../herald/src/twitch-moments/notices';
import type { CitizenDirectory } from '../../../herald/src/twitch-moments/ports';
import { momentRepository } from '../../../herald/src/twitch-moments/records';
import type { RealmObservedRoom } from '../realm/adapters/observer';

/** What the realm answers Herald, in the shape of `/internal/realm/ingress` (apps/realm/src/moments/service.ts). */
export interface RelayReply {
  readonly http: 202 | 400 | 503;
  readonly body: { readonly version: 1; readonly status: 'accepted' | 'duplicate' | 'unavailable' | 'refused'; readonly message?: string };
}
/**
 * One injected failure for the next attempt. `down`: the writer is not held, nothing runs. `crash`: the record work
 * runs and its commit fails, so nothing is claimed or published. `lose-reply`: the commit lands and the answer never
 * reaches Herald, which must send the same evidence again.
 */
export type RelayFault = 'down' | 'crash' | 'lose-reply';
export interface RelayLogEntry { readonly id: string; readonly outcome: RelayReply['body']['status'] | 'reply-lost'; readonly facts: number }

/**
 * A process-local, SIMULATED stand-in for the realm's held support writer and public outbox, for the bench and the
 * composed-path test. Main's `RealmSupportIngress` commits through Postgres; this keeps its order exactly —
 * delivery claim by Herald's evidence ID, the shared chat-notice normalizer, facts appended with the EventSub cause,
 * lasting state in `current`, then one `moment` outbox row per fact — on the same in-memory record port the lane's
 * other benches use. Every row it publishes goes to the real browser observer through a room bridge; nothing here
 * talks to Twitch or claims a real event happened.
 */
export function createSimulatedRealmRelay(options: {
  readonly kingdomId: KingdomId; readonly origin: 'live' | 'simulated'; readonly directory: CitizenDirectory; readonly clock: { now(): number };
  readonly layoutRevision: string; readonly collisionRevision: number;
}) {
  const { kingdomId, origin, directory, clock } = options;
  const records = createMemoryMomentRecords(clock);
  const rooms = new Set<(type: string, payload: unknown) => void>();
  const rows: RealmPublicDelivery[] = [], log: RelayLogEntry[] = [], faults: RelayFault[] = [];
  let down = false, writers = 1, writerEpoch = `SIMULATED-writer-${writers}`, cursor = 0, throughSeq = 0, current: TwitchMomentFact[] = [];

  const publish = (row: RealmPublicDelivery) => { for (const emit of [...rooms]) emit('world', row); };

  async function accept(raw: unknown): Promise<RelayReply> {
    const parsed = RealmSupportObservationSchema.safeParse(raw);
    if (!parsed.success) return { http: 400, body: { version: 1, status: 'refused', message: 'Malformed support evidence.' } };
    const observation: RealmSupportObservation = parsed.data;
    const fault = down ? 'down' : faults.shift();
    // A writer for another kingdom or origin is not this writer: simulated evidence never becomes a live fact.
    if (fault === 'down' || observation.kingdomId !== kingdomId || observation.origin !== origin) return unavailable(observation.id, log);
    if (observation.receivedAt > clock.now() + 5_000) return { http: 400, body: { version: 1, status: 'refused', message: 'This evidence has a future receipt time.' } };
    if (fault === 'crash') records.failNextCommit('SIMULATED commit failure');
    let committed: { status: 'accepted' | 'duplicate'; messages: RealmPublicMessage[]; current: TwitchMomentFact[]; throughSeq: number };
    try {
      committed = await records.port.transact(kingdomId, async tx => {
        const repository = momentRepository(tx);
        if (!await repository.claimDelivery(observation.id)) return { status: 'duplicate' as const, messages: [], current, throughSeq };
        const result = await applyChatNotice(observation.notice, { kingdomId, repository, directory }, observation.occurredAt);
        const facts: TwitchMomentFact[] = [];
        if (result.outcome === 'applied') {
          for (const { body, current: persistent } of result.facts) {
            const fact = await tx.appendFact(body, observation, { kind: 'external', source: 'twitch.eventsub', id: observation.id }, origin);
            if (persistent && !await repository.setCurrent(fact)) throw new Error('Moment current state exceeds its budget');
            facts.push(fact);
          }
        }
        const watermark = facts.length ? facts.at(-1)!.seq : throughSeq;
        if (facts.length) await repository.putWatermark(watermark);
        const lasting = await repository.currentFacts(), kept = new Set(lasting.map(f => f.seq));
        return { status: 'accepted' as const, messages: facts.map(fact => ({ type: 'moment' as const, fact, current: kept.has(fact.seq) })), current: lasting, throughSeq: watermark };
      });
    } catch {
      return unavailable(observation.id, log);
    }
    current = committed.current; throughSeq = committed.throughSeq;
    for (const message of committed.messages) {
      if (message.type !== 'moment') continue;
      const row: RealmPublicDelivery = { version: 1, kingdomId, writerEpoch, sequence: 0, cursor: ++cursor, eventId: `${kingdomId}:m:${message.fact.seq}`, message };
      rows.push(row);
      publish(row);
    }
    if (fault === 'lose-reply') {
      log.push({ id: observation.id, outcome: 'reply-lost', facts: committed.messages.length });
      throw new TypeError('SIMULATED connection reset after the realm committed');
    }
    log.push({ id: observation.id, outcome: committed.status, facts: committed.messages.length });
    return { http: 202, body: { version: 1, status: committed.status } };
  }

  /** The public checkpoint a room sends on `bootstrap`: lasting state only, never a beat to replay. */
  function checkpoint(): RealmBootstrap {
    return { version: 1, kingdomId, writerEpoch, throughSequence: 0, throughCursor: cursor, layoutRevision: options.layoutRevision,
      collisionRevision: options.collisionRevision, current: [{ type: 'moments.current', throughSeq, facts: current }] };
  }

  return {
    accept,
    checkpoint,
    /** Queue failures for the next attempts, in order. */
    fail(...next: RelayFault[]) { faults.push(...next); },
    /** A lasting outage: every attempt is answered unavailable until it ends. */
    outage(on: boolean) { down = on; },
    /** A room bridge for `observeRealm`: bootstrap answers with the checkpoint, committed rows arrive as `world`. */
    room(): RealmObservedRoom & { close(): void } {
      const handlers = new Map<string, (payload: never) => void>();
      const emit = (type: string, payload: unknown) => handlers.get(type)?.(payload as never);
      rooms.add(emit);
      return {
        onMessage(type, callback) { handlers.set(type, callback); return () => { handlers.delete(type); }; },
        send(type) { if (type === 'bootstrap' && rooms.has(emit)) queueMicrotask(() => emit('bootstrap', checkpoint())); },
        close() { rooms.delete(emit); handlers.clear(); },
      };
    },
    /** At-least-once delivery: send the newest row again, as a reconnecting dispatcher may. */
    redeliver() { const row = rows.at(-1); if (row) publish(row); },
    /** Another process takes the writer lease: a new epoch, so observers fetch a fresh checkpoint. */
    takeover() { writerEpoch = `SIMULATED-writer-${++writers}`; },
    get writerEpoch() { return writerEpoch; },
    rows: (): readonly RealmPublicDelivery[] => rows,
    log: (): readonly RelayLogEntry[] => log,
    /** Private record inspection for tests; never shown or sent anywhere. */
    records: () => records.dump(kingdomId),
  };
}
export type SimulatedRealmRelay = ReturnType<typeof createSimulatedRealmRelay>;

function unavailable(id: string, log: RelayLogEntry[]): RelayReply {
  log.push({ id, outcome: 'unavailable', facts: 0 });
  return { http: 503, body: { version: 1, status: 'unavailable', message: 'The realm could not commit this support act. Send it again; delivery is idempotent.' } };
}
