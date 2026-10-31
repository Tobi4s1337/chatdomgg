import { isHex, luma, rgb, type Hex } from './colour';
import { DYES, LENS_TINTS, METALS, NATURAL_HAIR, PETALS, SKIN_TONES, STRAW, WILD_HAIR } from './palette';

/*
 * The citizen look recipe (spec 49). A recipe is what a person saves and what everyone else receives: pure
 * data, every colour a `#rrggbb`, every shape an id from a fixed list. Geometry is rebuilt from it on every
 * client, so the same character appears in the kingdom, on stream, on the card and in the passport.
 */

/** `dot`: one cell, the reference eye. `tall`: two cells, brighter-eyed. `closed`: a flat line, content (and the blink frame). */
export const EYE_SHAPES = ['dot', 'tall', 'closed'] as const;
export type EyeShape = typeof EYE_SHAPES[number];
/** `set`: two cells apart, the reference face. `wide`: four cells apart, a softer, sleepier face. */
export const EYE_SPACINGS = ['set', 'wide'] as const;
export type EyeSpacing = typeof EYE_SPACINGS[number];
export const FRECKLES = ['none', 'light', 'full'] as const;
export type Freckles = typeof FRECKLES[number];

/** Eighteen styles and bald (spec L3). Short and close first, then the long, tied and big ones. */
export const HAIR_STYLE_IDS = [
  'short-crop', 'side-part', 'quiff', 'slicked', 'spiky', 'side-shave', 'mohawk', 'wild-tuft', 'curls', 'afro', 'locs',
  'bob', 'long-waves', 'braids', 'ponytail', 'pigtails', 'buns', 'top-knot', 'bald',
] as const;
export type HairStyleId = typeof HAIR_STYLE_IDS[number];
export const BEARD_STYLE_IDS = ['full', 'chinstrap', 'goatee', 'stubble'] as const;
export type BeardStyleId = typeof BEARD_STYLE_IDS[number];
export const MOUSTACHE_STYLE_IDS = ['walrus', 'handlebar', 'horseshoe'] as const;
export type MoustacheStyleId = typeof MOUSTACHE_STYLE_IDS[number];
/** `colour` is the crown (the straw, the felt, the knit); `trim` is the bill, band, cuff and pompom. */
export const HAT_STYLE_IDS = ['cap', 'cap-backwards', 'beanie', 'straw-hat', 'pointed-hat'] as const;
export type HatStyleId = typeof HAT_STYLE_IDS[number];
export const GLASSES_STYLE_IDS = ['round', 'square', 'goggles'] as const;
export type GlassesStyleId = typeof GLASSES_STYLE_IDS[number];
export const EARRING_STYLE_IDS = ['stud', 'hoop', 'drop'] as const;
export type EarringStyleId = typeof EARRING_STYLE_IDS[number];
export const TOP_STYLE_IDS = ['tee'] as const;
export type TopStyleId = typeof TOP_STYLE_IDS[number];

export interface CitizenLook {
  readonly version: 1;
  readonly skin: Hex;
  readonly eyes: { readonly shape: EyeShape; readonly spacing: EyeSpacing };
  readonly freckles: Freckles;
  readonly blush: boolean;
  readonly hair: { readonly style: HairStyleId; readonly colour: Hex };
  readonly beard: { readonly style: BeardStyleId; readonly colour: Hex } | null;
  readonly moustache: { readonly style: MoustacheStyleId; readonly colour: Hex } | null;
  readonly hat: { readonly style: HatStyleId; readonly colour: Hex; readonly trim: Hex } | null;
  /** `colour` is the frame (and the goggle strap); `lens` tints the glass the eyes show through. */
  readonly glasses: { readonly style: GlassesStyleId; readonly colour: Hex; readonly lens: Hex } | null;
  readonly earrings: { readonly style: EarringStyleId; readonly colour: Hex } | null;
  /** A flower tucked over the ear, or into the hat band when the hat has one. */
  readonly flower: { readonly colour: Hex } | null;
  readonly top: { readonly style: TopStyleId; readonly dye: Hex };
}

/** The parts a look may leave out. A saved look from before they existed reads as wearing none of them. */
const OPTIONAL_PARTS = ['moustache', 'hat', 'glasses', 'earrings', 'flower'] as const;

const oneOf = <T extends string>(list: readonly T[], value: unknown, what: string): T => {
  if (typeof value !== 'string' || !(list as readonly string[]).includes(value)) throw new Error(`Unknown ${what}: ${String(value)}.`);
  return value as T;
};
/** Any `#rrggbb`, either case; stored lower-case so equal looks compare equal. */
const colour = (value: unknown, what: string): Hex => {
  if (!isHex(value)) throw new Error(`${what} must be a #rrggbb colour.`);
  return value.toLowerCase() as Hex;
};
/** An object with exactly the known keys: a misspelt or extra field is refused, at every level. */
const record = (value: unknown, what: string, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown ${what.toLowerCase()} field ${key}.`);
  return value as Record<string, unknown>;
};
const part = <T>(value: unknown, read: (v: unknown) => T): T | null => (value === undefined || value === null ? null : read(value));

/** Validates untrusted input (a saved look, a realm message) into a recipe. Unknown keys are refused. */
export function parseLook(input: unknown): CitizenLook {
  const v = record(input, 'Look', ['version', 'skin', 'eyes', 'freckles', 'blush', 'hair', 'beard', 'top', ...OPTIONAL_PARTS]);
  if (v.version !== 1) throw new Error('Unsupported look version.');
  const eyes = record(v.eyes, 'Eyes', ['shape', 'spacing']), hair = record(v.hair, 'Hair', ['style', 'colour']);
  const top = record(v.top, 'Top', ['style', 'dye']);
  if (typeof v.blush !== 'boolean') throw new Error('Blush must be true or false.');
  if (v.beard === undefined) throw new Error('Beard must be a beard or null.');
  return {
    version: 1,
    skin: colour(v.skin, 'Skin'),
    eyes: { shape: oneOf(EYE_SHAPES, eyes.shape, 'eye shape'), spacing: oneOf(EYE_SPACINGS, eyes.spacing, 'eye spacing') },
    freckles: oneOf(FRECKLES, v.freckles, 'freckles'),
    blush: v.blush,
    hair: { style: oneOf(HAIR_STYLE_IDS, hair.style, 'hair style'), colour: colour(hair.colour, 'Hair colour') },
    beard: part(v.beard, b => {
      const r = record(b, 'Beard', ['style', 'colour']);
      return { style: oneOf(BEARD_STYLE_IDS, r.style, 'beard'), colour: colour(r.colour, 'Beard colour') };
    }),
    moustache: part(v.moustache, m => {
      const r = record(m, 'Moustache', ['style', 'colour']);
      return { style: oneOf(MOUSTACHE_STYLE_IDS, r.style, 'moustache'), colour: colour(r.colour, 'Moustache colour') };
    }),
    hat: part(v.hat, h => {
      const r = record(h, 'Hat', ['style', 'colour', 'trim']);
      return { style: oneOf(HAT_STYLE_IDS, r.style, 'hat'), colour: colour(r.colour, 'Hat colour'), trim: colour(r.trim, 'Hat trim') };
    }),
    glasses: part(v.glasses, gl => {
      const r = record(gl, 'Glasses', ['style', 'colour', 'lens']);
      return { style: oneOf(GLASSES_STYLE_IDS, r.style, 'glasses'), colour: colour(r.colour, 'Frame colour'), lens: colour(r.lens, 'Lens tint') };
    }),
    earrings: part(v.earrings, e => {
      const r = record(e, 'Earrings', ['style', 'colour']);
      return { style: oneOf(EARRING_STYLE_IDS, r.style, 'earrings'), colour: colour(r.colour, 'Earring colour') };
    }),
    flower: part(v.flower, f => ({ colour: colour(record(f, 'Flower', ['colour']).colour, 'Flower colour') })),
    top: { style: oneOf(TOP_STYLE_IDS, top.style, 'top'), dye: colour(top.dye, 'Top dye') },
  };
}

/** FNV-1a then mulberry32: a small, stable stream of numbers from any id. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The natural hair tone nearest to `hair` whose lightness differs from it enough to read as a separate part. */
function apart(hair: Hex): Hex {
  const lum = (h: Hex) => luma(rgb(h));
  const candidates = NATURAL_HAIR.filter(n => Math.abs(lum(n.hex) - lum(hair)) > .14);
  return candidates.reduce((best, n) => (Math.abs(lum(n.hex) - lum(hair)) < Math.abs(lum(best.hex) - lum(hair)) ? n : best), candidates[0]!).hex;
}

const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
const weighted = <T>(random: () => number, entries: readonly (readonly [T, number])[]): T => {
  let r = random() * entries.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of entries) if ((r -= w) < 0) return value;
  return entries[entries.length - 1]![0];
};

/**
 * A complete, good-looking look from a seed (a person id, so a newcomer already looks like someone). The odds
 * keep most citizens in natural hair and plain faces, with enough freckles, dyed hair and beards that a crowd
 * is varied. Twitch defaults (name colour as dye, tenure garb) are layered on by the builder, not here.
 */
export function seedLook(seed: string): CitizenLook {
  const random = seededRandom(`citizen-look:${seed}`);
  const skin = pick(random, SKIN_TONES).hex;
  const style = weighted<HairStyleId>(random, [
    ['short-crop', 3], ['side-part', 3], ['quiff', 2.5], ['slicked', 1.5], ['spiky', 2], ['side-shave', 1.5], ['mohawk', 1],
    ['wild-tuft', 1.5], ['curls', 3], ['afro', 2], ['locs', 1.5], ['bob', 3], ['long-waves', 3], ['braids', 2], ['ponytail', 3],
    ['pigtails', 1.5], ['buns', 2], ['top-knot', 1.5], ['bald', .6],
  ]);
  const hairColour = random() < .2 ? pick(random, WILD_HAIR).hex : pick(random, NATURAL_HAIR).hex;
  // Seeded beards only go with short hair: long hair and a full beard in one colour close around an
  // eight-cell face and hide it. The builder still allows any combination.
  const short = ['short-crop', 'side-part', 'quiff', 'slicked', 'spiky', 'side-shave', 'mohawk', 'bald'].includes(style);
  const beardChance = style === 'bald' ? .55 : short ? .28 : 0;
  const facial = () => (random() < .85 ? hairColour : pick(random, NATURAL_HAIR).hex);
  const beardStyle = random() < beardChance ? weighted<BeardStyleId>(random, [['full', 2], ['chinstrap', 2], ['goatee', 2], ['stubble', 3]]) : null;
  // A full beard in the hair's own colour joins the hair round the jaw into a hood that swallows the face,
  // so a seeded full beard takes the nearest natural tone that stands apart from the hair.
  const beard = beardStyle && { style: beardStyle, colour: beardStyle === 'full' ? apart(hairColour) : facial() };
  const moustache = short && random() < (beard ? .3 : .1) ? { style: pick(random, MOUSTACHE_STYLE_IDS), colour: beard?.colour ?? facial() } : null;
  // Accessories are what a crowd remembers someone by; about a third of a town wears at least one.
  const hatStyle = random() < .22 ? weighted<HatStyleId>(random, [['cap', 3], ['cap-backwards', 2], ['beanie', 3], ['straw-hat', 2], ['pointed-hat', .7]]) : null;
  const hat = hatStyle && {
    style: hatStyle,
    colour: hatStyle === 'straw-hat' ? pick(random, STRAW).hex : pick(random, DYES).hex,
    trim: pick(random, DYES).hex,
  };
  const glassesStyle = random() < .16 ? weighted<GlassesStyleId>(random, [['round', 3], ['square', 3], ['goggles', 1]]) : null;
  const glasses = glassesStyle && {
    style: glassesStyle,
    colour: pick(random, METALS).hex,
    lens: glassesStyle === 'goggles' ? pick(random, [LENS_TINTS[4], LENS_TINTS[3], LENS_TINTS[2]]).hex : pick(random, LENS_TINTS.slice(0, 4)).hex,
  };
  const earrings = random() < .14 ? { style: pick(random, EARRING_STYLE_IDS), colour: pick(random, METALS.slice(0, 3)).hex } : null;
  const flower = !beard && random() < .07 ? { colour: pick(random, PETALS).hex } : null;
  return {
    version: 1,
    skin,
    eyes: {
      shape: weighted<EyeShape>(random, [['dot', 7], ['tall', 2.5], ['closed', .45]]),
      spacing: random() < .82 ? 'set' : 'wide',
    },
    freckles: weighted<Freckles>(random, [['none', 7], ['light', 2], ['full', 1]]),
    blush: random() < .3,
    hair: { style, colour: hairColour },
    beard,
    moustache,
    hat,
    glasses,
    earrings,
    flower,
    top: { style: 'tee', dye: pick(random, DYES).hex },
  };
}
