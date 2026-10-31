import { luma, mix, rgb, shade, type Rgb } from './colour';
import { VoxelGrid, type Slot } from './grid';
import { drawBust } from './bust';
import { drawHead, type HeadOptions } from './head';
import { drawBeard, drawHair } from './hair';
import { BLUSH_PINK, EYE_INK, EYE_INK_DEEP, FRECKLE_BROWN } from './palette';
import type { CitizenLook } from './recipe';

/** The whole citizen as one paint grid: bust, head and face, hair, beard. */
export function buildCitizen(look: CitizenLook, options: HeadOptions = {}): VoxelGrid {
  const g = new VoxelGrid();
  drawBust(g);
  drawHead(g, look, options);
  drawHair(g, look.hair.style);
  if (look.beard) drawBeard(g, look.beard.style);
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
  const deep = (c: Rgb) => shade(c, luma(c) > .55 ? .8 : luma(c) < .15 ? .7 : .78);
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
    top: dye,
    topDeep: shade(dye, .74),
  };
}
