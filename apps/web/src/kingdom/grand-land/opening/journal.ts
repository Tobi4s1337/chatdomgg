/**
 * The opening journal: what has really happened while a kingdom opens. Only real steps write to it (the loader
 * mounting, the founded receipt and scene verified, the land's binding and surface verified, each region's
 * first mesh put into the scene, bytes actually read, assets actually meshed, the first loaded frame drawn).
 * The loader draws from this state and nothing else, so its progress can never run ahead of the truth.
 * Every step also leaves a `chatdom:open:<step>` performance mark for timing evidence.
 */

export type OpeningStep =
  /** The designed loader is on screen. */
  | 'gate'
  /** The kingdom's founded scene was read and verified against its receipt. */
  | 'scene'
  /** The land's receipt binding, metadata and surface were read and verified. */
  | 'land'
  /** Every region of the installed streets has its exact mesh in the scene. */
  | 'street'
  /** The first view's land is complete. */
  | 'ground'
  /** Every home, tree and prop of the first view is meshed. */
  | 'homes'
  /** The first fully loaded frame was drawn: the kingdom is open. */
  | 'lit'
  /** All of the land the first view needs at full detail has settled. */
  | 'whole';
export const OPENING_STEPS: readonly OpeningStep[] = ['gate', 'scene', 'land', 'street', 'ground', 'homes', 'lit', 'whole'];

export interface OpeningBounds { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

/** The real land, downsampled for drawing: heights in metres (null outside the land), sea level and water. */
export interface OpeningLand {
  readonly bounds: OpeningBounds;
  readonly columns: number; readonly rows: number;
  /** Row-major, x fastest. Visual ground height in metres. */
  readonly heights: Float32Array;
  /** Row-major. 1 where the cell is under water (sea, lake or river), else 0. */
  readonly water: Uint8Array;
  readonly seaLevel: number;
  /** The installed physical region (the founded town) in the same frame. */
  readonly town: OpeningBounds;
}

/** The founded town as it was verified: streets, home lots and the landmarks, in x/z metres. */
export interface OpeningStreets {
  readonly bounds: OpeningBounds;
  /** Open streets are inked solid; planned ones (reserved for growth) dotted. */
  readonly streets: readonly { readonly points: readonly (readonly [number, number])[]; readonly width: number; readonly open: boolean;
    readonly kind: 'main' | 'lane' | 'approach' | 'trail' }[];
  /** Lot rectangles of the homes that stand, in plot order. */
  readonly homes: readonly ({ readonly slot: number } & OpeningBounds)[];
  readonly squares: readonly (readonly (readonly [number, number])[])[];
  readonly castle: OpeningBounds | null;
  /** The viewer's own home slot when the entry knows it (a signed-in citizen), else null. */
  readonly ownSlot: number | null;
  readonly lake: { readonly x: number; readonly z: number; readonly radiusX: number; readonly radiusZ: number } | null;
}

export interface OpeningRegion { readonly rx: number; readonly rz: number; readonly level: number; readonly exact: boolean;
  readonly bounds: OpeningBounds; readonly at: number }

export interface OpeningLandBytes {
  /** Bytes actually read from responses and the browser cache for the land. */
  readonly received: number;
  /** The first view's planned artifact bytes, once the land owner has planned it; 0 before. */
  readonly planned: number;
  readonly requiredRegions: number; readonly coveredRegions: number;
  readonly cacheHits: number;
}

export interface OpeningState {
  readonly revision: number;
  readonly name: string | null;
  /** performance.now() of each step that has happened. */
  readonly at: Readonly<Partial<Record<OpeningStep, number>>>;
  readonly streets: OpeningStreets | null;
  /** performance.now() when the streets were given (a verified founded scene, or the kingdom's own plan). */
  readonly streetsAt: number | null;
  readonly land: OpeningLand | null;
  readonly regions: readonly OpeningRegion[];
  readonly bytes: OpeningLandBytes | null;
  readonly assets: { readonly done: number; readonly total: number } | null;
  /** Home slots whose own first mesh is in the scene, in the order they were raised. */
  readonly raised: readonly number[];
  /** True while the kingdom draws today's land (no baked land for this receipt). */
  readonly local: boolean;
  readonly failed: string | null;
}

export interface OpeningJournal {
  readonly state: OpeningState;
  step(step: OpeningStep, at?: number): void;
  name(name: string): void;
  streets(streets: OpeningStreets, at?: number): void;
  land(land: OpeningLand): void;
  region(region: Omit<OpeningRegion, 'at'>, at?: number): void;
  bytes(bytes: OpeningLandBytes): void;
  assets(done: number, total: number): void;
  /** The homes on these slots now stand in the scene (their own blueprint was meshed and instanced). */
  raised(slots: readonly number[]): void;
  local(): void;
  fail(message: string): void;
  subscribe(listener: (state: OpeningState) => void): () => void;
}

const MAX_REGIONS = 4096;
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

export function createOpeningJournal(): OpeningJournal {
  let state: OpeningState = { revision: 0, name: null, at: {}, streets: null, streetsAt: null, land: null, regions: [], bytes: null,
    assets: null, raised: [], local: false, failed: null };
  const listeners = new Set<(state: OpeningState) => void>();
  const seen = new Set<string>(), standing = new Set<number>();
  function commit(next: Omit<OpeningState, 'revision'>) {
    state = Object.freeze({ ...next, revision: state.revision + 1 });
    for (const listener of [...listeners]) listener(state);
  }
  function mark(step: OpeningStep) {
    try { performance.mark(`chatdom:open:${step}`); } catch { /* Marks are evidence only. */ }
  }
  return {
    get state() { return state; },
    step(step, at = now()) {
      if (state.at[step] !== undefined || state.failed) return;
      mark(step);
      commit({ ...state, at: Object.freeze({ ...state.at, [step]: at }) });
    },
    name(name) {
      const value = name.trim().slice(0, 80);
      if (!value || value === state.name) return;
      commit({ ...state, name: value });
    },
    streets(streets, at = now()) { if (!state.streets) commit({ ...state, streets, streetsAt: at }); },
    land(land) {
      if (state.land) return;
      if (land.columns < 1 || land.rows < 1 || land.heights.length !== land.columns * land.rows || land.water.length !== land.heights.length)
        throw new Error('An opening map needs a complete grid');
      commit({ ...state, land });
    },
    region(region, at = now()) {
      const key = `${region.rx},${region.rz}`;
      if (seen.has(key) || seen.size >= MAX_REGIONS) return;
      seen.add(key);
      commit({ ...state, regions: Object.freeze([...state.regions, Object.freeze({ ...region, at })]) });
    },
    bytes(bytes) {
      const previous = state.bytes;
      if (previous && previous.received === bytes.received && previous.planned === bytes.planned
        && previous.requiredRegions === bytes.requiredRegions && previous.coveredRegions === bytes.coveredRegions
        && previous.cacheHits === bytes.cacheHits) return;
      commit({ ...state, bytes: Object.freeze({ ...bytes }) });
    },
    assets(done, total) {
      if (!(total > 0) || done < 0) return;
      const value = Math.min(done, total);
      if (state.assets && state.assets.done >= value && state.assets.total === total) return;
      commit({ ...state, assets: Object.freeze({ done: value, total }) });
    },
    raised(slots) {
      const fresh = slots.filter(slot => Number.isInteger(slot) && slot >= 0 && slot < 65534 && !standing.has(slot) && standing.size < MAX_REGIONS);
      if (!fresh.length || state.failed) return;
      for (const slot of fresh) standing.add(slot);
      commit({ ...state, raised: Object.freeze([...state.raised, ...new Set(fresh)]) });
    },
    local() { if (!state.local) commit({ ...state, local: true }); },
    fail(message) { commit({ ...state, failed: message }); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
