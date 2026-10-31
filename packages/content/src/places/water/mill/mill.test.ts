import { describe, expect, it } from 'vitest';
import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { pieceFailures, unsupported, voxels } from '../piece-checks';
import { MILL, MILL_BLUEPRINTS, MILL_PIECES, createMill } from './index';

const STYLE_KEYS = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];
const SLOW = 120_000;
const TWINE = MAT.thatch;
const W: number = MILL.size[0], H: number = MILL.size[1], D: number = MILL.size[2];
const [d0, d1] = MILL.door.x;
type At = (x: number, y: number, z: number) => number;

/** Face-connected groups of the cells `keep` accepts inside a box, as lists of cells. */
function components(at: At, from: readonly number[], to: readonly number[], keep: (m: number) => boolean) {
  const seen = new Set<string>(), groups: [number, number, number][][] = [];
  for (let x = from[0]!; x < to[0]!; x++) for (let y = from[1]!; y < to[1]!; y++) for (let z = from[2]!; z < to[2]!; z++) {
    if (seen.has(`${x},${y},${z}`) || !keep(at(x, y, z))) continue;
    const group: [number, number, number][] = [[x, y, z]];
    seen.add(`${x},${y},${z}`);
    for (let head = 0; head < group.length; head++) {
      const [cx, cy, cz] = group[head]!;
      for (const [nx, ny, nz] of [[cx - 1, cy, cz], [cx + 1, cy, cz], [cx, cy - 1, cz], [cx, cy + 1, cz], [cx, cy, cz - 1], [cx, cy, cz + 1]] as const) {
        const inside = nx >= from[0]! && nx < to[0]! && ny >= from[1]! && ny < to[1]! && nz >= from[2]! && nz < to[2]!;
        if (!inside || seen.has(`${nx},${ny},${nz}`) || !keep(at(nx, ny, nz))) continue;
        seen.add(`${nx},${ny},${nz}`);
        group.push([nx, ny, nz]);
      }
    }
    groups.push(group);
  }
  return groups;
}

const carve = (b: VoxelBlueprint, x: number, y: number, z: number): VoxelBlueprint =>
  ({ ...b, boxes: [...b.boxes, { from: [x, y, z], to: [x + 1, y + 1, z + 1], material: MAT.air }] });

describe('the mill', () => {
  it('one honest mill per kit: palette, bounds, support, footings, walks and budgets', () => {
    expect(MILL_PIECES).toHaveLength(3);
    expect(new Set(MILL_PIECES.map(p => p.blueprint.id)).size).toBe(3);
    expect(MILL_BLUEPRINTS).toEqual(MILL_PIECES.map(p => p.blueprint));
    for (const style of STYLE_KEYS) {
      const piece = createMill(style);
      expect(pieceFailures(piece, style), style).toEqual([]);
      expect(piece.blueprint.kind).toBe('civic');
      expect(piece.blueprint.lattice).toBe('build');
      expect(piece.blueprint.boxes.length).toBeLessThanOrEqual(2000);
    }
  }, SLOW);

  it('stands about nine metres to its chimney pot, and the pot reaches the top row', () => {
    expect(H).toBeGreaterThanOrEqual(68);
    expect(H).toBeLessThanOrEqual(76);
    for (const style of STYLE_KEYS) {
      const { at, size } = voxels(createMill(style).blueprint);
      expect(size).toEqual([...MILL.size]);
      let top = false;
      for (let x = 0; x < W && !top; x++) for (let z = 0; z < D && !top; z++) top = at(x, H - 1, z) !== MAT.air;
      expect(top, style).toBe(true);
    }
  }, SLOW);

  it('its windows are glazed but claim nobody: no presence anchors, no lights, no lettering', () => {
    for (const style of STYLE_KEYS) {
      const piece = createMill(style);
      expect(piece.blueprint.windows).toEqual([]);
      expect(piece.emitters).toEqual([]);
      expect(piece.texts).toEqual([]);
      expect(piece.blueprint.boxes.some(b => b.material === MAT.glass), style).toBe(true);
    }
  });

  it('the chimney jogs sideways at least twice on its way up and still clears the ridge', () => {
    for (const style of STYLE_KEYS) {
      const { at } = voxels(createMill(style).blueprint);
      const flue: number[] = style === 'grove' ? [MAT.terracotta, MAT.bark] : [STYLES[style].stone, MAT.darkStone];
      // The stack stands on the back half of the wheel-side slope; its centre row by row, in half cells.
      const centres: string[] = [];
      for (let y = MILL.chimney.base; y < MILL.chimney.cap; y++) {
        let x0 = W, x1 = -1, z0 = D, z1 = -1;
        for (let x = 24; x < W; x++) for (let z = 4; z < 20; z++) {
          if (!flue.includes(at(x, y, z))) continue;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        }
        centres.push(`${x0 + x1},${z0 + z1}`);
      }
      const shifts = centres.filter((c, i) => i > 0 && c !== centres[i - 1]).length;
      expect(shifts, style).toBeGreaterThanOrEqual(2);
      let capAbove = false;
      for (let x = 22; x < W; x++) for (let z = 4; z < 20; z++) capAbove ||= at(x, MILL.chimney.cap + 1, z) !== MAT.air;
      expect(capAbove && MILL.chimney.cap > MILL.ridge, style).toBe(true);
    }
  }, SLOW);

  it('the lucam oversails the gable, and its sack hangs from the beam by the rope alone', () => {
    for (const style of STYLE_KEYS) {
      const bp = createMill(style).blueprint, { at } = voxels(bp);
      let reach = 0;
      for (let x = 0; x < W; x++) for (let y = MILL.eaves; y < H; y++) for (let z = 0; z < D; z++) if (at(x, y, z)) reach = Math.max(reach, z);
      expect(reach, style).toBeGreaterThan(MILL.body.z[1] + 6);
      // Cloth hangs above the rope's foot with nothing but air under it to the yard.
      const [rx, rz] = MILL.lucam.rope;
      let lowest: number = H;
      for (let y = H - 1; y >= 0; y--) if (at(rx, y, rz) === MAT.cloth) lowest = y;
      expect(lowest, style).toBeGreaterThan(12);
      for (let y = 1; y < lowest; y++) expect(at(rx, y, rz), `${style} y${y}`).toBe(MAT.air);
      // Cut the rope and the sack falls: the rope is its only support.
      let rope = -1;
      for (let y = lowest; y < H; y++) if (at(rx, y, rz) === TWINE && at(rx, y + 1, rz) === TWINE) { rope = y + 2; break; }
      expect(rope, style).toBeGreaterThan(0);
      expect(unsupported(carve(bp, rx, rope, rz)), style).toBeGreaterThan(0);
    }
  }, SLOW);

  it('the door is set back in its jambs, and flour lies on its boards, its sill and the yard', () => {
    const { leaf, face, y: [dy0, dy1] } = MILL.door;
    expect(face - leaf).toBeGreaterThanOrEqual(4);
    for (const style of STYLE_KEYS) {
      const { at } = voxels(createMill(style).blueprint);
      // The leaf's back boards close the whole opening; in front of its straps the reveal is open to the head's
      // stone shoulders.
      for (let x = d0; x < d1; x++) for (let y = dy0; y < dy1 - 1; y++) {
        expect(at(x, y, leaf - 1), `${style} leaf ${x},${y}`).not.toBe(MAT.air);
        for (let z = leaf + 2; z < face; z++) expect(at(x, y, z), `${style} ${x},${y},${z}`).toBe(MAT.air);
      }
      const cream = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
        let n = 0;
        for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) if (at(x, y, z) === MAT.cream) n++;
        return n;
      };
      expect(cream(d0, d1, dy0, dy0 + 4, leaf, leaf + 1), `${style} boards`).toBeGreaterThan(0);
      expect(cream(d0 - 2, d1 + 2, 0, 3, leaf + 2, face + 5), `${style} threshold`).toBeGreaterThan(0);
      expect(cream(d0 - 2, d1 + 2, 0, 1, face + 5, D), `${style} yard`).toBeGreaterThan(0);
    }
  }, SLOW);

  it('sacks stand and lie by the door, tied, every one resting on the yard', () => {
    for (const style of STYLE_KEYS) {
      const { at } = voxels(createMill(style).blueprint);
      const front = [0, 0, MILL.door.face] as const, low = [W, 12, D] as const;
      const ties = components(at, front, low, m => m === TWINE);
      expect(ties.length, style).toBeGreaterThanOrEqual(3);
      expect(ties.length, style).toBeLessThanOrEqual(5);
      // Cloth and twine before the door form piles; each pile reaches down to y = 0.
      const piles = components(at, front, low, m => m === MAT.cloth || m === TWINE);
      expect(piles.length, style).toBeGreaterThan(0);
      for (const pile of piles) expect(pile.some(([, y]) => y === 0), `${style} pile at ${pile[0]!.join(',')}`).toBe(true);
      // One sack lies open: flour spills from cloth onto the yard.
      let spilt = false;
      for (let x = 0; x < W; x++) for (let z = MILL.door.face; z < D; z++) {
        if (at(x, 0, z) !== MAT.cream) continue;
        spilt ||= [at(x + 1, 0, z), at(x - 1, 0, z), at(x, 0, z + 1), at(x, 0, z - 1), at(x, 1, z)].includes(MAT.cloth);
      }
      expect(spilt, style).toBe(true);
    }
  }, SLOW);

  it('the shaft mount sits at the boss on the wheel-side face, its line free to run out to the wheel', () => {
    const [sx, sy, sz] = MILL.shaft;
    expect(sx).toBe(W);
    expect(sx).toBeGreaterThan(MILL.wheelFace);
    for (const style of STYLE_KEYS) {
      const piece = createMill(style), { at } = voxels(piece.blueprint);
      expect(piece.mounts).toEqual([{ id: 'shaft', position: [...MILL.shaft], axis: [1, 0, 0] }]);
      // The plinth's face is the wheel-side plane, and the boss stands proud of it, brass outermost.
      expect(at(MILL.wheelFace - 1, sy - 4, sz), style).not.toBe(MAT.air);
      expect(at(MILL.wheelFace, sy - 4, sz), style).not.toBe(MAT.air);
      for (const [dy, dz] of [[1, 0], [-2, 0], [0, 1], [0, -2]] as const) expect(at(sx - 1, sy + dy, sz + dz), style).toBe(MAT.brass);
      // The socket runs from the brass back into the bearing stone.
      for (let x = MILL.wheelFace - 1; x < sx; x++) expect(at(x, sy, sz), `${style} x${x}`).toBe(MAT.air);
      expect(at(MILL.wheelFace - 2, sy, sz), style).not.toBe(MAT.air);
    }
  }, SLOW);

  it('is the same mill every time, and refuses a kit it does not know', () => {
    expect(createMill('grove')).toEqual(createMill('grove'));
    expect(() => createMill('nope' as StyleKey)).toThrow(RangeError);
  });
});
