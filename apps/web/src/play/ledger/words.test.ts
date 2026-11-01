import { describe, expect, it } from 'vitest';
import { keyName } from './keys';
import { directionWords, distanceWords, folio, SENSITIVITY_STOPS, sensitivityStop, wrapAngle } from './words';

describe('the ledger words', () => {
  it('says distance in metres only, exact up close and rounded the way a person would say it', () => {
    expect(distanceWords(1.2)).toBe('right beside you');
    expect(distanceWords(12.4)).toBe('12 metres away');
    expect(distanceWords(43)).toBe('about 45 metres away');
    expect(distanceWords(118)).toBe('about 120 metres away');
    expect(distanceWords(1234)).toBe('about 1,250 metres away');
    expect(distanceWords(Number.NaN)).toBe('');
  });

  it('says the direction relative to where you look', () => {
    expect(directionWords(0)).toBe('straight ahead');
    expect(directionWords(Math.PI / 4)).toBe('ahead, to your right');
    expect(directionWords(-Math.PI / 2)).toBe('to your left');
    expect(directionWords(Math.PI * .8)).toBe('behind you, to your right');
    expect(directionWords(Math.PI)).toBe('behind you');
    expect(directionWords(Math.PI * 2 + .1)).toBe('straight ahead');
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
  });

  it('numbers the leaves like a ledger', () => {
    expect([1, 2, 3, 4, 5, 9, 14].map(folio)).toEqual(['i', 'ii', 'iii', 'iv', 'v', 'ix', 'xiv']);
  });

  it('moves sensitivity in even steps of feel with 1 in the middle and both limits reachable', () => {
    expect(SENSITIVITY_STOPS[0]).toBe(.25);
    expect(SENSITIVITY_STOPS[16]).toBe(1);
    expect(SENSITIVITY_STOPS[32]).toBe(4);
    expect(sensitivityStop(1)).toBe(16);
    expect(sensitivityStop(.255)).toBe(0);
    expect(sensitivityStop(3.9)).toBe(32);
  });
});

describe('printed key names', () => {
  it('names keys as printed, following the keyboard layout where the browser reads it', () => {
    expect(['KeyW', 'Space', 'ShiftLeft', 'Digit3', 'ArrowUp', 'Backquote', 'Numpad4', 'F5', ''].map(code => keyName(code)))
      .toEqual(['W', 'Space', 'Left Shift', '3', 'Up arrow', '`', 'Num 4', 'F5', '']);
    const azerty = new Map([['KeyW', 'z'], ['KeyQ', 'a'], ['Semicolon', 'm']]);
    expect(keyName('KeyW', azerty)).toBe('Z');
    expect(keyName('Semicolon', azerty)).toBe('M');
    expect(keyName('Space', azerty)).toBe('Space');
  });
});
