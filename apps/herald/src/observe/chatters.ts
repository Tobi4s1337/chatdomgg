import { isTwitchFailure, type HelixReader, type TwitchFailureKind } from '@chatdom/twitch';

/** Spec 03 R12: a sweep reads at most 60 pages of 1,000 within 45 seconds. */
export const SWEEP_PAGE_LIMIT = 60;
export const SWEEP_PAGE_SIZE = 1_000;
export const SWEEP_DEADLINE_MS = 45_000;

/**
 * How a sweep ended. Only `complete` (Twitch returned a last page without a cursor) may turn absence into
 * departure; every other end is partial coverage of the people it did see.
 */
export type SweepEnd = 'complete' | 'page_limit' | 'deadline' | 'repeated_cursor' | 'page_failed' | 'aborted';

export interface SweepResult {
  /** When the first page was asked for: the roster is evidence from then on, never earlier. */
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly pages: number;
  /** Deduplicated user IDs, in the order Twitch paged them. Private: only the reducer and allocator see them. */
  readonly ids: readonly string[];
  /** Repeat appearances across pages (the list shifts while it is paged). */
  readonly duplicates: number;
  readonly end: SweepEnd;
  /** The failure that ended the sweep, as a kind only. */
  readonly failure: TwitchFailureKind | null;
}

export interface SweepOptions {
  readonly helix: Pick<HelixReader, 'getChattersPage'>;
  readonly broadcasterId: string;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
  readonly pageLimit?: number;
  readonly pageSize?: number;
  readonly deadlineMs?: number;
}

/**
 * One bounded Get Chatters sweep with the broadcaster as `moderator_id`. Pages are followed by cursor until
 * Twitch gives none (complete), or until the page cap, the deadline, a cursor seen before or a failed page,
 * which all leave the sweep partial. A changing `total` is not a completeness proof and is never read.
 */
export async function sweepChatters(options: SweepOptions): Promise<SweepResult> {
  const now = options.now ?? Date.now;
  const pageLimit = options.pageLimit ?? SWEEP_PAGE_LIMIT;
  const startedAt = now();
  const deadline = startedAt + (options.deadlineMs ?? SWEEP_DEADLINE_MS);
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let duplicates = 0;
  let pages = 0;
  let cursor: string | null = null;
  let end: SweepEnd | null = null;
  let failure: TwitchFailureKind | null = null;

  while (end === null) {
    if (options.signal?.aborted) {
      end = 'aborted';
      break;
    }
    if (pages >= pageLimit) {
      end = 'page_limit';
      break;
    }
    if (now() >= deadline) {
      end = 'deadline';
      break;
    }
    try {
      const page = await options.helix.getChattersPage(
        { broadcasterId: options.broadcasterId, moderatorId: options.broadcasterId, first: options.pageSize ?? SWEEP_PAGE_SIZE, after: cursor },
        { signal: options.signal, deadline },
      );
      pages++;
      for (const id of page.userIds) {
        if (seen.has(id)) duplicates++;
        else seen.add(id);
      }
      if (page.cursor === null) end = 'complete';
      else if (cursors.has(page.cursor)) end = 'repeated_cursor';
      else {
        cursors.add(page.cursor);
        cursor = page.cursor;
      }
    } catch (error) {
      failure = isTwitchFailure(error) ? error.kind : 'invalid_response';
      end = failure === 'aborted' ? 'aborted' : failure === 'timeout' && now() >= deadline ? 'deadline' : 'page_failed';
    }
  }
  return { startedAt, finishedAt: now(), pages, ids: [...seen], duplicates, end, failure };
}
