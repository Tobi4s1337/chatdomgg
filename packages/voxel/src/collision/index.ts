/** Browser-safe compilation of founded geometry. Coordinates and boxes are in world metres. */
type Vec3 = readonly [number, number, number];
export interface CollisionBox { readonly min: Vec3; readonly max: Vec3 }
export interface CollisionWorld { readonly revision: number; query(bounds: CollisionBox): readonly CollisionBox[] }
interface Blueprint {
  readonly lattice: 'terrain' | 'build' | 'avatar'; readonly size: Vec3;
  readonly boxes: readonly { readonly from: Vec3; readonly to: Vec3; readonly material: number }[];
}
export interface SampledTerrain {
  /** Lower X/Z grid edges and known vertical bottom. */
  readonly origin: Vec3;
  readonly columns: number; readonly rows: number;
  /** Row-major absolute top heights, rounded to 0.5 m; null is unknown. */
  readonly heights: ArrayLike<number | null>;
  readonly ceilingY: number;
}
export interface CollisionCompilerInput {
  readonly revision: number;
  readonly materials: { readonly materials: readonly { readonly id: number; readonly solid: boolean }[] };
  readonly assets: readonly { readonly assetHash: string; readonly blueprint: Blueprint }[];
  readonly placements: readonly { readonly id: string; readonly assetHash: string; readonly position: Vec3; readonly rotation: number }[];
  readonly terrain: SampledTerrain;
}
export type PlacedSolidsInput = Pick<CollisionCompilerInput, 'materials' | 'assets' | 'placements'>;
/** Supply explicit limits when compiling an untrusted proposal. Existing scene compilation retains its limits. */
export interface PlacedSolidsLimits {
  readonly assets: number; readonly placements: number; readonly materials: number;
  readonly cells: number; readonly writes: number; readonly writeCells: number; readonly boxes: number;
}
export const COLLISION_COMPILER_VERSION = 'founded-collision:1' as const;
const METRES = { terrain: .5, build: .125, avatar: .0625 } as const;
const MAX_CELLS = 16_777_216, BIN = 4, MAX_QUERY_CELLS = 65_536;
const finite = (v: Vec3) => v.length === 3 && v.every(Number.isFinite);
const freezeBox = (min: Vec3, max: Vec3): CollisionBox => Object.freeze({ min: Object.freeze([...min]) as unknown as Vec3, max: Object.freeze([...max]) as unknown as Vec3 });
const intersects = (a: CollisionBox, b: CollisionBox) => a.min.every((v, i) => v < b.max[i]! && a.max[i]! > b.min[i]!);
const keyBox = (b: CollisionBox) => [...b.min, ...b.max].join(',');

/** Resolve all ordered writes before coalescing into disjoint cuboids. Allocation is per asset, never per town. */
function compileAsset(bp: Blueprint, solid: Map<number, boolean>, maxBoxes = Number.MAX_SAFE_INTEGER): CollisionBox[] {
  const size = bp.size, unit = METRES[bp.lattice];
  if (!unit || !finite(size) || size.some(n => !Number.isInteger(n) || n < 1 || n > 256)
    || size[0] * size[1] * size[2] > MAX_CELLS) throw new Error('Invalid collision blueprint dimensions.');
  const [sx, sy, sz] = size, cells = new Uint16Array(sx * sy * sz);
  for (const b of bp.boxes) {
    if (!finite(b.from) || !finite(b.to) || b.from.some((v, i) => !Number.isInteger(v) || !Number.isInteger(b.to[i]) || v < 0 || v >= b.to[i]! || b.to[i]! > size[i]!)
      || !Number.isInteger(b.material) || !solid.has(b.material)) throw new Error('Invalid or unknown collision material or box.');
    for (let z = b.from[2]; z < b.to[2]; z++) for (let y = b.from[1]; y < b.to[1]; y++) cells.fill(b.material, b.from[0] + sx * (y + sy * z), b.to[0] + sx * (y + sy * z));
  }
  const occupied = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) occupied[i] = solid.get(cells[i]!) ? 1 : 0;
  const at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  const result: CollisionBox[] = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    if (!occupied[at(x, y, z)]) continue;
    let ex = x + 1, ey = y + 1, ez = z + 1;
    while (ex < sx && occupied[at(ex, y, z)]) ex++;
    while (ey < sy) { let ok = true; for (let xx = x; xx < ex; xx++) if (!occupied[at(xx, ey, z)]) { ok = false; break; } if (!ok) break; ey++; }
    while (ez < sz) { let ok = true; for (let yy = y; yy < ey && ok; yy++) for (let xx = x; xx < ex; xx++) if (!occupied[at(xx, yy, ez)]) { ok = false; break; } if (!ok) break; ez++; }
    for (let zz = z; zz < ez; zz++) for (let yy = y; yy < ey; yy++) occupied.fill(0, at(x, yy, zz), at(ex, yy, zz));
    if (result.length >= maxBoxes) throw new RangeError('Placed solid box budget exceeded.');
    result.push(freezeBox([x * unit, y * unit, z * unit], [ex * unit, ey * unit, ez * unit]));
  }
  return result;
}
function transform(b: CollisionBox, p: Vec3, turn: number): CollisionBox {
  const [x, y, z] = b.min, [X, Y, Z] = b.max;
  const horizontal = turn === 0 ? [x, z, X, Z] : turn === 1 ? [z, -X, Z, -x] : turn === 2 ? [-X, -Z, -x, -z] : [-Z, x, -z, X];
  return freezeBox([p[0] + horizontal[0]!, p[1] + y, p[2] + horizontal[1]!], [p[0] + horizontal[2]!, p[1] + Y, p[2] + horizontal[3]!]);
}

/*
 * Reuse across compiles. A founded kingdom is recompiled whole on every adoption (a Forge commit adds one attachment
 * to one home), and almost every asset and placement is unchanged. Trusted scene compiles (no limits) keep each
 * asset's coalesced local boxes and each placement's world boxes, keyed by asset hash and checked against the exact
 * blueprint writes and solid materials before reuse, so a hit returns the same boxes a fresh compile would. Untrusted
 * proposals (explicit limits) never read or fill the cache. The cache is bounded by assets and by retained boxes.
 */
interface CachedAsset {
  readonly hash: string; readonly lattice: Blueprint['lattice']; readonly size: Vec3; readonly writes: Int32Array; readonly solid: string;
  readonly boxes: readonly CollisionBox[]; readonly placed: Map<string, readonly CollisionBox[]>; retained: number;
}
const assetCache = new Map<string, CachedAsset>();
const MAX_CACHED_ASSETS = 1024, MAX_CACHED_BOXES = 1_000_000, MAX_PLACED_PER_ASSET = 8192;
let cachedBoxes = 0;
const writesOf = (bp: Blueprint) => {
  const out = new Int32Array(bp.boxes.length * 7);
  bp.boxes.forEach((b, i) => { out.set([b.from[0], b.from[1], b.from[2], b.to[0], b.to[1], b.to[2], b.material], i * 7); });
  return out;
};
const sameWrites = (a: Int32Array, b: Int32Array) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
function evict(): void {
  while (assetCache.size > MAX_CACHED_ASSETS || cachedBoxes > MAX_CACHED_BOXES) {
    const oldest = assetCache.keys().next();
    if (oldest.done) return;
    cachedBoxes -= assetCache.get(oldest.value)!.retained;
    assetCache.delete(oldest.value);
  }
}
function cachedAsset(hash: string, bp: Blueprint, solid: Map<number, boolean>, solidKey: string): CachedAsset {
  const writes = writesOf(bp), hit = assetCache.get(hash);
  if (hit && hit.lattice === bp.lattice && hit.size.every((v, i) => v === bp.size[i]) && hit.solid === solidKey && sameWrites(hit.writes, writes)) {
    assetCache.delete(hash); assetCache.set(hash, hit);
    return hit;
  }
  if (hit) { cachedBoxes -= hit.retained; assetCache.delete(hash); }
  const boxes = Object.freeze(compileAsset(bp, solid));
  const entry: CachedAsset = { hash, lattice: bp.lattice, size: [bp.size[0], bp.size[1], bp.size[2]], writes, solid: solidKey, boxes, placed: new Map(), retained: boxes.length };
  assetCache.set(hash, entry); cachedBoxes += boxes.length; evict();
  return entry;
}
function placedBoxes(entry: CachedAsset, position: Vec3, rotation: number): readonly CollisionBox[] {
  const key = `${position[0]},${position[1]},${position[2]},${rotation}`, hit = entry.placed.get(key);
  if (hit) return hit;
  const boxes = Object.freeze(entry.boxes.map(b => transform(b, position, rotation)));
  if (assetCache.get(entry.hash) === entry && entry.placed.size < MAX_PLACED_PER_ASSET) { entry.placed.set(key, boxes); entry.retained += boxes.length; cachedBoxes += boxes.length; evict(); }
  return boxes;
}
/** Test seam: forget every reused compile. */
export function clearCollisionCompileCache(): void { assetCache.clear(); cachedBoxes = 0; }
export function collisionCompileCacheStats(): { readonly assets: number; readonly boxes: number } { return { assets: assetCache.size, boxes: cachedBoxes }; }

/** Actual ordered-write interiors only. No terrain, exterior unknown barriers, synthetic support or revision.
 * Overlay these boxes on one existing CollisionWorld; never union independently compiled finite worlds.
 * All requested allocation/write budgets and headers are checked before any voxel occupancy allocation. */
export function compilePlacedSolids(input: PlacedSolidsInput, limits?: PlacedSolidsLimits): readonly CollisionBox[] {
  if (limits && Object.values(limits).some(v => !Number.isSafeInteger(v) || v < 1)) throw new RangeError('Invalid placed solid budget.');
  if (limits && (input.assets.length > limits.assets || input.placements.length > limits.placements || input.materials.materials.length > limits.materials)) throw new RangeError('Placed solid input budget exceeded.');
  const solid = new Map<number, boolean>();
  for (const m of input.materials.materials) {
    if (!Number.isInteger(m.id) || m.id < 0 || m.id > 65535 || typeof m.solid !== 'boolean' || solid.has(m.id)) throw new Error('Invalid collision material registry.');
    solid.set(m.id, m.solid);
  }
  if (solid.get(0) !== false) throw new Error('Material zero must be air.');
  let cells = 0, writes = 0, writeCells = 0;
  const hashes = new Set<string>(), ids = new Set<string>();
  for (const a of input.assets) {
    if (hashes.has(a.assetHash)) throw new Error('Duplicate collision asset.');
    hashes.add(a.assetHash);
    const bp = a.blueprint, size = bp.size, volume = size[0] * size[1] * size[2];
    if (!METRES[bp.lattice] || !finite(size) || size.some(n => !Number.isInteger(n) || n < 1 || n > 256) || volume > MAX_CELLS) throw new Error('Invalid collision blueprint dimensions.');
    cells += volume; writes += bp.boxes.length;
    if (limits && (cells > limits.cells || writes > limits.writes)) throw new RangeError('Placed solid allocation budget exceeded.');
    for (const b of bp.boxes) {
      if (!finite(b.from) || !finite(b.to) || b.from.some((v, i) => !Number.isInteger(v) || !Number.isInteger(b.to[i]) || v < 0 || v >= b.to[i]! || b.to[i]! > size[i]!)
        || !Number.isInteger(b.material) || !solid.has(b.material)) throw new Error('Invalid or unknown collision material or box.');
      writeCells += (b.to[0] - b.from[0]) * (b.to[1] - b.from[1]) * (b.to[2] - b.from[2]);
      if (limits && writeCells > limits.writeCells) throw new RangeError('Placed solid write budget exceeded.');
    }
  }
  for (const p of input.placements) {
    if (ids.has(p.id) || !finite(p.position) || !Number.isInteger(p.rotation) || p.rotation < 0 || p.rotation > 3) throw new Error('Invalid collision placement.');
    if (!hashes.has(p.assetHash)) throw new Error('Missing collision asset.');
    ids.add(p.id);
  }
  if (!limits) {
    const solidKey = [...solid].sort((a, b) => a[0] - b[0]).map(([id, value]) => `${id}${value ? 's' : 'a'}`).join(',');
    const entries = new Map(input.assets.map(a => [a.assetHash, cachedAsset(a.assetHash, a.blueprint, solid, solidKey)]));
    const out: CollisionBox[] = [];
    for (const p of input.placements) for (const b of placedBoxes(entries.get(p.assetHash)!, p.position, p.rotation)) out.push(b);
    return Object.freeze(out);
  }
  const assets = new Map<string, CollisionBox[]>();
  let localBoxes = 0;
  for (const a of input.assets) {
    const boxes = compileAsset(a.blueprint, solid, limits ? limits.boxes - localBoxes : undefined);
    localBoxes += boxes.length; assets.set(a.assetHash, boxes);
  }
  const out: CollisionBox[] = [];
  for (const p of input.placements) for (const b of assets.get(p.assetHash)!) {
    if (limits && out.length >= limits.boxes) throw new RangeError('Placed solid box budget exceeded.');
    out.push(transform(b, p.position, p.rotation));
  }
  return Object.freeze(out);
}

/**
 * Terrain is sampled at half-metre cell centres and rounded as in the renderer's occupancy field.
 * The renderer's smoothed metre-scale surface can differ; visual easing belongs to the walking client.
 * Unknown cells and everything outside the supplied finite volume are solid.
 */
export function compileCollisionWorld(input: CollisionCompilerInput): CollisionWorld {
  if (!Number.isInteger(input.revision) || input.revision < 0 || input.revision > 0xffffffff) throw new Error('Invalid collision revision.');
  return compileCollisionWorldWithSolids(input, compilePlacedSolids(input));
}

/**
 * The same world from solids that `compilePlacedSolids` already compiled for this input elsewhere (a worker), in
 * their original order. `compileCollisionWorld(input)` equals this with `compilePlacedSolids(input)`.
 */
export function compileCollisionWorldWithSolids(input: Pick<CollisionCompilerInput, 'revision' | 'terrain'>, placed: readonly CollisionBox[]): CollisionWorld {
  if (!Number.isInteger(input.revision) || input.revision < 0 || input.revision > 0xffffffff) throw new Error('Invalid collision revision.');
  const t = input.terrain, [ox, bottom, oz] = t.origin;
  if (!finite(t.origin) || !Number.isFinite(t.ceilingY) || t.ceilingY <= bottom || !Number.isInteger(t.columns) || !Number.isInteger(t.rows) || t.columns < 1 || t.rows < 1 || t.columns * t.rows > MAX_CELLS || t.heights.length !== t.columns * t.rows) throw new Error('Invalid sampled terrain.');
  const heights = Array.from(t.heights);
  for (const h of heights) if (h !== null && (!Number.isFinite(h) || h < bottom || h > t.ceilingY || !Number.isInteger(h * 2))) throw new Error('Invalid terrain height.');
  const columns = t.columns, rows = t.rows, ceiling = t.ceilingY;
  const endX = ox + columns * .5, endZ = oz + rows * .5;
  const bins = new Map<string, CollisionBox[]>();
  for (const b of placed) {
    const x0 = Math.floor(b.min[0] / BIN), x1 = Math.ceil(b.max[0] / BIN), z0 = Math.floor(b.min[2] / BIN), z1 = Math.ceil(b.max[2] / BIN);
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const k = `${x},${z}`, bin = bins.get(k); if (bin) bin.push(b); else bins.set(k, [b]); }
  }
  return Object.freeze({ revision: input.revision, query(bounds: CollisionBox): readonly CollisionBox[] {
    if (!finite(bounds.min) || !finite(bounds.max) || bounds.min.some((n, i) => n > bounds.max[i]!)) throw new Error('Invalid collision query.');
    const bx0 = Math.floor(bounds.min[0] / BIN), bx1 = Math.floor(bounds.max[0] / BIN) + 1, bz0 = Math.floor(bounds.min[2] / BIN), bz1 = Math.floor(bounds.max[2] / BIN) + 1;
    const x0 = Math.max(0, Math.floor((bounds.min[0] - ox) * 2)), x1 = Math.min(columns, Math.floor((bounds.max[0] - ox) * 2) + 1);
    const z0 = Math.max(0, Math.floor((bounds.min[2] - oz) * 2)), z1 = Math.min(rows, Math.floor((bounds.max[2] - oz) * 2) + 1);
    if ((bx1 - bx0) * (bz1 - bz0) > MAX_QUERY_CELLS || Math.max(0, x1 - x0) * Math.max(0, z1 - z0) > MAX_QUERY_CELLS) return Object.freeze([freezeBox(bounds.min, bounds.max)]);
    const out = new Map<string, CollisionBox>();
    const add = (b: CollisionBox) => { if (intersects(bounds, b)) out.set(keyBox(b), b); };
    for (let z = bz0; z < bz1; z++) for (let x = bx0; x < bx1; x++) for (const b of bins.get(`${x},${z}`) ?? []) add(b);
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const h = heights[x + columns * z];
      if (h === null) add(freezeBox([ox + x * .5, bottom, oz + z * .5], [ox + (x + 1) * .5, ceiling, oz + (z + 1) * .5]));
      else if (h !== undefined && h > bottom) add(freezeBox([ox + x * .5, bottom, oz + z * .5], [ox + (x + 1) * .5, h, oz + (z + 1) * .5]));
    }
    // Partition the query outside the known volume into non-overlapping barriers.
    const lo = bounds.min, hi = bounds.max;
    const clip = (min: Vec3, max: Vec3) => { if (min.every((v, i) => v < max[i]!)) add(freezeBox(min, max)); };
    clip([lo[0], lo[1], lo[2]], [Math.min(hi[0], ox), hi[1], hi[2]]);
    clip([Math.max(lo[0], endX), lo[1], lo[2]], [hi[0], hi[1], hi[2]]);
    const lx = Math.max(lo[0], ox), hx = Math.min(hi[0], endX);
    clip([lx, lo[1], lo[2]], [hx, hi[1], Math.min(hi[2], oz)]);
    clip([lx, lo[1], Math.max(lo[2], endZ)], [hx, hi[1], hi[2]]);
    const lz = Math.max(lo[2], oz), hz = Math.min(hi[2], endZ);
    clip([lx, lo[1], lz], [hx, Math.min(hi[1], bottom), hz]);
    clip([lx, Math.max(lo[1], ceiling), lz], [hx, hi[1], hz]);
    return Object.freeze([...out.values()].sort((a, b) => { for (let i = 0; i < 3; i++) { const d = a.min[i]! - b.min[i]!; if (d) return d; } for (let i = 0; i < 3; i++) { const d = a.max[i]! - b.max[i]!; if (d) return d; } return 0; }));
  } });
}

/** Six float64 per box (min then max), for moving compiled solids between threads without loss. */
export function packCollisionBoxes(boxes: readonly CollisionBox[]): Float64Array {
  const out = new Float64Array(boxes.length * 6);
  boxes.forEach((b, i) => { out.set(b.min, i * 6); out.set(b.max, i * 6 + 3); });
  return out;
}
export function unpackCollisionBoxes(data: Float64Array): readonly CollisionBox[] {
  if (data.length % 6) throw new Error('Packed collision boxes need six numbers each.');
  const out: CollisionBox[] = [];
  for (let i = 0; i < data.length; i += 6) {
    const min: Vec3 = [data[i]!, data[i + 1]!, data[i + 2]!], max: Vec3 = [data[i + 3]!, data[i + 4]!, data[i + 5]!];
    if (!finite(min) || !finite(max) || min.some((v, k) => v >= max[k]!)) throw new Error('Packed collision box is not a finite nonempty box.');
    out.push(freezeBox(min, max));
  }
  return Object.freeze(out);
}
