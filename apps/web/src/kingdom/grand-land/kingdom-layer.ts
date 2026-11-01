import type { Camera, Scene } from 'three';
import type { KingdomId } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import type { WaterSurface } from '../../places/water/surface';

/** Effects share the kingdom's renderer and clock. Solid geometry stays in founded placements. */
export interface KingdomLayerMount {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly mode: 'walking' | 'watching' | 'stream';
  readonly kingdomId: KingdomId;
  readonly founded: RealmFoundedScene;
  hour(): number;
  waterHeight(x: number, z: number): number | null;
  onTick(listener: (dt: number, now: number) => void): () => void;
  readonly quality: 'high' | 'balanced' | 'low';
  readonly signal: AbortSignal;
  /** Live effects/witnesses must check this; hidden preparation and replay never claim live events. */
  active(): boolean;
}

/** A throwing initializer must release its partial GPU/network resources; the host clears ticks and new roots. */
export type KingdomLayerMounter = (host: KingdomLayerMount) => () => void;
type Registration = { readonly id: string; readonly mount: KingdomLayerMounter };
type LayerHost = { attach(registration: Registration): void; detach(registration: Registration): void };
type DrawnWater = Pick<WaterSurface, 'root' | 'waterAt'>;
type LayerContext = Omit<KingdomLayerMount, 'kingdomId' | 'waterHeight' | 'onTick'> & { water(): DrawnWater };
const registrations = new Map<string, Registration>();
const hosts = new Set<LayerHost>();

/** Registers immediately in every open scene, including scenes opened before registration. */
export function registerKingdomLayer(id: string, mount: KingdomLayerMounter): () => void {
  if (!id.trim()) throw new Error('A kingdom layer needs an id');
  if (registrations.has(id)) throw new Error(`Kingdom layer already registered: ${id}`);
  const registration = { id, mount };
  registrations.set(id, registration);
  try {
    for (const host of [...hosts]) if (hosts.has(host)) host.attach(registration);
  } catch (error) {
    registrations.delete(id);
    for (const host of [...hosts]) host.detach(registration);
    throw error;
  }
  return () => {
    if (registrations.get(id) !== registration) return;
    registrations.delete(id);
    for (const host of [...hosts]) host.detach(registration);
  };
}

/** One controller per founded scene; there is no independent animation loop or geometry claim. */
export function createKingdomLayers(context: LayerContext) {
  if (!context.founded.kingdomId) throw new Error('Kingdom layers need the founded kingdom identity');
  type Layer = { abort: AbortController; ticks: Set<(dt: number, now: number) => void>; release?: () => void };
  const layers = new Map<Registration, Layer>();
  let disposed = false, revision = 0;
  const host: LayerHost = { attach, detach };
  function cleanup(layer: Layer) {
    layer.ticks.clear();
    layer.abort.abort();
    const release = layer.release;
    delete layer.release;
    try { release?.(); } catch (error) { console.error('Kingdom layer cleanup failed', error); }
  }
  function detach(registration: Registration) {
    const layer = layers.get(registration);
    if (!layer) return;
    layers.delete(registration);
    cleanup(layer);
    revision++;
  }
  function attach(registration: Registration) {
    if (disposed || layers.has(registration) || registrations.get(registration.id) !== registration) return;
    const layer: Layer = { abort: new AbortController(), ticks: new Set() };
    layers.set(registration, layer);
    const existingRoots = new Set(context.scene.children);
    try {
      const release = registration.mount({
        scene: context.scene, camera: context.camera, founded: context.founded, kingdomId: context.founded.kingdomId,
        get mode() { return context.mode; },
        get quality() { return context.quality; },
        hour: () => context.hour(), active: () => !disposed && !layer.abort.signal.aborted && context.active(),
        waterHeight(x, z) {
          if (disposed || layer.abort.signal.aborted) return null;
          const water = context.water();
          return water.root.visible && water.root.parent === context.scene ? water.waterAt(x, z)?.level ?? null : null;
        },
        onTick(listener) {
          if (disposed || layer.abort.signal.aborted) return () => {};
          layer.ticks.add(listener);
          return () => { layer.ticks.delete(listener); };
        },
        signal: layer.abort.signal,
      });
      if (typeof release !== 'function') throw new Error(`Kingdom layer must return a disposer: ${registration.id}`);
      layer.release = release;
      // Unregister or host abort can happen inside the initializer itself.
      if (layer.abort.signal.aborted) cleanup(layer);
      revision++;
    } catch (error) {
      detach(registration);
      for (const root of [...context.scene.children]) if (!existingRoots.has(root)) root.removeFromParent();
      throw error;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    hosts.delete(host);
    context.signal.removeEventListener('abort', dispose);
    // Clear every layer before any disposer can re-enter the tick loop.
    const remaining = [...layers.values()].reverse();
    layers.clear();
    for (const layer of remaining) { layer.ticks.clear(); layer.abort.abort(); }
    for (const layer of remaining) cleanup(layer);
  }
  if (context.signal.aborted) dispose();
  else {
    context.signal.addEventListener('abort', dispose, { once: true });
    hosts.add(host);
    try {
      for (const registration of [...registrations.values()]) attach(registration);
    } catch (error) { dispose(); throw error; }
  }
  return {
    get revision() { return revision; },
    tick(dt: number, now: number) {
      if (disposed) return;
      let animated = false;
      for (const layer of [...layers.values()]) for (const listener of [...layer.ticks]) {
        if (disposed || layer.abort.signal.aborted || !layer.ticks.has(listener)) continue;
        animated = true;
        listener(dt, now);
      }
      // Frozen evidence clocks still redraw layers using the host's frame time.
      if (animated) revision++;
    },
    dispose,
  };
}
