import type { Hex } from './colour';
import { BOTTOM_CLOTH, DYES, LEATHER, LENS_TINTS, METALS, NATURAL_HAIR, PETALS, SKIN_TONES, STRAW, WILD_HAIR } from './palette';
import {
  defaultAccent,
  type BeardStyleId, type BottomStyleId, type CitizenLook, type EarringStyleId, type EyeShape, type EyeSpacing, type Freckles, type GlassesStyleId,
  type HairStyleId, type HatStyleId, type MoustacheStyleId, type NeckwearStyleId, type OuterStyleId, type PatternId, type ShoeStyleId, type TopStyleId,
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
const cloth = (id: Named<typeof BOTTOM_CLOTH>) => BOTTOM_CLOTH.find(s => s.id === id)!.hex;
const leather = (id: Named<typeof LEATHER>) => LEATHER.find(s => s.id === id)!.hex;

/** A garment as [style, dye, pattern, accent]; the pattern defaults to plain. */
type Wear<S extends string> = readonly [S, Hex, PatternId?, Hex?];
const wear = <S extends string>([style, dye, pattern, accent]: Wear<S>) => ({ style, dye, pattern: pattern ?? 'plain', accent: accent ?? defaultAccent(dye) });

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
  readonly top: Wear<TopStyleId>;
  readonly outer?: Wear<OuterStyleId>;
  readonly bottom: Wear<BottomStyleId>;
  readonly neckwear?: readonly [NeckwearStyleId, Hex, Hex];
  readonly shoes: readonly [ShoeStyleId, Hex];
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
    top: wear(s.top),
    outer: s.outer ? wear(s.outer) : null,
    bottom: wear(s.bottom),
    neckwear: s.neckwear ? { style: s.neckwear[0], dye: s.neckwear[1], accent: s.neckwear[2] } : null,
    shoes: { style: s.shoes[0], dye: s.shoes[1] },
  },
});

const gold = metal('gold');

/** Laid out like the reference, cell for cell where our parts allow: the same kinds of people, our own parts. */
export const PORTRAIT_FIXTURES: readonly { readonly name: string; readonly look: CitizenLook }[] = [
  look({ name: 'Simulated Ashby', skin: skin('apricot'), hair: ['short-crop', hair('ash')], beard: ['full', hair('soft-black')], top: ['tee', dye('white')], outer: ['jacket', dye('tomato')], neckwear: ['tie', dye('black'), dye('black')], bottom: ['trousers', cloth('stonewash')], shoes: ['boots', leather('brown')] }),
  look({ name: 'Simulated Maren', skin: skin('peach'), hair: ['curls', hair('copper')], top: ['tee', dye('white')], outer: ['vest', dye('orange')], bottom: ['skirt', cloth('slate')], shoes: ['shoes', leather('tan')], freckles: 'light' }),
  look({ name: 'Simulated Teo', skin: skin('caramel'), hair: ['quiff', hair('black')], hat: ['beanie', dye('navy'), dye('mustard')], top: ['tee', dye('navy')], outer: ['overshirt', dye('sky')], bottom: ['trousers', cloth('raw-denim')], shoes: ['sneakers', dye('white')] }),
  look({ name: 'Simulated Lise', skin: skin('shell'), hair: ['pigtails', hair('blond')], earrings: ['stud', gold], top: ['tee', dye('white')], bottom: ['overalls', dye('cobalt')], shoes: ['sneakers', dye('red')], eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Jun', skin: skin('cream'), hair: ['side-part', hair('black')], beard: ['goatee', hair('black')], top: ['shirt', dye('red'), 'plaid', dye('black')], bottom: ['trousers', dye('black')], shoes: ['boots', leather('black')] }),
  look({ name: 'Simulated Hazel', skin: skin('rose'), hair: ['long-waves', hair('chestnut')], top: ['tee', dye('white')], outer: ['jacket', dye('grey')], neckwear: ['scarf', dye('red'), dye('yellow')], bottom: ['skirt', dye('charcoal')], shoes: ['shoes', leather('oxblood')], blush: true }),
  look({ name: 'Simulated Rory', skin: skin('apricot'), hair: ['short-crop', hair('ginger')], beard: ['chinstrap', hair('ginger')], hat: ['cap', dye('grey'), dye('white')], top: ['tee', dye('white')], bottom: ['trousers', cloth('cord')], shoes: ['boots', leather('tan')], freckles: 'full' }),
  look({ name: 'Simulated Amira', skin: skin('golden'), hair: ['buns', hair('espresso')], top: ['tee', dye('white')], bottom: ['skirt', dye('teal')], shoes: ['shoes', leather('brown')], eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Pip', skin: skin('peach'), hair: ['slicked', hair('brown')], glasses: ['square', metal('black'), lens('rose')], top: ['tee', dye('purple')], bottom: ['shorts', dye('black')], shoes: ['sneakers', dye('white')], freckles: 'light' }),
  look({ name: 'Simulated Elder Bram', skin: skin('porcelain'), hair: ['short-crop', hair('blond')], beard: ['full', hair('white')], top: ['tee', dye('sky')], outer: ['jacket', dye('yellow')], bottom: ['trousers', cloth('indigo')], shoes: ['shoes', leather('brown')] }),
  look({ name: 'Simulated Nico', skin: skin('shell'), hair: ['side-shave', hair('espresso')], moustache: ['handlebar', hair('espresso')], hat: ['cap-backwards', dye('white'), dye('white')], top: ['tee', dye('sky'), 'print', dye('red')], bottom: ['trousers', dye('black')], shoes: ['sneakers', dye('red')] }),
  look({ name: 'Simulated Inés', skin: skin('tawny'), hair: ['locs', hair('espresso')], top: ['sweater', dye('black')], bottom: ['trousers', cloth('slate')], shoes: ['boots', leather('black')] }),
  look({ name: 'Simulated Kit', skin: skin('sand'), hair: ['short-crop', hair('black')], hat: ['straw-hat', straw('wheat'), dye('red')], top: ['tee', dye('white'), 'stripes', dye('navy')], outer: ['vest', dye('red')], bottom: ['shorts', cloth('indigo')], shoes: ['sneakers', dye('yellow')], blush: true }),
  look({ name: 'Simulated Kofi', skin: skin('ebony'), hair: ['afro', hair('black')], top: ['tee', dye('mustard')], bottom: ['trousers', dye('navy')], shoes: ['sneakers', dye('white')] }),
  look({ name: 'Simulated Sora', skin: skin('cream'), hair: ['bob', hair('soft-black')], hat: ['pointed-hat', dye('cobalt'), dye('yellow')], top: ['tee', dye('sky')], bottom: ['trousers', dye('black')], shoes: ['shoes', leather('black')], eyes: ['closed', 'wide'] }),
  look({ name: 'Simulated Wren', skin: skin('rose'), hair: ['braids', hair('auburn')], glasses: ['round', metal('tortoise'), lens('amber')], top: ['tee', dye('orange')], bottom: ['skirt', dye('red'), 'plaid', dye('navy')], shoes: ['boots', leather('brown')], blush: true, freckles: 'light' }),
  look({ name: 'Simulated Old Tam', skin: skin('shell'), hair: ['bald', hair('grey')], beard: ['stubble', hair('grey')], glasses: ['round', metal('silver'), lens('clear')], top: ['tee', dye('grey')], outer: ['jacket', dye('tomato')], bottom: ['trousers', cloth('khaki')], shoes: ['shoes', leather('tan')], eyes: ['dot', 'wide'] }),
  look({ name: 'Simulated Vix', skin: skin('peach'), hair: ['wild-tuft', hair('violet')], top: ['tank', dye('white')], bottom: ['trousers', dye('grey')], shoes: ['sneakers', dye('purple')], eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Zuri', skin: skin('midnight'), hair: ['spiky', hair('ice')], glasses: ['goggles', metal('gunmetal'), lens('smoke')], top: ['tee', dye('yellow')], outer: ['overshirt', dye('red'), 'dots', dye('leaf')], bottom: ['shorts', cloth('khaki')], shoes: ['sneakers', dye('white')], eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Dara', skin: skin('honey'), hair: ['top-knot', hair('brown')], earrings: ['drop', gold], flower: petal('poppy'), top: ['tee', dye('black')], outer: ['jacket', dye('forest')], bottom: ['trousers', cloth('raw-denim')], shoes: ['boots', leather('tan')], blush: true }),
];
