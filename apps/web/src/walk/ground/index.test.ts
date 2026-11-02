import { describe, expect, it } from 'vitest';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { createWalkerGround } from './index';

const FLOOR = -16;

/** Terrain columns 1 m high everywhere in [-8, 8), a 2 m deck from (2, 2) with its top at 1.5 m. */
function world(revision = 1): CollisionWorld {
  const solids: SolidBox[] = [];
  for (let x = -8; x < 8; x += .5) for (let z = -8; z < 8; z += .5) solids.push({ min: [x, FLOOR, z], max: [x + .5, 1, z + .5] });
  solids.push({ min: [2, 1, 2], max: [4, 1.5, 4] });
  return {
    revision,
    query: bounds => solids.filter(s => s.min[0] < bounds.max[0] && s.max[0] > bounds.min[0] && s.min[1] < bounds.max[1]
      && s.max[1] > bounds.min[1] && s.min[2] < bounds.max[2] && s.max[2] > bounds.min[2]),
  };
}
/** The drawn terrain a little above the 1 m physics columns, as the smoothed surface often is. */
const surfaceAt = (x: number, z: number) => ({ drawnY: 1.1 + .01 * x + .005 * z });

describe('walker ground for the renderer', () => {
  it('draws walkers on terrain on the drawn surface and walkers on a deck at their physical height', () => {
    let current: CollisionWorld | null = world();
    const ground = createWalkerGround({ surfaceAt, world: () => current, terrainFloorY: FLOOR });
    expect(ground.bodyY('a', { x: -2, y: 1, z: 0 }, 1 / 60)).toBeCloseTo(1.08, 12);
    expect(ground.bodyY('b', { x: 3, y: 1.5, z: 3 }, 1 / 60)).toBe(1.5);
    // The gait gets the drawn ground only for the walker that is drawn on it.
    expect(ground.groundFor('a')).toBe(ground.drawnAt);
    expect(ground.groundFor('b')).toBeUndefined();
    expect(ground.groundFor('nobody')).toBeUndefined();
    // And the deck as a floor for every walker's soles.
    expect(ground.floorAt(3, 3, 2)).toBe(1.5);
    expect(ground.floorAt(-2, 0, 2)).toBeNull();
    // Without a loaded world nothing is trusted: the body is drawn where physics says.
    current = null;
    expect(ground.bodyY('c', { x: -2, y: 1, z: 0 }, 1 / 60)).toBe(1);
    expect(ground.floorAt(3, 3, 2)).toBeNull();
  });

  it('leaves seated walkers and the walker in the air at their physical height', () => {
    const loaded = world(), ground = createWalkerGround({ surfaceAt, world: () => loaded, terrainFloorY: FLOOR });
    expect(ground.bodyY('seated', { x: -2, y: 1, z: 0, posed: true }, 1 / 60)).toBe(1);
    expect(ground.bodyY('jumping', { x: -2, y: 1.6, z: 0, grounded: false }, 1 / 60)).toBe(1.6);
  });

  it('keeps every walker continuous across a new collision revision, and forgets walkers that left', () => {
    let current = world(1);
    const ground = createWalkerGround({ surfaceAt, world: () => current, terrainFloorY: FLOOR });
    for (let n = 0; n < 10; n++) ground.bodyY('a', { x: -2, y: 1, z: 0 }, 1 / 60);
    expect(ground.groundFor('a')).toBe(ground.drawnAt);
    current = world(2);
    // The new revision is read (a deck built here would fade the walker out); this spot is still terrain.
    expect(ground.bodyY('a', { x: -2, y: 1, z: 0 }, 1 / 60)).toBeCloseTo(1.08, 12);
    expect(ground.bodyY('d', { x: 3, y: 1.5, z: 3 }, 1 / 60)).toBe(1.5);
    ground.retain(new Set(['b']));
    expect(ground.groundFor('a')).toBeUndefined();
    for (let n = 0; n < 3; n++) ground.bodyY('b', { x: -2, y: 1, z: 0 }, 1 / 60);
    ground.reset('b');
    expect(ground.groundFor('b')).toBeUndefined();
  });

  it('falls back to the drawn terrain tiles when the land seam has no surface yet', () => {
    const loaded = world(), ground = createWalkerGround({ world: () => loaded, terrainFloorY: FLOOR });
    // No scene: nothing drawn answers, so nothing moves.
    expect(ground.bodyY('a', { x: -2, y: 1, z: 0 }, 1 / 60)).toBe(1);
    expect(ground.drawnAt(-2, 0)).toBeNull();
  });
});
