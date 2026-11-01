import type { PerspectiveCamera, Scene } from 'three';
import type { Vec3 } from '@chatdom/shared';
import type { CardinalTurn } from '@chatdom/world';

/** Places share the host's camera, clock and lifecycle; they never start a render loop. */
export interface PlaceMount {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly placements: readonly { id: string; position: Vec3; rotation: CardinalTurn; assetHash: string }[];
  readonly localFeet: () => Vec3 | null;
  readonly hour: () => number;
  readonly quality: () => 'high' | 'balanced' | 'low';
  /** Claim an installed campfire visual after attaching it. Tavern exteriors stay with the host. */
  claimPlacement(id: string): void;
  onTick(fn: (dt: number, now: number) => void): () => void;
  onResize(fn: (w: number, h: number) => void): () => void;
}

/** The disposer owns the place's resources. An initializer must release its partial resources if it throws. */
export type PlaceMounter = (mount: PlaceMount) => () => void;

/** Visual claims publish together, only after every initializer has returned successfully. */
export function createPlaceMounts(context: Omit<PlaceMount, 'onTick' | 'onResize' | 'claimPlacement'>, mounters: readonly PlaceMounter[] = []) {
  const ticks = new Set<(dt: number, now: number) => void>();
  const resizes = new Set<(w: number, h: number) => void>();
  const disposers: (() => void)[] = [];
  const installed = new Set(context.placements.map(placement => placement.id)), claims = new Set<string>();
  let disposed = false, mounted = false, revision = 0;
  function subscribe<T>(listeners: Set<T>, fn: T) {
    if (disposed) return () => {};
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; mounted = false;
    // Stop callbacks before calling place disposers, including ones which fail.
    ticks.clear(); resizes.clear(); claims.clear();
    for (const release of disposers.reverse()) {
      try { release(); } catch (error) { console.error('Place cleanup failed', error); }
    }
    disposers.length = 0;
  }
  // A throwing initializer has no disposer to return. Remove its new scene roots;
  // its own try/finally remains responsible for resources not handed to the host.
  const existingRoots = new Set(context.scene.children);
  try {
    for (const mount of mounters) {
      let initializing = true;
      const release = mount({ ...context,
        claimPlacement(id) {
          if (disposed || !initializing) throw new Error('Place visuals must be claimed during initialization');
          if (!installed.has(id)) throw new Error(`Cannot claim missing place placement: ${id}`);
          if (!id.startsWith('gather:campfire:')) throw new Error(`The host owns this place placement: ${id}`);
          if (claims.has(id)) throw new Error(`Place placement already claimed: ${id}`);
          claims.add(id);
        },
        onTick: fn => subscribe(ticks, fn), onResize: fn => subscribe(resizes, fn) });
      initializing = false;
      if (typeof release !== 'function') throw new Error('A place mount must return its disposer');
      disposers.push(release);
    }
    mounted = mounters.length > 0;
  } catch (error) {
    dispose();
    for (const root of [...context.scene.children]) if (!existingRoots.has(root)) root.removeFromParent();
    throw error;
  }
  return {
    get revision() { return revision; },
    /** Filter only the draw list. The original placements still own collision and light occlusion. */
    hostDraws(placementId: string | undefined) { return !mounted || placementId === undefined || !claims.has(placementId); },
    tick(dt: number, now: number) {
      if (disposed || !ticks.size) return;
      for (const fn of [...ticks]) if (ticks.has(fn)) fn(dt, now);
      // A frozen evidence clock still needs fresh pixels for an animating place.
      revision++;
    },
    resize(width: number, height: number) {
      if (disposed) return;
      for (const fn of [...resizes]) if (resizes.has(fn)) fn(width, height);
      if (resizes.size) revision++;
    },
    dispose,
  };
}
