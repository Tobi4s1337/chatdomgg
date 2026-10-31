import type { KeeperAct } from '../../types';
import { nudge, pose, type Rotations } from '../pose';

/**
 * The lamplighter's work at a lamp post (`KEEPER_PROP_ANCHORS.lamp`: the post at the origin, the lantern on its front,
 * its glass 2.38–2.75 m up and its door 0.625 m out). Arm rotations were solved so the pole's hook or rag lands on the
 * lantern for all three temperament bodies with their stances laid under; the routine tests hold every act to its
 * `reach`. The pole never carries a flame: whether a lamp burns is the kingdom's presence, not the keeper's.
 */

/** Both hands up the pole, the right high, the hook at the lantern door. */
const HOOKED: Rotations = {
  upperArmRight: [-79, 11, -35], forearmRight: [-9, -3, -6],
  upperArmLeft: [-68, 16, 22], forearmLeft: [-13, 67, 15],
};
/** The rag end of the pole pressed to the upper pane. */
const BUFFING: Rotations = {
  upperArmRight: [-84, -5, -23], forearmRight: [-13, 16, -20],
  upperArmLeft: [-83, 33, 36], forearmLeft: [10, 45, -7],
};
/** The pole planted at the right foot, the right hand high on it; the left hand on the hip. */
const LEANING: Rotations = {
  upperArmRight: [-38, 2, 1], forearmRight: [-32, 12, 35],
  upperArmLeft: [-4, 0, -30], forearmLeft: [-10, 0, 72],
};

export const LAMPLIGHTER_ACTS: readonly KeeperAct[] = [
  {
    id: 'trim-wick', label: 'Hooks the lantern door open with the pole and trims the wick, looking up', at: 'lamp',
    stand: [0.2, 1.3], face: 'toward', cycle: 5, repeats: 3, tool: 'pole', hours: [16, 23],
    reach: { key: 1, toolPoint: 'hook', target: [0, 2.56, 0.66], tolerance: 0.1 },
    keys: [
      { t: 0, pose: pose('trim-raise', 'Raises the pole', nudge(HOOKED, { upperArmRight: [12, 0, 4], forearmRight: [10, 0, 0], upperArmLeft: [8, 0, 0], head: [-18, 0, 0] })) },
      { t: 0.3, pose: pose('trim-hook', 'Hooks the lantern door', nudge(HOOKED, { head: [-26, 0, 0] })) },
      { t: 0.55, pose: pose('trim-ease', 'Eases the door open', nudge(HOOKED, { upperArmRight: [3, 0, 3], forearmRight: [4, 0, 0], chest: [-2, 0, 0], head: [-27, 3, 0] })) },
      { t: 0.8, pose: pose('trim-watch', 'Watches the wick take', nudge(HOOKED, { upperArmRight: [2, 0, 1], head: [-30, 6, 2] })) },
    ],
  },
  {
    id: 'buff-glass', label: 'Buffs the soot from the lantern glass with the rag on the pole', at: 'lamp',
    stand: [0.2, 1.3], face: 'toward', cycle: 2.4, repeats: 8, tool: 'pole-rag', hours: [6, 16],
    reach: { key: 0, toolPoint: 'rag', target: [0, 2.68, 0.62], tolerance: 0.1 },
    keys: [
      { t: 0, pose: pose('buff-a', 'Rag on the pane', nudge(BUFFING, { head: [-24, 0, 0] })) },
      { t: 0.25, pose: pose('buff-b', 'Rag across', nudge(BUFFING, { upperArmRight: [0, 0, -4], upperArmLeft: [0, 0, -3], head: [-24, -3, 0] })) },
      { t: 0.5, pose: pose('buff-c', 'Rag down', nudge(BUFFING, { upperArmRight: [3, 0, 0], forearmRight: [3, 0, 0], head: [-22, 0, 0] })) },
      { t: 0.75, pose: pose('buff-d', 'Rag back', nudge(BUFFING, { upperArmRight: [0, 0, 4], upperArmLeft: [0, 0, 3], head: [-24, 3, 0] })) },
    ],
  },
  {
    id: 'lean-and-watch', label: 'Leans on the planted pole by the lamp, watching it burn', at: 'lamp',
    stand: [0.25, 1.3], face: 'toward', cycle: 9, repeats: 2, tool: 'pole', hours: [19, 6],
    reach: { key: 0, toolPoint: 'butt', target: [-0.05, 0, 1.15], tolerance: 0.08 },
    keys: [
      { t: 0, pose: pose('lean-up', 'Looks up at the lamp', nudge(LEANING, { head: [-24, 0, 0] })) },
      { t: 0.45, pose: pose('lean-court', 'Glances across the court', nudge(LEANING, { head: [-6, 26, 0] })) },
      { t: 0.75, pose: pose('lean-settle', 'Settles on the pole', nudge(LEANING, { head: [-14, 8, 3] })) },
    ],
  },
];
