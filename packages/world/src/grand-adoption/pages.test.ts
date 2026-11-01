import { expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { WALK_BODY, WALK_HZ, type PlayerState, type SolidBox } from '@chatdom/shared/realm';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import { stepPlayer } from '../movement/step';
import { createPagedCollisionWorld, type PhysicalCollisionPage } from './pages';

it('preserves the compiled doorway across negative/positive pages, blocks unknown space and replaces coverage atomically', () => {
  const revision = 7;
  // One existing compiler resolves the real ordered carve. Its known region exactly covers these two pages.
  // Query only page interiors to extract already resolved solids: no independent world boundary is combined.
  const founded = compileCollisionWorld({
    revision, materials: { materials: [{ id: 0, solid: false }, { id: 1, solid: true }] },
    assets: [{ assetHash: 'reviewed-door-wall', blueprint: { lattice: 'build', size: [16, 32, 32], boxes: [
      { from: [0, 0, 0], to: [1, 24, 32], material: 1 },
      { from: [0, 0, 12], to: [1, 16, 20], material: 0 },
    ] } }],
    placements: [{ id: 'same-home', assetHash: 'reviewed-door-wall', position: [0, 1, -10], rotation: 0 }],
    terrain: { origin: [-16, 0, -16], columns: 64, rows: 32, heights: new Float32Array(64 * 32).fill(1), ceilingY: 16 },
  });
  const pages: PhysicalCollisionPage[] = [-1, 0].map(x => {
    const bounds: SolidBox = { min: [x * 16, 0, -16], max: [(x + 1) * 16, 16, 0] };
    const solids = founded.query(bounds).map(solid => ({
      min: solid.min.map((n, i) => Math.max(n, bounds.min[i]!)) as unknown as Vec3,
      max: solid.max.map((n, i) => Math.min(n, bounds.max[i]!)) as unknown as Vec3,
    }));
    return { coordinate: [x, 0, -1], revision, solids };
  });
  const server = createPagedCollisionWorld(revision, pages);
  const client = createPagedCollisionWorld(revision, [...pages].reverse().map(page => ({ ...page, solids: [...page.solids].reverse() })));
  const at = (z: number): PlayerState => ({ x: -2, y: 1, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: revision });
  const authority = at(-8), predicted = at(-8), wall = at(-9);
  const input = { moveX: 127, moveZ: 0, buttons: 0, yaw: 0, collisionRevision: revision };
  for (let tick = 0; tick < 180; tick++) {
    stepPlayer(authority, input, 1 / WALK_HZ, server);
    stepPlayer(predicted, input, 1 / WALK_HZ, client);
    stepPlayer(wall, input, 1 / WALK_HZ, server);
    expect(predicted).toEqual(authority);
  }
  expect(authority.x).toBeCloseTo(16 - WALK_BODY.radius, 10); // Crossed the actual door; held before the missing page.
  expect(authority.y).toBe(1);
  expect(authority.grounded).toBe(true);
  expect(wall.x).toBeCloseTo(-WALK_BODY.radius, 10); // The adjacent resolved wall still blocks.
  expect(server.query({ min: [-16, 5, -16], max: [0, 6, 0] })).toEqual([]);
  expect(server.query({ min: [0, 5, -16], max: [16, 6, 0] })).toEqual([]);
  const seam: SolidBox = { min: [-.5, .5, -8.25], max: [.5, 3, -7.75] };
  expect(client.query(seam)).toEqual(server.query(seam));
  const unknown: SolidBox = { min: [16, 2, -8], max: [17, 3, -7] };
  expect(server.query(unknown)).toEqual([{ min: [16, 0, -16], max: [32, 16, 0] }]);
  const huge: SolidBox = { min: [-1e100, -1e100, -1e100], max: [1e100, 1e100, 1e100] };
  expect(server.query(huge)).toEqual([huge]); // Constant-size conservative answer, before page enumeration.
  const tooManyPages: SolidBox = { min: [0, 2, -8], max: [16 * 65, 3, -7] };
  expect(server.query(tooManyPages)).toEqual([tooManyPages]); // Safe coordinates still obey the work bound.
  expect(() => createPagedCollisionWorld(8, pages)).toThrow(/revision/);
  expect(() => createPagedCollisionWorld(revision, [pages[0]!, pages[0]!])).toThrow(/Duplicate/);
  expect(() => createPagedCollisionWorld(revision, [{ coordinate: [0, 0, 0], revision, solids: [seam] }])).toThrow(/boundary/);

  const next = createPagedCollisionWorld(8, [...pages.map(page => ({ ...page, revision: 8 })), {
    coordinate: [1, 0, -1], revision: 8, solids: [{ min: [16, 0, -16], max: [32, 1, 0] }],
  }]);
  expect(next.query(unknown)).toEqual([]);
  expect(server.query(unknown)).toHaveLength(1); // Preparing a successor cannot change the installed revision.
  const held = { ...authority };
  stepPlayer(authority, input, 1 / WALK_HZ, next);
  expect(authority).toEqual(held); // Existing movement handshake refuses stale revision.
  authority.collisionRevision = 8;
  for (let tick = 0; tick < 15; tick++) stepPlayer(authority, { ...input, collisionRevision: 8 }, 1 / WALK_HZ, next);
  expect(authority.x).toBeGreaterThan(16);
  // Installation owns its copies, including empty-page state; callers cannot unload a floor by mutating input.
  (pages[0]!.solids as SolidBox[]).length = 0;
  expect(server.query({ min: [-2, .5, -9], max: [-1, 1.5, -8] }).length).toBeGreaterThan(0);
});
