import * as THREE from 'three';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import type { WindowHouse } from '@chatdom/render';
import type { VoxelBlueprint } from '@chatdom/shared';
import type { SceneView } from '../kingdom/scene';

/** A lit window in a painting: its public slot, then x and y in ten-thousandths of the frame. */
export type PaintedWindow = readonly [slot: number, x: number, y: number];

const MARGIN = .97;
/** The share of the frame lit windows must sit inside before the painter widens the shot for them. */
const FRAMED = .82;

const UP = new THREE.Vector3(0, 1, 0);
/** The same outward directions `createWindowLights` turns each pane to. */
const FACING = { north: Math.PI, east: Math.PI / 2, south: 0, west: -Math.PI / 2 } as const;
const paneOf = (house: WindowHouse) => {
  const pane = house.blueprint.windows[0];
  return pane ? new THREE.Vector3(...pane.centre).multiplyScalar(VOXEL_METRES.build).applyAxisAngle(UP, house.yaw).add(new THREE.Vector3(...house.position)) : null;
};
const normalOf = (house: WindowHouse) => {
  const pane = house.blueprint.windows[0], angle = pane ? FACING[pane.facing] + house.yaw : 0;
  return new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
};

/** Anything placed in the kingdom that can stand between the camera and a window. */
export interface Solid { blueprint: VoxelBlueprint; position: Vec3; yaw: number }
/** True when nothing solid lies on the straight line between the camera and the glass. */
export type Sight = (eye: THREE.Vector3, glass: THREE.Vector3) => boolean;

/** Lifted off the glass, outward along its facing. */
const GLASS_LIFT = .06;
/** The land near the eye and the glass is skipped: the camera and the home both stand on it. */
const GROUND_SKIP = 1.5, GROUND_STEP = 1, GROUND_TOLERANCE = .3;
/** Land tiles and how far the land may rise inside one above its sampled corners and centre. */
const TILE = 8, TILE_SLACK = 4;

/** Slab test of a segment (origin, direction scaled to its length, t in 0..end) against a half-open box. */
const crosses = (origin: THREE.Vector3, dir: THREE.Vector3, end: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
  let near = 0, far = end;
  for (const [o, d, lo, hi] of [[origin.x, dir.x, x0, x1], [origin.y, dir.y, y0, y1], [origin.z, dir.z, z0, z1]] as const) {
    if (Math.abs(d) < 1e-12) { if (o <= lo || o >= hi) return false; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    if (a > near) near = a;
    if (b < far) far = b;
    if (near >= far) return false;
  }
  return true;
};

/**
 * The painting's line of sight: the voxel boxes of every placed home, civic building, prop and tree, and the land
 * itself. It reads the same approved placements and terrain the renderer draws, so a window tucked behind a
 * neighbour's roof, a tree or a hill is known to be hidden, and no mark is put on a wall that hides it.
 * Authored windows sit in a recess inside their own wall, so the building whose bounds hold the glass is the window's
 * host and is left out; `paintedWindows` has already refused glass that faces away from the camera.
 */
export function createSight(solids: readonly Solid[], ground?: (x: number, z: number) => number): Sight {
  const m = VOXEL_METRES.build;
  const prepared = solids.map(solid => {
    const half = new THREE.Vector3(...solid.blueprint.size).multiplyScalar(m / 2);
    const centre = half.clone().applyAxisAngle(UP, solid.yaw).add(new THREE.Vector3(...solid.position));
    const boxes = new Float64Array(solid.blueprint.boxes.length * 6);
    solid.blueprint.boxes.forEach((box, index) => boxes.set([...box.from, ...box.to].map(value => value * m), index * 6));
    return { position: new THREE.Vector3(...solid.position), yaw: solid.yaw, size: half.clone().multiplyScalar(2), centre, radius: half.length(), boxes };
  });
  // The land is read on a one-metre lattice and remembered: every sightline of a painting starts at the same eye.
  // Each eight-metre tile first gets a cheap ceiling from five samples, so the exact land is only read where a
  // sightline runs low over it, mostly the last stretch before the glass.
  const heights = new Map<number, number>(), ceilings = new Map<number, number>();
  const keyOf = (x: number, z: number) => (x + 32768) * 65536 + (z + 32768);
  const exact = (x: number, z: number) => {
    const cx = Math.floor(x), cz = Math.floor(z), key = keyOf(cx, cz);
    let height = heights.get(key);
    if (height === undefined) { height = ground!(cx + .5, cz + .5); heights.set(key, height); }
    return height;
  };
  const ceiling = (x: number, z: number) => {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), key = keyOf(tx, tz);
    let top = ceilings.get(key);
    if (top === undefined) {
      const x0 = tx * TILE, z0 = tz * TILE;
      top = Math.max(exact(x0, z0), exact(x0 + TILE - .5, z0), exact(x0, z0 + TILE - .5), exact(x0 + TILE - .5, z0 + TILE - .5), exact(x0 + TILE / 2, z0 + TILE / 2)) + TILE_SLACK;
      ceilings.set(key, top);
    }
    return top;
  };
  const land = ground && ((x: number, y: number, z: number) => y < ceiling(x, z) && y < exact(x, z) - GROUND_TOLERANCE);
  const origin = new THREE.Vector3(), dir = new THREE.Vector3(), closest = new THREE.Vector3(), line = new THREE.Line3(), local = new THREE.Vector3();
  return (eye, glass) => {
    const length = eye.distanceTo(glass);
    if (!(length > GLASS_LIFT)) return true;
    line.set(eye, glass);
    for (const solid of prepared) {
      if (line.closestPointToPoint(solid.centre, true, closest).distanceTo(solid.centre) > solid.radius) continue;
      local.copy(glass).sub(solid.position).applyAxisAngle(UP, -solid.yaw);
      if (local.x >= 0 && local.y >= 0 && local.z >= 0 && local.x <= solid.size.x && local.y <= solid.size.y && local.z <= solid.size.z) continue;
      origin.copy(eye).sub(solid.position).applyAxisAngle(UP, -solid.yaw);
      dir.copy(glass).sub(eye).applyAxisAngle(UP, -solid.yaw);
      if (!crosses(origin, dir, 1, 0, 0, 0, solid.size.x, solid.size.y, solid.size.z)) continue;
      const b = solid.boxes;
      for (let i = 0; i < b.length; i += 6) if (crosses(origin, dir, 1, b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!, b[i + 4]!, b[i + 5]!)) return false;
    }
    if (land) {
      for (let along = GROUND_SKIP; along < length - GROUND_SKIP; along += GROUND_STEP) {
        line.at(along / length, closest);
        if (land(closest.x, closest.y, closest.z)) return false;
      }
    }
    return true;
  };
}
const cameraFor = (view: SceneView, aspect: number) => {
  const camera = new THREE.PerspectiveCamera(view.fov, aspect, .15, 2200);
  camera.position.set(...view.eye); camera.lookAt(new THREE.Vector3(...view.target));
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  return camera;
};
const inside = (camera: THREE.PerspectiveCamera, points: readonly THREE.Vector3[], margin: number) => points.every(point => {
  const ndc = point.clone().project(camera);
  return ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= margin && Math.abs(ndc.y) <= margin;
});

/** What the painter knows beyond the hero shot: the castle it keeps in the picture (a point on the keep), the line of sight and the land. */
export interface Framing { castle?: Vec3; sight?: Sight; ground?: (x: number, z: number) => number }

const landSights = new WeakMap<(x: number, z: number) => number, Sight>();
/** One remembered land-only sightline per kingdom's land, shared by every painting of it. */
const landSight = (ground: (x: number, z: number) => number) => {
  let sight = landSights.get(ground);
  if (!sight) { sight = createSight([], ground); landSights.set(ground, sight); }
  return sight;
};

/** Turns around the castle tried, nearest first, when the hero shot cannot see the lit glass. */
const TURNS = [0, -25, 25, -50, 50, -75, 75].map(degrees => degrees * Math.PI / 180);
/** The lowest an eye may sit above the land after a turn. */
const EYE_CLEARANCE = 4;
/** The nearest a re-centred shot may stand from what it holds. */
const MIN_DISTANCE = 20;

/**
 * Step back along the shot's own line until the castle and every lit window fit. The aim moves to the middle of what
 * must be held, the direction stays the shot's own, and the eye starts at the shot's own distance from that aim, so
 * the first try is the shot itself, re-centred, and every later try is further away.
 */
function widen(base: SceneView, lit: readonly THREE.Vector3[], keep: THREE.Vector3, aspect: number): SceneView {
  const points = [...lit, keep];
  if (inside(cameraFor(base, aspect), points, FRAMED)) return base;
  const eye = new THREE.Vector3(...base.eye), back = eye.clone().sub(new THREE.Vector3(...base.target)).normalize();
  const aim = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const start = Math.max(MIN_DISTANCE, eye.clone().sub(aim).dot(back));
  let view: SceneView = base;
  for (let step = 0; step <= 24; step++) {
    view = { eye: aim.clone().addScaledVector(back, start * (1 + step * .1)).toArray() as Vec3, target: aim.toArray() as Vec3, fov: base.fov };
    if (inside(cameraFor(view, aspect), points, FRAMED)) return view;
  }
  return view;
}
const turn = (view: SceneView, pivot: THREE.Vector3, angle: number): SceneView => angle === 0 ? view : {
  eye: new THREE.Vector3(...view.eye).sub(pivot).applyAxisAngle(UP, angle).add(pivot).toArray() as Vec3,
  target: new THREE.Vector3(...view.target).sub(pivot).applyAxisAngle(UP, angle).add(pivot).toArray() as Vec3,
  fov: view.fov,
};

/**
 * The painting's shot. The renderer's own hero view is kept whenever every lit window already shows in it, and so is
 * an empty night. Otherwise the painter looks for the shot nearest the hero that shows the most lit glass: the hero's
 * own composition turned around the castle in small steps, each stepped back just far enough to hold the castle and
 * the lit windows. Glass that faces away, or hides behind a roof, a tree or the land, does not count. Newcomers are
 * often given homes at the edge of town with their windows turned away from the hero shot; this is how their light
 * still reaches the picture. When no turn shows more than the hero does, the hero shot stays.
 */
export function paintingView(hero: SceneView, houses: readonly WindowHouse[], present: ReadonlySet<number>, width: number, height: number, framing: Framing = {}): SceneView {
  if (!(width > 0 && height > 0)) return hero;
  const aspect = width / height, litHouses = houses.filter(house => present.has(house.slot) && house.blueprint.windows.length > 0);
  if (!litHouses.length) return hero;
  const lit = litHouses.map(paneOf).filter((point): point is THREE.Vector3 => !!point);
  const shown = (view: SceneView) => paintedWindows(houses, present, view, width, height, framing.sight).length;
  const heroShows = shown(hero);
  if (heroShows === litHouses.length && inside(cameraFor(hero, aspect), lit, FRAMED)) return hero;
  const castle = framing.castle ? new THREE.Vector3(...framing.castle) : new THREE.Vector3(...hero.target);
  const land = framing.ground && landSight(framing.ground);
  let best: { view: SceneView; shows: number } = { view: hero, shows: heroShows };
  for (const angle of TURNS) {
    const base = turn(hero, castle, angle), eye = new THREE.Vector3(...base.eye);
    // Only the glass this side of the castle can see is worth stepping back for.
    const facing = litHouses.filter(house => normalOf(house).dot(eye.clone().sub(paneOf(house)!)) > 0).map(house => paneOf(house)!);
    const view = widen(base, facing.length ? facing : lit, castle, aspect), at = new THREE.Vector3(...view.eye);
    if (framing.ground && at.y < framing.ground(at.x, at.z) + EYE_CLEARANCE) continue;
    // A turn that puts a hill between the eye and the castle is not tonight's kingdom.
    if (land && !land(at, castle)) continue;
    // However far it stepped back, the castle stays in the picture.
    if (!inside(cameraFor(view, aspect), [castle], MARGIN)) continue;
    const shows = shown(view);
    // Ties keep the nearer turn; the first candidate (no turn) wins over the bare hero shot only by showing more.
    if (shows > best.shows || (angle === 0 && shows === best.shows && shows === litHouses.length)) best = { view, shows };
  }
  return best.view;
}

/**
 * Where each present window sits in the painting, read from the renderer's own camera. The presence light is the
 * first authored window of each house (as `createWindowLights` places it), so the mark lands on the glowing glass.
 * Windows outside the frame, behind the camera, turned away from it or hidden behind something solid (when a
 * `sight` is given) are left out; nothing is guessed.
 */
export function paintedWindows(houses: readonly WindowHouse[], present: ReadonlySet<number>, view: SceneView, width: number, height: number, sight?: Sight): PaintedWindow[] {
  if (!(width > 0 && height > 0)) return [];
  const camera = cameraFor(view, width / height), eye = new THREE.Vector3(...view.eye), marks: PaintedWindow[] = [], seen = new Set<number>();
  for (const house of houses) {
    const point = present.has(house.slot) && !seen.has(house.slot) ? paneOf(house) : null;
    if (!point) continue;
    const normal = normalOf(house);
    if (normal.dot(eye.clone().sub(point)) <= 0) continue;
    if (sight && !sight(eye, point.clone().addScaledVector(normal, GLASS_LIFT))) continue;
    const ndc = point.project(camera);
    if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || ndc.z <= -1 || ndc.z >= 1 || Math.abs(ndc.x) > MARGIN || Math.abs(ndc.y) > MARGIN) continue;
    seen.add(house.slot);
    marks.push([house.slot, Math.round((ndc.x + 1) * 5000), Math.round((1 - ndc.y) * 5000)]);
  }
  return marks;
}
