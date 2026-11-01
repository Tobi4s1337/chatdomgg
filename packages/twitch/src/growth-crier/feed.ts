import { GrowthSceneFrameSchema, type GrowthSceneFeed, type GrowthSceneFrame } from '@chatdom/shared';
import { flushGrowthBatch, ingestGrowthFrame, rebaselineGrowthFrame, type GrowthBatch, type GrowthBatcher, type IngestStatus } from './batch';

export type GrowthFeedStatus = IngestStatus | 'unavailable';
export interface GrowthFeedAdapter {
  /** Persist this state across reconnects; it is not a delivery acknowledgement. */
  readonly state: GrowthBatcher;
  /** The rejected snapshot must be retried before reconnecting to the feed. */
  readonly blocked: boolean;
  flush(): GrowthBatch | null;
  retry(): IngestStatus | null;
  close(): void;
}

/**
 * Subscribe to a read-only feed. A bad frame, label mismatch, feed failure, or full
 * queue stops the subscription and reports the condition. A full queue retains one
 * validated, schema-bounded frame for retry; callers drain it before reconnecting.
 * `now` is supplied by the caller, never by the adapter. No Twitch send is implied.
 */
export function watchGrowthFeed(feed: GrowthSceneFeed, initial: GrowthBatcher, now: () => number,
  report: (status: GrowthFeedStatus) => void): GrowthFeedAdapter {
  let state = initial;
  let retained: GrowthSceneFrame | null = null;
  let closed = false;
  let first = true;
  let unsubscribe: (() => void) | null = null;
  const stop = () => {
    closed = true;
    const cancel = unsubscribe;
    unsubscribe = null;
    cancel?.();
  };
  const fail = (status: GrowthFeedStatus) => { stop(); report(status); };
  const receive = (input: GrowthSceneFrame) => {
    if (closed) return;
    const parsed = GrowthSceneFrameSchema.safeParse(input);
    if (!parsed.success || (feed.label !== 'LIVE' && feed.label !== 'SIMULATED')
      || parsed.data.origin !== (feed.label === 'LIVE' ? 'live' : 'simulated')) {
      fail('invalid');
      return;
    }
    const result = first ? rebaselineGrowthFrame(state, parsed.data, now()) : ingestGrowthFrame(state, parsed.data, now());
    first = false;
    state = result.state;
    if (result.status === 'backpressure') {
      retained = parsed.data;
      fail('backpressure');
    } else if (result.status === 'invalid') {
      fail('invalid');
    } else {
      report(result.status);
    }
  };
  try {
    const cancel = feed.subscribe(receive, () => { if (!closed) fail('unavailable'); });
    if (closed) cancel();
    else unsubscribe = cancel;
  } catch {
    if (!closed) fail('unavailable');
  }
  return {
    get state() { return state; },
    get blocked() { return retained !== null; },
    flush() {
      const result = flushGrowthBatch(state, now());
      state = result.state;
      return result.batch;
    },
    retry() {
      if (retained === null) return null;
      const result = ingestGrowthFrame(state, retained, now());
      state = result.state;
      if (result.status === 'accepted' || result.status === 'unchanged') retained = null;
      report(result.status);
      return result.status;
    },
    close: stop,
  };
}
