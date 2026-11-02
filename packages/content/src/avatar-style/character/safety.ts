import { colourDistance, oklab, rgb, type Hex } from './colour';
import { FACE_PAINTS, SKIN_TONES } from './palette';
import type { CitizenLook, HatStyleId, OuterStyleId, TopStyleId } from './recipe';

/*
 * The harmful-combination check for looks (Safety §3.1, the floor; the "Looks" row). Most of the work is done by
 * what the catalogue leaves out: there is no brush moustache, no armband, no insignia, no animal ears, no
 * feathered headdress or other sacred or cultural dress worn as a costume, and no face paint over the mouth or
 * the whole face. What is left is what can only go wrong in combination, or through a free colour choice, and
 * that is checked here. Every rule returns one plain sentence that says what to change; nothing is ever
 * worded as a violation. The look authority runs it before it saves a look, the builder before it offers Save,
 * and `seedLook` never produces a look it refuses. Rules are documented in the README.
 */

const lab = (hex: Hex) => {
  const [l, a, b] = oklab(rgb(hex));
  return { l, chroma: Math.hypot(a, b) };
};

/** White or near-white: very light and without colour (white, cream, pale grey). */
export function isWhitish(hex: Hex): boolean {
  const { l, chroma } = lab(hex);
  return l > .84 && chroma < .045;
}

/** Hats that rise to a point: with a long white garment they recreate a hate group's robes. */
const POINTED_HATS = ['pointed-hat', 'party-cone', 'nightcap'] as const satisfies readonly HatStyleId[];
/** Striped pointed hats only read as a white hood when both of their colours are white. */
const STRIPED_POINTED: readonly HatStyleId[] = ['party-cone', 'nightcap'];
/** Garments that hang long or cover the shoulders like a robe. */
const LONG_TOPS: readonly TopStyleId[] = ['robe', 'tunic'];
const LONG_OUTERS: readonly OuterStyleId[] = ['coat', 'cloak', 'poncho'];

/** How close a paint may come to a human skin tone before it reads as skin. */
export const SKIN_LIKE = .08;

/** A colour no human skin has: near-black and colourless. It reads as black paint, not as a person. */
function coalBlack(hex: Hex): boolean {
  const { l, chroma } = lab(hex);
  return l < .3 && chroma < .04;
}

/**
 * What must not be worn as it is, as plain sentences for the person (empty when the look is fine). Checks the
 * recipe only, so it is cheap enough for every save and every roll of the dice.
 */
export function checkHarmful(look: CitizenLook): readonly string[] {
  const found: string[] = [];

  // A white pointed hat with a long white robe or cloak is a hate group's uniform, whatever the intent.
  const hat = look.hat;
  if (hat && (POINTED_HATS as readonly HatStyleId[]).includes(hat.style)
    && isWhitish(hat.colour) && (!STRIPED_POINTED.includes(hat.style) || isWhitish(hat.trim))) {
    const longWhite = (LONG_TOPS.includes(look.top.style) && isWhitish(look.top.dye))
      || (look.outer !== null && LONG_OUTERS.includes(look.outer.style) && isWhitish(look.outer.dye));
    if (longWhite) found.push('A white pointed hat is not worn with a long white robe or cloak. Give one of them another colour, or choose another hat.');
  }

  // Face paint is festival colour on part of the face, never a different skin.
  const paint = look.facePaint;
  if (paint) {
    const skinLike = SKIN_TONES.some(s => colourDistance(s.hex, paint.colour) < SKIN_LIKE) || colourDistance(look.skin, paint.colour) < SKIN_LIKE;
    if (lab(paint.colour).l < .5) found.push('Face paint is never dark. Choose a bright colour from the paint pot.');
    else if (skinLike) found.push('Face paint never takes a skin tone, so it never reads as a different skin. Choose a bright colour from the paint pot.');
    else if (!FACE_PAINTS.some(p => p.hex === paint.colour)) found.push('Face paint comes from the paint pot. Choose one of its colours.');
  }

  // Skin is a person's: any tone or a clearly fey colour, never coal black, which reads as paint.
  if (coalBlack(look.skin)) found.push('No one has skin this black: it reads as paint. Choose a skin tone from the swatches, or a fey colour.');

  return found;
}
