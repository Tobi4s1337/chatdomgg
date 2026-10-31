import type { KeeperAct } from '../../types';
import { nudge, pose, type Rotations } from '../pose';

/**
 * The ferryman's work at the landing. A `mooring` fixture is a post (`KEEPER_PROP_ANCHORS.mooring`, its top 1 m up); a
 * `water-edge` fixture is the lip of the landing on its ground, its front (+Z) toward the land and the water beyond −Z,
 * at least 0.3 m below the lip. Arm rotations were solved so the hook, the butt or the line's end lands on its target for
 * all three temperament bodies with their stances; the routine tests hold every act to its `reach`.
 */

/** Leaning out over the edge, the boathook reaching down into the water in the right hand, the left braced on the hip. */
const SOUNDING: Rotations = {
  chest: [12, 0, 0],
  upperArmRight: [11, 22, 32], forearmRight: [-23, -40, -13],
  upperArmLeft: [-4, 0, -30], forearmLeft: [-10, 0, 72],
};
/** The boathook planted on the planks at the right foot, the right hand high on it; the left thumb in the belt. */
const WATCHING: Rotations = {
  upperArmRight: [-83, -34, 2], forearmRight: [33, 42, 21],
  upperArmLeft: [-4, 0, -30], forearmLeft: [-10, 0, 72],
};
/** The coil held low in the left hand, the right laying the line's end over the post top. */
const MAKING_FAST: Rotations = {
  chest: [8, 0, 0],
  upperArmLeft: [-20, 10, -8], forearmLeft: [-40, 0, 0],
  upperArmRight: [-3, -11, -28], forearmRight: [-91, 40, -41],
};

export const FERRYMAN_ACTS: readonly KeeperAct[] = [
  {
    id: 'make-fast', label: 'Takes a turn of the mooring line round the post', at: 'mooring',
    stand: [0, 0.6], face: 'toward', cycle: 4.2, repeats: 4, tool: 'line', hours: [6, 21],
    reach: { key: 1, toolPoint: 'end', target: [0, 1.02, 0.1], tolerance: 0.12 },
    keys: [
      { t: 0, pose: pose('fast-pay', 'Pays out a loop from the coil', nudge(MAKING_FAST, { upperArmRight: [-27, 11, 28], forearmRight: [31, -40, 41], head: [14, 0, 0] })) },
      { t: 0.35, pose: pose('fast-lay', 'Lays the line over the post', nudge(MAKING_FAST, { head: [22, 0, 0] })) },
      { t: 0.65, pose: pose('fast-turn', 'Takes the turn round', nudge(MAKING_FAST, { upperArmRight: [0, 12, 0], forearmRight: [-6, 0, 0], head: [22, 8, 0] })) },
      { t: 0.85, pose: pose('fast-check', 'Tugs it firm', nudge(MAKING_FAST, { upperArmRight: [6, 0, 4], chest: [-3, 0, 0], head: [18, 0, 0] })) },
    ],
  },
  {
    id: 'sound-the-water', label: 'Reaches the boathook down into the water off the edge', at: 'water-edge',
    stand: [0.1, 0.45], face: 'toward', cycle: 5.5, repeats: 3, tool: 'boathook', hours: [7, 19],
    reach: { key: 1, toolPoint: 'hook', target: [0, -0.3, -0.6], tolerance: 0.12 },
    keys: [
      { t: 0, pose: pose('sound-lift', 'Lifts the hook clear', nudge(SOUNDING, { upperArmRight: [-16, 0, 0], chest: [-6, 0, 0], head: [12, 0, 0] })) },
      { t: 0.35, pose: pose('sound-reach', 'Hook down in the water', nudge(SOUNDING, { head: [20, 0, 0] })) },
      { t: 0.65, pose: pose('sound-draw', 'Draws it through', nudge(SOUNDING, { upperArmRight: [-5, 6, 0], head: [18, 6, 0] })) },
    ],
  },
  {
    id: 'watch-the-water', label: 'Leans on the planted boathook, watching the water', at: 'water-edge',
    stand: [0, 0.55], face: 'toward', cycle: 10, repeats: 2, tool: 'boathook', hours: [17, 7],
    reach: { key: 0, toolPoint: 'butt', target: [-0.32, 0, 0.62], tolerance: 0.06 },
    keys: [
      { t: 0, pose: pose('watch-out', 'Looks out over the water', nudge(WATCHING, { head: [-4, -10, 0] })) },
      { t: 0.5, pose: pose('watch-along', 'Looks along the bank', nudge(WATCHING, { head: [0, 24, 0] })) },
      { t: 0.8, pose: pose('watch-back', 'Looks back to the water', nudge(WATCHING, { head: [-6, -2, 2] })) },
    ],
  },
];
