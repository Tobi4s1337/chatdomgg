import * as THREE from 'three';
import { kingdomWaterMood, type KingdomId, type PierFeedEvent } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import { foundedPier } from './founded-pier';
import { mountPierLayer, type PierLayer, type PierLayerHost } from './layer';
import { mountChatLines, type ChatLines, type ChatLinesHost } from './chat/lines';
import { watchPierFeed } from './chat/feed';
import { loadAlmanac } from '../almanac/fetch';

/*
 * The pier's lanterns and its water mood wherever the kingdom is drawn: the stream view, a watcher's page, and a walk
 * before the fishing walk feature has a room for it. Mounted through grand-world's kingdom layer slot
 * (`registerKingdomLayer` in apps/web/src/kingdom/scene.ts, pier SEAMS 3); the shapes below are the parts of that
 * host pier reads, written out so this folder builds on its own. Nothing here is solid, takes input or makes sound:
 * the planks, rails and posts are founded placements, and fishing belongs to the walk (play-composition.ts).
 */

/** grand-world's `KingdomLayerMount`, as the pier reads it. */
export interface PierKingdomHost {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly mode: 'walking' | 'watching' | 'stream';
  readonly kingdomId: KingdomId;
  readonly founded: Pick<RealmFoundedScene, 'assets' | 'placements'>;
  hour(): number;
  waterHeight(x: number, z: number): number | null;
  onTick(listener: (dt: number, now: number) => void): () => void;
  readonly signal: AbortSignal;
}
export type PierKingdomRegister = (id: string, mount: (host: PierKingdomHost) => () => void) => () => void;

/*
 * One pier layer per scene. A walk with a room draws the whole layer itself (rods, lines, floats, catches, and the
 * same lanterns and mood); while it holds the scene, the watcher's lanterns stand aside, so nothing is drawn twice.
 */
const walked = new Map<THREE.Scene, number>();
const listeners = new Set<() => void>();
export function claimPierScene(scene: THREE.Scene): () => void {
  walked.set(scene, (walked.get(scene) ?? 0) + 1);
  for (const listener of [...listeners]) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (walked.get(scene) ?? 1) - 1;
    if (left > 0) walked.set(scene, left); else walked.delete(scene);
    for (const listener of [...listeners]) listener();
  };
}

/** Chat's lines on the water: how they are drawn, where their beats come from and the kingdom's name for a first. */
export interface PierChatViews {
  mount(host: ChatLinesHost): ChatLines;
  watch(kingdomId: string, onEvent: (event: PierFeedEvent) => void): { dispose(): void };
  kingdomName(kingdomId: string, signal: AbortSignal): Promise<string | null>;
  /** A pointer-transparent layer over the canvas, or null where there is no page to draw on. */
  overlay(): HTMLElement | null;
}
const compactView = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
export const PIER_CHAT_VIEWS: PierChatViews = {
  mount: mountChatLines,
  watch: (kingdomId, onEvent) => watchPierFeed(kingdomId, onEvent),
  kingdomName: (kingdomId, signal) => loadAlmanac(kingdomId, { signal }).then(almanac => almanac.kingdom || null, () => null),
  overlay() {
    if (typeof document === 'undefined') return null;
    const overlay = document.createElement('div');
    overlay.className = 'pier-chat-overlay';
    Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5', overflow: 'hidden' });
    document.body.append(overlay);
    return overlay;
  },
};

/** How long to wait for the drawn water under the head before asking again (the grand raster can arrive late). */
const WATER_RETRY_MS = 1000;

export function mountPierKingdomLayer(host: PierKingdomHost, layer: typeof mountPierLayer = mountPierLayer,
  chat: PierChatViews | null = PIER_CHAT_VIEWS): () => void {
  const pier = foundedPier(host.founded);
  const camera = host.camera instanceof THREE.PerspectiveCamera ? host.camera : null;
  if (!pier || !camera || !pier.lights.length) return () => {};
  let mounted: PierLayer | null = null, mounting = false, disposed = false, nextAsk = -Infinity;
  // Chat's floats belong to every view of the kingdom, the walk included: they never stand aside for it.
  let lines: ChatLines | null = null, chatAsked = false, feed: { dispose(): void } | null = null, overlay: HTMLElement | null = null;
  const pending: PierFeedEvent[] = [];
  const chatAbort = new AbortController();
  const hear = (event: PierFeedEvent) => {
    // Walking, the walk's own layer tags a walker's catch; the stream and watchers hear it here.
    if (host.mode === 'walking' && event.kind === 'caught' && event.via === 'pier') return;
    if (lines) lines.apply(event); else if (pending.length < 64) pending.push(event);
  };
  const raiseChat = (waterY: number) => {
    if (chatAsked || !chat) return;
    chatAsked = true;
    overlay = chat.overlay();
    if (!overlay) return;
    feed = chat.watch(host.kingdomId, hear);
    void chat.kingdomName(host.kingdomId, chatAbort.signal).catch(() => null).then(name => {
      if (disposed || !overlay) return;
      try {
        lines = chat.mount({ scene: host.scene, camera, site: pier.withWater(waterY), overlay, viewport, kingdomName: name ?? null,
          compact: compactView(), hour: () => host.hour() });
        for (const event of pending.splice(0)) lines.apply(event);
      } catch (error) { console.error("Chat's lines on the water could not be drawn.", error); }
    });
  };
  const viewport = () => ({ width: typeof window === 'undefined' ? 1280 : window.innerWidth, height: typeof window === 'undefined' ? 720 : window.innerHeight });
  const lower = () => { mounted?.dispose(); mounted = null; };
  const raise = (now: number) => {
    const lanterns = !mounted && !mounting && !disposed && !walked.has(host.scene), lights = !chatAsked && !!chat && !disposed;
    if ((!lanterns && !lights) || now < nextAsk) return;
    // One read of the drawn water serves the lanterns and chat's lines alike.
    const waterY = host.waterHeight(pier.head[0], pier.head[2]);
    if (waterY === null || !Number.isFinite(waterY)) { nextAsk = now + WATER_RETRY_MS; return; }
    if (lights) raiseChat(waterY);
    if (!lanterns) return;
    mounting = true;
    const options: PierLayerHost = {
      scene: host.scene, camera, site: pier.withWater(waterY), lights: pier.lights, rack: null, controller: null,
      hour: () => host.hour(),
      // The half-hour mood is the same function the realm and the walk read; a watcher's clock is close enough to it.
      mood: () => kingdomWaterMood(host.kingdomId, Date.now()),
      walkers: () => [], viewport, touch: () => false, sound: null, ui: null,
    };
    void layer(options)
      .then(next => { if (disposed || walked.has(host.scene)) next.dispose(); else mounted = next; })
      .catch(error => { console.error('The pier lanterns could not be drawn.', error); })
      .finally(() => { mounting = false; });
  };
  const yieldToWalk = () => { if (walked.has(host.scene)) lower(); };
  listeners.add(yieldToWalk);
  const stopTick = host.onTick((_dt, now) => {
    if (!mounted || !chatAsked) raise(now);
    mounted?.update(now / 1000);
    lines?.update(now / 1000);
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    listeners.delete(yieldToWalk); stopTick(); lower();
    chatAbort.abort(); feed?.dispose(); feed = null; lines?.dispose(); lines = null; overlay?.remove(); overlay = null; pending.length = 0;
    host.signal.removeEventListener('abort', dispose);
  };
  host.signal.addEventListener('abort', dispose);
  return dispose;
}

/** Registers the pier's lanterns with grand-world's kingdom layers: `registerPierKingdomLayer(registerKingdomLayer)`. */
export function registerPierKingdomLayer(register: PierKingdomRegister, layer: typeof mountPierLayer = mountPierLayer): () => void {
  return register('pier', host => mountPierKingdomLayer(host, layer));
}
