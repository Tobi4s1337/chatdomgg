import { TwitchRequestError } from './errors';
import { remainingFromHeaders, resetFromHeaders } from './transport';

export interface RequestBudgetOptions {
  /** Requests in flight at once. */
  readonly maxConcurrent?: number;
  /** Requests allowed to wait for a slot; beyond this a call fails fast as `overloaded`. */
  readonly maxQueued?: number;
  /**
   * Points left untouched for other services on the same client ID (the Surveyor reads with these app keys
   * too). When Twitch reports this many or fewer, requests wait for the bucket's reset.
   */
  readonly reservePoints?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/**
 * Shared admission for one client ID's Helix bucket: bounded concurrency, a bounded queue and respect for
 * `Ratelimit-Remaining`/`Ratelimit-Reset` and 429. Nothing waits past its own deadline.
 */
export class RequestBudget {
  readonly #maxConcurrent: number;
  readonly #maxQueued: number;
  readonly #reserve: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  readonly #queue: Waiter[] = [];
  #active = 0;
  #remaining: number | null = null;
  #resetAt = 0;

  constructor(options: RequestBudgetOptions = {}) {
    this.#maxConcurrent = options.maxConcurrent ?? 4;
    this.#maxQueued = options.maxQueued ?? 64;
    this.#reserve = options.reservePoints ?? 100;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? abortableSleep;
  }

  get snapshot(): { readonly active: number; readonly queued: number; readonly remaining: number | null; readonly resetAt: number } {
    return { active: this.#active, queued: this.#queue.length, remaining: this.#remaining, resetAt: this.#resetAt };
  }

  async run<T>(operation: string, deadline: number, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    await this.#admit(operation, deadline, signal);
    try {
      await this.#awaitPoints(operation, deadline, signal);
      // Waiting for a slot or for points may have used up the caller's time; a late request is never sent.
      if (this.#now() >= deadline) throw new TwitchRequestError('timeout', operation);
      return await task();
    } finally {
      this.#release();
    }
  }

  observe(headers: Headers, status: number): void {
    const remaining = remainingFromHeaders(headers);
    const resetAt = resetFromHeaders(headers);
    if (resetAt !== null) this.#resetAt = resetAt;
    // A 429 that still reports points left is a resource limit (conduits, subscriptions), not pacing: trust the
    // header. Without one, assume the bucket is empty until its reset.
    if (remaining !== null) this.#remaining = remaining;
    else if (status === 429) this.#remaining = 0;
  }

  async #admit(operation: string, deadline: number, signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) throw new TwitchRequestError('aborted', operation);
    if (this.#active < this.#maxConcurrent) {
      this.#active += 1;
      return;
    }
    if (this.#queue.length >= this.#maxQueued) throw new TwitchRequestError('overloaded', operation);
    const wait = deadline - this.#now();
    if (wait <= 0) throw new TwitchRequestError('timeout', operation);
    await new Promise<void>((resolve, reject) => {
      // The deadline timer runs on the injected sleep and is cancelled the moment the waiter leaves the queue.
      const expiry = new AbortController();
      const leave = (error: TwitchRequestError | null) => {
        const index = this.#queue.indexOf(waiter);
        if (index < 0) return;
        this.#queue.splice(index, 1);
        expiry.abort();
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
      };
      const waiter: Waiter = {
        resolve: () => {
          expiry.abort();
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject,
      };
      const onAbort = () => leave(new TwitchRequestError('aborted', operation));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#queue.push(waiter);
      void this.#sleep(wait, expiry.signal).then(() => {
        if (!expiry.signal.aborted) leave(new TwitchRequestError('timeout', operation));
      });
    });
  }

  #release(): void {
    const next = this.#queue.shift();
    if (next) next.resolve();
    else this.#active -= 1;
  }

  async #awaitPoints(operation: string, deadline: number, signal: AbortSignal | undefined): Promise<void> {
    const now = this.#now();
    if (this.#remaining === null || this.#remaining > this.#reserve) return;
    if (this.#resetAt <= now) {
      this.#remaining = null;
      return;
    }
    if (this.#resetAt > deadline) throw new TwitchRequestError('rate_limited', operation, null, this.#resetAt);
    await this.#sleep(this.#resetAt - now, signal);
    if (signal?.aborted) throw new TwitchRequestError('aborted', operation);
    this.#remaining = null;
  }
}

export function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, Math.max(0, ms));
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
