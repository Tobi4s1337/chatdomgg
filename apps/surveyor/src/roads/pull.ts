import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AtlasRaidSchema } from '@chatdom/shared';
import type { RoadLedger } from './ledger';

export const ROAD_PAGE_LIMIT = 200;
export const ROAD_PAGE_MAX_BYTES = 256 * 1024;
const Cursor = z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/);
const Page = z.strictObject({ version: z.literal(1), items: z.array(AtlasRaidSchema).max(ROAD_PAGE_LIMIT), next: Cursor.nullable() });

/** Full endpoint, deliberately explicit: no production host or credentials baked into the consumer. */
export function roadFeedUrl(input: string): URL {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/realm/raid-roads')) {
    throw new Error('ATLAS_RAID_FEED_URL must be an HTTP(S) raid-roads endpoint without credentials, query or fragment.');
  }
  return url;
}

/** Cursors belong to one origin/path. Changing the configured producer never sends it another producer's cursor. */
export function roadFeedSource(url: URL): string {
  return `raid-show:${createHash('sha256').update(url.href).digest('hex').slice(0, 32)}`;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Road feed answered HTTP ${response.status}.`);
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > ROAD_PAGE_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Road feed page exceeds byte limit.');
  }
  if (!response.body) throw new Error('Road feed has no body.');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ROAD_PAGE_MAX_BYTES) throw new Error('Road feed page exceeds byte limit.');
      parts.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export interface RoadPullResult { items: number; stored: number; duplicates: number; cursor: string | null }

/**
 * One bounded page. Validate the entire page before touching memory. Prefix appends may survive an interruption;
 * only the last item's durable record advances the cursor, so retrying that page is safe after a crash.
 * No callback here can start a caravan: recovered history is memory, never a new show.
 */
export async function pullRoadPage(ledger: RoadLedger, endpoint: URL, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<RoadPullResult> {
  signal.throwIfAborted();
  const source = roadFeedSource(endpoint);
  const after = ledger.checkpoint(source);
  const url = new URL(endpoint);
  url.searchParams.set('limit', String(ROAD_PAGE_LIMIT));
  if (after !== null) url.searchParams.set('after', after);
  const response = await fetchImpl(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
  const page = Page.parse(await boundedJson(response));
  signal.throwIfAborted();
  if (page.items.some(raid => raid.source !== 'herald' || raid.delivery !== 'resumable' || raid.evidence.kind !== 'observed' || raid.occurredAt === null)) {
    throw new Error('Road feed must contain only witnessed, resumable herald observations with provider event times.');
  }
  if (new Set(page.items.map(raid => raid.id)).size !== page.items.length) throw new Error('Road feed repeats an ID within one page.');
  if (page.items.length === 0) {
    if (page.next !== after) throw new Error('Empty road feed page changed its cursor.');
    return { items: 0, stored: 0, duplicates: 0, cursor: after };
  }
  if (page.next === null || page.next === after) throw new Error('Nonempty road feed page did not advance its cursor.');
  signal.throwIfAborted();
  const receipts = ledger.observeBatch(page.items, { recovered: true, checkpoint: { source, after, cursor: page.next } });
  const stored = receipts.filter(receipt => receipt.kind === 'stored').length;
  const duplicates = receipts.length - stored;
  return { items: page.items.length, stored, duplicates, cursor: page.next };
}
