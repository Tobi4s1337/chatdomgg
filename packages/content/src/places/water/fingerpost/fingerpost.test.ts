import type { Vec3 } from '@chatdom/shared';
import { describe, expect, it } from 'vitest';
import { MAT, MATERIALS, STYLES, type StyleKey } from '../../../materials';
import { IRON } from '../millrace/craft';
import { meshCost, pieceFailures, unsupported, voxels } from '../piece-checks';
import { assemble, type AssemblyPart, type TextPlane, type WaterPiece } from '../place-piece';
import {
  FINGERPOST, FINGERPOST_BLUEPRINTS, FINGERPOST_DESTINATIONS, FINGERPOST_PIECES, FINGER_ARM_ROOT_SEEDS, createFingerArm,
  createFingerpost, createFingerpostPost, fingerpostFrame, type FingerpostDestination,
} from './index';

const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];
const SLOW = 120_000;
const styleOf = (p: WaterPiece) => STYLE_KEYS.find(s => p.blueprint.styleId === s)!;
const mount = (p: WaterPiece, id: string) => p.mounts.find(m => m.id === id)!;
const top = (p: WaterPiece) => {
  const { at, size } = voxels(p.blueprint);
  for (let y = size[1] - 1; y >= 0; y--) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) if (at(x, y, z)) return y + 1;
  return 0;
};
/** The same quarter turn `turnBox` applies, for a point. */
function turnPoint(p: Vec3, size: Vec3, turn: 0 | 1 | 2 | 3): Vec3 {
  let [u, v] = [p[0], p[2]], [w, d] = [size[0], size[2]];
  for (let i = 0; i < turn; i++) { [u, v] = [v, w - u]; [w, d] = [d, w]; }
  return [u, p[1], v];
}

/** A post with each arm laid on its collar at the given quarter turn, every root on its mount. */
function mounted(style: StyleKey, destinations: readonly FingerpostDestination[], turns: readonly (0 | 1 | 2 | 3)[]) {
  const { post, arms } = createFingerpost(style, destinations), reach = FINGERPOST.arm.size[0];
  const at = reach, size: Vec3 = [2 * reach + FINGERPOST.plan, post.blueprint.size[1], 2 * reach + FINGERPOST.plan];
  const parts: AssemblyPart[] = [{ blueprint: post.blueprint, offset: [at, 0, at] }];
  arms.forEach((arm, i) => {
    const turn = turns[i]!, collar = mount(post, arm.mount).position, root = mount(arm.piece, 'root').position;
    const turned = turnPoint(root, arm.piece.blueprint.size, turn);
    parts.push({ blueprint: arm.piece.blueprint, turn, offset: [at + collar[0] - turned[0], collar[1] - root[1], at + collar[2] - turned[2]] });
  });
  const pieces = [post, ...arms.map(a => a.piece)];
  return { joined: assemble('fingerpost-review', post.blueprint.styleId, 'civic', size, parts), pieces };
}

/** Occupied (x, y) cells of one cell layer of an arm, outside its shoe: the emblem as a viewer sees it. */
function layer(arm: WaterPiece, z: number): Set<string> {
  const { at, size } = voxels(arm.blueprint), out = new Set<string>();
  for (let y = 0; y < size[1]; y++) for (let x = FINGERPOST.arm.shoe[1]; x < size[0]; x++) if (at(x, y, z)) out.add(`${x},${y}`);
  return out;
}

/** Face cells under a text plane and the cells directly in front of them. */
function planeCells(arm: WaterPiece, plane: TextPlane) {
  const { at } = voxels(arm.blueprint), out = { face: [] as number[], front: [] as number[] };
  const face = plane.facing === 'north' ? plane.centre[2] : plane.centre[2] - 1, front = plane.facing === 'north' ? face - 1 : face + 1;
  for (let y = plane.centre[1] - plane.height / 2; y < plane.centre[1] + plane.height / 2; y++) {
    for (let x = plane.centre[0] - plane.width / 2; x < plane.centre[0] + plane.width / 2; x++) {
      out.face.push(at(x, y, face)); out.front.push(at(x, y, front));
    }
  }
  return out;
}

const luminance = (m: number) => {
  const hex = MATERIALS.materials.find(entry => entry.id === m)!.colour, c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};

describe('fingerpost pieces', () => {
  it('every catalogue piece is honest: palette, bounds, support from ground or root, footing and budgets', () => {
    expect(FINGERPOST_PIECES).toHaveLength(15);
    expect(new Set(FINGERPOST_PIECES.map(p => p.blueprint.id)).size).toBe(15);
    expect(FINGERPOST_BLUEPRINTS).toEqual(FINGERPOST_PIECES.map(p => p.blueprint));
    for (const piece of FINGERPOST_PIECES) {
      const arm = piece.blueprint.kind === 'prop';
      expect(pieceFailures(piece, styleOf(piece), !arm), piece.blueprint.id).toEqual([]);
      if (arm) expect(unsupported(piece.blueprint, FINGER_ARM_ROOT_SEEDS), piece.blueprint.id).toBe(0);
      else expect(piece.footings).toHaveLength(1);
    }
  }, SLOW);

  it('posts for one to four arms stand at least 2.6 m and end in a finial on the axis', () => {
    for (const style of STYLE_KEYS) for (let count = 1; count <= 4; count++) {
      const post = createFingerpostPost(style, count);
      expect(pieceFailures(post, style), post.blueprint.id).toEqual([]);
      expect(top(post) * 0.125).toBeGreaterThanOrEqual(2.6);
      const { at } = voxels(post.blueprint), y = top(post) - 1, [ax, az] = FINGERPOST.axis;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) expect(at(ax + dx!, y, az + dz!)).toBe(MAT.brass);
    }
  }, SLOW);

  it('is deterministic', () => {
    expect(JSON.stringify(createFingerpost('grove', ['lake', 'castle']))).toBe(JSON.stringify(createFingerpost('grove', ['lake', 'castle'])));
  });
});

describe('arms and collars', () => {
  it('carries an arm only for each supplied destination, in the order supplied, the first highest', () => {
    for (const list of [['road'], ['lake', 'castle'], ['market', 'road', 'lake']] as FingerpostDestination[][]) {
      const { post, arms } = createFingerpost('tide', list);
      expect(arms.map(a => a.destination)).toEqual(list);
      expect(arms.map(a => a.piece.blueprint.id)).toEqual(list.map(d => `water-tide-finger-${d}`));
      expect(post.mounts.map(m => m.id).sort()).toEqual(arms.map(a => a.mount).sort());
      const heights = arms.map(a => mount(post, a.mount).position[1]);
      expect([...heights].sort((p, q) => q - p)).toEqual(heights);
    }
  });

  it('stacks the arms overhead in bands of their own, so any two bearings may cross without meeting', () => {
    for (let count = 1; count <= 4; count++) {
      const post = createFingerpostPost('hearth', count), frame = fingerpostFrame(count);
      const bands = post.mounts.map(m => {
        const arm = createFingerArm('hearth', 'castle'), root = mount(arm, 'root').position, floor = m.position[1] - root[1];
        return [floor, floor + voxels(arm.blueprint).size[1]] as const;
      });
      for (const [low] of bands) expect(low * 0.125).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < bands.length; i++) {
        expect(post.mounts[i - 1]!.position[1] - post.mounts[i]!.position[1]).toBeGreaterThanOrEqual(4);
        expect(bands[i]![1]).toBeLessThanOrEqual(bands[i - 1]![0]);
      }
      // The iron bands close the stack without entering it.
      expect(frame.bands[0]).toBeLessThan(Math.min(...bands.map(b => b[0])));
      expect(frame.bands[1]).toBeGreaterThanOrEqual(Math.max(...bands.map(b => b[1])));
    }
  });

  it('seats every arm on its collar at each quarter turn, touching the post and no other arm', () => {
    const cases: [StyleKey, (0 | 1 | 2 | 3)[]][] = [
      ['hearth', [0, 0, 0, 0]], ['tide', [1, 1, 1, 1]], ['grove', [2, 2, 2, 2]], ['hearth', [3, 3, 3, 3]], ['tide', [0, 1, 2, 3]],
    ];
    for (const [style, turns] of cases) {
      const { joined, pieces } = mounted(style, FINGERPOST_DESTINATIONS, turns);
      // No two parts share a cell, and the whole assembly stands on the post's ground cells alone.
      expect(meshCost(joined).occupied).toBe(pieces.reduce((n, p) => n + meshCost(p.blueprint).occupied, 0));
      expect(unsupported(joined), `${style} ${turns.join('')}`).toBe(0);
    }
  }, SLOW);
});

describe('emblems and name faces', () => {
  const arms = FINGERPOST_DESTINATIONS.map(d => createFingerArm('hearth', d));
  const [z0, z1] = FINGERPOST.arm.board;

  it('shows each emblem on both faces, standing a cell proud of a darker iron plaque', () => {
    for (const arm of arms) {
      const north = layer(arm, z0 - 1), south = layer(arm, z1), { at } = voxels(arm.blueprint);
      expect(north.size).toBeGreaterThanOrEqual(10);
      expect([...south].sort()).toEqual([...north].sort());
      const xs = [...north].map(k => Number(k.split(',')[0])), ys = [...north].map(k => Number(k.split(',')[1]));
      expect(Math.max(...xs) - Math.min(...xs) + 1).toBeGreaterThanOrEqual(5);
      expect(Math.max(...ys) - Math.min(...ys) + 1).toBe(FINGERPOST.pitch);
      let ink = 0;
      for (const k of north) {
        const [x, y] = k.split(',').map(Number) as [number, number];
        expect(at(x, y, z0)).toBe(IRON);
        ink += luminance(at(x, y, z0 - 1));
      }
      // In greyscale the emblem still stands clear of its plaque.
      expect(ink / north.size - luminance(IRON)).toBeGreaterThan(0.15);
    }
  });

  it('gives the four destinations four different emblem shapes', () => {
    const shapes = arms.map(arm => layer(arm, z0 - 1));
    for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i]!, b = shapes[j]!, differ = [...a].filter(k => !b.has(k)).length + [...b].filter(k => !a.has(k)).length;
      expect(differ, `${FINGERPOST_DESTINATIONS[i]} vs ${FINGERPOST_DESTINATIONS[j]}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('reserves a flat, clean name face on both sides, clear of the emblem and the shoe', () => {
    for (const style of STYLE_KEYS) for (const destination of FINGERPOST_DESTINATIONS) {
      const arm = createFingerArm(style, destination);
      expect(arm.texts.map(t => t.facing).sort()).toEqual(['north', 'south']);
      for (const plane of arm.texts) {
        expect(plane.width).toBeGreaterThanOrEqual(8);
        expect(plane.height).toBeGreaterThanOrEqual(2);
        const { face, front } = planeCells(arm, plane);
        expect(new Set(face), `${arm.blueprint.id}/${plane.id}`).toEqual(new Set([face[0]]));
        expect(face[0]).not.toBe(MAT.air);
        expect(front.every(m => m === MAT.air), `${arm.blueprint.id}/${plane.id}`).toBe(true);
      }
    }
  });
});

describe('refusals', () => {
  it('refuses an empty, repeated, unknown or overfull list and an unknown kit', () => {
    expect(() => createFingerpost('hearth', [])).toThrow(RangeError);
    expect(() => createFingerpost('hearth', ['lake', 'lake'])).toThrow(RangeError);
    expect(() => createFingerpost('hearth', ['mine' as FingerpostDestination])).toThrow(RangeError);
    expect(() => createFingerpost('hearth', [...FINGERPOST_DESTINATIONS, 'castle'])).toThrow(RangeError);
    expect(() => createFingerpost('marsh' as StyleKey, ['road'])).toThrow(RangeError);
    expect(() => createFingerArm('tide', 'harbour' as FingerpostDestination)).toThrow(RangeError);
    expect(() => createFingerpostPost('grove', 5)).toThrow(RangeError);
  });
});
