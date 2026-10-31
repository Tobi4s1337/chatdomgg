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
    expect([dragon.size, dragon.mount, dragon.emitter]).toEqual([old.size, old.mount, old.emitter]);
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
    expect(at(ex, ey, ez)).toBe(0);
    // The nostril is a real opening in the nose immediately behind the anchor, with nose all round it.
    expect(at(ex + 1, ey, ez)).toBe(0);
    expect(at(ex + 1, ey + 1, ez)).not.toBe(0);
    expect(at(ex + 1, ey, ez - 1)).not.toBe(0);
    expect(at(ex + 1, ey, ez + 1)).not.toBe(0);
    // Nothing of the dragon sits in the smoke's rising column in front of the nose.
    for (let y = ey; y < 16; y++) expect(at(ex, y, ez)).toBe(0);
    // The stack is the tallest shape and its flue is open to the sky, several cells deep.
    let top = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) for (let z = 0; z < 18; z++) if (at(x, y, z)) top = Math.max(top, y + 1);
    expect(top).toBeGreaterThanOrEqual(13);
    expect(top).toBeLessThanOrEqual(14);
    let deep = 0;
    while (deep < top && at(14, top - 1 - deep, 8) === 0) deep++;
    expect(deep).toBeGreaterThanOrEqual(4);
  });

  it.each(KITS)('%s reads asleep: chin on paws with air beneath, a neck dip and a folded wing below the stack', style => {
    const { at } = occupancy(style);
    const height = (x: number) => { let h = 0; for (let z = 0; z < 18; z++) for (let y = 0; y < 16; y++) if (at(x, y, z)) h = Math.max(h, y + 1); return h; };
    // Air under the tip of the chin, and between the forearms under the jaw.
    expect(at(1, 1, 9)).toBe(0);
    expect(at(1, 0, 9)).toBe(0);
    expect([at(4, 0, 11), at(4, 1, 11)]).toEqual([0, 0]);
    expect(at(4, 2, 11)).not.toBe(0);
    // The neck dips well below the crown of the head and the shoulder hump either side of it.
    let neck = 16;
    for (let z = 7; z <= 11; z++) { let h = 0; for (let y = 0; y < 16; y++) if (at(8, y, z) && at(8, y, z) !== MAT.limestone && at(8, y, z) !== MAT.cream && at(8, y, z) !== MAT.goldLeaf) h = y + 1; neck = Math.min(neck, h); }
    expect(neck).toBeLessThanOrEqual(4);
    // Nothing but the stack rises above the wing's 9-cell peak.
    for (let x = 0; x < 24; x++) if (x < 11 || x > 17) expect(height(x)).toBeLessThanOrEqual(9);
  });

  it('gives each kit its own materials, never its roof\'s as the back', () => {
    const backs = KITS.map(style => { const { at } = occupancy(style); return at(16, 2, 4); });
    expect(new Set(backs).size).toBe(3);
    expect(backs).not.toContain(MAT.terracotta);
    expect(backs).not.toContain(MAT.slate);
    expect(backs).not.toContain(MAT.thatch);
  });

  it.each(KITS)('%s names its broad back as the surface a Forge finish recolours, not its roof', style => {
    const { at } = occupancy(style), surface = ANVIL_HERO_DRAGON_SURFACE[style], cells = new Map<number, number>();
    for (let z = 0; z < 18; z++) for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) if (at(x, y, z)) cells.set(at(x, y, z), (cells.get(at(x, y, z)) ?? 0) + 1);
    expect(at(16, 2, 4)).toBe(surface);
    expect(surface).not.toBe(STYLES[style].roof);
    expect(Math.max(...cells.values())).toBe(cells.get(surface));
  });
});
