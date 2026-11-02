// Walking routes for the PI10 end-to-end run. Plans on the exact collision world the room steps, then proves the
// route by running the shared movement law offline with the same steering the live walker uses.
import type { CollisionWorld, PlayerState, WalkInput } from '../../../../packages/shared/src/realm/index.ts';
import type { Vec3 } from '../../../../packages/shared/src/index.ts';
import { embeddedSolids, stepPlayer, supported, STEP_HEIGHT } from '../../../../packages/world/src/movement/step.ts';

const CELL = .5, BODY_RADIUS = .29, BODY_HEIGHT = 1.75;

export interface RouteOptions {
  /** Water surface at a point, or null on land. A walker never routes through standing water. */
  water(x: number, z: number): number | null;
  /** Lower bound for the column search (the terrain under the point). */
  ground(x: number, z: number): number;
  /** Cells farther than this from the straight line start-goal are not searched. */
  corridor?: number;
  maxExpansions?: number;
  /** Heuristic weight; above 1 trades a slightly longer route for a much smaller search. */
  weight?: number;
}

interface Node { readonly ix: number; readonly iz: number; readonly y: number }
const key = (ix: number, iz: number, y: number) => `${ix},${iz},${Math.round(y * 64)}`;
/** Cell centres sit on the terrain's half-metre column centres, so a standing height is one column's top. */
const at = (i: number) => (i + .5) * CELL;
const index = (v: number) => Math.round(v / CELL - .5);

/** Every clear, supported standing height in one cell's column, lowest first. */
function makeLevels(world: CollisionWorld, options: RouteOptions) {
  const cache = new Map<string, number[]>();
  return (ix: number, iz: number): number[] => {
    const id = `${ix},${iz}`;
    const hit = cache.get(id);
    if (hit) return hit;
    const x = at(ix), z = at(iz), g = options.ground(x, z), water = options.water(x, z);
    const tops = new Set<number>([g]);
    for (const box of world.query({ min: [x - BODY_RADIUS, g - .3, z - BODY_RADIUS], max: [x + BODY_RADIUS, g + 10, z + BODY_RADIUS] })) tops.add(box.max[1]!);
    const levels = [...tops].sort((a, b) => a - b).filter(y => {
      if (water !== null && y < water + .05) return false;
      const pose = { x, y, z };
      return embeddedSolids(pose, world).length === 0 && supported(pose, world);
    });
    cache.set(id, levels);
    return levels;
  };
}

function sweptClear(world: CollisionWorld, a: Vec3, b: Vec3): boolean {
  const floor = Math.max(a[1], b[1]) + .02;
  return world.query({ min: [Math.min(a[0], b[0]) - BODY_RADIUS, floor, Math.min(a[2], b[2]) - BODY_RADIUS],
    max: [Math.max(a[0], b[0]) + BODY_RADIUS, floor + BODY_HEIGHT - .04, Math.max(a[2], b[2]) + BODY_RADIUS] }).length === 0;
}

/**
 * Weighted A* over half-metre cells and standing heights. Returns world points from the start cell to a goal cell.
 * Yields to the event loop as it searches, so a joined walker's socket keeps answering while a long route is planned.
 */
export async function planRoute(world: CollisionWorld, from: Vec3, goal: Vec3, options: RouteOptions,
  accept: (p: Vec3) => boolean = p => Math.hypot(p[0] - goal[0], p[2] - goal[2]) <= .5 && Math.abs(p[1] - goal[1]) <= .6,
  blocked: ReadonlySet<string> = new Set()): Promise<Vec3[] | null> {
  const levels = makeLevels(world, options), corridor = options.corridor ?? 40, limit = options.maxExpansions ?? 400_000, weight = options.weight ?? 1.5;
  const sx = index(from[0]), sz = index(from[2]);
  const startLevels = levels(sx, sz);
  if (!startLevels.length) return null;
  const sy = startLevels.reduce((best, y) => Math.abs(y - from[1]) < Math.abs(best - from[1]) ? y : best);
  const lineX = goal[0] - from[0], lineZ = goal[2] - from[2], lineLength = Math.hypot(lineX, lineZ) || 1;
  const offLine = (x: number, z: number) => {
    const t = Math.max(0, Math.min(1, ((x - from[0]) * lineX + (z - from[2]) * lineZ) / (lineLength * lineLength)));
    return Math.hypot(x - (from[0] + lineX * t), z - (from[2] + lineZ * t));
  };
  const h = (n: Node) => Math.hypot(at(n.ix) - goal[0], at(n.iz) - goal[2]);
  const start: Node = { ix: sx, iz: sz, y: sy };
  const open = new MinHeap<Node>();
  const g = new Map<string, number>([[key(sx, sz, sy), 0]]), parent = new Map<string, Node | null>([[key(sx, sz, sy), null]]);
  open.push(start, weight * h(start));
  let expansions = 0, closest = Infinity, closestAt: Vec3 = from;
  const report = () => { lastSearch = { expansions, closest, closestAt }; };
  while (open.size) {
    const node = open.pop()!, id = key(node.ix, node.iz, node.y), here: Vec3 = [at(node.ix), node.y, at(node.iz)];
    if (accept(here)) {
      const path: Vec3[] = [];
      for (let n: Node | null = node; n; n = parent.get(key(n.ix, n.iz, n.y)) ?? null) path.push([at(n.ix), n.y, at(n.iz)]);
      report();
      return path.reverse();
    }
    const left = h(node);
    if (left < closest) { closest = left; closestAt = here; }
    if (++expansions > limit) { report(); return null; }
    if (expansions % 500 === 0) await new Promise(resolve => setImmediate(resolve));
    const base = g.get(id)!;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const ix = node.ix + dx, iz = node.iz + dz;
      if (offLine(at(ix), at(iz)) > corridor) continue;
      for (const y of levels(ix, iz)) {
        if (Math.abs(y - node.y) > STEP_HEIGHT + 1e-6) continue;
        const next: Vec3 = [at(ix), y, at(iz)];
        const edge = `${id}>${key(ix, iz, y)}`;
        if (blocked.has(edge) || !sweptClear(world, here, next)) continue;
        if (dx && dz) {
          // No corner cutting: both orthogonal cells must stand at a reachable height too.
          const a = levels(node.ix + dx, node.iz).some(v => Math.abs(v - node.y) <= STEP_HEIGHT + 1e-6);
          const b = levels(node.ix, node.iz + dz).some(v => Math.abs(v - node.y) <= STEP_HEIGHT + 1e-6);
          if (!a || !b) continue;
        }
        const cost = base + Math.hypot(dx, dz) * CELL + Math.abs(y - node.y), nextId = key(ix, iz, y);
        if (cost >= (g.get(nextId) ?? Infinity)) continue;
        g.set(nextId, cost); parent.set(nextId, node);
        const n: Node = { ix, iz, y };
        open.push(n, cost + weight * h(n));
      }
    }
  }
  report();
  return null;
}

/** Diagnostics of the latest search, for the run log when a route cannot be found. */
export let lastSearch: { expansions: number; closest: number; closestAt: Vec3 } = { expansions: 0, closest: Infinity, closestAt: [0, 0, 0] };

/** The steering law shared by the offline proof and the live walker: pure pursuit along the route. */
export function createSteering(path: readonly Vec3[], options: { readonly sprint?: boolean; readonly arrive?: number; readonly lookahead?: number } = {}) {
  let index = 0;
  const arrive = options.arrive ?? .2, lookahead = options.lookahead ?? .9;
  const yawByte = (dx: number, dz: number) => ((Math.round(Math.atan2(dx, dz) / (Math.PI * 2) * 256) % 256) + 256) % 256;
  let lastYaw = 0;
  return {
    get index() { return index; },
    done(p: { x: number; z: number }) { const end = path[path.length - 1]!; return Math.hypot(end[0] - p.x, end[2] - p.z) <= arrive; },
    input(p: { x: number; z: number }): Omit<WalkInput, 'collisionRevision'> {
      // Advance the nearest-progress index, never backwards.
      while (index < path.length - 1) {
        const a = path[index]!, b = path[index + 1]!;
        if (Math.hypot(b[0] - p.x, b[2] - p.z) <= Math.hypot(a[0] - p.x, a[2] - p.z) + .05) index++; else break;
      }
      let target = path[path.length - 1]!;
      for (let i = index; i < path.length; i++) { const q = path[i]!; if (Math.hypot(q[0] - p.x, q[2] - p.z) >= lookahead) { target = q; break; } }
      const end = path[path.length - 1]!, toEnd = Math.hypot(end[0] - p.x, end[2] - p.z);
      if (toEnd <= arrive) return { moveX: 0, moveZ: 0, buttons: 0, yaw: lastYaw };
      const dx = target[0] - p.x, dz = target[2] - p.z, length = Math.hypot(dx, dz) || 1;
      // Ease the last metre so the body stops inside the arrival radius instead of overshooting it.
      const scale = toEnd < 1 ? Math.max(.35, toEnd) : 1;
      lastYaw = yawByte(dx, dz);
      return { moveX: Math.round(dx / length * 127 * scale), moveZ: Math.round(dz / length * 127 * scale),
        buttons: options.sprint && toEnd > 3 ? 1 : 0, yaw: lastYaw };
    },
    yawByte,
  };
}

/** Runs the movement law with the steering until arrival. Returns the end state, or the tick it stalled at. */
export function simulateRoute(world: CollisionWorld, start: PlayerState, path: readonly Vec3[], options: { sprint?: boolean; arrive?: number } = {}) {
  const s: PlayerState = { ...start }, steer = createSteering(path, options);
  let best = Infinity, sinceBest = 0;
  for (let tick = 0; tick < 30 * 600; tick++) {
    if (steer.done(s) && Math.hypot(s.vx, s.vz) < .01) return { ok: true as const, ticks: tick, state: s };
    stepPlayer(s, { ...steer.input(s), collisionRevision: world.revision }, 1 / 30, world);
    const end = path[path.length - 1]!, left = Math.hypot(end[0] - s.x, end[2] - s.z) + (path.length - steer.index) * .01;
    if (left < best - .02) { best = left; sinceBest = 0; } else if (++sinceBest > 45) {
      return { ok: false as const, ticks: tick, state: s, at: steer.index };
    }
  }
  return { ok: false as const, ticks: 30 * 600, state: s, at: steer.index };
}

class MinHeap<T> {
  private items: { value: T; priority: number }[] = [];
  get size() { return this.items.length; }
  push(value: T, priority: number) {
    const items = this.items; items.push({ value, priority });
    for (let i = items.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (items[up]!.priority <= items[i]!.priority) break;
      [items[up], items[i]] = [items[i]!, items[up]!]; i = up;
    }
  }
  pop(): T | undefined {
    const items = this.items, top = items[0];
    const last = items.pop();
    if (items.length && last) {
      items[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < items.length && items[l]!.priority < items[m]!.priority) m = l;
        if (r < items.length && items[r]!.priority < items[m]!.priority) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!]; i = m;
      }
    }
    return top?.value;
  }
}
