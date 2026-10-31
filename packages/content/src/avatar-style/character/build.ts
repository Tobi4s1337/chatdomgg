import { luma, mix, rgb, shade, type Rgb } from './colour';
import { VoxelGrid, type Slot } from './grid';
import { drawBust } from './bust';
import { drawHead, type HeadOptions } from './head';
import { drawBeard, drawHair, drawMoustache, drawTiedHair } from './hair';
import { drawEarrings, drawFlower, drawGlasses, drawHat, hatBrim } from './accessories';
import { BLUSH_PINK, EYE_INK, EYE_INK_DEEP, FLOWER_HEART, FRECKLE_BROWN, LEAF_GREEN, METALS } from './palette';
import type { CitizenLook } from './recipe';

/**
 * The whole citizen as one paint grid. The order is the dressing order: bust, head and face, hair, the hat
 * over the hair, tied hair out from under the hat, beard and moustache, then glasses, earrings and a flower.
 */
export function buildCitizen(look: CitizenLook, options: HeadOptions = {}): VoxelGrid {
  const g = new VoxelGrid();
  drawBust(g);
  drawHead(g, look, options);
  drawHair(g, look.hair.style);
  if (look.hat) drawHat(g, look.hat.style);
  drawTiedHair(g, look.hair.style, look.hat ? hatBrim(look.hat.style) : undefined);
  if (look.beard) drawBeard(g, look.beard.style);
  if (look.moustache) drawMoustache(g, look.moustache.style);
  if (look.glasses) drawGlasses(g, look.glasses.style, look.eyes.spacing);
  if (look.earrings) drawEarrings(g, look.earrings.style);
  if (look.flower) drawFlower(g, look.hat?.style ?? null);
  return g;
}

/**
 * Every slot's colour for a look. Derived tones are computed, never picked, so any skin, hair or dye stays
 * coherent: a deep tone is the same hue darker, blush is pink mixed into this skin, and light hair gets a
 * stronger deep tone than dark hair so its layers still separate.
 */
export function slotColours(look: CitizenLook): Record<Slot, Rgb> {
  const skin = rgb(look.skin), hair = rgb(look.hair.colour), dye = rgb(look.top.dye);
  const beard = rgb(look.beard?.colour ?? look.hair.colour);
  const stache = rgb(look.moustache?.colour ?? look.beard?.colour ?? look.hair.colour);
  const deep = (c: Rgb) => shade(c, luma(c) > .55 ? .8 : luma(c) < .15 ? .7 : .78);
  const hat = rgb(look.hat?.colour ?? look.top.dye), trim = rgb(look.hat?.trim ?? look.top.dye);
  // Dark felt and knit lift instead of darkening, so a black beanie still shows its knit.
  const tone = (c: Rgb) => (luma(c) < .12 ? mix(c, [1, 1, 1], .12) : shade(c, .84));
  return {
    skin,
    eye: rgb(luma(skin) < .4 ? EYE_INK_DEEP : EYE_INK),
    blush: mix(skin, rgb(BLUSH_PINK), luma(skin) > .5 ? .42 : .32),
    freckle: mix(skin, rgb(FRECKLE_BROWN), luma(skin) > .5 ? .3 : .24),
    hair,
    hairDeep: deep(hair),
    hairLight: mix(hair, [1, 1, 1], luma(hair) < .2 ? .12 : .18),
    scalp: mix(hair, skin, .55),
    band: luma(hair) > .45 ? rgb('#2a2730') : rgb('#e9e4dc'),
    beard,
    beardDeep: deep(beard),
    stubble: mix(skin, beard, luma(skin) > luma(beard) ? .38 : .5),
    stache,
    stacheDeep: deep(stache),
    hat,
    hatDeep: tone(hat),
    hatTrim: trim,
    hatTrimDeep: tone(trim),
    frame: rgb(look.glasses?.colour ?? METALS[4].hex),
    lens: rgb(look.glasses?.lens ?? '#ffffff'),
    metal: rgb(look.earrings?.colour ?? METALS[0].hex),
    petal: rgb(look.flower?.colour ?? '#ffffff'),
    petalHeart: rgb(FLOWER_HEART),
    leaf: rgb(LEAF_GREEN),
    top: dye,
    topDeep: shade(dye, .74),
  };
}
