import { KitBuilder, random, type ArtisanKit, type Point } from '../kit';

/** Shapes and placements are presentation data on the grand 0.5 m grid. */
export type ForestSpecies = 'gold' | 'pine' | 'cherry' | 'teal' | 'birch' | 'willow';
export const FOREST_SPECIES: readonly ForestSpecies[] = ['gold', 'pine', 'cherry', 'teal', 'birch', 'willow'];

const PALETTES: Record<ForestSpecies, { bark: string; barkLight: string; leaves: readonly [string, string, string] }> = {
  gold: { bark: '#654b3a', barkLight: '#806044', leaves: ['#9d7433', '#c49340', '#d8ad55'] },
  pine: { bark: '#5b493c', barkLight: '#79614b', leaves: ['#334f45', '#416b53', '#64855d'] },
  cherry: { bark: '#694943', barkLight: '#866058', leaves: ['#ad7882', '#d49b9e', '#edbdaf'] },
  teal: { bark: '#504a4a', barkLight: '#6a6158', leaves: ['#376b6a', '#4a8b83', '#72aa9c'] },
  birch: { bark: '#d2c7ad', barkLight: '#ece0c6', leaves: ['#667e43', '#8da753', '#b4be6c'] },
  willow: { bark: '#75664b', barkLight: '#908063', leaves: ['#6c7e42', '#91a759', '#b3bc70'] },
};
const EXTENTS: Record<ForestSpecies, { radius: number; height: number }> = {
  gold: { radius: 13, height: 27 }, pine: { radius: 8, height: 32 },
  cherry: { radius: 12, height: 21 }, teal: { radius: 13, height: 27 },
  birch: { radius: 7, height: 28 }, willow: { radius: 11, height: 22 },
};

/** Explicit silhouette envelope for spacing, in source cells. */
export function treeExtent(species: ForestSpecies, scale = 1): { radius: number; height: number } {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 3) throw new RangeError('Tree scale must be finite and in (0, 3]');
  return { radius: Math.ceil((EXTENTS[species].radius + 2) * scale) + 1, height: Math.ceil((EXTENTS[species].height + 2) * scale) + 1 };
}

/** Overlap is resolved here before emission. No internal faces or flickering intersecting puffs. */
class TreeCanvas {
  private readonly cells = new Map<string, string>();
  private key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, colours: readonly [string, string, string]): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 > 1) continue;
      // Three large coherent material masses, not noisy individual leaves.
      const level = (y - cy) / ry;
      this.cells.set(this.key(x, y, z), colours[level > 0.35 ? 2 : level < -0.3 ? 0 : 1]);
    }
  }
  limb(a: Point, b: Point, radius: number, colour: string): void {
    const length = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    let previous: Point | undefined;
    const stroke = (cx: number, cy: number, cz: number, r: number) => {
      for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) this.cells.set(this.key(x, cy, z), colour);
    };
    for (let i = 0; i <= length; i++) {
      const t = length ? i / length : 0;
      const cx = Math.round(a[0] + (b[0] - a[0]) * t), cy = Math.round(a[1] + (b[1] - a[1]) * t), cz = Math.round(a[2] + (b[2] - a[2]) * t);
      const r = Math.max(0, Math.round(radius * (1 - t * 0.55)));
      // A diagonal raster step must share faces, even for the fine twigs.
      if (previous) { stroke(cx, previous[1], previous[2], r); stroke(cx, previous[1], cz, r); }
      stroke(cx, cy, cz, r);
      previous = [cx, cy, cz];
    }
  }
  toKit(id: string, scale: number, height: number): ArtisanKit {
    const rows = new Map<string, { x: number; colour: string }[]>();
    for (const [key, colour] of this.cells) {
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      const rowKey = `${y},${z}`;
      let row = rows.get(rowKey);
      if (!row) { row = []; rows.set(rowKey, row); }
      row.push({ x, colour });
    }
    const builder = new KitBuilder();
    for (const [key, row] of rows) {
      const [y, z] = key.split(',').map(Number) as [number, number];
      row.sort((a, b) => a.x - b.x);
      let start = row[0]!.x, end = start, colour = row[0]!.colour;
      const emit = () => {
        const x0 = Math.round(start * scale), x1 = Math.round((end + 1) * scale);
        const y0 = Math.round(y * scale), y1 = Math.round((y + 1) * scale);
        const z0 = Math.round(z * scale), z1 = Math.round((z + 1) * scale);
        // At reduced scale, keep voxel cells at least one cell wide; rasterization still owns overlap.
        builder.box(x0, y0, z0, Math.max(1, x1 - x0), Math.max(1, y1 - y0), Math.max(1, z1 - z0), colour);
      };
      for (const cell of row.slice(1)) {
        if (cell.x === end + 1 && cell.colour === colour) { end = cell.x; continue; }
        emit(); start = end = cell.x; colour = cell.colour;
      }
      emit();
    }
    return builder.finish(id, { base: [0, 0, 0], crown: [0, Math.round(height * scale), 0] });
  }
}

/** Seeded handcrafted branch grammar with a distinct silhouette for each species. */
export function createTree(species: ForestSpecies, seedKey: string, scale = 1): ArtisanKit {
  treeExtent(species, scale);
  const rng = random(`${seedKey}:tree:${species}`), p = PALETTES[species], c = new TreeCanvas();
  const lean = Math.round(rng() * 4 - 2), twist = rng() * Math.PI * 2;
  const branches: { a: Point; b: Point; radius: number }[] = [];
  const branch = (a: Point, b: Point, radius = 1) => branches.push({ a, b, radius });
  const puff = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => c.ellipsoid(x, y, z, rx, ry, rz, p.leaves);
  let top: number;
  if (species === 'pine') {
    top = 29 + Math.floor(rng() * 3);
    // Tiered pointed profile: asymmetric shelves retain a recognisable conifer at distance.
    for (let i = 0; i < 6; i++) {
      const y = 9 + i * 3.4, r = 6 - i * 0.8;
      puff(lean * y / top, y, 0, r, 2.7, r * 0.86);
    }
    puff(lean, top - 3, 0, 1.6, 4, 1.5);
    branch([0, 0, 0], [lean, top - 1, 0], 1);
  } else if (species === 'birch') {
    top = 26 + Math.floor(rng() * 2);
    for (let i = 0; i < 5; i++) {
      const angle = twist + i * Math.PI * 0.82, y = 16 + i * 2;
      const x = lean * y / top + Math.cos(angle) * 2.4, z = Math.sin(angle) * 2.4;
      puff(x, y, z, 3.1, 3.3, 2.8);
      branch([0, y - 5, 0], [Math.round(x), y, Math.round(z)], 0);
    }
    branch([0, 0, 0], [lean, top - 2, 0], 1);
  } else if (species === 'willow') {
    top = 20;
    // Wide, low umbrella with separate hanging curtains, leaving trunk and riverbank readable.
    puff(lean, 17, 0, 7.5, 3, 7);
    for (let i = 0; i < 9; i++) {
      const a = twist + i * Math.PI * 2 / 9, x = Math.cos(a) * 6.1 + lean, z = Math.sin(a) * 5.6;
      puff(x, 12 + (i % 2), z, 2.3, 4.5, 2);
      branch([0, 10, 0], [Math.round(x), 16, Math.round(z)]);
    }
    branch([0, 0, 0], [lean, 17, 0], 1);
  } else if (species === 'gold') {
    top = 26;
    // A mature broadleaf grows two or three uneven major boughs, each carrying a
    // joined foliage mass. Small offsets break the edge without leaf speckle.
    // The open wedge between boughs gives the crown breathing room from below.
    const groups = rng() < 0.25 ? 2 : 3;
    const angleStep = Math.PI * 2 / groups;
    const shoulder = Math.round(lean / 2);
    puff(lean * 0.55, 20.5, 0, 3.5, 2.8, 3.7);
    for (let i = 0; i < groups; i++) {
      const angle = twist + i * angleStep + (rng() - 0.5) * 0.65;
      const distance = 4.8 + rng() * 1.5;
      const x = lean + Math.cos(angle) * distance, z = Math.sin(angle) * distance;
      const y = 19 + rng() * 3.5;
      const rx = 4.2 + rng() * 1.2, rz = 3.6 + rng() * 1.2;
      puff(x, y, z, rx, 2.7 + rng() * 0.8, rz);
      // An adjacent, partially overlapping shoulder gives each group a natural,
      // flattened profile rather than a perfect sphere repeated on every limb.
      puff(x + Math.cos(angle + 0.85) * 2.4, y + 0.6, z + Math.sin(angle + 0.85) * 2.4, rx * 0.65, 2.2, rz * 0.68);
      branch([shoulder, 12 + (i % 2), 0], [Math.round(x), Math.round(y - 1), Math.round(z)]);
    }
    branch([0, 0, 0], [shoulder, 9, 0], 1);
    branch([shoulder, 9, 0], [lean, 19, 0], 1);
  } else {
    const isCherry = species === 'cherry', isTeal = species === 'teal';
    top = isCherry ? 19 : 26;
    const trunkTop = isCherry ? 13 : 19;
    // Cherry has a low overlapping cloud; gold grows several higher, separated boughs.
    // Teal retains its wide canopy and more continuous crown.
    const ring = isCherry ? 5.2 : isTeal ? 5.8 : 7.4, lobeY = isCherry ? 14.2 : 20;
    puff(lean, lobeY + 1, 0, isTeal ? 5 : isCherry ? 4.5 : 2.8, isCherry ? 3.5 : isTeal ? 4.5 : 3, isTeal ? 5 : isCherry ? 4.5 : 2.8);
    for (let i = 0; i < 5; i++) {
      const a = twist + i * Math.PI * 2 / 5, x = lean + Math.cos(a) * ring, z = Math.sin(a) * ring;
      const y = lobeY + (isCherry || isTeal ? (rng() - 0.5) * 2 : [-1, 2, -2, 3, 0][i]!);
      puff(x, y, z, isCherry ? 4.2 : isTeal ? 4.5 : 3.6, isCherry ? 2.8 : isTeal ? 3.5 : 2.8, isCherry ? 3.8 : isTeal ? 4 : 3.5);
      branch([Math.round(lean / 2), trunkTop - 7, 0], [Math.round(x), Math.round(y - 1), Math.round(z)]);
    }
    // Two linked trunk sections soften its line and leave space under the crown.
    branch([0, 0, 0], [Math.round(lean / 2), 9, 0], 1);
    branch([Math.round(lean / 2), 9, 0], [lean, trunkTop, 0], 1);
  }
  // Four low buttresses reach from the soil into the trunk; no exposed underground plinth.
  const foot = species === 'pine' || species === 'birch' ? 2 : 3;
  for (const [x, z] of [[foot, 0], [-foot, 0], [0, foot], [0, -foot]] as const) branch([0, 2, 0], [x, 0, z], 0);
  // Bark wins over overlapping leaves, giving visible connected branches.
  for (const b of branches) c.limb(b.a, b.b, b.radius, p.bark);
  if (species === 'birch') {
    // Pale birch trunk and a few dark horizontal knots.
    c.limb([0, 0, 0], [lean, top - 2, 0], 0, p.barkLight);
    for (let y = 3; y < top - 5; y += 6) c.limb([-1, y, 1], [0, y, 1], 0, '#796c60');
  }
  return c.toKit(`tree-${species}-${seedKey}`, scale, top);
}

export interface ForestSample {
  readonly groundY: number;
  readonly slope: number;
  readonly waterDistance: number;
  readonly reserved: boolean;
}
export interface ForestClearing { readonly x: number; readonly z: number; readonly radius: number }
export interface ForestOptions {
  /** Radius in 0.5m cells. */
  readonly radius?: number;
  /** Candidate count; a stable grid varies edge density and crown spacing limits actual accepted trees. */
  readonly density?: number;
  readonly clearings?: readonly ForestClearing[];
  /** Must return null for unknown, wet, protected, or unavailable terrain. */
  readonly sample?: (x: number, z: number) => ForestSample | null;
  /** Checks the entire canopy disk against authoritative road, lot, gate and sightline masks. */
  readonly canPlace?: (x: number, z: number, radius: number) => boolean;
}
export interface ForestTree { readonly x: number; readonly y: number; readonly z: number; readonly species: ForestSpecies; readonly scale: number; readonly seedKey: string }

/** Stable positions with soft grove edge, physically supplied terrain, clearance and bank-sensitive willow. */
export function planForest(seedKey: string, species: ForestSpecies, options: ForestOptions = {}): readonly ForestTree[] {
  const radius = options.radius ?? 64, density = options.density ?? 40;
  if (!Number.isFinite(radius) || radius < 12 || radius > 1024 || !Number.isInteger(density) || density < 0 || density > 5000) throw new RangeError('Forest radius or density out of range');
  const rng = random(`${seedKey}:grove:${species}`), result: ForestTree[] = [];
  // Fixed-size buckets make neighbour checks local even for many thousands of trees.
  const bucketSize = 32, buckets = new Map<string, ForestTree[]>();
  const bucketKey = (x: number, z: number) => `${x},${z}`;
  const maxRadius = treeExtent(species, 1.16).radius;
  const overlapsTree = (x: number, z: number, r: number) => {
    const bx = Math.floor(x / bucketSize), bz = Math.floor(z / bucketSize);
    const reach = Math.ceil(Math.max(r, maxRadius) * 1.15 / bucketSize);
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      for (const existing of buckets.get(bucketKey(bx + dx, bz + dz)) ?? []) {
        const separation = Math.max(r, treeExtent(species, existing.scale).radius) * 1.15;
        if ((existing.x - x) ** 2 + (existing.z - z) ** 2 < separation ** 2) return true;
      }
    }
    return false;
  };
  const clearings = options.clearings ?? [{ x: 0, z: 0, radius: radius * 0.17 }];
  if (clearings.some(g => !Number.isFinite(g.x) || !Number.isFinite(g.z) || !Number.isFinite(g.radius) || Math.abs(g.x) > 2048 || Math.abs(g.z) > 2048 || g.radius < 0 || g.radius > 2048)) throw new RangeError('Invalid forest clearing');
  for (let i = 0; i < density * 5 && result.length < density; i++) {
    const angle = rng() * Math.PI * 2, dist = radius * Math.sqrt(rng()), x = Math.round(Math.cos(angle) * dist), z = Math.round(Math.sin(angle) * dist);
    // A ragged edge, not an exact circle.
    const edge = 0.78 + 0.09 * Math.sin(angle * 3 + 0.7) + 0.08 * Math.cos(angle * 5 - 1.1);
    if (dist > radius * edge && rng() > 0.25) continue;
    const scale = 0.8 + rng() * 0.36, r = treeExtent(species, scale).radius;
    if (clearings.some(g => (x - g.x) ** 2 + (z - g.z) ** 2 < (g.radius + r) ** 2) || (options.canPlace && !options.canPlace(x, z, r))) continue;
    const sample = options.sample ? options.sample(x, z) : { groundY: 0, slope: 0, waterDistance: species === 'willow' ? 4 : 30, reserved: false };
    if (!sample || sample.reserved || !Number.isFinite(sample.groundY) || !Number.isFinite(sample.slope) || !Number.isFinite(sample.waterDistance) || sample.slope > 0.9 || sample.waterDistance < 1 || (species === 'willow' && sample.waterDistance > 14)) continue;
    if (overlapsTree(x, z, r)) continue;
    const tree = { x, y: Math.round(sample.groundY), z, species, scale, seedKey: `${seedKey}:${x}:${z}` };
    result.push(tree);
    const key = bucketKey(Math.floor(x / bucketSize), Math.floor(z / bucketSize));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(tree); else buckets.set(key, [tree]);
  }
  return result;
}

/** Review fixture. Production should consume planForest and stream each tree independently. */
export function createForest(seedKey: string, species: ForestSpecies, extent: number | ForestOptions = 64): ArtisanKit {
  const options: ForestOptions = typeof extent === 'number' ? { radius: extent } : extent;
  if ((options.radius ?? 64) > 256 || (options.density ?? 40) > 64) throw new RangeError('Forest review is limited to 64 trees in a 256-cell radius; use streamed plans for larger areas');
  const placement = planForest(seedKey, species, options), builder = new KitBuilder();
  const anchors: Record<string, Point> = {};
  for (let i = 0; i < placement.length; i++) {
    const tree = placement[i]!;
    builder.add(createTree(species, tree.seedKey, tree.scale), [tree.x, tree.y, tree.z]);
    anchors[`tree-${i}`] = [tree.x, tree.y, tree.z];
  }
  // Low masses at the woodland edge; independent RNG cannot move a tree when dressing changes.
  const rng = random(`${seedKey}:undergrowth:${species}`);
  const radius = options.radius ?? 64;
  const clearings = options.clearings ?? [{ x: 0, z: 0, radius: radius * 0.17 }];
  for (let i = 0; i < placement.length * 2; i++) {
    const angle = rng() * Math.PI * 2, distance = radius * Math.sqrt(rng()) * 0.9;
    const x = Math.round(Math.cos(angle) * distance), z = Math.round(Math.sin(angle) * distance);
    if (clearings.some(g => (x - g.x) ** 2 + (z - g.z) ** 2 < (g.radius + 3) ** 2) || (options.canPlace && !options.canPlace(x, z, 3))) continue;
    const sample = options.sample ? options.sample(x, z) : { groundY: 0, slope: 0, waterDistance: 30, reserved: false };
    if (!sample || sample.reserved || !Number.isFinite(sample.groundY) || !Number.isFinite(sample.slope) || !Number.isFinite(sample.waterDistance) || sample.slope > 0.9 || sample.waterDistance < 1) continue;
    const shrub = new TreeCanvas();
    const leaves: readonly [string, string, string] = ['#506c42', '#718c50', '#92a663'];
    shrub.ellipsoid(0, 1, 0, 2.4, 1.8, 2.2, leaves);
    shrub.ellipsoid(2, 1, 0, 1.7, 1.3, 1.6, leaves);
    builder.add(shrub.toKit(`shrub-${i}`, 1, 3), [x, Math.round(sample.groundY), z]);
  }
  return builder.finish(`forest-${species}-${seedKey}`, anchors);
}
