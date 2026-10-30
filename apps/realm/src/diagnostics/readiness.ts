import { performance } from 'node:perf_hooks';
import { ServerError } from '@colyseus/core';
import type { RealmAuthenticator } from '@chatdom/shared/realm';
import { REALM_READINESS_LIMITS, within } from '../limits';
import { describeStorageFailure, type RealmDatabase } from '../persistence/database';

export type RealmDependency = 'database' | 'auth' | 'writer';

export interface RealmProbe {
  readonly name: RealmDependency;
  /** Resolves when the dependency answers correctly; throws (or never settles) otherwise. */
  readonly check: () => Promise<void>;
}

export interface RealmReadinessLimits { readonly probeEveryMs: number; readonly probeTimeoutMs: number; readonly holdAfterFailures: number }

export interface RealmDependencyStatus {
  readonly ready: boolean;
  /** Secret-free reason for the last failure; null while ready. */
  readonly reason: string | null;
  readonly latencyMs: number | null;
  readonly checkedAt: number | null;
  readonly failures: number;
}

export interface RealmReadinessReport {
  readonly version: 1;
  readonly alive: true;
  readonly ready: boolean;
  /** Why owned actions are held right now, or null. */
  readonly held: string | null;
  readonly uptimeMs: number;
  readonly dependencies: Readonly<Record<RealmDependency, RealmDependencyStatus>>;
}

const HELD_BECAUSE: Record<RealmDependency, string> = {
  database: 'the realm database is not answering',
  auth: 'the session service is not answering',
  writer: 'this server holds no current writer lease',
};

/**
 * Alive is the process answering; ready is every dependency answering. Each probe runs on its own cadence with a hard
 * timeout, and a dependency is held only after `holdAfterFailures` consecutive misses, so one slow answer is not an
 * outage. While held, kingdoms refuse new owned actions at once (`realm.held`) instead of queueing behind it.
 */
export class RealmReadiness {
  private readonly status = new Map<RealmDependency, RealmDependencyStatus>();
  private readonly started = performance.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private probing = false;

  constructor(private readonly probes: readonly RealmProbe[], private readonly limits: RealmReadinessLimits = REALM_READINESS_LIMITS) {
    for (const probe of probes) this.status.set(probe.name, { ready: false, reason: 'not checked yet', latencyMs: null, checkedAt: null, failures: 0 });
  }

  /** Probes once now, then on the cadence. */
  async start(): Promise<RealmReadinessReport> {
    await this.probe();
    this.timer ??= setInterval(() => void this.probe(), this.limits.probeEveryMs);
    this.timer.unref?.();
    return this.report();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Runs every probe once (concurrently, each bounded). Overlapping calls share nothing and skip. */
  async probe(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      await Promise.all(this.probes.map(async probe => {
        const begun = performance.now();
        const prior = this.status.get(probe.name)!;
        try {
          await within(probe.check(), this.limits.probeTimeoutMs, () => new ProbeTimeoutError());
          this.status.set(probe.name, { ready: true, reason: null, latencyMs: Math.round(performance.now() - begun), checkedAt: Date.now(), failures: 0 });
        } catch (error) {
          const reason = error instanceof ProbeTimeoutError ? `no answer within ${this.limits.probeTimeoutMs} ms` : error instanceof ProbeFailure ? error.message : describeStorageFailure(error);
          this.status.set(probe.name, { ready: false, reason, latencyMs: null, checkedAt: Date.now(), failures: prior.failures + 1 });
        }
      }));
    } finally { this.probing = false; }
  }

  /** Why owned actions are held, or null. Cheap: reads the last probe results only. */
  held(): string | null {
    for (const [name, status] of this.status) {
      if (!status.ready && status.failures >= this.limits.holdAfterFailures) return HELD_BECAUSE[name];
    }
    return null;
  }

  report(): RealmReadinessReport {
    const dependencies = Object.fromEntries(this.status) as Record<RealmDependency, RealmDependencyStatus>;
    return { version: 1, alive: true, ready: [...this.status.values()].every(s => s.ready), held: this.held(),
      uptimeMs: Math.round(performance.now() - this.started), dependencies };
  }
}

class ProbeTimeoutError extends Error {}
/** A probe's own secret-free failure description. */
export class ProbeFailure extends Error {}

/** `SELECT 1` through the pool: connection, credentials and statement path. */
export const databaseProbe = (db: Pick<RealmDatabase, 'query'>): RealmProbe => ({
  name: 'database', check: async () => { await db.query('SELECT 1'); },
});

/** The session tables the authenticator reads on every entry and recheck. */
export const authProbe = (db: Pick<RealmDatabase, 'query'>): RealmProbe => ({
  name: 'auth', check: async () => { await db.query('SELECT 1 FROM realm_sessions LIMIT 1'); },
});

/**
 * Every kingdom this process has open holds a current lease that is renewing: at least a third of its local window
 * remains. Renewals run three times per window, so less means two renewals in a row did not land. No open kingdom is
 * ready (there is nothing to own).
 */
export const writerProbe = (kingdoms: () => Iterable<{ readonly kingdomId: string; readonly writer: { readonly current: boolean; readonly remainingMs: number; readonly windowMs: number } }>): RealmProbe => ({
  name: 'writer',
  check: async () => {
    const stale = [...kingdoms()].filter(k => !k.writer.current || k.writer.remainingMs < k.writer.windowMs / 3).map(k => k.kingdomId);
    if (stale.length) throw new ProbeFailure(`the writer lease is not renewing for kingdom ${stale.join(', ')}`);
  },
});

/**
 * Entry while a dependency is held: a new walker is refused with 503 and the reason, before a ticket is burned or an
 * avatar exists. Session rechecks (`current`) are untouched; their own failures already end entries explicitly.
 */
export function holdEntry(auth: RealmAuthenticator, held: () => string | null): RealmAuthenticator {
  return {
    authenticate(join) {
      const reason = held();
      if (reason) return Promise.reject(new ServerError(503, `The kingdom is not taking new arrivals while ${reason}. Nothing was changed; try again shortly.`));
      return auth.authenticate(join);
    },
    current: (principal, now) => auth.current(principal, now),
  };
}
