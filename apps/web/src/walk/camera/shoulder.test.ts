import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WALK_BODY, type CollisionWorld, type SolidBox } from '@chatdom/shared/realm';
import { createShoulderRig, fovScaleFor, framingFor, shoulderPose, SHOULDER, type Vec3 } from './shoulder';

const SIZES = [{ width: 1440, height: 900 }, { width: 390, height: 844 }] as const;
function pixel(camera: THREE.PerspectiveCamera, point: Vec3, width: number, height: number) {
  const p = new THREE.Vector3(...point).project(camera);
  return { x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height, depth: p.z };
}
function placed(width: number, height: number, feet: Vec3 = [3, 1.25, -7], heading = 2.2) {
  const camera = new THREE.PerspectiveCamera(43, 1, .15, 2200);
  const rig = createShoulderRig(heading);
  rig.update(0, null, 0, false);
  const pose = rig.apply(camera, feet, width / height);
  return { camera, rig, pose, feet };
}

describe('the shoulder view', () => {
  for (const { width, height } of SIZES) it(`stands the citizen in the lower-left third at ${width}×${height}`, () => {
    const { camera, feet } = placed(width, height);
    const centre = pixel(camera, [feet[0], feet[1] + SHOULDER.bodyCentre, feet[2]], width, height);
    const foot = pixel(camera, feet, width, height);
    const crown = pixel(camera, [feet[0], feet[1] + WALK_BODY.height, feet[2]], width, height);
    // Left third column and lower third band, measured in the actual drawn pixels.
    expect(centre.x).toBeGreaterThan(width * .2);
    expect(centre.x).toBeLessThan(width * (1 / 3 + .04));
    expect(centre.y).toBeGreaterThan(height * .6);
    expect(foot.y).toBeLessThan(height * .9);
    expect(crown.y).toBeGreaterThan(height * .38);
    // Small enough for the kingdom to feel large, never a giant head.
    const tall = (foot.y - crown.y) / height;
    expect(tall).toBeGreaterThan(.16);
    expect(tall).toBeLessThan(.3);
    // Most of the picture is the street ahead: everything right of the citizen and the upper half.
    expect(width - centre.x).toBeGreaterThan(width * .6);
  });

  for (const { width, height } of SIZES) it(`walks forward straight into the picture at ${width}×${height}`, () => {
    const { camera, rig, feet } = placed(width, height);
    const start = pixel(camera, [feet[0], feet[1] + SHOULDER.bodyCentre, feet[2]], width, height);
    const yaw = rig.view.yaw;
    // Far along the walking direction, at body height: the vanishing point of "forward".
    const far = pixel(camera, [feet[0] + Math.sin(yaw) * 400, feet[1] + SHOULDER.bodyCentre, feet[2] + Math.cos(yaw) * 400], width, height);
    expect(Math.abs(far.x - start.x)).toBeLessThan(1);
    expect(far.y).toBeLessThan(start.y);
  });

  it('keeps the horizon level whatever the orbit', () => {
    const { camera, rig, feet } = placed(1440, 900);
    for (const [dx, dy] of [[300, 0], [-700, 200], [50, -400], [0, 900]] as const) {
      rig.orbit(dx, dy, 900);
      rig.apply(camera, feet, 1.6);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      expect(Math.abs(right.y)).toBeLessThan(1e-9);
      expect(rig.view.pitch).toBeLessThanOrEqual(SHOULDER.maxPitch);
      expect(rig.view.pitch).toBeGreaterThanOrEqual(SHOULDER.minPitch);
    }
  });

  it('turns the view right when dragged right, and looks up when dragged up', () => {
    const rig = createShoulderRig(Math.PI);
    rig.orbit(90, -45, 900);
    // Turning right from -Z swings the look toward +X: heading moves from π toward π/2.
    expect(rig.view.yaw).toBeLessThan(Math.PI);
    expect(rig.view.pitch).toBeLessThan(SHOULDER.pitch);
  });

  it('wheels continuously down to the closest shoulder view and back out, never into the skull', () => {
    const camera = new THREE.PerspectiveCamera(43, 1, .15, 2200);
    const rig = createShoulderRig(0), feet: Vec3 = [0, 0, 0];
    let previous = rig.apply(camera, feet, 1.6).eye;
    let largestJump = 0;
    for (let n = 0; n < 400; n++) {
      rig.zoom(-12); rig.update(1 / 60, null, 0, false);
      const pose = rig.apply(camera, feet, 1.6);
      largestJump = Math.max(largestJump, Math.hypot(pose.eye[0] - previous[0], pose.eye[1] - previous[1], pose.eye[2] - previous[2]));
      previous = pose.eye;
    }
    expect(rig.view.distance).toBeCloseTo(SHOULDER.minThirdDistance, 6);
    expect(largestJump).toBeLessThan(.2);
    for (let n = 0; n < 200; n++) { rig.zoom(24); rig.update(1 / 60, null, 0, false); rig.apply(camera, feet, 1.6); }
    const out = rig.apply(camera, feet, 1.6);
    expect(rig.view.distance).toBe(SHOULDER.maxDistance);
    expect(out.selfOpacity).toBe(1);
    expect(camera.filmOffset).toBeGreaterThan(0);
  });

  it('swings the boom smoothly into first person on V and back out to the same shoulder view', () => {
    const camera = new THREE.PerspectiveCamera(43, 1, .15, 2200);
    const rig = createShoulderRig(0), feet: Vec3 = [0, 0, 0];
    rig.update(1 / 60, null, 0, false);
    let previous = rig.apply(camera, feet, 1.6).eye, largestJump = 0;
    rig.setPerson('first');
    for (let n = 0; n < 60; n++) {
      rig.update(1 / 60, null, 0, false);
      const pose = rig.apply(camera, feet, 1.6);
      largestJump = Math.max(largestJump, Math.hypot(pose.eye[0] - previous[0], pose.eye[1] - previous[1], pose.eye[2] - previous[2]));
      previous = pose.eye;
    }
    // About 6.5 m covered in .42 s with an eased start and end: no single frame pops.
    expect(largestJump).toBeLessThan(.45);
    const inside = rig.apply(camera, feet, 1.6);
    expect(rig.person).toBe('first');
    expect(rig.view.distance).toBe(0);
    expect(inside.eye).toEqual([0, SHOULDER.eyeHeight, 0]);
    expect([inside.shift, inside.selfOpacity, camera.filmOffset]).toEqual([0, 0, 0]);
    rig.zoom(-500); // the wheel does not move first person
    rig.setPerson('third');
    for (let n = 0; n < 60; n++) { rig.update(1 / 60, null, 0, false); rig.apply(camera, feet, 1.6); }
    expect(rig.view.distance).toBeCloseTo(SHOULDER.distance, 6);
    expect(rig.apply(camera, feet, 1.6).selfOpacity).toBe(1);
  });

  it('scales every framing by the field-of-view setting, with 74° horizontal as today’s lens', () => {
    expect(fovScaleFor(74)).toBeCloseTo(1, 2);
    expect(framingFor(1.6, fovScaleFor(90)).fov).toBeGreaterThan(framingFor(1.6).fov);
    expect(framingFor(1.6, fovScaleFor(55)).fov).toBeLessThan(framingFor(1.6).fov);
  });

  it('keeps the wheel’s wish apart from what is drawn while it eases', () => {
    const rig = createShoulderRig(0);
    rig.zoom(-200);
    expect(rig.desiredDistance).toBeLessThan(SHOULDER.distance);
    expect(rig.view.distance).toBe(SHOULDER.distance);
    rig.update(1 / 60, null, 0, false);
    expect(rig.view.distance).toBeLessThan(SHOULDER.distance);
    expect(rig.view.distance).toBeGreaterThan(rig.desiredDistance);
    // Easing follows rendering time: one long frame is the same as many short ones.
    const a = createShoulderRig(0), b = createShoulderRig(0);
    a.zoom(-200); b.zoom(-200);
    a.update(.06, null, 0, false);
    for (let n = 0; n < 6; n++) b.update(.01, null, 0, false);
    expect(a.view.distance).toBeCloseTo(b.view.distance, 9);
  });

  it('swings behind the walk only after a manual orbit has rested', () => {
    const rig = createShoulderRig(0);
    rig.orbit(-200, 0, 900);
    const turned = rig.view.yaw;
    for (let n = 0; n < 60; n++) rig.update(1 / 60, 0, 4, false);
    expect(rig.view.yaw).toBe(turned);
    for (let n = 0; n < 60; n++) rig.update(1 / 60, 0, 4, false);
    expect(Math.abs(rig.view.yaw)).toBeLessThan(turned);
    // Never while the drag is held, never while standing, never across a reversal.
    const held = createShoulderRig(0);
    for (let n = 0; n < 300; n++) held.update(1 / 60, .5, 4, true);
    expect(held.view.yaw).toBe(0);
    const still = createShoulderRig(0);
    for (let n = 0; n < 300; n++) still.update(1 / 60, .5, 0, false);
    expect(still.view.yaw).toBe(0);
    const back = createShoulderRig(0);
    for (let n = 0; n < 300; n++) back.update(1 / 60, Math.PI, 4, false);
    expect(back.view.yaw).toBe(0);
  });

  it('eases a jump or step for the camera without trailing far behind', () => {
    const camera = new THREE.PerspectiveCamera(43, 1, .15, 2200);
    const rig = createShoulderRig(0);
    const ground = rig.apply(camera, [0, 0, 0], 1.6).eye[1];
    rig.update(1 / 60, null, 0, false);
    const stepped = rig.apply(camera, [0, .5, 0], 1.6).eye[1];
    expect(stepped - ground).toBeGreaterThan(0);
    expect(stepped - ground).toBeLessThan(.5);
    rig.update(1 / 60, null, 0, false);
    const tall = rig.apply(camera, [0, 3, 0], 1.6).eye[1];
    expect(tall - ground).toBeGreaterThanOrEqual(3 - SHOULDER.heightLag - 1e-9);
    rig.settle();
    expect(rig.apply(camera, [0, 3, 0], 1.6).eye[1] - ground).toBeCloseTo(3, 9);
  });

  it('blends portrait and landscape framing without a jump as a phone turns', () => {
    const feet: Vec3 = [0, 0, 0], view = { yaw: 0, pitch: SHOULDER.pitch, distance: SHOULDER.distance };
    let previous = shoulderPose(feet, view, .46);
    for (let aspect = .47; aspect <= 2; aspect += .01) {
      const pose = shoulderPose(feet, view, aspect);
      expect(Math.abs(pose.fov - previous.fov)).toBeLessThan(.8);
      expect(Math.abs(pose.shift - previous.shift)).toBeLessThan(.01);
      previous = pose;
    }
  });

  /** Flat ground and, when `gap` is a number, a wall that far behind a citizen at the origin facing +Z. */
  const backed = (gap: number | null): CollisionWorld => {
    const solids: SolidBox[] = [{ min: [-50, -1, -50], max: [50, 0, 50] }];
    if (gap !== null) solids.push({ min: [-50, 0, -gap - .4], max: [50, 8, -gap] });
    return { revision: 1, query: () => solids };
  };

  for (const { width, height } of SIZES) it(`looks past a faint citizen when a wall pulls the camera in at ${width}×${height}`, () => {
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(43, 1, .15, 2200);
    const rig = createShoulderRig(0);
    rig.update(0, null, 0, false);
    const pulled = rig.apply(camera, [0, 0, 0], aspect, backed(1.4));
    expect(rig.view.distance).toBeLessThan(1.45);
    // Backed against the wall the head would cover most of the lower half: it is all but gone.
    const crown = pixel(camera, [0, WALK_BODY.height, 0], width, height);
    expect(crown.y).toBeLessThan(height * .55);
    expect(pulled.selfOpacity).toBeLessThan(.15);
    // The shoulder, the safe boom and the street ahead are exactly what they were; only the citizen faded.
    expect(pulled.shift).toBeGreaterThan(.3);
    const plain = shoulderPose([0, 0, 0], rig.view, aspect);
    expect(pulled.eye).toEqual(plain.eye);
    expect(plain.selfOpacity).toBe(1);

    // The same short boom chosen with the wheel is the walker's over-the-shoulder view: the citizen stays.
    const wheeled = createShoulderRig(0);
    wheeled.zoom((Math.sqrt(rig.view.distance / SHOULDER.maxDistance) - Math.sqrt(SHOULDER.distance / SHOULDER.maxDistance)) / SHOULDER.wheelZoom);
    for (let n = 0; n < 120; n++) wheeled.update(1 / 60, null, 0, false);
    expect(wheeled.view.distance).toBeCloseTo(rig.view.distance, 6);
    expect(wheeled.apply(camera, [0, 0, 0], aspect, backed(null)).selfOpacity).toBe(1);

    // A wall far enough behind that the view keeps its feet in the picture leaves the citizen whole.
    const roomy = createShoulderRig(0);
    roomy.update(0, null, 0, false);
    expect(roomy.apply(camera, [0, 0, 0], aspect, backed(3.2)).selfOpacity).toBeGreaterThan(.97);
  });

  it('brings the citizen back as smoothly as the camera when the wall goes', () => {
    const camera = new THREE.PerspectiveCamera(43, 1, .15, 2200);
    const rig = createShoulderRig(0);
    rig.update(0, null, 0, false);
    let previous = rig.apply(camera, [0, 0, 0], 390 / 844, backed(1.4)).selfOpacity;
    let largest = 0;
    for (let n = 0; n < 60; n++) {
      rig.update(1 / 60, null, 0, false);
      const opacity = rig.apply(camera, [0, 0, 0], 390 / 844, backed(null)).selfOpacity;
      expect(opacity).toBeGreaterThanOrEqual(previous);
      largest = Math.max(largest, opacity - previous);
      previous = opacity;
    }
    expect(previous).toBe(1);
    expect(largest).toBeLessThan(.2);
    // Wheeling in while still against the wall hands the fade back to the wheel's own first-person fade.
    const pressed = createShoulderRig(0);
    pressed.update(0, null, 0, false);
    pressed.apply(camera, [0, 0, 0], 1.6, backed(.6));
    pressed.zoom(-2000);
    for (let n = 0; n < 120; n++) pressed.update(1 / 60, null, 0, false);
    expect(pressed.apply(camera, [0, 0, 0], 1.6, backed(.6)).selfOpacity).toBe(0);
  });

  it('draws the walking camera without a view offset another owner left behind', () => {
    const camera = new THREE.PerspectiveCamera(43, 1, .15, 2200);
    const rig = createShoulderRig(0);
    rig.apply(camera, [0, 0, 0], 1.6, backed(1.4));
    const clean = camera.projectionMatrix.clone();
    // The Forge and build compose with setViewOffset; a close that forgot to clear it must not shift the frustum
    // past the near-plane footprint the boom was kept clear with.
    camera.setViewOffset(1440, 900, -105, 15, 1440, 900);
    rig.apply(camera, [0, 0, 0], 1.6, backed(1.4));
    expect(camera.view?.enabled ?? false).toBe(false);
    expect(camera.projectionMatrix.elements).toEqual(clean.elements);
  });
});

describe('a place\'s camera limits', () => {
  it('shortens the boom and eases the pitch into the room\'s range, and lifts both on leaving', () => {
    const rig = createShoulderRig(0);
    rig.zoom(1e6);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, null, 0, false);
    const far = rig.desiredDistance;
    expect(far).toBeGreaterThan(5);
    rig.setLimits({ maxDistance: 2.5, minPitch: .3, maxPitch: .6 });
    expect(rig.desiredDistance).toBeCloseTo(2.5, 9);
    rig.update(1 / 60, null, 0, false);
    const firstStep = rig.view.pitch;
    expect(firstStep).toBeGreaterThan(SHOULDER.pitch);
    expect(firstStep).toBeLessThan(.3);
    for (let i = 0; i < 180; i++) rig.update(1 / 60, null, 0, false);
    expect(rig.view.pitch).toBeCloseTo(.3, 3);
    // Looking up past the range is held at its edge; looking back down moves freely.
    rig.orbit(0, -900, 900);
    expect(rig.view.pitch).toBeGreaterThanOrEqual(.3 - 1e-3);
    rig.setLimits(null);
    expect(rig.desiredDistance).toBeCloseTo(far, 9);
    rig.setLimits({ maxDistance: -1, minPitch: 0, maxPitch: 1 });
    expect(rig.desiredDistance).toBeCloseTo(far, 9);
  });
});
