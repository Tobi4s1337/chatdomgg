import { Group, Matrix4, type Object3D } from 'three';
import { GrowthSceneFrameSchema, type GrowthCivicPlace, type GrowthSceneFeed, type GrowthSceneFrame, type VoxelBlueprint } from '@chatdom/shared';
import { createGrowthCivicForm, GROWTH_CIVIC_PLACES, growthCivicLights, growthCivicWater,
  type CivicBridgeSite, type CivicGrowthLight, type CivicStyle } from '../../../../packages/content/src/growth-civic';

/** Each factory transfers exclusive ownership of its object and resources to the adapter. */
export interface ManagedGrowthObject {
  readonly object: Object3D;
  dispose(): void;
}
export type GrowthCivicUnavailableReason = 'feed' | 'invalid-frame' | 'origin-mismatch' | 'realm-change' | 'regression' | 'build-failed' | 'callback-failed';
export interface GrowthCivicAdapterOptions {
  readonly feed: GrowthSceneFeed;
  readonly style: CivicStyle;
  /** Local-to-group transforms, copied at construction. Each form uses build-cell coordinates. */
  readonly anchors: Readonly<Record<GrowthCivicPlace, Matrix4>>;
  readonly bridgeSite: CivicBridgeSite;
  readonly buildMesh: (blueprint: VoxelBlueprint, place: GrowthCivicPlace) => Promise<ManagedGrowthObject>;
  readonly createLight: (light: CivicGrowthLight, place: GrowthCivicPlace) => ManagedGrowthObject;
  readonly createWater: (water: NonNullable<ReturnType<typeof growthCivicWater>>, place: GrowthCivicPlace) => ManagedGrowthObject;
  readonly onUnavailable: (reason: GrowthCivicUnavailableReason) => void;
  /** Called before subscribing and after reset, while no snapshot is ready. */
  readonly onWaiting: () => void;
  /** Called after every place is mounted, including recovery. The bounded beat tail is omitted. */
  readonly onReady: (frame: GrowthSceneFrame) => void;
}
export interface GrowthCivicAdapter {
  readonly group: Group;
  /** Move the owned group to a host scene; calling repeatedly does not duplicate it. */
  attach(parent: Object3D): void;
  /** Required before switching kingdoms or seeking backwards. The feed stays subscribed. */
  reset(): void;
  dispose(): void;
}

interface PlaceState {
  readonly root: Group;
  readonly resources: ManagedGrowthObject[];
  level: number | null;
  pending: number | null;
  generation: number;
}

/** Read-only presentation of snapshots. Recent beats are intentionally never replayed. */
export function createGrowthCivicAdapter(options: GrowthCivicAdapterOptions): GrowthCivicAdapter {
  const bridgeSite = { ...options.bridgeSite };
  const group = new Group();
  group.name = 'growth-civic';
  const states = new Map<GrowthCivicPlace, PlaceState>();
  for (const place of GROWTH_CIVIC_PLACES) {
    const root = new Group();
    root.name = `growth-${place}`;
    root.matrixAutoUpdate = false;
    root.matrix.copy(options.anchors[place]);
    group.add(root);
    states.set(place, { root, resources: [], level: null, pending: null, generation: 0 });
  }
  let accepted: GrowthSceneFrame | null = null;
  let disposed = false;
  let canBecomeReady = false;
  let readySequence: number | null = null;
  let available = false;
  const unavailable = (reason: GrowthCivicUnavailableReason) => {
    if (disposed) return;
    available = false;
    canBecomeReady = false;
    // Host notification errors must not escape async builds or interrupt disposal.
    try { options.onUnavailable(reason); } catch { /* Host owns its callback failures. */ }
  };
  const waiting = () => {
    if (disposed) return;
    try { options.onWaiting(); } catch { unavailable('callback-failed'); }
  };
  const ready = () => {
    if (disposed || !canBecomeReady || !accepted) return;
    const frame = accepted;
    if (GROWTH_CIVIC_PLACES.some(place => {
      const state = states.get(place)!;
      return state.level !== frame.civic[place] || state.pending !== null;
    })) return;
    if (available && readySequence === frame.sequence) return;
    available = true;
    readySequence = frame.sequence;
    try { options.onReady(structuredClone({ ...frame, beats: [] })); }
    catch { unavailable('callback-failed'); }
  };
  const owned = new WeakSet<Object3D>();
  const acquire = (resource: ManagedGrowthObject, resources: ManagedGrowthObject[]) => {
    if (!resource || !resource.object?.isObject3D || typeof resource.dispose !== 'function' || owned.has(resource.object)
      || resource.object.parent || resource.object === group || [...states.values()].some(state => state.root === resource.object)) {
      throw new Error('Growth factories must return a uniquely owned object and disposer');
    }
    owned.add(resource.object);
    resources.push(resource);
  };
  const clean = (resources: ManagedGrowthObject[]) => {
    let failed = false;
    for (const resource of resources.splice(0)) {
      try { resource.object.removeFromParent(); } catch { failed = true; }
      owned.delete(resource.object);
      try { resource.dispose(); } catch { failed = true; }
    }
    if (failed) unavailable('build-failed');
    return !failed;
  };
  const clear = () => {
    accepted = null;
    available = false;
    canBecomeReady = false;
    readySequence = null;
    let succeeded = true;
    for (const state of states.values()) {
      state.generation++;
      state.pending = null;
      state.level = null;
      if (!clean(state.resources)) succeeded = false;
    }
    return succeeded;
  };
  const build = async (place: GrowthCivicPlace, level: number, state: PlaceState) => {
    const generation = ++state.generation;
    state.pending = level;
    const resources: ManagedGrowthObject[] = [];
    try {
      const blueprint = createGrowthCivicForm(place, options.style, level, bridgeSite);
      acquire(await options.buildMesh(blueprint, place), resources);
      if (disposed || generation !== state.generation) { clean(resources); return; }
      for (const light of growthCivicLights(place, level, bridgeSite)) {
        acquire(options.createLight(light, place), resources);
      }
      const water = growthCivicWater(place, level);
      if (water) acquire(options.createWater(water, place), resources);
      // Host callbacks may synchronously reset or dispose the adapter.
      if (disposed || generation !== state.generation) { clean(resources); return; }
      clean(state.resources);
      if (disposed || generation !== state.generation) { clean(resources); return; }
      for (const resource of resources) {
        state.root.add(resource.object);
        // Three dispatches added synchronously; listeners can reset or dispose.
        if (disposed || generation !== state.generation) { clean(resources); return; }
      }
      state.resources.push(...resources);
      state.level = level;
      state.pending = null;
      ready();
    } catch {
      clean(resources);
      if (!disposed && generation === state.generation) {
        state.pending = null;
        unavailable('build-failed');
      }
    }
  };
  const receive = (frame: GrowthSceneFrame) => {
    if (disposed) return;
    if ((frame.origin === 'live' ? 'LIVE' : 'SIMULATED') !== options.feed.label) {
      unavailable('origin-mismatch'); return;
    }
    if (accepted && frame.kingdomId !== accepted.kingdomId) { unavailable('realm-change'); return; }
    if (accepted && (frame.sequence < accepted.sequence || GROWTH_CIVIC_PLACES.some(place => frame.civic[place] < accepted!.civic[place])
      || frame.sequence === accepted.sequence && GROWTH_CIVIC_PLACES.some(place => frame.civic[place] !== accepted!.civic[place]))) {
      unavailable('regression'); return;
    }
    const needsReplacement = available && GROWTH_CIVIC_PLACES.some(place => states.get(place)!.level !== frame.civic[place]);
    accepted = frame;
    canBecomeReady = true;
    if (needsReplacement) {
      available = false;
      waiting();
    }
    for (const place of GROWTH_CIVIC_PLACES) {
      if (disposed || accepted !== frame) return;
      const state = states.get(place)!;
      const level = frame.civic[place];
      if (state.level !== level && state.pending !== level) void build(place, level, state);
    }
    ready();
  };
  // Serialize host reentrancy: disposal callbacks can emit frames or request another
  // reset while an earlier reset is still clearing its five place states.
  type Delivery = { kind: 'frame'; frame: GrowthSceneFrame } | { kind: 'invalid-frame' } | { kind: 'unavailable' } | { kind: 'reset' };
  const deliveries: Delivery[] = [];
  let delivering = false;
  const deliver = (delivery: Delivery) => {
    if (disposed) return;
    deliveries.push(delivery);
    if (delivering) return;
    delivering = true;
    try {
      while (!disposed && deliveries.length) {
        const next = deliveries.shift()!;
        if (next.kind === 'frame') receive(next.frame);
        else if (next.kind === 'reset') { if (clear()) waiting(); }
        else unavailable(next.kind === 'invalid-frame' ? 'invalid-frame' : 'feed');
      }
    } finally {
      if (disposed) deliveries.length = 0;
      delivering = false;
    }
  };
  let unsubscribe: () => void;
  waiting();
  try {
    unsubscribe = options.feed.subscribe(frame => {
      if (disposed) return;
      // Parsing validates and clones nested data before a reentrant sender can mutate it.
      const parsed = GrowthSceneFrameSchema.safeParse(frame);
      deliver(parsed.success ? { kind: 'frame', frame: parsed.data } : { kind: 'invalid-frame' });
    }, () => deliver({ kind: 'unavailable' }));
  } catch (error) {
    // A feed may emit synchronously before failing, leaving builds in flight.
    disposed = true;
    clear();
    group.clear();
    throw error;
  }
  return {
    group,
    attach(parent) { if (!disposed && group.parent !== parent) parent.add(group); },
    reset() { deliver({ kind: 'reset' }); },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Host callbacks may throw; teardown must still release every owned resource.
      try { unsubscribe(); } catch { /* Already disposed: do not notify the host. */ }
      try { clear(); } finally {
        try { group.removeFromParent(); } catch { /* Three listeners cannot interrupt teardown. */ }
      }
    },
  };
}
