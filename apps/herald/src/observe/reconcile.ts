import { PRESENCE_MINUTE_MS, type KingdomId } from '@chatdom/shared';
import { isTwitchFailure, type HelixReader, type TwitchFailureKind } from '@chatdom/twitch';
import type { Capability } from '../auth/grants';
import { toPresenceInput } from '../source/observations';
import type { PresenceSource, SubmitResult } from '../source/source';
import { sweepChatters, type SweepEnd, type SweepResult } from './chatters';
import { StreamTracker, type StreamHealth, type StreamReason, type StreamTrackerOptions } from './stream';

/** One Get Streams request, including any wait for the shared budget. */
const STREAM_DEADLINE_MS = 10_000;

/** What the reconciler needs from the authorization authority. */
export interface ObservationAuthority {
  readonly generation?: number;
  available(capability: Capability): boolean;
  refresh(): Promise<unknown>;
}

export type ChattersCondition =
  /** The broadcaster has not granted `moderator:read:chatters`. */
  | 'unauthorized'
  /** No live broadcast is observed, so nobody is swept: Chatters is not a viewer list. */
  | 'waiting_for_live'
  /** Live and authorized; the first sweep has not finished yet. */
  | 'pending'
  | 'complete'
  | 'partial'
  | 'failed';

export interface ChattersCounters {
  sweeps: number;
  complete: number;
  partial: number;
  failed: number;
  /** A minute arrived while the previous sweep was still running; the minute was skipped, never queued. */
  overlapSkipped: number;
  pages: number;
  /** Partial ends by cause, so a cap hit is never silent. */
  pageLimit: number;
  deadline: number;
  repeatedCursor: number;
  pageFailed: number;
}

export interface ChattersHealth {
  readonly condition: ChattersCondition;
  readonly last: null | {
    readonly startedAt: number; readonly durationMs: number; readonly pages: number; readonly people: number;
    readonly end: SweepEnd; readonly failure: TwitchFailureKind | null; readonly applied: SubmitResult | 'not_submitted';
  };
  readonly counters: Readonly<ChattersCounters>;
}

export interface ObservedHealth {
  readonly stream: StreamHealth;
  readonly chatters: ChattersHealth;
}

export interface ReconcilerOptions {
  readonly kingdomId: KingdomId;
  readonly helix: Pick<HelixReader, 'getStreams' | 'getChattersPage'>;
  readonly authority: ObservationAuthority;
  readonly source: PresenceSource;
  readonly tracker?: StreamTracker;
  readonly reconciled?: StreamTrackerOptions['reconciled'];
  readonly now?: () => number;
  /** Minute cadence; 0 disables the timer (tests call `minute()` themselves). */
  readonly everyMs?: number;
  readonly sweep?: { readonly pageLimit?: number; readonly pageSize?: number; readonly deadlineMs?: number };
  /** Redacted operator lines: states and counts, never IDs or names. */
  readonly log?: (line: string) => void;
}

/**
 * Observed state that EventSub cannot push: Get Streams at startup, after a delivery gap and every minute,
 * and a bounded Chatters sweep every minute while a live broadcast is observed and the broadcaster's grant
 * holds. Requests never overlap themselves; a failed one changes nothing, so earlier evidence keeps its own
 * time and expires through the reducer. Chatters only ever lights unnamed windows.
 */
export class Reconciler {
  readonly tracker: StreamTracker;
  readonly #options: ReconcilerOptions;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #abort = new AbortController();
  readonly #counters: ChattersCounters = {
    sweeps: 0, complete: 0, partial: 0, failed: 0, overlapSkipped: 0, pages: 0, pageLimit: 0, deadline: 0, repeatedCursor: 0, pageFailed: 0,
  };
  #started: Promise<void> | null = null;
  #streamPoll: Promise<void> | null = null;
  #sweeping: Promise<void> | null = null;
  #cycle: Promise<void> | null = null;
  #chatters: ChattersCondition = 'waiting_for_live';
  #last: ChattersHealth['last'] = null;
  #serial = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  readonly #logged = new Map<'stream' | 'chatters', string>();
  #stopped = false;

  constructor(options: ReconcilerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#log = options.log ?? (() => undefined);
    this.tracker = options.tracker ?? new StreamTracker({ kingdomId: options.kingdomId, source: options.source, now: this.#now,
      ...(options.reconciled ? { reconciled: options.reconciled } : {}) });
  }

  /** Reconciles stream state now (startup), then keeps the minute cadence. Resolves after the first cycle. */
  start(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    if (this.#started) return this.#started;
    const everyMs = this.#options.everyMs ?? PRESENCE_MINUTE_MS;
    if (everyMs > 0) {
      this.#timer = setInterval(() => void this.minute(), everyMs);
      this.#timer.unref?.();
    }
    this.#started = this.#run('startup');
    return this.#started;
  }

  /** One minute: stream state, then a sweep if a live broadcast is observed. A cycle still running skips it. */
  minute(): Promise<void> {
    return this.#run('minute');
  }

  /**
   * Delivery came back after a gap (or for the first time): Twitch does not replay what was missed, so the
   * current stream state and roster are read again before the source publishes.
   */
  afterGap(): Promise<void> {
    return this.#run('gap');
  }

  health(): ObservedHealth {
    return {
      stream: this.tracker.health(),
      chatters: { condition: this.#chattersCondition(), last: this.#last, counters: { ...this.#counters } },
    };
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#abort.abort();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async #run(reason: StreamReason): Promise<void> {
    if (this.#stopped) return;
    if (this.#cycle) {
      // The minute never queues behind a slow cycle; a gap or startup waits for it and then reads again.
      if (reason === 'minute') {
        if (this.#sweeping) this.#counters.overlapSkipped++;
        return this.#cycle;
      }
      await this.#cycle.catch(() => undefined);
      if (this.#stopped) return;
    }
    const cycle = (async () => {
      await this.#pollStream(reason);
      if (!this.#stopped) await this.#sweep();
    })().finally(() => {
      if (this.#cycle === cycle) this.#cycle = null;
    });
    this.#cycle = cycle;
    return cycle;
  }

  #pollStream(reason: StreamReason): Promise<void> {
    if (this.#streamPoll) return this.#streamPoll;
    const poll = (async () => {
      const at = this.#now();
      let streams = null;
      try {
        streams = await this.#options.helix.getStreams([this.#options.kingdomId], { signal: this.#abort.signal, deadline: at + STREAM_DEADLINE_MS });
      } catch (error) {
        if (this.#stopped) return;
        if (isTwitchFailure(error, 'unauthorized')) void this.#options.authority.refresh().catch(() => undefined);
      }
      if (this.#stopped) return;
      const result = this.tracker.polled(streams, at, reason);
      const outcome = result?.outcome ?? 'unknown';
      const note = reason === 'gap' ? ' (read again after a delivery gap)' : reason === 'startup' ? ' (startup)' : '';
      this.#report('stream', outcome, reason !== 'minute', `stream ${outcome === 'lagging' ? 'answer set aside: Get Streams still shows an older state' : outcome}${note}`);
    })().finally(() => {
      if (this.#streamPoll === poll) this.#streamPoll = null;
    });
    this.#streamPoll = poll;
    return poll;
  }

  async #sweep(): Promise<void> {
    if (!this.#options.authority.available('chatters')) {
      this.#chatters = 'unauthorized';
      return;
    }
    if (!this.tracker.live) {
      this.#chatters = 'waiting_for_live';
      return;
    }
    const generation = this.#options.authority.generation;
    const current = () => !this.#stopped && this.#options.authority.generation === generation
      && this.#options.authority.available('chatters') && this.tracker.live;
    const sweep = sweepChatters({
      helix: this.#options.helix, broadcasterId: this.#options.kingdomId, now: this.#now, signal: this.#abort.signal,
      ...this.#options.sweep,
    });
    this.#sweeping = sweep.then(() => undefined, () => undefined);
    let result: SweepResult;
    try {
      result = await sweep;
    } finally {
      this.#sweeping = null;
    }
    if (!current() || result.end === 'aborted') return;
    this.#counters.sweeps++;
    this.#counters.pages += result.pages;
    const applied = await this.#submit(result, current);
    if (!current()) return;
    this.#last = {
      startedAt: result.startedAt, durationMs: result.finishedAt - result.startedAt, pages: result.pages, people: result.ids.length,
      end: result.end, failure: result.failure, applied,
    };
    if (result.end === 'complete') {
      this.#counters.complete++;
      this.#chatters = 'complete';
    } else if (result.ids.length > 0) {
      this.#counters.partial++;
      this.#chatters = 'partial';
    } else {
      this.#counters.failed++;
      this.#chatters = 'failed';
    }
    if (result.end === 'page_limit') this.#counters.pageLimit++;
    if (result.end === 'deadline') this.#counters.deadline++;
    if (result.end === 'repeated_cursor') this.#counters.repeatedCursor++;
    if (result.end === 'page_failed') this.#counters.pageFailed++;
    if (result.failure === 'unauthorized' || result.failure === 'forbidden') {
      // The grant may be gone. The authority rechecks it; until it holds again no sweep runs.
      void this.#options.authority.refresh().catch(() => undefined);
    }
    const detail = result.end === 'complete' ? `complete, ${result.ids.length} connected` : `partial (${result.end.replace('_', ' ')}${result.failure ? `: ${result.failure}` : ''}), ${result.ids.length} seen`;
    this.#report('chatters', this.#chatters, false, `chatters sweep ${detail} in ${result.pages} page${result.pages === 1 ? '' : 's'}`);
  }

  /**
   * A complete sweep may record departures (people no longer listed); a partial one only refreshes the people
   * it saw, and a sweep that saw nobody without completing says nothing at all.
   */
  async #submit(result: SweepResult, current: () => boolean): Promise<SubmitResult | 'not_submitted'> {
    if (result.end !== 'complete' && result.ids.length === 0) return 'not_submitted';
    const input = toPresenceInput({
      kind: 'chatters', sweepId: `${result.startedAt.toString(36)}.${++this.#serial}`, at: result.startedAt,
      complete: result.end === 'complete', ids: result.ids,
    }, this.#options.kingdomId, this.#options.source.origin);
    if (!input) return 'not_submitted';
    return this.#options.source.submit(input, current);
  }

  #chattersCondition(): ChattersCondition {
    if (!this.#options.authority.available('chatters')) return 'unauthorized';
    if (!this.tracker.live) return 'waiting_for_live';
    return this.#chatters === 'unauthorized' || this.#chatters === 'waiting_for_live' ? 'pending' : this.#chatters;
  }

  /** Logs a line when a condition changes (or always, when asked), so the minute cadence stays quiet. */
  #report(kind: 'stream' | 'chatters', condition: string, always: boolean, line: string): void {
    if (always || this.#logged.get(kind) !== condition) this.#log(line);
    this.#logged.set(kind, condition);
  }
}
