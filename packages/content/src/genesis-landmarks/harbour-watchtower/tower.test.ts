import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type Vec3 } from '@chatdom/shared';
import { meshCost, unsupported, voxels } from '../../places/water/piece-checks';
import { MAT, type StyleKey } from '../../materials';
import { crestGrid, flagGrid } from '../heraldry';
import { landmarkPalette, snapToCloth } from '../kit';
import type { CellBox } from '../types';
import { WATCHTOWER, WATCHTOWER_AXIS, WATCHTOWER_SLITS, createHarbourWatchtower, type HarbourWatchtowerOptions } from './tower';

const STYLES_ALL: readonly StyleKey[] = ['hearth', 'tide', 'grove'];
const options = (style: StyleKey, crown: HarbourWatchtowerOptions['crown'] = 'beacon-loft'): HarbourWatchtowerOptions => ({
  style, crown, crest: { shape: 'heater', charge: 'wave' }, bannerCut: 'forked',
  colours: { field: MAT.fabricRed, band: MAT.fabricGold },
});
const pieces = STYLES_ALL.flatMap(style => (['beacon-loft', 'lamp-room'] as const).map(crown => ({ style, crown, piece: createHarbourWatchtower(options(style, crown)) })));
const tide = pieces.find(p => p.style === 'tide' && p.crown === 'beacon-loft')!.piece;
const grid = voxels(tide.blueprint);

function cells(box: CellBox, at = grid.at, size = grid.size): { solid: number; air: number; total: number } {
  let solid = 0, total = 0;
  for (let x = Math.max(0, box.from[0]); x < Math.min(size[0], box.to[0]); x++) {
    for (let y = Math.max(0, box.from[1]); y < Math.min(size[1], box.to[1]); y++) {
      for (let z = Math.max(0, box.from[2]); z < Math.min(size[2], box.to[2]); z++) { total++; if (at(x, y, z)) solid++; }
    }
  }
  return { solid, air: total - solid, total };
}

describe('harbour watchtower blueprint', () => {
  it('is a strict, deterministic civic blueprint in every kit and crown', () => {
    for (const { style, crown, piece } of pieces) {
      expect(() => VoxelBlueprintSchema.parse(piece.blueprint)).not.toThrow();
      expect(JSON.stringify(createHarbourWatchtower(options(style, crown)))).toBe(JSON.stringify(piece));
      expect(piece.blueprint.kind).toBe('civic');
      expect(piece.blueprint.styleId).toBe(style);
      expect(piece.blueprint.windows).toEqual([]);
    }
    const ids = new Set(pieces.map(p => p.piece.blueprint.id));
    expect(ids.size).toBe(pieces.length);
    expect(createHarbourWatchtower({ ...options('tide'), bannerCut: 'pennant' }).blueprint.id).not.toBe(tide.blueprint.id);
  });

  it('refuses unknown kits and crowns', () => {
    expect(() => createHarbourWatchtower({ ...options('tide'), style: 'stone' as StyleKey })).toThrow(/style/);
    expect(() => createHarbourWatchtower({ ...options('tide'), crown: 'spire' as HarbourWatchtowerOptions['crown'] })).toThrow(/crown/);
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
      expect(cost.occupied).toBeLessThanOrEqual(1_000_000);
      expect(cost.triangles).toBeLessThanOrEqual(250_000);
      expect(cost.triangles).toBeGreaterThan(10_000);
    }
  }, 60_000);

  it('reports occupied bounds that match the rasterized cells and reach from the ground to the flag', () => {
    const { from, to } = tide.extent;
    expect(from[1]).toBe(0);
    expect(to[1]).toBe(WATCHTOWER.pole.y[1]);
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let x = 0; x < grid.size[0]; x++) for (let y = 0; y < grid.size[1]; y += 1) for (let z = 0; z < grid.size[2]; z++) {
      if (!grid.at(x, y, z)) continue;
      min = min.map((v, d) => Math.min(v, [x, y, z][d]!)); max = max.map((v, d) => Math.max(v, [x, y, z][d]! + 1));
    }
    expect(min).toEqual([...from]);
    expect(max).toEqual([...to]);
  });

  it('stands its plinth flat on the ground', () => {
    const plinth = tide.footings.find(f => f.id === 'plinth')!;
    const bottom = cells({ from: plinth.box.from, to: [plinth.box.to[0], 1, plinth.box.to[2]] });
    expect(plinth.embed).toBe(0);
    // A chamfered octagon fills all but its four cut corners.
    expect(bottom.solid / bottom.total).toBeGreaterThan(0.85);
    expect(grid.at(WATCHTOWER_AXIS.x, 0, WATCHTOWER_AXIS.z)).not.toBe(0);
  });
});

describe('harbour watchtower door', () => {
  const door = tide.doorways[0]!;

  it('opens a clear reveal in front of a closed timber leaf', () => {
    expect(door.facing).toBe('south');
    expect(door.state).toBe('closed');
    expect(cells(door.opening).solid).toBe(0);
    const leaf = cells(door.leaf);
    expect(leaf.air).toBe(0);
    for (let x = door.leaf.from[0]; x < door.leaf.to[0]; x++) expect([MAT.timber, MAT.bark]).toContain(grid.at(x, 15, door.leaf.from[2]));
    expect(door.opening.from[2]).toBe(door.leaf.to[2] + 1);
    // A human doorway: 1.5 m wide and 2.5 m to the springing of the arch, with an arched head above.
    expect(door.opening.to[0] - door.opening.from[0]).toBe(12);
    expect(door.opening.to[1] - door.opening.from[1]).toBe(20);
    for (const [y, x0, x1] of WATCHTOWER.door.arch) expect(cells({ from: [x0, y, door.opening.from[2]], to: [x1, y + 1, door.opening.to[2]] }).solid).toBe(0);
  });

  it('stands on a solid sill at the threshold height', () => {
    const sill = cells({ from: [door.opening.from[0], door.threshold - 1, door.opening.from[2]], to: [door.opening.to[0], door.threshold, door.opening.to[2]] });
    expect(sill.air).toBe(0);
    expect(door.threshold).toBe(3);
  });

  it('walks out across the steps to the ground in one-cell rises with head room', () => {
    const { approach } = door;
    expect(approach.axis).toBe('z');
    expect(approach.tops.length).toBe(approach.along[1] - approach.along[0]);
    expect(approach.tops[0]).toBe(door.threshold);
    expect(approach.tops.at(-1)).toBe(door.groundAt);
    for (let i = 1; i < approach.tops.length; i++) expect(Math.abs(approach.tops[i]! - approach.tops[i - 1]!)).toBeLessThanOrEqual(1);
    approach.tops.forEach((top, i) => {
      const z = approach.along[0] + i;
      if (z >= grid.size[2]) return;
      for (let x = approach.across[0]; x < approach.across[1]; x++) {
        if (top > 0) expect(grid.at(x, top - 1, z), `tread under ${x},${top},${z}`).not.toBe(0);
        for (let y = top; y < top + 16; y++) expect(grid.at(x, y, z), `head room at ${x},${y},${z}`).toBe(0);
      }
    });
    // The approach reaches past the blueprint onto host ground.
    expect(approach.along[1]).toBeGreaterThan(grid.size[2]);
  });

  it('keeps the doorway clearance and every declared clear volume empty', () => {
    expect(cells(door.clearance).solid).toBe(0);
    for (const { piece } of pieces) {
      const own = voxels(piece.blueprint);
      for (const clear of piece.clear) {
        if (clear.role !== 'flag-swing') { expect(cells(clear.box, own.at, own.size).solid, `${piece.blueprint.id} ${clear.id}`).toBe(0); continue; }
        // The flag's own swing holds only its pole.
        const { pole } = WATCHTOWER;
        const outside = cells(clear.box, (x, y, z) => (x >= pole.x[0] && x < pole.x[1] && z >= pole.z[0] && z < pole.z[1]) ? 0 : own.at(x, y, z), own.size);
        expect(outside.solid, `${piece.blueprint.id} flag swing`).toBe(0);
      }
    }
  });
});

describe('harbour watchtower details', () => {
  const at = (p: Vec3) => grid.at(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));

  it('hangs each door lantern around real glass and sets the beacon on its coals under open air', () => {
    for (const lantern of tide.emitters.filter(e => e.kind === 'lantern')) expect(at(lantern.position)).toBe(MAT.glass);
    const beacon = tide.emitters.find(e => e.id === 'beacon')!;
    expect(grid.at(beacon.position[0], beacon.position[1] - 1, beacon.position[2])).not.toBe(0);
    for (let y = beacon.position[1]; y < WATCHTOWER.loft.y[1] - 2; y++) expect(grid.at(beacon.position[0], y, beacon.position[2])).toBe(0);
    const lamp = pieces.find(p => p.style === 'tide' && p.crown === 'lamp-room')!.piece;
    const lens = lamp.emitters.find(e => e.id === 'beacon')!.position;
    expect(voxels(lamp.blueprint).at(Math.floor(lens[0]), Math.floor(lens[1]), Math.floor(lens[2]))).toBe(MAT.glass);
  });

  it('sees the beacon from all four sides through open arches, and glazes them in a lamp room', () => {
    const lamp = voxels(pieces.find(p => p.style === 'tide' && p.crown === 'lamp-room')!.piece.blueprint);
    const { x, z } = WATCHTOWER_AXIS, y = 172, half = WATCHTOWER.loft.half;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
      for (let r = 4; r <= half; r++) expect(grid.at(x + dx * r, y, z + dz * r), `open ${dx},${dz} at ${r}`).toBe(0);
      const glass = Array.from({ length: half - 3 }, (_, i) => lamp.at(x + dx * (i + 4), y, z + dz * (i + 4)));
      expect(glass).toContain(MAT.glass);
    }
  });

  it('cuts every arrow slit through to the hollow shaft', () => {
    const { x, z } = WATCHTOWER_AXIS;
    for (const [side, y] of WATCHTOWER_SLITS) {
      const [dx, dz] = [[0, 1], [1, 0], [0, -1], [-1, 0]][side]!;
      for (let r = 16; r <= 24; r++) expect(grid.at(x + dx! * r, y + 5, z + dz! * r), `slit ${side}/${y} at ${r}`).toBe(0);
    }
  });

  it('carries the crest over the door with its field sunk and charge proud', () => {
    const { x, y, face } = WATCHTOWER.crest, rows = crestGrid('heater', 'wave');
    let charge = 0;
    rows.forEach((row, i) => [...row].forEach((mark, c) => {
      const yy = y + rows.length - 1 - i;
      if (mark === '.') return;
      expect(grid.at(x + c, yy, face)).toBe(MAT.fabricRed);
      if (mark === 'C') { charge++; expect(grid.at(x + c, yy, face + 1)).toBe(MAT.cream); }
      if (mark === 'F') expect(grid.at(x + c, yy, face + 1)).toBe(0);
    }));
    expect(charge).toBeGreaterThan(12);
  });

  it('hangs the flag as its own part on the hoist, with the band through it and the recipe cut', () => {
    const pole = WATCHTOWER.pole;
    for (let y = pole.y[0] + 4; y < pole.y[1]; y++) expect(grid.at(pole.x[0], y, pole.z[0])).not.toBe(0);
    const [part] = tide.parts, hoist = tide.mounts.find(m => m.id === part!.mount)!;
    expect(part!.id).toBe('flag');
    expect(() => VoxelBlueprintSchema.parse(part!.blueprint)).not.toThrow();
    // At rest the pivot lands on the hoist, on the pole's centre line, next to the pole.
    expect(part!.offset.map((v, d) => v + part!.pivot[d]!)).toEqual([...hoist.position]);
    expect(hoist.axis).toEqual([0, 1, 0]);
    expect(grid.at(Math.floor(hoist.position[0]), hoist.position[1], Math.floor(hoist.position[2]))).toBe(MAT.timber);
    expect(part!.offset[0]).toBe(pole.x[1]);
    // Every cloth cell is held, face to face, from the hoist column.
    const cloth = voxels(part!.blueprint);
    const hoistColumn: Vec3[] = [];
    for (let y = 0; y < cloth.size[1]; y++) for (let z = 0; z < cloth.size[2]; z++) if (cloth.at(0, y, z)) hoistColumn.push([0, y, z]);
    expect(hoistColumn.length).toBe(13);
    expect(unsupported(part!.blueprint, hoistColumn)).toBe(0);
    // The band runs through the middle, the swallowtail notch is open at the fly, and nothing else is in the swing.
    const forked = flagGrid('forked'), square = flagGrid('square');
    expect(forked.some(row => row.includes('.'))).toBe(true);
    expect(square.every(row => !row.includes('.'))).toBe(true);
    const mid = Math.floor(forked.length / 2), y = forked.length - 1 - mid;
    expect([cloth.at(3, y, 0), cloth.at(3, y, 1)]).toContain(MAT.fabricGold);
    expect([cloth.at(forked[0]!.length - 1, y, 0), cloth.at(forked[0]!.length - 1, y, 1)]).toEqual([0, 0]);
    expect(new Set(part!.blueprint.boxes.map(b => b.material))).toEqual(new Set([MAT.thatch, MAT.fabricRed, MAT.fabricGold, MAT.air]));
  });

  it('gives the bench a free seat and the hoist a rope from its pulley', () => {
    const seat = tide.seats[0]!;
    expect(cells(seat.box).air).toBe(0);
    expect(cells({ from: [seat.box.from[0], seat.box.to[1], seat.box.from[2]], to: [seat.box.to[0], seat.box.to[1] + 10, seat.box.to[2]] }).solid).toBe(0);
    expect(seat.box.to[1]).toBe(4);
    const { rope } = WATCHTOWER.hoist;
    for (let y = rope.y[0]; y < rope.y[1]; y++) expect(grid.at(rope.x, y, rope.z)).toBe(MAT.thatch);
  });

  it('describes its interactions for the host instead of performing them', () => {
    const anchors = new Set([...tide.doorways, ...tide.walks, ...tide.seats, ...tide.emitters, ...tide.clear].map(a => a.id));
    for (const affordance of tide.affordances) {
      expect(affordance.status).toBe('needs-host');
      for (const id of affordance.uses) expect(anchors.has(id), `${affordance.id} uses ${id}`).toBe(true);
    }
  });

  it('snaps colour targets onto registered cloth', () => {
    expect(snapToCloth('#C91709')).toBe(MAT.fabricRed);
    expect(snapToCloth('#F8AE04')).toBe(MAT.fabricOrange);
    expect(snapToCloth('#d8bd68')).toBe(MAT.fabricGold);
    expect(snapToCloth('#075E86')).toBe(MAT.slate);
    expect(snapToCloth('#557f9e')).toBe(MAT.fabricBlue);
    expect(() => snapToCloth('red')).toThrow();
  });
});
