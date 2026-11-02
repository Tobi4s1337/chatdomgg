/** Browser-safe binary entry. No generator, kits, trees, workers or Node dependencies. */
import { BAKED_MAX_SIDE, BAKED_REGION_HEADER_BYTES, BAKED_REGION_QUAD_BYTES, BAKED_SURFACE_HEADER_BYTES,
  type BakedRegionMesh, type BakedSurface } from './types';
import { assertDimensions, assertMesh, assertSurface, integer } from './validation';
export { encodeBakedMetadata, decodeBakedMetadata } from './metadata-codec';

const REGION_MAGIC = 0x31524447; // GDR1
const SURFACE_MAGIC = 0x31534447; // GDS1
function header(bytes: Uint8Array, magic: number, length: number, limit: number): DataView {
  if (bytes.byteLength < length || bytes.byteLength > limit) throw new RangeError('Invalid baked blob length');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== magic || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== length)
    throw new Error('Unsupported baked blob format');
  return view;
}
function create(length: number, magic: number, headerBytes: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  view.setUint32(0, magic, true); view.setUint16(4, 1, true); view.setUint16(6, headerBytes, true);
  return { bytes, view };
}
export function encodeBakedRegion(mesh: BakedRegionMesh): Uint8Array {
  assertMesh(mesh);
  const { bytes, view } = create(BAKED_REGION_HEADER_BYTES + mesh.quads.byteLength, REGION_MAGIC, BAKED_REGION_HEADER_BYTES);
  view.setUint16(8, mesh.rx, true); view.setUint16(10, mesh.rz, true); view.setUint8(12, mesh.level);
  view.setUint32(16, mesh.minY, true); view.setUint32(20, mesh.maxY, true);
  view.setUint32(24, mesh.quads.length / 2, true); view.setUint32(28, mesh.quads.byteLength, true);
  for (let i = 0; i < 7; i++) view.setUint32(32 + i * 4, mesh.offsets[i]!, true);
  for (let i = 0; i < mesh.quads.length; i++) view.setUint32(BAKED_REGION_HEADER_BYTES + i * 4, mesh.quads[i]!, true);
  return bytes;
}
export function decodeBakedRegion(bytes: Uint8Array): BakedRegionMesh {
  const view = header(bytes, REGION_MAGIC, BAKED_REGION_HEADER_BYTES, BAKED_REGION_HEADER_BYTES + BAKED_REGION_QUAD_BYTES);
  const count = view.getUint32(24, true), payload = view.getUint32(28, true);
  if (view.getUint8(13) || view.getUint16(14, true) || view.getUint32(60, true)
    || payload !== count * 8 || bytes.byteLength !== BAKED_REGION_HEADER_BYTES + payload)
    throw new RangeError('Invalid baked region payload length or reserved bits');
  const quads = new Uint32Array(count * 2), offsets = new Int32Array(7);
  for (let i = 0; i < 7; i++) offsets[i] = view.getUint32(32 + i * 4, true);
  for (let i = 0; i < quads.length; i++) quads[i] = view.getUint32(BAKED_REGION_HEADER_BYTES + i * 4, true);
  const mesh: BakedRegionMesh = { level: view.getUint8(12), rx: view.getUint16(8, true), rz: view.getUint16(10, true),
    minY: view.getUint32(16, true), maxY: view.getUint32(20, true), quads, offsets };
  assertMesh(mesh);
  return mesh;
}
export function encodeBakedSurface(surface: BakedSurface): Uint8Array {
  assertSurface(surface);
  const { bytes, view } = create(BAKED_SURFACE_HEADER_BYTES + surface.size ** 2 * 4, SURFACE_MAGIC, BAKED_SURFACE_HEADER_BYTES);
  view.setUint32(8, surface.size, true); view.setUint32(12, surface.height, true);
  view.setUint32(16, surface.seaLevel, true); view.setUint32(20, surface.ground.length, true);
  for (let i = 0; i < surface.ground.length; i++) {
    view.setUint16(BAKED_SURFACE_HEADER_BYTES + i * 2, surface.ground[i]!, true);
    view.setUint16(BAKED_SURFACE_HEADER_BYTES + surface.ground.byteLength + i * 2, surface.water[i]!, true);
  }
  return bytes;
}
export function decodeBakedSurface(bytes: Uint8Array): BakedSurface {
  const view = header(bytes, SURFACE_MAGIC, BAKED_SURFACE_HEADER_BYTES, BAKED_SURFACE_HEADER_BYTES + BAKED_MAX_SIDE ** 2 * 4);
  const size = view.getUint32(8, true), height = view.getUint32(12, true), seaLevel = view.getUint32(16, true);
  assertDimensions(size, height, seaLevel);
  const count = view.getUint32(20, true);
  integer(count, size ** 2, size ** 2, 'surface count');
  if (view.getUint32(24, true) || view.getUint32(28, true) || bytes.byteLength !== BAKED_SURFACE_HEADER_BYTES + count * 4)
    throw new RangeError('Invalid baked surface payload length or reserved bits');
  const ground = new Uint16Array(count), water = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    ground[i] = view.getUint16(BAKED_SURFACE_HEADER_BYTES + i * 2, true);
    water[i] = view.getUint16(BAKED_SURFACE_HEADER_BYTES + count * 2 + i * 2, true);
  }
  const surface = { size, height, seaLevel, ground, water };
  assertSurface(surface);
  return surface;
}
