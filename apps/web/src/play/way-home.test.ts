import { describe, expect, it } from 'vitest';
import type { RealmFoundedScene } from '@chatdom/world';
import { wayHomeFrom } from './way-home';

const plan = {
  homes: [{ id: 'plot-7', street: 'Lantern Row', approachId: 'approach-7', position: [10, 0, 20] }, { id: 'plot-9', street: ' ', approachId: 'gone', position: [-4, 0, 0] }],
  nodes: [{ id: 'approach-7', kind: 'approach', position: [10, 0, 18] }],
} as unknown as RealmFoundedScene['plan'];

describe('the way home', () => {
  it('measures to the approach in front of your own door and says which way to turn', () => {
    const ahead = wayHomeFrom({ plan }, 'plot-7', [10, 0, 0], [0, 1], false)!;
    expect(ahead).toEqual({ street: 'Lantern Row', metres: 18, relative: 0, inside: false });
    // Looking along +Z, the right hand is -X: a door at +X is to the left.
    const left = wayHomeFrom({ plan }, 'plot-7', [0, 0, 18], [0, 1], false)!;
    expect(left.relative).toBeCloseTo(-Math.PI / 2, 9);
    const behind = wayHomeFrom({ plan }, 'plot-7', [10, 0, 30], [0, 1], false)!;
    expect(Math.abs(behind.relative)).toBeCloseTo(Math.PI, 9);
  });

  it('is honest about a home with no named street, and about having no home here', () => {
    expect(wayHomeFrom({ plan }, 'plot-9', [0, 0, 0], [1, 0], true)).toMatchObject({ street: null, metres: 4, inside: true });
    expect(wayHomeFrom({ plan }, null, [0, 0, 0], [0, 1], false)).toBeNull();
    expect(wayHomeFrom({ plan }, 'plot-404', [0, 0, 0], [0, 1], false)).toBeNull();
  });
});
