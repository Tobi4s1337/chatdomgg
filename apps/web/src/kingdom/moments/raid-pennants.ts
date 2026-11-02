import { parseRaidPennantFrame, RAID_PENNANT_FRAME_MAX_BYTES, type KingdomId, type RaidPennantFeed } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import type { TwitchMomentFeed } from '../../twitch-moments/contracts';
import type { createTwitchMomentView } from '../../twitch-moments/view';
import { RAID_PENNANT_WALL_HEIGHT, RAID_PENNANT_WALL_RADIUS } from '../../twitch-moments/raid-pennant-wall';
import { raidPropGroundOf, type RaidChatSupport } from './raid-chat-ground';

const POLL_MS = 3000;
const REQUEST_MS = 3000;

/** A public history reader. Failed reads leave the last verified history untouched. */
export function createRaidPennantFeed(kingdomId: KingdomId, origin: RaidPennantFeed['origin'], clock: () => number): RaidPennantFeed {
  return { origin, subscribe(receive) {
    let stopped = false, lastAsOf = -1, resumeAfterFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined;
    const visible = () => typeof document === 'undefined' || !document.hidden;
    const schedule = (delay = POLL_MS) => {
      clearTimeout(timer);
      if (!stopped && visible()) timer = setTimeout(() => { void poll(); }, delay);
    };
    async function poll() {
      if (stopped || !visible() || request) return;
      const controller = new AbortController(); request = controller;
      const active = () => !stopped && !controller.signal.aborted && request === controller && visible();
      const timeout = setTimeout(() => controller.abort(), REQUEST_MS);
      try {
        const response = await fetch(`/live-realm-data/realm/raid-pennants/${encodeURIComponent(kingdomId)}?limit=24`, {
          signal: controller.signal, credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error',
        });
        if (!active() || !response.ok) { void response.body?.cancel().catch(() => {}); return; }
        const length = Number(response.headers.get('content-length'));
        if (length > RAID_PENNANT_FRAME_MAX_BYTES || !response.body) {
          controller.abort(); void response.body?.cancel().catch(() => {}); return;
        }
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let bytes = 0;
        const cancel = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        try {
          for (;;) {
            const part = await reader.read();
            if (!active()) { await reader.cancel(); return; }
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > RAID_PENNANT_FRAME_MAX_BYTES) { await reader.cancel(); return; }
            chunks.push(part.value);
          }
        } finally {
          controller.signal.removeEventListener('abort', cancel);
          reader.releaseLock();
        }
        if (!active()) return;
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let text = '';
        for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
        text += decoder.decode();
        const frame = parseRaidPennantFrame(text, clock());
        if (!frame || frame.kingdomId !== kingdomId || frame.origin !== origin || frame.asOf < lastAsOf || !active()) return;
        lastAsOf = frame.asOf; receive(frame);
      } catch { /* History survives a failed or malformed read; no new read time is invented. */ }
      finally {
        clearTimeout(timeout);
        if (request === controller) {
          request = undefined;
          const delay = resumeAfterFlight ? 0 : POLL_MS;
          resumeAfterFlight = false; schedule(delay);
        }
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (!visible()) { resumeAfterFlight = false; request?.abort(); }
      else if (request) resumeAfterFlight = true;
      else void poll();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => {
      if (stopped) return;
      stopped = true; clearTimeout(timer); request?.abort();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
    };
  } };
}

export interface KingdomRaidPennantOptions {
  view: ReturnType<typeof createTwitchMomentView>;
  feed: TwitchMomentFeed;
  kingdomId: KingdomId;
  signal: AbortSignal;
  clock: () => number;
  plan?: SettlementPlan;
  ground?: (x: number, z: number) => number;
  support?: RaidChatSupport;
}

/** Installs only channel history and its adopted terrain sampler, never a new raid moment. */
export function mountKingdomRaidPennants({ view, feed, kingdomId, signal, clock, plan, ground, support }: KingdomRaidPennantOptions): () => void {
  let stopped = false, lastAsOf = -1;
  let disconnect = () => {}, unsubscribeView = () => {};
  const dispose = () => {
    if (stopped) return;
    stopped = true; signal.removeEventListener('abort', dispose);
    unsubscribeView(); disconnect();
    view.receiveRaidPennants(null); view.setRaidPennantGround(undefined);
  };
  if (signal.aborted) { dispose(); return dispose; }
  unsubscribeView = view.onDispose(dispose);
  if (stopped) { unsubscribeView(); return dispose; }
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) { dispose(); return dispose; }
  const source = feed.raidPennants ?? createRaidPennantFeed(kingdomId, feed.origin, clock);
  if (source.origin !== feed.origin) { dispose(); return dispose; }
  view.setRaidPennantGround(plan && ground ? raidPropGroundOf(plan, ground, {
    radius: RAID_PENNANT_WALL_RADIUS, height: RAID_PENNANT_WALL_HEIGHT, maxRise: .18, sampleSpacing: .5, ...(support ? { support } : {}),
  }) : undefined);
  try {
    disconnect = source.subscribe(raw => {
      if (stopped) return;
      const frame = parseRaidPennantFrame(raw, clock());
      if (!frame || frame.kingdomId !== kingdomId || frame.origin !== feed.origin || frame.asOf < lastAsOf) return;
      lastAsOf = frame.asOf; view.receiveRaidPennants(frame);
    });
    // A synchronous source can trigger an abort or view disposal before subscribe returns.
    if (stopped) disconnect();
  } catch { dispose(); }
  return dispose;
}
