import type { PresenceInput, RaidGuestVisualMark } from '@chatdom/shared';
import type { DurableKingdom, RealmLifecycleListener } from '../persistence/kingdom';
import type { RaidGuestProjection, RaidGuestRoomReceipt } from '../../../api/src/raid-gate/guest-contracts';
import { RaidGuestProjectionSchema } from '../../../api/src/raid-gate/guest-contracts';
import type { RaidGuestAuthority } from './guests';
import type { TownSettler } from '../moments/service';
import { deriveRaidGuestVisualMark } from './guest-insignia';

const MAX_PENDING = 1_024, WORKERS = 4, CHAT_BARRIER_MS = 5_000;
type ReceiptJob = { kind: 'join' | 'leave' | 'present'; receipt: RaidGuestRoomReceipt; done: Promise<void>; finish(): void;
  running: boolean; attempts: number; retry?: ReturnType<typeof setTimeout> };
export interface RaidGuestRuntimeOptions {
  readonly origin: 'live' | 'simulated';
  readonly authority: Pick<RaidGuestAuthority, 'arrived' | 'departed' | 'present' | 'observePresence' | 'visitors'>;
  readonly citizens: (input: PresenceInput) => Promise<void>;
  readonly log?: (message: string) => void;
  readonly clock?: () => number;
}

/** Actual room callbacks only. A failed receipt stays pending; it never turns authentication into an arrival. */
export function createRaidGuestRuntime(options: RaidGuestRuntimeOptions) {
  const pending = new Map<string, ReceiptJob>(), running = new Set<Promise<void>>();
  const subscriptions = new Set<() => void>();
  type Seat = { receipt: RaidGuestRoomReceipt; confirmed: boolean; guest?: RaidGuestProjection; publish(mark: RaidGuestVisualMark | null): void };
  const seats = new Map<string, Seat>();
  const dress = (seat: Seat, mark: RaidGuestVisualMark | null) => {
    try { seat.publish(mark); } catch { options.log?.('Raid guest dress could not be updated; no new arrival was inferred.'); }
  };
  const now = options.clock ?? Date.now;
  let stopping = false, closed = false, failures = 0, overflow = 0;

  function pump() {
    if (closed) return;
    for (const [key, job] of pending) {
      if (running.size >= WORKERS) break;
      if (job.running || job.retry) continue;
      job.running = true;
      const expectedSeat = seats.get(job.receipt.entryId);
      const attempt = Promise.resolve().then(() => job.kind === 'join'
        ? options.authority.arrived(job.receipt) : job.kind === 'leave' ? options.authority.departed(job.receipt) : options.authority.present(job.receipt)).then(result => {
        const seat = seats.get(job.receipt.entryId);
        // A DB result may arrive after leave/detach or a replacement seat. It cannot dress that later visitor.
        if (seat && seat === expectedSeat) {
          if (result.status === 'refused') { dress(seat, null); seats.delete(job.receipt.entryId); }
          else if (job.kind === 'join' && 'guest' in result) {
            seat.guest = RaidGuestProjectionSchema.parse(result.guest); seat.confirmed = true;
            dress(seat, deriveRaidGuestVisualMark(seat.guest, job.receipt.at, Math.floor(now())));
          } else if (job.kind === 'present' && seat.guest) {
            dress(seat, deriveRaidGuestVisualMark(seat.guest, job.receipt.at, Math.floor(now())));
          }
        }
        pending.delete(key); job.finish();
      }).catch(() => {
        failures++; job.attempts++;
        options.log?.('Raid guest receipt could not commit; retrying without granting a welcome.');
        if (!closed) {
          job.retry = setTimeout(() => { delete job.retry; pump(); }, Math.min(5_000, 250 * 2 ** Math.min(5, job.attempts)));
          job.retry.unref();
        }
      }).finally(() => { job.running = false; running.delete(attempt); pump(); });
      running.add(attempt);
    }
  }
  function enqueue(kind: ReceiptJob['kind'], receipt: RaidGuestRoomReceipt) {
    const key = `${kind}:${receipt.entryId}`;
    if (pending.has(key)) return;
    if (pending.size >= MAX_PENDING) {
      overflow++; options.log?.('Raid guest receipt capacity was reached; no raid arrival was acknowledged.'); return;
    }
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    pending.set(key, { kind, receipt, done, finish, running: false, attempts: 0 });
    pump();
  }
  const queue = (event: Parameters<RealmLifecycleListener>[0], principal: Parameters<RealmLifecycleListener>[1],
    at: number, publish: Seat['publish']) => {
    if (stopping || event !== 'join' && event !== 'leave' || principal.origin !== options.origin) return;
    const receipt: RaidGuestRoomReceipt = { version: 1, origin: principal.origin, entryId: principal.sessionId,
      personId: principal.personId, kingdomId: principal.kingdomId, at };
    if (event === 'join') {
      const previous = seats.get(receipt.entryId); if (previous) dress(previous, null);
      seats.set(receipt.entryId, { receipt, confirmed: false, publish });
    } else {
      const previous = seats.get(receipt.entryId); if (previous) dress(previous, null);
      seats.delete(receipt.entryId);
    }
    enqueue(event, receipt);
  };
  // A dead process cannot renew these leases. Authentication rows never reconstruct a current walker.
  const heartbeat = setInterval(() => {
    if (!stopping) for (const seat of seats.values()) if (seat.confirmed) enqueue('present', { ...seat.receipt, at: Math.floor(now()) });
  }, 15_000);
  heartbeat.unref();
  async function barrier(jobs: readonly ReceiptJob[], timeout: number) {
    if (!jobs.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all(jobs.map(job => job.done)), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The room arrival has not committed yet.')), timeout);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  return {
    attach(kingdom: Pick<DurableKingdom, 'onLifecycle'> & Partial<Pick<DurableKingdom, 'presentRaidGuest'>>): () => void {
      if (stopping) throw new Error('Raid guest callbacks are closed.');
      const entries = new Set<string>();
      let detached = false;
      const off = kingdom.onLifecycle((event, principal, walker, at) => {
        if (detached) return;
        if (principal.origin === options.origin) {
          if (event === 'join') entries.add(principal.sessionId);
          else if (event === 'leave') entries.delete(principal.sessionId);
        }
        queue(event, principal, at, mark => kingdom.presentRaidGuest?.(walker, mark));
      });
      const detach = () => {
        detached = true;
        subscriptions.delete(detach); off();
        // A retired room no longer witnesses presence, even when no explicit leave callback ran.
        for (const entryId of entries) { const seat = seats.get(entryId); if (seat) dress(seat, null); seats.delete(entryId); }
        entries.clear();
      };
      subscriptions.add(detach); return detach;
    },
    /** Runs before ordinary settlement, while the original observation still reaches presence ingress unchanged. */
    async observe(input: PresenceInput): Promise<void> {
      if (stopping) throw new Error('Raid guest observation is closed.');
      if (input.kind === 'observe' && input.source === 'chat') {
        const people = new Set(input.people.map(person => person.personId));
        await barrier([...pending.values()].filter(job => job.kind === 'join' && people.has(job.receipt.personId)
          && job.receipt.kingdomId === input.kingdomId), CHAT_BARRIER_MS);
      }
      await options.authority.observePresence(input);
      if (input.kind !== 'observe' || input.source !== 'chat') { await options.citizens(input); return; }
      const visitors = new Set(await options.authority.visitors(input.kingdomId, input.people.map(person => person.personId), input.providerAt ?? input.observedAt));
      const people = input.people.filter(person => !visitors.has(person.personId));
      if (people.length) await options.citizens(people.length === input.people.length ? input : { ...input, people });
    },
    /** Follows, shared subs and kingdom rewards also pass the same visitor guard before automatic settlement. */
    guardSettler(settler: TownSettler): TownSettler {
      return { async settle(kingdom, person, tenure) {
        if (stopping) throw new Error('Raid guest settlement guard is closed.');
        await barrier([...pending.values()].filter(job => job.kind === 'join' && job.receipt.personId === person.personId
          && job.receipt.kingdomId === kingdom.kingdomId), CHAT_BARRIER_MS);
        const visitors = await options.authority.visitors(kingdom.kingdomId, [person.personId], Math.floor(kingdom.databaseNow()));
        return visitors.includes(person.personId) ? null : settler.settle(kingdom, person, tenure);
      } };
    },
    flush: (timeout = 10_000) => barrier([...pending.values()], timeout),
    health: () => ({ pending: pending.size, running: running.size, failures, overflow, closed: stopping }),
    async close() {
      if (closed) return;
      stopping = true;
      clearInterval(heartbeat);
      for (const off of [...subscriptions]) off();
      try { await barrier([...pending.values()], 5_000); }
      catch { options.log?.('Raid guest shutdown left an unacknowledged room receipt; a new actual join is required.'); }
      closed = true;
      for (const job of pending.values()) if (job.retry) clearTimeout(job.retry);
      await Promise.allSettled([...running]);
      for (const job of pending.values()) job.finish();
      pending.clear();
      for (const seat of seats.values()) dress(seat, null);
      seats.clear();
    },
  };
}
