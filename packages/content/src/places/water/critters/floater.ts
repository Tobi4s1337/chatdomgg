import { MAT } from '../../../materials';
import { assemble, Sculpt, type Critter, type CritterVariant } from './rig';

/** Paper colour per variant. */
const PAPER = [MAT.cream, MAT.petal, MAT.fabricMutedGold] as const;

/**
 * A lantern float a citizen sets on the water: five planks with two gaps over three bark battens, plank ends left
 * ragged, and a small square paper lantern framed in timber at its foot and shoulders under a brass cap. Seven
 * cells square; the battens ride under the waterline (y = 1) and the deck sits on it.
 */
export function createFloater(variant: CritterVariant): Critter {
  const s = new Sculpt(7, 6, 7);
  for (const z of [1, 3, 5]) s.box(0, 0, z, 7, 1, z + 1, MAT.bark);
  const planks: readonly (readonly [x: number, z0: number, z1: number, material: number])[] = [
    [0, 1, 6, MAT.timber], [2, 0, 6, MAT.earth], [3, 0, 7, MAT.timber], [4, 1, 7, MAT.earth], [6, 1, 6, MAT.timber],
  ];
  for (const [x, z0, z1, m] of planks) s.box(x, 1, z0, x + 1, 2, z1, m);
  // Weathered board ends.
  s.set(3, 1, 0, MAT.bark).set(0, 1, 5, MAT.bark);
  const paper = PAPER[variant];
  const ring: readonly (readonly [number, number])[] = [[2, 2], [3, 2], [4, 2], [2, 3], [4, 3], [2, 4], [3, 4], [4, 4]];
  for (const [x, z] of ring) {
    const corner = x !== 3 && z !== 3;
    s.set(x, 2, z, corner ? MAT.timber : paper).set(x, 3, z, paper);
    s.set(x, 4, z, corner ? MAT.timber : MAT.brass);
  }
  s.set(3, 4, 3, MAT.brass).set(3, 5, 3, MAT.brass);
  return assemble('floater', variant, s, [3.5, 1, 3.5], [], [3.5, 3, 3.5]);
}
