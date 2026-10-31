import { describe, expect, it } from 'vitest';
import { MAT, MATERIALS, STYLES, type StyleKey } from '../materials';
import { createForgeMotif } from '../forge-motifs';
import { ANVIL_HERO_DRAGON_SURFACE, createAnvilHeroDragon, DRAGON_EMITTER } from './index';

const KITS: StyleKey[] = ['hearth', 'tide', 'grove'];
type Grid = { at: (x: number, y: number, z: number) => number; solid: number; size: [number, number, number] };

/** The final occupancy after every box in order, exactly as the rasteriser applies them. */
function occupancy(style: StyleKey): Grid {
  const { size, boxes } = createAnvilHeroDragon(style), [W, H, D] = size, cells = new Uint8Array(W * H * D);
  for (const { from, to, material } of boxes) for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) for (let x = from[0]; x < to[0]; x++) cells[x + W * (y + H * z)] = material;
  const at = (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D ? 0 : cells[x + W * (y + H * z)]!;
  return { at, solid: cells.reduce((n, m) => n + (m ? 1 : 0), 0), size };
}

describe('the sleeping dragon chimney', () => {
  it.each(KITS)('%s keeps the motif envelope, mount and smoke anchor, deterministically', style => {
    const old = createForgeMotif('sleeping-dragon', style), dragon = createAnvilHeroDragon(style);
    expect([dragon.size, dragon.mount, dragon.emitter]).toEqual([old.size, old.mount, DRAGON_EMITTER]);
    expect(createAnvilHeroDragon(style)).toEqual(dragon);
    // Callers recolour and mirror the returned boxes in place; each call must hand out fresh ones.
    expect(createAnvilHeroDragon(style).boxes[0]).not.toBe(dragon.boxes[0]);
    expect(dragon.boxes.length).toBeLessThan(400);
    for (const { from, to, material } of dragon.boxes) {
      for (let i = 0; i < 3; i++) { expect(Number.isInteger(from[i]) && Number.isInteger(to[i])).toBe(true); expect(from[i]).toBeGreaterThanOrEqual(0); expect(to[i]).toBeGreaterThan(from[i]!); expect(to[i]).toBeLessThanOrEqual(dragon.size[i]!); }
      expect(MATERIALS.materials.some(m => m.id === material)).toBe(true);
    }
  });

  it.each(KITS)('%s is one solid piece standing on its mount, with a quiet registered palette', style => {
    const { at, solid, size: [W, H, D] } = occupancy(style), { mount } = createAnvilHeroDragon(style);
    expect(at(...mount)).not.toBe(0);
    const key = (x: number, y: number, z: number) => x + W * (y + H * z), seen = new Set([key(...mount)]), todo = [mount];
    while (todo.length) {
      const [x, y, z] = todo.pop()!;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const p: [number, number, number] = [x + dx, y + dy, z + dz];
        if (at(...p) && !seen.has(key(...p))) { seen.add(key(...p)); todo.push(p); }
      }
    }
    expect(seen.size).toBe(solid);
    const palette = new Set<number>();
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y, z)) palette.add(at(x, y, z));
    // The assembler adds its own stone and trim; the Forge check allows nine materials in all.
    expect(palette.size).toBeLessThanOrEqual(6);
  });

  it.each(KITS)('%s breathes out of a hollow nose, and its stack has a dark open mouth', style => {
    const { at } = occupancy(style), [ex, ey, ez] = DRAGON_EMITTER;
    // The anchor sits just outside the nose at the left end of the head, open to the sky above it.
    for (let y = ey; y < 16; y++) expect(at(ex, y, ez)).toBe(0);
    // The nostril runs into the snout (+X), rimmed by snout above, below and behind, its dark twin beside it.
    expect(at(ex + 1, ey, ez)).toBe(0);
    expect(at(ex + 1, ey + 1, ez)).not.toBe(0);
    expect(at(ex + 1, ey - 1, ez)).not.toBe(0);
    expect(at(ex + 2, ey, ez)).not.toBe(0);
    expect(at(ex + 1, ey, ez - 1)).not.toBe(0);
    // The crooked flue is walled all the way up and open to the sky at its mouth.
    for (let y = 3; y <= 6; y++) { expect(at(14, y, 5)).toBe(0); expect(at(13, y, 5)).not.toBe(0); expect(at(16, y, 5)).not.toBe(0); }
    for (let y = 7; y < 16; y++) expect(at(15, y, 5)).toBe(0);
    for (let y = 7; y <= 11; y++) { expect(at(14, y, 5)).not.toBe(0); expect(at(17, y, 5)).not.toBe(0); }
  });

  it.each(KITS)('%s is the tallest stack, with the sleeper low around it', style => {
    const { at } = occupancy(style), stack = new Set<number>([MAT.stone, MAT.darkStone, MAT.slate]);
    let stackTop = 0, sleeperTop = 0;
    for (let z = 0; z < 18; z++) for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) {
      const m = at(x, y, z);
      if (!m) continue;
      if (x >= 13 && x < 19 && z >= 2 && z < 9 && y >= 7 && stack.has(m)) stackTop = Math.max(stackTop, y + 1);
      else if (!(x >= 13 && x < 19 && z >= 2 && z < 9)) sleeperTop = Math.max(sleeperTop, y + 1);
    }
    expect(stackTop).toBe(12);
    // Horns and the folded wing's peak stay well below the chimney's lip: no second chimney.
    expect(sleeperTop).toBeLessThanOrEqual(11);
  });

  it.each(KITS)('%s rests its chin on two paws, with closed lids under its brows', style => {
    const { at } = occupancy(style), back = ANVIL_HERO_DRAGON_SURFACE[style];
    for (const x of [2, 3, 4]) {
      // Two paws on the roof, the jaw resting on their inner edges, and air between them under the chin.
      for (const z of [10, 13]) expect(at(x, 0, z)).not.toBe(0);
      for (const z of [11, 12]) { expect(at(x, 0, z)).toBe(0); expect(at(x, 1, z)).toBe(0); }
      // The jaw is a light band under a darker muzzle.
      expect(at(x, 2, 12)).not.toBe(0);
      expect(at(x, 2, 12)).not.toBe(back);
      expect(at(x, 4, 12)).toBe(back);
    }
    // The skull steps up two cells from the muzzle at the eyes.
    expect(at(7, 7, 12)).not.toBe(0);
    expect(at(4, 7, 12)).toBe(0);
    for (const [z, out] of [[9, 8], [14, 15]] as const) {
      // Each closed lid is a dark slit on the skull's flank, under a brow that juts out over it.
      expect(at(6, 6, z)).not.toBe(0);
      expect(at(6, 6, z)).not.toBe(back);
      expect(at(6, 6, out)).toBe(0);
      expect(at(6, 7, out)).not.toBe(0);
    }
  });

  it.each(KITS)('%s sweeps light horns back over the neck and curls its tail round a loop of air', style => {
    const { at } = occupancy(style), back = ANVIL_HERO_DRAGON_SURFACE[style];
    for (const z of [9, 14]) { expect(at(9, 8, z)).not.toBe(0); expect(at(9, 8, z)).not.toBe(back); }
    // They stop short of the stack, so the two never merge into one pale mass from the street.
    for (let y = 8; y < 12; y++) for (const z of [8, 14, 15]) expect(at(12, y, z)).toBe(0);
    // Over the dip of the neck the horns are clear of the body below them.
    expect(at(10, 7, 12)).toBe(0);
    // The tail runs along the front of the roof; inside its loop the roof shows through.
    expect(at(16, 0, 15)).not.toBe(0);
    for (const [x, z] of [[13, 12], [14, 13], [15, 12]] as const) expect(at(x, 0, z)).toBe(0);
  });

  it('gives each kit its own materials, never its roof\'s as the back', () => {
    const backs = KITS.map(style => { const { at } = occupancy(style); return at(20, 2, 8); });
    expect(new Set(backs).size).toBe(3);
    expect(backs).not.toContain(MAT.terracotta);
    expect(backs).not.toContain(MAT.slate);
    expect(backs).not.toContain(MAT.thatch);
  });

  it.each(KITS)('%s names its broad back as the surface a Forge finish recolours, not its roof', style => {
    const { at } = occupancy(style), surface = ANVIL_HERO_DRAGON_SURFACE[style], cells = new Map<number, number>();
    for (let z = 0; z < 18; z++) for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) if (at(x, y, z)) cells.set(at(x, y, z), (cells.get(at(x, y, z)) ?? 0) + 1);
    expect(at(20, 2, 8)).toBe(surface);
    expect(surface).not.toBe(STYLES[style].roof);
    expect(Math.max(...cells.values())).toBe(cells.get(surface));
  });
});
