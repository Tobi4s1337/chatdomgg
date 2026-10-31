import { luma, mix, rgb, shade, type Hex, type Rgb } from './colour';
import { VoxelGrid, type Slot } from './grid';
import { drawBody } from './body';
import { drawBib, drawBottom, drawNeckwear, drawOuter, drawShoes, drawTop } from './wardrobe';
import { drawHead, type HeadOptions } from './head';
import { drawBeard, drawHair, drawMoustache, drawTiedHair } from './hair';
import { drawEarrings, drawFlower, drawGlasses, drawHat, hatShape } from './accessories';
import { RIBBON_COLOURS, drawEarnedBody, forgedHat, ribbonMarks } from './earned-draw';
import { BRASS, BLUSH_PINK, EYE_INK, EYE_INK_DEEP, FLOWER_HEART, FRECKLE_BROWN, LEAF_GREEN, METALS } from './palette';
import type { CitizenLook } from './recipe';

/**
 * The whole citizen as one paint grid. The order is the dressing order: the body, the bottom, the top, the bib
 * of overalls, an open outer layer, neckwear and shoes; then the head and face, hair, the hat over the hair,
 * tied hair out from under the hat, beard and moustache, then glasses, earrings and a flower.
 */
export function buildCitizen(look: CitizenLook, options: HeadOptions = {}): VoxelGrid {
  const hat = look.earned.forgedHat ? forgedHat(look.earned.forgedHat.motif) : look.hat ? hatShape(look.hat.style) : null;
  const g = new VoxelGrid();
  drawBody(g);
  drawBottom(g, look.bottom.style, look.bottom.pattern);
  drawTop(g, look.top.style, look.top.pattern);
  if (look.bottom.style === 'overalls' && look.top.style !== 'robe') drawBib(g);
  if (look.outer) drawOuter(g, look.outer.style, look.outer.pattern);
  if (look.neckwear) drawNeckwear(g, look.neckwear.style);
  drawShoes(g, look.shoes.style);
  drawEarnedBody(g, look.earned);
  drawHead(g, look, options);
  drawHair(g, look.hair.style);
  if (hat) drawHat(g, hat);
  drawTiedHair(g, look.hair.style, hat?.brim);
  if (look.beard) drawBeard(g, look.beard.style);
  if (look.moustache) drawMoustache(g, look.moustache.style);
  if (look.glasses) drawGlasses(g, look.glasses.style, look.eyes.spacing);
  if (look.earrings) drawEarrings(g, look.earrings.style);
  if (look.flower) drawFlower(g, hat);
  return g;
}

/**
 * Every slot's colour for a look. Derived tones are computed, never picked, so any skin, hair or dye stays
 * coherent: a deep tone is the same hue darker, blush is pink mixed into this skin, and light hair gets a
 * stronger deep tone than dark hair so its layers still separate.
 */
export interface ColourOptions {
  /** A lapsed sub: sub pieces dim but are still worn (ChatDom.md §4). */
  readonly subLapsed?: boolean | undefined;
}

export function slotColours(look: CitizenLook, options: ColourOptions = {}): Record<Slot, Rgb> {
  const forged = look.earned.forgedHat;
  const skin = rgb(look.skin), hair = rgb(look.hair.colour);
  const neck = rgb(look.neckwear?.dye ?? look.top.dye), shoe = rgb(look.shoes.dye);
  const beard = rgb(look.beard?.colour ?? look.hair.colour);
  const stache = rgb(look.moustache?.colour ?? look.beard?.colour ?? look.hair.colour);
  const deep = (c: Rgb) => shade(c, luma(c) > .55 ? .8 : luma(c) < .15 ? .7 : .78);
  const hat = rgb(forged?.colours[0] ?? look.hat?.colour ?? look.top.dye), trim = rgb(forged?.colours[1] ?? look.hat?.trim ?? look.top.dye);
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
    ...garmentColours('top', look.top),
    // Drawstrings and the like: white on dark or mid cloth, near-black on light.
    topTrim: rgb(luma(rgb(look.top.dye)) > .62 ? '#2a2730' : '#f3f1ee'),
    ...garmentColours('outer', look.outer ?? look.top),
    ...garmentColours('bottom', look.bottom),
    neck: neck,
    neckDeep: cloth(neck),
    neckAccent: rgb(look.neckwear?.accent ?? look.top.accent),
    shoe,
    shoeDeep: shade(shoe, .62),
    // Sneakers have a white rubber sole; a white sneaker gets a pale grey one so the two still part.
    sole: luma(shoe) > .8 ? rgb('#c9c4bc') : rgb('#f3f1ee'),
    button: rgb(BRASS),
    ...earnedColours(look, options),
  };
}

const GREY: Rgb = [.5, .49, .5];

/** The earned pieces' colours. With one month mark reached, both ribbon cells are its colour. */
function earnedColours(look: CitizenLook, { subLapsed = false }: ColourOptions): Record<Slot & (`ribbon${1 | 2}` | `hood${'' | 'Deep' | 'Trim'}` | `pin${1 | 2}${'a' | 'b' | 'm'}` | `raid${'A' | 'B' | 'Deep'}` | 'forgeMetal'), Rgb> {
  const e = look.earned;
  const marks = e.ribbons ? ribbonMarks(e.ribbons.months) : [1 as const];
  const ribbon = (i: number) => {
    const c = rgb(RIBBON_COLOURS[marks[Math.min(i, marks.length - 1)]!]);
    return subLapsed ? mix(c, GREY, .45) : c;
  };
  const hood = rgb(e.hood?.cloth ?? look.top.dye), hoodTrim = rgb(e.hood?.trim ?? look.top.accent);
  const pin = (i: 0 | 1) => {
    const p = e.pins[i];
    if (!p || p.kind === 'founder') return [rgb(BRASS), rgb('#fbf6ea'), rgb(BRASS)] as const;
    return [rgb(p.colours[0]), rgb(p.colours[1]), rgb(p.kind === 'forged' ? METALS[0].hex : BRASS)] as const;
  };
  const [p1, p2] = [pin(0), pin(1)];
  const [ra, rb] = (e.scarf?.colours ?? [look.top.dye, look.top.accent]).map(rgb) as [Rgb, Rgb];
  return {
    ribbon1: ribbon(0), ribbon2: ribbon(1),
    hood, hoodDeep: cloth(hood), hoodTrim,
    pin1a: p1[0], pin1b: p1[1], pin1m: p1[2], pin2a: p2[0], pin2b: p2[1], pin2m: p2[2],
    raidA: ra, raidB: rb, raidDeep: cloth(ra),
    forgeMetal: rgb(METALS[0].hex),
  };
}

/** The deep tone of a cloth: darker, but very dark cloth lifts instead, so a black hem still shows. */
function cloth(c: Rgb): Rgb {
  return luma(c) < .1 ? mix(c, [1, 1, 1], .16) : shade(c, .74);
}

function garmentColours<P extends 'top' | 'outer' | 'bottom'>(prefix: P, g: { readonly dye: Hex; readonly accent: Hex }): Record<P | `${P}Deep` | `${P}Accent` | `${P}Mix`, Rgb> {
  const dye = rgb(g.dye), accent = rgb(g.accent);
  return { [prefix]: dye, [`${prefix}Deep`]: cloth(dye), [`${prefix}Accent`]: accent, [`${prefix}Mix`]: mix(dye, accent, .5) } as Record<P | `${P}Deep` | `${P}Accent` | `${P}Mix`, Rgb>;
}
