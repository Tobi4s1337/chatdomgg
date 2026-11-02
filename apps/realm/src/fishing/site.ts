import { VOXEL_METRES, type FishingPierSite, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { seedHash, terrainHeight, transformCardinalPoint, waterSurfaceAt, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import { sampleGenesisSurface } from '@chatdom/world/genesis';
import { createFishingPier, type FishingPierContent } from '../../../../packages/content/src/pier/layout';
import type { StyleKey } from '../../../../packages/content/src/materials';

const CELL = VOXEL_METRES.build;
const FREEBOARD = .75;
const WALKS = [20, 16, 12] as const;
const TURNS: readonly CardinalTurn[] = [0, 1, 2, 3];
const LATERALS = [0, 4, -4, 8, -8, 12, -12, 16, -16] as const;
type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };
export interface PierPiece { readonly id: string; readonly blueprint: VoxelBlueprint; readonly position: Vec3; readonly rotation: CardinalTurn }
export interface PierInstallation { readonly site: FishingPierSite; readonly content: FishingPierContent; readonly pieces: readonly PierPiece[] }

const overlap = (a: Bounds, b: Bounds, gap = .25) => a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
const contains = (outer: Bounds, inner: Bounds) => inner.minX >= outer.minX + .5 && inner.maxX <= outer.maxX - .5 && inner.minZ >= outer.minZ + .5 && inner.maxZ <= outer.maxZ - .5;
const bounds = (points: readonly Vec3[]): Bounds => ({ minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[2])), maxZ: Math.max(...points.map(p => p[2])) });

/** Pier local origin is the walk's left corner; the shared root is the dry end's centre. */
export function pierLocalToWorld(site: FishingPierSite, local: Vec3): Vec3 {
  return transformCardinalPoint([site.root[0], site.deckY, site.root[2]], site.turn, [(local[0] - 10) * CELL, local[1] * CELL, local[2] * CELL]);
}

export function pierFootprint(site: FishingPierSite): readonly Bounds[] {
  const rect = (x0: number, z0: number, x1: number, z1: number) => bounds([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => pierLocalToWorld(site, [x!, 0, z!])));
  return [rect(0, -8, 20, site.walk / CELL), rect(-22, site.walk / CELL, 42, site.walk / CELL + 32)];
}

/** Read the water actually drawn for this adopted plan. Never fish an invisible legacy lake under grand land. */
export function pierWaterAt(plan: SettlementPlan, x: number, z: number): number | null {
  if (plan.genesisSurface) {
    const surface = sampleGenesisSurface(plan.genesisSurface, x, z);
    return surface.shoreDistance < 0 && surface.waterLevel !== null && terrainHeight(plan, x, z) < surface.waterLevel - .05 ? surface.waterLevel : null;
  }
  const surface = waterSurfaceAt(plan.landform, x, z);
  return surface !== null && terrainHeight(plan, x, z) < surface - .05 ? surface : null;
}

function isClearOfPlan(plan: SettlementPlan, site: FishingPierSite): boolean {
  const footprint = pierFootprint(site);
  if (!footprint.every(rect => contains(plan.bounds, rect))) return false;
  const squares = [plan.market, plan.castle.court, ...plan.courts].map(square => bounds(square.boundary.map(([x, z]) => [x, 0, z])));
  if (footprint.some(rect => overlap(rect, plan.castle.bounds) || squares.some(square => overlap(rect, square)) || plan.reservations.some(plot => overlap(rect, plot.lot)))) return false;
  for (const street of plan.streets) for (let i = 1; i < street.points.length; i++) {
    const a = street.points[i - 1]!, b = street.points[i]!, clearance = street.width / 2 + street.verge + .35;
    // Cardinal footprint expanded by the full authored road corridor, intersected with the segment by slabs.
    for (const rect of footprint) {
      let low = 0, high = 1;
      for (const [start, delta, min, max] of [[a[0], b[0] - a[0], rect.minX - clearance, rect.maxX + clearance], [a[2], b[2] - a[2], rect.minZ - clearance, rect.maxZ + clearance]]) {
        if (Math.abs(delta!) < 1e-9) { if (start! < min! || start! > max!) high = -1; }
        else { const u = (min! - start!) / delta!, v = (max! - start!) / delta!; low = Math.max(low, Math.min(u, v)); high = Math.min(high, Math.max(u, v)); }
      }
      if (low <= high) return false;
    }
  }
  return true;
}

function supportedSite(plan: SettlementPlan, site: FishingPierSite): boolean {
  if (!isClearOfPlan(plan, site)) return false;
  // The factory's bank ramp is at most four cells, over twelve cells of run. The full entry body stays dry.
  for (const x of [4, 10, 16]) for (const z of [-6, -2, .5]) {
    const at = pierLocalToWorld(site, [x, 0, z]), y = foundedGroundAt(plan, at[0], at[2])[1];
    if (y < site.waterY + .125 || Math.abs(y - site.deckY) > .5) return false;
  }
  // Neither a shelf of bank nor a second island may rise through the walk between its dry root and wet head.
  for (let z = 4; z <= site.walk / CELL; z += 4) for (const x of [3, 10, 17]) {
    const at = pierLocalToWorld(site, [x, 0, z]), y = foundedGroundAt(plan, at[0], at[2])[1];
    if (y > site.deckY + .25) return false;
    if (z > 32) {
      const water = pierWaterAt(plan, at[0], at[2]);
      if (water === null || Math.abs(water - site.waterY) > 1e-6) return false;
    }
  }
  // The entire T-head must lie over the same real water with at least a metre beneath it.
  // Include both outer edges and every build-cell crossing, including the collision grid's bank steps.
  for (let x = -22; x <= 42; x++) for (let z = site.walk / CELL; z <= site.walk / CELL + 32; z++) {
    const at = pierLocalToWorld(site, [x, 0, z]), water = pierWaterAt(plan, at[0], at[2]);
    if (water === null || Math.abs(water - site.waterY) > 1e-6 || water - Math.max(terrainHeight(plan, at[0], at[2]), foundedGroundAt(plan, at[0], at[2])[1]) < 1) return false;
  }
  // Open water beyond the front edge is required for a real cast, not merely water under the timber.
  for (const x of [2, 10, 18]) for (const distance of [2, 4, 7]) {
    const at = pierLocalToWorld(site, [x, 0, (site.walk + 4 + distance) / CELL]), water = pierWaterAt(plan, at[0], at[2]);
    if (water === null || Math.abs(water - site.waterY) > 1e-6 || water - foundedGroundAt(plan, at[0], at[2])[1] < 1) return false;
  }
  return true;
}

/** Pure stable shore search. Existing content can refuse this site, but never move it somewhere else. */
export function findPierSite(plan: SettlementPlan): FishingPierSite | null {
  const lake = plan.landform.lake;
  if (![lake.x, lake.z, lake.radiusX, lake.radiusZ, lake.level].every(Number.isFinite) || lake.radiusX < 8 || lake.radiusZ < 8) return null;
  const seed = seedHash(`${plan.config.seed}:fishing-pier`), turnStart = seed % 4;
  for (let ti = 0; ti < 4; ti++) {
    const turn = TURNS[(turnStart + ti) % 4]!;
    const direction = transformCardinalPoint([0, 0, 0], turn, [0, 0, 1]), right = transformCardinalPoint([0, 0, 0], turn, [1, 0, 0]);
    const radius = Math.abs(direction[0]) ? lake.radiusX : lake.radiusZ;
    for (const lateral of LATERALS) {
      // Traverse one stable cardinal section from the dry bank towards the centre in quarter-metre steps.
      const start = radius * 1.45;
      let shoreline: Vec3 | undefined;
      for (let distance = -start; distance < 0; distance += .25) {
        const x = lake.x + right[0] * lateral + direction[0] * distance, z = lake.z + right[2] * lateral + direction[2] * distance;
        const water = pierWaterAt(plan, x, z);
        if (water !== null && Math.abs(water - lake.level) < 1e-6) { shoreline = [x, water, z]; break; }
      }
      if (!shoreline) continue;
      for (const back of [1, 1.25, 1.5, 1.75, 2]) {
        const x = Math.round((shoreline[0] - direction[0] * back) / CELL) * CELL, z = Math.round((shoreline[2] - direction[2] * back) / CELL) * CELL;
        const ground = foundedGroundAt(plan, x, z);
        for (const walk of WALKS) {
          const draft: FishingPierSite = { version: 1, id: 'pier:lake', root: ground, turn, deckY: lake.level + FREEBOARD, waterY: lake.level, walk, water: 'lake', biome: 'unknown', depth: [] };
          if (!supportedSite(plan, draft)) continue;
          const depth = Array.from({ length: walk + 5 }, (_, i) => {
            const at = pierLocalToWorld(draft, [10, 0, i / CELL]), water = pierWaterAt(plan, at[0], at[2]);
            return water === null ? 0 : Math.max(0, water - foundedGroundAt(plan, at[0], at[2])[1]);
          });
          const site = Object.freeze({ ...draft, root: Object.freeze([...ground]) as Vec3, depth: Object.freeze(depth) });
          return site;
        }
      }
    }
  }
  return null;
}

function pieceBounds(piece: PierPiece): Bounds {
  return bounds([[0, 0], [piece.blueprint.size[0], 0], [0, piece.blueprint.size[2]], [piece.blueprint.size[0], piece.blueprint.size[2]]].map(([x, z]) => transformCardinalPoint(piece.position, piece.rotation, [x! * CELL, 0, z! * CELL])));
}

/** The only fallback until grand-world supplies an adopted pier anchor. No piece or plan is ever altered. */
export function installPier(plan: SettlementPlan, pieces: readonly PierPiece[]): PierInstallation | null {
  const site = findPierSite(plan);
  if (!site) return null;
  const footprint = pierFootprint(site);
  if (pieces.some(piece => !piece.id.startsWith('pier:') && footprint.some(rect => overlap(rect, pieceBounds(piece), .15)))) return null;
  const style = plan.homes[0]?.style ?? 'hearth';
  const content = createFishingPier(style as StyleKey, {
    walk: site.walk / CELL, freeboard: (site.deckY - site.waterY) / CELL, seed: seedHash(`${plan.config.seed}:pier-detail`),
    depth: (x, z) => { const at = pierLocalToWorld(site, [x, 0, z]); return (site.deckY - foundedGroundAt(plan, at[0], at[2])[1]) / CELL; },
  });
  return { site, content, pieces: content.modules.map(module => ({ id: `${site.id}:${module.id}`, blueprint: module.blueprint, position: pierLocalToWorld(site, module.offset), rotation: site.turn })) };
}
export function pierFurnishings(plan: SettlementPlan, pieces: readonly PierPiece[]): PierPiece[] {
  if (pieces.some(piece => piece.id.startsWith('pier:'))) return [];
  return [...installPier(plan, pieces)?.pieces ?? []];
}
