import { describe, expect, it } from 'vitest';
import { parseBench } from './params';

describe('anvil bench inputs', () => {
  it('defaults to the cold close anvil at dusk', () => {
    expect(parseBench('')).toEqual({ view: 'anvil-close', style: 'hearth', hour: 19, heat: 0, time: 0, shaping: false });
    expect(parseBench('?view=anvil-square&style=grove&hour=7&heat=0&time=4.25')).toEqual({ view: 'anvil-square', style: 'grove', hour: 7, heat: 0, time: 4.25, shaping: false });
    expect(parseBench('?view=dragon-square&style=tide')).toEqual({ view: 'dragon-square', style: 'tide', hour: 19, heat: 0, time: 0, shaping: false });
    expect(parseBench('?view=anvil-mark&heat=.85&time=2&shaping=1')).toEqual({ view: 'anvil-mark', style: 'hearth', hour: 19, heat: .85, time: 2, shaping: true });
  });
  it('refuses what it cannot honestly show', () => {
    expect(() => parseBench('?view=front')).toThrow(/Unknown view/);
    expect(() => parseBench('?style=marble')).toThrow(/Unknown style/);
    expect(() => parseBench('?hour=24')).toThrow(/hour/);
    expect(() => parseBench('?heat=1.5')).toThrow(/heat/);
    expect(() => parseBench('?shaping=yes')).toThrow(/shaping/);
    expect(() => parseBench('?time=-1')).toThrow(/time/);
    expect(() => parseBench('?seed=3')).toThrow(/Unknown bench input/);
    expect(() => parseBench('?view=anvil-close&view=anvil-square')).toThrow(/once/);
  });
});
