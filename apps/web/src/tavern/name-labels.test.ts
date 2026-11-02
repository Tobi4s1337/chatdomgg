import { describe, expect, it } from 'vitest';
import { layoutNames, NAME_GAP, NAME_HEIGHT, type NameCandidate } from './name-labels';

const person = (id: string, x: number, y: number, distance = 5, width = 60): NameCandidate => ({ id, name: id, x, y, distance, width });

describe('tavern name layout', () => {
  it('keeps names anchored and excludes labels clipped by each edge', () => {
    const centre = person('centre', 195, 200);
    const names = layoutNames([centre, person('left', 20, 200), person('right', 380, 200), person('top', 100, NAME_HEIGHT + NAME_GAP), person('bottom', 100, 860)], 390, 844);
    expect(names).toEqual([centre]);
  });
  it('prefers the nearest overlapping walker, with centre and id as stable ties', () => {
    const far = person('far', 190, 200, 8), near = person('near', 200, 200, 3);
    expect(layoutNames([far, near], 390, 844)).toEqual([near]);
    const a = person('a', 195, 200), b = person('b', 195, 200);
    expect(layoutNames([b, a], 390, 844)).toEqual([a]);
    const offCentre = person('off-centre', 180, 200), centred = person('centred', 195, 200);
    expect(layoutNames([offCentre, centred], 390, 844)).toEqual([centred]);
  });
  it('retains separated labels and rejects non-finite coordinates', () => {
    const one = person('one', 90, 100), two = person('two', 200, 100), three = person('three', 90, 150);
    expect(layoutNames([one, two, three, person('invalid', NaN, 100)], 390, 844)).toEqual([two, one, three]);
  });
});
