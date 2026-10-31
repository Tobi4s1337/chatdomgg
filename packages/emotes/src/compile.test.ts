import { describe, expect, it } from 'vitest';
import { MAT, MATERIALS } from '../../content/src/materials';
import { MaterialRegistrySchema, VoxelBlueprintSchema, type MaterialRegistry } from './deps';
import { BANNER_CLEARANCE_CELLS, compileEmote, composeStatueFrame, EMOTE_PROFILES, layoutEmoteBanner, layoutEmoteStatue, sha256Text, simulatedRasterHash, toadWaveFixture, type DecodedEmote, type EmoteSource } from './index';

const KINGDOM: number[] = Object.values(MAT).filter(id => id !== MAT.air && id !== MAT.glass && id !== MAT.waterbed);
const RED = MAT.fabricRed, BLUE = MAT.fabricBlue, DARK = MAT.hairBlack;

type Paint = (x: number, y: number) => readonly [number, number, number, number] | null;
function raster(width: number, height: number, paint: Paint): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const colour = paint(x, y);
    if (colour) rgba.set(colour, (x + y * width) * 4);
  }
  return rgba;
}
function input(width: number, height: number, frames: readonly Uint8Array[], durations: readonly number[] = []): { source: EmoteSource; decoded: DecodedEmote } {
  return {
    source: { id: 'twitch.test', provider: 'twitch', providerId: 'test', kingdomId: toadWaveFixture().source.kingdomId, name: 'test', origin: 'simulated', sourceHash: simulatedRasterHash(width, height, frames), rendition: frames.length > 1 ? 'gif' : 'png' },
    decoded: { width, height, frames: frames.map((rgba, i) => ({ rgba, durationMs: durations[i] ?? 0 })) },
  };
}
const statue = { purpose: 'statue' as const, paletteRevision: 4 };
function compiled(result: ReturnType<typeof compileEmote>) {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}
const voxel = (blueprint: { size: readonly number[]; boxes: readonly { from: readonly number[]; to: readonly number[]; material: number }[] }) => {
  const [sx, sy, sz] = blueprint.size as [number, number, number], cells = new Uint16Array(sx * sy * sz);
  for (const box of blueprint.boxes) for (let z = box.from[2]!; z < box.to[2]!; z++) for (let y = box.from[1]!; y < box.to[1]!; y++) for (let x = box.from[0]!; x < box.to[0]!; x++) cells[x + sx * (y + sy * z)] = box.material;
  return (x: number, y: number, z: number) => cells[x + sx * (y + sy * z)]!;
};

describe('compileEmote', () => {
  it('turns the fixture into a valid 4–6 m statue in the kingdom palette, deterministically', () => {
    const first = compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, statue));
    const again = compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, statue));
    const { emote, stats } = first;
    expect(emote.targetHeightCells).toBeGreaterThanOrEqual(32);
    expect(emote.targetHeightCells).toBeLessThanOrEqual(48);
    expect(emote.frames).toHaveLength(1);
    expect(emote.periodMs).toBe(0);
    const blueprint = VoxelBlueprintSchema.parse(emote.frames[0]!.blueprint);
    expect(blueprint.size).toEqual([stats.size[0], emote.targetHeightCells, 6]);
    expect(blueprint.boxes.length).toBeLessThanOrEqual(EMOTE_PROFILES.statue.maxBoxesPerFrame);
    expect(stats.materials.every(id => KINGDOM.includes(id))).toBe(true);
    // Occupied bounds are tight: something stands on the bottom row and reaches the top row.
    expect(blueprint.boxes.some(box => box.from[1] === 0)).toBe(true);
    expect(blueprint.boxes.some(box => box.to[1] === blueprint.size[1])).toBe(true);
    expect(again.emote.geometryHash).toBe(emote.geometryHash);
    expect(again.emote.revision).toBe(emote.revision);
    expect(emote.revision).toMatch(/^statue\.[0-9a-f]{24}$/);
  });

  it('binds the revision to palette revision, purpose, compiler input and source hash', () => {
    const base = compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, statue)).emote;
    expect(compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, { ...statue, paletteRevision: 5 })).emote.revision).not.toBe(base.revision);
    expect(compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, { purpose: 'heraldry', paletteRevision: 4 })).emote.revision).not.toBe(base.revision);
    const narrower = compiled(compileEmote(toadWaveFixture(), MATERIALS, [MAT.hairBlack, MAT.moss, MAT.cream, MAT.fabricGold], statue)).emote;
    expect(narrower.geometryHash).not.toBe(base.geometryHash);
    const fixture = toadWaveFixture();
    const renamed = compiled(compileEmote({ ...fixture, source: { ...fixture.source, sourceHash: sha256Text('other bytes') } }, MATERIALS, KINGDOM, statue)).emote;
    expect(renamed.geometryHash).toBe(base.geometryHash);
    expect(renamed.revision).not.toBe(base.revision);
  });

  it('keeps source orientation: top-left stays top-left seen from the +Z front', () => {
    // Red in the top-left quadrant, blue in the bottom-right, nothing elsewhere but a dark frame.
    const rgba = raster(40, 40, (x, y) => x < 20 && y < 20 ? [200, 70, 68, 255] : x >= 20 && y >= 20 ? [85, 127, 158, 255] : [48, 36, 31, 255]);
    const { emote } = compiled(compileEmote(input(40, 40, [rgba]), MATERIALS, KINGDOM, { ...statue, targetHeightCells: 40, depthCells: 2 }));
    const { width, height, materialIds } = emote.mask;
    expect([width, height]).toEqual([40, 40]);
    // Mask rows are Y up: row height-1 is the source's top row.
    expect(materialIds[2 + width * (height - 3)]).toBe(RED);
    expect(materialIds[(width - 3) + width * 2]).toBe(BLUE);
    expect(materialIds[2 + width * 2]).toBe(DARK);
    const at = voxel(emote.frames[0]!.blueprint);
    expect(at(2, height - 3, 1)).toBe(RED);
    expect(at(width - 3, 2, 0)).toBe(BLUE);
  });

  it('uses alpha for occupancy: opaque black is solid, transparent black is air', () => {
    const rgba = raster(40, 40, x => x < 20 ? [0, 0, 0, 255] : [0, 0, 0, 0]);
    const result = compiled(compileEmote(input(40, 40, [rgba]), MATERIALS, KINGDOM, { ...statue, targetHeightCells: 40 }));
    expect(result.stats.crop).toEqual([0, 0, 20, 40]);
    expect(result.emote.mask.width).toBe(20);
    expect(new Set(result.emote.mask.materialIds)).toEqual(new Set([DARK]));
    // Faint pixels (alpha below half a cell) never become solid.
    const faint = raster(40, 40, (x, y) => x < 20 ? [0, 0, 0, 255] : y < 20 ? [240, 240, 240, 90] : null);
    const shadowed = compiled(compileEmote(input(40, 40, [faint]), MATERIALS, KINGDOM, { ...statue, targetHeightCells: 40 })).emote;
    expect(shadowed.mask.width).toBe(20);
  });

  it('keeps holes open through the whole depth and bevels their rims', () => {
    const rgba = raster(48, 48, (x, y) => x >= 16 && x < 32 && y >= 16 && y < 32 ? null : [216, 189, 104, 255]);
    const { emote } = compiled(compileEmote(input(48, 48, [rgba]), MATERIALS, KINGDOM, { ...statue, targetHeightCells: 48, depthCells: 6 }));
    const at = voxel(emote.frames[0]!.blueprint);
    for (let z = 0; z < 6; z++) expect(at(24, 24, z)).toBe(0);
    expect(emote.mask.materialIds[24 + 48 * 24]).toBe(0);
    // Interior cells run the full depth; silhouette and hole-rim cells lose their outer layers.
    expect([at(8, 8, 0), at(8, 8, 5)]).toEqual([MAT.fabricGold, MAT.fabricGold]);
    expect([at(0, 8, 0), at(0, 8, 1), at(0, 8, 5)]).toEqual([0, MAT.fabricGold, 0]);
    expect([at(15, 24, 0), at(15, 24, 2), at(15, 24, 5)]).toEqual([0, MAT.fabricGold, 0]);
    // Two cells deep has no room for a bevel.
    const thin = compiled(compileEmote(input(48, 48, [rgba]), MATERIALS, KINGDOM, { ...statue, targetHeightCells: 48, depthCells: 2 })).emote;
    const flat = voxel(thin.frames[0]!.blueprint);
    expect([flat(0, 8, 0), flat(0, 8, 1)]).toEqual([MAT.fabricGold, MAT.fabricGold]);
  });

  it('shares one origin and size across frames and normalizes missing delays', () => {
    const at = (left: number) => raster(64, 64, (x, y) => x >= left && x < left + 24 && y >= 8 && y < 56 ? [200, 70, 68, 255] : null);
    const result = compiled(compileEmote(input(64, 64, [at(4), at(36)], [0, 5]), MATERIALS, KINGDOM, { ...statue, targetHeightCells: 40 }));
    const [a, b] = result.emote.frames;
    expect(a!.blueprint.size).toEqual(b!.blueprint.size);
    expect(result.stats.crop).toEqual([4, 8, 56, 48]);
    expect([a!.durationMs, b!.durationMs, result.emote.periodMs]).toEqual([100, 100, 200]);
    // The block moves across the shared grid instead of the grid moving with the block.
    const first = voxel(a!.blueprint), second = voxel(b!.blueprint);
    expect(first(1, 20, 2)).toBe(RED);
    expect(second(1, 20, 2)).toBe(0);
    expect(second(a!.blueprint.size[0] - 2, 20, 2)).toBe(RED);
  });

  it('removes snapping speckle but keeps a strongly different single-cell feature', () => {
    // A 40×40 patch with one near-colour cell and one dark pupil cell, each a single grid cell.
    const rgba = raster(40, 40, (x, y) => x === 10 && y === 10 ? [176, 156, 92, 255] : x === 30 && y === 30 ? [48, 36, 31, 255] : [216, 189, 104, 255]);
    const result = compiled(compileEmote(input(40, 40, [rgba]), MATERIALS, [MAT.fabricGold, MAT.thatch, MAT.hairBlack], { ...statue, targetHeightCells: 40 }));
    const { width, height, materialIds } = result.emote.mask;
    expect(materialIds[10 + width * (height - 11)]).toBe(MAT.fabricGold);
    expect(materialIds[30 + width * (height - 31)]).toBe(MAT.hairBlack);
    expect(result.stats.speckleCleaned).toBe(1);
  });

  it('breaks colour ties toward the lower material ID whatever order the kingdom lists them', () => {
    const base = MATERIALS.materials.filter(m => m.id === 0);
    const registry: MaterialRegistry = MaterialRegistrySchema.parse({ version: 1, revision: 1, materials: [...base,
      { id: 3, name: 'low', solid: true, occludesFaces: true, occludesAo: true, blocksLight: true, colour: '#646464', surface: 'stone' },
      { id: 7, name: 'high', solid: true, occludesFaces: true, occludesAo: true, blocksLight: true, colour: '#647864', surface: 'stone' }] });
    const rgba = raster(40, 40, () => [100, 110, 100, 255]);
    const { emote } = compiled(compileEmote(input(40, 40, [rgba]), registry, [7, 3], { ...statue, targetHeightCells: 40 }));
    expect(new Set(emote.mask.materialIds)).toEqual(new Set([3]));
  });

  it('refuses over-budget sources before allocating anything per pixel', () => {
    const tiny = new Uint8Array(0);
    const huge = { source: input(1, 1, [new Uint8Array(4)]).source, decoded: { width: 513, height: 64, frames: [{ rgba: tiny, durationMs: 0 }] } };
    expect(compileEmote(huge, MATERIALS, KINGDOM, statue)).toMatchObject({ ok: false, code: 'over-budget' });
    const many = { ...huge, decoded: { width: 8, height: 8, frames: Array.from({ length: 121 }, () => ({ rgba: tiny, durationMs: 50 })) } };
    expect(compileEmote(many, MATERIALS, KINGDOM, statue)).toMatchObject({ ok: false, code: 'over-budget' });
    const heavy = { ...huge, decoded: { width: 512, height: 512, frames: Array.from({ length: 33 }, () => ({ rgba: tiny, durationMs: 50 })) } };
    expect(compileEmote(heavy, MATERIALS, KINGDOM, statue)).toMatchObject({ ok: false, code: 'over-budget' });
    const frame = raster(8, 8, () => [200, 70, 68, 255]);
    const long = input(8, 8, [frame, frame, frame, frame], [10_000, 10_000, 10_000, 10_000]);
    expect(compileEmote(long, MATERIALS, KINGDOM, statue)).toMatchObject({ ok: false, code: 'over-budget' });
    expect(compileEmote({ ...huge, decoded: { width: 8, height: 8, frames: [{ rgba: tiny, durationMs: 0 }] } }, MATERIALS, KINGDOM, statue)).toMatchObject({ ok: false, code: 'invalid-source' });
  });

  it('returns typed failures for empty art, a bad palette, a bad profile and an unfit aspect', () => {
    const clear = input(40, 40, [new Uint8Array(40 * 40 * 4)]);
    expect(compileEmote(clear, MATERIALS, KINGDOM, statue)).toMatchObject({ ok: false, code: 'empty' });
    const art = input(40, 40, [raster(40, 40, () => [200, 70, 68, 255])]);
    expect(compileEmote(art, MATERIALS, [], statue)).toMatchObject({ ok: false, code: 'invalid-palette' });
    expect(compileEmote(art, MATERIALS, [0, RED], statue)).toMatchObject({ ok: false, code: 'invalid-palette' });
    expect(compileEmote(art, MATERIALS, [RED, RED], statue)).toMatchObject({ ok: false, code: 'invalid-palette' });
    expect(compileEmote(art, MATERIALS, [4000], statue)).toMatchObject({ ok: false, code: 'invalid-palette' });
    expect(compileEmote(art, MATERIALS, KINGDOM, { ...statue, depthCells: 7 })).toMatchObject({ ok: false, code: 'invalid-profile' });
    expect(compileEmote(art, MATERIALS, KINGDOM, { ...statue, targetHeightCells: 50 })).toMatchObject({ ok: false, code: 'invalid-profile' });
    const strip = input(112, 20, [raster(112, 20, () => [200, 70, 68, 255])]);
    expect(compileEmote(strip, MATERIALS, KINGDOM, statue)).toMatchObject({ ok: false, code: 'unsupported-aspect' });
    const bad = { ...art, source: { ...art.source, sourceHash: 'not-a-hash' } };
    expect(compileEmote(bad, MATERIALS, KINGDOM, statue)).toMatchObject({ ok: false, code: 'invalid-source' });
  });

  it('fits the smaller purposes to their own authored heights', () => {
    for (const purpose of ['heraldry', 'motif', 'effect'] as const) {
      const { emote } = compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, { purpose, paletteRevision: 4 }));
      expect(emote.targetHeightCells).toBeGreaterThanOrEqual(EMOTE_PROFILES[purpose].height[0]);
      expect(emote.targetHeightCells).toBeLessThanOrEqual(EMOTE_PROFILES[purpose].height[1]);
      expect(emote.frames[0]!.blueprint.kind).toBe('prop');
    }
  });
});

describe('layoutEmoteStatue', () => {
  it('stands the statue centred on a grounded plinth with walking room', () => {
    const { emote } = compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, statue));
    const layout = layoutEmoteStatue(emote.frames, { footing: MAT.darkStone, body: MAT.limestone, cap: MAT.stone, plate: MAT.brass }, 'plaza.statue.plinth');
    const [w, h, d] = emote.frames[0]!.blueprint.size;
    expect(VoxelBlueprintSchema.parse(layout.plinth).size[1]).toBe(layout.statueOffset[1]);
    expect(layout.statueOffset[0]).toBeGreaterThanOrEqual(3);
    expect(layout.statueOffset[0] + w).toBeLessThanOrEqual(layout.footprintCells[0] - 3);
    expect(layout.statueOffset[2] + d).toBeLessThanOrEqual(layout.footprintCells[1] - 3);
    expect(layout.heightCells).toBe(layout.statueOffset[1] + h);
    expect(layout.clearanceCells).toBe(8);
    // The footing touches the ground across the whole footprint.
    expect(layout.plinth.boxes[0]).toMatchObject({ from: [0, 0, 0], to: [layout.footprintCells[0], 2, layout.footprintCells[1]] });
  });
});

describe('composeStatueFrame', () => {
  it('stands every frame on the cap in one blueprint, so the joint is meshed as contact', () => {
    const { emote } = compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, statue));
    const layout = layoutEmoteStatue(emote.frames, { footing: MAT.darkStone, body: MAT.limestone, cap: MAT.stone, plate: MAT.brass }, 'plaza.statue.plinth');
    const frame = emote.frames[0]!, composite = VoxelBlueprintSchema.parse(composeStatueFrame(layout, frame, 'plaza.statue.f0'));
    expect(composite.size).toEqual([layout.footprintCells[0], layout.heightCells, layout.footprintCells[1]]);
    const at = voxel(composite), alone = voxel(frame.blueprint), [ox, oy, oz] = layout.statueOffset;
    const [w, , d] = frame.blueprint.size;
    // The statue's bottom row sits directly on the cap, cell for cell.
    let resting = 0;
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (alone(x, 0, z)) {
      expect(at(x + ox, oy, z + oz)).toBe(alone(x, 0, z));
      expect(at(x + ox, oy - 1, z + oz)).toBe(MAT.stone);
      resting++;
    }
    expect(resting).toBeGreaterThan(0);
  });
});

describe('layoutEmoteBanner', () => {
  it('lays the heraldry charge on a trimmed cloth above head height, upright and proud of the field', () => {
    const { emote } = compiled(compileEmote(toadWaveFixture(), MATERIALS, KINGDOM, { purpose: 'heraldry', paletteRevision: 4 }));
    const materials = { field: MAT.fabricMutedBlue, trim: MAT.fabricGold, pole: MAT.timber, finial: MAT.brass, footing: MAT.stone };
    const layout = layoutEmoteBanner(emote.mask, materials, 'plaza.banner');
    const banner = VoxelBlueprintSchema.parse(layout.blueprint), at = voxel(banner);
    const [cx, cy, cz] = layout.chargeOrigin, { width, height, materialIds } = emote.mask;
    // Every mask cell is on the cloth face in its own material, the right way up; air shows the field.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const material = materialIds[x + width * y]!;
      expect(at(cx + x, cy + y, cz - 1)).toBe(material);
      expect(at(cx + x, cy + y, cz - 2)).toBe(material || MAT.fabricMutedBlue);
    }
    // Nothing of the cloth hangs below head height, and the pole stands on its stone foot.
    for (const box of banner.boxes) if (box.material === MAT.fabricMutedBlue || box.material === MAT.fabricGold) expect(box.from[1]).toBeGreaterThanOrEqual(BANNER_CLEARANCE_CELLS);
    expect(banner.boxes.some(box => box.material === MAT.stone && box.from[1] === 0)).toBe(true);
    expect(() => layoutEmoteBanner({ width: 4, height: 4, materialIds: new Uint16Array(3) }, materials, 'bad')).toThrow();
  });
});

describe('sha256', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Text('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Text('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});
