import { describe, expect, it } from 'vitest';
import { Box3, Spherical, Vector3 } from 'three';
import { boundedOverviewView, orbitOverviewView, overviewFrame } from './overview-pose';

const land = new Box3(new Vector3(-400, -20, -600), new Vector3(1100, 400, 900));
const town = new Box3(new Vector3(-40, 4, -80), new Vector3(240, 70, 200));
const frame = overviewFrame(land, town, 16 / 9);
const spherical = (view: typeof frame.initial) => new Spherical().setFromVector3(new Vector3(...view.eye).sub(new Vector3(...view.target)));

describe('native grand overview framing', () => {
  it('anchors its initial target to the installed physical town inside the hosted, seated bounds', () => {
    expect(frame.initial.target).toEqual(town.getCenter(new Vector3()).toArray());
    const shifted = new Vector3(800, 21, -900);
    const translated = overviewFrame(land.clone().translate(shifted), town.clone().translate(shifted), 16 / 9);
    expect(new Vector3(...translated.initial.eye).sub(shifted).distanceTo(new Vector3(...frame.initial.eye))).toBeLessThan(1e-9);
    expect(new Vector3(...translated.initial.target).sub(shifted).distanceTo(new Vector3(...frame.initial.target))).toBeLessThan(1e-9);
  });

  it('fits the narrower phone screen by increasing distance while retaining the installed target', () => {
    const phone = overviewFrame(land, town, 390 / 844);
    expect(phone.initial.target).toEqual(frame.initial.target);
    expect(spherical(phone.initial).radius).toBeGreaterThan(spherical(frame.initial).radius);
  });

  it('restores the exact eye, real orbit target and FOV through successive revision handoffs', () => {
    const view = { eye: [420, 280, 630] as const, target: [61, 38, -15] as const, fov: 48 };
    let restored = boundedOverviewView(frame, view);
    for (let i = 0; i < 12; i++) restored = boundedOverviewView(frame, restored);
    expect(new Vector3(...restored.eye).distanceTo(new Vector3(...view.eye))).toBeLessThan(1e-9);
    expect(restored.target).toEqual(view.target); expect(restored.fov).toBe(48);
    expect(spherical(restored).radius).toBeGreaterThan(16);
  });

  it.each([[-1e9, -1e9], [1e9, 1e9]])('clamps public pitch %s and distance %s to safe limits', (pitch, distance) => {
    const view = orbitOverviewView(frame, frame.initial, 1e12, pitch, distance), orbit = spherical(view);
    expect(orbit.radius).toBeGreaterThanOrEqual(frame.limits.minDistance - 1e-9);
    expect(orbit.radius).toBeLessThanOrEqual(frame.limits.maxDistance + 1e-9);
    expect(Math.PI / 2 - orbit.phi).toBeGreaterThanOrEqual(frame.limits.minPitch - 1e-9);
    expect(Math.PI / 2 - orbit.phi).toBeLessThanOrEqual(frame.limits.maxPitch + 1e-9);
  });

  it('preserves null orbit components and clamps a saved target without changing its offset', () => {
    const unchanged = orbitOverviewView(frame, frame.initial, null, null, null);
    expect(new Vector3(...unchanged.eye).distanceTo(new Vector3(...frame.initial.eye))).toBeLessThan(1e-9);
    const saved = { eye: [6000, 300, 6000] as const, target: [5900, 30, 5800] as const, fov: 43 };
    const restored = boundedOverviewView(frame, saved);
    expect(restored.target).toEqual([1100, 30, 900]);
    expect(spherical(restored).radius).toBeCloseTo(spherical(saved).radius, 8);
  });

  it('rejects nonfinite, degenerate or invalid public data without mutating the saved pose or bounds', () => {
    const saved = structuredClone(frame.initial), bounds = frame.bounds.clone();
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => orbitOverviewView(frame, saved, invalid, null, null)).toThrow('finite');
      expect(() => orbitOverviewView(frame, saved, null, invalid, null)).toThrow('finite');
      expect(() => orbitOverviewView(frame, saved, null, null, invalid)).toThrow('finite');
    }
    expect(() => boundedOverviewView(frame, { ...saved, eye: saved.target })).toThrow('distinct');
    expect(() => boundedOverviewView(frame, { ...saved, fov: 0 })).toThrow('finite');
    expect(() => boundedOverviewView(frame, { ...saved, eye: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE], target: [-Number.MAX_VALUE, 0, 0] })).toThrow('finite');
    expect(() => overviewFrame(new Box3(), town, 1)).toThrow('bounds');
    expect(() => overviewFrame(land, town, 0)).toThrow('bounds');
    expect(saved).toEqual(frame.initial); expect(frame.bounds.equals(bounds)).toBe(true);
  });
});
