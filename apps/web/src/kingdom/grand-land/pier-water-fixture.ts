import type { RealmFoundedScene } from '../../../../../packages/world/src/founded-world/types';
import { terrainHeight } from '../../../../../packages/world/src/layout';
import { grandGroundSource } from '../../../../../packages/world/src/grand/kingdom/ground';
import { prepareInstalledLand } from './prepare';
import { grandRecipeFor } from './recipes';
import { createSurfaceLandWater } from './water-source';

/** Offline evidence helper. Reproduce the actual native and grand surface inputs for the pinned receipt;
 * no browser or server imports this generator-backed fixture. Physical source bounds exclude far scenery. */
export function pierWaterFixture(scene: RealmFoundedScene) {
  const plan = scene.plan, recipe = grandRecipeFor(String(scene.kingdomId));
  if (!recipe || plan.landform.version !== 1) throw new Error('This receipt has no pinned v1 water evidence adapter');
  const ground = grandGroundSource(scene), lake = plan.landform.lake;
  const origin = [Math.floor(plan.bounds.minX) - 20, Math.floor(plan.bounds.minZ) - 20] as const;
  const width = Math.ceil(plan.bounds.maxX - origin[0]) + 21, height = Math.ceil(plan.bounds.maxZ - origin[1]) + 21;
  const data = new Float32Array(width * height);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) data[x + z * width] = terrainHeight(plan, origin[0] + x, origin[1] + z);
  const old = createSurfaceLandWater(scene, ground, { ground: { data, width, height, origin, step: 1 }, reaches: [],
    bodies: [{ ...lake, id: 'lake', radiusX: lake.radiusX * 1.3, radiusZ: lake.radiusZ * 1.3, depth: Math.max(0, lake.level + 2.8) }] },
  { lake: { kind: 'lake', biome: recipe.seed.biome } });
  // Defer the expensive generation until the proposal passes native geometry and water validation.
  const grand = () => {
    const { land, seated } = prepareInstalledLand(plan, recipe), [ox, oy, oz] = seated.seat.offset;
    const waterBed = new Float32Array(land.ground.length), levels = new Float32Array(land.ground.length);
    for (let i = 0; i < waterBed.length; i++) {
      waterBed[i] = land.ground[i]! * .5 - oy;
      levels[i] = land.water[i]! > land.ground[i]! ? land.water[i]! * .5 - oy : NaN;
    }
    return createSurfaceLandWater(scene, ground, {
      ground: { data: waterBed, width: land.size, height: land.size, origin: [-ox, -oz], step: .5 },
      raster: { levels, seaLevel: land.seaLevel * .5 - oy }, bodies: [], reaches: [],
    }, { raster: { kind: 'lake', biome: recipe.seed.biome } });
  };
  return { old, grand, ground, biome: recipe.seed.biome };
}
