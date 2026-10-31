import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type Vec3 } from '@chatdom/shared';
import { meshCost, unsupported, voxels } from '../../places/water/piece-checks';
import { MAT, type StyleKey } from '../../materials';
import { crestGrid } from '../heraldry';
import { LANDMARK_KITS, landmarkPalette } from '../kit';
import type { CellBox, LandmarkPiece } from '../types';
import { CROWN_TOWER, CROWN_TOWER_AXIS, CROWN_TOWER_SIZE, createCrownTower, headHalf, stemHalf, type CrownTowerHead, type CrownTowerOptions } from './crown';

const STYLES_ALL: readonly StyleKey[] = ['hearth', 'tide', 'grove'];
const HEADS: readonly CrownTowerHead[] = ['watch-fire', 'bell'];
const options = (style: StyleKey, head: CrownTowerHead = 'watch-fire'): CrownTowerOptions => ({
  style, head, crest: { shape: 'heater', charge: 'mountain' }, bannerCut: 'square',
  colours: { field: MAT.fabricViolet, band: MAT.fabricBlue },
});
const pieces = STYLES_ALL.flatMap(style => HEADS.map(head => ({ style, head, piece: createCrownTower(options(style, head)) })));
const pick = (style: StyleKey, head: CrownTowerHead): LandmarkPiece => pieces.find(p => p.style === style && p.head === head)!.piece;
const tower = pick('hearth', 'watch-fire'), belfry = pick('hearth', 'bell');
const kit = LANDMARK_KITS.hearth;
const grid = voxels(tower.blueprint), bellGrid = voxels(belfry.blueprint);
const { x: CX, z: CZ } = CROWN_TOWER_AXIS;

function cells(box: CellBox, at = grid.at, size = grid.size): { solid: number; air: number; total: number } {
  let solid = 0, total = 0;
  for (let x = Math.max(0, box.from[0]); x < Math.min(size[0], box.to[0]); x++) {
    for (let y = Math.max(0, box.from[1]); y < Math.min(size[1], box.to[1]); y++) {
      for (let z = Math.max(0, box.from[2]); z < Math.min(size[2], box.to[2]); z++) { total++; if (at(x, y, z)) solid++; }
    }
  }
  return { solid, air: total - solid, total };
}
/** Solid width along X through the axis at height y. */
const widthAt = (y: number, at = grid.at) => Array.from({ length: CROWN_TOWER_SIZE[0] }, (_, x) => at(x, y, CZ)).filter(Boolean).length;

describe('crown tower blueprint', () => {
  it('is a strict, deterministic civic blueprint in every kit and with either head', () => {
    for (const { style, head, piece } of pieces) {
      expect(() => VoxelBlueprintSchema.parse(piece.blueprint)).not.toThrow();
      expect(JSON.stringify(createCrownTower(options(style, head)))).toBe(JSON.stringify(piece));
      expect(piece.blueprint.kind).toBe('civic');
      expect(piece.blueprint.styleId).toBe(style);
      expect(piece.blueprint.size).toEqual([...CROWN_TOWER_SIZE]);
      expect(piece.blueprint.windows).toEqual([]);
      expect(piece.parts.map(p => p.id)).toEqual(['flag']);
      for (const part of piece.parts) expect(() => VoxelBlueprintSchema.parse(part.blueprint)).not.toThrow();
    }
    expect(new Set(pieces.map(p => p.piece.blueprint.id)).size).toBe(pieces.length);
    expect(createCrownTower({ ...options('hearth'), bannerCut: 'forked' }).blueprint.id).not.toBe(tower.blueprint.id);
    expect(createCrownTower({ ...options('hearth'), crest: { shape: 'round', charge: 'star' } }).blueprint.id).not.toBe(tower.blueprint.id);
  });

  it('refuses unknown kits and heads', () => {
    expect(() => createCrownTower({ ...options('hearth'), style: 'stone' as StyleKey })).toThrow(/style/);
    expect(() => createCrownTower({ ...options('hearth'), head: 'spire' as CrownTowerHead })).toThrow(/head/);
  });

  it('uses only its kit palette, and every occupied cell is held up from the ground', () => {
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
    }
  }, 120_000);

  it('reports occupied bounds that match the rasterized cells, from the ground to the cross', () => {
    for (const [piece, own] of [[tower, grid], [belfry, bellGrid]] as const) {
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let x = 0; x < own.size[0]; x++) for (let y = 0; y < own.size[1]; y++) for (let z = 0; z < own.size[2]; z++) {
        if (!own.at(x, y, z)) continue;
        min = min.map((v, d) => Math.min(v, [x, y, z][d]!)); max = max.map((v, d) => Math.max(v, [x, y, z][d]! + 1));
      }
      expect(min).toEqual([...piece.extent.from]);
      expect(max).toEqual([...piece.extent.to]);
      expect(piece.extent.from[1]).toBe(0);
      expect(piece.extent.to[1]).toBe(CROWN_TOWER.cross.y[1]);
    }
  });
});

describe('crown tower silhouette', () => {
  it('reads as a king: a broad foot, a narrowing stem, a collar, a flaring head, a crown band and a cross', () => {
    const foot = widthAt(6), stemFoot = widthAt(40), stemTop = widthAt(140), collar = widthAt(156);
    const headFoot = widthAt(161), headTop = widthAt(200), rim = widthAt(204), arm = widthAt(249), top = widthAt(254);
    expect(foot).toBeGreaterThan(stemFoot + 20);
    expect(stemFoot).toBeGreaterThan(stemTop + 8);
    expect(collar).toBeGreaterThan(stemTop + 16);
    expect(collar).toBeGreaterThan(headFoot + 16);
    expect(headTop).toBeGreaterThan(headFoot + 8);
    expect(rim).toBeGreaterThan(headTop);
    expect(arm).toBe(2 * CROWN_TOWER.cross.reach);
    expect(top).toBe(4);
    for (let y = CROWN_TOWER.stem.y[0] + 1; y < CROWN_TOWER.stem.y[1]; y++) expect(stemHalf(y)).toBeLessThanOrEqual(stemHalf(y - 1));
    for (let y = CROWN_TOWER.head.y[0] + 1; y < CROWN_TOWER.head.y[1]; y++) expect(headHalf(y)).toBeGreaterThanOrEqual(headHalf(y - 1));
  });

  it('crowns the head with eight points round the dome, each with a bright tip', () => {
    const { coronet } = CROWN_TOWER, y = coronet.points[0] + 2;
    let points = 0;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2, r = coronet.half - 1.5;
      const solid = grid.at(Math.floor(CX + Math.sin(a) * r), y, Math.floor(CZ + Math.cos(a) * r)) !== 0;
      const prev = (k ? (k - 1) : 63) / 64 * Math.PI * 2;
      const before = grid.at(Math.floor(CX + Math.sin(prev) * r), y, Math.floor(CZ + Math.cos(prev) * r)) !== 0;
      if (solid && !before) points++;
    }
    expect(points).toBe(8);
    expect(grid.at(CX, coronet.tip[1], CZ + coronet.half - 2)).toBe(kit.metal);
    expect(grid.at(CX, CROWN_TOWER.dome.y[0] + 4, CZ)).toBe(kit.roof);
    expect(grid.at(CX, 238, CZ)).toBe(kit.metal);
  });
});

describe('crown tower board', () => {
  it('lays eight by eight squares in alternating pale and dark stone, held at its corners by rook lanterns', () => {
    const { x, z, square } = CROWN_TOWER.board, y = CROWN_TOWER.deck - 1;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const at = grid.at(x[0] + i * square + 5, y, z[0] + j * square + 5);
      expect(at, `square ${i},${j}`).toBe((i + j) % 2 ? kit.iron : kit.band);
    }
    for (const rook of CROWN_TOWER.rooks) {
      expect(grid.at(rook.x, CROWN_TOWER.deck, rook.z)).toBe(kit.base);
      expect(grid.at(rook.x, 31, rook.z)).toBe(MAT.glass);
      // A light through every side of the battlement shows the glass; the notches open the top.
      expect(grid.at(rook.x, 31, rook.z + 4)).toBe(0);
      expect(grid.at(rook.x + 4, 31, rook.z)).toBe(0);
      expect(grid.at(rook.x, 37, rook.z + 4)).toBe(0);
      expect(grid.at(rook.x + 2, 37, rook.z + 4)).toBe(kit.stone);
    }
  });

  it('keeps the board clear for a host game, and seats spectators along both sides', () => {
    const board = tower.clear.find(c => c.role === 'board')!;
    expect(board.box.from[1]).toBe(CROWN_TOWER.deck);
    expect(cells(board.box).solid).toBe(0);
    expect(tower.seats.map(s => s.facing)).toEqual(['east', 'west']);
    for (const seat of tower.seats) {
      expect(cells(seat.box).air).toBe(0);
      expect(seat.box.from[1] - CROWN_TOWER.deck).toBe(3);
      expect(cells({ from: [seat.box.from[0], seat.box.to[1], seat.box.from[2]], to: [seat.box.to[0], seat.box.to[1] + 10, seat.box.to[2]] }).solid).toBe(0);
    }
  });
});

describe('crown tower door', () => {
  const door = tower.doorways[0]!;

  it('opens a clear reveal in front of a closed timber leaf', () => {
    expect(door.facing).toBe('south');
    expect(door.state).toBe('closed');
    expect(cells(door.opening).solid).toBe(0);
    expect(cells(door.leaf).air).toBe(0);
    for (let x = door.leaf.from[0]; x < door.leaf.to[0]; x++) expect([kit.trim, MAT.bark]).toContain(grid.at(x, 10, door.leaf.from[2]));
    expect(door.opening.from[2]).toBe(door.leaf.to[2] + 1);
    expect(door.opening.to[0] - door.opening.from[0]).toBe(12);
    expect(door.opening.to[1] - door.opening.from[1]).toBe(20);
    for (const [y, x0, x1] of CROWN_TOWER.door.arch) expect(cells({ from: [x0, y, door.opening.from[2]], to: [x1, y + 1, door.opening.to[2]] }).solid).toBe(0);
  });

  it('stands on a solid sill at the terrace', () => {
    expect(door.threshold).toBe(CROWN_TOWER.deck);
    const sill = cells({ from: [door.opening.from[0], door.threshold - 1, door.leaf.from[2]], to: [door.opening.to[0], door.threshold, door.opening.to[2]] });
    expect(sill.air).toBe(0);
  });

  it('walks across the board and down the steps in one-cell rises with head room, out onto host ground', () => {
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

  it('keeps the doorway clearance and every declared clear volume empty', () => {
    expect(cells(door.clearance).solid).toBe(0);
    for (const { style, piece } of pieces) {
      const own = voxels(piece.blueprint), k = LANDMARK_KITS[style];
      for (const clear of piece.clear) {
        const label = `${piece.blueprint.id} ${clear.id}`;
        if (clear.role === 'flag-swing') {
          // The flag's own swing holds only its mast.
          const { mast } = CROWN_TOWER;
          const inMast = (x: number, z: number) => x >= mast.x[0] - 1 && x < mast.x[1] + 1 && z >= mast.z[0] - 1 && z < mast.z[1] + 1;
          expect(cells(clear.box, (x, y, z) => inMast(x, z) ? 0 : own.at(x, y, z), own.size).solid, label).toBe(0);
        } else if (clear.role === 'bell-swing') {
          const other = cells(clear.box, (x, y, z) => [k.metal, k.iron].includes(own.at(x, y, z)) ? 0 : own.at(x, y, z), own.size);
          expect(other.solid, label).toBe(0);
          expect(cells(clear.box, own.at, own.size).solid, label).toBeGreaterThan(40);
        } else expect(cells(clear.box, own.at, own.size).solid, label).toBe(0);
      }
    }
  });
});

describe('crown tower details', () => {
  const at = (p: Vec3, own = grid) => own.at(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));

  it('hangs every lantern around real glass, and burns the watch fire on its embers under open air', () => {
    const lanterns = tower.emitters.filter(e => e.kind === 'lantern');
    expect(lanterns.map(l => l.id)).toEqual([...CROWN_TOWER.lanterns.map(l => l.id), ...CROWN_TOWER.rooks.map(r => r.id)]);
    for (const lantern of lanterns) expect(at(lantern.position), lantern.id).toBe(MAT.glass);
    const fire = tower.emitters.find(e => e.kind === 'beacon')!;
    expect(fire.id).toBe('watch-fire');
    expect(grid.at(CX, CROWN_TOWER.fire.heart - 1, CZ)).toBe(MAT.fabricGold);
    expect(grid.at(CX, CROWN_TOWER.fire.heart, CZ)).toBe(0);
    expect(cells(tower.clear.find(c => c.role === 'beacon-flame')!.box).solid).toBe(0);
    expect(belfry.emitters.some(e => e.kind === 'beacon')).toBe(false);
  });

  it('opens four lookouts right through the head, so the fire shows from every side', () => {
    const lookouts = tower.clear.filter(c => c.role === 'lookout');
    expect(lookouts.map(l => l.id)).toEqual(['lookout-south', 'lookout-east', 'lookout-north', 'lookout-west']);
    const y = CROWN_TOWER.fire.heart + 2;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
      for (let r = 6; r < 30; r++) expect(grid.at(CX + dx * r, y, CZ + dz * r), `${dx},${dz} at ${r}`).toBe(0);
    }
  });

  it('lays a glazing pane on the outer face of real glass in every lancet', () => {
    const glazing = tower.glazing!;
    expect(new Set(glazing.map(g => g.opening)).size).toBe(8);
    expect(new Set(glazing.map(g => g.id)).size).toBe(glazing.length);
    for (const pane of glazing) {
      const out = pane.facing === 'east' || pane.facing === 'south' ? 1 : -1, axis = pane.facing === 'east' || pane.facing === 'west' ? 0 : 2;
      const plane = pane.centre[axis]!;
      expect(Number.isInteger(plane)).toBe(true);
      for (let u = pane.centre[2 - axis]! - pane.width / 2; u < pane.centre[2 - axis]! + pane.width / 2; u++) {
        for (let y = pane.centre[1] - pane.height / 2; y < pane.centre[1] + pane.height / 2; y++) {
          const cell = (n: number): number => axis === 0 ? grid.at(n, y, u) : grid.at(u, y, n);
          expect(cell(out === 1 ? plane - 1 : plane), `${pane.id} glass at ${u},${y}`).toBe(MAT.glass);
          expect(cell(out === 1 ? plane : plane - 1), `${pane.id} outside at ${u},${y}`).toBe(0);
          // A real room behind the glass.
          expect(cell(out === 1 ? plane - 2 : plane + 1), `${pane.id} room at ${u},${y}`).toBe(0);
        }
      }
    }
  });

  it('carries the crest over the door with its field flush and its charge proud', () => {
    const { x, y, face } = CROWN_TOWER.crest, rows = crestGrid('heater', 'mountain');
    let charge = 0;
    rows.forEach((row, i) => [...row].forEach((mark, c) => {
      const yy = y + rows.length - 1 - i;
      if (mark === '.') return;
      expect(grid.at(x + c, yy, face)).toBe(MAT.fabricViolet);
      if (mark === 'C') { charge++; expect(grid.at(x + c, yy, face + 1)).toBe(kit.charge); }
      if (mark === 'F') expect(grid.at(x + c, yy, face + 1)).toBe(0);
    }));
    expect(charge).toBeGreaterThan(8);
  });

  it('hangs two banners from the collar, clear of the stem, cut as the recipe says', () => {
    const { x, layer, y } = CROWN_TOWER.banners, z = CZ + layer;
    for (const x0 of x) {
      expect(grid.at(x0, 120, z)).toBe(MAT.fabricViolet);
      expect(grid.at(x0 + 3, 120, z)).toBe(MAT.fabricBlue);
      expect(grid.at(x0, 120, z - 1)).toBe(0);
      expect(grid.at(x0 + 1, y[1], z)).not.toBe(0);
    }
    const foot = (cut: 'square' | 'forked' | 'pennant') => {
      const own = voxels(createCrownTower({ ...options('hearth'), bannerCut: cut }).blueprint);
      return Array.from({ length: 8 }, (_, i) => own.at(x[0] + i, y[0], z) ? '#' : '.').join('');
    };
    expect(foot('square')).toBe('.#.#.#.#');
    expect(foot('forked')).toBe('#......#');
    expect(foot('pennant')).toBe('...##...');
  });

  it('hangs the flag as its own part on the mast\'s hoist', () => {
    const [part] = tower.parts, hoist = tower.mounts.find(m => m.id === part!.mount)!;
    expect(part!.id).toBe('flag');
    expect(part!.blueprint.id).toMatch(/^genesis-crown-tower-flag-/);
    expect(part!.offset.map((v, d) => v + part!.pivot[d]!)).toEqual([...hoist.position]);
    expect(hoist.axis).toEqual([0, 1, 0]);
    expect(at(hoist.position)).toBe(kit.trim);
    const cloth = voxels(part!.blueprint), hoistColumn: Vec3[] = [];
    for (let y = 0; y < cloth.size[1]; y++) for (let z = 0; z < cloth.size[2]; z++) if (cloth.at(0, y, z)) hoistColumn.push([0, y, z]);
    expect(unsupported(part!.blueprint, hoistColumn)).toBe(0);
  });

  it('hangs a bell-garden kingdom\'s bell from its headstock in the head', () => {
    const headstock = belfry.mounts.find(m => m.id === 'bell-headstock')!;
    expect(headstock.axis).toEqual([1, 0, 0]);
    expect(at(headstock.position, bellGrid)).toBe(kit.trim);
    const { bell } = CROWN_TOWER;
    for (let y = bell.y; y < headstock.position[1]; y++) expect(bellGrid.at(bell.x, y, bell.z), `bell at ${y}`).not.toBe(0);
    expect(belfry.sounds.map(s => s.kind)).toEqual(['bell', 'flag', 'wind']);
    expect(tower.sounds.map(s => s.kind)).toEqual(['beacon-fire', 'flag', 'wind']);
    expect(tower.mounts.map(m => m.id)).toEqual(['flag-hoist']);
  });

  it('describes its interactions for the host instead of performing them', () => {
    for (const piece of [tower, belfry]) {
      const anchors = new Set([...piece.doorways, ...piece.walks, ...piece.seats, ...piece.emitters, ...piece.clear, ...piece.mounts].map(a => a.id));
      for (const affordance of piece.affordances) {
        expect(affordance.status).toBe('needs-host');
        for (const id of affordance.uses) expect(anchors.has(id), `${affordance.id} uses ${id}`).toBe(true);
      }
    }
    expect(tower.affordances.map(a => a.kind)).toEqual(['enter', 'sit', 'play-board', 'look-out', 'tend-beacon']);
    expect(belfry.affordances.map(a => a.kind)).toEqual(['enter', 'sit', 'play-board', 'look-out', 'ring-bell']);
    expect(tower.footings.map(f => f.id)).toEqual(['terrace', 'steps', 'outcrop']);
  });
});
