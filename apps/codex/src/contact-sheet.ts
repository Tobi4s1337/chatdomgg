import { deflateSync } from 'node:zlib';
import { MATERIALS } from '@chatdom/content/materials';
import { VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
import { rasterizeBlueprint } from '@chatdom/voxel';

type Vector = readonly [number, number, number];
type Colour = readonly [number, number, number];
interface View { name: string; right: Vector; up: Vector; camera: Vector }
const WIDTH = 768, HEIGHT = 800;
const BACKGROUND: Colour = [245, 245, 245];
const INK: Colour = [55, 55, 55];
const MAX_RASTER_WRITES = 64 * 1024 * 1024;
const palette = new Map(MATERIALS.materials.map(material => [material.id, [
  Number.parseInt(material.colour.slice(1, 3), 16),
  Number.parseInt(material.colour.slice(3, 5), 16),
  Number.parseInt(material.colour.slice(5, 7), 16),
] as Colour]));
const a = 1 / Math.sqrt(2), b = 1 / Math.sqrt(6), c = 1 / Math.sqrt(3);
const VIEWS: readonly View[] = [
  { name: 'TOP', right: [1, 0, 0], up: [0, 0, -1], camera: [0, 1, 0] },
  { name: 'FRONT', right: [1, 0, 0], up: [0, 1, 0], camera: [0, 0, 1] },
  { name: 'BACK', right: [-1, 0, 0], up: [0, 1, 0], camera: [0, 0, -1] },
  { name: 'LEFT', right: [0, 0, 1], up: [0, 1, 0], camera: [-1, 0, 0] },
  { name: 'RIGHT', right: [0, 0, -1], up: [0, 1, 0], camera: [1, 0, 0] },
  { name: 'STREET', right: [a, 0, -a], up: [-b, 2 * b, -b], camera: [c, c, c] },
];
// The opposite three-quarter view exposes -X faces that the flat street view cannot see.
const HERO: View = { name: 'SHADED LEFT FRONT', right: [a, 0, a], up: [b, 2 * b, -b], camera: [-c, c, c] };
const KEY: Vector = [-0.45, 0.86, 0.25];

function faceColour(base: Colour, axis: number, normal: number): Colour {
  const direct = KEY[axis]! * normal;
  const light = 0.52 + 0.47 * Math.max(0, direct) + 0.08 * Math.max(0, -direct);
  return [Math.round(base[0] * light), Math.round(base[1] * light), Math.round(base[2] * light)];
}

function canvas(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) pixels.set(BACKGROUND, i);
  return pixels;
}

/** Front is +Z; the street camera sees +X, +Y and +Z without lighting or perspective. */
function renderView(asset: VoxelAsset, min: Vector, max: Vector, view: View, width = 232, height = 184, shaded = false): Uint8Array {
  const pixels = canvas(width, height);
  const centre = min.map((n, axis) => (n + max[axis]!) / 2);
  const extent = max.map((n, axis) => n - min[axis]!);
  const span = (axis: Vector) => extent.reduce((sum, n, i) => sum + n * Math.abs(axis[i]!), 0);
  const scale = Math.min((width - 16) / span(view.right), (height - 16) / span(view.up));
  const distance = Math.hypot(...extent) + 1;
  const direction = view.camera.map(n => -n);
  const stride = [1, asset.size[0], asset.size[0] * asset.size[1]];
  const maxSteps = extent.reduce((sum, n) => sum + n, 3);
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const horizontal = (px + 0.5 - width / 2) / scale;
    const vertical = (height / 2 - py - 0.5) / scale;
    const origin = centre.map((n, axis) => n + horizontal * view.right[axis]! + vertical * view.up[axis]! + distance * view.camera[axis]!);
    let near = 0, far = Infinity, hitAxis = 0;
    for (let axis = 0; axis < 3; axis++) {
      const d = direction[axis]!, o = origin[axis]!;
      if (d === 0) {
        if (o < min[axis]! || o >= max[axis]!) far = -1;
      } else {
        const t0 = (min[axis]! - o) / d, t1 = (max[axis]! - o) / d;
        const entry = Math.min(t0, t1);
        if (entry > near) { near = entry; hitAxis = axis; }
        far = Math.min(far, Math.max(t0, t1));
      }
    }
    if (near >= far) continue;
    const cells = origin.map((o, axis) => Math.floor(o + (near + 1e-7) * direction[axis]!));
    const steps = direction.map(Math.sign);
    const delta = direction.map(d => d === 0 ? Infinity : Math.abs(1 / d));
    const crossing = origin.map((o, axis) => direction[axis] === 0 ? Infinity : (cells[axis]! + (steps[axis]! > 0 ? 1 : 0) - o) / direction[axis]!);
    for (let step = 0; step < maxSteps; step++) {
      // Grazing rays can cross the last grid plane before the floating-point far distance.
      if (cells.some((n, axis) => n < 0 || n >= asset.size[axis]!)) break;
      const material = asset.voxels[cells[0]! + cells[1]! * stride[1]! + cells[2]! * stride[2]!]!;
      if (material !== 0) {
        const base = palette.get(material)!;
        pixels.set(shaded ? faceColour(base, hitAxis, -steps[hitAxis]!) : base, (px + py * width) * 3);
        break;
      }
      const next = Math.min(...crossing);
      if (next >= far) break;
      hitAxis = crossing.indexOf(next);
      // Advance every tied axis to avoid treating edge/corner contacts as a visible face.
      for (let axis = 0; axis < 3; axis++) if (crossing[axis]! <= next + 1e-9) {
        cells[axis]! += steps[axis]!;
        crossing[axis]! += delta[axis]!;
      }
    }
  }
  return pixels;
}

function distanceTile(street: Uint8Array): Uint8Array {
  const small = canvas(64, 64);
  // Area-average a square letterbox of the street image, retaining its aspect ratio.
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const x0 = Math.floor(x * 232 / 64), x1 = Math.floor((x + 1) * 232 / 64);
    const y0 = Math.floor(y * 232 / 64) - 24, y1 = Math.floor((y + 1) * 232 / 64) - 24;
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0, count = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        sum += sy < 0 || sy >= 184 ? BACKGROUND[channel]! : street[(sx + sy * 232) * 3 + channel]!;
        count++;
      }
      small[(x + y * 64) * 3 + channel] = Math.round(sum / count);
    }
  }
  const weights = [1, 4, 6, 4, 1];
  let source = small;
  for (const horizontal of [true, false]) {
    const target = new Uint8Array(source.length);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let channel = 0; channel < 3; channel++) {
      let sum = 0;
      for (let tap = -2; tap <= 2; tap++) {
        const sx = horizontal ? Math.max(0, Math.min(63, x + tap)) : x;
        const sy = horizontal ? y : Math.max(0, Math.min(63, y + tap));
        sum += source[(sx + sy * 64) * 3 + channel]! * weights[tap + 2]!;
      }
      target[(x + y * 64) * 3 + channel] = Math.round(sum / 16);
    }
    source = target;
  }
  return source;
}

const FONT: Readonly<Record<string, string>> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', M: '101111111101101', K: '101101110101101', L: '100100100100111', N: '101111111111101', O: '010101101101010',
  P: '110101110100100', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', W: '101101111111101', X: '101101010101101', '6': '011100111101111',
  '4': '101101111001001', '0': '111101101101111', '1': '010110010010111', '2': '111001111100111',
  '3': '111001111001111', '5': '111100111001111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
};

function label(pixels: Uint8Array, text: string, x: number, y: number, stride = WIDTH, size = 2): void {
  for (const character of text) {
    const glyph = FONT[character];
    if (glyph) for (let row = 0; row < 5; row++) for (let column = 0; column < 3; column++) {
      if (glyph[row * 3 + column] !== '1') continue;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) pixels.set(INK, ((x + column * size + dx) + (y + row * size + dy) * stride) * 3);
    }
    x += size * 4;
  }
}

function paste(pixels: Uint8Array, tile: Uint8Array, width: number, height: number, x: number, y: number, stride = WIDTH): void {
  for (let row = 0; row < height; row++) pixels.set(tile.subarray(row * width * 3, (row + 1) * width * 3), ((y + row) * stride + x) * 3);
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const bytes = Buffer.alloc(12 + data.length);
  bytes.writeUInt32BE(data.length, 0);
  bytes.write(type, 4, 4, 'ascii');
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const value of bytes.subarray(4, 8 + data.length)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return bytes;
}

export interface ForgeContactSheetContext {
  home: VoxelBlueprint;
  /** Position of the piece's local origin in the home's voxel coordinates. */
  origin: readonly [number, number, number];
}

function checkWrites(blueprint: VoxelBlueprint): number {
  return blueprint.boxes.reduce((sum, box) => sum + box.to.reduce((volume, n, axis) => volume * (n - box.from[axis]!), 1), 0);
}

/** Compose final solid cells, never applying the part's air cuts to the home. */
function placedAsset(part: VoxelAsset, context: ForgeContactSheetContext, remainingWrites: number): VoxelAsset {
  const home = VoxelBlueprintSchema.parse(context.home);
  if (checkWrites(home) > remainingWrites) throw new RangeError('Forge contact sheet exceeds the raster work budget.');
  if (context.origin.length !== 3 || !context.origin.every(Number.isSafeInteger)) throw new RangeError('Invalid Forge contact sheet origin.');
  const low = context.origin.map(n => Math.min(0, n));
  const size = home.size.map((n, i) => Math.max(n, context.origin[i]! + part.size[i]!) - low[i]!) as [number, number, number];
  // The trusted castle host contract permits 32 million cells; street homes are much smaller.
  if (size.some(n => n <= 0 || n > 512) || size.reduce((a, b) => a * b, 1) > 32 * 1024 * 1024) throw new RangeError('Forge contact sheet exceeds the composition budget.');
  const host = rasterizeBlueprint(home);
  const voxels = new Uint16Array(size[0] * size[1] * size[2]);
  const copy = (source: VoxelAsset, offset: readonly number[]) => {
    for (let z = 0; z < source.size[2]; z++) for (let y = 0; y < source.size[1]; y++) for (let x = 0; x < source.size[0]; x++) {
      const value = source.voxels[x + source.size[0] * (y + source.size[1] * z)]!;
      if (value) voxels[(x + offset[0]!) + size[0] * ((y + offset[1]!) + size[1] * (z + offset[2]!))] = value;
    }
  };
  copy(host, low.map(n => -n));
  copy(part, context.origin.map((n, i) => n - low[i]!));
  return { id: 'forge-contact-composition', revision: 0, lattice: part.lattice, size, voxels };
}

function solidBounds(asset: VoxelAsset): [Vector, Vector] {
  const min: [number, number, number] = [...asset.size], max: [number, number, number] = [0, 0, 0];
  for (let z = 0; z < asset.size[2]; z++) for (let y = 0; y < asset.size[1]; y++) for (let x = 0; x < asset.size[0]; x++) {
    const material = asset.voxels[x + asset.size[0] * (y + asset.size[1] * z)]!;
    if (!material) continue;
    if (!palette.has(material)) throw new Error(`Unknown Forge contact sheet material: ${material}.`);
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x + 1); max[1] = Math.max(max[1], y + 1); max[2] = Math.max(max[2], z + 1);
  }
  if (max[0] === 0) throw new Error('Forge contact sheet requires solid voxels.');
  return [min, max];
}

/** Trusted bounded CPU raster. With context, show the complete part and its actual placement. */
export function renderForgeContactSheet(input: VoxelBlueprint, context?: ForgeContactSheetContext): string {
  const blueprint = VoxelBlueprintSchema.parse(input);
  const writes = checkWrites(blueprint);
  if (writes > MAX_RASTER_WRITES) throw new RangeError('Forge contact sheet exceeds the raster work budget.');
  const asset = rasterizeBlueprint(blueprint);
  const [min, max] = solidBounds(asset);
  const height = context ? 1260 : HEIGHT;
  const pixels = canvas(WIDTH, height);
  if (context) {
    const placed = placedAsset(asset, context, MAX_RASTER_WRITES - writes);
    const [placedMin, placedMax] = solidBounds(placed);
    label(pixels, 'PIECE LEFT FRONT', 16, 10);
    paste(pixels, renderView(asset, min, max, HERO, 360, 306, true), 360, 306, 12, 28);
    label(pixels, 'PIECE FRONT', 400, 10);
    paste(pixels, renderView(asset, min, max, VIEWS[1]!, 360, 306, true), 360, 306, 396, 28);
    label(pixels, 'PIECE LEFT', 16, 350);
    paste(pixels, renderView(asset, min, max, VIEWS[3]!, 360, 280, true), 360, 280, 12, 370);
    label(pixels, 'PIECE RIGHT', 400, 350);
    paste(pixels, renderView(asset, min, max, VIEWS[4]!, 360, 280, true), 360, 280, 396, 370);
    label(pixels, 'ON HOME', 16, 666);
    // Look from the side of the home carrying the piece, including front-wall sockets.
    const [homeMin, homeMax] = solidBounds(rasterizeBlueprint(context.home));
    const sx = context.origin[0] + (min[0] + max[0]) / 2 < (homeMin[0] + homeMax[0]) / 2 ? -1 : 1;
    const wallHeight = context.origin[1] + (min[1] + max[1]) / 2 < (homeMin[1] + homeMax[1]) / 2;
    const sz = wallHeight ? 1 : context.origin[2] + (min[2] + max[2]) / 2 < (homeMin[2] + homeMax[2]) / 2 ? -1 : 1;
    const homeView: View = wallHeight
      ? { name: 'ON HOME', right: [1, 0, 0], up: [0, 0.98, -0.2], camera: [0, 0.2, 0.98] }
      : { name: 'ON HOME', right: [sz * a, 0, -sx * a], up: [-sx * b, 2 * b, -sz * b], camera: [sx * c, c, sz * c] };
    paste(pixels, renderView(placed, placedMin, placedMax, homeView, 736, 420, true), 736, 420, 16, 686);
    // Keep the diagnostic angles, plus the underside: a larger front view must not hide other marks.
    const diagnostics: readonly View[] = [...VIEWS, { name: 'BOTTOM', right: [1, 0, 0], up: [0, 0, 1], camera: [0, -1, 0] }];
    for (const [i, view] of diagnostics.entries()) {
      const x = i * 108;
      label(pixels, view.name, x + 8, 1122);
      paste(pixels, renderView(asset, min, max, view, 108, 112, true), 108, 112, x, 1140);
    }
  } else {
    for (const [i, view] of VIEWS.entries()) {
      const x = i % 3 * 256, y = Math.floor(i / 3) * 224;
      const tile = renderView(asset, min, max, view);
      label(pixels, view.name, x + 12, y + 8);
      paste(pixels, tile, 232, 184, x + 12, y + 28);
      if (view.name === 'STREET') paste(pixels, distanceTile(tile), 64, 64, 696, 448);
    }
    label(pixels, 'DISTANCE 64PX', 584, 472);
    label(pixels, HERO.name, 16, 520);
    paste(pixels, renderView(asset, min, max, HERO, 736, 256, true), 736, 256, 16, 540);
  }
  return encodePng(pixels, WIDTH, height);
}

function encodePng(pixels: Uint8Array, width: number, height: number): string {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // Eight-bit RGB; no interlace or palette indirection.
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', new Uint8Array())]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

export const FORGE_CERTIFICATION_TILE = 200;
/**
 * A blind identification sheet: numbered tiles, each a lit front view and a lit three-quarter view of one whole
 * piece, with no caption, title or plan anywhere in the image. The caller decides the order; the sheet itself
 * carries only tile numbers.
 */
export function renderForgeCertificationSheet(pieces: readonly VoxelBlueprint[], columns = 4): string {
  if (!pieces.length || pieces.length > 32 || !Number.isInteger(columns) || columns < 1 || columns > 8) throw new RangeError('Invalid Forge certification sheet.');
  const tile = FORGE_CERTIFICATION_TILE, cellWidth = tile * 2 + 24, cellHeight = tile + 12, header = 26;
  const width = columns * cellWidth + 12, height = Math.ceil(pieces.length / columns) * (cellHeight + header) + 12;
  const pixels = canvas(width, height);
  let writes = 0;
  for (const [index, input] of pieces.entries()) {
    const blueprint = VoxelBlueprintSchema.parse(input);
    writes += checkWrites(blueprint);
    if (writes > MAX_RASTER_WRITES) throw new RangeError('Forge certification sheet exceeds the raster work budget.');
    const asset = rasterizeBlueprint(blueprint), [min, max] = solidBounds(asset);
    const x = 12 + (index % columns) * cellWidth, y = 12 + Math.floor(index / columns) * (cellHeight + header);
    label(pixels, String(index + 1), x + 4, y + 2, width, 3);
    paste(pixels, renderView(asset, min, max, VIEWS[1]!, tile, tile, true), tile, tile, x, y + header, width);
    paste(pixels, renderView(asset, min, max, HERO, tile, tile, true), tile, tile, x + tile, y + header, width);
  }
  return encodePng(pixels, width, height);
}
