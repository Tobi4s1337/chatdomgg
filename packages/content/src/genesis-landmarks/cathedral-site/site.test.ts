import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { meshCost, unsupported, voxels } from '../../places/water/piece-checks';
import { MAT, type StyleKey } from '../../materials';
import { crestGrid } from '../heraldry';
import { LANDMARK_KITS, landmarkPalette } from '../kit';
import type { CellBox } from '../types';
import {
  CATHEDRAL_SETTING_OUT, CATHEDRAL_SITE, CATHEDRAL_SITE_AXIS, CATHEDRAL_SITE_SIZE, cathedralCornerStones, createCathedralSite,
  type CathedralSiteOptions,
} from './site';

const STYLES_ALL: readonly StyleKey[] = ['hearth', 'tide', 'grove'];
const FIELD = MAT.fabricViolet, BAND = MAT.slate;
const options = (style: StyleKey): CathedralSiteOptions => ({
  style, crest: { shape: 'round', charge: 'star' }, colours: { field: FIELD, band: BAND },
});
const pieces = STYLES_ALL.map(style => ({ style, piece: createCathedralSite(options(style)), kit: LANDMARK_KITS[style] }));
const site = pieces[0]!.piece, kit = LANDMARK_KITS.hearth;
const grid = voxels(site.blueprint);
const { cord: CORD, pole: POLE, top: TOP } = CATHEDRAL_SITE;

function cells(box: CellBox, at = grid.at, size = grid.size): { solid: number; air: number; total: number } {
  let solid = 0, total = 0;
  for (let x = Math.max(0, box.from[0]); x < Math.min(size[0], box.to[0]); x++) {
    for (let y = Math.max(0, box.from[1]); y < Math.min(size[1], box.to[1]); y++) {
      for (let z = Math.max(0, box.from[2]); z < Math.min(size[2], box.to[2]); z++) { total++; if (at(x, y, z)) solid++; }
    }
  }
  return { solid, air: total - solid, total };
}

describe('cathedral site blueprint', () => {
  it('is a strict, deterministic civic blueprint in every kit', () => {
    for (const { style, piece } of pieces) {
      expect(() => VoxelBlueprintSchema.parse(piece.blueprint)).not.toThrow();
      expect(JSON.stringify(createCathedralSite(options(style)))).toBe(JSON.stringify(piece));
      expect(piece.blueprint.id).toBe(`genesis-cathedral-site-${style}-round-star-${FIELD}-${BAND}`);
      expect(piece.blueprint.kind).toBe('civic');
      expect(piece.blueprint.styleId).toBe(style);
      expect(piece.blueprint.size).toEqual([...CATHEDRAL_SITE_SIZE]);
      expect(piece.blueprint.windows).toEqual([]);
      expect(piece.parts).toEqual([]);
      expect(piece.glazing).toBeUndefined();
      expect(piece.water).toBeUndefined();
    }
    expect(new Set(pieces.map(p => p.piece.blueprint.id)).size).toBe(pieces.length);
    const ids = new Set([
      site.blueprint.id,
      createCathedralSite({ ...options('hearth'), crest: { shape: 'heater', charge: 'star' } }).blueprint.id,
      createCathedralSite({ ...options('hearth'), crest: { shape: 'round', charge: 'mountain' } }).blueprint.id,
      createCathedralSite({ ...options('hearth'), colours: { field: MAT.fabricRed, band: BAND } }).blueprint.id,
      createCathedralSite({ ...options('hearth'), colours: { field: FIELD, band: MAT.cream } }).blueprint.id,
    ]);
    expect(ids.size).toBe(5);
  });

  it('refuses an unknown kit', () => {
    expect(() => createCathedralSite({ ...options('hearth'), style: 'stone' as StyleKey })).toThrow(/style/);
  });

  it('uses only its kit palette, and every occupied cell is held up from the ground', () => {
    for (const { style, piece } of pieces) {
      const allowed = landmarkPalette(style);
      for (const box of piece.blueprint.boxes) expect(allowed.has(box.material), `${piece.blueprint.id} material ${box.material}`).toBe(true);
      expect(unsupported(piece.blueprint), piece.blueprint.id).toBe(0);
    }
  });

  it('fits the lane budgets on the production rasterizer and mesher', () => {
    for (const { piece } of pieces) {
      const cost = meshCost(piece.blueprint);
      expect(piece.blueprint.boxes.length).toBeLessThanOrEqual(2000);
      expect(cost.occupied).toBeLessThanOrEqual(200_000);
      expect(cost.triangles).toBeLessThanOrEqual(60_000);
      expect(cost.triangles).toBeGreaterThan(2_000);
    }
  }, 120_000);

  it('reports occupied bounds that match the rasterized cells, from the ground to the poles\' tips', () => {
    for (const { piece } of pieces) {
      const own = piece === site ? grid : voxels(piece.blueprint);
      const { from, to } = piece.extent;
      expect(from[1]).toBe(0);
      expect(to[1]).toBe(TOP);
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let x = 0; x < own.size[0]; x++) for (let y = 0; y < own.size[1]; y++) for (let z = 0; z < own.size[2]; z++) {
        if (!own.at(x, y, z)) continue;
        min = min.map((v, d) => Math.min(v, [x, y, z][d]!)); max = max.map((v, d) => Math.max(v, [x, y, z][d]! + 1));
      }
      expect(min).toEqual([...from]);
      expect(max).toEqual([...to]);
    }
  });
});

describe('cathedral site setting-out', () => {
  const { pegs, cords } = CATHEDRAL_SETTING_OUT;
  const poles = pegs.filter(p => p.pole);

  it('stands every peg and pole on the ground, inside the reserve, with a pale head or a bright tip', () => {
    expect(new Set(pegs.map(p => `${p.x},${p.z}`)).size).toBe(pegs.length);
    expect(pegs.length).toBeGreaterThan(40);
    for (const { x, z, pole } of pegs) {
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) expect(grid.at(x + dx, 0, z + dz), `peg ${x},${z}`).toBe(kit.trim);
      expect(x - 1).toBeGreaterThanOrEqual(0);
      expect(z - 1).toBeGreaterThanOrEqual(0);
      if (pole) {
        expect(grid.at(x - 1, POLE.top - 1, z - 1)).toBe(kit.trim);
        expect(grid.at(x - 1, POLE.top, z - 1)).toBe(kit.metal);
        expect(grid.at(x - 1, TOP, z - 1)).toBe(0);
      } else {
        let y = 0;
        while (grid.at(x - 1, y, z - 1) === kit.trim) y++;
        expect(y, `peg ${x},${z}`).toBeGreaterThan(CORD);
        expect(grid.at(x - 1, y, z - 1)).toBe(kit.band);
        expect(grid.at(x - 1, y + 1, z - 1)).toBe(0);
      }
    }
    // The plan is symmetric about the axis.
    const keys = new Set(pegs.map(p => `${p.x},${p.z},${p.pole}`));
    for (const p of pegs) expect(keys.has(`${CATHEDRAL_SITE_SIZE[0] - p.x},${p.z},${p.pole}`)).toBe(true);
  });

  it('marks the cross\'s outer corners, the apse springings and the apse\'s east point with ranging poles', () => {
    const { nave, transepts, apse } = CATHEDRAL_SITE;
    const expected = [
      [nave.x[0], nave.z[1]], [nave.x[1], nave.z[1]], [transepts.x[0], transepts.z[0]], [transepts.x[0], transepts.z[1]],
      [transepts.x[1], transepts.z[0]], [transepts.x[1], transepts.z[1]], [nave.x[0], apse.z], [nave.x[1], apse.z], [apse.x, apse.z - apse.radius],
    ].map(([x, z]) => `${x},${z}`).sort();
    expect(poles.map(p => `${p.x},${p.z}`).sort()).toEqual(expected);
    // The apse is set out by pegs on its arc, all at its radius.
    const arc = pegs.filter(p => p.z < apse.z);
    expect(arc.length).toBe(apse.chords - 1);
    for (const p of arc) expect(Math.abs(Math.hypot(p.x - apse.x, p.z - apse.z) - apse.radius)).toBeLessThan(1);
  });

  it('runs one taut cord at its height between consecutive pegs along the nave', () => {
    const { nave, transepts } = CATHEDRAL_SITE;
    for (const [px, cx] of [[nave.x[1], nave.x[1]], [nave.x[0], nave.x[0] - 1]] as const) {
      const run = pegs.filter(p => p.x === px && p.z >= transepts.z[1] && p.z <= nave.z[1]).map(p => p.z).sort((a, b) => a - b);
      expect(run.length).toBeGreaterThan(4);
      for (let i = 0; i + 1 < run.length; i++) {
        for (let z = run[i]! - 1; z < run[i + 1]! + 1; z++) {
          const want = z > run[i]! && z < run[i + 1]! - 1 ? kit.cord : kit.trim;
          expect(grid.at(cx, CORD, z), `cord at ${cx},${z}`).toBe(want);
        }
        // Nothing hangs under or over the cord between the pegs.
        for (let z = run[i]! + 1; z < run[i + 1]! - 1; z++) {
          for (const y of [CORD - 1, CORD + 1]) expect(grid.at(cx, y, z)).toBe(0);
        }
      }
    }
    // Every cord cell is cord, or a peg's own timber where a chord starts inside it, and all at the one height.
    for (const c of cords) {
      expect(c.from[1]).toBe(CORD);
      for (let x = c.from[0]; x < c.to[0]; x++) for (let z = c.from[2]; z < c.to[2]; z++) {
        expect([kit.cord, kit.trim]).toContain(grid.at(x, CORD, z));
      }
    }
    // The west front's cord stops at the door-jamb pegs: the door's gap is open.
    const { door } = CATHEDRAL_SITE;
    for (let x = door.x[0] + 1; x < door.x[1] - 1; x++) expect(grid.at(x, CORD, nave.z[1])).not.toBe(kit.cord);
  });

  it('flies a pennant of field and band from each ranging pole, touching it, all downwind', () => {
    const { pennant } = POLE, middle = (pennant.rows.length - 1) / 2;
    expect(poles.length).toBe(9);
    for (const { x, z } of poles) {
      pennant.rows.forEach((length, i) => {
        const y = pennant.top - 1 - i, want = i === middle ? BAND : FIELD;
        expect(grid.at(x, y, z - 1)).toBe(kit.trim);
        for (let k = 0; k < length; k++) expect(grid.at(x + 1 + k, y, z - 1), `pennant ${x},${z} row ${i}`).toBe(want);
        expect(grid.at(x + 1 + length, y, z - 1)).toBe(0);
      });
    }
  });

  it('marks the crossing with a flat octagonal stone and its pin', () => {
    const { x, z, half, inner } = CATHEDRAL_SITE.crossing;
    expect(grid.at(x - half, 0, z)).toBe(kit.base);
    expect(grid.at(x - inner, 1, z + 3)).toBe(kit.band);
    expect(grid.at(x - 1, 1, z - 1)).toBe(kit.metal);
    // Corners are cut on the diagonal, and it lies flat.
    expect(grid.at(x - half, 0, z - half)).toBe(0);
    expect(cells({ from: [x - half, 2, z - half], to: [x + half, 48, z + half] }).solid).toBe(0);
    expect(cells({ from: [x - half, 0, z - half], to: [x + half, 1, z + half] }).solid).toBeGreaterThan(300);
    expect(x).toBe(CATHEDRAL_SITE_AXIS.x);
    expect(z).toBe((CATHEDRAL_SITE.transepts.z[0] + CATHEDRAL_SITE.transepts.z[1]) / 2);
  });

  it('holds the reserve\'s four corners with pale boundary stones on their footings', () => {
    const stones = cathedralCornerStones(), { size, top, embed } = CATHEDRAL_SITE.corners;
    expect(site.footings.map(f => f.id)).toEqual(['corner-nw', 'corner-ne', 'corner-sw', 'corner-se', 'foundation-stone', 'setting-out']);
    const corners = [[0, 0], [192, 0], [0, 256], [192, 256]];
    stones.forEach(({ id, x, z }, i) => {
      const footing = site.footings.find(f => f.id === id)!;
      expect(footing.embed).toBe(embed);
      expect(cells({ from: footing.box.from, to: [footing.box.to[0], 1, footing.box.to[2]] }).air).toBe(0);
      const [X, Z] = corners[i]!;
      expect(Math.abs(x + size / 2 - X!)).toBeLessThan(12);
      expect(Math.abs(z + size / 2 - Z!)).toBeLessThan(12);
      expect(grid.at(x + 1, 3, z + 1)).toBe(kit.band);
      expect(grid.at(x - 1, 5, z + 1)).toBe(kit.iron);
      expect(grid.at(x + size / 2 - 1, top - 1, z + size / 2 - 1)).toBe(kit.metal);
      expect(grid.at(x + size / 2, top, z + size / 2)).toBe(0);
    });
    const setting = site.footings.find(f => f.id === 'setting-out')!;
    expect(setting.box).toEqual({ from: [0, 0, 0], to: [192, 1, 256] });
    expect(setting.embed).toBe(0);
  });
});

describe('cathedral site foundation stone', () => {
  it('sets the foundation stone on its plinth across the west door\'s line', () => {
    const { steps, stone, cap } = CATHEDRAL_SITE.foundation, footing = site.footings.find(f => f.id === 'foundation-stone')!;
    expect(footing.embed).toBe(0);
    expect(cells({ from: footing.box.from, to: [footing.box.to[0], 1, footing.box.to[2]] }).air).toBe(0);
    for (const [x0, x1, top, z0, z1] of steps) {
      expect(cells({ from: [x0, 0, z0], to: [x1, top, z1] }).air).toBe(0);
      expect(grid.at(x0, top - 1, z1 - 1)).toBe(kit.band);
    }
    expect(cells({ from: [stone.x[0], stone.y[0], stone.z[0]], to: [stone.x[1], stone.y[1], stone.z[1] - 1] }).air).toBe(0);
    expect(grid.at(stone.x[0], stone.y[0] + 4, stone.z[0])).toBe(kit.stone);
    expect(grid.at(stone.x[0] - 1, cap - 2, stone.z[0])).toBe(kit.band);
    expect(grid.at(stone.x[0], cap - 1, stone.z[0])).toBe(kit.band);
    expect(cells({ from: [stone.x[0] - 1, cap, stone.z[0] - 1], to: [stone.x[1] + 1, 48, stone.z[1] + 1] }).solid).toBe(0);
    expect((stone.x[0] + stone.x[1]) / 2).toBe(CATHEDRAL_SITE_AXIS.x);
    expect(stone.z[0]).toBeLessThan(CATHEDRAL_SITE.nave.z[1]);
    expect(stone.z[1]).toBeGreaterThan(CATHEDRAL_SITE.nave.z[1]);
  });

  it('carries the crest on the stone\'s face with its field flush and its charge proud', () => {
    for (const { piece, kit: own } of pieces) {
      const at = piece === site ? grid.at : voxels(piece.blueprint).at;
      const { x, y, face } = CATHEDRAL_SITE.crest, rows = crestGrid('round', 'star');
      let charge = 0;
      expect(face + 1).toBe(CATHEDRAL_SITE.foundation.stone.z[1]);
      rows.forEach((row, i) => [...row].forEach((mark, c) => {
        const yy = y + rows.length - 1 - i;
        if (mark === '.') return;
        expect(at(x + c, yy, face)).toBe(FIELD);
        if (mark === 'C') { charge++; expect(at(x + c, yy, face + 1)).toBe(own.charge); }
        if (mark === 'B') expect(at(x + c, yy, face + 1)).toBe(own.metal);
        if (mark === 'F') expect(at(x + c, yy, face + 1)).toBe(0);
      }));
      expect(charge).toBeGreaterThan(8);
      // The pale frame stands proud round it.
      expect(at(x - 2, y + 8, face + 1)).toBe(own.band);
      expect(at(x - 1, y + 8, face + 1)).toBe(0);
    }
  });

  it('hangs one caged lantern on its post beside the stone, its emitter on real glass', () => {
    expect(site.emitters).toHaveLength(1);
    const [lamp] = site.emitters, { post, glass, size } = CATHEDRAL_SITE.lantern;
    expect(lamp).toMatchObject({ id: 'site-lantern', kind: 'lantern', reach: 40 });
    expect(grid.at(...(lamp!.position.map(Math.floor) as [number, number, number]))).toBe(MAT.glass);
    expect(cells({ from: [glass.x - 1, glass.y, glass.z - 1], to: [glass.x + 2, glass.y + size, glass.z + 2] }).solid).toBe(45);
    for (let x = glass.x - 1; x < glass.x + 2; x++) for (let y = glass.y; y < glass.y + size; y++) expect(grid.at(x, y, glass.z)).toBe(MAT.glass);
    expect(grid.at(glass.x - 2, glass.y, glass.z - 2)).toBe(kit.iron);
    expect(grid.at(glass.x, glass.y + size, glass.z)).toBe(kit.metal);
    expect(cells({ from: [post.x[0], 0, post.z[0]], to: [post.x[1], post.top, post.z[1]] }).air).toBe(0);
    // The bracket arm reaches from the hanger to the post's face.
    const arm = glass.y + size + 4;
    for (let x = glass.x; x <= post.x[0]; x++) expect(grid.at(x, arm, glass.z)).not.toBe(0);
    // The lantern hangs free, clear of the plinth and of the ground.
    expect(cells({ from: [glass.x - 2, 0, glass.z - 2], to: [glass.x + 3, glass.y - 1, glass.z + 3] }).solid).toBe(0);
  });

  it('offers the lower step as a free seat facing the plaza', () => {
    expect(site.seats).toHaveLength(1);
    const seat = site.seats[0]!;
    expect(seat.id).toBe('foundation-step');
    expect(seat.facing).toBe('south');
    expect(cells(seat.box).air).toBe(0);
    expect(cells({ from: [seat.box.from[0], seat.box.to[1], seat.box.from[2]], to: [seat.box.to[0], seat.box.to[1] + 10, seat.box.to[2]] }).solid).toBe(0);
    expect(seat.box.from[1]).toBe(3);
    expect(seat.box.to[2] - seat.box.from[2]).toBeGreaterThanOrEqual(3);
  });
});

describe('cathedral site as a reserve', () => {
  it('keeps only setting-out materials in the reserve, and nothing above the tallest pole', () => {
    const reserve = site.clear.find(c => c.role === 'reserve')!;
    expect(site.clear).toEqual([{ id: 'reserve', role: 'reserve', box: { from: [0, 0, 0], to: [192, 48, 256] } }]);
    for (const { piece, kit: own } of pieces) {
      const at = piece === site ? grid.at : voxels(piece.blueprint).at;
      const settingOut = new Set([own.trim, own.cord, own.band, own.base, own.stone, own.iron, own.metal, own.charge, MAT.glass, MAT.earth, MAT.moss, FIELD, BAND]);
      const found = new Set<number>();
      let above = 0;
      for (let x = reserve.box.from[0]; x < reserve.box.to[0]; x++) for (let y = reserve.box.from[1]; y < reserve.box.to[1]; y++) for (let z = reserve.box.from[2]; z < reserve.box.to[2]; z++) {
        const m = at(x, y, z);
        if (!m) continue;
        found.add(m);
        if (y >= TOP) above++;
      }
      for (const m of found) expect(settingOut.has(m), `${piece.blueprint.id} material ${m}`).toBe(true);
      expect(above).toBe(0);
    }
    // Hearth's walls and roof are distinct from its setting-out: neither appears.
    expect(site.blueprint.boxes.some(b => b.material === kit.wall || b.material === kit.roof)).toBe(false);
  });

  it('draws nothing as a wall: only poles, pennants, the stone and the lantern rise above knee height', () => {
    const tall = new Set<string>();
    for (let x = 0; x < grid.size[0]; x++) for (let z = 0; z < grid.size[2]; z++) {
      for (let y = CATHEDRAL_SITE.corners.top + 1; y < grid.size[1]; y++) if (grid.at(x, y, z)) { tall.add(`${x},${z}`); break; }
    }
    const { stone } = CATHEDRAL_SITE.foundation, { post, glass } = CATHEDRAL_SITE.lantern, longest = Math.max(...POLE.pennant.rows);
    const allowed = (x: number, z: number): boolean =>
      CATHEDRAL_SETTING_OUT.pegs.some(p => p.pole && x >= p.x - 1 && x < p.x + 1 + longest && z >= p.z - 1 && z < p.z + 1)
      || (x >= stone.x[0] - 1 && x < stone.x[1] + 1 && z >= stone.z[0] - 1 && z < stone.z[1] + 1)
      || (x >= glass.x - 2 && x < post.x[1] && z >= glass.z - 2 && z < glass.z + 3);
    for (const key of tall) {
      const [x, z] = key.split(',').map(Number) as [number, number];
      expect(allowed(x, z), `tall column at ${key}`).toBe(true);
    }
    // The nave's floor, away from the crossing, the foundation plinth and the outline, is open air to the sky.
    const { nave, crossing, foundation } = CATHEDRAL_SITE;
    let sampled = 0;
    for (let x = nave.x[0] + 6; x < nave.x[1] - 6; x += 6) for (let z = nave.z[0] + 6; z < foundation.steps[0][3] - 2; z += 6) {
      if (Math.abs(x - crossing.x) <= crossing.half && Math.abs(z - crossing.z) <= crossing.half) continue;
      sampled++;
      for (let y = 0; y < 48; y++) expect(grid.at(x, y, z), `nave at ${x},${y},${z}`).toBe(0);
    }
    expect(sampled).toBeGreaterThan(200);
  });

  it('describes its interactions for the host instead of performing them', () => {
    for (const { piece } of pieces) {
      expect(piece.doorways).toEqual([]);
      expect(piece.walks).toEqual([]);
      expect(piece.mounts).toEqual([]);
      expect(piece.parts).toEqual([]);
      expect(piece.sounds).toEqual([{ id: 'wind', kind: 'wind', position: [96, 24, 128] }]);
      const anchors = new Set([...piece.doorways, ...piece.walks, ...piece.seats, ...piece.emitters, ...piece.clear, ...piece.mounts].map(a => a.id));
      expect(piece.affordances.map(a => a.kind)).toEqual(['raise-cathedral', 'sit']);
      for (const affordance of piece.affordances) {
        expect(affordance.status).toBe('needs-host');
        expect(affordance.uses.length).toBeGreaterThan(0);
        for (const id of affordance.uses) expect(anchors.has(id), `${affordance.id} uses ${id}`).toBe(true);
      }
      expect(piece.affordances[0]!.uses).toEqual(['reserve']);
    }
  });
});
