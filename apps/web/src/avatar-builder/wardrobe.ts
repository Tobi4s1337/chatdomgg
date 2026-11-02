import * as THREE from 'three';
import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { CameraHold, OwnHomeInside, PlayContext, WalkFeatureContext, WalkFeatureProvider, WorldPromptProvider } from '../play/slots';

/*
 * The wardrobe at home (decision 22). Inside your own home a built-in press stands flush in a wall: its back is let
 * into the wall's thickness and its face stands less than a body's depth proud of it, so it needs no new solid and
 * nobody walks into it. Use it and the camera turns round to face you, as in its mirror; the builder opens over that,
 * and when you close it you see yourself in what you chose for a breath before the camera goes back behind you.
 * Nothing here is drawn anywhere but your own home, and only while the room says you are in it.
 */

/** The press's size in metres: across the wall, up from the floor, and out from the wall's inner face. */
export const WARDROBE = { width: 1.125, height: 2.18, proud: .16, recess: .08 } as const;
/** How far in front of the face you can use it from, and how squarely you must face it. */
const REACH = 1.7, FACING = Math.cos(70 * Math.PI / 180);
/** Keep this far from the street door, so the press never stands in the way in or out. */
const DOOR_CLEARANCE = 1.15;

export interface WardrobeSpot {
  /** Centre of the press's face line on the floor (the wall's inner face), world metres. */
  readonly base: Vec3;
  /** Unit normal out of the wall into the room (y = 0). */
  readonly normal: readonly [number, number];
  /** Yaw that turns the press's +Z onto `normal`. */
  readonly yaw: number;
  /** Where the prompt hangs: chest high on the press's face. */
  readonly prompt: Vec3;
}

const inside = (box: { readonly min: Vec3; readonly max: Vec3 }, p: Vec3, pad = 0) =>
  p[0] >= box.min[0] - pad && p[0] <= box.max[0] + pad && p[1] >= box.min[1] - pad && p[1] <= box.max[1] + pad
  && p[2] >= box.min[2] - pad && p[2] <= box.max[2] + pad;
const solidAt = (world: CollisionWorld, p: Vec3) =>
  world.query({ min: [p[0] - .01, p[1] - .01, p[2] - .01], max: [p[0] + .01, p[1] + .01, p[2] + .01] }).some(box => inside(box, p));
const clear = (world: CollisionWorld, min: Vec3, max: Vec3) =>
  !world.query({ min, max }).some(b => b.min[0] < max[0] && b.max[0] > min[0] && b.min[1] < max[1] && b.max[1] > min[1] && b.min[2] < max[2] && b.max[2] > min[2]);

/** The floor's top under a point: the highest solid top within a little of `near`. */
function floorAt(world: CollisionWorld, x: number, z: number, near: number): number | null {
  let top: number | null = null;
  for (const box of world.query({ min: [x - .05, near - .45, z - .05], max: [x + .05, near + .45, z + .05] })) {
    if (x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2] || box.max[1] > near + .45 || box.max[1] < near - .45) continue;
    if (top === null || box.max[1] > top) top = box.max[1];
  }
  return top;
}

/** March from `from` along a cardinal direction until a solid; the face it meets (an x or z coordinate), or null. */
function wallFace(world: CollisionWorld, from: Vec3, direction: readonly [number, number], reach: number): number | null {
  const axis = direction[0] !== 0 ? 0 : 2, sign = direction[0] + direction[1];
  for (let d = .02; d <= reach; d += 1 / 32) {
    const p: Vec3 = [from[0] + direction[0] * d, from[1], from[2] + direction[1] * d];
    const hit = world.query({ min: [p[0] - .004, p[1] - .004, p[2] - .004], max: [p[0] + .004, p[1] + .004, p[2] + .004] })
      .find(b => inside(b, p));
    if (hit) return sign > 0 ? hit.min[axis] : hit.max[axis];
  }
  return null;
}

/** The floor a body stands on clear near `near`'s height at (x, z): a free column from the floor to head height. */
function standable(world: CollisionWorld, x: number, z: number, near: number): number | null {
  const floor = floorAt(world, x, z, near);
  if (floor === null) return null;
  const r = .28;
  return clear(world, [x - r, floor + .02, z - r], [x + r, floor + 1.75, z + r]) ? floor : null;
}

const CARDINALS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STEP = .25, MAX_CELLS = 900;

/**
 * Where the press stands in this home, or null when no wall has room for it. From where you stand once through the
 * door, the floor you can walk to under the home's roof is searched a quarter metre at a time; at each place a wall
 * within arm's reach is tried, furthest from the door first. A spot needs solid wall behind the whole press (no window
 * or doorway), clear air for it and a body in front (nothing you placed stands there), a level floor, a roof overhead
 * and distance from the street door. It works for any shape of home, a home its owner built included.
 */
export function wardrobeSpot(home: OwnHomeInside): WardrobeSpot | null {
  const { door, inside: start, interior, world } = home;
  const key = (x: number, z: number) => `${Math.round(x / STEP)},${Math.round(z / STEP)}`;
  const seen = new Set<string>([key(start[0], start[2])]);
  const cells: Vec3[] = [], queue: Vec3[] = [start];
  while (queue.length && cells.length < MAX_CELLS) {
    const cell = queue.shift()!;
    cells.push(cell);
    for (const [dx, dz] of CARDINALS) {
      const x = cell[0] + dx * STEP, z = cell[2] + dz * STEP, k = key(x, z);
      if (seen.has(k)) continue;
      seen.add(k);
      if (x < interior.min[0] || x > interior.max[0] || z < interior.min[2] || z > interior.max[2]) continue;
      const y = standable(world, x, z, cell[1]);
      if (y !== null && Math.abs(y - cell[1]) <= .5) queue.push([x, y, z]);
    }
  }
  const roofed = (p: Vec3) => !clear(world, [p[0] - .05, p[1] + 2.3, p[2] - .05], [p[0] + .05, p[1] + 9, p[2] + .05]);
  const far = (p: Vec3) => Math.hypot(p[0] - door[0], p[2] - door[2]);
  cells.sort((a, b) => far(b) - far(a));
  for (const cell of cells) {
    if (far(cell) < DOOR_CLEARANCE + WARDROBE.width / 2 || !roofed(cell)) continue;
    for (const direction of CARDINALS) {
      const face = wallFace(world, [cell[0], cell[1] + 1.2, cell[2]], direction, .9);
      if (face === null) continue;
      const axis = direction[0] !== 0 ? 0 : 2, across = axis === 0 ? 2 : 0;
      // Only from where you would stand at it: its face a body's depth or so in front of you.
      const gap = Math.abs(face - cell[axis]!);
      if (gap < .5 || gap > .9) continue;
      const spot = tryAt(world, [-direction[0], -direction[1]], axis, across, face, cell[across]!, cell[1], door);
      if (spot) return spot;
    }
  }
  return null;
}

function tryAt(world: CollisionWorld, normal: readonly [number, number], axis: 0 | 2, across: 0 | 2, face: number, at: number,
  near: number, door: Vec3): WardrobeSpot | null {
  const n = axis === 0 ? normal[0] : normal[1];
  const point = (out: number, side: number, y: number): Vec3 => {
    const p: [number, number, number] = [0, y, 0];
    p[axis] = face + n * out; p[across] = at + side;
    return p;
  };
  const middle = point(0, 0, 0), stand = point(.45, 0, 0);
  const floor = floorAt(world, stand[0], stand[2], near);
  if (floor === null) return null;
  // A level floor all along the press's foot.
  for (const side of [-.5, 0, .5]) {
    const p = point(.1, side, 0), y = floorAt(world, p[0], p[2], floor);
    if (y === null || Math.abs(y - floor) > .07) return null;
  }
  // Solid wall behind the whole press, its recess included: no window, door or gap anywhere behind it.
  for (const side of [-.54, -.27, 0, .27, .54]) for (const up of [.2, .6, 1, 1.4, 1.8, 2.15]) {
    if (!solidAt(world, point(-.02, side, floor + up)) || !solidAt(world, point(-WARDROBE.recess + .005, side, floor + up))) return null;
  }
  // Clear air for the press and a body standing at it.
  const lo = point(.01, -WARDROBE.width / 2, floor + .06), hi = point(.75, WARDROBE.width / 2, floor + WARDROBE.height);
  if (!clear(world, [Math.min(lo[0], hi[0]), lo[1], Math.min(lo[2], hi[2])], [Math.max(lo[0], hi[0]), hi[1], Math.max(lo[2], hi[2])])) return null;
  if (Math.hypot(middle[0] - door[0], middle[2] - door[2]) < DOOR_CLEARANCE + WARDROBE.width / 2) return null;
  const base: Vec3 = [middle[0], floor, middle[2]];
  const out: readonly [number, number] = axis === 0 ? [n, 0] : [0, n];
  return { base, normal: out, yaw: Math.atan2(out[0], out[1]),
    prompt: [base[0] + out[0] * WARDROBE.proud, floor + 1.35, base[2] + out[1] * WARDROBE.proud] };
}

/** In reach and facing it: within REACH of its face, in front of it, and looking at it. */
export function wardrobeInReach(spot: WardrobeSpot, feet: readonly [number, number, number], yaw: number): boolean {
  const dx = feet[0] - spot.base[0], dz = feet[2] - spot.base[2];
  const out = dx * spot.normal[0] + dz * spot.normal[1], side = Math.abs(dx * spot.normal[1] - dz * spot.normal[0]);
  if (out <= 0 || out > REACH || side > WARDROBE.width * .75 || Math.abs(feet[1] - spot.base[1]) > .6) return false;
  // Facing: the walker's forward (0 faces +Z) against the way back to the press.
  return -(Math.sin(yaw) * spot.normal[0] + Math.cos(yaw) * spot.normal[1]) >= FACING;
}

/*
 * The press, on the build lattice's sixteenths: dark oak plinth and cornice, two panelled doors in warm oak, a mirror
 * in the right door's upper panel, brass pulls and a carved crest. Local +X runs along the wall, +Y up, +Z out of the
 * wall; z = 0 is the wall's inner face and the back is let into the wall by `recess`.
 */
type Part = readonly [from: Vec3, to: Vec3, colour: number, kind?: 'brass' | 'glass'];
const OAK_DARK = 0x3a2316, OAK = 0x5b3722, OAK_DOOR = 0x6e452a, OAK_PANEL = 0x7d5233, BRASS = 0xc9a14a, GLASS = 0xaebfcc;
const R = -WARDROBE.recess, P = WARDROBE.proud;
export const WARDROBE_PARTS: readonly Part[] = [
  [[-.53, 0, R], [.53, .125, P + .02], OAK_DARK],                    // plinth
  [[-.5, .125, R], [-.4375, 1.875, P], OAK],                          // left side
  [[.4375, .125, R], [.5, 1.875, P], OAK],                            // right side
  [[-.4375, .125, R], [.4375, .1875, P - .02], OAK_DARK],             // sill
  [[-.4375, 1.8125, R], [.4375, 1.875, P - .02], OAK_DARK],           // head rail
  [[-.4375, .1875, P - .05], [-.0125, 1.8125, P - .005], OAK_DOOR],    // left door
  [[.0125, .1875, P - .05], [.4375, 1.8125, P - .005], OAK_DOOR],     // right door
  [[-.375, .3125, P - .005], [-.075, .875, P + .015], OAK_PANEL],     // left lower panel
  [[-.375, 1, P - .005], [-.075, 1.6875, P + .015], OAK_PANEL],       // left upper panel
  [[.075, .3125, P - .005], [.375, .875, P + .015], OAK_PANEL],       // right lower panel
  [[.0625, .9375, P - .005], [.3875, 1.75, P + .01], OAK_DARK],       // mirror frame
  [[.1, .975, P + .01], [.35, 1.7125, P + .02], GLASS, 'glass'],      // mirror
  [[-.0875, .9375, P], [-.0375, 1.125, P + .045], BRASS, 'brass'],    // left pull
  [[.0375, .9375, P], [.0875, 1.125, P + .045], BRASS, 'brass'],      // right pull
  [[-.0625, .5625, P], [.0625, .625, P + .03], BRASS, 'brass'],       // lock plate
  [[-.5625, 1.875, R], [.5625, 1.9375, P + .05], OAK_DARK],           // cornice
  [[-.5, 1.9375, R], [.5, 2, P + .02], OAK],                          // frieze
  [[-.5625, 2, R], [.5625, 2.0625, P + .06], OAK_DARK],               // crown
  [[-.1875, 2.0625, R + .02], [.1875, 2.125, P - .02], OAK_DARK],     // crest
  [[-.0625, 2.125, R + .02], [.0625, 2.1875, P - .04], OAK_DARK],     // crest top
  [[-.03125, 2.0625, P - .02], [.03125, 2.125, P], BRASS, 'brass'],   // crest stud
];

/** The press as one mesh per material, standing on `spot`. */
export function wardrobeObject(spot: WardrobeSpot): THREE.Group {
  const group = new THREE.Group();
  group.name = 'home-wardrobe';
  const kinds = new Map<string, Part[]>();
  for (const part of WARDROBE_PARTS) {
    const kind = part[3] ?? 'wood';
    kinds.set(kind, [...kinds.get(kind) ?? [], part]);
  }
  for (const [kind, parts] of kinds) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true,
      roughness: kind === 'glass' ? .12 : kind === 'brass' ? .38 : .86, metalness: kind === 'glass' ? .55 : kind === 'brass' ? .75 : 0,
      ...(kind === 'glass' ? { emissive: new THREE.Color(0x2b3442), emissiveIntensity: .35 } : {}) });
    const mesh = new THREE.Mesh(boxesGeometry(parts), material);
    mesh.name = `home-wardrobe:${kind}`;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.position.set(...spot.base);
  group.rotation.y = spot.yaw;
  group.updateMatrixWorld(true);
  return group;
}

/** Axis boxes as one indexed geometry with per-face vertex colours: a slight darkening down each face reads as grain and depth. */
export function boxesGeometry(parts: readonly Part[]): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colours: number[] = [], index: number[] = [];
  const colour = new THREE.Color();
  const faces: readonly (readonly [Vec3, readonly Vec3[]])[] = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
  ];
  for (const [from, to, hex] of parts) {
    for (const [normal, corners] of faces) {
      const start = positions.length / 3;
      // Top faces catch the most light, undersides the least; each face darkens a touch toward its foot.
      const shade = normal[1] > 0 ? 1.08 : normal[1] < 0 ? .7 : 1;
      for (const c of corners) {
        positions.push(c[0] ? to[0] : from[0], c[1] ? to[1] : from[1], c[2] ? to[2] : from[2]);
        normals.push(...normal);
        colour.setHex(hex).multiplyScalar(shade * (normal[1] === 0 && !c[1] ? .9 : 1));
        colours.push(colour.r, colour.g, colour.b);
      }
      index.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Eases 0..1 with a soft start and end. */
const ease = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const TURN_MS = 700, LINGER_MS = 1100, RETURN_MS = 650;

/** The mirror's field of view: from inside the glass, under a metre from you, crown to knees fill it. */
export const MIRROR_FOV = 78;

/**
 * Where the mirror's camera stands: in the glass itself, just inside the wall's thickness behind the press, looking
 * back at you at eye height, so you see yourself face on as the glass would show you. House walls are drawn one-sided,
 * so from inside a wall the camera sees through it into the room; the press is set aside while the camera is in it.
 */
export function mirrorView(spot: WardrobeSpot, feet: Vec3): { eye: Vec3; target: Vec3; fov: number } {
  const side = (feet[0] - spot.base[0]) * spot.normal[1] - (feet[2] - spot.base[2]) * spot.normal[0];
  // Square to the glass, opposite you along the wall (held within the press's width), a few centimetres into the wall.
  const along = Math.max(-WARDROBE.width / 2 + .15, Math.min(WARDROBE.width / 2 - .15, side));
  const back = WARDROBE.recess - .02;
    return {
    eye: [spot.base[0] + spot.normal[1] * along - spot.normal[0] * back, feet[1] + 1.3, spot.base[2] - spot.normal[0] * along - spot.normal[1] * back],
    target: [feet[0], feet[1] + 1.2, feet[2]],
    fov: MIRROR_FOV,
  };
}

function arc(from: { eye: Vec3; target: Vec3 }, to: { eye: Vec3; target: Vec3 }, pivot: Vec3, t: number): { eye: Vec3; target: Vec3 } {
  const k = ease(t);
  const a = Math.atan2(from.eye[0] - pivot[0], from.eye[2] - pivot[2]), b = Math.atan2(to.eye[0] - pivot[0], to.eye[2] - pivot[2]);
  let turn = b - a;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  const ra = Math.hypot(from.eye[0] - pivot[0], from.eye[2] - pivot[2]), rb = Math.hypot(to.eye[0] - pivot[0], to.eye[2] - pivot[2]);
  // Never closer to the body than half a metre on the way round, so the camera passes beside the walker, not through.
  const r = Math.max(ra + (rb - ra) * k, Math.sin(Math.PI * k) * .55), angle = a + turn * k;
  const lerp = (x: Vec3, y: Vec3): Vec3 => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  const eye: Vec3 = [pivot[0] + Math.sin(angle) * r, from.eye[1] + (to.eye[1] - from.eye[1]) * k, pivot[2] + Math.cos(angle) * r];
  return { eye, target: lerp(from.target, to.target) };
}

export interface WardrobeOpener {
  /** Opens the builder over the street; `onClosed` runs once it has closed. */
  open(ctx: PlayContext, onClosed: () => void): void;
}

export interface WardrobeSlots {
  readonly feature: WalkFeatureProvider;
  readonly prompt: WorldPromptProvider;
}

/** The wardrobe's walk feature (draws it, runs the mirror) and its world prompt ("Open your wardrobe"). */
export function createWardrobe(opener: WardrobeOpener): WardrobeSlots {
  let live: {
    readonly ctx: WalkFeatureContext;
    key: string | null; spot: WardrobeSpot | null; object: THREE.Group | null;
    mirror: { phase: 'turning' | 'open' | 'lingering' | 'returning'; since: number; hold: CameraHold; release: () => void; view?: { eye: Vec3; target: Vec3; fov: number } } | null;
  } | null = null;

  const removeObject = () => {
    if (!live?.object) return;
    live.object.removeFromParent();
    for (const child of live.object.children) if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
    live.object = null;
  };
  const cue = (ctx: WalkFeatureContext) => { try { ctx.audio()?.cue('wood', { ui: 'wood' }); } catch { /* the press opens silently */ } };

  const feature: WalkFeatureProvider = {
    id: 'look-wardrobe',
    mount(ctx) {
      const state = live = { ctx, key: null as string | null, spot: null as WardrobeSpot | null, object: null as THREE.Group | null, mirror: null as NonNullable<typeof live>['mirror'] };
      const base = { eye: [0, 0, 0] as Vec3, target: [0, 0, 0] as Vec3 };
      const forward = new THREE.Vector3();
      const stopFrame = ctx.onFrame((_dt, now) => {
        // The home only while you are in it: placed once per shell and collision revision, gone as you step out.
        const home = ctx.ownHome?.() ?? null;
        const key = home ? `${home.plotId}@${home.world.revision}` : null;
        if (key !== state.key) {
          state.key = key;
          removeObject();
          state.spot = home ? wardrobeSpot(home) : null;
          if (state.spot) { state.object = wardrobeObject(state.spot); ctx.scene.add(state.object); }
        }
        const mirror = state.mirror, pose = ctx.pose();
        if (!mirror || !state.spot || !pose) return;
        // The walk has placed the camera for this frame; that is where the turn starts and where it comes back to.
        base.eye = [ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z];
        ctx.camera.getWorldDirection(forward);
        base.target = [base.eye[0] + forward.x * 3, base.eye[1] + forward.y * 3, base.eye[2] + forward.z * 3];
        const feet: Vec3 = [...pose.position], pivot: Vec3 = [feet[0], feet[1], feet[2]];
        // The glass is placed once, opposite where you stood when you opened it.
        mirror.view ??= mirrorView(state.spot, feet);
        const view = mirror.view, walkFov = (ctx.camera as THREE.PerspectiveCamera).fov ?? MIRROR_FOV;
        const fovAt = (k: number) => walkFov + (view.fov - walkFov) * ease(k);
        const still = ctx.settings.get('reducedMotion');
        const t = (ms: number) => still ? 1 : Math.min(1, (now - mirror.since) / ms);
        // The press steps aside while the camera is in its glass, and is back as the camera leaves it.
        const inGlass = mirror.phase === 'open' || mirror.phase === 'lingering'
          || (mirror.phase === 'turning' && t(TURN_MS) > .8) || (mirror.phase === 'returning' && t(RETURN_MS) < .2);
        if (state.object) state.object.visible = !inGlass;
        if (mirror.phase === 'turning') {
          const at = arc(base, view, pivot, t(TURN_MS));
          mirror.hold.set(at.eye, at.target, fovAt(t(TURN_MS)));
          if (t(TURN_MS) >= 1) {
            mirror.phase = 'open'; mirror.since = now;
            opener.open(ctx, () => { if (state.mirror === mirror) { mirror.phase = 'lingering'; mirror.since = performance.now(); cue(ctx); } });
          }
        } else if (mirror.phase === 'open') {
          mirror.hold.set(view.eye, view.target, view.fov);
        } else if (mirror.phase === 'lingering') {
          // You see yourself in what you chose for a breath, then the camera goes back behind you.
          mirror.hold.set(view.eye, view.target, view.fov);
          if (still || now - mirror.since >= LINGER_MS) { mirror.phase = 'returning'; mirror.since = now; }
        } else {
          const k = t(RETURN_MS);
          const at = arc(view, base, pivot, k);
          mirror.hold.set(at.eye, at.target, fovAt(1 - k));
          if (k >= 1) { state.mirror = null; mirror.release(); if (state.object) state.object.visible = true; }
        }
      });
      return () => {
        stopFrame();
        if (state.mirror) { const m = state.mirror; state.mirror = null; m.release(); if (state.object) state.object.visible = true; }
        removeObject();
        if (live === state) live = null;
      };
    },
  };

  const prompt: WorldPromptProvider = {
    id: 'look-wardrobe',
    prompt(pose) {
      const spot = live?.spot;
      if (!spot || live?.mirror || !wardrobeInReach(spot, pose.position, pose.yaw)) return null;
      return { label: 'Open your wardrobe', at: spot.prompt };
    },
    use(ctx) {
      const state = live;
      if (!state?.spot || state.mirror) return;
      const walk = state.ctx;
      if (!walk.holdCamera) { opener.open(ctx, () => {}); return; }
      // Nothing walks while the camera turns; the builder takes the cursor and input from here once it opens.
      const input = ctx.requestInput('wardrobe'), hold = walk.holdCamera('wardrobe');
      cue(walk);
      state.mirror = { phase: 'turning', since: performance.now(), hold,
        release: () => { hold.release(); input.release(); } };
    },
  };

  return { feature, prompt };
}
