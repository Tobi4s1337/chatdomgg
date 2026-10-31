// Bench-only: the kingdom scene's existing planting sites, enumerated by the same rules as `kingdom/scene.ts` (court
// rings, then seeded groves, with its lot, public-ground, castle, lake and spacing keep-outs), classified into zones
// and handed to the adapter. It adds no sites. Root owns the production mapping; this mirror lets the bench show the
// grove on the sites the live picture plants today, so the before/after compare like with like.
import type { Vec3 } from '@chatdom/shared';
import { randomUnit, samplePublicGround, seedHash, type SettlementPlan } from '@chatdom/world';
import type { StyleFamily } from '../../../../../../packages/content/src/trees';
import type { TreeSite } from '../plant';

export interface ExistingSite { id: string; kind: 'court' | 'grove'; x: number; z: number; variant: number }

/** The scene's crown clearance from lots, public ground and the castle, and its lake keep-out, metres. */
const CROWN = 4.25, LAKE_KEEP = 1.19, SHORE = 1.55;

export function existingTreeSites(layout: SettlementPlan, seed: string, tier: 'hamlet' | 'town'): ExistingSite[] {
  const treeCount = tier === 'hamlet' ? 115 : 260, planted: ExistingSite[] = [], indexStep = 16;
  const reservationCells = new Map<string, typeof layout.reservations[number][]>();
  for (const reservation of layout.reservations) {
    const lot = reservation.lot;
    for (let z = Math.floor((lot.minZ - CROWN) / indexStep); z <= Math.floor((lot.maxZ + CROWN) / indexStep); z++) for (let x = Math.floor((lot.minX - CROWN) / indexStep); x <= Math.floor((lot.maxX + CROWN) / indexStep); x++) {
      const key = `${x},${z}`, entries = reservationCells.get(key) ?? []; entries.push(reservation); reservationCells.set(key, entries);
    }
  }
  const plant = (id: string, kind: ExistingSite['kind'], x: number, z: number, variant: number) => {
    const nearby = reservationCells.get(`${Math.floor(x / indexStep)},${Math.floor(z / indexStep)}`) ?? [];
    if (nearby.some(({ lot }) => x > lot.minX - CROWN && x < lot.maxX + CROWN && z > lot.minZ - CROWN && z < lot.maxZ + CROWN)) return;
    if ((samplePublicGround(layout, x, z)?.reservedDistance ?? Infinity) < CROWN) return;
    const castle = layout.castle.bounds;
    if (x > castle.minX - CROWN && x < castle.maxX + CROWN && z > castle.minZ - CROWN && z < castle.maxZ + CROWN) return;
    if (Math.hypot((x - layout.lake.x) / layout.lake.radiusX, (z - layout.lake.z) / layout.lake.radiusZ) < LAKE_KEEP) return;
    if (planted.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 8)) return;
    planted.push({ id, kind, x, z, variant });
  };
  const activeCourts = new Set(layout.homes.map(home => home.courtId));
  for (const [i, court] of layout.courts.entries()) {
    if (!activeCourts.has(court.id)) continue;
    const anchor = layout.nodes.find(node => node.id === court.nodeId)!;
    const radius = Math.max(...court.boundary.map(([x, z]) => Math.hypot(x - anchor.position[0], z - anchor.position[2]))) + 7;
    for (let side = 0; side < 8; side++) {
      const angle = side * Math.PI / 4;
      plant(`court:${court.id}:${side}`, 'court', anchor.position[0] + Math.cos(angle) * radius, anchor.position[2] + Math.sin(angle) * radius, (i + side) % 3);
    }
  }
  for (let i = 0; i < treeCount * 12 && planted.length < treeCount; i++) {
    const group = Math.floor(i / 7), rand = (part: string) => randomUnit(seedHash(`${seed}:grove:${part}`));
    const cx = layout.bounds.minX - 35 + rand(`${group}:x`) * (layout.bounds.maxX - layout.bounds.minX + 70);
    const cz = layout.bounds.minZ - 65 + rand(`${group}:z`) * (layout.bounds.maxZ - layout.bounds.minZ + 45);
    const angle = rand(`${i}:angle`) * Math.PI * 2, radius = Math.sqrt(rand(`${i}:radius`)) * 10;
    plant(`grove:${i}`, 'grove', cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius, group % 3);
  }
  return planted;
}

/**
 * Existing sites as adapter input: water by the lake's shore band, court rings as court, the rest as woods. Room is
 * the site's clear distance to lots, public ground and the castle, plus a metre of crown that may hang over a
 * garden edge high above it. Yaw is seeded per site, so repeated forms turn their own faces to the camera.
 */
export function toTreeSites(layout: SettlementPlan, sites: readonly ExistingSite[], root: (x: number, z: number) => number, style: StyleFamily, seed: string): TreeSite[] {
  return sites.map(site => {
    const lake = Math.hypot((site.x - layout.lake.x) / layout.lake.radiusX, (site.z - layout.lake.z) / layout.lake.radiusZ);
    const lot = Math.min(Infinity, ...layout.reservations.map(({ lot: l }) => Math.hypot(Math.max(l.minX - site.x, 0, site.x - l.maxX), Math.max(l.minZ - site.z, 0, site.z - l.maxZ))));
    const castle = layout.castle.bounds, keep = Math.hypot(Math.max(castle.minX - site.x, 0, site.x - castle.maxX), Math.max(castle.minZ - site.z, 0, site.z - castle.maxZ));
    const room = Math.min(lot, samplePublicGround(layout, site.x, site.z)?.reservedDistance ?? Infinity, keep) + 1;
    const position: Vec3 = [site.x, root(site.x, site.z), site.z];
    return { id: site.id, zone: lake < SHORE ? 'water' : site.kind, position, yaw: randomUnit(seedHash(`${seed}:tree-yaw:${site.id}`)) * Math.PI * 2, style, seed, room };
  });
}
