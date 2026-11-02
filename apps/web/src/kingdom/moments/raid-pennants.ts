import { parseRaidPennantFrame, RAID_PENNANT_FRAME_MAX_BYTES, type KingdomId, type RaidPennantFeed } from '@chatdom/shared';
import type { Camera } from 'three';
import { mountRaidPennantBrowser, type RaidPennantBrowserOptions } from '../../raid-gate/pennant-browser';
import { createRaidPennantArchiveReader, createRaidPennantBrowser } from './raid-pennant-browser';
import type { SettlementPlan } from '@chatdom/world';
import type { TwitchMomentFeed } from '../../twitch-moments/contracts';
import type { createTwitchMomentView } from '../../twitch-moments/view';
import { RAID_PENNANT_WALL_HEIGHT, RAID_PENNANT_WALL_RADIUS } from '../../twitch-moments/raid-pennant-wall';
import { raidPropGroundOf, type RaidChatSupport } from './raid-chat-ground';

const POLL_MS = 3000;
const REQUEST_MS = 3000;

/**
 * The stream view (an OBS source) marks its document as a broadcast. Nobody there can press anything, so the
 * wall's reading control stays off it; the dated wall itself is still drawn.
 */
export function isBroadcastSurface(canvas: Pick<HTMLCanvasElement, 'ownerDocument'> | undefined): boolean {
  return canvas?.ownerDocument?.documentElement?.classList.contains('stream-document') === true;
}

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

export type RaidPennantReadingPort = Pick<ReturnType<typeof createRaidPennantBrowser>, 'open' | 'close' | 'subscribe'> & {
  sites: ReturnType<typeof createTwitchMomentView>['raidPennantSites'];
};
export interface KingdomRaidPennantOptions {
  view: ReturnType<typeof createTwitchMomentView>;
  feed: TwitchMomentFeed;
  kingdomId: KingdomId;
  signal: AbortSignal;
  clock: () => number;
  plan?: SettlementPlan;
  ground?: (x: number, z: number) => number;
  support?: RaidChatSupport;
  canvas?: HTMLCanvasElement;
  camera?: Camera;
  visible?: NonNullable<RaidPennantBrowserOptions['visible']>;
  reading?: (port: RaidPennantReadingPort) => () => void;
}

/** Installs only channel history and its adopted terrain sampler, never a new raid moment. */
export function mountKingdomRaidPennants({ view, feed, kingdomId, signal, clock, plan, ground, support, canvas, camera, visible, reading }: KingdomRaidPennantOptions): () => void {
  let stopped = false, lastAsOf = -1;
  const children: { browser?: ReturnType<typeof createRaidPennantBrowser> } = {};
  let ui: ReturnType<typeof mountRaidPennantBrowser> | undefined;
  let disconnect = () => {}, unsubscribeView = () => {}, detachReading = () => {};
  const dispose = () => {
    if (stopped) return;
    stopped = true; signal.removeEventListener('abort', dispose);
    unsubscribeView(); disconnect();
    ui?.dispose();
    try { detachReading(); } catch { /* A retired host cannot retain this feature's data or request. */ }
    if (children.browser) children.browser.dispose(); else view.receiveRaidPennants(null);
    view.setRaidPennantGround(undefined);
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
  const browser = createRaidPennantBrowser({ reader: feed.raidPennantArchive ?? createRaidPennantArchiveReader(kingdomId, feed.origin, clock),
    kingdomId, origin: feed.origin, clock, signal, present: frame => view.receiveRaidPennants(frame) });
  children.browser = browser;
  if (canvas && camera && !isBroadcastSurface(canvas)) ui = mountRaidPennantBrowser({ canvas, camera, sites: () => view.raidPennantSites(), browser, signal, ...(visible ? { visible } : {}) });
  try {
    if (reading) {
      detachReading = reading({ open: browser.open, close: browser.close, subscribe: browser.subscribe, sites: () => view.raidPennantSites() });
      if (stopped) { detachReading(); return dispose; }
    }
    disconnect = source.subscribe(raw => {
      if (stopped) return;
      const frame = parseRaidPennantFrame(raw, clock());
      if (!frame || frame.kingdomId !== kingdomId || frame.origin !== feed.origin || frame.asOf < lastAsOf) return;
      lastAsOf = frame.asOf; browser?.receive(frame);
    });
    // A synchronous source can trigger an abort or view disposal before subscribe returns.
    if (stopped) disconnect();
  } catch { dispose(); }
  return dispose;
}
