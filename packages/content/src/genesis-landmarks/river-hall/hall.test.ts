import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type Vec3 } from '@chatdom/shared';
import { meshCost, unsupported, voxels } from '../../places/water/piece-checks';
import { MAT, type StyleKey } from '../../materials';
import { crestGrid } from '../heraldry';
import { LANDMARK_KITS, landmarkPalette } from '../kit';
import type { CellBox, LandmarkPiece } from '../types';
import { RIVER_HALL, RIVER_HALL_AXIS, RIVER_HALL_SIZE, createRiverHall, type RiverHallOptions } from './hall';

const STYLES_ALL: readonly StyleKey[] = ['hearth', 'tide', 'grove'];
const options = (style: StyleKey, wheel = false): RiverHallOptions => ({
  style, wheel, crest: { shape: 'round', charge: 'star' }, bannerCut: 'forked',
  colours: { field: MAT.fabricViolet, band: MAT.slate },
});
const pieces = STYLES_ALL.flatMap(style => [false, true].map(wheel => ({ style, wheel, piece: createRiverHall(options(style, wheel)) })));
const pick = (style: StyleKey, wheel: boolean): LandmarkPiece => pieces.find(p => p.style === style && p.wheel === wheel)!.piece;
const hall = pick('hearth', false), mill = pick('hearth', true);
const kit = LANDMARK_KITS.hearth;
const grid = voxels(hall.blueprint), millGrid = voxels(mill.blueprint);

function cells(box: CellBox, at = grid.at, size = grid.size): { solid: number; air: number; total: number } {
  let solid = 0, total = 0;
  for (let x = Math.max(0, box.from[0]); x < Math.min(size[0], box.to[0]); x++) {
    for (let y = Math.max(0, box.from[1]); y < Math.min(size[1], box.to[1]); y++) {
      for (let z = Math.max(0, box.from[2]); z < Math.min(size[2], box.to[2]); z++) { total++; if (at(x, y, z)) solid++; }
    }
  }
  return { solid, air: total - solid, total };
}

describe('river hall blueprint', () => {
  it('is a strict, deterministic civic blueprint in every kit, with and without the wheel', () => {
    for (const { style, wheel, piece } of pieces) {
      expect(() => VoxelBlueprintSchema.parse(piece.blueprint)).not.toThrow();
      expect(JSON.stringify(createRiverHall(options(style, wheel)))).toBe(JSON.stringify(piece));
      expect(piece.blueprint.kind).toBe('civic');
      expect(piece.blueprint.styleId).toBe(style);
      expect(piece.blueprint.size).toEqual([...RIVER_HALL_SIZE]);
      expect(piece.blueprint.windows).toEqual([]);
      for (const part of piece.parts) expect(() => VoxelBlueprintSchema.parse(part.blueprint)).not.toThrow();
      expect(piece.parts.map(p => p.id)).toEqual(wheel ? ['flag', 'wheel'] : ['flag']);
    }
    expect(new Set(pieces.map(p => p.piece.blueprint.id)).size).toBe(pieces.length);
    expect(createRiverHall({ ...options('hearth'), bannerCut: 'pennant' }).blueprint.id).not.toBe(hall.blueprint.id);
    expect(createRiverHall({ ...options('hearth'), crest: { shape: 'heater', charge: 'wave' } }).blueprint.id).not.toBe(hall.blueprint.id);
  });

  it('refuses unknown kits and an unspecified wheel', () => {
    expect(() => createRiverHall({ ...options('hearth'), style: 'stone' as StyleKey })).toThrow(/style/);
    expect(() => createRiverHall({ ...options('hearth'), wheel: undefined as unknown as boolean })).toThrow(/wheel/);
  });

  it('uses only its kit palette, and every occupied cell is held up from the river bed', () => {
    for (const { style, piece } of pieces) {
      const allowed = landmarkPalette(style);
      for (const blueprint of [piece.blueprint, ...piece.parts.map(p => p.blueprint)]) {
        for (const box of blueprint.boxes) expect(allowed.has(box.material), `${blueprint.id} material ${box.material}`).toBe(true);
      }
      expect(unsupported(piece.blueprint), piece.blueprint.id).toBe(0);
    }
  });

  it('fits the lane budgets on the production rasterizer and mesher', () => {
    for (const { piece } of pieces) {
      const cost = meshCost(piece.blueprint);
      expect(piece.blueprint.boxes.length).toBeLessThanOrEqual(2000);
      expect(cost.occupied).toBeLessThanOrEqual(1_000_000);
      expect(cost.triangles).toBeLessThanOrEqual(250_000);
      expect(cost.triangles).toBeGreaterThan(30_000);
      for (const part of piece.parts) expect(part.blueprint.boxes.length).toBeLessThanOrEqual(400);
    }
  }, 120_000);

  it('reports occupied bounds that match the rasterized cells, from the bed to the flagpole', () => {
    for (const [piece, own] of [[hall, grid], [mill, millGrid]] as const) {
      const { from, to } = piece.extent;
      expect(from[1]).toBe(0);
      expect(to[1]).toBe(RIVER_HALL.pole.y[1]);
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let x = 0; x < own.size[0]; x++) for (let y = 0; y < own.size[1]; y++) for (let z = 0; z < own.size[2]; z++) {
        if (!own.at(x, y, z)) continue;
        min = min.map((v, d) => Math.min(v, [x, y, z][d]!)); max = max.map((v, d) => Math.max(v, [x, y, z][d]! + 1));
      }
      expect(min).toEqual([...from]);
      expect(max).toEqual([...to]);
    }
    // The wheel's trestle reaches further downstream than the still hall's cutwaters.
    expect(mill.extent.to[0]).toBeGreaterThan(hall.extent.to[0]);
  });
});

describe('river hall over the water', () => {
  it('opens every arch from the bed to its soffit and keeps each waterway empty', () => {
    for (const arch of RIVER_HALL.arches) {
      const zc = (arch.z[0] + arch.z[1]) / 2;
      for (let x = RIVER_HALL.deck.x[0]; x < RIVER_HALL.deck.x[1]; x++) {
        for (let y = 0; y < RIVER_HALL.water + arch.radius - 1; y++) expect(grid.at(x, y, zc), `arch ${arch.id} at ${x},${y}`).toBe(0);
      }
      // The ring's voussoirs alternate pale and grey and the keystone stands proud of both faces.
      const ring = new Set<number>();
      for (let y = RIVER_HALL.water; y < RIVER_HALL.water + arch.radius; y++) ring.add(grid.at(RIVER_HALL.deck.x[0] - 1, y, arch.z[0] - 1));
      expect(ring.has(kit.band) && ring.has(kit.rock)).toBe(true);
      expect(grid.at(RIVER_HALL.deck.x[0] - 2, RIVER_HALL.water + arch.radius + 1, zc)).toBe(kit.band);
    }
    for (const piece of [hall, mill]) {
      const own = voxels(piece.blueprint);
      const waterways = piece.clear.filter(c => c.role === 'waterway');
      expect(waterways.map(w => w.id)).toEqual(RIVER_HALL.arches.map(a => a.id));
      for (const w of waterways) {
        expect(w.box.from[1]).toBe(0);
        expect(w.box.to[1]).toBeGreaterThan(RIVER_HALL.water + 8);
        expect(cells(w.box, own.at, own.size).solid, `${piece.blueprint.id} ${w.id}`).toBe(0);
      }
    }
  });

  it('stands its piers and abutments on the bed, the piers with pointed cutwaters', () => {
    const ids = hall.footings.map(f => f.id);
    expect(ids).toEqual(['far-abutment', 'near-abutment', 'pier-1', 'pier-2']);
    expect(mill.footings.map(f => f.id)).toEqual([...ids, 'trestle-1', 'trestle-2']);
    for (const footing of mill.footings) {
      const bottom = cells({ from: footing.box.from, to: [footing.box.to[0], 1, footing.box.to[2]] }, millGrid.at, millGrid.size);
      expect(bottom.solid, footing.id).toBeGreaterThan(0);
      if (footing.id.endsWith('abutment')) { expect(bottom.air).toBe(0); expect(footing.embed).toBe(RIVER_HALL.bank); }
      else expect(footing.embed).toBe(RIVER_HALL.water);
    }
    for (const [p0, p1] of RIVER_HALL.piers) {
      const pc = (p0 + p1) / 2;
      // The nose narrows to a point both upstream and downstream.
      const width = (x: number) => Array.from({ length: p1 - p0 }, (_, i) => grid.at(x, 2, p0 + i)).filter(Boolean).length;
      expect(width(RIVER_HALL.deck.x[0] - 1)).toBe(p1 - p0);
      expect(width(RIVER_HALL.deck.x[0] - RIVER_HALL.cutwater + 1)).toBeLessThan(4);
      expect(width(RIVER_HALL.deck.x[1] + RIVER_HALL.cutwater - 2)).toBeLessThan(4);
      expect(grid.at(RIVER_HALL_AXIS.x, 0, pc)).not.toBe(0);
    }
  });

  it('describes the river it spans for the host', () => {
    expect(hall.water).toEqual({ level: RIVER_HALL.water, bank: RIVER_HALL.bank, channel: { from: [28, 0, 52], to: [84, 14, 180] } });
    const river = hall.sounds.find(s => s.kind === 'river')!;
    expect(river.position[1]).toBe(RIVER_HALL.water);
    // Both banks are paved at bank height in front of their pavilions.
    expect(grid.at(RIVER_HALL_AXIS.x, RIVER_HALL.bank - 1, 2)).not.toBe(0);
    expect(grid.at(RIVER_HALL_AXIS.x, RIVER_HALL.bank, 2)).toBe(0);
    expect(grid.at(30, RIVER_HALL.bank - 1, 250)).not.toBe(0);
  });
});

describe('river hall door', () => {
  const door = hall.doorways[0]!;

  it('opens a clear reveal in front of a closed timber leaf', () => {
    expect(door.facing).toBe('south');
    expect(door.state).toBe('closed');
    expect(cells(door.opening).solid).toBe(0);
    expect(cells(door.leaf).air).toBe(0);
    for (let x = door.leaf.from[0]; x < door.leaf.to[0]; x++) expect([kit.trim, MAT.bark]).toContain(grid.at(x, 50, door.leaf.from[2]));
    expect(door.opening.from[2]).toBe(door.leaf.to[2] + 1);
    expect(door.opening.to[0] - door.opening.from[0]).toBe(12);
    expect(door.opening.to[1] - door.opening.from[1]).toBe(20);
    for (const [y, x0, x1] of RIVER_HALL.door.arch) expect(cells({ from: [x0, y, door.opening.from[2]], to: [x1, y + 1, door.opening.to[2]] }).solid).toBe(0);
  });

  it('stands on a solid sill at the floor', () => {
    expect(door.threshold).toBe(RIVER_HALL.floor);
    const sill = cells({ from: [door.opening.from[0], door.threshold - 1, door.opening.from[2]], to: [door.opening.to[0], door.threshold, door.opening.to[2]] });
    expect(sill.air).toBe(0);
  });

  it('walks down the steps to the bank in one-cell rises with head room, out onto host ground', () => {
    const { approach } = door;
    expect(approach.axis).toBe('z');
    expect(approach.tops.length).toBe(approach.along[1] - approach.along[0]);
    expect(approach.tops[0]).toBe(door.threshold);
    expect(approach.tops.at(-1)).toBe(door.groundAt);
    expect(door.groundAt).toBe(RIVER_HALL.bank);
    for (let i = 1; i < approach.tops.length; i++) expect(Math.abs(approach.tops[i]! - approach.tops[i - 1]!)).toBeLessThanOrEqual(1);
    approach.tops.forEach((top, i) => {
      const z = approach.along[0] + i;
      if (z >= grid.size[2]) return;
      for (let x = approach.across[0]; x < approach.across[1]; x++) {
        expect(grid.at(x, top - 1, z), `tread under ${x},${top},${z}`).not.toBe(0);
        for (let y = top; y < top + 16; y++) expect(grid.at(x, y, z), `head room at ${x},${y},${z}`).toBe(0);
      }
    });
    expect(approach.along[1]).toBeGreaterThan(grid.size[2]);
  });

  it('keeps the doorway clearance and every declared clear volume empty', () => {
    expect(cells(door.clearance).solid).toBe(0);
    for (const { piece } of pieces) {
      const own = voxels(piece.blueprint);
      for (const clear of piece.clear) {
        const label = `${piece.blueprint.id} ${clear.id}`;
        if (clear.role === 'flag-swing') {
          // The flag's own swing holds only its pole.
          const { pole } = RIVER_HALL;
          const inPole = (x: number, z: number) => x >= pole.x[0] && x < pole.x[1] && z >= pole.z[0] && z < pole.z[1];
          expect(cells(clear.box, (x, y, z) => inPole(x, z) ? 0 : own.at(x, y, z), own.size).solid, label).toBe(0);
        } else if (clear.role === 'bell-swing') {
          // The bell's swing holds only the bell.
          const k = LANDMARK_KITS[pieces.find(p => p.piece === piece)!.style];
          const other = cells(clear.box, (x, y, z) => [k.metal, k.iron].includes(own.at(x, y, z)) ? 0 : own.at(x, y, z), own.size);
          expect(other.solid, label).toBe(0);
          expect(cells(clear.box, own.at, own.size).solid, label).toBeGreaterThan(20);
        } else expect(cells(clear.box, own.at, own.size).solid, label).toBe(0);
      }
    }
  });
});

describe('river hall details', () => {
  const at = (p: Vec3, own = grid) => own.at(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));

  it('hangs every lantern of the marquee around real glass', () => {
    const lanterns = hall.emitters.filter(e => e.kind === 'lantern');
    expect(lanterns.length).toBe(2 + 14 + 6);
    expect(hall.emitters.every(e => e.kind === 'lantern')).toBe(true);
    for (const lantern of lanterns) expect(at(lantern.position), lantern.id).toBe(MAT.glass);
    // The wheel turns where the far arch's downstream lantern would hang.
    const millLanterns = mill.emitters.map(e => e.id);
    expect(millLanterns).not.toContain('arch-far-east');
    expect(millLanterns.length).toBe(lanterns.length - 1);
    for (const lantern of mill.emitters) expect(at(lantern.position, millGrid), lantern.id).toBe(MAT.glass);
  });

  it('lays a glazing pane on the outer face of real glass in every window', () => {
    const glazing = hall.glazing!;
    const openings = new Set(glazing.map(g => g.opening));
    expect([...openings].filter(o => o.startsWith('gallery-')).length).toBe(2 * RIVER_HALL.bays.count);
    expect(openings.has('near-rose') && openings.has('far-rose')).toBe(true);
    expect(new Set(glazing.map(g => g.id)).size).toBe(glazing.length);
    const tracery = new Set([kit.trim, kit.band, kit.metal]);
    for (const pane of glazing) {
      const out = pane.facing === 'east' || pane.facing === 'south' ? 1 : -1, axis = pane.facing === 'east' || pane.facing === 'west' ? 0 : 2;
      const plane = pane.centre[axis]!;
      expect(Number.isInteger(plane)).toBe(true);
      let glass = 0, area = 0;
      for (let u = pane.centre[2 - axis]! - pane.width / 2; u < pane.centre[2 - axis]! + pane.width / 2; u++) {
        for (let y = pane.centre[1] - pane.height / 2; y < pane.centre[1] + pane.height / 2; y++) {
          area++;
          const cell = (n: number): number => axis === 0 ? grid.at(n, y, u) : grid.at(u, y, n);
          const inside = cell(out === 1 ? plane - 1 : plane), outside = cell(out === 1 ? plane : plane - 1);
          if (inside === MAT.glass) { glass++; expect(outside === 0 || tracery.has(outside), `${pane.id} at ${u},${y}`).toBe(true); }
          else expect(tracery.has(inside), `${pane.id} at ${u},${y}`).toBe(true);
        }
      }
      expect(glass / area, pane.id).toBeGreaterThan(0.3);
    }
  });

  it('carries the crest over the door with its field flush and its charge proud', () => {
    const { x, y, face } = RIVER_HALL.crest, rows = crestGrid('round', 'star');
    let charge = 0;
    rows.forEach((row, i) => [...row].forEach((mark, c) => {
      const yy = y + rows.length - 1 - i;
      if (mark === '.') return;
      expect(grid.at(x + c, yy, face)).toBe(MAT.fabricViolet);
      if (mark === 'C') { charge++; expect(grid.at(x + c, yy, face + 1)).toBe(kit.charge); }
      if (mark === 'F') expect(grid.at(x + c, yy, face + 1)).toBe(0);
    }));
    expect(charge).toBeGreaterThan(8);
    // Two forked banners in the field colour with the band through them.
    for (const x0 of [24, 80]) {
      expect(grid.at(x0, 90, RIVER_HALL.pavilions.near[1] + 1)).toBe(MAT.fabricViolet);
      expect(grid.at(x0 + 3, 90, RIVER_HALL.pavilions.near[1] + 1)).toBe(MAT.slate);
      expect(grid.at(x0 + 3, 70, RIVER_HALL.pavilions.near[1] + 1)).toBe(0);
    }
  });

  it('hangs the flag as its own part on the hoist', () => {
    const [part] = hall.parts, hoist = hall.mounts.find(m => m.id === part!.mount)!;
    expect(part!.id).toBe('flag');
    expect(part!.blueprint.id).toMatch(/^genesis-river-hall-flag-/);
    expect(part!.offset.map((v, d) => v + part!.pivot[d]!)).toEqual([...hoist.position]);
    expect(hoist.axis).toEqual([0, 1, 0]);
    expect(at(hoist.position)).toBe(kit.trim);
    const cloth = voxels(part!.blueprint), hoistColumn: Vec3[] = [];
    for (let y = 0; y < cloth.size[1]; y++) for (let z = 0; z < cloth.size[2]; z++) if (cloth.at(0, y, z)) hoistColumn.push([0, y, z]);
    expect(unsupported(part!.blueprint, hoistColumn)).toBe(0);
    expect(new Set(part!.blueprint.boxes.map(b => b.material))).toEqual(new Set([kit.cord, MAT.fabricViolet, MAT.slate, MAT.air]));
  });

  it('turns a watermill kingdom\'s wheel on its axle, on the trestle, inside its sweep', () => {
    const wheel = mill.parts.find(p => p.id === 'wheel')!, mount = mill.mounts.find(m => m.id === wheel.mount)!;
    expect(mount.axis).toEqual([0, 0, 1]);
    expect(wheel.offset.map((v, d) => v + wheel.pivot[d]!)).toEqual([...mount.position]);
    const part = voxels(wheel.blueprint), r = RIVER_HALL.wheel.radius;
    const axle: Vec3[] = [];
    for (let z = 0; z < part.size[2]; z++) for (const x of [r - 1, r]) for (const y of [r - 1, r]) axle.push([x, y, z]);
    for (const cell of axle) expect(part.at(...cell)).toBe(kit.iron);
    expect(unsupported(wheel.blueprint, axle)).toBe(0);
    // The axle's ends rest in the iron saddles on both posts.
    const { centre, posts } = RIVER_HALL.wheel;
    for (const [z0] of posts) {
      expect(millGrid.at(centre[0], centre[1] - 2, z0)).toBe(kit.iron);
      expect(z0).toBeGreaterThanOrEqual(wheel.offset[2]);
    }
    expect(Math.max(...posts.map(p => p[1]))).toBeLessThanOrEqual(wheel.offset[2] + part.size[2]);
    // The wheel stays inside its declared sweep, and its paddles dip below the water.
    const sweep = mill.clear.find(c => c.role === 'wheel-sweep')!.box;
    for (let x = 0; x < part.size[0]; x++) for (let y = 0; y < part.size[1]; y++) for (let z = 0; z < part.size[2]; z++) {
      if (!part.at(x, y, z) || part.at(x, y, z) === kit.iron) continue;
      const w = [x + wheel.offset[0], y + wheel.offset[1], z + wheel.offset[2]];
      for (let d = 0; d < 3; d++) { expect(w[d]).toBeGreaterThanOrEqual(sweep.from[d]!); expect(w[d]).toBeLessThan(sweep.to[d]!); }
    }
    expect(sweep.from[1]).toBeLessThan(RIVER_HALL.water);
    expect(mill.sounds.map(s => s.kind)).toContain('mill-wheel');
    expect(hall.sounds.map(s => s.kind)).not.toContain('mill-wheel');
  });

  it('gives the landing bench a free seat facing out over the bank', () => {
    const seat = hall.seats[0]!;
    expect(cells(seat.box).air).toBe(0);
    expect(cells({ from: [seat.box.from[0], seat.box.to[1], seat.box.from[2]], to: [seat.box.to[0], seat.box.to[1] + 10, seat.box.to[2]] }).solid).toBe(0);
    expect(seat.box.from[1] - RIVER_HALL.bank).toBe(3);
  });

  it('hangs the bell from its headstock under the cote', () => {
    const headstock = hall.mounts.find(m => m.id === 'bell-headstock')!;
    expect(headstock.axis).toEqual([1, 0, 0]);
    expect(at(headstock.position)).toBe(kit.trim);
    const { bell } = RIVER_HALL.cote;
    expect(grid.at(bell.x, bell.y, bell.z)).toBe(kit.metal);
    for (let y = bell.y; y < headstock.position[1]; y++) expect(grid.at(bell.x, y, bell.z), `bell at ${y}`).not.toBe(0);
  });

  it('describes its interactions for the host instead of performing them', () => {
    for (const piece of [hall, mill]) {
      const anchors = new Set([...piece.doorways, ...piece.walks, ...piece.seats, ...piece.emitters, ...piece.clear, ...piece.mounts].map(a => a.id));
      expect(piece.affordances.map(a => a.kind)).toEqual(['enter', 'sit', 'ring-bell']);
      for (const affordance of piece.affordances) {
        expect(affordance.status).toBe('needs-host');
        for (const id of affordance.uses) expect(anchors.has(id), `${affordance.id} uses ${id}`).toBe(true);
      }
    }
  });
});
