import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, PlayerState, WalkInput } from '@chatdom/shared/realm';
import { standingClear } from '@chatdom/world/interactions';

/** Deterministic test walker. Every waypoint still goes through the actual movement/input authority. */
export function seatApproachDriver(world: CollisionWorld, start: Vec3, goal: Vec3, bounds: readonly [number, number]) {
  const cell = .125, width = Math.round(bounds[0] / cell) + 1, depth = Math.round(bounds[1] / cell) + 1;
  const index = (x: number, z: number) => x + z * width;
  const sx = Math.round(start[0] / cell), sz = Math.round(start[2] / cell), gx = Math.round(goal[0] / cell), gz = Math.round(goal[2] / cell);
  const parents = new Int32Array(width * depth).fill(-1), queue = [index(sx, sz)]; parents[queue[0]!] = queue[0]!;
  const target = index(gx, gz);
  for (let head = 0; head < queue.length && parents[target] === -1; head++) {
    const from = queue[head]!, x = from % width, z = Math.floor(from / width);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!, nz = z + dz!;
      if (nx < 0 || nx >= width || nz < 0 || nz >= depth) continue;
      const next = index(nx, nz);
      if (parents[next] !== -1 || !standingClear(world, [nx * cell, goal[1], nz * cell])) continue;
      parents[next] = from; queue.push(next);
    }
  }
  if (parents[target] === -1) throw new Error('The chair has no walkable approach.');
  const route: Vec3[] = [goal];
  for (let at = target; parents[at] !== at; at = parents[at]!) route.push([(at % width) * cell, goal[1], Math.floor(at / width) * cell]);
  route.reverse();
  let next = 0;
  return {
    get done() { return next === route.length; },
    input(body: Pick<PlayerState, 'x' | 'y' | 'z' | 'yaw'>): WalkInput {
      while (next < route.length && Math.hypot(body.x - route[next]![0], body.z - route[next]![2]) < .10) next++;
      const point = route[next];
      if (!point) return { moveX: 0, moveZ: 0, buttons: 0, yaw: body.yaw, collisionRevision: world.revision };
      const dx = point[0] - body.x, dz = point[2] - body.z, distance = Math.hypot(dx, dz);
      // Inspection frames may cover eight fixed steps on software rendering. A slow test walk cannot skip
      // a narrow waypoint between frames; real walking keeps its own full-speed controller unchanged.
      return { moveX: Math.round(dx / distance * 12), moveZ: Math.round(dz / distance * 12), buttons: 0,
        yaw: ((Math.round(Math.atan2(dx, dz) * 128 / Math.PI) % 256) + 256) % 256, collisionRevision: world.revision };
    },
  };
}
