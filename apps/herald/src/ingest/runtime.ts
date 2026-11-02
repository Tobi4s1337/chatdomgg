import {
  ConduitShardConnection, type DeliveryFrame, type EventSubAdmin, isTwitchFailure, type ShardHealth, type SocketFactory,
} from '@chatdom/twitch';
import type { AuthorityEvent } from '../auth/authority';
import type { Capability, Role } from '../auth/grants';
import type { PresenceSource } from '../source/source';
import { ChatIngest, type IngestHealth, type IngestOptions } from './ingest';
import {
  type CoverageState, planSubscriptions, reconcileSubscriptions, subscriptionIdentity, type SubscriptionCoverage, type SubscriptionPlan,
} from './subscriptions';

/** What the runtime needs from the authorization authority. */
export interface DeliveryAuthority {
  available(capability: Capability): boolean;
  on(listener: (event: AuthorityEvent) => void): () => void;
  refresh(): Promise<unknown>;
  revoked(userId: string): Role[];
}

export type ConduitCondition = 'checking' | 'ready' | 'missing' | 'wrong_shape' | 'unreachable';

export interface DeliveryHealth {
  readonly conduit: ConduitCondition;
  /** Chat may be published: shard attached, chat grants verified, every required subscription enabled. */
  readonly covered: boolean;
  readonly shard: ShardHealth;
  readonly coverage: readonly SubscriptionCoverage[];
  readonly verifiedAt: number | null;
  readonly unexpectedSubscriptions: number;
  /** Delivery lost and later restored. Twitch does not replay what happened in between. */
  readonly gaps: { readonly count: number; readonly openSince: number | null; readonly last: { readonly from: number; readonly to: number } | null };
  readonly ingest: IngestHealth;
}

export interface DeliveryRuntimeOptions {
  readonly conduitId: string;
  readonly clientId: string;
  readonly broadcasterId: string;
  readonly readerId: string;
  readonly admin: EventSubAdmin;
  readonly authority: DeliveryAuthority;
  readonly source: PresenceSource;
  readonly socketFactory?: SocketFactory;
  readonly url?: string;
  readonly now?: () => number;
  readonly random?: () => number;
  /** How often the shard and subscriptions are verified against Twitch while running. */
  readonly verifyEveryMs?: number;
  /** Delay before reverifying after a revocation or authorization change. */
  readonly settleMs?: number;
  /** Redacted operator lines: states and codes, never IDs, names or bodies. */
  readonly log?: (line: string) => void;
  /** Where pushed `stream.online`/`stream.offline` go (the live source's stream tracker). */
  readonly stream?: IngestOptions['stream'];
  readonly forge?: IngestOptions['forge'];
  readonly realm?: IngestOptions['realm'];
  /**
   * Reads current state again (Get Streams, Chatters) whenever coverage is restored. Twitch does not replay
   * a gap, so the source publishes again only after this has settled.
   */
  readonly reconcile?: (after: 'start' | 'gap') => Promise<void>;
}

const VERIFY_EVERY_MS = 60_000;
const SETTLE_MS = 2_000;

/**
 * Real chat delivery for one kingdom: the configured conduit, one outgoing shard, the seven subscriptions
 * and the ingest. The source is available only while delivery and cleanup coverage are complete; any loss
 * closes it at once, so the kingdom never shows frames it cannot stand behind.
 */
export class DeliveryRuntime {
  readonly plans: readonly SubscriptionPlan[];
  readonly #options: DeliveryRuntimeOptions;
  readonly #now: () => number;
  readonly #shard: ConduitShardConnection;
  readonly #ingest: ChatIngest;
  readonly #log: (line: string) => void;
  #conduit: ConduitCondition = 'checking';
  #coverage: SubscriptionCoverage[];
  #verifiedAt: number | null = null;
  #unexpected = 0;
  #covered = false;
  /** Coverage is complete and the state after it has been reconciled: the source may publish. */
  #resumed = false;
  #resumeGeneration = 0;
  #verificationGeneration = 0;
  #everResumed = false;
  #gaps = { count: 0, last: null as { from: number; to: number } | null };
  #verifying: Promise<void> | null = null;
  #verifyAgain = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  #settleTimer: ReturnType<typeof setTimeout> | null = null;
  #abort = new AbortController();
  #unsubscribe: (() => void) | null = null;
  #stopped = false;

  constructor(options: DeliveryRuntimeOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => undefined);
    this.plans = planSubscriptions({ broadcasterId: options.broadcasterId, readerId: options.readerId, clientId: options.clientId });
    this.#coverage = this.plans.map(plan => ({ ...subscriptionIdentity(plan), type: plan.type, required: plan.required, state: 'unknown', reason: null }));
    this.#shard = new ConduitShardConnection({
      admin: options.admin, conduitId: options.conduitId, listener: {
        attached: (reason, gap) => {
          this.#verificationGeneration++;
          if (gap) {
            this.#gaps.count++;
            this.#gaps.last = gap;
            this.#log(`delivery restored after ${Math.round((gap.to - gap.from) / 1000)} s; events in that gap are lost, not replayed`);
          } else this.#log(`shard attached (${reason})`);
          this.#recompute();
          this.#scheduleVerify(0);
        },
        detached: reason => {
          this.#verificationGeneration++;
          this.#log(`shard detached (${reason}); not publishing until delivery is restored`);
          this.#recompute();
        },
        frame: frame => this.#frame(frame),
        fatal: reason => {
          this.#verificationGeneration++;
          this.#conduit = 'missing';
          this.#log(`conduit ${reason}: run provision:source`);
          this.#recompute();
        },
      },
      ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.random ? { random: options.random } : {}),
    });
    this.#ingest = new ChatIngest({
      source: options.source, conduitId: options.conduitId, clientId: options.clientId, plans: this.plans,
      covered: () => this.#covered && !this.#stopped,
      onAuthorizationRevoked: userId => {
        this.#verificationGeneration++;
        const roles = options.authority.revoked(userId);
        if (roles.length === 0) return;
        this.#log(`authorization withdrawn by the ${roles.join(' and ')}; delivery stops until a fresh grant`);
        this.#ingest.clear();
        this.#recompute();
        this.#scheduleVerify(this.#options.settleMs ?? SETTLE_MS);
      },
      onSubscriptionRevoked: (plan, status) => this.#revoked(plan, status),
      ...(options.stream ? { stream: options.stream } : {}),
      ...(options.forge ? { forge: options.forge } : {}),
      ...(options.realm ? { realm: options.realm } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  get covered(): boolean {
    return this.#covered;
  }

  health(): DeliveryHealth {
    return {
      conduit: this.#conduit, covered: this.#covered, shard: this.#shard.health(), coverage: [...this.#coverage],
      verifiedAt: this.#verifiedAt, unexpectedSubscriptions: this.#unexpected,
      gaps: { count: this.#gaps.count, openSince: this.#shard.health().lostSince, last: this.#gaps.last },
      ingest: this.#ingest.health(),
    };
  }

  /** Checks the configured conduit, then attaches the shard. Resolves once the conduit has been checked. */
  async start(): Promise<ConduitCondition> {
    this.#unsubscribe = this.#options.authority.on(event => {
      if (event.type === 'report') {
        this.#verificationGeneration++;
        this.#recompute();
        this.#scheduleVerify(this.#options.settleMs ?? SETTLE_MS);
      }
    });
    await this.#checkConduit();
    if (this.#stopped || this.#conduit === 'missing' || this.#conduit === 'wrong_shape') {
      this.#recompute();
      return this.#conduit;
    }
    this.#shard.start();
    this.#timer = setInterval(() => this.#scheduleVerify(0), this.#options.verifyEveryMs ?? VERIFY_EVERY_MS);
    this.#timer.unref?.();
    return this.#conduit;
  }

  /** Verifies now and resolves when that verification (or the one already running) is done. */
  async verify(): Promise<void> {
    if (this.#stopped) return;
    if (this.#verifying) {
      this.#verifyAgain = true;
      return this.#verifying;
    }
    const run = this.#runVerify().finally(() => {
      if (this.#verifying === run) this.#verifying = null;
      if (this.#verifyAgain && !this.#stopped) {
        this.#verifyAgain = false;
        this.#scheduleVerify(0);
      }
    });
    this.#verifying = run;
    return run;
  }

  /** Stops sockets and timers and forgets all transient chat data. */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#verificationGeneration++;
    this.#abort.abort();
    if (this.#timer) clearInterval(this.#timer);
    if (this.#settleTimer) clearTimeout(this.#settleTimer);
    this.#timer = this.#settleTimer = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#shard.stop();
    this.#ingest.dispose();
    this.#covered = false;
    this.#resumed = false;
  }

  #frame(frame: DeliveryFrame): void {
    if (this.#stopped) return;
    void this.#ingest.handle(frame)?.catch(() => this.#log('evidence could not be durably queued; see ingest and realm delivery health'));
  }

  #revoked(plan: SubscriptionPlan, status: string): void {
    this.#verificationGeneration++;
    const { key } = subscriptionIdentity(plan);
    this.#coverage = this.#coverage.map(entry => entry.key === key ? { ...entry, state: 'disabled' as CoverageState, reason: status } : entry);
    this.#log(`${key} subscription disabled by Twitch (${status})`);
    this.#recompute();
    void this.#options.authority.refresh().catch(() => undefined);
    this.#scheduleVerify(this.#options.settleMs ?? SETTLE_MS);
  }

  async #checkConduit(): Promise<void> {
    try {
      const shards = await this.#options.admin.getShards(this.#options.conduitId, { signal: this.#abort.signal });
      // Only shards that ever had a transport are listed; any shard but 0 means it is not ours to run alone.
      this.#conduit = shards.every(shard => shard.id === '0') ? 'ready' : 'wrong_shape';
    } catch (error) {
      this.#conduit = isTwitchFailure(error, 'not_found') ? 'missing' : 'unreachable';
    }
    if (this.#conduit === 'missing') this.#log('the configured conduit does not exist or belongs to another client: run provision:source');
    if (this.#conduit === 'wrong_shape') this.#log('the configured conduit is not a single-shard conduit: run provision:source');
  }

  async #runVerify(): Promise<void> {
    const generation = this.#verificationGeneration;
    const sessionId = this.#shard.sessionId;
    const obsolete = () => {
      if (!this.#stopped && generation === this.#verificationGeneration && sessionId === this.#shard.sessionId) return false;
      if (!this.#stopped) this.#verifyAgain = true;
      return true;
    };
    if (this.#conduit === 'unreachable') await this.#checkConduit();
    if (obsolete()) return;
    if (this.#stopped || this.#conduit !== 'ready' || !this.#shard.attached) return;
    const signal = this.#abort.signal;
    try {
      const shards = await this.#options.admin.getShards(this.#options.conduitId, { signal });
      if (obsolete()) return;
      const shard = shards.find(entry => entry.id === this.#shard.shardId);
      if (!shard || shard.status !== 'enabled' || sessionId === null || shard.sessionId !== sessionId) {
        // Twitch no longer delivers to our session. Repairing attaches a fresh one.
        this.#shard.repair(shard ? `shard_${shard.status}` : 'shard_missing');
        return;
      }
      const result = await reconcileSubscriptions({
        admin: this.#options.admin, conduitId: this.#options.conduitId, plans: this.plans,
        authorized: capability => this.#options.authority.available(capability), signal,
      });
      if (obsolete()) return;
      this.#coverage = [...result.coverage];
      this.#unexpected = result.unexpected;
      this.#verifiedAt = this.#now();
      if (result.created + result.deleted > 0) this.#log(`subscriptions reconciled: ${result.created} created, ${result.deleted} stale removed`);
    } catch (error) {
      if (obsolete() || isTwitchFailure(error, 'aborted')) return;
      if (isTwitchFailure(error, 'not_found')) {
        this.#conduit = 'missing';
        this.#shard.stop();
        this.#log('the configured conduit disappeared: run provision:source');
      } else {
        // Unknown is not missing: keep the last coverage, but stop claiming a fresh verification.
        this.#log(`verification failed (${isTwitchFailure(error) ? error.kind : 'unexpected'}); retrying`);
        this.#scheduleVerify((this.#options.settleMs ?? SETTLE_MS) * 5);
      }
    } finally {
      this.#recompute();
    }
  }

  #scheduleVerify(delayMs: number): void {
    if (this.#stopped) return;
    if (delayMs <= 0) {
      void this.verify();
      return;
    }
    if (this.#settleTimer) return;
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = null;
      void this.verify();
    }, delayMs);
    this.#settleTimer.unref?.();
  }

  #recompute(): void {
    const chatAuthorized = this.#options.authority.available('chat');
    const requiredEnabled = this.#coverage.every(entry => !entry.required || entry.state === 'enabled');
    const covered = !this.#stopped && this.#conduit === 'ready' && this.#shard.attached && chatAuthorized && requiredEnabled;
    const was = this.#covered;
    this.#covered = covered;
    if (covered) {
      if (!was) this.#resume();
      else if (this.#resumed) this.#options.source.setAvailable(true);
    } else {
      this.#resumed = false;
      this.#resumeGeneration++;
      this.#options.source.setAvailable(false, chatAuthorized ? 'chat_delivery_down' : 'unauthorized');
    }
  }

  /** Coverage just became complete: reconcile what a gap may have hidden, then publish a fresh projection. */
  #resume(): void {
    const generation = ++this.#resumeGeneration;
    const publish = () => {
      if (this.#stopped || !this.#covered || generation !== this.#resumeGeneration) return;
      this.#resumed = true;
      this.#log('chat delivery and cleanup coverage complete; publishing');
      this.#options.source.setAvailable(true);
    };
    if (!this.#options.reconcile) return publish();
    this.#log('chat delivery and cleanup coverage complete; reconciling stream state before publishing');
    const after = this.#everResumed ? 'gap' : 'start';
    this.#everResumed = true;
    void this.#options.reconcile(after).catch(() => undefined).finally(publish);
  }
}
