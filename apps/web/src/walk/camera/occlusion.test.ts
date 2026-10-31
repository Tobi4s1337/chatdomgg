import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WALK_BODY, type CollisionWorld, type SolidBox } from '@chatdom/shared/realm';
import { clearBoom, nearFootprint, OCCLUSION, sweepHit, type BoomPoint } from './occlusion';
import { createShoulderRig, shoulderPose, SHOULDER, type ShoulderRig, type Vec3 } from './shoulder';

const SIZES = [{ width: 1440, height: 900 }, { width: 390, height: 844 }] as const;
const FRAME = 1 / 60;

function worldOf(boxes: SolidBox[], revision = 1): CollisionWorld & { boxes: SolidBox[]; queries: number } {
  const world = {
    revision, boxes, queries: 0,
    query(bounds: SolidBox) {
      world.queries++;
      return world.boxes.filter(b => b.min.every((n, axis) => n <= bounds.max[axis]! && b.max[axis]! >= bounds.min[axis]!));
    },
  };
  return world;
}
const ground: SolidBox = { min: [-40, -1, -40], max: [40, 0, 40] };
const box = (min: Vec3, max: Vec3): SolidBox => ({ min, max });

/** Eye plus the four near-plane corners of the camera as three.js actually draws it (film offset included). */
function frustumTip(camera: THREE.PerspectiveCamera) {
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const points = [camera.position.clone()];
  for (const x of [-1, 1]) for (const y of [-1, 1]) points.push(new THREE.Vector3(x, y, -1).unproject(camera));
  return points;
}
/** The box around eye and near plane is inside no solid: the camera sees nothing from within a wall. */
function clipsInto(camera: THREE.PerspectiveCamera, solids: readonly SolidBox[]): SolidBox | undefined {
  const points = frustumTip(camera);
  const min = [0, 1, 2].map(a => Math.min(...points.map(p => p.getComponent(a))));
  const max = [0, 1, 2].map(a => Math.max(...points.map(p => p.getComponent(a))));
  return solids.find(s => [0, 1, 2].every(a => max[a]! > s.min[a]! && min[a]! < s.max[a]!));
}
/** Does the straight sight line from the eye to the citizen's head pass through a solid? */
function sightBlocked(camera: THREE.PerspectiveCamera, feet: Vec3, solids: readonly SolidBox[]): boolean {
  const eye = camera.position, head = new THREE.Vector3(feet[0], feet[1] + SHOULDER.eyeHeight, feet[2]);
  for (let n = 1; n < 200; n++) {
    const p = eye.clone().lerp(head, n / 200);
    if (solids.some(s => [0, 1, 2].every(a => p.getComponent(a) > s.min[a]! + 1e-9 && p.getComponent(a) < s.max[a]! - 1e-9))) return true;
  }
  return false;
}
function rigAt(width: number, height: number, heading: number) {
  const camera = new THREE.PerspectiveCamera(43, width / height, .15, 2200);
  const rig = createShoulderRig(heading);
  return { camera, rig, aspect: width / height };
}
function run(rig: ShoulderRig, camera: THREE.PerspectiveCamera, feet: Vec3, aspect: number, world: CollisionWorld, frames: number) {
  for (let n = 0; n < frames; n++) { rig.update(FRAME, null, 0, false); rig.apply(camera, feet, aspect, world); }
}

describe('the near-plane footprint', () => {
  for (const { width, height } of SIZES) it(`encloses the frustum three.js draws, lens shift included, at ${width}×${height}`, () => {
    const { camera, rig, aspect } = rigAt(width, height, .7);
    for (const [dx, dy, wheel] of [[0, 0, 0], [400, -300, -300], [-900, 500, 600], [120, 0, -2000]] as const) {
      rig.orbit(dx, dy, height); rig.zoom(wheel);
      for (let n = 0; n < 90; n++) rig.update(FRAME, null, 0, false);
      const pose = rig.apply(camera, [1, 0, 2], aspect);
      const footprint = nearFootprint(pose.direction, pose.fov, aspect, pose.shift, camera.near, 0);
      for (const p of frustumTip(camera)) for (let a = 0; a < 3; a++) {
        const offset = p.getComponent(a) - pose.eye[a]!;
        expect(offset).toBeGreaterThanOrEqual(footprint.min[a]! - 1e-9);
        expect(offset).toBeLessThanOrEqual(footprint.max[a]! + 1e-9);
      }
    }
  });

  it('sweeps a box against a solid without letting a fast move tunnel', () => {
    const footprint = { min: [-.1, -.1, -.1] as Vec3, max: [.1, .1, .1] as Vec3 };
    const thin = box([4.99, 0, -5], [5.01, 3, 5]);
    expect(sweepHit([0, 1, 0], [10, 1, 0], footprint, thin)).toBeCloseTo((4.99 - .1) / 10, 12);
    expect(sweepHit([0, 1, 0], [4.89, 1, 0], footprint, thin)).toBe(Infinity);
    expect(sweepHit([5, 1, 0], [10, 1, 0], footprint, thin)).toBe(0);
    // Touching faces are not an overlap.
    expect(sweepHit([0, 3.1, 0], [10, 3.1, 0], footprint, thin)).toBe(Infinity);
  });
});

describe('the camera stays out of solids', () => {
  for (const { width, height } of SIZES) it(`pulls in on the very first frame a wall appears behind the citizen at ${width}×${height}`, () => {
    const { camera, rig, aspect } = rigAt(width, height, 0);
    const feet: Vec3 = [0, 0, 0];
    const world = worldOf([ground]);
    run(rig, camera, feet, aspect, world, 60);
    expect(rig.view.distance).toBeCloseTo(SHOULDER.distance, 6);
    expect(rig.clearance).toBeNull();
    // A wall is published two metres behind the citizen (the camera stands about six metres back).
    const wall = box([-6, 0, -2.4], [6, 5, -2]);
    world.boxes = [ground, wall];
    rig.update(FRAME, null, 0, false);
    rig.apply(camera, feet, aspect, world);
    expect(clipsInto(camera, world.boxes)).toBeUndefined();
    expect(sightBlocked(camera, feet, world.boxes)).toBe(false);
    expect(camera.position.z).toBeGreaterThan(-2);
    expect(rig.view.distance).toBeLessThan(2.2);
    expect(rig.clearance).toBe(rig.view.distance);
    // The wheel's wish is untouched by the wall.
    expect(rig.desiredDistance).toBeCloseTo(SHOULDER.distance, 9);
    expect(rig.zoomDistance).toBeCloseTo(SHOULDER.distance, 9);
  });

  for (const { width, height } of SIZES) it(`backs into a corner, under a roof and past a thin post without clipping at ${width}×${height}`, () => {
    const scenes: { name: string; solids: SolidBox[]; feet: Vec3; heading: number; pitch?: number }[] = [
      // Inside corner of two walls, citizen facing out of it.
      { name: 'corner', solids: [ground, box([-5, 0, -5], [5, 4, -4]), box([-5, 0, -5], [-4, 4, 5])], feet: [-3.3, 0, -3.3], heading: Math.PI / 4 },
      // Outside corner of a building just behind the left shoulder.
      { name: 'outside corner', solids: [ground, box([-6, 0, -8], [-.6, 5, -1.2])], feet: [0, 0, 0], heading: .25 },
      // Under a porch roof at 2.4 m, the camera would rise through it.
      { name: 'roof', solids: [ground, box([-4, 2.4, -6], [4, 2.7, 2])], feet: [0, 0, 0], heading: 0 },
      // Standing in a doorway (two jambs, a lintel) facing out of a room: the boom backs under its ceiling.
      { name: 'doorway', solids: [ground, box([-3, 0, -.2], [-.5, 3, .2]), box([.5, 0, -.2], [3, 3, .2]), box([-.5, 2.1, -.2], [.5, 3, .2]), box([-3, 3, -4], [3, 3.3, .2]), box([-3, 0, -4.2], [3, 3.3, -4])], feet: [0, 0, 0], heading: 0 },
      // A thin post 8 cm square standing almost on the boom, just off the centre line.
      { name: 'post', solids: [ground, box([.06, 0, -3.04], [.14, 6, -2.96])], feet: [0, 0, 0], heading: 0 },
      // Looking up from beside a fence: the boom swings down into the ground.
      { name: 'ground', solids: [ground, box([-3, 0, -1.2], [3, 1.1, -1])], feet: [0, 0, 0], heading: 0, pitch: -.5 },
    ];
    for (const scene of scenes) {
      const { camera, rig, aspect } = rigAt(width, height, scene.heading);
      if (scene.pitch !== undefined) rig.orbit(0, (scene.pitch - SHOULDER.pitch) / SHOULDER.orbitPitch * height, height);
      run(rig, camera, scene.feet, aspect, worldOf(scene.solids), 3);
      expect(clipsInto(camera, scene.solids), scene.name).toBeUndefined();
      expect(rig.clearance, scene.name).not.toBeNull();
      expect(rig.view.distance, scene.name).toBeLessThan(SHOULDER.distance);
    }
  });

  it('catches an obstruction a centre ray alone would miss', () => {
    // A post standing beside the boom line: the centre of the view never touches it, the near plane would.
    const { camera, rig } = rigAt(1440, 900, 0);
    const feet: Vec3 = [0, 0, 0];
    const centre = shoulderPose([0, 0, 0], { yaw: 0, pitch: SHOULDER.pitch, distance: SHOULDER.distance }, 1.6);
    const at = (d: number) => [-centre.direction[0] * d, centre.eye[1] + centre.direction[1] * (SHOULDER.distance - d), -centre.direction[2] * d];
    const p = at(4);
    // The lens shift widens the frustum toward world -X (camera right when looking +Z).
    const post = box([p[0]! - .16, -1, p[2]! - .05], [p[0]! - .11, 6, p[2]! + .05]);
    run(rig, camera, feet, 1.6, worldOf([post]), 2);
    expect(rig.view.distance).toBeLessThan(4.1);
    expect(clipsInto(camera, [post])).toBeUndefined();
  });

  it('eases back out over about .35 s once clear, independent of the wheel', () => {
    const { camera, rig, aspect } = rigAt(1440, 900, 0);
    const feet: Vec3 = [0, 0, 0];
    const world = worldOf([ground, box([-6, 0, -2.4], [6, 5, -2])]);
    run(rig, camera, feet, aspect, world, 2);
    const pulled = rig.view.distance;
    expect(pulled).toBeLessThan(2.2);
    // Wheeling out behind a wall changes the wish, not what is drawn.
    rig.zoom(200);
    run(rig, camera, feet, aspect, world, 30);
    expect(rig.desiredDistance).toBeGreaterThan(SHOULDER.distance);
    expect(rig.view.distance).toBeCloseTo(pulled, 9);
    rig.zoom(-200);
    run(rig, camera, feet, aspect, world, 60);
    // The wall goes. No jump outward on the first clear frame.
    world.boxes = [ground];
    run(rig, camera, feet, aspect, world, 1);
    expect(rig.view.distance).toBeGreaterThan(pulled);
    expect(rig.view.distance).toBeLessThan(pulled + (SHOULDER.distance - pulled) * .2);
    expect(rig.clearance).toBeNull();
    // Most of the way out by .35 s, all the way soon after, and nothing overshoots.
    run(rig, camera, feet, aspect, world, Math.round(OCCLUSION.recoverSeconds * 60) - 1);
    expect(rig.view.distance).toBeGreaterThan(SHOULDER.distance - (SHOULDER.distance - pulled) * .06);
    run(rig, camera, feet, aspect, world, 60);
    expect(rig.view.distance).toBeCloseTo(SHOULDER.distance, 6);
    // Easing follows rendering time: a slow frame recovers as far as many quick ones.
    const slow = rigAt(1440, 900, 0), fast = rigAt(1440, 900, 0);
    for (const r of [slow, fast]) { world.boxes = [ground, box([-6, 0, -2.4], [6, 5, -2])]; run(r.rig, r.camera, feet, 1.6, world, 2); }
    world.boxes = [ground];
    slow.rig.update(.1, null, 0, false); slow.rig.apply(slow.camera, feet, 1.6, world);
    for (let n = 0; n < 6; n++) { fast.rig.update(1 / 60, null, 0, false); fast.rig.apply(fast.camera, feet, 1.6, world); }
    expect(slow.rig.view.distance).toBeCloseTo(fast.rig.view.distance, 9);
  });

  it('approaches a wall in first person without the near plane entering it', () => {
    for (const { width, height } of SIZES) for (const heading of [Math.PI, Math.PI * .75, Math.PI * 1.2]) for (const pitch of [-.5, 0, .9]) {
      const { camera, rig, aspect } = rigAt(width, height, heading);
      rig.zoom(-5000);
      rig.orbit(0, (pitch - SHOULDER.pitch) / SHOULDER.orbitPitch * height, height);
      // A wall at z = -1; the body stops with its face touching it.
      const wall = box([-5, 0, -2], [5, 4, -1]);
      const solids = [ground, wall];
      const feet: Vec3 = [0, 0, -1 + WALK_BODY.radius];
      run(rig, camera, feet, aspect, worldOf(solids), 120);
      expect(rig.view.distance).toBe(0);
      expect(clipsInto(camera, solids)).toBeUndefined();
    }
  });

  it('lowers the boom’s pivot under a low ceiling instead of lifting it through', () => {
    // A citizen drops off a ledge into a low passage: the camera height still trails above the head.
    const { camera, rig, aspect } = rigAt(1440, 900, 0);
    const ceiling = box([-4, -.45 + WALK_BODY.height + .02, -4], [4, 3, 4]);
    const solids = [box([-4, -2, -4], [4, -.45, 4]), ceiling];
    rig.apply(camera, [0, 0, 0], aspect);
    rig.update(FRAME, null, 0, false);
    rig.apply(camera, [0, -.45, 0], aspect, worldOf(solids));
    expect(clipsInto(camera, solids)).toBeUndefined();
    expect(camera.position.y).toBeLessThan(ceiling.min[1] - OCCLUSION.margin + 1e-9);
    expect(rig.clearance).not.toBeNull();
  });

  for (const { width, height } of SIZES) it(`keeps an upward-looking near plane below a ceiling at the body crown at ${width}×${height}`, () => {
    const { camera, rig, aspect } = rigAt(width, height, 0);
    const ceiling = box([-4, WALK_BODY.height, -4], [4, 3, 4]);
    const world = worldOf([ground, ceiling]);
    rig.orbit(0, (-.5 - SHOULDER.pitch) / SHOULDER.orbitPitch * height, height);
    run(rig, camera, [0, 0, 0], aspect, world, 2);
    expect(clipsInto(camera, world.boxes)).toBeUndefined();
    rig.zoom(-5000);
    run(rig, camera, [0, 0, 0], aspect, world, 120);
    expect(clipsInto(camera, world.boxes)).toBeUndefined();
  });

  for (const { width, height } of SIZES) it(`keeps a short boom over the shoulder, citizen low and left, at ${width}×${height}`, () => {
    const { camera, rig, aspect } = rigAt(width, height, 0);
    const feet: Vec3 = [0, 0, 0];
    run(rig, camera, feet, aspect, worldOf([ground, box([-6, 0, -2.4], [6, 5, -2])]), 2);
    expect(rig.view.distance).toBeLessThan(2.2);
    const head = new THREE.Vector3(0, SHOULDER.eyeHeight, 0).project(camera);
    // The head sits in the lower-left of the picture, not in the middle of the view.
    expect((head.x + 1) / 2).toBeLessThan(.42);
    expect((1 - head.y) / 2).toBeGreaterThanOrEqual((1 - SHOULDER.headY) / 2 - 1e-6);
    expect(camera.filmOffset).toBeGreaterThan(0);
    // Close enough to see the shoulder, far enough that the body is still there, already thinned by the pull-in.
    const opacity = rig.apply(camera, feet, aspect, worldOf([ground, box([-6, 0, -2.4], [6, 5, -2])])).selfOpacity;
    expect(opacity).toBeGreaterThan(.5);
    expect(opacity).toBeLessThan(1);
  });

  it('never clips across a wide sweep of walls, posts and roofs at both aspects', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let occluded = 0;
    for (let n = 0; n < 240; n++) {
      const { width, height } = SIZES[n % 2]!;
      const solids: SolidBox[] = [ground];
      for (let k = 0; k < 5; k++) {
        const x = (random() - .5) * 16, z = (random() - .5) * 16, y = random() < .3 ? 1.9 + random() * 2 : 0;
        const sx = random() < .5 ? .05 + random() * .2 : 1 + random() * 5, sz = random() < .5 ? .05 + random() * .2 : 1 + random() * 5;
        const solid = box([x, y, z], [x + sx, y + .2 + random() * 4, z + sz]);
        // Never inside the body: the body is always clear in a valid step.
        if (solid.max[0] > -WALK_BODY.radius && solid.min[0] < WALK_BODY.radius && solid.max[2] > -WALK_BODY.radius && solid.min[2] < WALK_BODY.radius && solid.min[1] < WALK_BODY.height) continue;
        solids.push(solid);
      }
      const { camera, rig, aspect } = rigAt(width, height, random() * Math.PI * 2);
      rig.orbit(0, (random() - .5) * height * .8, height);
      rig.zoom((random() - .5) * 1600);
      run(rig, camera, [0, 0, 0], aspect, worldOf(solids), 20);
      expect(clipsInto(camera, solids)).toBeUndefined();
      if (rig.clearance !== null) occluded++;
    }
    expect(occluded).toBeGreaterThan(30);
  });

  it('asks the world once per frame and is bounded by the boom length', () => {
    const world = worldOf([ground]);
    const anchor: BoomPoint = { distance: 0, eye: [0, 1.6, 0], footprint: { min: [-.1, -.1, -.1], max: [.1, .1, .1] } };
    let placed = 0;
    const result = clearBoom(world, anchor, d => { placed++; return { distance: d, eye: [0, 1.6 + d * .2, -d], footprint: anchor.footprint }; }, SHOULDER.maxDistance);
    expect(world.queries).toBe(1);
    expect(placed).toBe(Math.ceil(SHOULDER.maxDistance / OCCLUSION.segment) + 1);
    expect(result).toEqual({ distance: SHOULDER.maxDistance, occluded: false, settle: false });
  });
});
