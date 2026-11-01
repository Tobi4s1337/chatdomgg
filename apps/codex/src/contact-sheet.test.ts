import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAT, MATERIALS } from '@chatdom/content/materials';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { renderForgeContactSheet } from './contact-sheet';

const colouredBlocks = VoxelBlueprintSchema.parse({
  version: 1, id: 'contact-sheet-test', styleId: 'hearth', kind: 'prop', lattice: 'build',
  size: [2, 1, 2], windows: [], boxes: [
    { from: [0, 0, 0], to: [1, 1, 1], material: MAT.fabricGold },
    { from: [1, 0, 0], to: [2, 1, 1], material: MAT.fabricGreen },
    { from: [0, 0, 1], to: [1, 1, 2], material: MAT.fabricRed },
    { from: [1, 0, 1], to: [2, 1, 2], material: MAT.fabricBlue },
  ],
});
const colour = (id: number) => Buffer.from(MATERIALS.materials.find(material => material.id === id)!.colour.slice(1), 'hex');
const background = Buffer.from([245, 245, 245]);

/** Independent PNG reader checks standard chunks/CRCs and actual decompressed image rows. */
function decode(uri: string) {
  expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  const png = Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64');
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat: Buffer[] = [];
  let width = 0, height = 0, ended = false;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const payload = png.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (const value of png.subarray(offset + 4, offset + 8 + length)) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
    }
    expect(png.readUInt32BE(offset + 8 + length)).toBe((crc ^ 0xffffffff) >>> 0);
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0); height = payload.readUInt32BE(4);
      expect([...payload.subarray(8)]).toEqual([8, 2, 0, 0, 0]);
    }
    if (type === 'IDAT') idat.push(payload);
    if (type === 'IEND') ended = true;
    offset += length + 12;
  }
  expect(ended).toBe(true);
  const raw = inflateSync(Buffer.concat(idat));
  expect(raw.length).toBe(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) expect(raw[y * (width * 3 + 1)]).toBe(0);
  return { width, height, pixel: (x: number, y: number) => raw.subarray(y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3) };
}

describe('trusted Forge contact sheet', () => {
  it('encodes a bounded 768x800 PNG with six nonempty flat-colour views and the unchanged blurred 64px street tile', () => {
    const uri = renderForgeContactSheet(colouredBlocks);
    expect(renderForgeContactSheet(colouredBlocks)).toBe(uri);
    const image = decode(uri);
    expect([image.width, image.height]).toEqual([768, 800]);
    expect(uri.length).toBeLessThan(4 * 1024 * 1024);
    const allowed = [background, ...[MAT.fabricGold, MAT.fabricGreen, MAT.fabricRed, MAT.fabricBlue].map(colour)];
    for (let view = 0; view < 6; view++) {
      const x = view % 3 * 256 + 12, y = Math.floor(view / 3) * 224 + 28;
      let coloured = 0;
      for (let py = y; py < y + 184; py++) for (let px = x; px < x + 232; px++) {
        const pixel = image.pixel(px, py);
        expect(allowed.some(value => value.equals(pixel))).toBe(true);
        if (!background.equals(pixel)) coloured++;
      }
      expect(coloured).toBeGreaterThan(1000);
    }
    let blurredPixels = 0, foreground = 0;
    for (let y = 448; y < 512; y++) for (let x = 696; x < 760; x++) {
      const pixel = image.pixel(x, y);
      if (!allowed.some(value => value.equals(pixel))) blurredPixels++;
      if (!background.equals(pixel)) foreground++;
    }
    expect(blurredPixels).toBeGreaterThan(100);
    expect(foreground).toBeGreaterThan(100);
  });

  it('keeps the top, front, back, left and right orientations and unlit material colours', () => {
    const { pixel } = decode(renderForgeContactSheet(colouredBlocks));
    // +Z is front; side/back views reverse their horizontal axis as a camera would.
    expect(pixel(256 + 74, 120)).toEqual(colour(MAT.fabricRed));
    expect(pixel(256 + 182, 120)).toEqual(colour(MAT.fabricBlue));
    expect(pixel(512 + 74, 120)).toEqual(colour(MAT.fabricGreen));
    expect(pixel(512 + 182, 120)).toEqual(colour(MAT.fabricGold));
    expect(pixel(74, 224 + 120)).toEqual(colour(MAT.fabricGold));
    expect(pixel(182, 224 + 120)).toEqual(colour(MAT.fabricRed));
    expect(pixel(256 + 74, 224 + 120)).toEqual(colour(MAT.fabricBlue));
    expect(pixel(256 + 182, 224 + 120)).toEqual(colour(MAT.fabricGreen));
    expect(pixel(86, 78)).toEqual(colour(MAT.fabricGold));
    expect(pixel(170, 162)).toEqual(colour(MAT.fabricBlue));
  });

  it('uses the final ordered raster so air cuts expose geometry behind them', () => {
    const blueprint = VoxelBlueprintSchema.parse({ ...colouredBlocks, boxes: [
      ...colouredBlocks.boxes,
      { from: [0, 0, 1], to: [1, 1, 2], material: MAT.air },
    ] });
    const { pixel } = decode(renderForgeContactSheet(blueprint));
    expect(pixel(256 + 74, 120)).toEqual(colour(MAT.fabricGold));
    expect(pixel(256 + 182, 120)).toEqual(colour(MAT.fabricBlue));
  });

  it('shows whole geometry from -X/+Y/+Z with deterministic shading of the actual hit faces, including air cuts', () => {
    const cube = VoxelBlueprintSchema.parse({ ...colouredBlocks, size: [3, 3, 3], boxes: [
      { from: [0, 0, 0], to: [3, 3, 3], material: MAT.fabricGold },
    ] });
    const uri = renderForgeContactSheet(cube);
    expect(renderForgeContactSheet(cube)).toBe(uri);
    const solid = decode(uri);
    // Known interior points on the top, -X and +Z faces of a solid cube.
    const top = Buffer.from([200, 175, 96]), left = Buffer.from([158, 138, 76]), front = Buffer.from([138, 120, 66]);
    expect(solid.pixel(384, 600)).toEqual(top);
    expect(solid.pixel(330, 670)).toEqual(left);
    expect(solid.pixel(440, 670)).toEqual(front);
    for (let x = 16; x < 752; x++) {
      expect(solid.pixel(x, 540)).toEqual(background);
      expect(solid.pixel(x, 795)).toEqual(background);
    }
    for (let y = 540; y < 796; y++) {
      expect(solid.pixel(16, y)).toEqual(background);
      expect(solid.pixel(751, y)).toEqual(background);
    }
    // Removing an upper front-left corner exposes a recessed wall and the cut's floor.
    const cut = decode(renderForgeContactSheet({ ...cube, boxes: [
      ...cube.boxes, { from: [0, 1, 2], to: [1, 3, 3], material: MAT.air },
    ] }));
    expect(solid.pixel(384, 650)).toEqual(top);
    expect(cut.pixel(384, 650)).toEqual(left);
    expect(solid.pixel(384, 720)).toEqual(front);
    expect(cut.pixel(384, 720)).toEqual(top);
  });

  it('renders the supplied home at the supplied origin without letting piece air erase it', () => {
    const home = VoxelBlueprintSchema.parse({ ...colouredBlocks, id: 'real-home', size: [6, 3, 4], boxes: [
      { from: [0, 0, 0], to: [6, 1, 4], material: MAT.stone },
    ] });
    const part = VoxelBlueprintSchema.parse({ ...colouredBlocks, size: [2, 2, 2], boxes: [
      { from: [0, 1, 0], to: [2, 2, 2], material: MAT.fabricRed },
    ] });
    const context = { home, origin: [1, 0, 1] as const };
    const sheet = renderForgeContactSheet(part, context);
    const image = decode(sheet);
    expect([image.width, image.height]).toEqual([768, 944]);
    for (let view = 0; view < 7; view++) {
      let foreground = 0;
      for (let y = 824; y < 936; y++) for (let x = view * 108; x < (view + 1) * 108; x++)
        if (!background.equals(image.pixel(x, y))) foreground++;
      expect(foreground).toBeGreaterThan(20);
    }
    expect(renderForgeContactSheet(part, context)).toBe(sheet);
    const withAir = { ...part, boxes: [...part.boxes, { from: [0, 0, 0] as [number, number, number], to: [2, 1, 2] as [number, number, number], material: MAT.air }] };
    expect(renderForgeContactSheet(withAir, context)).toBe(sheet);
    expect(renderForgeContactSheet(part, { home, origin: [3, 0, 1] })).not.toBe(sheet);
    const alteredHome = { ...home, boxes: [{ ...home.boxes[0]!, material: MAT.fabricBlue }] };
    expect(renderForgeContactSheet(part, { ...context, home: alteredHome })).not.toBe(sheet);
    expect(() => renderForgeContactSheet(part, { home, origin: [10000, 0, 0] })).toThrow('composition budget');
    expect(() => renderForgeContactSheet(part, { home, origin: [0.5, 0, 0] })).toThrow('origin');
  });

  it('rejects unknown final materials, empty geometry, invalid bounds and excessive raster work', () => {
    const box = { from: [0, 0, 0], to: [2, 1, 2], material: 65535 };
    expect(() => renderForgeContactSheet({ ...colouredBlocks, boxes: [box] } as VoxelBlueprint)).toThrow('Unknown');
    expect(() => renderForgeContactSheet({ ...colouredBlocks, boxes: [] })).toThrow('solid voxels');
    expect(() => renderForgeContactSheet({ ...colouredBlocks, size: [0, 1, 2] })).toThrow();
    const full = { from: [0, 0, 0], to: [128, 128, 128], material: MAT.stone };
    expect(() => renderForgeContactSheet({ ...colouredBlocks, size: [128, 128, 128], boxes: Array.from({ length: 33 }, () => full) } as VoxelBlueprint)).toThrow('work budget');
  });
});
