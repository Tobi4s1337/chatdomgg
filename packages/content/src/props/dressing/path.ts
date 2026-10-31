import type { StyleKey } from '../../materials';
import { STYLES } from '../../materials';
import { plan, toBoxes, type Cover } from './cover';

/**
 * Three flat stones a stride apart, cut two courses deep in the kit's stone and bedded almost to their tops, so they
 * sit flush with the turf even where a bank or a grade step runs under them. Each is rounded and a little different:
 * a broad square-shouldered one, a narrower oval and a long one turned off the line. Feet have worn the turf to earth
 * where they land between the stones, and moss holds a few of the joints.
 */
const STONES = [
  '........................',
  '...OOOO....OOOO.........',
  '..OOOOOO.MOOOOOO..OOO...',
  '..OOOOOOE.OOOOOOEOOOOOM.',
  '..OOOOOOEEOOOOOOEOOOOOO.',
  '..OOOOOE...OOOOMEOOOOOO.',
  '...OOO.M..........OOOO..',
  '........................',
];

export function steppingStones(kit: (typeof STYLES)[StyleKey]): Cover {
  const size: [number, number, number] = [24, 2, 8];
  return { size, boxes: toBoxes(plan(STONES, size, undefined, kit.stone), size) };
}
