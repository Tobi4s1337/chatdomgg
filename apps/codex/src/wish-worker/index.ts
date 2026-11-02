import type { KingdomForgeCommand, KingdomForgeLease } from '@chatdom/shared/realm';
import type { KingdomForgeResult } from '../kingdom-forge/application';
import { FileForgeWishQueue, type ForgeWishClaim, type ForgeWishReceipt,
  type ForgeWishTerminal, type ForgeWishWithdrawal } from '../wish-queue';

export interface ForgeWishExecutionControl {
  /** Service lifetime. Its loss suspends the wish rather than withdrawing it. */
  readonly lease: KingdomForgeLease;
  readonly withdrawal: AbortSignal;
  /** First commits follow accepted sequence within each kingdom. Recovery of a committed piece bypasses it. */
  readonly canCommit: () => boolean;
  /** Earlier accepted work acquires its anvil before later drafts can occupy the remaining capacity. */
  readonly canReserve: () => boolean;
}
export interface ForgeWishWorkerOptions {
  readonly queue: FileForgeWishQueue;
  readonly execute: (claim: ForgeWishClaim, control: ForgeWishExecutionControl) => Promise<KingdomForgeResult>;
  /** A projection/transport notification only. The durable reply is never consumed by this callback. */
  readonly completed?: (receipt: ForgeWishReceipt, lease: KingdomForgeLease) => Promise<void>;
  readonly maxConcurrent?: number;
  readonly retryMs?: number;
  readonly now?: () => number;
}
const pending = (value: KingdomForgeResult) => value.kind === 'recovery-needed' || value.kind === 'already-committed';
function terminal(value: KingdomForgeResult): ForgeWishTerminal | undefined {
  if (value.kind === 'committed') return { kind: 'committed', runId: value.attachment.runId, committedAt: value.attachment.committedAt };
  if (value.kind === 'held' || value.kind === 'cold' || value.kind === 'canceled' || value.kind === 'refused') return { kind: value.kind };
  return undefined;
}
function message(value: KingdomForgeResult): string {
  if (value.privateMessage) return value.privateMessage;
  if (value.kind === 'refused') return value.message;
  if (value.kind === 'committed') return 'Your piece has found its home.';
  if (value.kind === 'canceled') return 'The wish has stopped. Your coal stays yours.';
  if (value.kind === 'held') return 'Your wish waits privately at the Forge. Your coal stays yours.';
  return 'The forge fire needs another moment. Your coal stays yours.';
}

/** Owns bounded work, not coal, approvals or public publication. All outcomes come from the real coordinator. */
export class ForgeWishWorker {
  private readonly lifetime = new AbortController();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly unfinished = new Set<string>();
  private readonly later = new Map<string, number>();
  private readonly notifications = new Map<string, ForgeWishReceipt>();
  private readonly notifying = new Map<string, Promise<void>>();
  private readonly notificationLater = new Map<string, number>();
  private readonly maximum: number;
  private readonly retryMs: number;
  private readonly clock: () => number;
  private pumping = false;
  private again = false;
  private started = false;
  private stopping = false;
  private failed = false;
  private pumpTask: Promise<void> = Promise.resolve();
  private starting: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly options: ForgeWishWorkerOptions) {
    this.maximum = options.maxConcurrent ?? 2;
    this.retryMs = options.retryMs ?? 1_000;
    this.clock = options.now ?? Date.now;
    if (!Number.isInteger(this.maximum) || this.maximum < 1 || this.maximum > 64
      || !Number.isInteger(this.retryMs) || this.retryMs < 100 || this.retryMs > 30_000) throw new Error('Invalid Forge worker bounds.');
  }

  get activeCount(): number { return this.jobs.size; }

  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (this.stopping || this.failed) throw new Error('The Forge worker is unavailable.');
      const receipts = await this.options.queue.list();
      for (const receipt of receipts) {
        if (receipt.state !== 'finished') this.unfinished.add(receipt.key);
        else if (receipt.delivery && !receipt.delivery.acknowledged) this.notifications.set(receipt.key, receipt);
      }
      if (this.stopping) return;
      this.started = true; this.wake();
    })().catch(error => { this.fail(); throw error; });
    return this.starting;
  }

  /** Acknowledge arrival only after the queue has synced the exact command and its duplicate binding. */
  async admit(command: KingdomForgeCommand) {
    if (this.stopping || this.failed) throw new Error('The Forge worker is unavailable.');
    const accepted = await this.options.queue.enqueue(command);
    if (accepted.receipt.state !== 'finished') this.unfinished.add(accepted.receipt.key);
    else if (accepted.receipt.delivery && !accepted.receipt.delivery.acknowledged)
      this.notifications.set(accepted.receipt.key, accepted.receipt);
    this.wake(); return accepted;
  }

  /** Queue.withdraw raises its synchronous barrier before this method returns the durability promise. */
  withdraw(input: ForgeWishWithdrawal): Promise<void> {
    if (this.stopping || this.failed) return Promise.reject(new Error('The Forge worker is unavailable.'));
    const persisted = this.options.queue.withdraw(input);
    return persisted.then(() => { this.wake(); }, () => { this.fail(); throw new Error('The Forge withdrawal is awaiting recovery.'); });
  }

  /** Suspend and settle owned work. Projection callbacks receive the aborted lease; they never own the queue. */
  stop(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true; this.lifetime.abort(); clearTimeout(this.timer); this.timer = undefined;
    this.closing = (async () => {
      await this.starting?.catch(() => {});
      await this.pumpTask;
      await Promise.allSettled([...this.jobs.values()]);
    })();
    return this.closing;
  }

  private wake(): void {
    if (!this.started || this.stopping || this.failed) return;
    this.again = true;
    if (this.pumping) return;
    clearTimeout(this.timer); this.timer = undefined;
    this.pumping = true;
    this.pumpTask = Promise.resolve().then(async () => {
      do {
        this.again = false;
        while (!this.stopping && !this.failed && this.jobs.size < this.maximum) {
          const at = this.now(), excludeKeys = new Set([...this.jobs.keys(),
            ...[...this.later].filter(([, until]) => until > at).map(([key]) => key)]);
          const claim = await this.options.queue.claimNext({ excludeKeys });
          if (!claim) break;
          if (this.stopping) { await this.options.queue.retry(claim); break; }
          const job = Promise.resolve().then(() => this.perform(claim)).catch(() => this.fail()).finally(() => {
            this.jobs.delete(claim.receipt.key); this.wake();
          });
          this.jobs.set(claim.receipt.key, job);
        }
        this.notify();
      } while (this.again && !this.stopping && !this.failed);
    }).catch(() => this.fail()).finally(() => {
      this.pumping = false;
      if (this.again) this.wake();
      else if (!this.stopping && !this.failed && (this.unfinished.size > this.jobs.size || this.notifications.size)) {
        const deadlines = [...this.later.values()].filter(until => until > this.now());
        const delay = deadlines.length ? Math.max(1, Math.min(this.retryMs, Math.min(...deadlines) - this.now())) : this.retryMs;
        this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, delay); this.timer.unref?.();
      }
    });
  }

  private async perform(claim: ForgeWishClaim): Promise<void> {
    const lease: KingdomForgeLease = { signal: this.lifetime.signal,
      current: () => !this.stopping && !this.failed && claim.current() && !this.lifetime.signal.aborted };
    let result: KingdomForgeResult;
    try {
      result = await this.options.execute(claim, { lease, withdrawal: claim.withdrawal,
        canCommit: () => this.options.queue.canCommit(claim), canReserve: () => this.options.queue.canReserve(claim) });
    } catch { result = { kind: 'recovery-needed', ...claim.attempt }; }
    if (!claim.current()) return;
    const outcome = terminal(result);
    if (this.stopping || pending(result) || !outcome) {
      await this.options.queue.retry(claim);
      this.later.set(claim.receipt.key, this.now() + this.retryMs); return;
    }
    const receipt = await this.options.queue.complete(claim, { terminal: outcome, message: message(result) });
    this.unfinished.delete(claim.receipt.key); this.later.delete(claim.receipt.key);
    this.notifications.set(receipt.key, receipt);
  }

  private notify(): void {
    if (!this.options.completed) { this.notifications.clear(); return; }
    for (const [key, receipt] of [...this.notifications]) {
      if (this.stopping || this.failed || this.notifying.size >= this.maximum) return;
      if (this.notifying.has(key) || (this.notificationLater.get(key) ?? 0) > this.now()) continue;
      const lease: KingdomForgeLease = { signal: this.lifetime.signal,
        current: () => !this.stopping && !this.failed && !this.lifetime.signal.aborted };
      const work = Promise.resolve().then(() => this.options.completed!(receipt, lease));
      this.notifying.set(key, work);
      void work.then(() => {
        if (this.notifications.get(key) === receipt) this.notifications.delete(key);
        this.notificationLater.delete(key);
      }, () => {
        // A failed projection retries with backoff, never in a self-waking microtask loop.
        this.notificationLater.set(key, this.now() + this.retryMs);
      }).finally(() => {
        if (this.notifying.get(key) === work) this.notifying.delete(key);
        this.wake();
      }).catch(() => this.fail());
    }
  }

  private now(): number {
    const at = this.clock();
    if (!Number.isSafeInteger(at) || at < 0) throw new Error('The Forge clock is unavailable.');
    return at;
  }
  private fail(): void { this.failed = true; this.lifetime.abort(); clearTimeout(this.timer); this.timer = undefined; }
}
