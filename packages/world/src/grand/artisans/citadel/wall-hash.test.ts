import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTownWalls } from './index';

it('preserves the complete ordered wall geometry and anchors for all four proof seeds', () => {
  const baseline: Record<string, string> = {
    tobi4s_: '8ad13a70960be930f19cba9482a17ae6d7d2f8c1f9b01c5f1a4d5957c22135c7',
    the_aggman: '8ad13a70960be930f19cba9482a17ae6d7d2f8c1f9b01c5f1a4d5957c22135c7',
    pinkkittyrose: '8ad13a70960be930f19cba9482a17ae6d7d2f8c1f9b01c5f1a4d5957c22135c7',
    mashad4: 'd0d015b48cee2e9e5327dc3628fac094f483f306f161c5d3e82291403ac2df71',
  };
  for (const [seed, expected] of Object.entries(baseline)) {
    const wall = createTownWalls(seed);
    expect(createHash('sha256').update(JSON.stringify({ boxes: wall.boxes, anchors: wall.anchors })).digest('hex')).toBe(expected);
  }
});
