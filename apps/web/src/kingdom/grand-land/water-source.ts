import type { RealmFoundedScene } from '../../../../../packages/world/src/founded-world/types';
import type { LandGroundSource } from '../../../../../packages/world/src/land-interface';
import type { LandWaterSource, LandWaterSample, LandWaterCoverage } from '../../../../../packages/world/src/grand-adoption/pier-sites-types';
import type { BoundsXZ } from '../../../../../packages/world/src/settlement/types';
import { BASIN_FEATHER, assertGround, basinDistance, groundAt, waterAt, type WaterGround } from '../../places/water/surface/coverage';
import { assertRaster, rasterWaterAt } from '../../places/water/surface/raster';
import type { WaterSurfaceOptions } from '../../places/water/surface/surface';

type Metadata = { readonly kind: 'lake' | 'river' | 'sea'; readonly biome: string };
type Surface = Pick<WaterSurfaceOptions, 'ground' | 'bodies' | 'reaches' | 'raster'>;
const MAX_CELLS = 16_384;

/** The same inputs supplied to the renderer, plus explicit producer metadata and the installed physical bed.
 * No recipe/biome is inferred from a house, a water height, or the word "raster". The producer owns immutable
 * installed arrays and half-metre physical columns; replace this source when either installed revision changes. */
export function createSurfaceLandWater(scene: Pick<RealmFoundedScene, 'layoutRevision' | 'collisionRevision'>,
  physical: LandGroundSource, surface: Surface, metadata: Readonly<Record<string, Metadata>>): LandWaterSource {
  if (physical.layoutRevision !== scene.layoutRevision || physical.collisionRevision !== scene.collisionRevision)
    throw new Error('Water and physical bed need the same installed revisions');
  const { ground, raster } = surface, bodies = surface.bodies ?? [], reaches = surface.reaches ?? [];
  assertGround(ground);
  if (!Number.isFinite(ground.step)) throw new RangeError('Water ground step must be finite');
  if (raster) assertRaster(raster, ground);
  if (bodies.some(body => ![body.x, body.z, body.radiusX, body.radiusZ, body.level].every(Number.isFinite)
    || body.radiusX <= 0 || body.radiusZ <= 0)) throw new RangeError('Water basins need finite geometry');
  const descriptions = new Map(Object.entries(metadata).filter(([, value]) =>
    ['lake', 'river', 'sea'].includes(value.kind) && typeof value.biome === 'string' && value.biome.trim().length > 0)
    .map(([id, value]) => [id, Object.freeze({ kind: value.kind, biome: value.biome })]));
  const query = (x: number, z: number) => raster ? rasterWaterAt(raster, ground, x, z) : waterAt(bodies, reaches, ground, x, z);
  const bed = (x: number, z: number): number | null => {
    const point = physical.sample(x, z);
    return point && point[0] === x && point[2] === z && Number.isFinite(point[1]) ? point[1] : null;
  };
  const known = (x: number, z: number): boolean => {
    const gx = (x - ground.origin[0]) / ground.step, gz = (z - ground.origin[1]) / ground.step;
    return Number.isFinite(gx) && Number.isFinite(gz) && gx >= 0 && gz >= 0
      && (raster ? gx < ground.width && gz < ground.height : gx <= ground.width - 1 && gz <= ground.height - 1);
  };
  const sample = (x: number, z: number): LandWaterSample | null => {
    if (!known(x, z)) return null;
    const visibleBed = groundAt(ground, Math.min(x, ground.origin[0] + (ground.width - 1) * ground.step),
      Math.min(z, ground.origin[1] + (ground.height - 1) * ground.step));
    if (!Number.isFinite(visibleBed)) return null;
    const floor = bed(x, z);
    if (floor === null) return null;
    const wet = query(x, z);
    if (!wet) return { state: 'dry' };
    const description = descriptions.get(wet.id);
    if (!description?.biome || !Number.isFinite(wet.level) || wet.level < floor) return null;
    if (wet.level === floor) return { state: 'shore', level: wet.level, depth: 0, ...description };
    return { state: 'wet', level: wet.level, depth: wet.level - floor, ...description };
  };

  const coverage = (bounds: BoundsXZ): LandWaterCoverage | null => {
    const { minX, minZ, maxX, maxZ } = bounds;
    if (![minX, minZ, maxX, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ) return null;
    const endX = ground.origin[0] + (ground.width - (raster ? 0 : 1)) * ground.step;
    const endZ = ground.origin[1] + (ground.height - (raster ? 0 : 1)) * ground.step;
    if (minX < ground.origin[0] || minZ < ground.origin[1] || maxX > endX || maxZ > endZ) return null;
    // A complete certificate for interpolated stream strips requires a separate producer adapter.
    if (!raster && (bodies.length !== 1 || reaches.length)) return null;
    const x0 = Math.floor((minX - ground.origin[0]) / ground.step), x1 = Math.ceil((maxX - ground.origin[0]) / ground.step);
    const z0 = Math.floor((minZ - ground.origin[1]) / ground.step), z1 = Math.ceil((maxZ - ground.origin[1]) / ground.step);
    const px0 = Math.floor(minX * 2), px1 = Math.ceil(maxX * 2), pz0 = Math.floor(minZ * 2), pz1 = Math.ceil(maxZ * 2);
    if ((x1 - x0) * (z1 - z0) > MAX_CELLS || (px1 - px0) * (pz1 - pz0) > MAX_CELLS) return null;
    let state: 'dry' | 'wet' | 'shore' | undefined, level: number | undefined, description: Metadata | undefined;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const extrema = cellExtrema(ground, x, z);
      if (!extrema) return null;
      const y = raster ? raster.levels[x + z * ground.width]! : bodies[0]!.level;
      let cell: 'dry' | 'wet' | 'shore';
      if (raster) {
        if (!Number.isFinite(y) || extrema.min >= y) cell = 'dry';
        else if (extrema.max < y) cell = 'wet';
        else cell = 'shore'; // known shoreline, never a fully wet footprint certificate
      } else {
        const body = bodies[0]!, threshold = 1 + BASIN_FEATHER / Math.min(body.radiusX, body.radiusZ);
        const ax = Math.max(minX, ground.origin[0] + x * ground.step), bx = Math.min(maxX, ground.origin[0] + (x + 1) * ground.step);
        const az = Math.max(minZ, ground.origin[1] + z * ground.step), bz = Math.min(maxZ, ground.origin[1] + (z + 1) * ground.step);
        const nearest = basinDistance(body, Math.max(ax, Math.min(bx, body.x)), Math.max(az, Math.min(bz, body.z)));
        if (nearest > threshold || extrema.min >= y) cell = 'dry';
        else if (extrema.max < y && [ax, bx].every(cx => [az, bz].every(cz => basinDistance(body, cx, cz) <= threshold))) cell = 'wet';
        else cell = 'shore';
      }
      state = state && state !== cell ? 'shore' : cell;
      if (cell !== 'dry') {
        if (level !== undefined && level !== y) return null;
        level = y; description = descriptions.get(raster ? 'raster' : bodies[0]!.id);
        if (!description?.biome) return null;
      }
    }
    let highest = -Infinity;
    // Physical ground is the installed half-metre column field, not the shader's triangle interpolation.
    for (let z = pz0; z < pz1; z++) for (let x = px0; x < px1; x++) {
      const value = bed((Math.max(minX, x / 2) + Math.min(maxX, (x + 1) / 2)) / 2,
        (Math.max(minZ, z / 2) + Math.min(maxZ, (z + 1) / 2)) / 2);
      if (value === null) return null;
      highest = Math.max(highest, value);
    }
    if (state === 'dry') return { state: 'dry' };
    if (level === undefined || !description) return null;
    if (state === 'shore') return { state: 'shore', level, minDepth: 0, ...description };
    return state === 'wet' && level > highest ? { state: 'wet', level, minDepth: level - highest, ...description } : null;
  };
  return Object.freeze({ layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sample, coverage });
}

/** A triangle-linear bed stays between its cell vertices; raster's last row/column repeat their edge heights. */
function cellExtrema(ground: WaterGround, x: number, z: number): { min: number; max: number } | null {
  const values = [ground.data[x + z * ground.width]!, ground.data[Math.min(x + 1, ground.width - 1) + z * ground.width]!,
    ground.data[x + Math.min(z + 1, ground.height - 1) * ground.width]!,
    ground.data[Math.min(x + 1, ground.width - 1) + Math.min(z + 1, ground.height - 1) * ground.width]!];
  return values.every(Number.isFinite) ? { min: Math.min(...values), max: Math.max(...values) } : null;
}
