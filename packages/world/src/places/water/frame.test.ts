import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import type { CardinalTurn } from '../../settlement/types';
import { placePieceAnchors, type PieceMeta } from './anchors';
import { bearingOf, CELL, directionToWorld, rectangleToWorld, toLocal, toWorld, yawOf } from './frame';

const TURNS: readonly CardinalTurn[] = [0, 1, 2, 3];

describe('cardinal frames', () => {
  it('match a three.js quarter-turn yaw and invert exactly', () => {
    for (const turn of TURNS) {
      const frame = { origin: [10.5, 2, -4.25] as Vec3, turn }, local: Vec3 = [1.5, .75, 3.25];
      const world = toWorld(frame, local), yaw = yawOf(turn);
      // three.js rotation.y: x' = x cos + z sin, z' = -x sin + z cos.
      expect(world[0]).toBeCloseTo(10.5 + local[0] * Math.cos(yaw) + local[2] * Math.sin(yaw), 12);
      expect(world[2]).toBeCloseTo(-4.25 - local[0] * Math.sin(yaw) + local[2] * Math.cos(yaw), 12);
      expect(toLocal(frame, world)).toEqual(local);
      const outline = rectangleToWorld(frame, [0, 0], [2, 1]);
      let area = 0;
      outline.forEach((a, i) => { const b = outline[(i + 1) % 4]!; area += a[0] * b[1] - b[0] * a[1]; });
      expect(area / 2).toBeCloseTo(2, 12);
    }
  });
});

// SIMULATED: a tiny piece with one of each anchor, in the content metadata shape.
const piece: PieceMeta = {
  blueprint: { size: [16, 8, 8] },
  footings: [{ id: 'foot', box: { from: [0, 2, 0], to: [16, 3, 8] } }],
  walks: [{ id: 'deck', axis: 'x', along: [0, 4], across: [2, 6], tops: [4, 4, 5, 5] }],
  seats: [{ id: 'edge', box: { from: [0, 3, 6], to: [8, 4, 8] }, facing: 'south' }],
  emitters: [{ id: 'lamp', position: [8, 8, 4], reach: 32 }],
  sounds: [{ id: 'creak', kind: 'creak', position: [4, 4, 4] }],
  texts: [{ id: 'name', centre: [8, 6, 0], facing: 'north', width: 8, height: 2 }],
  mounts: [{ id: 'axle', position: [0, 4, 4], axis: [1, 0, 0] }],
};

describe('placed piece anchors', () => {
  it('carry every local anchor into the world with its frame', () => {
    for (const turn of TURNS) {
      const frame = { origin: [100, 3, 50] as Vec3, turn }, placed = placePieceAnchors(frame, piece);
      const at = (cell: Vec3) => toWorld(frame, [cell[0] * CELL, cell[1] * CELL, cell[2] * CELL]);
      expect(placed.walks[0]!.points).toEqual([[.5, 4], [1.5, 4], [2.5, 5], [3.5, 5]].map(([x, y]) => at([x!, y!, 4])));
      expect(placed.walks[0]!.ends).toEqual([at([0, 4, 4]), at([4, 5, 4])]);
      expect(placed.walks[0]!.width).toBe(.5);
      expect(placed.seats[0]!.min[1]).toBe(3 + .5);
      // A south-facing seat faces local +Z, turned with the frame.
      expect(placed.seats[0]!.facing).toBeCloseTo(bearingOf(directionToWorld(turn, [0, 0, 1])), 12);
      expect(placed.emitters[0]).toEqual({ id: 'lamp', position: at([8, 8, 4]), reach: 4 });
      expect(placed.texts[0]!.normal).toEqual(directionToWorld(turn, [0, 0, -1]));
      expect(placed.mounts[0]!.axis).toEqual(directionToWorld(turn, [1, 0, 0]));
      expect(placed.footings[0]!.base).toBe(3 + .25);
      expect(placed.footings[0]!.outline).toEqual(rectangleToWorld(frame, [0, 0], [2, 1]));
    }
  });
});
