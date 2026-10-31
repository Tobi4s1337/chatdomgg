import { expect, it } from 'vitest';
import { createLanternLightSelection } from './lantern-light-selection';
const lamp = (slot: number, distance: number) => ({ slot, distance, source: { position: [slot, 1, 0] as const, strength: .7 } });
it('retains a light through small distance crossings and fades it before reusing a budget slot', () => {
  const selection = createLanternLightSelection(1);
  expect(selection.update([lamp(1, 10), lamp(2, 11)], 0)[0]?.position[0]).toBe(1);
  expect(selection.update([lamp(1, 11), lamp(2, 10)], .1)[0]?.position[0]).toBe(1);
  const strengths: number[] = [];
  for (let frame = 2; frame <= 10; frame++) {
    const lights = selection.update([lamp(1, 30), lamp(2, 5)], frame / 10);
    expect(lights.length).toBeLessThanOrEqual(1);
    strengths.push(lights.find(light => light.position[0] === 1)?.strength ?? 0);
  }
  expect(strengths[0]).toBeGreaterThan(0); expect(strengths[0]).toBeLessThan(.7);
  expect(strengths).toEqual([...strengths].sort((a, b) => b - a));
  const newcomer = selection.update([lamp(2, 5)], 1.1)[0]!;
  expect(newcomer.position[0]).toBe(2); expect(newcomer.strength).toBeGreaterThan(0); expect(newcomer.strength).toBeLessThan(.7);
});
it('fades a culled light at its last position rather than removing its pool in one frame', () => {
  const selection = createLanternLightSelection(24);
  expect(selection.update([], 0)).toEqual([]);
  expect(selection.update([lamp(1, 10)], 0)[0]?.strength).toBe(.7);
  const fading = selection.update([], .1)[0]!;
  expect(fading.position).toEqual([1, 1, 0]); expect(fading.strength).toBeGreaterThan(0); expect(fading.strength).toBeLessThan(.7);
  for (let frame = 2; frame <= 8; frame++) selection.update([], frame / 10);
  expect(selection.update([], .9)).toEqual([]);
  expect(selection.update([lamp(2, 1)], 0)[0]?.strength).toBe(.7);
});
it('keeps illumination from every rendered lantern rather than cutting the field at twenty-four', () => {
  const selection = createLanternLightSelection(64);
  const candidates = Array.from({ length: 40 }, (_, slot) => lamp(slot, slot + 1));
  expect(selection.update(candidates, 0)).toHaveLength(40);
  const reversed = candidates.map(candidate => ({ ...candidate, distance: 41 - candidate.slot }));
  expect(selection.update(reversed, .1)).toHaveLength(40);
  expect(selection.update(reversed, .2).every(source => source.strength === .7)).toBe(true);
});
