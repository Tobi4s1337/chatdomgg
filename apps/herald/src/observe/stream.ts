import { STREAM_LEASE_MS, type KingdomId } from '@chatdom/shared';
import type { HelixStream } from '@chatdom/twitch';
import { toPresenceInput, type Observation } from '../source/observations';
import type { PresenceSource } from '../source/source';

export type StreamObservation = Extract<Observation, { readonly kind: 'stream' }>;

/** What Herald last knew about the broadcast. `unknown` is never offline: it means nobody could say. */
export type StreamCondition = 'unknown' | 'live' | 'offline';

/** Why Get Streams was asked: at startup, on the minute, or after delivery came back from a gap. */
export type StreamReason = 'startup' | 'minute' | 'gap';

/**
 * Get Streams is served from a cache and can trail EventSub by a minute or more. Within this window after a
 * pushed `stream.online`, an empty answer is the cache catching up, not the broadcast ending; after a pushed
 * `stream.offline`, a listed broadcast is the one that just ended. A real restart inside the window brings
 * its own `stream.online`.
 */
export const HELIX_LAG_MS = 120_000;
/** Ended broadcasts remembered so a cached answer cannot relight one. Twitch gives every broadcast a new ID. */
const ENDED_LIMIT = 64;

export interface StreamCounters {
  polls: number;
  failed: number;
  /** Answers that contradicted a newer pushed state and were set aside as cache lag. */
  lagging: number;
  /** A broadcast entry whose type was not `live` (Twitch reports an error as an empty type). */
  notLive: number;
  observedLive: number;
  observedOffline: number;
  pushed: number;
}

export interface StreamHealth {
  readonly condition: StreamCondition;
  /** Where the current condition came from. */
  readonly via: 'eventsub' | 'helix' | null;
  /** The last accepted observation; it keeps its time when later requests fail. */
  readonly observedAt: number | null;
  /** Whether the current condition was re-established by the reconciliation after a delivery gap. */
  readonly recovered: boolean;
  /** Whether the current condition is still within the stream lease (otherwise the kingdom shows stale). */
  readonly fresh: boolean;
  readonly lastPoll: null | { readonly reason: StreamReason; readonly at: number; readonly outcome: 'live' | 'offline' | 'unknown' | 'lagging' };
  readonly consecutiveFailures: number;
  readonly counters: Readonly<StreamCounters>;
}

export interface StreamTrackerOptions {
  readonly kingdomId: KingdomId;
  readonly source: PresenceSource;
  readonly now?: () => number;
}

/**
 * The one place stream state enters the source. Pushed `stream.online`/`stream.offline` and polled Get
 * Streams both arrive here; the reducer orders them by observation time, and this tracker sets aside polled
 * answers that only repeat an older cached state (an ended broadcast still listed, or a just-started one not
 * listed yet). A failed request changes nothing: the last observation keeps its time and ages out honestly.
 */
export class StreamTracker {
  readonly #options: StreamTrackerOptions;
  readonly #now: () => number;
  readonly #ended: string[] = [];
  readonly #counters: StreamCounters = { polls: 0, failed: 0, lagging: 0, notLive: 0, observedLive: 0, observedOffline: 0, pushed: 0 };
  #condition: StreamCondition = 'unknown';
  #via: 'eventsub' | 'helix' | null = null;
  #observedAt: number | null = null;
  #streamId: string | null = null;
  #recovered = false;
  /** The latest pushed change, which a lagging cache must not undo. */
  #pushed: { readonly live: boolean; readonly at: number } | null = null;
  #lastPoll: StreamHealth['lastPoll'] = null;
  #failures = 0;

  constructor(options: StreamTrackerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** Whether a live broadcast has been observed recently enough for the kingdom to call it live. */
  get live(): boolean {
    return this.#condition === 'live' && this.#fresh(this.#now());
  }

  /** A pushed EventSub change; reordered delivery cannot replace newer accepted evidence. */
  push(observation: StreamObservation): void {
    if (!this.#accepts(observation.at, observation.live)) return;
    this.#counters.pushed++;
    this.#pushed = { live: observation.live, at: observation.at };
    if (!observation.live && this.#streamId) this.#end(this.#streamId);
    this.#accept(observation, 'eventsub', false);
  }

  /** A Get Streams answer for this channel, asked at `at`, or `null` when the request failed. */
  polled(streams: readonly HelixStream[] | null, at: number, reason: StreamReason): StreamHealth['lastPoll'] {
    this.#counters.polls++;
    if (this.#observedAt !== null && at < this.#observedAt) {
      this.#counters.lagging++;
      this.#lastPoll = { reason, at, outcome: 'lagging' };
      return this.#lastPoll;
    }
    let outcome: NonNullable<StreamHealth['lastPoll']>['outcome'];
    if (streams === null) {
      this.#counters.failed++;
      this.#failures++;
      outcome = 'unknown';
    } else {
      this.#failures = 0;
      const stream = streams.find(entry => entry.userId === this.#options.kingdomId) ?? null;
      if (stream && stream.type !== 'live') {
        this.#counters.notLive++;
        outcome = 'unknown';
      } else if (stream) {
        if (!this.#accepts(at, true) || this.#ended.includes(stream.id) || (this.#pushed && !this.#pushed.live && at - this.#pushed.at < HELIX_LAG_MS)) {
          this.#counters.lagging++;
          outcome = 'lagging';
        } else {
          this.#counters.observedLive++;
          this.#accept({ kind: 'stream', at, live: true, streamId: stream.id }, 'helix', reason === 'gap');
          outcome = 'live';
        }
      } else if (this.#pushed?.live && at - this.#pushed.at < HELIX_LAG_MS) {
        this.#counters.lagging++;
        outcome = 'lagging';
      } else {
        this.#counters.observedOffline++;
        if (this.#streamId && this.#condition === 'live') this.#end(this.#streamId);
        this.#accept({ kind: 'stream', at, live: false }, 'helix', reason === 'gap');
        outcome = 'offline';
      }
    }
    this.#lastPoll = { reason, at, outcome };
    return this.#lastPoll;
  }

  health(): StreamHealth {
    const now = this.#now();
    return {
      condition: this.#condition, via: this.#via, observedAt: this.#observedAt, recovered: this.#recovered,
      fresh: this.#fresh(now), lastPoll: this.#lastPoll, consecutiveFailures: this.#failures, counters: { ...this.#counters },
    };
  }

  #fresh(now: number): boolean {
    return this.#observedAt !== null && this.#condition !== 'unknown' && now < this.#observedAt + STREAM_LEASE_MS;
  }

  #accept(observation: StreamObservation, via: 'eventsub' | 'helix', recovered: boolean): void {
    // Match the reducer's observation order, including offline winning an equal-time online.
    if (!this.#accepts(observation.at, observation.live)) return;
    this.#condition = observation.live ? 'live' : 'offline';
    this.#via = via;
    this.#observedAt = observation.at;
    this.#recovered = recovered;
    if (observation.live) this.#streamId = observation.streamId;
    const input = toPresenceInput(observation, this.#options.kingdomId, this.#options.source.origin);
    if (input) void this.#options.source.submit(input).catch(() => undefined);
  }

  #accepts(at: number, live: boolean): boolean {
    return this.#observedAt === null || at > this.#observedAt
      || (at === this.#observedAt && !live && this.#condition === 'live');
  }

  #end(streamId: string): void {
    if (this.#ended.includes(streamId)) return;
    this.#ended.push(streamId);
    if (this.#ended.length > ENDED_LIMIT) this.#ended.shift();
  }
}
