import { expect, it } from 'vitest';
import type { PlayerState } from '@chatdom/shared/realm';
import { stepPlayer } from '@chatdom/world/movement';
import { createTavernInterior, TAVERN_ENTRY } from '../../../realm/src/games/interior';
import { seatApproachDriver } from './walker';

it.each([1, 4, 8, 12, 15, 30])('reaches every real chair with one test input sampled per %i fixed movement steps', stepsPerFrame => {
  const { world, registry } = createTavernInterior();
  for (const target of registry.targets()) {
    const [x, y, z] = TAVERN_ENTRY.feet;
    const body: PlayerState = { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 128, distance: 0, collisionRevision: world.revision };
    const drive = seatApproachDriver(world, TAVERN_ENTRY.feet, target.approach, [14, 10]);
    for (let tick = 0; tick < 1800 && !drive.done; tick += stepsPerFrame) {
      const input = drive.input(body);
      for (let i = 0; i < stepsPerFrame; i++) stepPlayer(body, input, 1 / 30, world);
    }
    expect(drive.done, target.id).toBe(true);
    expect(Math.hypot(body.x - target.approach[0], body.z - target.approach[2]), target.id).toBeLessThan(.16);
  }
});
