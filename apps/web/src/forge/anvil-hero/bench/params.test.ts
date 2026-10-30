import { describe, expect, it } from 'vitest';
import { parseBench } from './params';

describe('anvil bench inputs', () => {
  it('defaults to the cold close anvil at dusk', () => {
    expect(parseBench('')).toEqual({ view: 'anvil-close', style: 'hearth', hour: 19, heat: 0, time: 0 });
    expect(parseBench('?view=anvil-square&style=grove&hour=7&heat=0&time=4.25')).toEqual({ view: 'anvil-square', style: 'grove', hour: 7, heat: 0, time: 4.25 });
  });
  it('refuses what it cannot honestly show', () => {
    expect(() => parseBench('?view=dragon-close')).toThrow(/not carved yet/);
    expect(() => parseBench('?view=front')).toThrow(/Unknown view/);
    expect(() => parseBench('?style=marble')).toThrow(/Unknown style/);
    expect(() => parseBench('?hour=24')).toThrow(/hour/);
    expect(() => parseBench('?heat=1.5')).toThrow(/heat/);
    expect(() => parseBench('?heat=.5')).toThrow(/not carved yet/);
    expect(() => parseBench('?time=-1')).toThrow(/time/);
    expect(() => parseBench('?seed=3')).toThrow(/Unknown bench input/);
    expect(() => parseBench('?view=anvil-close&view=anvil-square')).toThrow(/once/);
  });
});
