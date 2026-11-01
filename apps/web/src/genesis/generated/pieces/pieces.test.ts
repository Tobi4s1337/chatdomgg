import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { MAT } from '@chatdom/content/materials';
import { createBellGarden, createOpenAirStage, createStandingStones, gardenLayout, stageLayout, stonesLayout, type GeneratedPiece, type PieceColours, type PieceOptions } from './index';

const STYLES = ['hearth', 'tide', 'grove'] as const;
const SEEDS = [1, 2, 7, 99, 4242, 0x7fffffff, -12345];
/** Seeds that once drew the largest rings and gardens: the box budget must hold for them too. */
const HEAVY = [443779575, -239350392, 683129967, -91423867, 1013904226];
const COLOURS: PieceColours = { field: MAT.fabricRed, charge: MAT.cream, border: MAT.fabricGold };
const options = (style: PieceOptions['style'], seed: number, colours = COLOURS): PieceOptions => ({ style, seed, colours });

const FACTORIES = [
  { name: 'open-air stage', make: createOpenAirStage, metres: [10, 14.5] as const, maxHeight: 128 },
  { name: 'standing stones', make: createStandingStones, metres: [14, 20.5] as const, maxHeight: 48 },
  { name: 'bell garden', make: createBellGarden, metres: [12, 16.5] as const, maxHeight: 64 },
] as const;

/** Occupied cells through the production rasterizer, and how many of them have no face-connected path to y = 0. */
function cells(b: VoxelBlueprint) {
  const asset = rasterizeBlueprint(VoxelBlueprintSchema.parse(b));
  const [sx, sy, sz] = asset.size;
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[x + sx * (y + sy * z)]!);
  return { asset, at };
}
function unsupported(b: VoxelBlueprint): number {
  const { asset } = cells(b);
  const [sx, sy, sz] = asset.size, v = asset.voxels, seen = new Uint8Array(v.length), queue: number[] = [];
  let occupied = 0;
  for (let i = 0; i < v.length; i++) {
    if (!v[i]) continue;
    occupied++;
    if (Math.floor(i / sx) % sy === 0) { seen[i] = 1; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const n of [x > 0 ? i - 1 : -1, x + 1 < sx ? i + 1 : -1, y > 0 ? i - sx : -1, y + 1 < sy ? i + sx : -1, z > 0 ? i - sx * sy : -1, z + 1 < sz ? i + sx * sy : -1]) {
      if (n >= 0 && v[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
    }
  }
  return occupied - queue.length;
}

describe.each(FACTORIES)('$name', ({ make, metres, maxHeight }) => {
  const pieces: { style: string; seed: number; piece: GeneratedPiece }[] = STYLES.flatMap(style => SEEDS.map(seed => ({ style, seed, piece: make(options(style, seed)) })));

  it('is a strict civic blueprint in every style, within the budget', () => {
    for (const style of STYLES) for (const seed of HEAVY) expect(make(options(style, seed)).blueprint.boxes.length).toBeLessThan(3000);
    for (const { style, piece } of pieces) {
      expect(() => VoxelBlueprintSchema.parse(piece.blueprint)).not.toThrow();
      expect(piece.blueprint.kind).toBe('civic');
      expect(piece.blueprint.styleId).toBe(style);
      expect(piece.blueprint.windows).toEqual([]);
      expect(piece.blueprint.boxes.length).toBeLessThan(3000);
      const [sx, sy, sz] = piece.blueprint.size;
      for (const side of [sx, sz]) { expect(side * 0.125).toBeGreaterThanOrEqual(metres[0]); expect(side * 0.125).toBeLessThanOrEqual(metres[1]); }
      expect(sy).toBeLessThanOrEqual(maxHeight);
    }
  });

  it('is deterministic for the same options and encodes its variant in the id', () => {
    for (const style of STYLES) for (const seed of [3, 8080]) {
      const a = make(options(style, seed)), b = make(options(style, seed));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    const ids = new Set(pieces.map(p => p.piece.blueprint.id));
    expect(ids.size).toBe(pieces.length);
    for (const { style, piece } of pieces) expect(piece.blueprint.id).toContain(style);
  });

  it('differs across seeds and across cloth colours', () => {
    for (const style of STYLES) {
      const shapes = new Set(SEEDS.map(seed => JSON.stringify(make(options(style, seed)).blueprint.boxes)));
      expect(shapes.size).toBe(SEEDS.length);
      const blue = make(options(style, 7, { field: MAT.fabricBlue, charge: MAT.fabricGold, border: MAT.cream }));
      const red = make(options(style, 7));
      expect(blue.blueprint.id).not.toBe(red.blueprint.id);
      const used = new Set(blue.blueprint.boxes.map(b => b.material));
      for (const m of [MAT.fabricBlue, MAT.fabricGold]) expect(used.has(m)).toBe(true);
    }
  });

  it('honours the style kit', () => {
    const roofs = { hearth: MAT.terracotta, tide: MAT.slate, grove: MAT.thatch };
    const stones = { hearth: MAT.limestone, tide: MAT.stone, grove: MAT.darkStone };
    for (const { style, piece } of pieces) {
      const used = new Set(piece.blueprint.boxes.map(b => b.material));
      expect(used.has(stones[style as keyof typeof stones])).toBe(true);
      if (style !== 'hearth') expect(used.has(roofs.hearth)).toBe(false);
      for (const m of used) expect(m).not.toBe(MAT.air);
    }
  });

  it('keeps lanterns and footprint inside the blueprint, every lantern at a lamp or a fire', () => {
    for (const { piece } of pieces) {
      const [sx, sy, sz] = piece.blueprint.size, { at } = cells(piece.blueprint);
      expect(piece.lanterns.length).toBeGreaterThanOrEqual(2);
      for (const l of piece.lanterns) {
        l.forEach((v, d) => { expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan([sx, sy, sz][d]!); });
        // Either lamp glass, or the open air of a flame over coals or logs.
        const m = at(l[0], l[1], l[2]);
        if (m !== MAT.glass) {
          expect(m).toBe(MAT.air);
          const below = [at(l[0], l[1] - 1, l[2]), at(l[0], l[1] - 2, l[2])];
          expect(below.some(b => b === MAT.bark || b === MAT.darkStone)).toBe(true);
        }
      }
      const { from, to } = piece.footprint;
      expect(from[0]).toBeGreaterThanOrEqual(0); expect(from[1]).toBeGreaterThanOrEqual(0);
      expect(to[0]).toBeLessThanOrEqual(sx); expect(to[1]).toBeLessThanOrEqual(sz);
      expect(to[0] - from[0]).toBeGreaterThan(sx * 0.75); expect(to[1] - from[1]).toBeGreaterThan(sz * 0.75);
    }
  });

  it('stands on the ground: every occupied cell is held up from y = 0', () => {
    for (const style of STYLES) for (const seed of [1, 2, 7, 99]) expect(unsupported(make(options(style, seed)).blueprint)).toBe(0);
  });

  it('refuses an unknown style or an unregistered colour', () => {
    expect(() => make({ ...options('hearth', 1), style: 'brick' as PieceOptions['style'] })).toThrow(/style/);
    expect(() => make(options('hearth', 1, { ...COLOURS, field: 0 }))).toThrow(/field/);
    expect(() => make(options('hearth', 1, { ...COLOURS, border: 9999 }))).toThrow(/border/);
  });
});

describe('seeded grammar', () => {
  it('varies the stage canopy, seats and rows across seeds', () => {
    const layouts = Array.from({ length: 40 }, (_, i) => stageLayout(i * 7919));
    expect(new Set(layouts.map(l => l.canopy)).size).toBe(2);
    expect(new Set(layouts.map(l => l.seats)).size).toBe(2);
    expect(new Set(layouts.map(l => l.rows)).size).toBe(2);
    expect(new Set(layouts.map(l => l.figure)).size).toBe(4);
  });

  it('rings seven to eleven stones with one trilithon at the back and one fallen stone', () => {
    const counts = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const l = stonesLayout(i * 104729 + 3);
      counts.add(l.count);
      expect(l.count).toBeGreaterThanOrEqual(7); expect(l.count).toBeLessThanOrEqual(11);
      expect(l.slots.length).toBe(l.count - 1);
      const trilithon = l.slots.filter(s => s.role === 'trilithon');
      expect(trilithon).toHaveLength(1);
      expect(Math.abs(trilithon[0]!.angle - Math.PI)).toBeLessThan(0.05);
      expect(l.slots.filter(s => s.role === 'fallen')).toHaveLength(1);
      // The entrance gap at +Z stays open.
      for (const s of l.slots) { expect(s.angle).toBeGreaterThan(l.gap - 1e-9); expect(s.angle).toBeLessThan(Math.PI * 2 - l.gap + 1e-9); }
      const metresAcross = (2 * l.ring + 20) * 0.125;
      expect(metresAcross).toBeGreaterThanOrEqual(13.5); expect(metresAcross).toBeLessThanOrEqual(20);
      for (const s of l.slots) if (s.role !== 'fallen') { expect(s.height * 0.125).toBeGreaterThanOrEqual(2); expect(s.height * 0.125).toBeLessThanOrEqual(4.5); }
    }
    expect(counts.size).toBe(5);
  });

  it('varies the garden enclosure, walks, water and sides, with hedges favoured by grove', () => {
    const grove = Array.from({ length: 60 }, (_, i) => gardenLayout(i * 31337, 'grove'));
    const hearth = Array.from({ length: 60 }, (_, i) => gardenLayout(i * 31337, 'hearth'));
    for (const key of ['enclosure', 'walks', 'water', 'benchLeft', 'treeLeft', 'blossom'] as const) expect(new Set(grove.map(l => l[key])).size).toBeGreaterThan(1);
    expect(grove.filter(l => l.enclosure === 'hedge').length).toBeGreaterThan(hearth.filter(l => l.enclosure === 'hedge').length);
  });

  it('raises the stones from stone: cloth never above the altar, no gilt speckle, grey stone in every kit', () => {
    for (const style of STYLES) for (const seed of [1, 7, 404]) {
      const piece = createStandingStones(options(style, seed)), { asset } = cells(piece.blueprint);
      const [sx, sy] = asset.size, counts = new Map<number, number>();
      for (let i = 0; i < asset.voxels.length; i++) {
        const m = asset.voxels[i]!, y = Math.floor(i / sx) % sy;
        if (!m || y < 10) continue;
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
      for (const m of [COLOURS.field, COLOURS.charge, COLOURS.border, MAT.goldLeaf]) expect(counts.get(m) ?? 0).toBe(0);
      const stone = [MAT.stone, MAT.limestone, MAT.darkStone, MAT.moss].reduce((n, m) => n + (counts.get(m) ?? 0), 0);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      expect(stone / total).toBeGreaterThan(0.97);
      // Grove's ring is grey field stone with its dark stone as the second stone, not a dark-blue ring.
      if (style === 'grove') expect(counts.get(MAT.stone) ?? 0).toBeGreaterThan(counts.get(MAT.darkStone) ?? 0);
    }
  });

  it('hangs a brass bell in the garden and lights two lamp posts', () => {
    for (const style of STYLES) {
      const piece = createBellGarden(options(style, 5));
      expect(piece.lanterns).toHaveLength(2);
      expect(piece.blueprint.boxes.some(b => b.material === MAT.brass && b.from[1] > 16)).toBe(true);
    }
  });
});
