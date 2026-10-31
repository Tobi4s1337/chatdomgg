import { MAT } from '../../../materials';
import { assemble, loft, mix, Sculpt, type Critter, type CritterVariant, type Section } from './rig';

/**
 * Mallard hull, shared by drake and hen so the pair animates on one rig. Five cells wide about x = 2.5, tail tip
 * at z = 0, breast at z = 7. The waterline is y = 2: two of the five hull rows ride under it. The rear rises in a
 * wedge to the tail tip and the breast stands proud of the flank.
 */
const DUCK_HULL: readonly Section[] = [
  { z: 0, y0: 5, y1: 5, half: 0.5 },
  { z: 1, y0: 3, y1: 5, half: 1.5 },
  { z: 2, y0: 1, y1: 4, half: 2.5 },
  { z: 3, y0: 0, y1: 4, half: 2.5 },
  { z: 4, y0: 0, y1: 4, half: 2.5 },
  { z: 5, y0: 0, y1: 4, half: 2.5 },
  { z: 6, y0: 0, y1: 4, half: 2.5 },
  { z: 7, y0: 1, y1: 4, half: 1.5 },
];
const DUCK_WATERLINE = 2;
/** Neck base: on the hull's top face over the breast. */
const DUCK_NECK = [2.5, 5, 6] as const;
const DUCK_ROOT = [2.5, DUCK_WATERLINE, 4] as const;
/** Head block marker for the bill, repainted per bird. */
const BILL = 2;

/**
 * Head block: a neck course, a rounded 3x3x3 head and a broad bill on its lower face. The pivot is the neck base
 * centre; the host pitches it to dabble and yaws it to look round.
 */
function duckHead(): Sculpt {
  const s = new Sculpt(3, 4, 5);
  s.box(0, 0, 0, 3, 1, 2, 1);
  s.box(0, 1, 0, 3, 4, 3, 1);
  for (const x of [0, 2]) for (const y of [1, 3]) for (const z of [0, 2]) s.set(x, y, z, MAT.air);
  s.box(0, 1, 3, 3, 2, 4, BILL).set(1, 1, 4, BILL);
  return s;
}

const duckHull = () => loft(new Sculpt(5, 6, 8), 2.5, DUCK_HULL, 1);
const isEye = (x: number, y: number, z: number) => y === 2 && z === 2 && (x === 0 || x === 2);

export function createDrake(variant: CritterVariant): Critter {
  const crown = variant === 1 ? MAT.fabricMutedGreen : MAT.fabricGreen;
  const jowl = variant === 2 ? MAT.fabricGreen : MAT.fabricMutedGreen;
  const ring = variant === 2 ? MAT.hairSilver : MAT.cream;
  const breast = variant === 1 ? MAT.hairChestnut : MAT.hairBrown;
  // The drake's curl sits on the rump, just ahead of the white tail tip.
  const body = duckHull().set(2, 5, 2, MAT.hairBlack);
  body.paint((x, y, z) => {
    const side = x === 0 || x === 4;
    if (z === 0) return MAT.hairSilver;
    if (z === 1 || (z === 2 && y === 5)) return MAT.hairBlack;
    if (y < DUCK_WATERLINE - 1) return MAT.stone;
    if (z === 7 || (z === 6 && (!side || y >= 3))) {
      if (y < DUCK_WATERLINE) return MAT.hairBrown;
      return z === 7 && y === 3 && variant !== 1 ? MAT.hairChestnut : breast;
    }
    if (y === 4) return x === 2 && z <= 4 ? MAT.darkStone : MAT.stone;
    if (y === 3 && side) return z === 2 || (z === 3 && variant === 0) ? MAT.fabricBlue : MAT.stone;
    if (y < DUCK_WATERLINE) return MAT.limestone;
    return mix(x, y, z, 11) < 0.15 ? MAT.limestone : MAT.hairSilver;
  });
  const head = duckHead().paint((x, y, z, m) => {
    if (m === BILL) return MAT.fabricGold;
    if (y === 0) return ring;
    if (isEye(x, y, z)) return MAT.hairBlack;
    return y === 1 ? jowl : crown;
  });
  return assemble('drake', variant, body, DUCK_ROOT, [{ id: 'head', sculpt: head, pivot: [1.5, 0, 1], attach: DUCK_NECK }]);
}

export function createHen(variant: CritterVariant): Critter {
  const seed = 31 + variant * 17;
  /** Mottled browns; `light` is the share of pale chestnut, the rest splits brown and dark bark. */
  const mottle = (x: number, y: number, z: number, light: number) => {
    const r = mix(x, y, z, seed);
    if (r < light) return MAT.hairChestnut;
    return r < light + (1 - light) * 0.6 ? MAT.hairBrown : MAT.bark;
  };
  const body = duckHull().paint((x, y, z) => {
    const side = x === 0 || x === 4;
    if (z === 0) return MAT.limestone;
    if (y < DUCK_WATERLINE - 1) return MAT.hairBrown;
    if (y === 3 && side && (z === 2 || z === 3)) return z === 2 || variant !== 2 ? MAT.fabricBlue : MAT.cream;
    if (y >= 4) return mottle(x, y, z, 0.15);
    if (z >= 6) return mottle(x, y, z, 0.6);
    return mottle(x, y, z, y < DUCK_WATERLINE ? 0.7 : 0.45);
  });
  const bill = variant === 1 ? MAT.fabricMutedOrange : MAT.fabricOrange;
  const head = duckHead().paint((x, y, z, m) => {
    if (m === BILL) return z === 3 && x === 1 && variant === 2 ? MAT.hairBrown : bill;
    if (isEye(x, y, z)) return MAT.hairBlack;
    if (y === 2 && (x === 0 || x === 2)) return MAT.bark;
    if (y === 3) return x === 1 ? MAT.bark : MAT.hairBrown;
    if (y === 0) return MAT.hairChestnut;
    return mix(x, y, z, seed + 5) < 0.5 ? MAT.hairChestnut : MAT.limestone;
  });
  return assemble('hen', variant, body, DUCK_ROOT, [{ id: 'head', sculpt: head, pivot: [1.5, 0, 1], attach: DUCK_NECK }]);
}

/**
 * Grey heron resting hunched: long legs, a teardrop body that slopes to a short drooping tail, shoulders hunched
 * round the folded neck, and a small white head with a black stripe, trailing plume and long dagger bill. Five
 * cells wide about x = 2.5, the legs at x = 1 and 3 with a gap between, feet on y = 0.
 */
const HERON_BODY: readonly Section[] = [
  { z: 0, y0: 7, y1: 8, half: 0.5 },
  { z: 1, y0: 7, y1: 10, half: 1.5 },
  { z: 2, y0: 7, y1: 11, half: 2.5 },
  { z: 3, y0: 7, y1: 12, half: 2.5 },
  { z: 4, y0: 7, y1: 12, half: 2.5 },
  { z: 5, y0: 8, y1: 12, half: 2.5 },
  { z: 6, y0: 8, y1: 12, half: 1.5 },
];

export function createHeron(variant: CritterVariant): Critter {
  const pale = variant === 2 ? MAT.limestone : MAT.hairSilver;
  const body = loft(new Sculpt(5, 13, 7), 2.5, HERON_BODY, MAT.stone);
  body.paint((x, y, z) => {
    const side = x === 0 || x === 4;
    if (z === 0) return MAT.darkStone;
    if (z === 6 || (z === 5 && !side)) return MAT.hairSilver;
    if (y === 7) return MAT.hairSilver;
    if (z <= 2 && y <= 9) return MAT.darkStone;
    if (side && y === 8) return MAT.darkStone;
    if (y === 12 && x === 2 && variant !== 1) return MAT.darkStone;
    return MAT.stone;
  });
  // Plumes hanging from the lower breast.
  body.set(2, 7, 6, pale).set(2, 6, 6, pale);
  for (const x of [1, 3]) {
    for (let y = 1; y < 7; y++) body.set(x, y, 3, y >= 5 ? MAT.bark : MAT.earth);
    body.set(x, 0, 2, MAT.bark).set(x, 0, 3, MAT.earth).set(x, 0, 4, MAT.bark).set(x, 0, 5, MAT.bark);
  }
  const head = new Sculpt(3, 4, 8);
  head.box(0, 0, 1, 3, 4, 4, MAT.hairSilver);
  for (const x of [0, 2]) head.set(x, 0, 1, MAT.air).set(x, 3, 1, MAT.air).set(x, 3, 3, MAT.air).set(x, 0, 3, MAT.air);
  // Stripe from above the eye back into the plume; the eye; a dark streak down the throat.
  for (const x of [0, 2]) head.set(x, 3, 2, MAT.hairBlack).set(x, 2, 3, MAT.hairBlack);
  head.set(1, 3, 0, MAT.hairBlack).set(1, 2, 0, MAT.hairBlack);
  head.set(1, 0, 3, variant === 1 ? MAT.stone : MAT.darkStone);
  for (let z = 4; z < 8; z++) head.set(1, 2, z, MAT.fabricGold);
  head.set(1, 3, 4, MAT.fabricGold);
  return assemble('heron', variant, body, [2.5, 0, 3.5], [{ id: 'head', sculpt: head, pivot: [1.5, 0, 2.5], attach: [2.5, 13, 5.5] }]);
}
