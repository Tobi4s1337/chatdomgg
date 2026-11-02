import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WALK_BODY, WALK_HZ, type PlayerState } from '@chatdom/shared/realm';
import type { Vec3 } from '@chatdom/shared';
import { decodeFoundedScene } from '../../../../../packages/world/src/founded-world/validate';
import { compileFoundedScene, foundedGroundAt } from '../../../../../packages/world/src/founded-world/collision';
import { grandKingdomLand } from '../../../../../packages/world/src/grand/kingdom/ground';
import { createFoundedInteractionRegistry, foundedInstalledHomes, homeDoorway, homeThreshold, settleOnFloor, standingClear } from '../../../../../packages/world/src/interactions';
import { transformCardinalPoint } from '../../../../../packages/world/src/settlement/geometry';
import { stepPlayer } from '../../../../../packages/world/src/movement/step';
import { giftRouteOf } from '../moments/anchors';

const scenePath = process.env.GRAND_FOUNDED_SCENE, receiptPath = process.env.GRAND_FOUNDED_RECEIPT;
const acceptance = it.skipIf(!scenePath || !receiptPath);
async function fixture() {
  const scene = await decodeFoundedScene(new Uint8Array(readFileSync(scenePath!)), JSON.parse(readFileSync(receiptPath!, 'utf8')));
  const world = compileFoundedScene(scene);
  return { scene, world, land: grandKingdomLand(scene, world) };
}

acceptance('walks through a real installed home portal and stops at its adjacent wall', async () => {
  const { scene, world } = await fixture();
  // The public founded scene has no ownership data. Select the first actual plot, never infer the broadcaster.
  const plots = scene.placements.filter(p => p.plotId && scene.assets.some(a => a.assetHash === p.assetHash && a.blueprint.kind === 'home'))
    .map(p => p.plotId!).sort();
  expect(plots.length).toBeGreaterThan(0);
  const revisions = new Map([[plots[0]!, 'acceptance-revision']]);
  const installed = foundedInstalledHomes(scene, revisions);
  expect(installed.missing).toEqual([]);
  expect(installed.homes).toHaveLength(1);
  const home = installed.homes[0]!, threshold = homeThreshold(home, world);
  const registry = createFoundedInteractionRegistry(scene, world, revisions);
  expect(registry.home(home.plotId)).toEqual(threshold);
  expect(threshold.blocked, 'installed home threshold').toBeNull();
  const door = threshold.placement!.anchors.find(a => a.kind === 'home-door')!;
  expect(registry.get(door.id)?.rest).toEqual(door.rest);
  const outside = door.approach, inside = door.rest!;
  const move = (start: Vec3, dx: number, dz: number, ticks: number): PlayerState => {
    const state: PlayerState = { x: start[0], y: start[1], z: start[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: world.revision };
    for (let i = 0; i < ticks; i++) stepPlayer(state, { moveX: Math.round(dx * 127), moveZ: Math.round(dz * 127), buttons: 0, yaw: 0, collisionRevision: world.revision }, 1 / WALK_HZ, world);
    return state;
  };
  const dx = inside[0] - outside[0], dz = inside[2] - outside[2], length = Math.hypot(dx, dz);
  expect(length).toBeGreaterThan(.1);
  const nx = dx / length, nz = dz / length;
  const portal = homeDoorway(home.blueprint)!;
  const plane = transformCardinalPoint(home.position, home.rotation, [(portal.from[0] + portal.to[0]) * .125 / 2, portal.from[1] * .125, portal.to[2] * .125]);
  const signed = (x: number, z: number) => (x - plane[0]) * nx + (z - plane[2]) * nz;
  const walked = move(outside, nx, nz, Math.ceil(length / 3 * WALK_HZ) + 15);
  expect(signed(walked.x, walked.z), 'body has crossed the facade').toBeGreaterThanOrEqual(WALK_BODY.radius);
  expect(standingClear(world, [walked.x, walked.y, walked.z]), 'inside body is supported and clear').toBe(true);
  // Shift parallel to the façade to a body-width beyond the opening's edge.
  const shift = (portal.to[0] - portal.from[0]) * .125 / 2 + WALK_BODY.radius + .1;
  const origin = transformCardinalPoint([0, 0, 0], home.rotation, [shift, 0, 0]);
  const wallStart = settleOnFloor(world, [outside[0] + origin[0] - nx, outside[1], outside[2] + origin[2] - nz]);
  expect(wallStart, 'adjacent wall approach').not.toBeNull();
  const wall = move(wallStart!, nx, nz, Math.ceil((length + 1) / 3 * WALK_HZ) + 30);
  expect(signed(wall.x, wall.z), 'body remains outside the facade').toBeLessThanOrEqual(-WALK_BODY.radius + 1e-5);
  const stopped = move([wall.x, wall.y, wall.z], nx, nz, WALK_HZ);
  expect(Math.hypot(stopped.x - wall.x, stopped.z - wall.z), 'further steps remain stopped').toBeLessThan(.001);
  expect(standingClear(world, [stopped.x, stopped.y, stopped.z]), 'wall body is supported and clear').toBe(true);
  console.info(JSON.stringify({ plane, outside, walked: [walked.x, walked.y, walked.z], wallStart, stopped: [stopped.x, stopped.y, stopped.z] }));
}, 60_000);

acceptance('offers supported, unobstructed Forge, plaza, gate and raid entrance on the physical land', async () => {
  const { scene, world, land } = await fixture();
  const anvil = createFoundedInteractionRegistry(scene, world).records.find(record => record.target.kind === 'anvil');
  expect(anvil, 'registered Forge anvil').toBeDefined();
  expect(land.forge.approach, 'land facade and interaction registry Forge approach').toEqual(anvil!.target.approach);
  const route = giftRouteOf(scene.plan);
  expect(route, 'real raid route').not.toBeNull();
  const points = { forge: land.forge.approach, plaza: land.moments.plaza, castleGate: land.moments.castleGate, raidEntrance: route!.inbound[0] };
  for (const [label, point] of Object.entries(points)) {
    expect(point, `${label} exists`).toBeDefined();
    expect(point, `${label} exists`).not.toBeNull();
    const p = point!;
    expect(land.groundAt(p[0], p[2]), `${label} facade matches founded ground`).toEqual(foundedGroundAt(scene.plan, p[0], p[2]));
    expect(standingClear(world, p), `${label} supported and body clear at ${p.join(',')}`).toBe(true);
  }
}, 60_000);
