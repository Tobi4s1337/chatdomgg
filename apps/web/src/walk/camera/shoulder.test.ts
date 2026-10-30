import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WALK_BODY } from '@chatdom/shared/realm';
import { createShoulderRig, shoulderPose, SHOULDER, type Vec3 } from './shoulder';

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

  it('wheels continuously into the head and back out, with no stuck minimum', () => {
    const camera = new THREE.PerspectiveCamera(43, 1, .15, 2200);
    const rig = createShoulderRig(0), feet: Vec3 = [0, 0, 0];
    let previous = rig.apply(camera, feet, 1.6).eye;
    let largestJump = 0;
    for (let n = 0; n < 400 && rig.view.distance > 0; n++) {
      rig.zoom(-12); rig.update(1 / 60, null, 0, false);
      const pose = rig.apply(camera, feet, 1.6);
      largestJump = Math.max(largestJump, Math.hypot(pose.eye[0] - previous[0], pose.eye[1] - previous[1], pose.eye[2] - previous[2]));
      previous = pose.eye;
    }
    expect(rig.view.distance).toBe(0);
    expect(largestJump).toBeLessThan(.2);
    const inside = rig.apply(camera, feet, 1.6);
    expect(inside.eye).toEqual([0, SHOULDER.eyeHeight, 0]);
    expect([inside.shift, inside.selfOpacity, camera.filmOffset]).toEqual([0, 0, 0]);
    for (let n = 0; n < 200; n++) { rig.zoom(24); rig.update(1 / 60, null, 0, false); }
    const out = rig.apply(camera, feet, 1.6);
    expect(rig.view.distance).toBe(SHOULDER.maxDistance);
    expect(out.selfOpacity).toBe(1);
    expect(camera.filmOffset).toBeGreaterThan(0);
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
});
