import { createForgeHearth, createGateBrazier, FORGE_HEARTH_PIVOT, GATE_BRAZIER_MOUNT } from '@chatdom/content';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from './collision';
import type { NativePiece, NativeTown } from './native';

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
const M = VOXEL_METRES.build;
const ID = 'forge:hearth:v1';
const BRAZIERS = ['forge:brazier:v1:north', 'forge:brazier:v1:south'] as const;
function footprint(piece: NativePiece): Bounds {
  const points = piece.blueprint.boxes.filter(box => box.material).flatMap(box =>
    [box.from[0], box.to[0]].flatMap(x => [box.from[2], box.to[2]].map(z =>
      transformCardinalPoint(piece.position, piece.rotation, [x * M, 0, z * M]))));
  return { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
    minZ: Math.min(...points.map(p => p[2])), maxZ: Math.max(...points.map(p => p[2])) };
}
function overlaps(a: Bounds, b: Bounds, gap = 0): boolean {
  return a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
}
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

// Round road margins at corners, rather than enlarging them into a square.
function nearSegment(a: Vec3, b: Vec3, box: Bounds, radius: number): boolean {
  if (crosses(a, b, box, 0)) return true;
  const pointBoxDistance = (p: Vec3) => Math.hypot(Math.max(box.minX - p[0], 0, p[0] - box.maxX), Math.max(box.minZ - p[2], 0, p[2] - box.maxZ));
  if (pointBoxDistance(a) <= radius || pointBoxDistance(b) <= radius) return true;
  const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
  return [box.minX, box.maxX].some(x => [box.minZ, box.maxZ].some(z => {
    const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length)) : 0;
    return Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz) <= radius;
  }));
}

/** Add the complete civic forge group to the accepted market without changing its pinned fixtures. */
export function enrichNativeForgeHearth(plan: SettlementPlan, native: NativeTown): NativeTown {
  if (native.revision !== plan.revision || plan.version !== 2 || plan.landform.version !== 1
    || !native.fixtures.some(piece => piece.id === 'market:well')
    || native.fixtures.some(piece => piece.id === ID || BRAZIERS.some(id => id === piece.id))) return native;
  const hearth = createForgeHearth('hearth'), brazier = createGateBrazier('hearth');
  const place = (id: string, blueprint: NativePiece['blueprint'], pivot: readonly number[], x: number, z: number, rotation: CardinalTurn): NativePiece => {
    const ground = foundedGroundAt(plan, x, z), offset = transformCardinalPoint([0, 0, 0], rotation, [pivot[0]! * M, 0, pivot[2]! * M]);
    return { id, blueprint, position: [x - offset[0], ground[1], z - offset[2]], rotation };
  };
  // Mouth faces the anvil, with the fire stands along the east side of the small working pocket.
  const pieces = [place(ID, hearth, FORGE_HEARTH_PIVOT, 5.5, 5, 3),
    place(BRAZIERS[0], brazier, GATE_BRAZIER_MOUNT, 8.5, 4.25, 0),
    place(BRAZIERS[1], brazier, GATE_BRAZIER_MOUNT, 8.5, 6.75, 0)];
  const occupied = [...native.homes.values(), ...native.fixtures].map(footprint), active = new Set(plan.activeStreetIds);
  const anvil = { minX: -3, maxX: 3, minZ: 5, maxZ: 12 };
  for (const piece of pieces) {
    const box = footprint(piece);
    if (occupied.some(other => overlaps(box, other, .125)) || overlaps(box, anvil, .375)
      || overlaps(box, plan.castle.bounds, 2) || plan.reservations.some(r => overlaps(box, r.lot, .5))) return native;
    // The square's broad painted verges meet here; keep the actual traversable road width clear.
    if (plan.streets.some(street => active.has(street.id) && street.points.some((p, i) => i > 0
      && nearSegment(street.points[i - 1]!, p, box, street.width / 2 + .125)))) return native;
    for (const x of [box.minX, (box.minX + box.maxX) / 2, box.maxX]) for (const z of [box.minZ, (box.minZ + box.maxZ) / 2, box.maxZ]) {
      const lake = plan.lake;
      if (Math.hypot((x - lake.x) / (lake.radiusX + 2), (z - lake.z) / (lake.radiusZ + 2)) < 1
        || foundedGroundAt(plan, x, z)[1] !== piece.position[1] || Math.abs(terrainHeight(plan, x, z) - piece.position[1]) > .0625) return native;
    }
    occupied.push(box);
  }
  return { ...native, fixtures: [...native.fixtures, ...pieces] };
}
