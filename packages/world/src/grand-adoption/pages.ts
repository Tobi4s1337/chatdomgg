import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';

/** A physical page covers one 32³ terrain chunk, in world metres, independent of render LOD. */
export const PHYSICAL_PAGE_METRES = 16;
export const PHYSICAL_PAGE_DISPATCH_VERSION = 'physical-page-dispatch:1';
/** Local residency/query guards, not a network schema or a claim about room capacity. */
export const PHYSICAL_PAGE_LIMITS = Object.freeze({ pages: 4096, solids: 65_536, queryPages: 64, querySolids: 8192 });

/**
 * Local, already compiled physical data. Coordinates are integer page coordinates, including Y.
 * Solids are world-space, clipped to this page; ordered voxel writes/carves are already resolved.
 * An installed page with no solids is known air. An absent page is unknown and solid.
 * Never pass independently compiled CollisionWorld queries here: their exterior barriers are not geometry.
 */
export interface PhysicalCollisionPage {
  readonly coordinate: Vec3;
  readonly revision: number;
  readonly solids: readonly SolidBox[];
}

const EMPTY: readonly SolidBox[] = Object.freeze([]);
const finite = (point: Vec3): boolean => point.length === 3 && point.every(Number.isFinite);
const validBox = (box: SolidBox): boolean => finite(box.min) && finite(box.max) && box.min.every((n, i) => n < box.max[i]!);
const intersects = (a: SolidBox, b: SolidBox): boolean => a.min.every((n, i) => n < b.max[i]! && a.max[i]! > b.min[i]!);
const key = (coordinate: Vec3): string => coordinate.join(',');
const freezeBox = (min: Vec3, max: Vec3): SolidBox => Object.freeze({
  min: Object.freeze([...min]) as unknown as Vec3,
  max: Object.freeze([...max]) as unknown as Vec3,
});
const compareBoxes = (a: SolidBox, b: SolidBox): number => {
  for (let i = 0; i < 3; i++) { const difference = a.min[i]! - b.min[i]!; if (difference) return difference; }
  for (let i = 0; i < 3; i++) { const difference = a.max[i]! - b.max[i]!; if (difference) return difference; }
  return 0;
};
const pageBounds = (coordinate: Vec3): SolidBox => ({
  min: coordinate.map(n => n * PHYSICAL_PAGE_METRES) as unknown as Vec3,
  max: coordinate.map(n => (n + 1) * PHYSICAL_PAGE_METRES) as unknown as Vec3,
});

/**
 * Own the known-space boundary once for a whole immutable physical working set. Copies and freezes input
 * geometry, rejects mixed revisions/overlapping page addresses, and returns stable duplicate-free solids.
 * Replacing coverage creates another world; the caller must complete the installed-world handshake before
 * movement uses it. Revision equality is a consistency guard, never a verified scene/landscape receipt.
 * No producer, transport, cache eviction, placement, scenery or ground sampling is performed here.
 */
export function createPagedCollisionWorld(revision: number, input: readonly PhysicalCollisionPage[]): CollisionWorld {
  if (!Number.isInteger(revision) || revision < 0 || revision > 0xffffffff) throw new Error('Invalid physical page revision.');
  if (input.length > PHYSICAL_PAGE_LIMITS.pages) throw new Error('Physical page residency exceeds its bound.');
  const pages = new Map<string, readonly SolidBox[]>();
  let count = 0;
  for (const page of input) {
    if (page.revision !== revision) throw new Error('Physical pages disagree with the installed revision.');
    if (!finite(page.coordinate) || page.coordinate.some(n => !Number.isSafeInteger(n)
      || !Number.isSafeInteger(n * PHYSICAL_PAGE_METRES) || !Number.isSafeInteger((n + 1) * PHYSICAL_PAGE_METRES))) {
      throw new Error('Invalid physical page coordinate.');
    }
    const address = key(page.coordinate), bounds = pageBounds(page.coordinate);
    if (pages.has(address)) throw new Error('Duplicate physical page coordinate.');
    count += page.solids.length;
    if (count > PHYSICAL_PAGE_LIMITS.solids) throw new Error('Physical page solids exceed their bound.');
    const unique = new Map<string, SolidBox>();
    for (const solid of page.solids) {
      if (!validBox(solid) || solid.min.some((n, i) => n < bounds.min[i]! || solid.max[i]! > bounds.max[i]!)) {
        throw new Error('Physical solid is invalid or crosses its page boundary.');
      }
      unique.set([...solid.min, ...solid.max].join(','), freezeBox(solid.min, solid.max));
    }
    pages.set(address, Object.freeze([...unique.values()].sort(compareBoxes)));
  }

  return Object.freeze({ revision, query(bounds: SolidBox): readonly SolidBox[] {
    if (!finite(bounds.min) || !finite(bounds.max) || bounds.min.some((n, i) => n > bounds.max[i]!)) {
      throw new Error('Invalid physical page query.');
    }
    if (bounds.min.some((n, i) => n === bounds.max[i]!)) return EMPTY;
    const blocked = (): readonly SolidBox[] => Object.freeze([freezeBox(bounds.min, bounds.max)]);
    // Half-open ranges: a query ending exactly at a page edge cannot acquire the next page's barrier.
    // floor, not truncation, is essential on the negative side of the origin.
    const start = bounds.min.map(n => Math.floor(n / PHYSICAL_PAGE_METRES));
    const end = bounds.max.map(n => Math.ceil(n / PHYSICAL_PAGE_METRES));
    const volume = end.reduce((product, n, i) => product * (n - start[i]!), 1);
    // Check before any enumeration. Even finite enormous boxes must have bounded work and no empty success.
    if (![...start, ...end].every(Number.isSafeInteger) || !(volume > 0 && volume <= PHYSICAL_PAGE_LIMITS.queryPages)) return blocked();
    const result: SolidBox[] = [];
    let examined = 0;
    for (let z = start[2]!; z < end[2]!; z++) for (let y = start[1]!; y < end[1]!; y++) for (let x = start[0]!; x < end[0]!; x++) {
      const coordinate: Vec3 = [x, y, z], solids = pages.get(key(coordinate));
      if (solids === undefined) {
        const unknown = pageBounds(coordinate);
        result.push(freezeBox(unknown.min, unknown.max));
        continue;
      }
      examined += solids.length;
      if (examined > PHYSICAL_PAGE_LIMITS.querySolids) return blocked();
      for (const solid of solids) if (intersects(bounds, solid)) result.push(solid);
    }
    return Object.freeze(result.sort(compareBoxes));
  } });
}
