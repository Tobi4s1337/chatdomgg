import { VOXEL_METRES, VoxelBlueprintSchema, type Vec3 } from '@chatdom/shared';
import type { WindowHouse } from '@chatdom/render';
import { terrainHeight, settlementTerrainWorkspaceBytes, type KingdomLayout, type SettlementPlan } from '@chatdom/world';
import { buildLightVolume, MAX_LIGHT_VOLUME_CELLS, type LightEmitter, type LightVolume } from '@chatdom/voxel';
import { MATERIALS } from '@chatdom/content/materials';

export const LIGHT_FIELD_SIZE: Vec3 = [128, 32, 128];
export const LIGHT_FIELD_CELL = 0.5;
export const LIGHT_FIELD_CELLS = 128 * 32 * 128;
export const LIGHT_FIELD_BUDGET = 6 * 1024 * 1024;
export type LightFieldLayout = KingdomLayout | SettlementPlan;

export interface LightFieldOptions { readonly mode?: 'local' | 'kingdom' | 'beacon'; readonly position?: Vec3; readonly bounds?: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } }
export interface LightFieldConfig {
  readonly mode: 'local' | 'kingdom' | 'beacon';
  readonly size: Vec3;
  readonly cellSize: number;
  readonly cells: number;
  /** The kingdom field is fixed; the local field follows the camera. */
  readonly origin: Vec3 | null;
  readonly levelScale: number;
}

/**
 * The coarse field covers the settlement's whole XZ bounds and its -2..30 m
 * surface-light band. The castle summit has no presence emitter. Larger tenure
 * layouts double cell size until they fit the same bounded workspace.
 */
export function resolveLightFieldConfig(layout: LightFieldLayout, options: LightFieldOptions = {}): LightFieldConfig {
  const mode = options.mode ?? 'local';
  if (mode === 'local') return { mode, size: LIGHT_FIELD_SIZE, cellSize: LIGHT_FIELD_CELL, cells: LIGHT_FIELD_CELLS, origin: null, levelScale: 1 };
  if (mode === 'beacon') {
    if (!options.position || options.position.some(value => !Number.isFinite(value))) throw new Error('Beacon light needs a finite position');
    return { mode, size: [32, 24, 32], cellSize: 2, cells: 32 * 24 * 32, levelScale: 1,
      origin: [Math.floor(options.position[0] / 2) * 2 - 32, Math.floor(options.position[1] / 2) * 2 - 40, Math.floor(options.position[2] / 2) * 2 - 32] };
  }
  if (mode !== 'kingdom') throw new Error('Unknown light field mode');
  const { minX, maxX, minZ, maxZ } = options.bounds ?? layout.bounds;
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) throw new Error('Invalid kingdom light bounds');
  let cellSize = 2;
  for (;;) {
    const origin: Vec3 = [Math.floor(minX / cellSize) * cellSize, -2, Math.floor(minZ / cellSize) * cellSize];
    const size: Vec3 = [Math.ceil((maxX - origin[0]) / cellSize), Math.ceil(32 / cellSize), Math.ceil((maxZ - origin[2]) / cellSize)];
    const cells = size[0] * size[1] * size[2];
    if (Number.isSafeInteger(cells) && cells > 0 && cells <= MAX_LIGHT_VOLUME_CELLS) {
      return { mode, origin, size, cellSize, cells, levelScale: Math.min(15, Math.max(1, Math.round(15 * cellSize / 10))) };
    }
    cellSize *= 2;
    if (!Number.isFinite(cellSize)) throw new Error('Kingdom light bounds exceed supported range');
  }
}

export interface LightFieldEmitter extends LightEmitter { readonly normal?: Vec3 }
/** Adapter-only reconstruction. Raw flood bytes retain their 0..15 contract.
 * Samples are shared grid vertices (size + 1); low nibble is radiance and bit 7
 * marks the cell beginning at that vertex as occupied. Never hardware-filter bits. */
export interface SurfaceLightVolume extends LightVolume { readonly surfaceSamples: Uint8Array }
export interface LightFieldSolve {
  readonly kind: 'solve';
  readonly revision: number;
  readonly origin: Vec3;
  readonly emitters: readonly LightFieldEmitter[];
}
export type LightFieldRequest = LightFieldSolve | {
  readonly kind: 'init'; readonly layout: LightFieldLayout; readonly houses: readonly WindowHouse[]; readonly options?: LightFieldOptions;
};
export type LightFieldResponse = { readonly kind: 'ready' }
  | { readonly kind: 'volume'; readonly revision: number; readonly volume: SurfaceLightVolume; readonly occupancyBuilds: number; readonly solveMs: number }
  | { readonly kind: 'error'; readonly revision: number | null; readonly message: string };

/** `solid` here means "blocks light": glass is walked against but passes light like the air it fills. */
interface WorldBox { readonly min: Vec3; readonly max: Vec3; readonly solid: boolean; readonly glass: boolean }
interface LightHouse { readonly min: Vec3; readonly max: Vec3; readonly boxes: readonly WorldBox[]; readonly glazed: readonly number[] }

const blocksLight = new Uint8Array(65536).fill(1), passesAsGlass = new Uint8Array(65536);
blocksLight[0] = 0;
for (const material of MATERIALS.materials) {
  blocksLight[material.id] = Number(material.blocksLight);
  passesAsGlass[material.id] = Number(material.id !== 0 && !material.blocksLight);
}

const cornerConnected = Uint8Array.from({ length: 256 }, (_, mask) => {
  if (!mask) return 0;
  let reached = mask & -mask;
  for (let pass = 0; pass < 7; pass++) {
    let next = reached;
    for (let bit = 0; bit < 8; bit++) if (reached & (1 << bit)) {
      next |= mask & ((1 << (bit ^ 1)) | (1 << (bit ^ 2)) | (1 << (bit ^ 4)));
    }
    if (next === reached) break;
    reached = next;
  }
  return Number(reached === mask);
});
const cornerContributors = Uint8Array.from({ length: 256 }, (_, mask) => {
  let count = 0;
  for (let bit = 0; bit < 8; bit++) count += (mask >> bit) & 1;
  return count;
});

function writeCornerAir(size: Vec3, occupancy: Uint8Array, masks: Uint8Array): void {
  const [sx, sy, sz] = size;
  let target = 0;
  for (let z = 0; z <= sz; z++) for (let y = 0; y <= sy; y++) for (let x = 0; x <= sx; x++) {
    let mask = 0;
    for (let corner = 0; corner < 8; corner++) {
      const cx = x - 1 + (corner & 1), cy = y - 1 + ((corner >> 1) & 1), cz = z - 1 + ((corner >> 2) & 1);
      if (cx >= 0 && cy >= 0 && cz >= 0 && cx < sx && cy < sy && cz < sz && !occupancy[cx + sx * (cy + sy * cz)]) mask |= 1 << corner;
    }
    masks[target++] = mask;
  }
}

/** Shared vertices make adjacent air cells agree exactly on their whole face.
 * Disconnected air touching only at an edge/corner takes its darkest value,
 * rather than averaging a lit room into a sealed dark one. */
export function buildLightFieldSamples(size: Vec3, occupancy: Uint8Array, light: Uint8Array, cachedAir?: Uint8Array): Uint8Array {
  const [sx, sy, sz] = size, count = sx * sy * sz;
  if (size.some(value => !Number.isSafeInteger(value) || value < 1) || count > MAX_LIGHT_VOLUME_CELLS
    || occupancy.length !== count || light.length !== count) throw new Error('Invalid light sample dimensions');
  const samples = new Uint8Array((sx + 1) * (sy + 1) * (sz + 1));
  const masks = cachedAir ?? new Uint8Array(samples.length);
  if (masks.length !== samples.length) throw new Error('Invalid light corner cache');
  if (!cachedAir) writeCornerAir(size, occupancy, masks);
  if (light.some(value => value > 15)) throw new Error('Surface light levels must be in 0..15');
  const plane = sx * sy, offsets = [0, 1, sx, sx + 1, plane, plane + 1, plane + sx, plane + sx + 1];
  let target = 0;
  for (let z = 0; z <= sz; z++) for (let y = 0; y <= sy; y++) {
    let source = -1 + sx * (y - 1 + sy * (z - 1));
    for (let x = 0; x <= sx; x++, source++, target++) {
      const mask = masks[target]!;
      if (mask === 0) { samples[target] = 128; continue; }
      if (mask === 255) {
        // Most of a field is open air. Eight consecutive-stride loads avoid
        // repeating bounds/occupancy/connectivity branches on every solve.
        samples[target] = Math.round((light[source]! + light[source + 1]! + light[source + sx]! + light[source + sx + 1]!
          + light[source + plane]! + light[source + plane + 1]! + light[source + plane + sx]! + light[source + plane + sx + 1]!) * 0.125);
        continue;
      }
      let sum = 0, minimum = 15;
      for (let corner = 0; corner < 8; corner++) if (mask & (1 << corner)) {
        const value = light[source + offsets[corner]!]!;
        sum += value; minimum = Math.min(minimum, value);
      }
      const value = cornerConnected[mask] ? Math.round(sum / cornerContributors[mask]!) : minimum;
      samples[target] = value | ((mask & 128) ? 0 : 128);
    }
  }
  return samples;
}

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
    const boxes = blueprint.boxes.map(box => ({ ...transformed(box.from, box.to), solid: blocksLight[box.material] === 1, glass: passesAsGlass[box.material] === 1 }));
    // A glazed opening is its glass and every air carve that meets that glass (the reveal through the wall).
    const glazed = boxes.flatMap((box, index) => !box.solid && (box.glass || boxes.some(other => other.glass && touches(box, other))) ? [index] : []);
    return { ...transformed([0, 0, 0], blueprint.size), boxes, glazed };
  });
}

function touches(a: WorldBox, b: WorldBox): boolean {
  return a.min.every((value, axis) => value < b.max[axis]! && a.max[axis]! > b.min[axis]!);
}

/**
 * Half-metre cells cannot hold a 0.375 m wall and the window in it apart. A cell that a glazed opening reaches
 * is open only if no light blocker survives anywhere inside it once every box has painted in order. Build cells
 * lie on the house's 0.125 m lattice, so one sample at each build-cell centre decides the cell exactly.
 */
function glazedCellOpen(house: LightHouse, candidates: readonly WorldBox[], min: Vec3, cellSize: number): boolean {
  const step = VOXEL_METRES.build;
  const local = candidates.filter(box => box.min.every((value, axis) => value < min[axis]! + cellSize && box.max[axis]! > min[axis]!));
  if (!local.some(box => !box.solid)) return false;
  // Every build cell with any volume in this cell, including ones straddling its faces.
  const first = min.map((value, axis) => Math.floor((value - house.min[axis]!) / step + 1e-6));
  const last = min.map((value, axis) => Math.ceil((value + cellSize - house.min[axis]!) / step - 1e-6));
  for (let k = first[2]!; k < last[2]!; k++) for (let j = first[1]!; j < last[1]!; j++) for (let i = first[0]!; i < last[0]!; i++) {
    const x = house.min[0] + (i + 0.5) * step, y = house.min[1] + (j + 0.5) * step, z = house.min[2] + (k + 0.5) * step;
    for (let b = local.length - 1; b >= 0; b--) {
      const box = local[b]!;
      if (x < box.min[0] || x >= box.max[0] || y < box.min[1] || y >= box.max[1] || z < box.min[2] || z >= box.max[2]) continue;
      if (box.solid) return false;
      break;
    }
  }
  return true;
}

function overlaps(min: Vec3, max: Vec3, origin: Vec3, config: LightFieldConfig): boolean {
  return min.every((value, axis) => value < origin[axis]! + config.size[axis]! * config.cellSize && max[axis]! > origin[axis]!);
}

/**
 * Reusable worker-owned field workspace. A house's ordered carves affect only
 * its scratch shell; its final shell is unioned into terrain and other houses.
 */
export function createLightFieldSolver(layout: LightFieldLayout, houses: readonly WindowHouse[], options: LightFieldOptions = {}): {
  solve(request: LightFieldSolve): { volume: SurfaceLightVolume; occupancyBuilds: number };
} {
  const config = resolveLightFieldConfig(layout, options);
  const { size, cellSize, cells } = config;
  const geometry = compileLightHouses(houses);
  const occupancy = new Uint8Array(cells);
  const scratch = new Uint8Array(cells);
  const cornerHeights = new Float32Array((size[0] + 1) * (size[2] + 1));
  const cornerAir = new Uint8Array(size.reduce((count, value) => count * (value + 1), 1));
  let cachedOrigin: Vec3 | null = null;
  let occupancyBuilds = 0;

  function rasterize(origin: Vec3): void {
    occupancy.fill(0);
    const [sx, sy, sz] = size;
    for (let z = 0; z <= sz; z++) for (let x = 0; x <= sx; x++) {
      cornerHeights[x + (sx + 1) * z] = terrainHeight(layout, origin[0] + x * cellSize, origin[2] + z * cellSize);
    }
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const corner = x + (sx + 1) * z;
      const high = Math.max(cornerHeights[corner]!, cornerHeights[corner + 1]!, cornerHeights[corner + sx + 1]!, cornerHeights[corner + sx + 2]!,
        terrainHeight(layout, origin[0] + (x + 0.5) * cellSize, origin[2] + (z + 0.5) * cellSize));
      const top = Math.max(0, Math.min(sy, Math.ceil((high - origin[1]) / cellSize)));
      for (let y = 0; y < top; y++) occupancy[x + sx * (y + sy * z)] = 1;
    }
    for (const house of geometry) {
      if (!overlaps(house.min, house.max, origin, config)) continue;
      scratch.fill(0);
      for (const box of house.boxes) {
        if (!overlaps(box.min, box.max, origin, config)) continue;
        // Solids expand outward; an air carve must wholly enclose a coarse cell.
        const from = box.min.map((value, axis) => Math.max(0, (box.solid ? Math.floor : Math.ceil)((value - origin[axis]!) / cellSize)));
        const to = box.max.map((value, axis) => Math.min(size[axis]!, (box.solid ? Math.ceil : Math.floor)((value - origin[axis]!) / cellSize)));
        for (let z = from[2]!; z < to[2]!; z++) for (let y = from[1]!; y < to[1]!; y++) {
          const row = sx * (y + sy * z);
          scratch.fill(box.solid ? 1 : 0, row + from[0]!, row + to[0]!);
        }
      }
      // Unglazed partial carves keep the conservative rule above; glazed openings resolve exactly.
      if (cellSize <= 0.5) for (const index of house.glazed) {
        const opening = house.boxes[index]!;
        if (!overlaps(opening.min, opening.max, origin, config)) continue;
        const candidates = house.boxes.filter(box => touches(box, { min: opening.min.map(v => v - cellSize) as unknown as Vec3, max: opening.max.map(v => v + cellSize) as unknown as Vec3, solid: false, glass: false }));
        const from = opening.min.map((value, axis) => Math.max(0, Math.floor((value - origin[axis]!) / cellSize)));
        const to = opening.max.map((value, axis) => Math.min(size[axis]!, Math.ceil((value - origin[axis]!) / cellSize)));
        for (let z = from[2]!; z < to[2]!; z++) for (let y = from[1]!; y < to[1]!; y++) for (let x = from[0]!; x < to[0]!; x++) {
          const index = x + sx * (y + sy * z);
          if (scratch[index] !== 1) continue;
          const min: Vec3 = [origin[0] + x * cellSize, origin[1] + y * cellSize, origin[2] + z * cellSize];
          scratch[index] = glazedCellOpen(house, candidates, min, cellSize) ? 0 : 2;
        }
      }
      const from = house.min.map((value, axis) => Math.max(0, Math.floor((value - origin[axis]!) / cellSize)));
      const to = house.max.map((value, axis) => Math.min(size[axis]!, Math.ceil((value - origin[axis]!) / cellSize)));
      for (let z = from[2]!; z < to[2]!; z++) for (let y = from[1]!; y < to[1]!; y++) for (let x = from[0]!; x < to[0]!; x++) {
        const index = x + sx * (y + sy * z);
        if (scratch[index]) occupancy[index] = 1;
      }
    }
    writeCornerAir(size, occupancy, cornerAir);
    cachedOrigin = [...origin];
    occupancyBuilds++;
  }

  /** Exact ordered-box intervals: conservative projection may escape a coarse
   * facade cell, but never crosses an actual wall, closed window or neighbour. */
  function clearProjection(from: Vec3, axis: number, direction: number, distance: number): boolean {
    for (let step = 0; step <= Math.ceil(distance / 0.25); step++) {
      const point = [...from];
      point[axis] = point[axis]! + direction * Math.min(distance, step * 0.25);
      if (point[1]! < terrainHeight(layout, point[0]!, point[2]!)) return false;
    }
    for (const house of geometry) {
      if (from.some((value, d) => d !== axis && (value < house.min[d]! || value >= house.max[d]!))) continue;
      const intervals: { min: number; max: number; solid: boolean }[] = [];
      const cuts = [0, distance];
      for (const box of house.boxes) {
        if (from.some((value, d) => d !== axis && (value < box.min[d]! || value >= box.max[d]!))) continue;
        const a = (box.min[axis]! - from[axis]!) * direction, b = (box.max[axis]! - from[axis]!) * direction;
        const min = Math.max(0, Math.min(a, b)), max = Math.min(distance, Math.max(a, b));
        if (min >= max) continue;
        intervals.push({ min, max, solid: box.solid });
        cuts.push(min, max);
      }
      cuts.sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        if (cuts[i - 1] === cuts[i]) continue;
        const middle = (cuts[i - 1]! + cuts[i]!) / 2;
        for (let b = intervals.length - 1; b >= 0; b--) {
          const interval = intervals[b]!;
          if (middle < interval.min || middle >= interval.max) continue;
          if (interval.solid) return false;
          break;
        }
      }
    }
    return true;
  }

  function projectEmitter(emitter: LightFieldEmitter, origin: Vec3): LightEmitter | null {
    const cell = emitter.position.map((value, axis) => Math.floor((value - origin[axis]!) / cellSize));
    const outside = () => cell.some((value, axis) => value < 0 || value >= size[axis]!);
    const occupied = () => occupancy[cell[0]! + size[0] * (cell[1]! + size[1] * cell[2]!)] !== 0;
    if (outside()) return null;
    const level = Math.round(emitter.level / config.levelScale);
    if (!occupied()) return { position: emitter.position, level };
    if (!emitter.normal) return null;
    let axis = 0;
    for (let dimension = 1; dimension < 3; dimension++) if (Math.abs(emitter.normal[dimension]!) > Math.abs(emitter.normal[axis]!)) axis = dimension;
    const direction = Math.sign(emitter.normal[axis]!);
    if (emitter.normal.some((value, d) => !Number.isFinite(value) || Math.abs(value - (d === axis ? direction : 0)) > 1e-6) || direction === 0) {
      throw new Error('Light source projection requires a cardinal outward normal');
    }
    // At most two cells: crossing a narrow occupied facade is allowed only when
    // every authored point along the outward ray is already air.
    for (let step = 0; step < 2; step++) {
      const boundary = origin[axis]! + (cell[axis]! + (direction > 0 ? 1 : 0)) * cellSize;
      const distance = (boundary - emitter.position[axis]!) * direction + 1e-6;
      if (distance > cellSize * 2 || !clearProjection(emitter.position, axis, direction, distance)) return null;
      cell[axis] = cell[axis]! + direction;
      if (outside()) return null;
      const position: [number, number, number] = [...emitter.position];
      position[axis] = position[axis]! + direction * distance;
      if (!occupied()) {
        return { position, level };
      }
      // A low window can sit above real ground but below the top of its rounded
      // two-metre terrain cell. After the same bounded outward escape, admit one
      // upward cell only when terrain alone closes this cell, the entire bent
      // ray is exact air, and the destination is genuinely unoccupied.
      if (config.mode === 'kingdom' && axis !== 1 && terrainOnlyCell(cell, origin)) {
        const upperY = origin[1] + (cell[1]! + 1) * cellSize + 1e-6;
        const up = upperY - position[1];
        if (up <= cellSize && distance + up <= cellSize * 2 && cell[1]! + 1 < size[1]
          && !occupancy[cell[0]! + size[0] * (cell[1]! + 1 + size[1] * cell[2]!)]
          && clearProjection(position, 1, 1, up)) {
          position[1] = upperY;
          return { position, level };
        }
      }
    }
    return null;
  }

  /** Match rasterize's conservative terrain/ordered-box cells without another volume. */
  function terrainOnlyCell(cell: readonly number[], origin: Vec3): boolean {
    const x = cell[0]!, y = cell[1]!, z = cell[2]!, corner = x + (size[0] + 1) * z;
    const min: Vec3 = [origin[0] + x * cellSize, origin[1] + y * cellSize, origin[2] + z * cellSize];
    const max: Vec3 = [min[0] + cellSize, min[1] + cellSize, min[2] + cellSize];
    const high = Math.max(cornerHeights[corner]!, cornerHeights[corner + 1]!, cornerHeights[corner + size[0] + 1]!,
      cornerHeights[corner + size[0] + 2]!, terrainHeight(layout, min[0] + cellSize / 2, min[2] + cellSize / 2));
    if (min[1] >= high) return false;
    for (const house of geometry) {
      if (house.min.some((value, axis) => value >= max[axis]! || house.max[axis]! <= min[axis]!)) continue;
      let solid = false;
      for (const box of house.boxes) {
        if (box.solid) {
          if (box.min.every((value, axis) => value < max[axis]! && box.max[axis]! > min[axis]!)) solid = true;
        } else if (box.min.every((value, axis) => value <= min[axis]! && box.max[axis]! >= max[axis]!)) solid = false;
      }
      if (solid) return false;
    }
    return true;
  }

  return {
    solve(request) {
      if (!Number.isSafeInteger(request.revision) || request.revision < 1 || request.origin.some(value => !Number.isFinite(value))) throw new Error('Invalid light field request');
      if (config.origin && request.origin.some((value, axis) => value !== config.origin![axis])) throw new Error('Fixed light origin must remain fixed');
      for (const emitter of request.emitters) {
        if (!Number.isInteger(emitter.level) || emitter.level < 0 || emitter.level > 15 || emitter.position.some(value => !Number.isFinite(value))) throw new Error('Invalid voxel light emitter');
      }
      if (!cachedOrigin || request.origin.some((value, axis) => value !== cachedOrigin![axis])) rasterize(request.origin);
      // Even half-metre cells can conservatively close an authored window recess.
      // Every resolution uses the same bounded, exact-air outward projection.
      const emitters = request.emitters.map(emitter => projectEmitter(emitter, request.origin))
        .filter((emitter): emitter is LightEmitter => emitter !== null);
      const volume = buildLightVolume({ revision: request.revision, origin: request.origin, size, cellSize, occupancy, emitters });
      if (config.levelScale !== 1) for (let index = 0; index < volume.light.length; index++) volume.light[index] = Math.min(15, volume.light[index]! * config.levelScale);
      // Scratch replaces the caller-occupancy copy already counted by the voxel
      // estimate. This adapter has no main-thread occupancy; add the height grid.
      const surfaceSamples = buildLightFieldSamples(size, occupancy, volume.light, cornerAir);
      // New worker reconstruction + the padded current CPU/GPU samples. The
      // raw result remains intact; no authoritative occupancy is transferred.
      const terrainBytes = 'version' in layout && layout.version === 2 ? settlementTerrainWorkspaceBytes(layout) : 0;
      const estimatedPeakBytes = volume.estimatedPeakBytes + cornerHeights.byteLength + cornerAir.byteLength + surfaceSamples.byteLength + 2 * (surfaceSamples.byteLength - cells) + terrainBytes;
      if (estimatedPeakBytes > LIGHT_FIELD_BUDGET) throw new Error('Light field exceeded its memory budget');
      return { volume: { ...volume, surfaceSamples, estimatedPeakBytes }, occupancyBuilds };
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
        solver = createLightFieldSolver(request.layout, request.houses, request.options);
        scope.postMessage({ kind: 'ready' }, []);
        return;
      }
      if (!solver) throw new Error('Light field worker was not initialized');
      const started = performance.now();
      const result = solver.solve(request);
      scope.postMessage({ kind: 'volume', revision: request.revision, ...result, solveMs: performance.now() - started }, [result.volume.light.buffer as ArrayBuffer, result.volume.surfaceSamples.buffer as ArrayBuffer]);
    } catch (error) {
      scope.postMessage({ kind: 'error', revision: request.kind === 'solve' ? request.revision : null, message: error instanceof Error ? error.message : 'Light field worker failed' }, []);
    }
  };
}

const workerScope = globalThis as unknown as WorkerScope;
if (typeof document === 'undefined' && typeof workerScope.postMessage === 'function') bindLightFieldWorker(workerScope);
