import { MAT } from '../../../materials';
import { assemble, Sculpt, type Critter, type CritterVariant, type Limb } from './rig';

/** Spots per trout variant: dusky on the flank, one black on the wrist, all clear of the eye. */
const TROUT_SPOTS: readonly (readonly (readonly [x: number, y: number, z: number, material: number])[])[] = [
  [[0, 3, 3, MAT.darkStone], [2, 3, 3, MAT.darkStone], [1, 3, 2, MAT.hairBlack]],
  [[0, 3, 4, MAT.darkStone], [2, 3, 3, MAT.darkStone]],
  [[0, 3, 3, MAT.darkStone], [2, 3, 3, MAT.darkStone], [0, 2, 4, MAT.stone], [2, 2, 4, MAT.stone], [1, 3, 2, MAT.hairBlack]],
];

/**
 * Trout, side-on first: forked tail, a pinched wrist, a deep body, a blunt head whose chin lifts off the belly
 * line, and one dorsal fin. Three cells wide about x = 1.5: belly fins on y = 0, the body on y = 1..4.
 * Variant 1 carries a rainbow trout's pink flank stripe; variant 2 is slate-backed.
 */
export function createTrout(variant: CritterVariant): Critter {
  const back = variant === 2 ? MAT.slate : MAT.fabricMutedGreen;
  const fin = variant === 2 ? MAT.darkStone : MAT.fabricMutedGreen;
  const s = new Sculpt(3, 6, 7);
  s.set(1, 1, 0, fin).set(1, 4, 0, fin);
  s.box(1, 1, 1, 2, 5, 2, fin);
  s.set(1, 2, 2, MAT.hairSilver).set(1, 3, 2, back);
  for (let z = 3; z <= 5; z++) {
    s.box(0, 2, z, 3, 4, z + 1, MAT.hairSilver);
    s.set(1, 4, z, back);
    if (z < 5) s.set(1, 1, z, MAT.cream);
  }
  s.set(1, 2, 6, MAT.hairSilver).set(1, 3, 6, back);
  s.set(1, 5, 3, fin).set(1, 0, 3, fin).set(0, 1, 5, fin).set(2, 1, 5, fin);
  for (const x of [0, 2]) {
    s.set(x, 3, 5, MAT.hairBlack);
    if (variant === 1) s.set(x, 2, 3, MAT.petal).set(x, 2, 4, MAT.petal).set(x, 2, 5, MAT.petal);
  }
  for (const [x, y, z, m] of TROUT_SPOTS[variant]!) s.set(x, y, z, m);
  return assemble('trout', variant, s, [1.5, 3, 4], []);
}

/**
 * Kingfisher in flight: a stubby tail, a round body with an orange breast, a big blue-capped head with the eye,
 * an orange cheek, a white throat and a dark dagger bill. Three cells wide about x = 1.5. Each wing is a flat
 * part hinged at the shoulder on the body's upper side; the host flaps it about the local Z axis.
 */
export function createKingfisher(variant: CritterVariant): Critter {
  const blue = MAT.fabricBlue;
  const tip = variant === 1 ? MAT.fabricMutedBlue : MAT.slate;
  const breast = variant === 2 ? MAT.hairChestnut : MAT.fabricOrange;
  const body = new Sculpt(3, 4, 5);
  body.set(1, 1, 0, tip).set(1, 2, 0, blue);
  for (const z of [1, 2]) body.box(0, 1, z, 3, 2, z + 1, breast).box(0, 2, z, 3, 3, z + 1, blue).set(1, 0, z, breast);
  // A darker saddle between the shoulders, except on the muted variant.
  if (variant !== 1) body.set(1, 2, 1, MAT.fabricMutedBlue);
  body.set(0, 3, 2, blue).set(1, 3, 2, blue).set(2, 3, 2, blue);
  body.set(0, 2, 2, MAT.hairBlack).set(2, 2, 2, MAT.hairBlack);
  body.box(0, 1, 3, 3, 2, 4, MAT.cream).set(0, 2, 3, breast).set(1, 2, 3, blue).set(2, 2, 3, breast).set(1, 3, 3, blue);
  body.set(1, 2, 4, MAT.hairBlack);
  const wing = (left: boolean): Limb => {
    const s = new Sculpt(3, 1, 2);
    // Two blue columns at the shoulder, a darker tip trailing at the outer rear corner.
    const inner = left ? 0 : 1;
    s.box(inner, 0, 0, inner + 2, 1, 2, blue).set(left ? 2 : 0, 0, 0, tip);
    if (variant === 2) s.set(1, 0, 0, tip);
    return left
      ? { id: 'wing-left', sculpt: s, pivot: [0, 0.5, 1], attach: [3, 2.5, 1] }
      : { id: 'wing-right', sculpt: s, pivot: [3, 0.5, 1], attach: [0, 2.5, 1] };
  };
  return assemble('kingfisher', variant, body, [1.5, 2, 2], [wing(true), wing(false)]);
}

/**
 * Dragonfly hovering: a one-cell abdomen in darker segments, a thorax, big eyes either side of the head, and two
 * pairs of glass wings in one flat layer over the thorax, the hind pair swept back. Seven cells wide about x = 3.5.
 */
export function createDragonfly(variant: CritterVariant): Critter {
  const light = variant === 1 ? MAT.fabricMutedBlue : MAT.fabricBlue;
  const dark = variant === 1 ? MAT.hairBlack : variant === 2 ? MAT.fabricMutedBlue : MAT.slate;
  const eye = variant === 1 ? MAT.fabricMutedGreen : MAT.fabricGreen;
  const s = new Sculpt(7, 2, 5);
  s.set(3, 0, 0, dark).set(3, 0, 1, light).set(3, 0, 2, dark);
  s.set(3, 0, 3, variant === 2 ? MAT.slate : dark).set(3, 1, 3, light);
  s.set(3, 0, 4, dark).set(2, 0, 4, eye).set(4, 0, 4, eye).set(2, 1, 4, eye).set(4, 1, 4, eye);
  for (const [x, z] of [[0, 3], [1, 3], [2, 3], [1, 2], [2, 2], [0, 1], [1, 1]] as const) {
    s.set(x, 1, z, MAT.glass).set(6 - x, 1, z, MAT.glass);
  }
  return assemble('dragonfly', variant, s, [3.5, 1, 3], []);
}
