import { expect, it } from 'vitest';
import { FLIGHT_S, LEAP_S, fishPath, floatPosition, leapPosition, linePoint, lineSag, rodPose, type LinePhase, type Vec } from './motion';

const PHASES: LinePhase[] = ['held', 'drawing', 'flying', 'waiting', 'bite', 'fighting', 'hauling', 'leaping', 'landed', 'reeling', 'snapped'];
const fight = { tension: .6, progress: .4, run: false, tired: false, reeling: true };

it('gives a finite rod pose for every phase and moment, drawn back past upright and whipped forward', () => {
  const out = { pitch: 0, bend: 0, shake: 0 };
  for (const phase of PHASES) for (let age = 0; age < 3; age += .05) {
    rodPose(phase, age, age + 10, fight, age, out);
    expect([out.pitch, out.bend, out.shake].every(Number.isFinite), `${phase} ${age}`).toBe(true);
  }
  expect(rodPose('drawing', 1.4, 0, fight, 1.4, out).pitch).toBeGreaterThan(Math.PI / 2);
  expect(rodPose('flying', .16, 0, fight, 0, out).pitch).toBeLessThan(.3);
  // The rod bends harder under more load.
  const light = rodPose('fighting', 1, 1, { ...fight, tension: .1 }, 1, { pitch: 0, bend: 0, shake: 0 }).bend;
  expect(rodPose('fighting', 1, 1, { ...fight, tension: .95 }, 1, out).bend).toBeGreaterThan(light + .5);
});

it('arcs the float out and lands it exactly on its server target, riding the water surface', () => {
  const from: Vec = [0, 3, 0], target: Vec = [0, 0, 8], fish: Vec = [0, 0, 6], out: Vec = [0, 0, 0];
  floatPosition('flying', FLIGHT_S / 2, 0, from, target, fish, 0, 0, 0, out);
  expect(out[1]).toBeGreaterThan(2);
  floatPosition('flying', FLIGHT_S, 0, from, target, fish, 0, 0, 0, out);
  out.forEach((value, axis) => expect(value).toBeCloseTo(target[axis]!, 9));
  for (let t = 0; t < 20; t += .1) {
    floatPosition('waiting', t, t, from, target, fish, 0, 1, 0, out);
    expect(Math.abs(out[1])).toBeLessThan(.05);
  }
  floatPosition('bite', .5, 0, from, target, fish, 0, 0, 0, out);
  expect(out[1]).toBeLessThan(-.1);
});

it('never lets the line through the water before it reaches the float', () => {
  const tip: Vec = [0, 2.6, 0], end: Vec = [0, -.06, 8], out: Vec = [0, 0, 0];
  for (const phase of PHASES) {
    const sag = lineSag(phase, .3, .2);
    expect(sag).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 21; i++) {
      linePoint(tip, end, sag, i / 21, 0, out);
      expect(out[1]).toBeGreaterThanOrEqual(0);
    }
  }
  linePoint(tip, end, .1, 1, 0, out).forEach((value, axis) => expect(value).toBeCloseTo(end[axis]!, 9));
});

it('brings the fish to the pier as the fight is won and lands it on the planks', () => {
  const target: Vec = [0, 0, 10], near: Vec = [0, 0, 2], right: Vec = [1, 0, 0], out: Vec = [0, 0, 0];
  fishPath(3, 1, target, near, right, 0, 0, 0, out);
  const far = Math.hypot(out[0] - near[0], out[2] - near[2]);
  fishPath(3, 1, target, near, right, 1, 0, 0, out);
  expect(Math.hypot(out[0] - near[0], out[2] - near[2])).toBeLessThan(.01);
  expect(far).toBeGreaterThan(5);
  expect(out[1]).toBeLessThan(0);
  const deck: Vec = [0, 1.1, 1];
  leapPosition(LEAP_S / 2, [0, -.1, 2], deck, out);
  expect(out[1]).toBeGreaterThan(1.5);
  leapPosition(LEAP_S, [0, -.1, 2], deck, out);
  expect(out.map(value => Math.round(value * 1000) / 1000)).toEqual(deck);
});
