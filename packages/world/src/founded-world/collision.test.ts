import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WALK_BODY, WALK_HZ, type CollisionWorld, type PlayerState } from '@chatdom/shared/realm';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import { foundedAnvilPosition } from '../interactions/founded';
import { stepPlayer } from '../movement/step';
import { compileFoundedScene, FOUNDED_ANVIL_SOLIDS, FOUNDED_PHYSICS_VERSION, sampleFoundedTerrain } from './collision';
import type { RealmFoundedScene } from './types';

const scene = JSON.parse(readFileSync(new URL('../../../../apps/realm/src/founded/artifacts/simulated-town.scene.json', import.meta.url), 'utf8')) as RealmFoundedScene;
const CELL = .0625;

/** The same compile without the anvil: the control for every walk below. */
const withoutAnvil = (): CollisionWorld => compileCollisionWorld({ revision: scene.collisionRevision, materials: scene.materials,
  assets: scene.assets, placements: scene.placements, terrain: sampleFoundedTerrain(scene.plan) });

/** Walk toward -Z from the anvil's approach for three seconds and return where the body ends. */
function walkInto(world: CollisionWorld, x: number): PlayerState {
  const anvil = foundedAnvilPosition(scene);
  const s: PlayerState = { x, y: anvil[1], z: anvil[2] + 1.7, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0,
    collisionRevision: world.revision };
  for (let tick = 0; tick < WALK_HZ * 3; tick++) stepPlayer(s, { moveX: 0, moveZ: -127, buttons: 0, yaw: 0, collisionRevision: world.revision }, 1 / WALK_HZ, world);
  return s;
}

describe('the Forge anvil is a compiled solid (play SEAMS A2 item 1)', () => {
  it('names the static solids in the physics identity, so the collision revision changes with them', () => {
    expect(FOUNDED_PHYSICS_VERSION).toMatch(/\/founded-anvil:1$/);
  });

  it('fills the hero anvil\'s footprint from the street to its 1.43 m face', () => {
    const world = compileFoundedScene(scene), [x, y, z] = foundedAnvilPosition(scene);
    const hits = world.query({ min: [x - .5, y + .2, z - .3], max: [x + .5, y + 1.4, z + .3] });
    expect(hits.length).toBeGreaterThan(0);
    const top = Math.max(...world.query({ min: [x - .1, y, z - .1], max: [x + .1, y + 3, z + .1] }).map(box => box.max[1]));
    expect(top).toBeCloseTo(y + 1.43, 3);
    // The footprint stays the drawn one: nothing solid above the face or beyond the horn and the block.
    const [block, iron] = FOUNDED_ANVIL_SOLIDS;
    expect(world.query({ min: [x - 3, y + 1.5, z - 3], max: [x + 3, y + 2.5, z + 3] })).toHaveLength(0);
    expect(world.query({ min: [x + iron.to[0] * CELL + .05, y + .2, z - .3], max: [x + 3, y + 1.4, z + .3] })).toHaveLength(0);
    expect(world.query({ min: [x - .3, y + .2, z + block.to[2] * CELL + .05], max: [x + .3, y + 1.4, z + 3] })).toHaveLength(0);
  }, 60_000);

  it('stops a walker at the anvil through stepPlayer, where the same walk without it passes', () => {
    const front = foundedAnvilPosition(scene)[2] + FOUNDED_ANVIL_SOLIDS[0].to[2] * CELL;
    const stopped = walkInto(compileFoundedScene(scene), 0);
    expect(stopped.z).toBeGreaterThanOrEqual(front + WALK_BODY.radius - 1e-3);
    expect(stopped.z).toBeLessThan(front + WALK_BODY.radius + .1);
    expect(walkInto(withoutAnvil(), 0).z).toBeLessThan(front - 1);
  }, 60_000);

  it('leaves the approach the Forge offers standing clear', () => {
    const world = compileFoundedScene(scene), [x, y, z] = foundedAnvilPosition(scene);
    expect(world.query({ min: [x - WALK_BODY.radius, y + .1, z + 1.7 - WALK_BODY.radius],
      max: [x + WALK_BODY.radius, y + WALK_BODY.height, z + 1.7 + WALK_BODY.radius] })).toHaveLength(0);
  }, 60_000);

  it('refuses a scene that also places the anvil, so it is never drawn or solid twice', () => {
    const doubled = { ...scene, placements: [...scene.placements, { ...scene.placements[0]!, id: 'forge:anvil' }] };
    expect(() => compileFoundedScene(doubled)).toThrow(/compiled solid, not a placement/);
  });
});
