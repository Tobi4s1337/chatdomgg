import { createCivicProp, type CivicStyle } from '@chatdom/content';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type SettlementPlan } from '@chatdom/world';
import type { NativePiece, NativeTown } from './native';

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
const PREFIX = 'market:wares:v1:';

function bounds(piece: NativePiece): Bounds {
  const points: Vec3[] = [];
  for (const box of piece.blueprint.boxes) {
    if (!box.material) continue;
    for (const x of [box.from[0], box.to[0]]) for (const z of [box.from[2], box.to[2]])
      points.push(transformCardinalPoint(piece.position, piece.rotation, [x * VOXEL_METRES.build, 0, z * VOXEL_METRES.build]));
  }
  return { minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
    minZ: Math.min(...points.map(p => p[2])), maxZ: Math.max(...points.map(p => p[2])) };
}

function overlaps(a: Bounds, b: Bounds, gap = .375): boolean {
  return a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
}

/** Segment against an expanded rectangle, including the segment's interior rather than just its endpoints. */
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
 * Dress the accepted v1 stalls, in their own frames, without replacing any adopted content. Wares are ordinary
 * founded fixtures, so the provider's geometry digest and collision revision include their reviewed blueprints.
 * An absent/unsupported stall or a crowded site supplies no substitute place.
 */
export function enrichNativeMarket(plan: SettlementPlan, native: NativeTown): NativeTown {
  if (native.revision !== plan.revision || plan.version !== 2 || plan.landform.version !== 1) return native;
  const occupied = [...native.homes.values(), ...native.fixtures].map(bounds);
  const active = new Set(plan.activeStreetIds), additions: NativePiece[] = [];
  const ids = new Set(native.fixtures.map(piece => piece.id));
  // The mounted Forge anvil and its southward standing approach (world/interactions/founded.ts).
  const anvil = { minX: -3, maxX: 3, minZ: 5, maxZ: 12 };

  for (const number of [0, 1]) {
    const stall = native.fixtures.find(piece => piece.id === `market:stall:${number}`);
    if (!stall || stall.blueprint.id !== `market-stall-${number}` || stall.blueprint.lattice !== 'build') continue;
    const style = stall.blueprint.styleId;
    if (style !== 'hearth' && style !== 'tide') continue;
    const width = stall.blueprint.size[0] * VOXEL_METRES.build, depth = stall.blueprint.size[2] * VOXEL_METRES.build;
    for (const form of ['gift-cart', 'market-stores'] as const) {
      const id = `${PREFIX}${number}:${form}`;
      if (ids.has(id)) continue;
      const blueprint = createCivicProp(form, style as CivicStyle);
      const w = blueprint.size[0] * VOXEL_METRES.build, d = blueprint.size[2] * VOXEL_METRES.build;
      // Cart in front with a half-metre gap; stores at either counter end. Never across the counter's face.
      const front: Vec3 = [(width - w) / 2, 0, depth + .5];
      const right: Vec3 = [width + .5, 0, (depth - d) / 2];
      const left: Vec3 = [-w - .5, 0, (depth - d) / 2];
      for (const local of form === 'gift-cart' ? [front, right, left] : [right, left]) {
        const origin = transformCardinalPoint(stall.position, stall.rotation, local);
        const candidate: NativePiece = { id, blueprint, position: origin, rotation: stall.rotation };
        const box = bounds(candidate);
        if (occupied.some(other => overlaps(box, other)) || overlaps(box, plan.castle.bounds, 2)
          || overlaps(box, anvil, 1) || plan.reservations.some(reservation => overlaps(box, reservation.lot, 2))) continue;
        if (plan.streets.some(street => active.has(street.id) && street.points.some((point, i) => i > 0
          && crosses(street.points[i - 1]!, point, box, street.width / 2 + street.verge + .375)))) continue;
        const heights: number[] = [];
        let wet = false;
        for (const x of [box.minX, (box.minX + box.maxX) / 2, box.maxX])
          for (const z of [box.minZ, (box.minZ + box.maxZ) / 2, box.maxZ]) {
            heights.push(terrainHeight(plan, x, z));
            const lake = plan.lake;
            if (Math.hypot((x - lake.x) / (lake.radiusX + 2), (z - lake.z) / (lake.radiusZ + 2)) < 1) wet = true;
          }
        const low = Math.min(...heights), high = Math.max(...heights);
        if (wet || !Number.isFinite(low) || !Number.isFinite(high) || high - low > .125) continue;
        additions.push({ ...candidate, position: [origin[0], low, origin[2]] });
        occupied.push(box); ids.add(id); break;
      }
    }
  }
  return additions.length ? { ...native, fixtures: [...native.fixtures, ...additions] } : native;
}
