import { raidShotClearOf } from './raid-shot-clear';
import type * as THREE from 'three';
import type { VoxelRenderState } from '@chatdom/render';
import { parseRaidChatFrame, parseRaidGuestVisualMark, parseRaidPartyFrame, type KingdomId, type RaidChatFeed, type RaidChatFrame, type RaidPartyPublicFeed, type RaidPartyPublicFrame } from '@chatdom/shared';
import type { TwitchMomentFeed } from '../../twitch-moments/contracts';
import type { createTwitchMomentView } from '../../twitch-moments/view';
import { createGuestCrest } from '../../raid-gate/guest-insignia';
import type { SettlementPlan } from '@chatdom/world';
import { raidApproachGroundOf, raidChatGroundOf, type RaidChatSupport } from './raid-chat-ground';
import { mountKingdomRaidPennants } from './raid-pennants';
import { createRaidPartyFeed, createRaidPartyPeople, raidPartyGroundOf } from './raid-party';
import '../../raid-gate/raid-chat.css';

/** A short-lived public current-state reader. It never retains a chat history. */
export function createRaidChatFeed(kingdomId: KingdomId, origin: RaidChatFeed['origin'], clock: () => number): RaidChatFeed {
  return { origin, subscribe(receive) {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined;
    const empty = () => receive({ version: 1, kingdomId, origin, asOf: clock(), lights: [], cues: [] });
    const schedule = () => { if (!stopped && !document.hidden) timer = setTimeout(poll, 750); };
    async function poll() {
      if (stopped || document.hidden || request) return;
      const controller = new AbortController(); request = controller;
      // A small JSON read, bounded so a hung request cannot hold the next one; a busy renderer can take seconds per frame.
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(`/live-realm-data/realm/raid-chat/${encodeURIComponent(kingdomId)}`, {
          signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
        });
        if (!response.ok) throw new Error('Raid chat unavailable');
        const length = Number(response.headers.get('content-length'));
        if (length > 96 * 1024) throw new Error('Raid chat frame too large');
        if (!response.body) throw new Error('Raid chat response has no body');
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 96 * 1024) { await reader.cancel(); throw new Error('Raid chat frame too large'); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let text = '';
        for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
        text += decoder.decode();
        const frame = parseRaidChatFrame(text, clock());
        if (!frame || frame.kingdomId !== kingdomId || frame.origin !== origin) throw new Error('Invalid raid chat frame');
        if (!stopped && request === controller) receive(frame);
      } catch {
        if (!stopped && request === controller) empty();
      } finally {
        clearTimeout(timeout);
        if (request === controller) { request = undefined; schedule(); }
      }
    }
    const visibility = () => {
      if (document.hidden) { clearTimeout(timer); request?.abort(); request = undefined; empty(); }
      else { clearTimeout(timer); void poll(); }
    };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); request = undefined; document.removeEventListener('visibilitychange', visibility); };
  } };
}

export interface KingdomRaidChatOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  view: ReturnType<typeof createTwitchMomentView>;
  feed: TwitchMomentFeed;
  kingdomId: KingdomId;
  signal: AbortSignal;
  clock: () => number;
  plan?: SettlementPlan;
  ground?: (x: number, z: number) => number;
  support?: RaidChatSupport;
  pennantVisible?: import('./raid-pennants').KingdomRaidPennantOptions['visible'];
  pennantReading?: import('./raid-pennants').KingdomRaidPennantOptions['reading'];
  /** The scene and its clay material, for the gate party's marchers; without them the party is not drawn. */
  party?: { readonly scene: THREE.Scene; readonly material: VoxelRenderState };
  /** The gate party's reader; defaults to the feed's own, then to the realm's public endpoint. */
  partyFeed?: RaidPartyPublicFeed;
}

/** Projects only the moment view's currently visible verified lanterns, moving or beside the gate. */
export function mountKingdomRaidChat({ canvas, camera, view, feed, kingdomId, signal, clock, plan, ground, support, pennantVisible, pennantReading, party, partyFeed }: KingdomRaidChatOptions): () => void {
  if (signal.aborted) return () => {};
  const detachPennants = mountKingdomRaidPennants({ view, feed, kingdomId, signal, clock, canvas, camera,
    ...(plan ? { plan } : {}), ...(ground ? { ground } : {}), ...(support ? { support } : {}), ...(pennantVisible ? { visible: pennantVisible } : {}), ...(pennantReading ? { reading: pennantReading } : {}) });
  view.setRaidChatGround(plan && ground ? raidChatGroundOf(plan, ground, support) : undefined);
  view.setRaidShotClear(plan && ground ? raidShotClearOf(plan, ground) : undefined);
  view.setRaidApproachGround(plan && ground ? raidApproachGroundOf(plan, ground, support) : undefined);
  const detachParty = party ? mountRaidParty() : () => {};
  /** The real marchers at the gate: the realm's public frame, checked here, drawn by the view with the town's people. */
  function mountRaidParty(): () => void {
    view.setRaidPartyGround(plan && ground ? raidPartyGroundOf(plan, ground, support) : undefined);
    view.setRaidPartyPeople(createRaidPartyPeople(party!.scene, party!.material));
    const reader = partyFeed ?? feed.raidParty ?? createRaidPartyFeed(kingdomId, feed.origin, clock);
    let latest: RaidPartyPublicFrame | null = null, lastAsOf = 0, check = 0;
    const show = (frame: RaidPartyPublicFrame | null) => { latest = frame; view.receiveRaidParty(frame); };
    const stop = reader.origin === feed.origin ? reader.subscribe(raw => {
      const frame = raw && parseRaidPartyFrame(raw, clock());
      if (!frame || frame.kingdomId !== kingdomId || frame.origin !== feed.origin || frame.asOf < lastAsOf) { show(null); return; }
      lastAsOf = frame.asOf; show(frame);
    }) : () => {};
    // A reader that falls silent must not leave a gathering standing at the gate: drop the frame once it goes stale.
    const stale = () => { if (latest && !parseRaidPartyFrame(latest, clock())) show(null); check = window.setTimeout(stale, 1000); };
    check = window.setTimeout(stale, 1000);
    return () => { window.clearTimeout(check); stop(); show(null); view.setRaidPartyPeople(undefined); view.setRaidPartyGround(undefined); };
  }
  const layer = document.createElement('div');
  layer.className = 'raid-chat-layer';
  layer.setAttribute('aria-live', 'off');
  document.body.append(layer);
  const source = feed.raidChat ?? createRaidChatFeed(kingdomId, feed.origin, clock);
  let current: RaidChatFrame | null = null, lastAsOf = 0, stopped = false, animation = 0;
  const nodes = new Map<string, HTMLDivElement>();
  const clear = () => { current = null; nodes.clear(); layer.replaceChildren();
    view.receiveRaidChat({ version: 1, kingdomId, origin: feed.origin, asOf: clock(), lights: [], cues: [] }); };
  const disconnect = source.origin === feed.origin ? source.subscribe(raw => {
    const frame = parseRaidChatFrame(raw, clock());
    if (!frame || frame.kingdomId !== kingdomId || frame.origin !== feed.origin || frame.asOf < lastAsOf) { clear(); return; }
    lastAsOf = frame.asOf; current = frame; view.receiveRaidChat(frame);
  }) : () => {};
  function bubble(cue: RaidChatFrame['cues'][number]) {
    const node = document.createElement('div'); node.className = 'raid-chat-bubble';
    const mark = parseRaidGuestVisualMark({ ...cue.raid, expiresAt: cue.expiresAt }, clock());
    const crest = mark && createGuestCrest(mark);
    if (crest) node.append(crest);
    const words = document.createElement('span'); words.className = 'raid-chat-words';
    for (const part of cue.parts) {
      if (part.kind === 'text') words.append(document.createTextNode(part.text));
      else {
        const image = document.createElement('img'); image.className = 'raid-chat-emote'; image.alt = part.alt;
        image.src = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(part.id)}/default/dark/1.0`;
        image.referrerPolicy = 'no-referrer'; words.append(image);
      }
    }
    node.append(words); return node;
  }
  function draw() {
    if (stopped) return;
    const now = clock();
    if (current) {
      const frame = parseRaidChatFrame(current, now);
      if (!frame || (!frame.cues.length && !frame.lights.length)) clear();
      else if (frame.cues.length !== current.cues.length || frame.lights.length !== current.lights.length) { current = frame; view.receiveRaidChat(frame); }
    }
    const rect = canvas.getBoundingClientRect();
    Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const shown = new Set<string>();
    const occupied: { left: number; top: number; right: number; bottom: number }[] = [];
    if (current && rect.width > 0 && rect.height > 0) {
      const active = new Set(current.cues.map(cue => cue.id));
      for (const label of view.raidChatLabels(camera).slice(0, 32)) {
        if (shown.size >= 3 || !active.has(label.cue.id) || label.cue.expiresAt <= now || label.opacity <= 0) continue;
        if (![label.x, label.y, label.opacity].every(Number.isFinite)) continue;
        let node = nodes.get(label.cue.id);
        if (!node) { node = bubble(label.cue); nodes.set(label.cue.id, node); layer.append(node); }
        node.hidden = false;
        const w = node.offsetWidth, h = node.offsetHeight;
        // Stay beside the lantern. Leave the upper centre to the main raid caption.
        const candidates = [label.x + 18, label.x - w - 18];
        const top = Math.max(8, Math.min(rect.height - h - 8, label.y - h / 2));
        const left = candidates.find(x => x >= 8 && x + w <= rect.width - 8
          && !(top < rect.height * .24 && x < rect.width * .72 && x + w > rect.width * .28)
          && occupied.every(o => x + w + 8 < o.left || x > o.right + 8 || top + h + 8 < o.top || top > o.bottom + 8));
        if (left === undefined || h + 16 > rect.height) { node.hidden = true; continue; }
        node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        node.style.opacity = String(Math.max(0, Math.min(1, label.opacity)));
        occupied.push({ left, top, right: left + w, bottom: top + h }); shown.add(label.cue.id);
      }
    }
    for (const [id, node] of nodes) if (!shown.has(id)) { node.remove(); nodes.delete(id); }
    animation = requestAnimationFrame(draw);
  }
  animation = requestAnimationFrame(draw);
  let unsubscribeView = () => {};
  const dispose = () => {
    if (stopped) return; stopped = true; signal.removeEventListener('abort', dispose);
    unsubscribeView(); cancelAnimationFrame(animation); disconnect(); detachPennants(); detachParty(); clear(); view.setRaidChatGround(undefined); view.setRaidShotClear(undefined); view.setRaidApproachGround(undefined); layer.remove();
  };
  unsubscribeView = view.onDispose(dispose);
  if (stopped) unsubscribeView();
  else {
    signal.addEventListener('abort', dispose, { once: true });
    if (signal.aborted) dispose();
  }
  return dispose;
}
