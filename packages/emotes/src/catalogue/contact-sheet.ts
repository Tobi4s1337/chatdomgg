import type { MaterialRegistry, VoxelBlueprint } from '../deps';
import { crc32 } from '../decode/crc32';
import type { CompiledEmote } from '../types';

/** Bounds for what a reviewer receives: every frame, a few sheets, never an unbounded image. */
export const CONTACT_SHEET_LIMITS = { maxSide: 2048, maxSheets: 16, maxTileHeight: 240, maxScale: 6 } as const;
/** A 1.75 m person, in build cells, drawn beside every frame so the reviewer judges the real scale. */
const PERSON_CELLS = 14;
const BACKGROUND: readonly [number, number, number] = [222, 214, 196];
const MARKER: readonly [number, number, number] = [92, 84, 96];
const GAP = 2;

function solidVolume(blueprint: VoxelBlueprint): Uint16Array {
  const [w, h, d] = blueprint.size, voxels = new Uint16Array(w * h * d);
  for (const box of blueprint.boxes) for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) for (let x = box.from[0]; x < box.to[0]; x++) voxels[x + w * (y + h * z)] = box.material;
  return voxels;
}

/**
 * Orthographic review views of every carved frame: the front (what the plaza sees) and the side from
 * +X (the sculpture's weight and bevel), each shaded by depth so relief reads, with a 1.75 m person
 * marker for scale. Frames are laid out in order, so the reviewer sees every pose that can ever be
 * shown, and no later frame can slip past unchecked. Returns PNG bytes, at most
 * `CONTACT_SHEET_LIMITS.maxSheets` sheets of at most 2048×2048.
 */
export function renderContactSheets(candidate: Pick<CompiledEmote, 'frames'>, registry: MaterialRegistry): Uint8Array[] {
  const colours = new Map(registry.materials.map(m => {
    const hex = Number.parseInt(m.colour.slice(1), 16);
    return [m.id, [hex >> 16 & 255, hex >> 8 & 255, hex & 255] as const];
  }));
  const [w, h, d] = candidate.frames[0]!.blueprint.size;
  const tileCells = { width: w + GAP + d + GAP + 2 + GAP * 2, height: Math.max(h, PERSON_CELLS) + GAP * 2 };
  const scale = Math.max(1, Math.min(CONTACT_SHEET_LIMITS.maxScale, Math.floor(CONTACT_SHEET_LIMITS.maxTileHeight / tileCells.height), Math.floor(CONTACT_SHEET_LIMITS.maxSide / tileCells.width)));
  const tileW = tileCells.width * scale, tileH = tileCells.height * scale;
  const columns = Math.max(1, Math.floor(CONTACT_SHEET_LIMITS.maxSide / tileW)), rows = Math.max(1, Math.floor(CONTACT_SHEET_LIMITS.maxSide / tileH));
  const perSheet = columns * rows, frames = candidate.frames.length;
  const sheetCount = Math.ceil(frames / perSheet);
  if (sheetCount > CONTACT_SHEET_LIMITS.maxSheets) throw new RangeError('The candidate needs more contact sheets than review allows.');
  const sheets: Uint8Array[] = [];
  for (let sheet = 0; sheet < sheetCount; sheet++) {
    const first = sheet * perSheet, count = Math.min(perSheet, frames - first);
    const width = Math.min(count, columns) * tileW, height = Math.ceil(count / columns) * tileH;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) rgb.set(BACKGROUND, i * 3);
    const cell = (px: number, py: number, colour: readonly number[]): void => {
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) rgb.set(colour, ((py + y) * width + px + x) * 3);
    };
    for (let n = 0; n < count; n++) {
      const voxels = solidVolume(candidate.frames[first + n]!.blueprint);
      const left = (n % columns) * tileW + GAP * scale, base = Math.floor(n / columns) * tileH + tileH - GAP * scale;
      for (let y = 0; y < h; y++) {
        const top = base - (y + 1) * scale;
        for (let x = 0; x < w; x++) for (let z = d - 1; z >= 0; z--) {
          const material = voxels[x + w * (y + h * z)]!;
          if (!material) continue;
          const shade = .62 + .38 * (z + 1) / d;
          cell(left + x * scale, top, (colours.get(material) ?? MARKER).map(c => Math.round(c * shade)));
          break;
        }
        for (let z = 0; z < d; z++) for (let x = w - 1; x >= 0; x--) {
          const material = voxels[x + w * (y + h * z)]!;
          if (!material) continue;
          const shade = .62 + .38 * (x + 1) / w;
          cell(left + (w + GAP + z) * scale, top, (colours.get(material) ?? MARKER).map(c => Math.round(c * shade)));
          break;
        }
      }
      for (let y = 0; y < PERSON_CELLS; y++) for (const x of [0, 1]) cell(left + (w + GAP + d + GAP + x) * scale, base - (y + 1) * scale, MARKER);
    }
    sheets.push(encodePngRgb(width, height, rgb));
  }
  return sheets;
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]!) % 65521; b = (b + a) % 65521; }
  return (b << 16 | a) >>> 0;
}

/** A plain 8-bit RGB PNG with stored (uncompressed) deflate blocks: simple, exact and dependency-free. */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  zlib[0] = 0x78; zlib[1] = 0x01;
  let at = 2;
  for (let i = 0; i < blocks; i++) {
    const chunk = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    zlib[at++] = i === blocks - 1 ? 1 : 0;
    zlib[at++] = chunk.length & 255; zlib[at++] = chunk.length >> 8;
    zlib[at++] = ~chunk.length & 255; zlib[at++] = ~chunk.length >> 8 & 255;
    zlib.set(chunk, at); at += chunk.length;
  }
  new DataView(zlib.buffer).setUint32(at, adler32(raw));
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { png.set(part, offset); offset += part.length; }
  return png;
}
