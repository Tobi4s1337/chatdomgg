import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type Vec3 } from '@chatdom/shared';
import { meshCost, unsupported, voxels } from '../../../places/water/piece-checks';
import { MAT, type StyleKey } from '../../../materials';
import type { CellBox } from '../../../genesis-landmarks/types';
import { COPPER_KETTLE, COPPER_KETTLE_CHIMNEYS, COPPER_KETTLE_SIZE, KETTLE_PROFILE, copperKettlePalette, createCopperKettle } from './inn';

const STYLES_ALL: readonly StyleKey[] = ['hearth', 'tide', 'grove'];
const pieces = STYLES_ALL.map(style => ({ style, piece: createCopperKettle({ style }) }));
const tide = pieces.find(p => p.style === 'tide')!.piece;
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

describe('the Copper Kettle blueprint', () => {
  it('is a strict, deterministic civic blueprint in every kit', () => {
    for (const { style, piece } of pieces) {
      expect(() => VoxelBlueprintSchema.parse(piece.blueprint)).not.toThrow();
      expect(JSON.stringify(createCopperKettle({ style }))).toBe(JSON.stringify(piece));
      expect(piece.blueprint.id).toBe(`genesis-masha-inn-${style}`);
      expect(piece.blueprint.kind).toBe('civic');
      expect(piece.blueprint.lattice).toBe('build');
      expect(piece.blueprint.styleId).toBe(style);
      expect(piece.blueprint.size).toEqual([...COPPER_KETTLE_SIZE]);
      expect(piece.blueprint.size.every(n => n <= 256)).toBe(true);
    }
  });

  it('refuses an unknown kit', () => {
    expect(() => createCopperKettle({ style: 'stone' as StyleKey })).toThrow(/style/);
  });

  it('builds each kit from its own wall, roof, trim and stone', () => {
    for (const { style, piece } of pieces) {
      const used = new Set(piece.blueprint.boxes.map(b => b.material));
      const kit = { hearth: [MAT.plaster, MAT.terracotta, MAT.timber, MAT.limestone], tide: [MAT.cream, MAT.slate, MAT.timber, MAT.stone], grove: [MAT.plaster, MAT.thatch, MAT.bark, MAT.darkStone] }[style];
      for (const m of kit) expect(used.has(m), `${style} uses ${m}`).toBe(true);
      expect(used.has(MAT.forgeCopper)).toBe(true);
    }
  });

  it('uses only its kit palette, and every occupied cell is held up from the ground', () => {
    for (const { style, piece } of pieces) {
      const allowed = copperKettlePalette(style);
      for (const box of piece.blueprint.boxes) expect(allowed.has(box.material), `${piece.blueprint.id} material ${box.material}`).toBe(true);
      expect(unsupported(piece.blueprint), piece.blueprint.id).toBe(0);
    }
  });

  it('fits the budgets on the production rasterizer and mesher', () => {
    for (const { piece } of pieces) {
      const cost = meshCost(piece.blueprint);
      expect(piece.blueprint.boxes.length).toBeLessThanOrEqual(2000);
      expect(cost.occupied).toBeLessThanOrEqual(1_000_000);
      expect(cost.triangles).toBeLessThanOrEqual(250_000);
      expect(cost.triangles).toBeGreaterThan(10_000);
    }
  }, 120_000);

  it('reports occupied bounds that match the rasterized cells, from the ground to the chimney pot', () => {
    const { from, to } = tide.extent;
    expect(from[1]).toBe(0);
    expect(to[1]).toBe(COPPER_KETTLE_CHIMNEYS.main.mouth[1]);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let x = 0; x < grid.size[0]; x++) for (let y = 0; y < grid.size[1]; y++) for (let z = 0; z < grid.size[2]; z++) {
      if (!grid.at(x, y, z)) continue;
      const p = [x, y, z];
      for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d]!, p[d]!); max[d] = Math.max(max[d]!, p[d]! + 1); }
    }
    expect(min).toEqual([...from]);
    expect(max).toEqual([...to]);
    // The footprint: about 14 m × 12 m of building, with eaves, balcony and steps beyond it.
    const { stone } = COPPER_KETTLE;
    expect(stone.x[1] - stone.x[0]).toBeLessThanOrEqual(120);
    expect(stone.z[1] - stone.z[0]).toBeLessThanOrEqual(104);
  });

  it('stands its plinth flat on the ground', () => {
    const plinth = tide.footings.find(f => f.id === 'plinth')!;
    expect(plinth.embed).toBe(0);
    expect(cells(plinth.box).air).toBe(0);
  });

  it('lets its ridge settle two cells in the middle and its eaves one', () => {
    const top = (x: number) => { for (let y = grid.size[1] - 1; y >= 0; y--) if (grid.at(x, y, COPPER_KETTLE.roof.cz)) return y; return -1; };
    const ends = top(12), middle = top(72);
    expect(ends - middle).toBe(2);
    const eave = (x: number) => { const z = COPPER_KETTLE.roof.front + COPPER_KETTLE.roof.kick - 1; for (let y = 0; y < 120; y++) if (grid.at(x, y, z)) return y; return -1; };
    expect(eave(12) - eave(72)).toBe(1);
  });
});

describe('the Copper Kettle door', () => {
  const door = tide.doorways[0]!;

  it('opens a clear arched reveal in front of a closed timber leaf', () => {
    expect(door.facing).toBe('south');
    expect(door.state).toBe('closed');
    expect(cells(door.opening).solid).toBe(0);
    expect(cells(door.leaf).air).toBe(0);
    for (let x = door.leaf.from[0]; x < door.leaf.to[0]; x++) expect([MAT.timber, MAT.bark]).toContain(grid.at(x, 12, door.leaf.from[2]));
    // A big inn door: 2 m wide, about 3 m to the crown of its arch.
    expect(door.opening.to[0] - door.opening.from[0]).toBe(16);
    for (const [y, x0, x1] of COPPER_KETTLE.door.arch) expect(cells({ from: [x0, y, door.opening.from[2]], to: [x1, y + 1, door.opening.to[2]] }).solid).toBe(0);
    expect(COPPER_KETTLE.door.arch.at(-1)![0] + 1 - door.threshold).toBeGreaterThanOrEqual(24);
  });

  it('stands on a solid sill at the threshold height', () => {
    const sill = cells({ from: [door.opening.from[0], door.threshold - 1, door.opening.from[2]], to: [door.opening.to[0], door.threshold, door.opening.to[2]] });
    expect(sill.air).toBe(0);
  });

  it('walks out across the steps to the ground in one-cell rises with 2 m of head room', () => {
    const { approach } = door;
    expect(approach.axis).toBe('z');
    expect(approach.tops.length).toBe(approach.along[1] - approach.along[0]);
    expect(approach.tops[0]).toBe(door.threshold);
    expect(approach.tops.at(-1)).toBe(door.groundAt);
    expect(door.groundAt).toBe(0);
    for (let i = 1; i < approach.tops.length; i++) expect(Math.abs(approach.tops[i]! - approach.tops[i - 1]!)).toBeLessThanOrEqual(1);
    approach.tops.forEach((top, i) => {
      const z = approach.along[0] + i;
      if (z >= grid.size[2]) return;
      for (let x = approach.across[0]; x < approach.across[1]; x++) {
        if (top > 0) expect(grid.at(x, top - 1, z), `tread under ${x},${top},${z}`).not.toBe(0);
        for (let y = top; y < top + 16; y++) expect(grid.at(x, y, z), `head room at ${x},${y},${z}`).toBe(0);
      }
    });
    expect(approach.along[1]).toBeGreaterThan(grid.size[2]);
  });

  it('keeps the doorway clearance and every declared clear volume empty in every kit', () => {
    expect(cells(door.clearance).solid).toBe(0);
    for (const { piece } of pieces) {
      const own = voxels(piece.blueprint);
      for (const clear of piece.clear) expect(cells(clear.box, own.at, own.size).solid, `${piece.blueprint.id} ${clear.id}`).toBe(0);
    }
  });
});

describe('the Copper Kettle details', () => {
  const at = (p: Vec3) => grid.at(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));

  it('hangs both door lanterns around real glass inside an iron cage', () => {
    const lamps = tide.emitters.filter(e => e.kind === 'lantern');
    expect(lamps.map(l => l.id)).toEqual(['door-lantern-west', 'door-lantern-east']);
    for (const lantern of lamps) {
      expect(at(lantern.position)).toBe(MAT.glass);
      const [x, y, z] = lantern.position.map(Math.floor) as [number, number, number];
      expect(grid.at(x - 2, y, z - 2)).toBe(MAT.darkStone);
      expect(grid.at(x, COPPER_KETTLE.lantern.glass.y[1], z)).toBe(MAT.brass);
    }
    // One either side of the door.
    expect(lamps[0]!.position[0]).toBeLessThan(COPPER_KETTLE.door.opening.x[0]);
    expect(lamps[1]!.position[0]).toBeGreaterThan(COPPER_KETTLE.door.opening.x[1]);
  });

  it('declares every window over real glass with its outward face clear, in every kit', () => {
    for (const { piece } of pieces) {
      const { at: get, size } = voxels(piece.blueprint);
      expect(piece.blueprint.windows.length).toBeGreaterThanOrEqual(30);
      for (const w of piece.blueprint.windows) {
        const horizontal = w.facing === 'south' || w.facing === 'north' ? 0 : 2, normal = horizontal === 0 ? 2 : 0;
        const direction = w.facing === 'south' || w.facing === 'east' ? 1 : -1;
        let glass = 0;
        for (let y = Math.ceil(w.centre[1] - w.height / 2); y < w.centre[1] + w.height / 2; y++) {
          for (let u = Math.ceil(w.centre[horizontal]! - w.width / 2); u < w.centre[horizontal]! + w.width / 2; u++) {
            const cell = [...w.centre] as [number, number, number];
            cell[1] = y; cell[horizontal] = u;
            cell[normal] = w.centre[normal]! - (direction > 0 ? 1 : 0);
            if (get(...cell) === MAT.glass) glass++;
            const outside = w.centre[normal]! + (direction < 0 ? -1 : 0);
            for (let n = outside; n >= 0 && n < size[normal]! && Math.abs(n - outside) < 2; n += direction) {
              cell[normal] = n;
              expect(get(...cell), `${piece.blueprint.id}/${w.id} outward at ${cell.join(',')}`).toBe(0);
            }
          }
        }
        expect(glass, `${piece.blueprint.id}/${w.id} glass`).toBeGreaterThan(0);
      }
      // The host's glazing mirrors the declared windows.
      expect(piece.glazing!.map(g => g.id)).toEqual(piece.blueprint.windows.map(w => w.id));
    }
  });

  it('hangs the copper kettle from its brass bracket, free of the wall', () => {
    const { arm, kettle } = COPPER_KETTLE.sign;
    for (let z = arm.z[0]; z < arm.z[1]; z++) expect(grid.at(arm.x, arm.y[0], z)).toBe(MAT.brass);
    let copper = 0;
    KETTLE_PROFILE.forEach((row, i) => [...row].forEach((mark, c) => {
      const y = kettle.top - 1 - i, z = kettle.z0 + c;
      // Copper everywhere but the bright brass band round the belly.
      if (mark === 'K' || mark === 'S' || mark === 'H') { expect(grid.at(arm.x, y, z)).toBe(i === 7 && mark === 'K' ? MAT.brass : MAT.forgeCopper); copper++; }
      if (mark === '.' && c > 0 && c < row.length - 1 && i > 0) expect([0, MAT.brass, MAT.forgeCopper]).toContain(grid.at(arm.x, y, z));
    }));
    expect(copper).toBeGreaterThanOrEqual(100);
    // The wall face behind it stays clear: the kettle hangs a cell off the stone.
    expect(kettle.z0).toBeGreaterThan(COPPER_KETTLE.stone.z[1]);
  });

  it('gives the bench a free seat', () => {
    const seat = tide.seats[0]!;
    expect(cells(seat.box).air).toBe(0);
    expect(cells({ from: [seat.box.from[0], seat.box.to[1], seat.box.from[2]], to: [seat.box.to[0], seat.box.to[1] + 10, seat.box.to[2]] }).solid).toBe(0);
    expect(seat.box.to[1]).toBe(4);
  });

  it('puts the smoke mounts on open chimney mouths under open sky', () => {
    for (const id of ['chimney-smoke', 'chimney-smoke-small']) {
      const mount = tide.mounts.find(m => m.id === id)!;
      expect(mount.axis).toEqual([0, 1, 0]);
      const [x, y, z] = mount.position;
      // The pot's flue is open below the mouth and its rim is solid around it.
      expect(grid.at(x, y - 1, z)).toBe(0);
      expect(grid.at(x - 2, y - 1, z)).not.toBe(0);
      for (let yy = y; yy < grid.size[1]; yy++) expect(grid.at(x, yy, z)).toBe(0);
    }
  });

  it('describes its interactions for the host instead of performing them', () => {
    const anchors = new Set([...tide.doorways, ...tide.walks, ...tide.seats, ...tide.emitters, ...tide.clear].map(a => a.id));
    expect(tide.affordances.map(a => a.kind).sort()).toEqual(['enter', 'sit']);
    for (const affordance of tide.affordances) {
      expect(affordance.status).toBe('needs-host');
      for (const id of affordance.uses) expect(anchors.has(id), `${affordance.id} uses ${id}`).toBe(true);
    }
  });
});
