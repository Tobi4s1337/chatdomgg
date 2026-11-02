import { describe, expect, it } from 'vitest';
import { coverFrame, HERO_FRAMES, HERO_ORBIT, nearestFrame, orbitYaw, restOrbit, SHOT, startOrbit, stepOrbit } from './frame';

describe('the hero frame', () => {
  it('puts the crop of the shot exactly where the hero picture draws it', () => {
    // 1440x900: the 1920x1008 picture covers by height (scale 900/1008), centred across, its top at the hero's top.
    const box = coverFrame(1440, 900);
    const scale = 900 / 1008;
    expect(box.width).toBeCloseTo(1920 * scale);
    expect(box.height).toBeCloseTo(1080 * scale);
    expect(box.left).toBeCloseTo((1440 - 1920 * scale) / 2);
    expect(box.top + SHOT.cropTop * scale).toBeCloseTo(0);
  });

  it('follows object-position when the picture covers by width', () => {
    const box = coverFrame(2400, 900);
    const scale = 2400 / 1920, cropHeight = 1008 * scale;
    expect(box.left).toBeCloseTo(0);
    expect(box.top + SHOT.cropTop * scale).toBeCloseTo((900 - cropHeight) * 0.58);
    expect(box.width / box.height).toBeCloseTo(16 / 9);
  });

  it('starts the orbit from rest at a picture\'s yaw and eases into motion', () => {
    let state = startOrbit(HERO_FRAMES[1].yaw);
    expect(orbitYaw(state)).toBeCloseTo(90);
    state = stepOrbit(state, 1 / 60);
    const first = orbitYaw(state) - 90;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.001);
    for (let i = 0; i < 60 * 20; i++) state = stepOrbit(state, 1 / 60);
    const before = orbitYaw(state);
    state = stepOrbit(state, 1 / 60);
    // Cruising: never faster than its speed, and inside its swing.
    expect(Math.abs(orbitYaw(state) - before) * 60).toBeLessThanOrEqual(HERO_ORBIT.speed + 1e-9);
    expect(Math.abs(orbitYaw(state) - HERO_ORBIT.centre)).toBeLessThanOrEqual(HERO_ORBIT.swing + 1e-9);
  });

  it('rests in place and rises from rest again', () => {
    let state = startOrbit(120);
    for (let i = 0; i < 600; i++) state = stepOrbit(state, 1 / 60);
    const rested = restOrbit(state);
    expect(orbitYaw(rested)).toBeCloseTo(orbitYaw(state));
    const next = stepOrbit(rested, 1 / 60);
    expect(Math.abs(orbitYaw(next) - orbitYaw(rested))).toBeLessThan(0.001);
    // A long pause between frames (a hidden tab) never jumps the camera.
    expect(Math.abs(orbitYaw(stepOrbit(state, 30)) - orbitYaw(state))).toBeLessThan(0.2);
  });

  it('finds the picture nearest a yaw', () => {
    expect(nearestFrame(118)).toBe(0);
    expect(nearestFrame(70)).toBe(1);
    expect(nearestFrame(166)).toBe(2);
  });
});
