import { describe, expect, it } from 'vitest';
import { stepPlayer } from '../../../world/src/movement/step';
import { supported } from '../../../world/src/movement/collide';
import { compileCollisionWorld, type CollisionBox } from './index';

const bounds = (min: CollisionBox['min'], max: CollisionBox['max']): CollisionBox => ({ min, max });
const hits = (world: ReturnType<typeof compileCollisionWorld>, min: CollisionBox['min'], max: CollisionBox['max']) => world.query(bounds(min, max));

describe('founded collision compiler', () => {
  it('keeps carved openings, physical glass and terrain support under cardinal placement, and blocks unknown space', () => {
    const world = compileCollisionWorld({
      revision: 42,
      materials: { materials: [{ id: 0, solid: false }, { id: 1, solid: true }, { id: 2, solid: true }] },
      assets: [{ assetHash: 'wall', blueprint: { lattice: 'build', size: [16, 16, 1], boxes: [
        { from: [0, 0, 0], to: [16, 16, 1], material: 1 },
        { from: [4, 0, 0], to: [12, 14, 1], material: 0 },
        { from: [0, 8, 0], to: [3, 12, 1], material: 2 },
      ] } }],
      placements: [{ id: 'wall', assetHash: 'wall', position: [2, 0, 2], rotation: 1 }],
      terrain: { origin: [-2, -2, -2], columns: 16, rows: 16, heights: Array(256).fill(0), ceilingY: 10 },
    });
    expect(supported({ x: 0, y: 0, z: 0 }, world)).toBe(true);
    expect(hits(world, [2.01, .1, .7], [2.1, 1.7, 1.3])).toEqual([]); // rotated door
    expect(hits(world, [2.01, 1.01, 1.64], [2.1, 1.4, 1.95]).length).toBeGreaterThan(0); // glass
    expect(hits(world, [2.125, 1.01, 1.64], [2.2, 1.4, 1.95])).toEqual([]); // touching the outer face is not overlap
    expect(hits(world, [-3, 0, 0], [-2.5, 1, .5]).length).toBeGreaterThan(0);
    const query = bounds([1.9, -.1, -.1], [2.2, 2.1, 2.1]);
    const first = world.query(query);
    expect(world.query(query)).toEqual(first);
    expect(new Set(first.map(b => JSON.stringify(b))).size).toBe(first.length);
    expect(Object.isFrozen(first[0]?.min)).toBe(true);
    expect(() => compileCollisionWorld({ revision: 1, materials: { materials: [{ id: 0, solid: false }] }, assets: [{ assetHash: 'x', blueprint: { lattice: 'build', size: [1, 1, 1], boxes: [{ from: [0, 0, 0], to: [1, 1, 1], material: 7 }] } }], placements: [], terrain: { origin: [0, -1, 0], columns: 1, rows: 1, heights: [0], ceilingY: 2 } })).toThrow();
  });
  it('climbs a compiled half-metre slab and remains supported through authority replay', () => {
    const source = { revision: 4, materials: { materials: [{ id: 0, solid: false }, { id: 1, solid: true }] },
      assets: [{ assetHash: 'slab', blueprint: { lattice: 'build' as const, size: [16, 4, 16] as const,
        boxes: [{ from: [0, 0, 0] as const, to: [16, 4, 16] as const, material: 1 }] } }],
      placements: [{ id: 'slab', assetHash: 'slab', position: [1, 0, -1] as const, rotation: 0 }],
      terrain: { origin: [-4, -2, -4] as const, columns: 16, rows: 16, heights: Array(256).fill(0), ceilingY: 10 } };
    const server = compileCollisionWorld(source), client = compileCollisionWorld(source);
    const a = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: 4 };
    const b = { ...a };
    for (let tick = 0; tick < 72; tick++) {
      const input = { moveX: tick < 12 ? 127 : 0, moveZ: 0, buttons: 0, yaw: 0, collisionRevision: 4 };
      stepPlayer(a, input, 1 / 30, server); stepPlayer(b, input, 1 / 30, client);
      expect(a).toEqual(b);
    }
    expect(a.x).toBeGreaterThan(1); expect(a.x).toBeLessThan(3);
    expect(a.y).toBe(.5); expect(a.grounded).toBe(true);
  });

});
