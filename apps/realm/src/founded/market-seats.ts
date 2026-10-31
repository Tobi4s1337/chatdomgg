import { createMarketSeatLog, MARKET_SEAT_LOG_GROUND } from '@chatdom/content';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { WALK_BODY } from '@chatdom/shared/realm';
import { terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from './collision';
import type { NativePiece, NativeTown } from './native';

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
const ID = 'market:rest:v1:0';
const M = VOXEL_METRES.build;

function bounds(points: readonly Vec3[], radius = 0): Bounds {
  return { minX: Math.min(...points.map(p => p[0])) - radius, maxX: Math.max(...points.map(p => p[0])) + radius,
    minZ: Math.min(...points.map(p => p[2])) - radius, maxZ: Math.max(...points.map(p => p[2])) + radius };
}
function footprint(piece: NativePiece): Bounds {
  return bounds(piece.blueprint.boxes.filter(box => box.material).flatMap(box =>
    [box.from[0], box.to[0]].flatMap(x => [box.from[2], box.to[2]].map(z =>
      transformCardinalPoint(piece.position, piece.rotation, [x * M, 0, z * M])))));
}
function overlaps(a: Bounds, b: Bounds, gap = 0): boolean {
  return a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
}
function inside(boundary: SettlementPlan['market']['boundary'], x: number, z: number): boolean {
  let result = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[j]!, b = boundary[i]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
/** Segment against an expanded rectangle, including the whole street between its samples. */
function crosses(a: Vec3, b: Vec3, box: Bounds, radius: number): boolean {
  let low = 0, high = 1;
  for (const [start, end, min, max] of [[a[0], b[0], box.minX - radius, box.maxX + radius],
    [a[2], b[2], box.minZ - radius, box.maxZ + radius]]) {
    const delta = end! - start!;
    if (!delta) { if (start! < min! || start! > max!) return false; continue; }
    const t0 = (min! - start!) / delta, t1 = (max! - start!) / delta;
    low = Math.max(low, Math.min(t0, t1)); high = Math.min(high, Math.max(t0, t1));
    if (low > high) return false;
  }
  return true;
}

/**
 * Add one real, two-person log on the accepted market edge. The pinned town is never regenerated or edited.
 * The authored ground pivot fixes its origin, and the same blueprinted seats supply the public registry.
 * Crowded, sloping, wet or unsupported edges supply no substitute place elsewhere in the kingdom.
 */
export function enrichNativeMarketSeats(plan: SettlementPlan, native: NativeTown): NativeTown {
  if (native.revision !== plan.revision || plan.version !== 2 || plan.landform.version !== 1
    || native.fixtures.some(piece => piece.id === ID)
    || !native.fixtures.some(piece => piece.id === 'market:well')) return native;
  const blueprint = createMarketSeatLog(), occupied = [...native.homes.values(), ...native.fixtures].map(footprint);
  const active = new Set(plan.activeStreetIds), boundary = plan.market.boundary;
  const centre = boundary.reduce<[number, number]>((sum, p) => [sum[0] + p[0] / boundary.length, sum[1] + p[1] / boundary.length], [0, 0]);
  const anvil = { minX: -3, maxX: 3, minZ: 5, maxZ: 12 };
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i]!, b = boundary[(i + 1) % boundary.length]!;
    // Adopted v1 market edges are cardinal. An unfamiliar outline is not an invitation to guess a pose.
    if (a[0] !== b[0] && a[1] !== b[1]) continue;
    const inward: Vec3 = a[1] === b[1] ? [0, 0, Math.sign(centre[1] - a[1])] : [Math.sign(centre[0] - a[0]), 0, 0];
    const rotation: CardinalTurn = inward[2] > 0 ? 0 : inward[0] > 0 ? 1 : inward[2] < 0 ? 2 : 3;
    for (const t of [.3, .35, .25, .15, .5, .65, .75, .85]) {
      const x = a[0] + (b[0] - a[0]) * t + inward[0] * .75, z = a[1] + (b[1] - a[1]) * t + inward[2] * .75;
      const ground = MARKET_SEAT_LOG_GROUND;
      const pivot = foundedGroundAt(plan, x, z), offset = transformCardinalPoint([0, 0, 0], rotation,
        [ground[0] * M, ground[1] * M, ground[2] * M]);
      const position: Vec3 = [pivot[0] - offset[0], pivot[1] - offset[1], pivot[2] - offset[2]];
      const candidate: NativePiece = { id: ID, blueprint, position, rotation }, box = footprint(candidate);
      const at = (point: Vec3) => transformCardinalPoint(position, rotation, [point[0] * M, point[1] * M, point[2] * M]);
      const paths = blueprint.seats!.map(seat => bounds([at(seat.approach), at(seat.rest)], WALK_BODY.radius + .0625));
      const patches = [box, ...paths];
      if (occupied.some(other => patches.some(patch => overlaps(patch, other, .125)))
        || patches.some(patch => overlaps(patch, plan.castle.bounds, 2) || overlaps(patch, anvil, .5)
          || plan.reservations.some(reservation => overlaps(patch, reservation.lot, .5)))) continue;
      if (plan.streets.some(street => active.has(street.id) && street.points.some((point, index) => index > 0
        && crosses(street.points[index - 1]!, point, box, street.width / 2 + street.verge + .375)))) continue;
      let clear = true;
      for (const patch of patches) {
        // Probe the entire bench and both body-width entry corridors against physical half-metre terrain.
        for (let px = patch.minX; px <= patch.maxX + .25; px += .25)
          for (let pz = patch.minZ; pz <= patch.maxZ + .25; pz += .25) {
            const sx = Math.min(px, patch.maxX), sz = Math.min(pz, patch.maxZ), lake = plan.lake;
            if (!inside(boundary, sx, sz)
              || Math.hypot((sx - lake.x) / (lake.radiusX + 2), (sz - lake.z) / (lake.radiusZ + 2)) < 1
              || foundedGroundAt(plan, sx, sz)[1] !== pivot[1]
              || Math.abs(terrainHeight(plan, sx, sz) - pivot[1]) > .0625) clear = false;
          }
      }
      if (!clear) continue;
      return { ...native, fixtures: [...native.fixtures, candidate] };
    }
  }
  return native;
}
