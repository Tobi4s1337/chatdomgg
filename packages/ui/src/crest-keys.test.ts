import { describe, expect, it } from 'vitest';
import { crestStep, crestTabStop, isCrestKey } from './crest-keys';
import { allowance } from './allowance';

const all = [true, true, true];

describe('crest rail keys', () => {
  it('arrows walk the rail both ways and wrap at its ends', () => {
    expect(crestStep('ArrowRight', 0, all)).toBe(1);
    expect(crestStep('ArrowDown', 2, all)).toBe(0);
    expect(crestStep('ArrowLeft', 0, all)).toBe(2);
    expect(crestStep('ArrowUp', 1, all)).toBe(0);
  });

  it('Home and End jump to the first and last crest that can be chosen', () => {
    expect(crestStep('Home', 2, all)).toBe(0);
    expect(crestStep('End', 0, all)).toBe(2);
    expect(crestStep('Home', 2, [false, true, true])).toBe(1);
    expect(crestStep('End', 0, [true, true, false])).toBe(1);
  });

  it('a resting crest is stepped over, and a rail with nowhere to go keeps focus where it is', () => {
    expect(crestStep('ArrowRight', 0, [true, false, true])).toBe(2);
    expect(crestStep('ArrowLeft', 2, [true, false, true])).toBe(0);
    expect(crestStep('ArrowRight', 1, [false, true, false])).toBe(1);
    expect(crestStep('End', 1, [false, false, false])).toBe(1);
    expect(crestStep('ArrowRight', 0, [])).toBe(0);
  });

  it('only walking keys are claimed; Tab, Space and Enter stay with the browser', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) expect(isCrestKey(key)).toBe(true);
    for (const key of ['Tab', ' ', 'Enter', 'Escape', 'a', 'PageDown']) expect(isCrestKey(key)).toBe(false);
  });

  it('the single tab stop is the chosen crest, else the first open one', () => {
    expect(crestTabStop(1, all)).toBe(1);
    expect(crestTabStop(-1, all)).toBe(0);
    expect(crestTabStop(0, [false, true, true])).toBe(1);
    expect(crestTabStop(2, [false, false, false])).toBe(2);
  });
});

describe('parchment allowance', () => {
  it('counts what is left the way maxlength does and warns only near the end', () => {
    expect(allowance('', 240)).toMatchObject({ used: 0, left: 240, words: '240 letters left', near: false });
    expect(allowance('x'.repeat(219), 240)).toMatchObject({ left: 21, near: false });
    expect(allowance('x'.repeat(220), 240)).toMatchObject({ left: 20, near: true });
    expect(allowance('x'.repeat(239), 240).words).toBe('1 letter left');
    expect(allowance('x'.repeat(260), 240)).toMatchObject({ left: 0, words: 'No room left', near: true });
  });
});
