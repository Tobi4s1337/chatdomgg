import { MAT, STYLES } from '@chatdom/content/materials';
import { createHumpbackBridge } from '../../../../packages/content/src/places/water/bridge/bridge';
import { createGrowthCivicForm, type CivicBridgeSite, type CivicStyle } from '@chatdom/content/growth-civic';
import { VOXEL_METRES, type GrowthCivicPlace, type GrowthPrivateState, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from './collision';
import type { NativePiece, NativeTown } from './native';
import { enrichNativeForgeHearth } from './forge-hearth-furnishings';

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export interface FoundedCivicSite {
  readonly place: GrowthCivicPlace;
  readonly position: Vec3;
  readonly rotation: CardinalTurn;
  readonly style: CivicStyle;
  /** Full mature footprint and its outward entrance, reserved at level one. */
  readonly clearance: Bounds;
  readonly bridge?: CivicBridgeSite;
  readonly approaches?: readonly [readonly number[], readonly number[]];
}
const M = VOXEL_METRES.build;
const PREFIX = 'civic:growth:v1:';
export interface FoundedCivicDiagnostic { readonly place: GrowthCivicPlace; readonly reason: string }
export interface FoundedCivicPlan { readonly sites: readonly FoundedCivicSite[]; readonly unavailable: readonly FoundedCivicDiagnostic[] }
const siteCache = new Map<string, FoundedCivicPlan>();
const trees = (piece: NativePiece) => piece.id.startsWith('tree:') || piece.id.startsWith('picture-grove:');
const overlap = (a: Bounds, b: Bounds, gap = 0) => a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
function bounds(position: Vec3, rotation: CardinalTurn, width: number, depth: number): Bounds {
  const p = [0, width].flatMap(x => [0, depth].map(z => transformCardinalPoint(position, rotation, [x, 0, z])));
  return { minX: Math.min(...p.map(v => v[0])), maxX: Math.max(...p.map(v => v[0])), minZ: Math.min(...p.map(v => v[2])), maxZ: Math.max(...p.map(v => v[2])) };
}
function footprint(piece: NativePiece): Bounds {
  // Solid bounds, rather than the generous blueprint envelope, keep existing workshop aprons available.
  const points = piece.blueprint.boxes.filter(box => box.material).flatMap(box => [box.from[0], box.to[0]].flatMap(x => [box.from[2], box.to[2]].map(z => transformCardinalPoint(piece.position, piece.rotation, [x * M, 0, z * M]))));
  return { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[2])), maxZ: Math.max(...points.map(p => p[2])) };
}
function crosses(a: Vec3, b: Vec3, box: Bounds, radius: number): boolean {
  let low = 0, high = 1;
  for (const [start, end, min, max] of [[a[0], b[0], box.minX - radius, box.maxX + radius], [a[2], b[2], box.minZ - radius, box.maxZ + radius]]) {
    const d = end! - start!;
    if (!d) { if (start! < min! || start! > max!) return false; continue; }
    const p = (min! - start!) / d, q = (max! - start!) / d;
    low = Math.max(low, Math.min(p, q)); high = Math.min(high, Math.max(p, q));
    if (low > high) return false;
  }
  return true;
}
function groundSamples(plan: SettlementPlan, position: Vec3, rotation: CardinalTurn, width: number, depth: number): number[] {
  const values: number[] = [];
  for (let x = .25; x < width; x += .5) for (let z = .25; z < depth; z += .5) {
    const p = transformCardinalPoint(position, rotation, [x, 0, z]);
    values.push(Math.max(terrainHeight(plan, p[0], p[2]), foundedGroundAt(plan, p[0], p[2])[1]));
  }
  return values;
}

/** Stable, deterministic civic sites come from the adopted land and its pinned native baseline, never attendance
 * or owned home bytes. All future home lots and all installed walking roads are exclusion zones. Only trees may
 * be cleared. The mature envelopes are reserved now, so levelling never moves a door or discovers an occupied lot. */
export function planFoundedCivicSites(plan: SettlementPlan, native: NativeTown): FoundedCivicPlan {
  native = enrichNativeForgeHearth(plan, native);
  const signature = JSON.stringify([plan, native.fixtures.filter(piece => !trees(piece))]);
  const cached = siteCache.get(signature);
  if (cached) return cached;
  const active = new Set(plan.activeStreetIds), roads = plan.streets.filter(street => active.has(street.id));
  const occupied = native.fixtures.filter(piece => !trees(piece)).map(footprint);
  const sites: FoundedCivicSite[] = [];
  const unavailable: FoundedCivicDiagnostic[] = [{ place: 'forge', reason: 'The authored growth kit does not fit the accepted hearth and hero workshop while preserving roads. The installed workshop, hearth and dragon remain intact.' }];
  const clear = (box: Bounds, allowCastle = false) => box.minX >= plan.bounds.minX && box.maxX <= plan.bounds.maxX && box.minZ >= plan.bounds.minZ && box.maxZ <= plan.bounds.maxZ
    && !occupied.some(other => overlap(box, other, .25))
    && !plan.reservations.some(r => overlap(box, r.lot, 1))
    && (allowCastle || !overlap(box, plan.castle.bounds, 1))
    && !overlap(box, { minX: -3, maxX: 3, minZ: 5, maxZ: 12 }, .5)
    && !roads.some(street => street.points.some((p, i) => i > 0 && crosses(street.points[i - 1]!, p, box, street.width / 2 + .5)));
  const reserve = (site: FoundedCivicSite) => { sites.push(site); occupied.push(site.clearance); };
  for (const place of ['tavern', 'market', 'castle-court'] as const) {
    const centre = place === 'castle-court' ? plan.castle.court.boundary.reduce((v, p) => [v[0] + p[0] / plan.castle.court.boundary.length, v[1] + p[1] / plan.castle.court.boundary.length] as [number, number], [0, 0] as [number, number]) : [0, 10];
    let chosen: FoundedCivicSite | undefined;
    // Scan outward with a fixed winding; each site's public face points back toward its square.
    for (let radius = 6; radius <= 90 && !chosen; radius += 2) for (let side = 0; side < 4 && !chosen; side++) for (let along = -radius; along <= radius && !chosen; along += 2) {
      const rotation = side as CardinalTurn;
      const offset = transformCardinalPoint([centre[0]!, 0, centre[1]!], rotation, [along - 4, 0, -radius - 4]);
      const clearance = bounds(offset, rotation, 8, 6);
      if (!clear(clearance, place === 'castle-court')) continue;
      const heights = groundSamples(plan, offset, rotation, 8, 6), low = Math.min(...heights), high = Math.max(...heights);
      if (low <= plan.lake.level + .5 || high - low > .75) continue;
      // Keep civic places within a short walk of an installed street or their actual square.
      const front = transformCardinalPoint(offset, rotation, [4, 0, 6]);
      const nearSquare = place === 'castle-court' && radius <= 14;
      if (!nearSquare && !roads.some(road => road.points.some(p => Math.hypot(p[0] - front[0], p[2] - front[2]) <= 10))) continue;
      chosen = { place, position: [offset[0], Math.ceil(high * 2) / 2, offset[2]], rotation, style: place === 'castle-court' ? 'tide' : 'hearth', clearance };
    }
    if (!chosen) unavailable.push({ place, reason: `No clear mature site in ${plan.revision}` });
    else reserve(chosen);
  }

  const lake = plan.lake;
  let bridge: FoundedCivicSite | undefined;
  // The legacy lake has irregular coves. A cardinal chord of an actual shallow cove can support the authored
  // 18 m span; sample its real piers and banks, then derive cells above the bed (never the review site's 6/14).
  for (let z = Math.floor(lake.z - lake.radiusZ * 1.2); z <= lake.z + lake.radiusZ * 1.2 && !bridge; z += .5)
    for (let x = Math.floor(lake.x - lake.radiusX * 1.2); x <= lake.x + lake.radiusX * 1.2 && !bridge; x += .5)
      for (const rotation of [0, 1] as const) {
        const position: Vec3 = [x, 0, z], box = bounds(transformCardinalPoint(position, rotation, [-2, 0, 0]), rotation, 22, 4);
        if (!clear(box)) continue;
        const mid = transformCardinalPoint(position, rotation, [9, 0, 2]);
        if (Math.hypot((mid[0] - lake.x) / lake.radiusX, (mid[2] - lake.z) / lake.radiusZ) >= 1) continue;
        const wet = groundSamples(plan, transformCardinalPoint(position, rotation, [7, 0, .5]), rotation, 4, 3);
        if (Math.max(...wet) >= lake.level - .125) continue;
        const west = groundSamples(plan, position, rotation, 4, 4), east = groundSamples(plan, transformCardinalPoint(position, rotation, [14, 0, 0]), rotation, 4, 4);
        const ends = [...groundSamples(plan, transformCardinalPoint(position, rotation, [-2, 0, 0]), rotation, 2, 4), ...groundSamples(plan, transformCardinalPoint(position, rotation, [18, 0, 0]), rotation, 2, 4)];
        if (Math.max(...ends) - Math.min(...ends) > 2) continue;
        const water = Math.max(2, Math.ceil((lake.level - Math.min(...west, ...east)) * 8)), bed = lake.level - water * M;
        const bank = Math.ceil((Math.ceil(Math.max(lake.level + .5, ...ends) * 2) / 2 - bed) * 8), deck = bed + bank * M;
        if (water < 2 || water > 32 || bank <= water || bank > 48) continue;
        const approaches: number[][] = [];
        for (const side of [-1, 1]) {
          const ground: number[] = [];
          for (let length = .5; length <= 16; length += .5) {
            const edge = transformCardinalPoint(position, rotation, [side < 0 ? -length : 18 + length - .5, 0, 0]);
            const heights = groundSamples(plan, edge, rotation, .5, 4);
            ground.push(Math.ceil(Math.max(...heights) * 4) / 4);
            if (length < 2 || Math.min(...heights) <= lake.level + .125) continue;
            const tops = ground.map(height => Math.max(deck, height));
            for (let i = tops.length - 2; i >= 0; i--) tops[i] = Math.max(tops[i]!, tops[i + 1]! - .25);
            if (tops[0]! > deck + .25) break;
            approaches.push(tops); break;
          }
        }
        if (approaches.length !== 2) continue;
        const lengths = approaches.map(tops => tops.length * .5);
        const full = bounds(transformCardinalPoint(position, rotation, [-lengths[0]!, 0, 0]), rotation, 18 + lengths[0]! + lengths[1]!, 4);
        if (!clear(full)) continue;
        bridge = { place: 'bridge', position: [x, bed, z], rotation, style: 'tide', clearance: full, bridge: { water, bank }, approaches: [approaches[0]!, approaches[1]!] };
        break;
      }
  if (!bridge) unavailable.push({ place: 'bridge', reason: `No supported shoreline span in ${plan.revision}` });
  else reserve(bridge);
  const result = { sites, unavailable };
  siteCache.set(signature, result);
  while (siteCache.size > 32) siteCache.delete(siteCache.keys().next().value!);
  return result;
}

/** A real, half-metre masonry foundation. Both displayed triangles and rounded collision terrain are below its
 * top; each column starts inside the ground. Foundation and form travel together in the immutable hashed scene. */
function foundation(plan: SettlementPlan, site: FoundedCivicSite, width: number, depth: number, origin = site.position): NativePiece {
  const columns: VoxelBlueprint['boxes'] = [];
  const heights = groundSamples(plan, origin, site.rotation, width, depth), bottom = origin[1] - Math.max(1, Math.ceil((origin[1] - Math.min(...heights) + .5) * 8)) * M;
  const top = origin[1], cells = Math.max(1, Math.round((top - bottom) * 8));
  for (let x = 0; x < width; x += .5) for (let z = 0; z < depth; z += .5) {
    const world = transformCardinalPoint(origin, site.rotation, [x + .25, 0, z + .25]);
    const ground = Math.min(terrainHeight(plan, world[0], world[2]), foundedGroundAt(plan, world[0], world[2])[1]);
    columns.push({ from: [x * 8, Math.min(cells - 1, Math.max(0, Math.floor((ground - .5 - bottom) * 8))), z * 8], to: [(x + .5) * 8, cells, (z + .5) * 8], material: MAT.stone });
  }
  const blueprint: VoxelBlueprint = { version: 1, id: `civic-foundation-${site.place}-${width}-${depth}`, styleId: STYLES[site.style].id, kind: 'civic', lattice: 'build', size: [width * 8, cells, depth * 8], boxes: columns, windows: [] };
  return { id: `civic:site:v1:${site.place}:foundation`, blueprint, position: [origin[0], bottom, origin[2]], rotation: site.rotation };
}

/** Scene assembly installs geometry once for both rendering and physics. Never mount the browser fixture adapter
 * over these placements. Growth selects only the level; site poses, roads, citizen homes and the old hearth stay. */
export function installFoundedCivicGrowth(plan: SettlementPlan, native: NativeTown, growth: GrowthPrivateState | undefined): FoundedCivicPlan & { readonly fixtures: readonly NativePiece[] } {
  native = enrichNativeForgeHearth(plan, native);
  const planned = planFoundedCivicSites(plan, native), { sites } = planned;
  const pieces: NativePiece[] = native.fixtures.filter(piece => !trees(piece) || !sites.some(site => overlap(footprint(piece), site.clearance, 1)));
  for (const site of sites) {
    const level = growth?.civic.levels[site.place] ?? 1;
    const form = createGrowthCivicForm(site.place, site.style, level, site.bridge);
    pieces.push({ id: `${PREFIX}${site.place}`, blueprint: form, position: site.position, rotation: site.rotation });
    if (site.place === 'bridge') {
      pieces.push({ id: 'civic:site:v1:bridge:span', blueprint: createHumpbackBridge(site.style, site.bridge!.water, site.bridge!.bank).blueprint, position: site.position, rotation: site.rotation });
      for (const [name, x] of [['west', 0], ['east', 12.5]] as const) {
        const footing = foundation(plan, site, 5.5, 4, transformCardinalPoint(site.position, site.rotation, [x, 0, 0]));
        pieces.push({ ...footing, id: `civic:site:v1:bridge:footing:${name}` });
      }
      for (const [name, direction, tops] of [['west', -1, site.approaches![0]], ['east', 1, site.approaches![1]]] as const) {
        for (const [i, top] of tops.entries()) {
          const x = direction < 0 ? -(i + 1) * .5 : 18 + i * .5;
          const origin = transformCardinalPoint([site.position[0], top, site.position[2]], site.rotation, [x, 0, 0]);
          const landing = foundation(plan, site, .5, 4, origin);
          pieces.push({ ...landing, id: `civic:site:v1:bridge:landing:${name}:${i}` });
        }
      }
    } else if (site.place !== 'forge') pieces.push(foundation(plan, site, 8, 4));
  }
  return { ...planned, fixtures: pieces };
}
