import { VOXEL_METRES, VoxelBlueprintSchema, type Vec3 } from '@chatdom/shared';
import type { WindowHouse } from '@chatdom/render';
import { terrainHeight, type KingdomLayout } from '@chatdom/world';
import { buildLightVolume, type LightEmitter, type LightVolume } from '@chatdom/voxel';

export const LIGHT_FIELD_SIZE: Vec3 = [128, 32, 128];
export const LIGHT_FIELD_CELL = 0.5;
export const LIGHT_FIELD_CELLS = 128 * 32 * 128;
export const LIGHT_FIELD_BUDGET = 5 * 1024 * 1024;

export interface LightFieldSolve {
  readonly kind: 'solve';
  readonly revision: number;
  readonly origin: Vec3;
  readonly emitters: readonly LightEmitter[];
}
export type LightFieldRequest = LightFieldSolve | {
  readonly kind: 'init'; readonly layout: KingdomLayout; readonly houses: readonly WindowHouse[];
};
export type LightFieldResponse = { readonly kind: 'ready' }
  | { readonly kind: 'volume'; readonly revision: number; readonly volume: LightVolume; readonly occupancyBuilds: number; readonly solveMs: number }
  | { readonly kind: 'error'; readonly revision: number | null; readonly message: string };

interface WorldBox { readonly min: Vec3; readonly max: Vec3; readonly solid: boolean }
interface LightHouse { readonly min: Vec3; readonly max: Vec3; readonly boxes: readonly WorldBox[] }

/** Exact cardinal transforms avoid trig roundoff changing an aligned carve by one coarse cell. */
function turn(point: Vec3, quadrant: number): Vec3 {
  if (quadrant === 1) return [point[2], point[1], -point[0]];
  if (quadrant === 2) return [-point[0], point[1], -point[2]];
  if (quadrant === 3) return [-point[2], point[1], point[0]];
  return point;
}

export function compileLightHouses(houses: readonly WindowHouse[]): readonly LightHouse[] {
  return houses.map(house => {
    if (!Number.isFinite(house.yaw) || house.position.some(value => !Number.isFinite(value))) throw new Error('Invalid light occluder transform');
    const quarter = Math.round(house.yaw / (Math.PI / 2));
    if (Math.abs(house.yaw - quarter * Math.PI / 2) > 1e-7) throw new Error('Light occluders require cardinal rotation');
    const quadrant = ((quarter % 4) + 4) % 4;
    const blueprint = VoxelBlueprintSchema.parse(house.blueprint);
    const transformed = (from: Vec3, to: Vec3) => {
      const a = turn(from.map(value => value * VOXEL_METRES.build) as unknown as Vec3, quadrant);
      const b = turn(to.map(value => value * VOXEL_METRES.build) as unknown as Vec3, quadrant);
      return {
        min: a.map((value, axis) => Math.min(value, b[axis]!) + house.position[axis]!) as unknown as Vec3,
        max: a.map((value, axis) => Math.max(value, b[axis]!) + house.position[axis]!) as unknown as Vec3,
      };
    };
    return {
      ...transformed([0, 0, 0], blueprint.size),
      boxes: blueprint.boxes.map(box => ({ ...transformed(box.from, box.to), solid: box.material !== 0 })),
    };
  });
}

function overlaps(min: Vec3, max: Vec3, origin: Vec3): boolean {
  return min.every((value, axis) => value < origin[axis]! + LIGHT_FIELD_SIZE[axis]! * LIGHT_FIELD_CELL && max[axis]! > origin[axis]!);
}

/**
 * Reusable worker-owned field workspace. A house's ordered carves affect only
 * its scratch shell; its final shell is unioned into terrain and other houses.
 */
export function createLightFieldSolver(layout: KingdomLayout, houses: readonly WindowHouse[]): {
  solve(request: LightFieldSolve): { volume: LightVolume; occupancyBuilds: number };
} {
  const geometry = compileLightHouses(houses);
  const occupancy = new Uint8Array(LIGHT_FIELD_CELLS);
  const scratch = new Uint8Array(LIGHT_FIELD_CELLS);
  const cornerHeights = new Float32Array((LIGHT_FIELD_SIZE[0] + 1) * (LIGHT_FIELD_SIZE[2] + 1));
  let cachedOrigin: Vec3 | null = null;
  let occupancyBuilds = 0;

  function rasterize(origin: Vec3): void {
    occupancy.fill(0);
    const [sx, sy, sz] = LIGHT_FIELD_SIZE;
    for (let z = 0; z <= sz; z++) for (let x = 0; x <= sx; x++) {
      cornerHeights[x + (sx + 1) * z] = terrainHeight(layout, origin[0] + x * LIGHT_FIELD_CELL, origin[2] + z * LIGHT_FIELD_CELL);
    }
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const corner = x + (sx + 1) * z;
      const high = Math.max(cornerHeights[corner]!, cornerHeights[corner + 1]!, cornerHeights[corner + sx + 1]!, cornerHeights[corner + sx + 2]!,
        terrainHeight(layout, origin[0] + (x + 0.5) * LIGHT_FIELD_CELL, origin[2] + (z + 0.5) * LIGHT_FIELD_CELL));
      const top = Math.max(0, Math.min(sy, Math.ceil((high - origin[1]) / LIGHT_FIELD_CELL)));
      for (let y = 0; y < top; y++) occupancy[x + sx * (y + sy * z)] = 1;
    }
    for (const house of geometry) {
      if (!overlaps(house.min, house.max, origin)) continue;
      scratch.fill(0);
      for (const box of house.boxes) {
        if (!overlaps(box.min, box.max, origin)) continue;
        // Solids expand outward; an air carve must wholly enclose a coarse cell.
        const from = box.min.map((value, axis) => Math.max(0, (box.solid ? Math.floor : Math.ceil)((value - origin[axis]!) / LIGHT_FIELD_CELL)));
        const to = box.max.map((value, axis) => Math.min(LIGHT_FIELD_SIZE[axis]!, (box.solid ? Math.ceil : Math.floor)((value - origin[axis]!) / LIGHT_FIELD_CELL)));
        for (let z = from[2]!; z < to[2]!; z++) for (let y = from[1]!; y < to[1]!; y++) {
          const row = sx * (y + sy * z);
          scratch.fill(box.solid ? 1 : 0, row + from[0]!, row + to[0]!);
        }
      }
      const from = house.min.map((value, axis) => Math.max(0, Math.floor((value - origin[axis]!) / LIGHT_FIELD_CELL)));
      const to = house.max.map((value, axis) => Math.min(LIGHT_FIELD_SIZE[axis]!, Math.ceil((value - origin[axis]!) / LIGHT_FIELD_CELL)));
      for (let z = from[2]!; z < to[2]!; z++) for (let y = from[1]!; y < to[1]!; y++) for (let x = from[0]!; x < to[0]!; x++) {
        const index = x + sx * (y + sy * z);
        if (scratch[index]) occupancy[index] = 1;
      }
    }
    cachedOrigin = [...origin];
    occupancyBuilds++;
  }

  return {
    solve(request) {
      if (!Number.isSafeInteger(request.revision) || request.revision < 1 || request.origin.some(value => !Number.isFinite(value))) throw new Error('Invalid light field request');
      if (!cachedOrigin || request.origin.some((value, axis) => value !== cachedOrigin![axis])) rasterize(request.origin);
      const volume = buildLightVolume({ revision: request.revision, origin: request.origin, size: LIGHT_FIELD_SIZE, cellSize: LIGHT_FIELD_CELL, occupancy, emitters: request.emitters });
      // Scratch replaces the caller-occupancy copy already counted by the voxel
      // estimate. This adapter has no main-thread occupancy; add the height grid.
      const estimatedPeakBytes = volume.estimatedPeakBytes + cornerHeights.byteLength;
      if (estimatedPeakBytes > LIGHT_FIELD_BUDGET) throw new Error('Light field exceeded its memory budget');
      return { volume: { ...volume, estimatedPeakBytes }, occupancyBuilds };
    },
  };
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<LightFieldRequest>) => void) | null;
  postMessage(response: LightFieldResponse, transfer: ArrayBuffer[]): void;
}

export function bindLightFieldWorker(scope: WorkerScope): void {
  let solver: ReturnType<typeof createLightFieldSolver> | null = null;
  scope.onmessage = event => {
    const request = event.data;
    try {
      if (request.kind === 'init') {
        solver = createLightFieldSolver(request.layout, request.houses);
        scope.postMessage({ kind: 'ready' }, []);
        return;
      }
      if (!solver) throw new Error('Light field worker was not initialized');
      const started = performance.now();
      const result = solver.solve(request);
      scope.postMessage({ kind: 'volume', revision: request.revision, ...result, solveMs: performance.now() - started }, [result.volume.light.buffer as ArrayBuffer]);
    } catch (error) {
      scope.postMessage({ kind: 'error', revision: request.kind === 'solve' ? request.revision : null, message: error instanceof Error ? error.message : 'Light field worker failed' }, []);
    }
  };
}

const workerScope = globalThis as unknown as WorkerScope;
if (typeof document === 'undefined' && typeof workerScope.postMessage === 'function') bindLightFieldWorker(workerScope);
