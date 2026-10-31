import type { Hex } from './colour';
import { DYES, LENS_TINTS, METALS, NATURAL_HAIR, PETALS, SKIN_TONES, STRAW, WILD_HAIR } from './palette';
import type {
  BeardStyleId, CitizenLook, EarringStyleId, EyeShape, EyeSpacing, Freckles, GlassesStyleId, HairStyleId, HatStyleId, MoustacheStyleId,
} from './recipe';

/*
 * Twenty SIMULATED citizens for the portrait sheet, laid out 4 × 5 like the reference: eighteen hair styles,
 * every hat and every pair of glasses, beards, moustaches, earrings and a flower, every eye shape and spacing,
 * freckles and blush, and skin from the lightest swatch to the deepest. Not real people; the bench labels
 * them SIMULATED.
 */
type Named<T extends readonly { id: string; hex: Hex }[]> = T[number]['id'];
const skin = (id: Named<typeof SKIN_TONES>) => SKIN_TONES.find(s => s.id === id)!.hex;
const hair = (id: Named<typeof NATURAL_HAIR> | Named<typeof WILD_HAIR>) => [...NATURAL_HAIR, ...WILD_HAIR].find(s => s.id === id)!.hex;
const dye = (id: Named<typeof DYES>) => DYES.find(s => s.id === id)!.hex;
const metal = (id: Named<typeof METALS>) => METALS.find(s => s.id === id)!.hex;
const lens = (id: Named<typeof LENS_TINTS>) => LENS_TINTS.find(s => s.id === id)!.hex;
const straw = (id: Named<typeof STRAW>) => STRAW.find(s => s.id === id)!.hex;
const petal = (id: Named<typeof PETALS>) => PETALS.find(s => s.id === id)!.hex;

interface Spec {
  readonly name: string;
  readonly skin: Hex;
  readonly hair: readonly [HairStyleId, Hex];
  readonly beard?: readonly [BeardStyleId, Hex];
  readonly moustache?: readonly [MoustacheStyleId, Hex];
  readonly hat?: readonly [HatStyleId, Hex, Hex];
  readonly glasses?: readonly [GlassesStyleId, Hex, Hex];
  readonly earrings?: readonly [EarringStyleId, Hex];
  readonly flower?: Hex;
  readonly top: Hex;
  readonly eyes?: readonly [EyeShape, EyeSpacing];
  readonly freckles?: Freckles;
  readonly blush?: boolean;
}

const look = (s: Spec): { readonly name: string; readonly look: CitizenLook } => ({
  name: s.name,
  look: {
    version: 1, skin: s.skin,
    eyes: { shape: s.eyes?.[0] ?? 'dot', spacing: s.eyes?.[1] ?? 'set' },
    freckles: s.freckles ?? 'none', blush: s.blush ?? false,
    hair: { style: s.hair[0], colour: s.hair[1] },
    beard: s.beard ? { style: s.beard[0], colour: s.beard[1] } : null,
    moustache: s.moustache ? { style: s.moustache[0], colour: s.moustache[1] } : null,
    hat: s.hat ? { style: s.hat[0], colour: s.hat[1], trim: s.hat[2] } : null,
    glasses: s.glasses ? { style: s.glasses[0], colour: s.glasses[1], lens: s.glasses[2] } : null,
    earrings: s.earrings ? { style: s.earrings[0], colour: s.earrings[1] } : null,
    flower: s.flower ? { colour: s.flower } : null,
    top: { style: 'tee', dye: s.top },
  },
});

const gold = metal('gold');

/** Laid out like the reference, cell for cell where our parts allow: the same kinds of people, our own parts. */
export const PORTRAIT_FIXTURES: readonly { readonly name: string; readonly look: CitizenLook }[] = [
  look({ name: 'Simulated Ashby', skin: skin('apricot'), hair: ['short-crop', hair('ash')], beard: ['full', hair('soft-black')], top: dye('tomato') }),
  look({ name: 'Simulated Maren', skin: skin('peach'), hair: ['curls', hair('copper')], top: dye('white'), freckles: 'light' }),
  look({ name: 'Simulated Teo', skin: skin('caramel'), hair: ['quiff', hair('black')], hat: ['beanie', dye('navy'), dye('mustard')], top: dye('sky') }),
  look({ name: 'Simulated Lise', skin: skin('shell'), hair: ['pigtails', hair('blond')], earrings: ['stud', gold], top: dye('cobalt'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Jun', skin: skin('cream'), hair: ['side-part', hair('black')], beard: ['goatee', hair('black')], top: dye('red') }),
  look({ name: 'Simulated Hazel', skin: skin('rose'), hair: ['long-waves', hair('chestnut')], top: dye('charcoal'), blush: true }),
  look({ name: 'Simulated Rory', skin: skin('apricot'), hair: ['short-crop', hair('ginger')], beard: ['chinstrap', hair('ginger')], hat: ['cap', dye('grey'), dye('white')], top: dye('white'), freckles: 'full' }),
  look({ name: 'Simulated Amira', skin: skin('golden'), hair: ['buns', hair('espresso')], top: dye('white'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Pip', skin: skin('peach'), hair: ['slicked', hair('brown')], glasses: ['square', metal('black'), lens('rose')], top: dye('purple'), freckles: 'light' }),
  look({ name: 'Simulated Elder Bram', skin: skin('porcelain'), hair: ['short-crop', hair('blond')], beard: ['full', hair('white')], top: dye('yellow') }),
  look({ name: 'Simulated Nico', skin: skin('shell'), hair: ['side-shave', hair('espresso')], moustache: ['handlebar', hair('espresso')], hat: ['cap-backwards', dye('white'), dye('white')], top: dye('sky') }),
  look({ name: 'Simulated Inés', skin: skin('tawny'), hair: ['locs', hair('espresso')], top: dye('black') }),
  look({ name: 'Simulated Kit', skin: skin('sand'), hair: ['short-crop', hair('black')], hat: ['straw-hat', straw('wheat'), dye('red')], top: dye('red'), blush: true }),
  look({ name: 'Simulated Kofi', skin: skin('ebony'), hair: ['afro', hair('black')], top: dye('mustard') }),
  look({ name: 'Simulated Sora', skin: skin('cream'), hair: ['bob', hair('soft-black')], hat: ['pointed-hat', dye('cobalt'), dye('yellow')], top: dye('sky'), eyes: ['closed', 'wide'] }),
  look({ name: 'Simulated Wren', skin: skin('rose'), hair: ['braids', hair('auburn')], glasses: ['round', metal('tortoise'), lens('amber')], top: dye('orange'), blush: true, freckles: 'light' }),
  look({ name: 'Simulated Old Tam', skin: skin('shell'), hair: ['bald', hair('grey')], beard: ['stubble', hair('grey')], glasses: ['round', metal('silver'), lens('clear')], top: dye('tomato'), eyes: ['dot', 'wide'] }),
  look({ name: 'Simulated Vix', skin: skin('peach'), hair: ['wild-tuft', hair('violet')], top: dye('white'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Zuri', skin: skin('midnight'), hair: ['spiky', hair('ice')], glasses: ['goggles', metal('gunmetal'), lens('smoke')], top: dye('leaf'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Dara', skin: skin('honey'), hair: ['top-knot', hair('brown')], earrings: ['drop', gold], flower: petal('poppy'), top: dye('forest'), blush: true }),
];
