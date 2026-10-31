import { isHex, type Hex } from './colour';
import { DYES, NATURAL_HAIR, SKIN_TONES, WILD_HAIR } from './palette';

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

export const HAIR_STYLE_IDS = ['short-crop', 'quiff', 'curls', 'afro', 'buns', 'ponytail', 'bob', 'long-waves', 'bald'] as const;
export type HairStyleId = typeof HAIR_STYLE_IDS[number];
export const BEARD_STYLE_IDS = ['full', 'chinstrap'] as const;
export type BeardStyleId = typeof BEARD_STYLE_IDS[number];
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
  readonly top: { readonly style: TopStyleId; readonly dye: Hex };
}

const oneOf = <T extends string>(list: readonly T[], value: unknown, what: string): T => {
  if (typeof value !== 'string' || !(list as readonly string[]).includes(value)) throw new Error(`Unknown ${what}: ${String(value)}.`);
  return value as T;
};
const colour = (value: unknown, what: string): Hex => {
  if (!isHex(value)) throw new Error(`${what} must be a #rrggbb colour.`);
  return value;
};
const record = (value: unknown, what: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} must be an object.`);
  return value as Record<string, unknown>;
};

/** Validates untrusted input (a saved look, a realm message) into a recipe. Unknown keys are refused. */
export function parseLook(input: unknown): CitizenLook {
  const v = record(input, 'Look');
  const known = ['version', 'skin', 'eyes', 'freckles', 'blush', 'hair', 'beard', 'top'];
  for (const key of Object.keys(v)) if (!known.includes(key)) throw new Error(`Unknown look field ${key}.`);
  if (v.version !== 1) throw new Error('Unsupported look version.');
  const eyes = record(v.eyes, 'Eyes'), hair = record(v.hair, 'Hair'), top = record(v.top, 'Top');
  if (typeof v.blush !== 'boolean') throw new Error('Blush must be true or false.');
  const beard = v.beard === null ? null : record(v.beard, 'Beard');
  return {
    version: 1,
    skin: colour(v.skin, 'Skin'),
    eyes: { shape: oneOf(EYE_SHAPES, eyes.shape, 'eye shape'), spacing: oneOf(EYE_SPACINGS, eyes.spacing, 'eye spacing') },
    freckles: oneOf(FRECKLES, v.freckles, 'freckles'),
    blush: v.blush,
    hair: { style: oneOf(HAIR_STYLE_IDS, hair.style, 'hair style'), colour: colour(hair.colour, 'Hair colour') },
    beard: beard && { style: oneOf(BEARD_STYLE_IDS, beard.style, 'beard'), colour: colour(beard.colour, 'Beard colour') },
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
    ['short-crop', 3], ['quiff', 3], ['curls', 3], ['afro', 2], ['buns', 2], ['ponytail', 3], ['bob', 3], ['long-waves', 3], ['bald', .6],
  ]);
  const hairColour = random() < .2 ? pick(random, WILD_HAIR).hex : pick(random, NATURAL_HAIR).hex;
  // Seeded beards only go with short hair: long hair and a full beard in one colour close around an
  // eight-cell face and hide it. The builder still allows any combination.
  const beardChance = style === 'bald' ? .55 : style === 'short-crop' || style === 'quiff' ? .3 : 0;
  const beard = random() < beardChance
    ? { style: pick(random, BEARD_STYLE_IDS), colour: random() < .85 ? hairColour : pick(random, NATURAL_HAIR).hex }
    : null;
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
    top: { style: 'tee', dye: pick(random, DYES).hex },
  };
}
