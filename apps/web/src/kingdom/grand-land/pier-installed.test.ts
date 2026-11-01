import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { CardinalTurn } from '../../../../../packages/world/src/settlement/types';
import { terrainHeight } from '../../../../../packages/world/src/layout';
import { transformCardinalPoint } from '../../../../../packages/world/src/settlement/geometry';
import { decodeFoundedScene } from '../../../../../packages/world/src/founded-world/validate';
import { compileFoundedScene } from '../../../../../packages/world/src/founded-world/collision';
import { grandGroundSource } from '../../../../../packages/world/src/grand/kingdom/ground';
import { createKingdomLandInterface, validatePierSite, type PierAnchor, type PierSiteCandidate } from '../../../../../packages/world/src/land-interface';
import { prepareInstalledLand } from './prepare';
import { grandRecipeFor } from './recipes';
import { createSurfaceLandWater } from './water-source';

const scenePath = process.env.GRAND_FOUNDED_SCENE, receiptPath = process.env.GRAND_FOUNDED_RECEIPT;
// Offline receipt-matched evidence only. This never installs a pier or persists a guessed deck size.
it.skipIf(!scenePath || !receiptPath)('measures real water agreement and rejects the unsupported flat-deck probe without changing either land', async () => {
  const scene = await decodeFoundedScene(new Uint8Array(readFileSync(scenePath!)), JSON.parse(readFileSync(receiptPath!, 'utf8')));
  const plan = scene.plan, recipe = grandRecipeFor(String(scene.kingdomId))!;
  expect(plan.landform.version).toBe(1);
  if (plan.landform.version !== 1) throw new Error('This evidence adapter is for the pinned v1 adoption');
  const unchanged = JSON.stringify(scene), ground = grandGroundSource(scene), collision = compileFoundedScene(scene);
  const origin = [Math.floor(plan.bounds.minX) - 20, Math.floor(plan.bounds.minZ) - 20] as const;
  const width = Math.ceil(plan.bounds.maxX - origin[0]) + 21, height = Math.ceil(plan.bounds.maxZ - origin[1]) + 21;
  const data = new Float32Array(width * height);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) data[x + z * width] = terrainHeight(plan, origin[0] + x, origin[1] + z);
  const lake = plan.landform.lake;
  const oldWater = createSurfaceLandWater(scene, ground, { ground: { data, width, height, origin, step: 1 }, reaches: [],
    bodies: [{ ...lake, id: 'lake', radiusX: lake.radiusX * 1.3, radiusZ: lake.radiusZ * 1.3, depth: Math.max(0, lake.level + 2.8) }] },
  { lake: { kind: 'lake', biome: recipe.seed.biome } });
  const { land, seated } = prepareInstalledLand(plan, recipe), [ox, oy, oz] = seated.seat.offset;
  const waterBed = new Float32Array(land.ground.length), levels = new Float32Array(land.ground.length);
  for (let i = 0; i < waterBed.length; i++) {
    waterBed[i] = land.ground[i]! * .5 - oy;
    levels[i] = land.water[i]! > land.ground[i]! ? land.water[i]! * .5 - oy : NaN;
  }
  // Only the known physical v1 region is queried; no lake classification is assigned to the distant sea/rivers.
  const grandWater = createSurfaceLandWater(scene, ground, {
    ground: { data: waterBed, width: land.size, height: land.size, origin: [-ox, -oz], step: .5 },
    raster: { levels, seaLevel: land.seaLevel * .5 - oy }, bodies: [], reaches: [],
  }, { raster: { kind: 'lake', biome: recipe.seed.biome } });
  let sharedWetSamples = 0, differingMasks = 0;
  for (let z = Math.ceil(lake.z - lake.radiusZ); z < lake.z + lake.radiusZ; z += 2)
    for (let x = Math.ceil(lake.x - lake.radiusX); x < lake.x + lake.radiusX; x += 2) {
      const old = oldWater.sample(x, z), grand = grandWater.sample(x, z);
      if (old?.state === 'wet' && grand?.state === 'wet') {
        expect(grand).toEqual(old); // Actual drawn level, physical depth and explicit identity must all agree.
        sharedWetSamples++;
      } else if (old?.state !== grand?.state) differingMasks++;
    }
  expect(sharedWetSamples).toBeGreaterThan(100);
  // This is a deliberately explicit flat-deck probe, NOT pier's authored ramp + 8 m T-head. Its observed
  // rejection guards against inventing a convenient anchor by ignoring real support or moving placements.
  const dimensions = { width: 2, length: 12, landingDepth: 1, waterStart: 4, minDepth: .5, minFreeboard: .25 };
  const rejected: Record<string, number> = {};
  let checked = 0, accepted: PierAnchor | undefined;
  // Evidence search is bounded and deterministic. Production receives authored candidates and dimensions.
  search: for (let z = Math.floor(lake.z - lake.radiusZ * 1.3) - 12; z <= lake.z + lake.radiusZ * 1.3 + 12; z += 2)
    for (let x = Math.floor(lake.x - lake.radiusX * 1.3) - 12; x <= lake.x + lake.radiusX * 1.3 + 12; x += 2)
      for (const turn of [0, 1, 2, 3] as const satisfies readonly CardinalTurn[]) {
        const root = ground.sample(x, z);
        if (!root || oldWater.sample(x, z)?.state !== 'dry' || grandWater.sample(x, z)?.state !== 'dry') continue;
        const tip = transformCardinalPoint(root, turn, [0, 0, dimensions.length]);
        if (oldWater.sample(tip[0], tip[2])?.state !== 'wet' || grandWater.sample(tip[0], tip[2])?.state !== 'wet') continue;
        if (checked >= 512) break search;
        checked++;
        const candidate: PierSiteCandidate = { id: 'pier:willowmere:acceptance', root, turn };
        const old = validatePierSite({ scene, groundAt: ground.sample, collision, water: oldWater }, candidate, dimensions);
        const grand = validatePierSite({ scene, groundAt: ground.sample, collision, water: grandWater }, candidate, dimensions);
        for (const [label, result] of [['old', old], ['grand', grand]] as const) if (!result.ok) {
          const key = `${label}:${result.reason}`; rejected[key] = (rejected[key] ?? 0) + 1;
        }
        if (!old.ok || !grand.ok) continue;
        expect(grand.anchor).toEqual(old.anchor);
        accepted = grand.anchor;
        const oldFacade = createKingdomLandInterface({ scene, ground, collision, water: oldWater, pierSites: { dimensions, pinned: accepted } });
        const grandFacade = createKingdomLandInterface({ scene, ground, collision, water: grandWater, pierSites: { dimensions, pinned: accepted } });
        expect(oldFacade.piers).toEqual([accepted]);
        expect(grandFacade.piers).toEqual(oldFacade.piers);
        break search;
      }
  console.info(JSON.stringify({ sharedWetSamples, differingMasks, checked, dimensions, accepted: accepted ?? null, rejected }));
  expect(JSON.stringify(scene) === unchanged, 'all installed scene bytes remain unchanged').toBe(true);
  expect(checked).toBe(512);
  expect(accepted, 'the observed unsupported probe must not acquire an invented anchor').toBeUndefined();
  expect(rejected['old:budget-exceeded'] ?? 0).toBe(0);
  expect(rejected['grand:budget-exceeded'] ?? 0).toBe(0);
// Low-priority offline generation shares a production host; this is not a product load-time budget.
}, 600_000);
