/** Browser-safe binary entry. No generator, kits, trees, workers or Node dependencies. */
import { BAKED_FORMAT, BAKED_MAX_SIDE, BAKED_REGION_HEADER_BYTES, BAKED_REGION_QUAD_BYTES, BAKED_SURFACE_HEADER_BYTES,
  type BakedFormat, type BakedRegionMesh, type BakedSurface } from './types';
import { assertDimensions, assertMesh, assertSurface, integer } from './validation';
export { encodeBakedMetadata, decodeBakedMetadata } from './metadata-codec';

const REGION_MAGIC = 0x31524447; // GDR1
const SURFACE_MAGIC = 0x31534447; // GDS1
/** Returns the blob's format. `expected` binds it to the metadata that names it (metadata version N, blobs N). */
function header(bytes: Uint8Array, magic: number, length: number, limit: number, expected?: BakedFormat): { view: DataView; format: BakedFormat } {
  if (bytes.byteLength < length || bytes.byteLength > limit) throw new RangeError('Invalid baked blob length');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), format = view.getUint16(4, true);
  if (view.getUint32(0, true) !== magic || (format !== 1 && format !== 2) || view.getUint16(6, true) !== length)
    throw new Error('Unsupported baked blob format');
  if (expected !== undefined && format !== expected) throw new Error('Baked blob format differs from its metadata');
  return { view, format };
}
function create(length: number, magic: number, headerBytes: number, format: BakedFormat): { bytes: Uint8Array; view: DataView } {
  if (format !== 1 && format !== 2) throw new RangeError('Unsupported baked blob format');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  view.setUint32(0, magic, true); view.setUint16(4, format, true); view.setUint16(6, headerBytes, true);
  return { bytes, view };
}
/* Format 2 changes only the payload's byte order, never its content, so that gzip sees long runs.
 * Quads: the eight little-endian bytes of every quad are split into eight planes (plane k holds byte k of each
 * quad, in quad order), the shuffle filter of HDF5/Blosc. Surface: each raster row stores its first sample and
 * then uint16 differences (mod 2^16) from the previous sample. Both are exact inverses; decoded arrays are equal. */
export function encodeBakedRegion(mesh: BakedRegionMesh, format: BakedFormat = BAKED_FORMAT): Uint8Array {
  assertMesh(mesh);
  const { bytes, view } = create(BAKED_REGION_HEADER_BYTES + mesh.quads.byteLength, REGION_MAGIC, BAKED_REGION_HEADER_BYTES, format);
  view.setUint16(8, mesh.rx, true); view.setUint16(10, mesh.rz, true); view.setUint8(12, mesh.level);
  view.setUint32(16, mesh.minY, true); view.setUint32(20, mesh.maxY, true);
  view.setUint32(24, mesh.quads.length / 2, true); view.setUint32(28, mesh.quads.byteLength, true);
  for (let i = 0; i < 7; i++) view.setUint32(32 + i * 4, mesh.offsets[i]!, true);
  const count = mesh.quads.length / 2, at = BAKED_REGION_HEADER_BYTES;
  if (format === 1) for (let i = 0; i < mesh.quads.length; i++) view.setUint32(at + i * 4, mesh.quads[i]!, true);
  else for (let quad = 0; quad < count; quad++) for (let word = 0; word < 2; word++) {
    const value = mesh.quads[quad * 2 + word]!;
    for (let k = 0; k < 4; k++) bytes[at + (word * 4 + k) * count + quad] = (value >>> (k * 8)) & 255;
  }
  return bytes;
}
export function decodeBakedRegion(bytes: Uint8Array, expected?: BakedFormat): BakedRegionMesh {
  const { view, format } = header(bytes, REGION_MAGIC, BAKED_REGION_HEADER_BYTES, BAKED_REGION_HEADER_BYTES + BAKED_REGION_QUAD_BYTES, expected);
  const count = view.getUint32(24, true), payload = view.getUint32(28, true);
  if (view.getUint8(13) || view.getUint16(14, true) || view.getUint32(60, true)
    || payload !== count * 8 || bytes.byteLength !== BAKED_REGION_HEADER_BYTES + payload)
    throw new RangeError('Invalid baked region payload length or reserved bits');
  const quads = new Uint32Array(count * 2), offsets = new Int32Array(7);
  for (let i = 0; i < 7; i++) offsets[i] = view.getUint32(32 + i * 4, true);
  const at = BAKED_REGION_HEADER_BYTES;
  if (format === 1) for (let i = 0; i < quads.length; i++) quads[i] = view.getUint32(at + i * 4, true);
  else for (let quad = 0; quad < count; quad++) for (let word = 0; word < 2; word++) {
    const plane = at + word * 4 * count + quad;
    quads[quad * 2 + word] = (bytes[plane]! | bytes[plane + count]! << 8 | bytes[plane + 2 * count]! << 16 | bytes[plane + 3 * count]! << 24) >>> 0;
  }
  const mesh: BakedRegionMesh = { level: view.getUint8(12), rx: view.getUint16(8, true), rz: view.getUint16(10, true),
    minY: view.getUint32(16, true), maxY: view.getUint32(20, true), quads, offsets };
  assertMesh(mesh);
  return mesh;
}
export function encodeBakedSurface(surface: BakedSurface, format: BakedFormat = BAKED_FORMAT): Uint8Array {
  assertSurface(surface);
  const { bytes, view } = create(BAKED_SURFACE_HEADER_BYTES + surface.size ** 2 * 4, SURFACE_MAGIC, BAKED_SURFACE_HEADER_BYTES, format);
  view.setUint32(8, surface.size, true); view.setUint32(12, surface.height, true);
  view.setUint32(16, surface.seaLevel, true); view.setUint32(20, surface.ground.length, true);
  const delta = format === 2, size = surface.size;
  for (let i = 0; i < surface.ground.length; i++) {
    const first = !delta || i % size === 0;
    view.setUint16(BAKED_SURFACE_HEADER_BYTES + i * 2, first ? surface.ground[i]! : (surface.ground[i]! - surface.ground[i - 1]!) & 0xffff, true);
    view.setUint16(BAKED_SURFACE_HEADER_BYTES + surface.ground.byteLength + i * 2,
      first ? surface.water[i]! : (surface.water[i]! - surface.water[i - 1]!) & 0xffff, true);
  }
  return bytes;
}
export function decodeBakedSurface(bytes: Uint8Array, expected?: BakedFormat): BakedSurface {
  const { view, format } = header(bytes, SURFACE_MAGIC, BAKED_SURFACE_HEADER_BYTES, BAKED_SURFACE_HEADER_BYTES + BAKED_MAX_SIDE ** 2 * 4, expected);
  const size = view.getUint32(8, true), height = view.getUint32(12, true), seaLevel = view.getUint32(16, true);
  assertDimensions(size, height, seaLevel);
  const count = view.getUint32(20, true);
  integer(count, size ** 2, size ** 2, 'surface count');
  if (view.getUint32(24, true) || view.getUint32(28, true) || bytes.byteLength !== BAKED_SURFACE_HEADER_BYTES + count * 4)
    throw new RangeError('Invalid baked surface payload length or reserved bits');
  const ground = new Uint16Array(count), water = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    const first = format === 1 || i % size === 0;
    const g = view.getUint16(BAKED_SURFACE_HEADER_BYTES + i * 2, true), w = view.getUint16(BAKED_SURFACE_HEADER_BYTES + count * 2 + i * 2, true);
    ground[i] = first ? g : (ground[i - 1]! + g) & 0xffff;
    water[i] = first ? w : (water[i - 1]! + w) & 0xffff;
  }
  const surface = { size, height, seaLevel, ground, water };
  assertSurface(surface);
  return surface;
}
