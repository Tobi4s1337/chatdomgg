/**
 * Gate changes another process committed. The realm lands an outgoing raid on Twitch's word in the shared gate
 * tables, and recovery may run in either process; the API's in-process fan-out alone would never hear of those
 * commits. While anyone in this process is watching a kingdom's gate, its open actions' revisions are read from
 * storage every few seconds and any revision this process has not yet announced is announced. The change carries
 * nothing private: each stream recomputes its own view.
 */
import type { KingdomId } from '../../../../packages/shared/src/identity';
import type { GateChange, GateFanout } from './http';
import type { SqlQueryable } from './session';

export const GATE_CHANGE_POLL_MS = 2_000;
/** Actions of one kingdom read per pass: the open ones and anything that settled in the last few minutes. */
const ACTIONS_PER_PASS = 16;

export type PolledGateFanoutOptions = Readonly<{
  pool: SqlQueryable;
  everyMs?: number;
  onError?: (error: unknown) => void;
}>;

export interface PolledGateFanout extends GateFanout {
  /** One pass now, for tests and shutdown-free checks. */
  poll(): Promise<void>;
  close(): void;
}

type Seen = Map<string, number>;


export function createPolledGateFanout(inner: GateFanout, options: PolledGateFanoutOptions): PolledGateFanout {
  const watched = new Map<KingdomId, { listeners: number; seen: Seen | null }>();
  const every = options.everyMs ?? GATE_CHANGE_POLL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;

  const announce = (change: GateChange) => {
    const entry = watched.get(change.kingdomId);
    if (entry?.seen) entry.seen.set(change.requestId, Math.max(entry.seen.get(change.requestId) ?? 0, change.revision));
  };

  async function pass(): Promise<void> {
    for (const [kingdomId, entry] of [...watched]) {
      const result = await options.pool.query(`
        (select p.request_id, a.revision::text as revision from realm_raid_gate_pointers p
           join realm_raid_gate_actions a on a.request_id = p.request_id where p.kingdom_id = $1)
        union
        (select request_id, revision::text as revision from realm_raid_gate_actions
           where from_kingdom_id = $1 and state in ('prepared', 'dispatching', 'pending', 'unknown', 'landed')
           order by revision desc limit ${ACTIONS_PER_PASS})`, [kingdomId]);
      const rows = result.rows as { request_id?: unknown; revision?: unknown }[];
      const current = watched.get(kingdomId);
      if (current !== entry) continue;
      entry.seen ??= new Map();
      for (const row of rows) {
        if (typeof row.request_id !== 'string' || typeof row.revision !== 'string') continue;
        const revision = Number(row.revision);
        if (!Number.isSafeInteger(revision) || revision < 1) continue;
        const known = entry.seen.get(row.request_id);
        entry.seen.set(row.request_id, Math.max(known ?? 0, revision));
        // A first sighting is announced too: a commit can land between a stream's own first view and this read, and
        // an extra recomputation costs one read.
        if (known === undefined || revision > known) inner.changed({ kingdomId, requestId: row.request_id, revision });
      }
    }
  }

  const poll = () => running ??= pass().catch(error => { options.onError?.(error); }).finally(() => { running = null; });
  const start = () => {
    if (timer || every <= 0) return;
    timer = setInterval(() => { void poll(); }, every);
    timer.unref?.();
  };
  const stopIfIdle = () => {
    if (watched.size > 0 || !timer) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    changed(change) {
      announce(change);
      inner.changed(change);
    },
    listen(kingdomId, listener) {
      const stop = inner.listen(kingdomId, listener);
      const entry = watched.get(kingdomId) ?? { listeners: 0, seen: null };
      entry.listeners += 1;
      watched.set(kingdomId, entry);
      start();
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        stop();
        entry.listeners -= 1;
        if (entry.listeners <= 0 && watched.get(kingdomId) === entry) watched.delete(kingdomId);
        stopIfIdle();
      };
    },
    poll,
    close() {
      watched.clear();
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
