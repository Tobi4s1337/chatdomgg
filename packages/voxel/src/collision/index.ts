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
export const COLLISION_COMPILER_VERSION = 'founded-collision:1' as const;
const METRES = { terrain: .5, build: .125, avatar: .0625 } as const;
const MAX_CELLS = 16_777_216, BIN = 4, MAX_QUERY_CELLS = 65_536;
const finite = (v: Vec3) => v.length === 3 && v.every(Number.isFinite);
const freezeBox = (min: Vec3, max: Vec3): CollisionBox => Object.freeze({ min: Object.freeze([...min]) as unknown as Vec3, max: Object.freeze([...max]) as unknown as Vec3 });
const intersects = (a: CollisionBox, b: CollisionBox) => a.min.every((v, i) => v < b.max[i]! && a.max[i]! > b.min[i]!);
const keyBox = (b: CollisionBox) => [...b.min, ...b.max].join(',');

/** Resolve all ordered writes before coalescing into disjoint cuboids. Allocation is per asset, never per town. */
function compileAsset(bp: Blueprint, solid: Map<number, boolean>): CollisionBox[] {
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
    result.push(freezeBox([x * unit, y * unit, z * unit], [ex * unit, ey * unit, ez * unit]));
  }
  return result;
}
function transform(b: CollisionBox, p: Vec3, turn: number): CollisionBox {
  const [x, y, z] = b.min, [X, Y, Z] = b.max;
  const horizontal = turn === 0 ? [x, z, X, Z] : turn === 1 ? [z, -X, Z, -x] : turn === 2 ? [-X, -Z, -x, -z] : [-Z, x, -z, X];
  return freezeBox([p[0] + horizontal[0]!, p[1] + y, p[2] + horizontal[1]!], [p[0] + horizontal[2]!, p[1] + Y, p[2] + horizontal[3]!]);
}

/**
 * Terrain is sampled at half-metre cell centres and rounded as in the renderer's occupancy field.
 * The renderer's smoothed metre-scale surface can differ; visual easing belongs to the walking client.
 * Unknown cells and everything outside the supplied finite volume are solid.
 */
export function compileCollisionWorld(input: CollisionCompilerInput): CollisionWorld {
  if (!Number.isInteger(input.revision) || input.revision < 0 || input.revision > 0xffffffff) throw new Error('Invalid collision revision.');
  const solid = new Map<number, boolean>();
  for (const m of input.materials.materials) {
    if (!Number.isInteger(m.id) || m.id < 0 || m.id > 65535 || typeof m.solid !== 'boolean' || solid.has(m.id)) throw new Error('Invalid collision material registry.');
    solid.set(m.id, m.solid);
  }
  if (solid.get(0) !== false) throw new Error('Material zero must be air.');
  const assets = new Map<string, CollisionBox[]>();
  for (const a of input.assets) { if (assets.has(a.assetHash)) throw new Error('Duplicate collision asset.'); assets.set(a.assetHash, compileAsset(a.blueprint, solid)); }
  const t = input.terrain, [ox, bottom, oz] = t.origin;
  if (!finite(t.origin) || !Number.isFinite(t.ceilingY) || t.ceilingY <= bottom || !Number.isInteger(t.columns) || !Number.isInteger(t.rows) || t.columns < 1 || t.rows < 1 || t.columns * t.rows > MAX_CELLS || t.heights.length !== t.columns * t.rows) throw new Error('Invalid sampled terrain.');
  const heights = Array.from(t.heights);
  for (const h of heights) if (h !== null && (!Number.isFinite(h) || h < bottom || h > t.ceilingY || !Number.isInteger(h * 2))) throw new Error('Invalid terrain height.');
  const columns = t.columns, rows = t.rows, ceiling = t.ceilingY;
  const endX = ox + columns * .5, endZ = oz + rows * .5;
  const bins = new Map<string, CollisionBox[]>(), ids = new Set<string>();
  for (const placement of input.placements) {
    if (ids.has(placement.id) || !finite(placement.position) || !Number.isInteger(placement.rotation) || placement.rotation < 0 || placement.rotation > 3) throw new Error('Invalid collision placement.');
    ids.add(placement.id);
    const local = assets.get(placement.assetHash); if (!local) throw new Error('Missing collision asset.');
    for (const item of local) {
      const b = transform(item, placement.position, placement.rotation);
      const x0 = Math.floor(b.min[0] / BIN), x1 = Math.ceil(b.max[0] / BIN), z0 = Math.floor(b.min[2] / BIN), z1 = Math.ceil(b.max[2] / BIN);
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const k = `${x},${z}`, bin = bins.get(k); if (bin) bin.push(b); else bins.set(k, [b]); }
    }
  }
  return Object.freeze({ revision: input.revision, query(bounds: CollisionBox): readonly CollisionBox[] {
    if (!finite(bounds.min) || !finite(bounds.max) || bounds.min.some((n, i) => n >= bounds.max[i]!)) throw new Error('Invalid collision query.');
    const bx0 = Math.floor(bounds.min[0] / BIN), bx1 = Math.ceil(bounds.max[0] / BIN), bz0 = Math.floor(bounds.min[2] / BIN), bz1 = Math.ceil(bounds.max[2] / BIN);
    const x0 = Math.max(0, Math.floor((bounds.min[0] - ox) * 2)), x1 = Math.min(columns, Math.ceil((bounds.max[0] - ox) * 2));
    const z0 = Math.max(0, Math.floor((bounds.min[2] - oz) * 2)), z1 = Math.min(rows, Math.ceil((bounds.max[2] - oz) * 2));
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
