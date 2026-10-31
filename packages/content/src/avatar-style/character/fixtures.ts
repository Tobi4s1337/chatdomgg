import type { Hex } from './colour';
import { DYES, NATURAL_HAIR, SKIN_TONES, WILD_HAIR } from './palette';
import type { BeardStyleId, CitizenLook, EyeShape, EyeSpacing, Freckles, HairStyleId } from './recipe';

/*
 * Twenty SIMULATED citizens for the portrait sheet, laid out 4 × 5 like the reference: every hair style,
 * both beards, every eye shape and spacing, freckles and blush, and skin from the lightest swatch to the
 * deepest. Not real people; the bench labels them SIMULATED.
 */
type Named<T extends readonly { id: string; hex: Hex }[]> = T[number]['id'];
const skin = (id: Named<typeof SKIN_TONES>) => SKIN_TONES.find(s => s.id === id)!.hex;
const hair = (id: Named<typeof NATURAL_HAIR> | Named<typeof WILD_HAIR>) => [...NATURAL_HAIR, ...WILD_HAIR].find(s => s.id === id)!.hex;
const dye = (id: Named<typeof DYES>) => DYES.find(s => s.id === id)!.hex;

interface Spec {
  readonly name: string;
  readonly skin: Hex;
  readonly hair: readonly [HairStyleId, Hex];
  readonly beard?: readonly [BeardStyleId, Hex];
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
    top: { style: 'tee', dye: s.top },
  },
});

export const PORTRAIT_FIXTURES: readonly { readonly name: string; readonly look: CitizenLook }[] = [
  look({ name: 'Simulated Ashby', skin: skin('apricot'), hair: ['short-crop', hair('ash')], beard: ['full', hair('soft-black')], top: dye('tomato') }),
  look({ name: 'Simulated Maren', skin: skin('peach'), hair: ['curls', hair('copper')], top: dye('white'), freckles: 'light' }),
  look({ name: 'Simulated Teo', skin: skin('caramel'), hair: ['short-crop', hair('black')], top: dye('sky') }),
  look({ name: 'Simulated Lise', skin: skin('shell'), hair: ['bob', hair('blond')], top: dye('cobalt'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Jun', skin: skin('cream'), hair: ['quiff', hair('black')], top: dye('red') }),
  look({ name: 'Simulated Hazel', skin: skin('rose'), hair: ['long-waves', hair('chestnut')], top: dye('charcoal'), blush: true }),
  look({ name: 'Simulated Rory', skin: skin('apricot'), hair: ['short-crop', hair('ginger')], beard: ['chinstrap', hair('ginger')], top: dye('white'), freckles: 'full' }),
  look({ name: 'Simulated Amira', skin: skin('golden'), hair: ['buns', hair('espresso')], top: dye('white'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Pip', skin: skin('peach'), hair: ['quiff', hair('brown')], top: dye('purple'), freckles: 'light' }),
  look({ name: 'Simulated Elder Bram', skin: skin('porcelain'), hair: ['short-crop', hair('white')], beard: ['full', hair('white')], top: dye('yellow') }),
  look({ name: 'Simulated Noor', skin: skin('mocha'), hair: ['ponytail', hair('black')], top: dye('sky'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Inés', skin: skin('tawny'), hair: ['long-waves', hair('espresso')], top: dye('black') }),
  look({ name: 'Simulated Kit', skin: skin('sand'), hair: ['ponytail', hair('honey')], top: dye('red'), blush: true }),
  look({ name: 'Simulated Kofi', skin: skin('ebony'), hair: ['afro', hair('black')], top: dye('mustard') }),
  look({ name: 'Simulated Sora', skin: skin('cream'), hair: ['bob', hair('soft-black')], top: dye('sky'), eyes: ['closed', 'wide'] }),
  look({ name: 'Simulated Wren', skin: skin('rose'), hair: ['buns', hair('auburn')], top: dye('orange'), blush: true, freckles: 'light' }),
  look({ name: 'Simulated Old Tam', skin: skin('shell'), hair: ['bald', hair('grey')], beard: ['full', hair('grey')], top: dye('teal'), eyes: ['dot', 'wide'] }),
  look({ name: 'Simulated Vix', skin: skin('peach'), hair: ['ponytail', hair('violet')], top: dye('white'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Zuri', skin: skin('midnight'), hair: ['afro', hair('ice')], top: dye('leaf'), eyes: ['tall', 'set'] }),
  look({ name: 'Simulated Dara', skin: skin('honey'), hair: ['curls', hair('brown')], top: dye('forest'), blush: true }),
];
