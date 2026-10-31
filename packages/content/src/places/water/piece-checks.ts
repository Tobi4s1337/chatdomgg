import { VoxelBlueprintSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
// The production rasterizer and mesher; tests never reinterpret boxes with a second interpreter.
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '../../../../voxel/src/index';
import { MAT, MATERIALS, STYLES, type StyleKey } from '../../materials';
import type { CellBox, WalkStrip, WaterPiece } from './place-piece';

/**
 * Test-only geometry probes for water pieces, run against the production rasterizer. Not exported by any
 * collection barrel; production code never imports this module.
 */
export function voxels(b: VoxelBlueprint) {
  const asset = rasterizeBlueprint(VoxelBlueprintSchema.parse(b));
  const [sx, sy, sz] = asset.size;
  const at = (x: number, y: number, z: number): number =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[x + sx * (y + sy * z)]!;
  return { asset, at, size: asset.size };
}

/**
 * Face-connected flood from the seed cells; returns how many occupied cells it could not reach. By default it
 * seeds from every occupied cell at y = 0 (ground support); pass `seeds` to prove support from a mount instead.
 */
export function unsupported(b: VoxelBlueprint, seeds?: readonly Vec3[]): number {
  const { asset } = voxels(b);
  const [sx, sy] = asset.size;
  const seen = new Uint8Array(asset.voxels.length), queue: number[] = [];
  let occupied = 0;
  const seed = (i: number) => { if (asset.voxels[i] && !seen[i]) { seen[i] = 1; queue.push(i); } };
  for (const m of asset.voxels) if (m) occupied++;
  if (seeds) for (const [x, y, z] of seeds) seed(x + sx * (y + sy * z));
  else asset.voxels.forEach((_, i) => { if (Math.floor(i / sx) % sy === 0) seed(i); });
  const [, , sz] = asset.size;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const n of [x > 0 ? i - 1 : -1, x + 1 < sx ? i + 1 : -1, y > 0 ? i - sx : -1, y + 1 < sy ? i + sx : -1,
      z > 0 ? i - sx * sy : -1, z + 1 < sz ? i + sx * sy : -1]) if (n >= 0) seed(n);
  }
  return occupied - queue.length;
}

/** Every occupied cell inside the box, as `[x,y,z,material]`. Empty means the volume is genuinely clear. */
export function occupiedIn(b: VoxelBlueprint, box: CellBox): [number, number, number, number][] {
  const { at } = voxels(b), found: [number, number, number, number][] = [];
  for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++)
    for (let x = box.from[0]; x < box.to[0]; x++) { const m = at(x, y, z); if (m) found.push([x, y, z, m]); }
  return found;
}

/**
 * Checks a walk strip against the actual cells: every column is solid at `top - 1`, air for `clearance` cells
 * above it, and neighbouring tops step by at most one cell. Returns readable failures (empty when honest).
 */
export function walkFailures(b: VoxelBlueprint, walk: WalkStrip, clearance = 16): string[] {
  const { at } = voxels(b), failures: string[] = [];
  if (walk.tops.length !== walk.along[1] - walk.along[0]) failures.push(`${walk.id}: tops length mismatch`);
  walk.tops.forEach((top, i) => {
    if (i && Math.abs(top - walk.tops[i - 1]!) > 1) failures.push(`${walk.id}: step of ${top - walk.tops[i - 1]!} at ${i}`);
    const a = walk.along[0] + i;
    for (let c = walk.across[0]; c < walk.across[1]; c++) {
      const [x, z] = walk.axis === 'x' ? [a, c] : [c, a];
      if (!at(x, top - 1, z)) failures.push(`${walk.id}: no tread at ${x},${top - 1},${z}`);
      for (let y = top; y < top + clearance; y++) if (at(x, y, z)) { failures.push(`${walk.id}: blocked at ${x},${y},${z}`); break; }
    }
  });
  return failures;
}

/** Materials the places-water validator admits for a style (mirrors scripts/content-validate.mjs). */
export function allowedMaterials(style: StyleKey): Set<number> {
  const kit = STYLES[style];
  return new Set([MAT.air, kit.wall, kit.roof, kit.trim, kit.stone, MAT.glass, MAT.earth, MAT.bark, MAT.leaf, MAT.moss,
    MAT.petal, MAT.blueFlower, MAT.brass, MAT.cloth, MAT.cream, MAT.darkStone, MAT.thatch, MAT.goldLeaf, MAT.terracotta,
    MAT.forgeCopper]);
}

/** Production mesher cost for one model. */
export function meshCost(b: VoxelBlueprint): { occupied: number; triangles: number } {
  const { asset } = voxels(b);
  let triangles = 0;
  for (const prepared of prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)) {
    triangles += meshVoxelChunk(prepared).indices.length / 3;
  }
  return { occupied: asset.voxels.reduce((n, m) => n + (m ? 1 : 0), 0), triangles };
}

/** Common honesty checks every static water piece must pass. Returns readable failures. */
export function pieceFailures(piece: WaterPiece, style: StyleKey, grounded = true): string[] {
  const b = piece.blueprint, failures: string[] = [];
  const parsed = VoxelBlueprintSchema.safeParse(b);
  if (!parsed.success) return [`${b.id}: ${parsed.error.message}`];
  const allowed = allowedMaterials(style);
  for (const box of b.boxes) if (!allowed.has(box.material)) failures.push(`${b.id}: material ${box.material} outside palette`);
  const solids = b.boxes.filter(box => box.material !== MAT.air).map(box => JSON.stringify(box));
  if (new Set(solids).size !== solids.length) failures.push(`${b.id}: duplicate solid boxes`);
  if (b.boxes.length > 2000) failures.push(`${b.id}: ${b.boxes.length} boxes`);
  if (grounded) { const n = unsupported(b); if (n) failures.push(`${b.id}: ${n} cells float`); }
  for (const f of piece.footings) {
    // The bearing layer is occupied and nothing of the piece hangs below a raised footing.
    const y = f.box.from[1];
    const base = { from: f.box.from, to: [f.box.to[0], y + 1, f.box.to[2]] as Vec3 };
    const below = { from: [f.box.from[0], 0, f.box.from[2]] as Vec3, to: [f.box.to[0], y, f.box.to[2]] as Vec3 };
    if (!occupiedIn(b, base).length) failures.push(`${b.id}/${f.id}: footing bears on nothing at y = ${y}`);
    else if (y > 0 && occupiedIn(b, below).length) failures.push(`${b.id}/${f.id}: cells hang below the raised footing`);
  }
  for (const c of piece.clear) { const hit = occupiedIn(b, c.box); if (hit.length) failures.push(`${b.id}/${c.id}: ${hit.length} cells in clear volume`); }
  for (const w of piece.walks) failures.push(...walkFailures(b, w));
  // The place-collection budgets in scripts/content-validate.mjs.
  const cost = meshCost(b);
  if (cost.occupied > 1_000_000) failures.push(`${b.id}: ${cost.occupied} occupied cells`);
  if (cost.triangles > 250_000) failures.push(`${b.id}: ${cost.triangles} triangles`);
  const inside = (p: Vec3) => p.every((v, axis) => v >= 0 && v <= b.size[axis]!);
  for (const a of [...piece.emitters, ...piece.sounds, ...piece.texts.map(t => ({ id: t.id, position: t.centre })), ...piece.mounts]) {
    if (!inside(a.position)) failures.push(`${b.id}/${a.id}: anchor outside bounds`);
  }
  return failures;
}
