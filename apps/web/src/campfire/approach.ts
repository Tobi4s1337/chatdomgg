import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld, PlayerState, SolidBox, WalkInput } from '@chatdom/shared/realm';
import { bodyClear } from '@chatdom/world/interactions';

/*
 * The loopback test walker's walk to its log. Every step still goes through the real movement input and the room's
 * own authority; this only decides where to steer. From wherever the kingdom put the walker it finds a way over the
 * founded ground to the clearing's footpath gap (a bounded search on a quarter-metre grid that follows the ground up
 * and down half-metre steps), then follows the clearing's own authored waypoints to the spot in front of the seat.
 */

const CELL = .25, STEP = .5, PAD = 8, MAX_SIDE = 320;

/** The highest solid top under a body's footprint within a step of `y`, or null where nothing holds a body. */
function groundNear(world: CollisionWorld, x: number, z: number, y: number): number | null {
  const probe: SolidBox = { min: [x - .05, y - STEP - .05, z - .05], max: [x + .05, y + STEP + .01, z + .05] };
  let top: number | null = null;
  for (const box of world.query(probe)) {
    const t = box.max[1];
    if (t <= y + STEP + 1e-6 && t >= y - STEP - 1e-6 && (top === null || t > top)) top = t;
  }
  return top !== null && bodyClear(world, [x, top, z]) ? top : null;
}

/** A walkable way from `start` to `goal` over the founded ground, or null when there is none inside the search. */
export function findWay(world: CollisionWorld, start: Vec3, goal: Vec3): Vec3[] | null {
  const minX = Math.min(start[0], goal[0]) - PAD, minZ = Math.min(start[2], goal[2]) - PAD;
  const width = Math.ceil((Math.max(start[0], goal[0]) + PAD - minX) / CELL) + 1, depth = Math.ceil((Math.max(start[2], goal[2]) + PAD - minZ) / CELL) + 1;
  if (width > MAX_SIDE || depth > MAX_SIDE) return null;
  const index = (x: number, z: number) => x + z * width;
  const cellOf = (p: Vec3) => [Math.round((p[0] - minX) / CELL), Math.round((p[2] - minZ) / CELL)] as const;
  const [sx, sz] = cellOf(start), [gx, gz] = cellOf(goal);
  const parents = new Int32Array(width * depth).fill(-1), heights = new Float32Array(width * depth);
  const first = index(sx, sz), target = index(gx, gz);
  parents[first] = first; heights[first] = start[1];
  const queue = [first];
  for (let head = 0; head < queue.length && parents[target] === -1; head++) {
    const from = queue[head]!, x = from % width, z = Math.floor(from / width), y = heights[from]!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= depth) continue;
      const next = index(nx, nz);
      if (parents[next] !== -1) continue;
      const top = groundNear(world, minX + nx * CELL, minZ + nz * CELL, y);
      if (top === null) continue;
      parents[next] = from; heights[next] = top; queue.push(next);
    }
  }
  if (parents[target] === -1) return null;
  const route: Vec3[] = [];
  for (let at = target; parents[at] !== at; at = parents[at]!) route.push([minX + (at % width) * CELL, heights[at]!, minZ + Math.floor(at / width) * CELL]);
  route.reverse();
  // Keep the corners, drop the cells along a straight run.
  for (let i = route.length - 2; i > 0; i--) {
    const a = route[i - 1]!, b = route[i]!, c = route[i + 1]!;
    if ((a[0] === b[0] && b[0] === c[0]) || (a[2] === b[2] && b[2] === c[2])) route.splice(i, 1);
  }
  return route;
}

/** Steers a body along `route` through the real walk input; done once it stands at the last point. */
export function routeDriver(revision: () => number, start: Vec3, route: readonly Vec3[]) {
  let next = 0, last: Vec3 = start;
  return {
    get done() { return next >= route.length; },
    input(body: Pick<PlayerState, 'x' | 'y' | 'z' | 'yaw'>): WalkInput {
      const end = next === route.length - 1;
      while (next < route.length && Math.hypot(body.x - route[next]![0], body.z - route[next]![2]) < (next === route.length - 1 ? .1 : .3)) { last = route[next]!; next++; }
      const point = route[next];
      if (!point) return { moveX: 0, moveZ: 0, buttons: 0, yaw: body.yaw, collisionRevision: revision() };
      // Aim a little ahead along the segment, not at the bare corner, so a long run never clips the next corner.
      const segX = point[0] - last[0], segZ = point[2] - last[2], length = Math.hypot(segX, segZ);
      const along = length > 1e-6 ? Math.min(length, Math.max(0, ((body.x - last[0]) * segX + (body.z - last[2]) * segZ) / length) + .4) : 0;
      const ax = (length > 1e-6 ? last[0] + segX / length * along : point[0]) - body.x, az = (length > 1e-6 ? last[2] + segZ / length * along : point[2]) - body.z;
      const reach = Math.hypot(ax, az) || 1, distance = Math.hypot(point[0] - body.x, point[2] - body.z);
      // Easy on the last metre so a slow frame never carries the body past the seat's spot.
      const speed = Math.round(Math.min(90, Math.max(8, (end || next === route.length - 1 ? distance : distance + 2) * 127 / 3)));
      return { moveX: Math.round(ax / reach * speed), moveZ: Math.round(az / reach * speed), buttons: 0,
        yaw: ((Math.round(Math.atan2(ax, az) * 128 / Math.PI) % 256) + 256) % 256, collisionRevision: revision() };
    },
  };
}
