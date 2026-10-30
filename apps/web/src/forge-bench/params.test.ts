import { describe, expect, it } from 'vitest';
import { parseForgeBench } from './params';

describe('Forge review inputs', () => {
  it('defaults to the Hearthfold assembly at dusk with the door open and windows unlit', () => {
    expect(parseForgeBench('')).toEqual({ family: 'hearthfold', view: 'assembly', door: 'open', presence: 'off', hour: 19 });
    expect(parseForgeBench('?family=tidewake&view=window&presence=on&hour=0').presence).toBe('on');
  });
  it('fails visibly on unknown input instead of falling back', () => {
    expect(() => parseForgeBench('?family=lanternmere')).toThrow('Unknown family');
    expect(() => parseForgeBench('?view=interior')).toThrow('Unknown view');
    expect(() => parseForgeBench('?hour=24')).toThrow('Unknown hour');
    expect(() => parseForgeBench('?hour=7.5')).toThrow('Unknown hour');
    expect(() => parseForgeBench('?presence=on')).toThrow('SIMULATED');
    expect(() => parseForgeBench('?owner=someone')).toThrow('Unknown review input');
  });
});
