import type { EmoteCatalogueSnapshot, EmoteRefreshReason } from './refresh';

/**
 * When a kingdom's catalogue is read again (Spec 24 R1): once at Genesis, once per live stream at
 * go-live, soon after the monarch switches a provider on, and daily. A read that leaves Twitch or an
 * enabled provider without an answer is retried with a doubling backoff instead of waiting a day,
 * because the outage kept the old entries and the channel may have changed in the meantime.
 */
export const EMOTE_REFRESH_SCHEDULE = {
  dailyMs: 24 * 60 * 60_000,
  retryMs: 15 * 60_000,
  retryMaxMs: 6 * 60 * 60_000,
} as const;

/** Stored beside the snapshot. Plain JSON. */
export interface EmoteRefreshSchedule {
  /** The live epoch whose go-live read reached Twitch; a new epoch is read once. */
  goLiveEpoch: string | null;
  /** The monarch switched a provider on after the last read started: read it without waiting a day. */
  providersChanged: boolean;
  /** Consecutive reads that left a provider without an answer, or failed outright. */
  failures: number;
  lastAttemptAt: number | null;
}

export const emptyEmoteRefreshSchedule = (): EmoteRefreshSchedule => ({ goLiveEpoch: null, providersChanged: false, failures: 0, lastAttemptAt: null });

export interface EmoteRefreshPlan {
  reason: EmoteRefreshReason;
  /** Caller time at which the read is due; due now when `dueAt <= atMs`. */
  dueAt: number;
}

/** True when any provider the read was allowed to contact gave no trustworthy answer. */
export function refreshLeftGaps(snapshot: EmoteCatalogueSnapshot): boolean {
  return Object.values(snapshot.providers).some(state => state?.health === 'stale' || state?.health === 'unavailable');
}

/**
 * The next read this kingdom needs and when. Pure: caller time in, plan out, so the host can run
 * one timer per kingdom (or one sweep) and the decision replays identically after a restart.
 */
export function planEmoteRefresh(input: {
  snapshot: EmoteCatalogueSnapshot | null;
  stream: { live: boolean; epoch: string | null } | null;
  schedule?: EmoteRefreshSchedule | undefined;
}): EmoteRefreshPlan {
  const schedule = input.schedule ?? emptyEmoteRefreshSchedule();
  const backoff = schedule.failures > 0 && schedule.lastAttemptAt !== null
    ? schedule.lastAttemptAt + Math.min(EMOTE_REFRESH_SCHEDULE.retryMs * 2 ** Math.min(schedule.failures - 1, 16), EMOTE_REFRESH_SCHEDULE.retryMaxMs)
    : Number.NEGATIVE_INFINITY;
  if (!input.snapshot) return { reason: 'genesis', dueAt: backoff };
  const liveEpoch = input.stream?.live ? input.stream.epoch : null;
  if (liveEpoch && liveEpoch !== schedule.goLiveEpoch) return { reason: 'go-live', dueAt: backoff };
  if (schedule.providersChanged) return { reason: 'opt-in', dueAt: backoff };
  const lastSuccess = input.snapshot.providers.twitch?.lastSuccessAt ?? input.snapshot.refreshedAt;
  // After a failed read the last success is already a day old: only the backoff decides, so an
  // outage is retried soon but never hammered.
  return { reason: 'daily', dueAt: schedule.failures > 0 ? backoff : lastSuccess + EMOTE_REFRESH_SCHEDULE.dailyMs };
}
