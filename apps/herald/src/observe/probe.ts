import { isTwitchFailure, type HelixReader, type TwitchFailureKind } from '@chatdom/twitch';
import type { AuthReport } from '../auth/authority';
import { sweepChatters, type SweepEnd } from './chatters';

/**
 * What `check:auth --observe` read from Twitch, once: the broadcast state and one bounded Chatters sweep.
 * Counts and conditions only. The sweep's IDs never leave this function, and nothing here feeds presence:
 * it shows that the reads `dev` relies on work, whether or not the channel is live.
 */
export interface ObserveProbe {
  readonly observedAt: number;
  readonly stream:
    | { readonly state: 'live' | 'offline' | 'not_live'; readonly startedAt: number | null }
    | { readonly state: 'failed'; readonly failure: TwitchFailureKind }
    | { readonly state: 'skipped'; readonly reason: 'capability_unavailable' };
  readonly chatters:
    | { readonly state: 'swept'; readonly end: SweepEnd; readonly pages: number; readonly connected: number; readonly duplicates: number; readonly durationMs: number; readonly failure: TwitchFailureKind | null }
    | { readonly state: 'skipped'; readonly reason: 'capability_unavailable' };
}

export async function probeObservedState(options: {
  readonly report: AuthReport;
  readonly helix: Pick<HelixReader, 'getStreams' | 'getChattersPage'>;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}): Promise<ObserveProbe | null> {
  const now = options.now ?? Date.now;
  const broadcasterId = options.report.accounts.broadcaster.id;
  if (broadcasterId === null) return null;
  const available = (capability: string) => options.report.capabilities.some(status => status.capability === capability && status.available);
  const observedAt = now();

  let stream: ObserveProbe['stream'] = { state: 'skipped', reason: 'capability_unavailable' };
  if (available('stream')) {
    try {
      const [current] = await options.helix.getStreams([broadcasterId], { signal: options.signal, deadline: now() + 10_000 });
      // Only `live` wakes the beacon; any other listed type is reported, never taken for live.
      stream = current ? { state: current.type === 'live' ? 'live' : 'not_live', startedAt: current.startedAt } : { state: 'offline', startedAt: null };
    } catch (error) {
      stream = { state: 'failed', failure: isTwitchFailure(error) ? error.kind : 'invalid_response' };
    }
  }

  let chatters: ObserveProbe['chatters'] = { state: 'skipped', reason: 'capability_unavailable' };
  if (available('chatters')) {
    const sweep = await sweepChatters({ helix: options.helix, broadcasterId, now, ...(options.signal ? { signal: options.signal } : {}) });
    chatters = {
      state: 'swept', end: sweep.end, pages: sweep.pages, connected: sweep.ids.length, duplicates: sweep.duplicates,
      durationMs: sweep.finishedAt - sweep.startedAt, failure: sweep.failure,
    };
  }
  return { observedAt, stream, chatters };
}
