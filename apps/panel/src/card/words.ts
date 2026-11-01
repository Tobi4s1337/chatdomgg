// How the card says things: a home's size in words, and a name in a colour that reads on parchment.
import type { HomeTier } from '../model';

const TIER_WORDS: Readonly<Record<HomeTier, string>> = { hut: 'A hut', cottage: 'A cottage', house: 'A house', manor: 'A manor house', hall: 'A hall' };
/** How a home's tier reads beside its street: "A cottage on Lantern Row". */
export const homeLine = (tier: HomeTier | null, street: string) => tier ? `${TIER_WORDS[tier]} on ${street}` : street;

/** The chat colour is kept when it reads on parchment; otherwise the name is inked and the colour rides beside it. */
export function nameInk(colour: string | null): { ink: string | null; swatch: string | null } {
  if (!colour || !/^#[0-9a-f]{6}$/i.test(colour)) return { ink: null, swatch: null };
  const channel = (i: number) => { const c = parseInt(colour.slice(1 + i * 2, 3 + i * 2), 16) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
  const luminance = .2126 * channel(0) + .7152 * channel(1) + .0722 * channel(2);
  // Parchment is about 0.7 in relative luminance: 4.5:1 needs the colour at or under about 0.13.
  return luminance <= .13 ? { ink: colour, swatch: null } : { ink: null, swatch: colour };
}
