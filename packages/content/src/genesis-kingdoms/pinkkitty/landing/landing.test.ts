import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS } from '../../../materials';
import { composePlainGlass, type EmoteGlass } from '../../../genesis-emotes/glass';
import { EMOTE_ART_KITS } from '../../../genesis-emotes/kit';
import { GLASS_SCREEN, HALL_LANDING, createGlassScreen, createHallLanding } from './index';

/** The blueprint executed into a dense grid, boxes in order, material zero carving. */
function voxels(blueprint: VoxelBlueprint) {
  const [sx, sy, sz] = blueprint.size, cells = new Uint16Array(sx * sy * sz);
  for (const { from, to, material } of blueprint.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) cells.fill(material, from[0] + sx * (y + sy * z), to[0] + sx * (y + sy * z));
  }
  const at = (x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? MAT.air : cells[x + sx * (y + sy * z)]!);
  return { cells, at, size: [sx, sy, sz] as const };
}

/** Occupied cells that no chain of face neighbours joins to a solid cell in the bottom layer. */
function floating(blueprint: VoxelBlueprint): number {
  const { cells, size: [sx, sy, sz] } = voxels(blueprint);
  const seen = new Uint8Array(cells.length), stack: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = x + sx * sy * z;
    if (cells[i]) { seen[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
      const j = nx + sx * (ny + sy * nz);
      if (cells[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  let loose = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] && !seen[i]) loose++;
  return loose;
}

/** Height of the walking surface over a column: one above its highest solid cell. */
function surface(at: (x: number, y: number, z: number) => number, x: number, z: number, height: number): number {
  for (let y = height - 1; y >= 0; y--) if (at(x, y, z)) return y + 1;
  return 0;
}

const registered = new Set(MATERIALS.materials.map(m => m.id));
const RISES = [16, 20, 24, 32, 40, 44, 48];
const WIDTHS = [96, 80, 120];

describe('PinkKittyRose hall landing', () => {
  const cases = RISES.flatMap(rise => WIDTHS.map(width => ({ rise, width, landing: createHallLanding({ riseCells: rise, widthCells: width }) })));

  it('is a strict, deterministic Hearth civic blueprint within budget for every rise and width', () => {
    for (const { rise, width, landing } of cases) {
      const { blueprint } = landing;
      expect(() => VoxelBlueprintSchema.parse(blueprint)).not.toThrow();
      expect(blueprint.id).toBe(`genesis-pinkkitty-landing-r${rise}-w${width}`);
      expect(blueprint.kind).toBe('civic');
      expect(blueprint.styleId).toBe('hearth');
      expect(blueprint.lattice).toBe('build');
      expect(blueprint.windows).toEqual([]);
      expect(blueprint.boxes.length, blueprint.id).toBeLessThanOrEqual(2000);
      expect(blueprint.size).toEqual([...landing.size]);
      expect(blueprint.size[2]).toBe(width);
      expect(Math.max(...blueprint.size)).toBeLessThanOrEqual(256);
      for (const box of blueprint.boxes) expect(registered.has(box.material)).toBe(true);
      expect(JSON.stringify(createHallLanding({ riseCells: rise, widthCells: width }))).toBe(JSON.stringify(landing));
    }
    expect(new Set(cases.map(c => c.landing.blueprint.id)).size).toBe(cases.length);
    expect(createHallLanding({ riseCells: 40 }).blueprint.id).toBe('genesis-pinkkitty-landing-r40-w96');
  });

  it('refuses rises and widths it was not drawn for', () => {
    for (const riseCells of [14, 50, 33, 40.5]) expect(() => createHallLanding({ riseCells })).toThrow(/riseCells/);
    for (const widthCells of [78, 202, 97]) expect(() => createHallLanding({ riseCells: 40, widthCells })).toThrow(/widthCells/);
  });

  it('runs the platform 40 cells and ends the flight at 40 + steps × floor(60 / steps)', () => {
    for (const { rise, landing } of cases) {
      const steps = rise / 2;
      expect(landing.platformCells).toBe(40);
      expect(landing.flightCells).toBe(steps * Math.floor(60 / steps));
    }
    expect(createHallLanding({ riseCells: 40 }).flightCells).toBe(60);
  });

  it('keeps the hall’s first 28 cells a flat paved top at the bank with headroom over the door zone', () => {
    for (const { rise, width, landing } of cases) {
      const { at } = voxels(landing.blueprint), top = HALL_LANDING.market + rise, mid = width / 2;
      let bare = 0, blocked = 0;
      for (let x = 0; x < HALL_LANDING.hallSteps; x++) for (let z = mid - 24; z < mid + 24; z++) {
        if (!at(x, top - 1, z)) bare++;
        for (let y = top; y < top + HALL_LANDING.clearHeight; y++) if (at(x, y, z)) blocked++;
      }
      expect({ id: landing.blueprint.id, bare, blocked }).toEqual({ id: landing.blueprint.id, bare: 0, blocked: 0 });
    }
  });

  it('descends from the bank to the market in two-cell risers along the centre line', () => {
    for (const { rise, width, landing } of cases) {
      const { at, size } = voxels(landing.blueprint), mid = width / 2, top = HALL_LANDING.market + rise;
      const end = landing.platformCells + landing.flightCells, tread = landing.flightCells / (rise / 2);
      let last = surface(at, 0, mid, size[1]), drops = 0;
      expect(last).toBe(top);
      for (let x = 1; x < size[0]; x++) {
        const h = surface(at, x, mid, size[1]);
        if (h !== last) { expect(last - h, `${landing.blueprint.id} at x=${x}`).toBe(2); drops++; }
        last = h;
      }
      expect(drops).toBe(rise / 2);
      // The lowest tread lies flush with the market, and the flight begins at the platform's edge.
      expect(surface(at, end - 1, mid, size[1])).toBe(HALL_LANDING.market);
      expect(surface(at, end - tread - 1, mid, size[1])).toBe(HALL_LANDING.market + 2);
      expect(surface(at, landing.platformCells - 1, mid, size[1])).toBe(top);
      expect(surface(at, landing.platformCells, mid, size[1])).toBe(top - 2);
    }
  });

  it('is solid masonry from y = 0 up under every walking surface', () => {
    for (const { width, landing } of cases) {
      const { at, size } = voxels(landing.blueprint), end = landing.platformCells + landing.flightCells, hollow: number[][] = [];
      for (let x = 0; x < end; x++) for (let z = HALL_LANDING.terrace; z < width - HALL_LANDING.terrace; z++) {
        const h = surface(at, x, z, size[1]);
        for (let y = 0; y < h; y++) if (!at(x, y, z)) hollow.push([x, y, z]);
      }
      expect(hollow.slice(0, 5), landing.blueprint.id).toEqual([]);
    }
  });

  it('sets four fire baskets with air at each flame base and embers under it', () => {
    for (const { width, landing } of cases) {
      const { at } = voxels(landing.blueprint), end = landing.platformCells + landing.flightCells, mid = width / 2;
      expect(landing.fires.length).toBe(4);
      for (const [x, y, z] of landing.fires) {
        expect(at(Math.floor(x), Math.floor(y), Math.floor(z)), `${landing.blueprint.id} flame ${x},${y},${z}`).toBe(MAT.air);
        expect(at(Math.floor(x), Math.floor(y) - 1, Math.floor(z)), `${landing.blueprint.id} embers ${x},${y},${z}`).not.toBe(MAT.air);
        // Clear of the door zone: either beside the stair head outside the flight, or at the foot.
        expect(Math.abs(z - mid) >= 24 || x >= end - HALL_LANDING.pier).toBe(true);
        expect(x).toBeGreaterThanOrEqual(HALL_LANDING.hallSteps);
      }
    }
  });

  it('joins every occupied cell to the ground through face neighbours', () => {
    for (const { landing } of cases) expect(floating(landing.blueprint), landing.blueprint.id).toBe(0);
  });
});

/** A wider, taller unit than the plain lancet, with an arched head and empty spandrels, for the screen's generality. */
function syntheticGlass(): EmoteGlass {
  const w = 44, h = 70, boxes: VoxelBlueprint['boxes'] = [];
  for (let y = 0; y < h; y++) {
    const inset = y < h - 16 ? 0 : Math.ceil(((y - (h - 16)) ** 2) / 12);
    if (2 * inset >= w) break;
    boxes.push({ from: [inset, y, 0], to: [w - inset, y + 1, 6], material: MAT.limestone });
    if (inset + 4 < w - inset - 4 && y >= 4 && y < h - 6) boxes.push({ from: [inset + 4, y, 0], to: [w - inset - 4, y + 1, 6], material: MAT.air }, { from: [inset + 4, y, 3], to: [w - inset - 4, y + 1, 4], material: MAT.glass });
  }
  boxes.push({ from: [1, 2, 0], to: [w - 1, 3, 7], material: MAT.cream });
  const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: 'genesis-emote-glass-hearth-testunit', styleId: 'hearth', kind: 'civic', lattice: 'build', size: [w, h, 7], boxes, windows: [] });
  return { kind: 'plain', blueprint, light: { origin: [4, 4, 4], width: w - 8, height: h - 10, facing: 'south', texels: [] }, opening: [w, h], emote: null };
}

describe('PinkKittyRose glass screen', () => {
  const glasses = [composePlainGlass(EMOTE_ART_KITS.hearth), composePlainGlass(EMOTE_ART_KITS.tide), syntheticGlass()];
  const screens = glasses.map(glass => ({ glass, screen: createGlassScreen(glass) }));

  it('is a strict, deterministic Hearth civic blueprint within budget, its id carrying the glass id', () => {
    for (const { glass, screen } of screens) {
      expect(() => VoxelBlueprintSchema.parse(screen.blueprint)).not.toThrow();
      expect(screen.blueprint.id).toContain(glass.blueprint.id);
      expect(screen.blueprint.kind).toBe('civic');
      expect(screen.blueprint.styleId).toBe('hearth');
      expect(screen.blueprint.windows).toEqual([]);
      expect(screen.blueprint.boxes.length, screen.blueprint.id).toBeLessThanOrEqual(1500);
      expect(screen.blueprint.size).toEqual([...screen.size]);
      expect(Math.max(...screen.size)).toBeLessThanOrEqual(256);
      for (const box of screen.blueprint.boxes) expect(registered.has(box.material)).toBe(true);
      expect(JSON.stringify(createGlassScreen(glass))).toBe(JSON.stringify(screen));
    }
    expect(new Set(screens.map(s => s.screen.blueprint.id)).size).toBe(screens.length);
  });

  it('cuts an opening that fits the unit exactly: every unit cell is air, nothing gapes, the frame face is flush', () => {
    for (const { glass, screen } of screens) {
      const wall = voxels(screen.blueprint), unit = voxels(glass.blueprint), [ox, oy, oz] = screen.glassOffset;
      const [OW, OH] = glass.opening, [UW, UH, UD] = glass.blueprint.size;
      expect([UW, UH]).toEqual([OW, OH]);
      // The unit sits wholly inside the screen's bounds and shares no cell with it.
      for (let d = 0; d < 3; d++) {
        expect(screen.glassOffset[d]).toBeGreaterThanOrEqual(0);
        expect(screen.glassOffset[d]! + glass.blueprint.size[d]!).toBeLessThanOrEqual(screen.size[d]!);
      }
      let collisions = 0, gaps = 0, ux0 = Infinity, ux1 = -Infinity, uy0 = Infinity, uy1 = -Infinity;
      for (let z = 0; z < UD; z++) for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {
        if (!unit.at(x, y, z)) continue;
        if (wall.at(ox + x, oy + y, oz + z)) collisions++;
        if (z < GLASS_SCREEN.wall) { ux0 = Math.min(ux0, x); ux1 = Math.max(ux1, x + 1); uy0 = Math.min(uy0, y); uy1 = Math.max(uy1, y + 1); }
      }
      expect(collisions, screen.blueprint.id).toBe(0);
      // The cut lies within the opening and is exactly the unit's own footprint through the wall: [0, OW) × [0, OH)
      // bounds it, and the lancet's top row may be empty, so its height is the unit's occupied height.
      const W = GLASS_SCREEN.wall;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let y = oy - 4; y < oy + OH + 4; y++) for (let x = ox - 4; x < ox + OW + 4; x++) {
        let cut = false;
        for (let z = oz; z < oz + W; z++) if (!wall.at(x, y, z)) cut = true;
        if (cut) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
      }
      expect([x0 - ox, y0 - oy, x1 - ox, y1 - oy]).toEqual([ux0, uy0, ux1, uy1]);
      expect([ux0, uy0]).toEqual([0, 0]);
      expect(ux1).toBe(OW);
      expect(uy1).toBeLessThanOrEqual(OH);
      expect(uy1).toBeGreaterThanOrEqual(OH - 2);
      // Wall and unit together close the opening: every column meets stone or glass somewhere through the wall.
      for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
        let closed = false;
        for (let z = 0; z < W && !closed; z++) closed = !!(unit.at(x, y, z) || wall.at(ox + x, oy + y, oz + z));
        if (!closed) gaps++;
      }
      expect(gaps, screen.blueprint.id).toBe(0);
      // The wall is six cells thick, its back flush with the unit's z = 0 and its front with the frame face at z = 6.
      const jx = ox - 1, jy = oy + Math.floor(OH / 2);
      expect(wall.at(jx, jy, oz)).not.toBe(MAT.air);
      expect(wall.at(jx, jy, oz - 1)).toBe(MAT.air);
      expect(wall.at(jx, jy, oz + W - 1)).not.toBe(MAT.air);
      expect(wall.at(jx, jy, oz + W)).toBe(MAT.air);
    }
  });

  it('hangs its lamp basket behind the glass, air at the flame base with embers under it', () => {
    for (const { glass, screen } of screens) {
      const { at } = voxels(screen.blueprint), [ox, oy, oz] = screen.glassOffset, [OW, OH] = glass.opening;
      expect(screen.fires.length).toBe(1);
      const [x, y, z] = screen.fires[0]! as Vec3;
      expect(at(Math.floor(x), Math.floor(y), Math.floor(z))).toBe(MAT.air);
      expect(at(Math.floor(x), Math.floor(y) - 1, Math.floor(z))).not.toBe(MAT.air);
      expect(z).toBeLessThan(oz);
      expect(x).toBeGreaterThan(ox);
      expect(x).toBeLessThan(ox + OW);
      expect(y).toBeGreaterThan(oy + 4);
      expect(y).toBeLessThan(oy + OH / 2);
    }
  });

  it('gives citizens a step to sit on in front of the window', () => {
    for (const { glass, screen } of screens) {
      const { at, size } = voxels(screen.blueprint), [ox, , oz] = screen.glassOffset, mid = ox + Math.floor(glass.opening[0] / 2);
      const seat = surface(at, mid, size[2] - 2, size[1]);
      expect(seat).toBe(4);
      for (let y = seat; y < seat + 16; y++) expect(at(mid, y, size[2] - 2)).toBe(MAT.air);
      expect(oz + GLASS_SCREEN.wall + GLASS_SCREEN.front).toBe(size[2]);
    }
  });

  it('joins every occupied cell to the ground through face neighbours', () => {
    for (const { screen } of screens) expect(floating(screen.blueprint), screen.blueprint.id).toBe(0);
  });
});
