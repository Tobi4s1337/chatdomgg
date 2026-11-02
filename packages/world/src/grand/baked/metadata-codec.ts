import { z } from 'zod';
import { canonicalSceneJson, utf8 } from '../../founded-world/codec';
import { BAKED_COMPILERS, BAKED_GENERATORS, BAKED_MAX_SIDE, BAKED_MAX_HEIGHT, BAKED_METADATA_BYTES, BAKED_REGION_HEADER_BYTES,
  BAKED_REGION_QUAD_BYTES, BAKED_SURFACE_HEADER_BYTES, HOSTED_PAVING, type BakedMetadata } from './types';
import { assertDimensions } from './validation';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const uint = z.number().int().nonnegative();
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const point = z.tuple([coordinate, coordinate, coordinate]);
const bounds = z.strictObject({ min: point, max: point });
const refFields = { hash, rawBytes: uint.max(BAKED_MAX_SIDE ** 2 * 4 + BAKED_SURFACE_HEADER_BYTES),
  gzipHash: hash, gzipBytes: uint.min(20).max(BAKED_MAX_SIDE ** 2 * 4 + 1024 * 1024) };
const schema = z.strictObject({
  version: z.union([z.literal(1), z.literal(2)]), kingdomId: z.string().regex(/^[1-9][0-9]{0,31}$/), recipeHash: hash, sourcePlanHash: hash,
  sourcePlanRevision: z.string().min(1).max(256),
  compilers: z.strictObject({ generator: z.enum(BAKED_GENERATORS), kit: z.literal(BAKED_COMPILERS.kit),
    grader: z.literal(BAKED_COMPILERS.grader), mesher: z.literal(BAKED_COMPILERS.mesher) }),
  size: uint.max(BAKED_MAX_SIDE), height: uint.max(BAKED_MAX_HEIGHT), seaLevel: uint.max(BAKED_MAX_HEIGHT),
  seat: z.strictObject({ offset: point, columns: z.strictObject({ x0: uint, z0: uint, x1: uint, z1: uint }), band: uint.max(BAKED_MAX_SIDE) }),
  physicalRegion: z.strictObject({ minX: coordinate, maxX: coordinate, minZ: coordinate, maxZ: coordinate }), bounds,
  palette: z.array(z.strictObject({ id: uint.max(255), colour: z.string().regex(/^#[0-9a-fA-F]{6}$/), kind: uint.max(19) })).min(1).max(256),
  surface: z.strictObject(refFields),
  regions: z.array(z.strictObject({ rx: uint.max(15), rz: uint.max(15), exact: z.boolean(), bounds,
    meshes: z.array(z.strictObject({ ...refFields, level: uint.max(3), rx: uint.max(15), rz: uint.max(15),
      minY: uint.max(BAKED_MAX_HEIGHT), maxY: uint.max(BAKED_MAX_HEIGHT),
      quadCount: uint.max(BAKED_REGION_QUAD_BYTES / 8) })).min(1).max(4),
  })).min(1).max((BAKED_MAX_SIDE / 256) ** 2),
});
function sameBounds(actual: BakedMetadata['bounds'], min: readonly number[], max: readonly number[]): boolean {
  return actual.min.every((n, i) => n === min[i]) && actual.max.every((n, i) => n === max[i]);
}
/** Strict keys prohibit accidental scene/citizen/timing fields from entering public metadata. */
export function validateBakedMetadata(value: unknown): BakedMetadata {
  const m = schema.parse(value) as BakedMetadata;
  assertDimensions(m.size, m.height, m.seaLevel);
  const { x0, z0, x1, z1 } = m.seat.columns, [ox, oy, oz] = m.seat.offset, p = m.physicalRegion;
  if (m.seat.offset.some(n => n * 2 !== Math.round(n * 2)) || !(x0 < x1 && z0 < z1 && x1 <= m.size && z1 <= m.size)
    || p.minX !== x0 * .5 - ox || p.maxX !== x1 * .5 - ox || p.minZ !== z0 * .5 - oz || p.maxZ !== z1 * .5 - oz
    || !sameBounds(m.bounds, [-ox, -oy, -oz], [m.size * .5 - ox, m.height * .5 - oy, m.size * .5 - oz]))
    throw new RangeError('Baked seat, physical region and bounds disagree');
  if (m.surface.rawBytes !== BAKED_SURFACE_HEADER_BYTES + m.size ** 2 * 4) throw new RangeError('Baked surface byte count disagrees');
  const ids = new Set(m.palette.map(v => v.id));
  if (ids.size !== m.palette.length || !ids.has(HOSTED_PAVING)) throw new RangeError('Baked palette has duplicate or missing material ids');
  const per = m.size / 256;
  if (m.regions.length !== per ** 2) throw new RangeError('Baked metadata must cover every region');
  for (let i = 0; i < m.regions.length; i++) {
    const r = m.regions[i]!, rx = i % per, rz = Math.floor(i / per);
    const exact = rx * 256 < x1 && (rx + 1) * 256 > x0 && rz * 256 < z1 && (rz + 1) * 256 > z0;
    if (r.rx !== rx || r.rz !== rz || r.exact !== exact || r.meshes.length !== (exact ? 1 : 4))
      throw new RangeError('Baked regions must be complete, ordered and exact at the physical floor');
    let low = Infinity, high = -Infinity;
    for (let level = 0; level < r.meshes.length; level++) {
      const ref = r.meshes[level]!, scale = 1 << level;
      if (ref.rx !== rx || ref.rz !== rz || ref.level !== level || ref.minY > ref.maxY || ref.minY % 32 || ref.maxY % 32
        || ref.maxY > Math.ceil(m.height / scale / 32) * 32 || ref.rawBytes !== BAKED_REGION_HEADER_BYTES + ref.quadCount * 8)
        throw new RangeError('Baked mesh descriptor disagrees with its region');
      low = Math.min(low, ref.minY * scale); high = Math.max(high, ref.maxY * scale);
    }
    if (!sameBounds(r.bounds, [rx * 128 - ox, low * .5 - oy, rz * 128 - oz],
      [(rx + 1) * 128 - ox, high * .5 - oy, (rz + 1) * 128 - oz])) throw new RangeError('Baked region bounds disagree with mesh bounds');
  }
  return m;
}
function freezeDeep(value: unknown): void {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
}
export function encodeBakedMetadata(metadata: BakedMetadata): Uint8Array {
  const bytes = utf8(canonicalSceneJson(validateBakedMetadata(metadata)));
  if (bytes.byteLength > BAKED_METADATA_BYTES) throw new RangeError('Baked metadata exceeds its byte budget');
  return bytes;
}
export function decodeBakedMetadata(bytes: Uint8Array): BakedMetadata {
  if (!bytes.byteLength || bytes.byteLength > BAKED_METADATA_BYTES) throw new RangeError('Invalid baked metadata length');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const metadata = validateBakedMetadata(JSON.parse(text));
  if (canonicalSceneJson(metadata) !== text) throw new Error('Baked metadata must use canonical JSON bytes');
  freezeDeep(metadata);
  return metadata;
}
