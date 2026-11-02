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
  // Preserve every corner, but do not steer toward each 12.5 cm cell along a straight aisle.
  // A delayed browser frame can otherwise pass a cell and reverse forever on either side of it.
  for (let i = route.length - 2; i > 0; i--) {
    const a = route[i - 1]!, b = route[i]!, c = route[i + 1]!;
    if ((a[0] === b[0] && b[0] === c[0]) || (a[2] === b[2] && b[2] === c[2])) route.splice(i, 1);
  }
  let next = 0;
  return {
    get done() { return next === route.length; },
    get progress() { return { waypoint: next, total: route.length, target: route[next] ? [...route[next]!] : null }; },
    input(body: Pick<PlayerState, 'x' | 'y' | 'z' | 'yaw'>): WalkInput {
      while (next < route.length && Math.hypot(body.x - route[next]![0], body.z - route[next]![2]) < .10) next++;
      const point = route[next];
      if (!point) return { moveX: 0, moveZ: 0, buttons: 0, yaw: body.yaw, collisionRevision: world.revision };
      // Follow the segment from the last waypoint, not the bare bearing to the next one. A corner is reached up to
      // ten centimetres off the line; steering straight from there runs a long aisle into the corner of a chair that
      // the route itself clears. Aim a short way ahead of the body's nearest point on the segment instead.
      const from = next > 0 ? route[next - 1]! : start, segX = point[0] - from[0], segZ = point[2] - from[2], length = Math.hypot(segX, segZ);
      const along = length > 1e-6 ? Math.min(length, Math.max(0, ((body.x - from[0]) * segX + (body.z - from[2]) * segZ) / length) + .25) : 0;
      const aim = length > 1e-6 && along < length ? [from[0] + segX / length * along, from[2] + segZ / length * along] : [point[0], point[2]];
      const distance = Math.hypot(point[0] - body.x, point[2] - body.z);
      const ax = aim[0]! - body.x, az = aim[1]! - body.z, reach = Math.hypot(ax, az) || 1;
      const dx = ax / reach * distance, dz = az / reach * distance;
      // Ease toward a corner over at least a second of held input (4 m/s at full input).
      // This also covers half-second software frames and reconciliation delays without waypoint oscillation.
      // Real visitors retain the existing full-speed walking controller; only the test approach uses this.
      const speed = Math.min(20, Math.max(1, Math.floor(distance * 127 / 4)));
      return { moveX: Math.round(dx / distance * speed), moveZ: Math.round(dz / distance * speed), buttons: 0,
        yaw: ((Math.round(Math.atan2(dx, dz) * 128 / Math.PI) % 256) + 256) % 256, collisionRevision: world.revision };
    },
  };
}
