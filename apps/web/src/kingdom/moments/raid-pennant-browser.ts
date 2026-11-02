import {
  parseRaidPennantArchiveCursor, parseRaidPennantArchivePage, parseRaidPennantFrame, RAID_PENNANT_FRAME_MAX_BYTES,
  type KingdomId, type RaidPennantArchiveReader, type RaidPennantArchivePage, type RaidPennantFrame,
} from '@chatdom/shared';
import type { RaidPennantBrowserState } from '../../raid-gate/pennant-browser';

export const RAID_PENNANT_ARCHIVE_PAGE_SIZE = 12;

/** Same public history door, with explicit archive mode so the live frame stays backward compatible. */
export function createRaidPennantArchiveReader(kingdomId: KingdomId, origin: RaidPennantFrame['origin'], clock: () => number): RaidPennantArchiveReader {
  return { origin, async read(before, signal) {
    signal.throwIfAborted();
    const cursor = before === null ? null : parseRaidPennantArchiveCursor(before);
    if (before !== null && (!cursor || cursor.kingdomId !== kingdomId || cursor.origin !== origin)) throw new Error('The earlier pennants could not be read.');
    const request = new AbortController(), abort = () => request.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => request.abort(), 3000);
    try {
      const query = new URLSearchParams({ archive: '1', limit: String(RAID_PENNANT_ARCHIVE_PAGE_SIZE) });
      if (before !== null) query.set('before', before);
      const response = await fetch(`/live-realm-data/realm/raid-pennants/${encodeURIComponent(kingdomId)}?${query}`, {
        signal: request.signal, credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error',
      });
      if (request.signal.aborted || !response.ok || Number(response.headers.get('content-length')) > RAID_PENNANT_FRAME_MAX_BYTES || !response.body) {
        request.abort(); void response.body?.cancel().catch(() => {}); throw new Error('The earlier pennants could not be read.');
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let bytes = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      request.signal.addEventListener('abort', cancel, { once: true });
      try {
        for (;;) {
          const part = await reader.read();
          if (request.signal.aborted) throw new Error('The earlier pennant reading was closed.');
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > RAID_PENNANT_FRAME_MAX_BYTES) { await reader.cancel(); throw new Error('The earlier pennants could not be read.'); }
          chunks.push(part.value);
        }
      } finally { request.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '';
      for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
      text += decoder.decode();
      const page = parseRaidPennantArchivePage(text, clock());
      if (request.signal.aborted || !page || page.origin !== origin || page.kingdomId !== kingdomId || page.items.length > RAID_PENNANT_ARCHIVE_PAGE_SIZE) {
        throw new Error('The earlier pennants could not be read.');
      }
      return page;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  } };
}

export interface RaidPennantBrowserOptions {
  readonly reader: RaidPennantArchiveReader;
  readonly kingdomId: KingdomId;
  readonly origin: RaidPennantFrame['origin'];
  readonly clock: () => number;
  readonly present: (frame: RaidPennantFrame | null) => void;
  readonly signal: AbortSignal;
}

/** One page and one live frame, regardless of how much history the kingdom has. */
export function createRaidPennantBrowser(options: RaidPennantBrowserOptions) {
  let stopped = false, recent: RaidPennantFrame | null = null, generation = 0;
  let request: AbortController | undefined, retryCursor: string | null = null;
  let state: RaidPennantBrowserState = { open: false, loading: false, page: null, error: null, canOpen: false };
  const listeners = new Set<(state: RaidPennantBrowserState) => void>();
  const emit = () => { for (const receive of [...listeners]) receive(state); };
  const present = (page: RaidPennantArchivePage) => options.present({ version: page.version, origin: page.origin,
    kingdomId: page.kingdomId, asOf: page.asOf, items: page.items });
  const cancel = () => { generation++; request?.abort(); request = undefined; };
  async function read(cursor: string | null) {
    if (stopped || !state.open || state.loading) return;
    const own = new AbortController(), token = ++generation;
    request = own; retryCursor = cursor;
    const previous = state.page;
    state = { ...state, loading: true, error: null }; emit();
    if (stopped || own.signal.aborted || token !== generation) return;
    let timedOut = false;
    let rejectAbort = () => {};
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(new Error('The reading was closed.')); });
    own.signal.addEventListener('abort', rejectAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; own.abort(); }, 3000);
    try {
      const raw = await Promise.race([options.reader.read(cursor, own.signal), aborted]);
      if (stopped || own.signal.aborted || token !== generation || !state.open) return;
      const page = parseRaidPennantArchivePage(raw, options.clock());
      const oldCursor = cursor === null ? null : parseRaidPennantArchiveCursor(cursor);
      const nextCursor = page?.next ? parseRaidPennantArchiveCursor(page.next) : null;
      if (!page || page.origin !== options.origin || page.kingdomId !== options.kingdomId || page.items.length > RAID_PENNANT_ARCHIVE_PAGE_SIZE
        || previous && page.asOf < previous.asOf
        || cursor !== null && (!oldCursor || nextCursor && (nextCursor.ceiling !== oldCursor.ceiling || nextCursor.before >= oldCursor.before)
          || previous?.items.some(item => page.items.some(next => next.raidId === item.raidId)))) {
        throw new Error('The earlier pennants could not be read.');
      }
      state = { ...state, page, loading: false, error: null }; request = undefined;
      present(page); emit();
    } catch {
      if (stopped || own.signal.aborted && !timedOut || token !== generation || !state.open) return;
      request = undefined; state = { ...state, loading: false, error: 'The earlier pennants could not be read. Try again.' }; emit();
    } finally { clearTimeout(timeout); own.signal.removeEventListener('abort', rejectAbort); }
  }
  const close = () => {
    if (stopped) return;
    cancel(); state = { ...state, open: false, loading: false, page: null, error: null };
    options.present(recent); emit();
  };
  const dispose = () => {
    if (stopped) return; stopped = true; cancel();
    options.signal.removeEventListener('abort', dispose);
    state = { open: false, loading: false, page: null, error: null, canOpen: false };
    recent = null; options.present(null); emit(); listeners.clear();
  };
  options.signal.addEventListener('abort', dispose, { once: true });
  if (options.signal.aborted) dispose();
  return {
    subscribe(receive: (state: RaidPennantBrowserState) => void) {
      if (!stopped) listeners.add(receive);
      receive(state); return () => { listeners.delete(receive); };
    },
    receive(raw: RaidPennantFrame | null) {
      if (stopped) return;
      const frame = raw === null ? null : parseRaidPennantFrame(raw, options.clock());
      if (raw !== null && (!frame || frame.kingdomId !== options.kingdomId || frame.origin !== options.origin || recent && frame.asOf < recent.asOf)) return;
      recent = frame;
      const canOpen = !!frame?.items.length && options.reader.origin === options.origin;
      const changed = state.canOpen !== canOpen;
      state = { ...state, canOpen };
      if (!frame) { close(); return; }
      if (!state.open) options.present(frame);
      if (changed) emit();
    },
    open() {
      if (stopped || state.open || !state.canOpen) return;
      state = { ...state, open: true, page: null, error: null }; void read(null);
    },
    older() { if (!stopped && state.open && !state.loading && state.page?.next) void read(state.page.next); },
    retry() { if (!stopped && state.open && !state.loading && state.error) void read(retryCursor); },
    close, dispose,
  };
}
