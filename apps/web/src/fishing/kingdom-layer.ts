import * as THREE from 'three';
import { kingdomWaterMood, type KingdomId } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import { foundedPier } from './founded-pier';
import { mountPierLayer, type PierLayer, type PierLayerHost } from './layer';

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

/** How long to wait for the drawn water under the head before asking again (the grand raster can arrive late). */
const WATER_RETRY_MS = 1000;

export function mountPierKingdomLayer(host: PierKingdomHost, layer: typeof mountPierLayer = mountPierLayer): () => void {
  const pier = foundedPier(host.founded);
  const camera = host.camera instanceof THREE.PerspectiveCamera ? host.camera : null;
  if (!pier || !camera || !pier.lights.length) return () => {};
  let mounted: PierLayer | null = null, mounting = false, disposed = false, nextAsk = -Infinity;
  const viewport = () => ({ width: typeof window === 'undefined' ? 1280 : window.innerWidth, height: typeof window === 'undefined' ? 720 : window.innerHeight });
  const lower = () => { mounted?.dispose(); mounted = null; };
  const raise = (now: number) => {
    if (mounted || mounting || disposed || walked.has(host.scene) || now < nextAsk) return;
    const waterY = host.waterHeight(pier.head[0], pier.head[2]);
    if (waterY === null || !Number.isFinite(waterY)) { nextAsk = now + WATER_RETRY_MS; return; }
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
    if (!mounted) raise(now);
    mounted?.update(now / 1000);
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    listeners.delete(yieldToWalk); stopTick(); lower();
    host.signal.removeEventListener('abort', dispose);
  };
  host.signal.addEventListener('abort', dispose);
  return dispose;
}

/** Registers the pier's lanterns with grand-world's kingdom layers: `registerPierKingdomLayer(registerKingdomLayer)`. */
export function registerPierKingdomLayer(register: PierKingdomRegister, layer: typeof mountPierLayer = mountPierLayer): () => void {
  return register('pier', host => mountPierKingdomLayer(host, layer));
}
