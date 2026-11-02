import { isHex, luma, rgb, type Hex } from './colour';
import { BOTTOM_CLOTH, DYES, FEY_TINTS, LEAF_GREEN, LEATHER, LENS_TINTS, METALS, NATURAL_HAIR, PETALS, SKIN_TONES, STRAW, WILD_HAIR } from './palette';
import { checkHarmful } from './safety';

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
export const HAT_STYLE_IDS = [
  'cap', 'cap-backwards', 'beanie', 'straw-hat', 'pointed-hat',
  'beret', 'bucket-hat', 'top-hat', 'flat-cap', 'flower-crown', 'earflap-hat',
  'frog-hat', 'teapot-hat', 'party-cone', 'fish-hat', 'chef-toque', 'propeller-cap', 'antler-band', 'nightcap', 'toadstool-cap', 'bee-antennae',
] as const;
export type HatStyleId = typeof HAT_STYLE_IDS[number];
export const GLASSES_STYLE_IDS = ['round', 'square', 'goggles', 'shades', 'half-moon', 'heart', 'star', 'monocle'] as const;
export type GlassesStyleId = typeof GLASSES_STYLE_IDS[number];
export const EARRING_STYLE_IDS = ['stud', 'hoop', 'drop', 'crescent', 'pearl', 'tassel', 'cherries'] as const;
export type EarringStyleId = typeof EARRING_STYLE_IDS[number];
/** What is worn next to the skin (spec L5). A robe is a top that reaches the shins. */
export const TOP_STYLE_IDS = ['tee', 'tank', 'shirt', 'hoodie', 'sweater', 'robe', 'turtleneck', 'tunic', 'sailor', 'raglan'] as const;
export type TopStyleId = typeof TOP_STYLE_IDS[number];
/**
 * Worn over the top. The first four and the cardigan are worn open, so the top shows down the front (the
 * reference's layered look); a cloak sits on the shoulders, a poncho and a puffer close, an apron ties on.
 */
export const OUTER_STYLE_IDS = ['jacket', 'vest', 'overshirt', 'coat', 'cardigan', 'cloak', 'poncho', 'puffer', 'apron'] as const;
export type OuterStyleId = typeof OUTER_STYLE_IDS[number];
export const BOTTOM_STYLE_IDS = ['trousers', 'shorts', 'skirt', 'overalls', 'rolled-trousers', 'cargo-trousers', 'shortalls'] as const;
export type BottomStyleId = typeof BOTTOM_STYLE_IDS[number];
export const NECKWEAR_STYLE_IDS = ['scarf', 'tie', 'bowtie', 'bandana', 'pendant', 'beads', 'cowl', 'ruff'] as const;
export type NeckwearStyleId = typeof NECKWEAR_STYLE_IDS[number];
export const SHOE_STYLE_IDS = ['sneakers', 'boots', 'shoes', 'clogs', 'sandals', 'wellies', 'slippers', 'curly-toes'] as const;
export type ShoeStyleId = typeof SHOE_STYLE_IDS[number];
/** Fey ears (Artstyle: people with fey touches), in the skin or a fey tint. They come out through any hair or hat. */
export const EAR_STYLE_IDS = ['pointed', 'long-fey', 'tufted', 'droopy', 'leaf', 'petite'] as const;
export type EarStyleId = typeof EAR_STYLE_IDS[number];
/** Small festival face paint on the cheeks and round the eyes; never the whole face, never round the mouth. */
export const FACE_PAINT_STYLE_IDS = ['cheek-stripes', 'cheek-star', 'paint-dots', 'heart', 'daisy', 'mask-band'] as const;
export type FacePaintStyleId = typeof FACE_PAINT_STYLE_IDS[number];
/** A toy carried in the person's right hand. Storybook things only: never a real weapon, never a brand. */
export const HELD_STYLE_IDS = [
  'rubber-duck', 'paper-lantern', 'balloon', 'teddy', 'wooden-sword', 'bouquet', 'cider-mug',
  'baguette', 'paper-windmill', 'frog-plush', 'cupcake', 'ice-cream', 'storybook', 'star-wand',
] as const;
export type HeldStyleId = typeof HELD_STYLE_IDS[number];
/**
 * Painted voxel patterns. `stripes` are rows of the accent, `plaid` a buffalo check (the accent where the bands
 * cross, a blend where one passes), `dots` a scatter of accent cells, `print` a block on the chest.
 */
export const PATTERN_IDS = ['plain', 'stripes', 'plaid', 'dots', 'print'] as const;
export type PatternId = typeof PATTERN_IDS[number];

/**
 * Earned pieces (spec B3): never bought, only shown. Each worn piece carries the render data it needs, so a look
 * stays self-contained on every client, plus the id of the record it was earned by, so the look authority can
 * check it. `earned.ts` derives the exact piece each record allows; a worn piece must equal one of them.
 */
/** The month ribbons' marks (Twitch.md §5): a ribbon for each mark reached. */
export const MONTH_MARKS = [1, 3, 6, 9, 12, 18, 24, 36, 48, 60] as const;
export type MonthMark = typeof MONTH_MARKS[number];
/** The Forge's motifs, as in `@chatdom/shared` `FORGE_MOTIFS`. */
export const FORGED_MOTIFS = ['sleeping-dragon', 'crescent-moon', 'watchful-owl', 'sleeping-fox', 'sunflower', 'scallop-shell', 'shooting-star'] as const;
export type ForgedMotif = typeof FORGED_MOTIFS[number];
/** A passport keepsake's crest shape, as in `@chatdom/shared` `PassportCrestSchema`. */
export const CREST_SHAPES = ['heater', 'round', 'swallowtail'] as const;
export type CrestShape = typeof CREST_SHAPES[number];
export const CAPE_KINDS = ['cheer', 'tier-cloak', 'rainbow'] as const;
export type CapeKind = typeof CAPE_KINDS[number];
/** How many pins fit on a chest without crowding it. */
export const MAX_PINS = 2;

/** A pin on the chest: a keepsake in its kingdom's crest, a forged piece's motif, or the founder's pin. */
export type EarnedPin =
  | { readonly kind: 'keepsake'; readonly id: string; readonly shape: CrestShape; readonly colours: readonly [Hex, Hex] }
  | { readonly kind: 'forged'; readonly id: string; readonly motif: ForgedMotif; readonly colours: readonly [Hex, Hex] }
  | { readonly kind: 'founder'; readonly id: string };

export interface EarnedLook {
  /** The month ribbons up to the highest mark worn, a bar on the left breast. Sub tenure. */
  readonly ribbons: { readonly months: MonthMark } | null;
  /** The tenure hood, worn down on the shoulders, in the kingdom's colours. A year of following. */
  readonly hood: { readonly cloth: Hex; readonly trim: Hex } | null;
  readonly pins: readonly EarnedPin[];
  /**
   * A cape: thin cloth from the back socket (the frozen cloth treatment, never voxels). The cheer cape is a
   * moment drop; the tier cloak and the rainbow cape are sub pieces. `id` names the record.
   */
  readonly cape: { readonly kind: CapeKind; readonly id: string; readonly cloth: Hex; readonly lining: Hex; readonly trim: Hex } | null;
  /** The raid scarf, knitted in the two kingdoms' colours: worn instead of neckwear. */
  readonly scarf: { readonly id: string; readonly colours: readonly [Hex, Hex] } | null;
  /** A forged hat, in the forged piece's palette with its motif on the front: worn instead of a hat. */
  readonly forgedHat: { readonly id: string; readonly motif: ForgedMotif; readonly colours: readonly [Hex, Hex] } | null;
}

export const NO_EARNED: EarnedLook = { ribbons: null, hood: null, pins: [], cape: null, scarf: null, forgedHat: null };

/** A dyed garment: its cut, its dye, its pattern and the pattern's second colour. */
export interface Garment<S extends string> {
  readonly style: S;
  readonly dye: Hex;
  readonly pattern: PatternId;
  readonly accent: Hex;
}

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
  readonly top: Garment<TopStyleId>;
  /** Worn open over the top; null for none. */
  readonly outer: Garment<OuterStyleId> | null;
  readonly bottom: Garment<BottomStyleId>;
  /** A scarf's stripes and a bandana's dots use `accent`; a tie's stripes too. */
  readonly neckwear: { readonly style: NeckwearStyleId; readonly dye: Hex; readonly accent: Hex } | null;
  readonly shoes: { readonly style: ShoeStyleId; readonly dye: Hex };
  /** What this person has earned and chose to wear. A look saved before earned pieces existed wears none. */
  readonly earned: EarnedLook;
  /*
   * The parts added with the second wardrobe. They are left out of a look that does not wear them (never
   * written as null), so every look saved before they existed parses to exactly the same recipe and keeps its
   * look token.
   */
  /** Fey ears; `tint` null wears them in the skin. */
  readonly ears?: EarsPart;
  /** Face paint from the paint pot (`FACE_PAINTS`). */
  readonly facePaint?: FacePaintPart;
  /** A toy in the right hand; `colour` dyes its main part (the duck, the balloon, the petals, the cover). */
  readonly held?: HeldPart;
}

export interface EarsPart { readonly style: EarStyleId; readonly tint: Hex | null }
export interface FacePaintPart { readonly style: FacePaintStyleId; readonly colour: Hex }
export interface HeldPart { readonly style: HeldStyleId; readonly colour: Hex }

/** The second wardrobe's parts, which a look leaves out rather than writing as null. */
export const NEW_PARTS = ['ears', 'facePaint', 'held'] as const;

/** What a look saved before the wardrobe existed is wearing below the waist. */
export const DEFAULT_BOTTOM: Garment<BottomStyleId> = { style: 'trousers', dye: '#2f4f86', pattern: 'plain', accent: '#1e1d22' };
export const DEFAULT_SHOES: CitizenLook['shoes'] = { style: 'shoes', dye: '#4a3426' };

/** The accent a garment gets when none was chosen: white on dark cloth, near-black on light. */
export function defaultAccent(dye: Hex): Hex {
  return luma(rgb(dye)) < .45 ? '#f3f1ee' : '#1e1d22';
}

/** The parts a look may leave out. A saved look from before they existed reads as wearing none of them. */
const OPTIONAL_PARTS = ['moustache', 'hat', 'glasses', 'earrings', 'flower', 'outer', 'neckwear'] as const;
/** Parts a look always wears; an older look without them gets the defaults above. */
const WARDROBE_PARTS = ['bottom', 'shoes', 'earned'] as const;

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
/** A second-wardrobe part as a key to spread: absent when not worn. */
const withPart = <K extends typeof NEW_PARTS[number], T>(key: K, value: T | null): { [P in K]?: T } => (value === null ? {} : { [key]: value } as { [P in K]?: T });

/** Validates untrusted input (a saved look, a realm message) into a recipe. Unknown keys are refused. */
export function parseLook(input: unknown): CitizenLook {
  const v = record(input, 'Look', ['version', 'skin', 'eyes', 'freckles', 'blush', 'hair', 'beard', 'top', ...OPTIONAL_PARTS, ...WARDROBE_PARTS, ...NEW_PARTS]);
  if (v.version !== 1) throw new Error('Unsupported look version.');
  const eyes = record(v.eyes, 'Eyes', ['shape', 'spacing']), hair = record(v.hair, 'Hair', ['style', 'colour']);
  if (typeof v.blush !== 'boolean') throw new Error('Blush must be true or false.');
  if (v.beard === undefined) throw new Error('Beard must be a beard or null.');
  const look: CitizenLook = {
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
    top: garment(v.top, 'Top', TOP_STYLE_IDS),
    outer: part(v.outer, o => garment(o, 'Outer layer', OUTER_STYLE_IDS)),
    bottom: v.bottom === undefined ? DEFAULT_BOTTOM : garment(v.bottom, 'Bottom', BOTTOM_STYLE_IDS),
    neckwear: part(v.neckwear, n => {
      const r = record(n, 'Neckwear', ['style', 'dye', 'accent']);
      const dye = colour(r.dye, 'Neckwear dye');
      return { style: oneOf(NECKWEAR_STYLE_IDS, r.style, 'neckwear'), dye, accent: r.accent === undefined ? defaultAccent(dye) : colour(r.accent, 'Neckwear accent') };
    }),
    shoes: v.shoes === undefined ? DEFAULT_SHOES : (() => {
      const r = record(v.shoes, 'Shoes', ['style', 'dye']);
      return { style: oneOf(SHOE_STYLE_IDS, r.style, 'shoes'), dye: colour(r.dye, 'Shoe dye') };
    })(),
    earned: v.earned === undefined ? NO_EARNED : parseEarned(v.earned),
    ...withPart('ears', part(v.ears, e => {
      const r = record(e, 'Ears', ['style', 'tint']);
      return { style: oneOf(EAR_STYLE_IDS, r.style, 'ears'), tint: r.tint === undefined || r.tint === null ? null : colour(r.tint, 'Ear tint') };
    })),
    ...withPart('facePaint', part(v.facePaint, f => {
      const r = record(f, 'Face paint', ['style', 'colour']);
      return { style: oneOf(FACE_PAINT_STYLE_IDS, r.style, 'face paint'), colour: colour(r.colour, 'Face paint colour') };
    })),
    ...withPart('held', part(v.held, h => {
      const r = record(h, 'Held', ['style', 'colour']);
      return { style: oneOf(HELD_STYLE_IDS, r.style, 'held toy'), colour: colour(r.colour, 'Held toy colour') };
    })),
  };
  if (look.hat && look.earned.forgedHat) throw new Error('A look wears a hat or a forged hat, not both.');
  if (look.neckwear && look.earned.scarf) throw new Error('A look wears neckwear or the raid scarf, not both.');
  return look;
}

/** A record id: the same token grammar as `@chatdom/shared` ids. */
const token = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error(`${what} must be a record id.`);
  return value;
};
const pair = (value: unknown, what: string): readonly [Hex, Hex] => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${what} must be two colours.`);
  return [colour(value[0], what), colour(value[1], what)];
};

function parseEarned(input: unknown): EarnedLook {
  const v = record(input, 'Earned', ['ribbons', 'hood', 'pins', 'cape', 'scarf', 'forgedHat']);
  if (v.pins !== undefined && !Array.isArray(v.pins)) throw new Error('Pins must be a list.');
  const pins = ((v.pins ?? []) as unknown[]).map((p): EarnedPin => {
    const kind = record(p, 'Pin', ['kind', 'id', 'shape', 'motif', 'colours']).kind;
    if (kind === 'keepsake') {
      const r = record(p, 'Pin', ['kind', 'id', 'shape', 'colours']);
      return { kind, id: token(r.id, 'Pin id'), shape: oneOf(CREST_SHAPES, r.shape, 'crest shape'), colours: pair(r.colours, 'Pin colours') };
    }
    if (kind === 'forged') {
      const r = record(p, 'Pin', ['kind', 'id', 'motif', 'colours']);
      return { kind, id: token(r.id, 'Pin id'), motif: oneOf(FORGED_MOTIFS, r.motif, 'motif'), colours: pair(r.colours, 'Pin colours') };
    }
    if (kind === 'founder') return { kind, id: token(record(p, 'Pin', ['kind', 'id']).id, 'Pin id') };
    throw new Error(`Unknown pin: ${String(kind)}.`);
  });
  if (pins.length > MAX_PINS) throw new Error(`At most ${MAX_PINS} pins.`);
  if (new Set(pins.map(p => p.id)).size !== pins.length) throw new Error('The same pin twice.');
  return {
    ribbons: part(v.ribbons, r => {
      const months = record(r, 'Ribbons', ['months']).months;
      if (!(MONTH_MARKS as readonly unknown[]).includes(months)) throw new Error(`Unknown month mark: ${String(months)}.`);
      return { months: months as MonthMark };
    }),
    hood: part(v.hood, h => {
      const r = record(h, 'Hood', ['cloth', 'trim']);
      return { cloth: colour(r.cloth, 'Hood cloth'), trim: colour(r.trim, 'Hood trim') };
    }),
    pins,
    cape: part(v.cape, c => {
      const r = record(c, 'Cape', ['kind', 'id', 'cloth', 'lining', 'trim']);
      return { kind: oneOf(CAPE_KINDS, r.kind, 'cape'), id: token(r.id, 'Cape id'), cloth: colour(r.cloth, 'Cape cloth'), lining: colour(r.lining, 'Cape lining'), trim: colour(r.trim, 'Cape trim') };
    }),
    scarf: part(v.scarf, s => {
      const r = record(s, 'Scarf', ['id', 'colours']);
      return { id: token(r.id, 'Scarf id'), colours: pair(r.colours, 'Scarf colours') };
    }),
    forgedHat: part(v.forgedHat, h => {
      const r = record(h, 'Forged hat', ['id', 'motif', 'colours']);
      return { id: token(r.id, 'Forged hat id'), motif: oneOf(FORGED_MOTIFS, r.motif, 'motif'), colours: pair(r.colours, 'Forged hat colours') };
    }),
  };
}

/** A garment; a look saved before patterns existed reads as plain, with the default accent. */
function garment<S extends string>(value: unknown, what: string, styles: readonly S[]): Garment<S> {
  const r = record(value, what, ['style', 'dye', 'pattern', 'accent']);
  const dye = colour(r.dye, `${what} dye`);
  return {
    style: oneOf(styles, r.style, what.toLowerCase()),
    dye,
    pattern: r.pattern === undefined ? 'plain' : oneOf(PATTERN_IDS, r.pattern, 'pattern'),
    accent: r.accent === undefined ? defaultAccent(dye) : colour(r.accent, `${what} accent`),
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
  // The first shelf of earrings, so a seed draws what it always drew; the second shelf comes after.
  const earrings = random() < .14 ? { style: pick(random, ['stud', 'hoop', 'drop'] as const), colour: pick(random, METALS.slice(0, 3)).hex } : null;
  const flower = !beard && random() < .07 ? { colour: pick(random, PETALS).hex } : null;
  return seedSecondWardrobe(seed, {
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
    ...seedClothes(random),
    earned: NO_EARNED,
  });
}

/** The second wardrobe's free base set, as a newcomer may be seeded with it. Funny pieces are chosen, never seeded. */
const SEEDED_HATS = ['beret', 'bucket-hat', 'top-hat', 'flat-cap', 'flower-crown', 'earflap-hat'] as const satisfies readonly HatStyleId[];

/**
 * Newcomers sometimes wear a piece from the second wardrobe's free base set: fey ears on a few, and now and
 * then a newer hat, top, layer, pair of glasses or shoes in place of the one drawn. These draws come from their
 * own stream, so the odds of everything seeded before stay as they were. A seeded look is never one
 * `checkHarmful` refuses: if the draw makes one, the hat comes off.
 */
function seedSecondWardrobe(seed: string, look: CitizenLook): CitizenLook {
  const random = seededRandom(`citizen-look-2:${seed}`);
  let next: CitizenLook = look;
  const earStyle = random() < .07 ? pick(random, EAR_STYLE_IDS) : null;
  if (earStyle) next = { ...next, ears: { style: earStyle, tint: random() < .2 ? pick(random, FEY_TINTS).hex : null } };
  if (next.hat && random() < .35) {
    const style = pick(random, SEEDED_HATS);
    const colour = style === 'flower-crown' ? LEAF_GREEN : style === 'top-hat' ? pick(random, [DYES[14], DYES[15], DYES[10], DYES[1]]).hex : next.hat.colour;
    next = { ...next, hat: { style, colour, trim: style === 'flower-crown' ? pick(random, PETALS).hex : next.hat.trim } };
  }
  if (next.glasses && random() < .2) {
    next = random() < .5 ? { ...next, glasses: { ...next.glasses, style: 'shades', lens: LENS_TINTS[4].hex } } : { ...next, glasses: { ...next.glasses, style: 'half-moon', lens: LENS_TINTS[0].hex } };
  }
  if (next.earrings && random() < .3) next = { ...next, earrings: { ...next.earrings, style: pick(random, ['crescent', 'pearl', 'tassel'] as const) } };
  if (next.top.style !== 'robe' && random() < .12) {
    const style = pick(random, ['turtleneck', 'tunic', 'sailor', 'raglan'] as const);
    next = { ...next, top: { ...next.top, style, pattern: style === 'tunic' || style === 'raglan' ? 'plain' : next.top.pattern === 'stripes' ? 'stripes' : 'plain' } };
  }
  if (next.outer && random() < .25) {
    const style = pick(random, ['cardigan', 'cloak', 'poncho', 'puffer', 'apron'] as const);
    next = { ...next, outer: { ...next.outer, style, pattern: style === 'poncho' && random() < .5 ? 'stripes' : 'plain' } };
  }
  if (next.top.style !== 'robe' && next.top.style !== 'tunic' && random() < .1) {
    next = { ...next, bottom: { ...next.bottom, style: pick(random, ['rolled-trousers', 'cargo-trousers', 'shortalls'] as const), pattern: 'plain' } };
  }
  if (next.neckwear && random() < .3) next = { ...next, neckwear: { ...next.neckwear, style: pick(random, ['pendant', 'beads', 'cowl'] as const) } };
  if (random() < .15) {
    const style = pick(random, ['clogs', 'sandals', 'wellies'] as const);
    next = { ...next, shoes: { style, dye: style === 'wellies' ? pick(random, [DYES[4], DYES[1], DYES[6], DYES[10], DYES[15]]).hex : pick(random, LEATHER).hex } };
  }
  return checkHarmful(next).length ? { ...next, hat: null } : next;
}

/** Two dyes that read as different garments: apart in lightness or clearly apart in hue. */
function distinct(a: Hex, b: Hex): boolean {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.abs(luma(x) - luma(y)) > .16 || Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) > .45;
}
const pickApart = (random: () => number, list: readonly { hex: Hex }[], from: readonly Hex[]): Hex => {
  const options = list.filter(c => from.every(f => distinct(c.hex, f)));
  return pick(random, options.length ? options : list).hex;
};

/**
 * A seeded outfit: a top, often a layer over it (the reference's open jackets and vests), something below,
 * sometimes a scarf or a tie, and shoes. Patterns go where they belong: plaid on shirts and skirts, stripes on
 * tees and sweaters, a loud scatter on an open overshirt. Layers always differ from what they are worn over.
 */
function seedClothes(random: () => number): Pick<CitizenLook, 'top' | 'outer' | 'bottom' | 'neckwear' | 'shoes'> {
  const topStyle = weighted<TopStyleId>(random, [['tee', 5], ['tank', 1.4], ['shirt', 2.6], ['hoodie', 2], ['sweater', 2], ['robe', .5]]);
  const topPatterns: Record<TopStyleId, readonly (readonly [PatternId, number])[]> = {
    tee: [['plain', 6], ['stripes', 1.6], ['print', 1.6], ['dots', .3]],
    tank: [['plain', 4], ['stripes', 1.2]],
    shirt: [['plain', 2], ['plaid', 2.6], ['stripes', .8], ['dots', .8]],
    hoodie: [['plain', 5], ['print', 1.2]],
    sweater: [['plain', 4], ['stripes', 2]],
    robe: [['plain', 1]],
    turtleneck: [['plain', 4], ['stripes', 1.4]],
    tunic: [['plain', 1]],
    sailor: [['plain', 3], ['stripes', 1]],
    raglan: [['plain', 4], ['print', 1]],
  };
  const topDye = pick(random, DYES).hex;
  const topPattern = weighted(random, topPatterns[topStyle]);
  const accentFor = (pattern: PatternId, dye: Hex): Hex =>
    pattern === 'plaid' ? (random() < .6 ? '#1e1d22' : pickApart(random, DYES, [dye]))
      : pattern === 'stripes' && random() < .55 ? defaultAccent(dye) : pickApart(random, DYES, [dye]);
  const top: Garment<TopStyleId> = { style: topStyle, dye: topDye, pattern: topPattern, accent: accentFor(topPattern, topDye) };

  const outerStyle = random() < (topStyle === 'robe' ? .08 : topStyle === 'hoodie' ? .2 : .36)
    ? weighted<OuterStyleId>(random, [['jacket', 3], ['vest', 2.6], ['overshirt', 2], ['coat', 1]]) : null;
  let outer: Garment<OuterStyleId> | null = null;
  if (outerStyle) {
    const dye = pickApart(random, DYES, [topDye]);
    const pattern = outerStyle === 'overshirt' ? weighted<PatternId>(random, [['plain', 1], ['dots', 1.6], ['plaid', 1.4]])
      : outerStyle === 'vest' ? weighted<PatternId>(random, [['plain', 5], ['plaid', 1]]) : 'plain';
    outer = { style: outerStyle, dye, pattern, accent: accentFor(pattern, dye) };
  }

  const bottomStyle = topStyle === 'robe' ? 'trousers' : weighted<BottomStyleId>(random, [['trousers', 5], ['shorts', 2], ['skirt', 2], ['overalls', 1.2]]);
  const bottomDye = random() < .65 ? pickApart(random, BOTTOM_CLOTH, [topDye]) : pickApart(random, DYES, [topDye, outer?.dye ?? topDye]);
  const bottomPattern = bottomStyle === 'skirt' && random() < .3 ? 'plaid' : 'plain';
  const bottom: Garment<BottomStyleId> = { style: bottomStyle, dye: bottomDye, pattern: bottomPattern, accent: accentFor(bottomPattern, bottomDye) };

  const neckStyle = random() < .15
    ? weighted<NeckwearStyleId>(random, [['scarf', 3], ['tie', topStyle === 'shirt' ? 3 : .6], ['bowtie', .8], ['bandana', 1.4]]) : null;
  const neckDye = neckStyle && pickApart(random, DYES, [topDye, outer?.dye ?? topDye]);
  const neckwear = neckStyle && neckDye
    ? { style: neckStyle, dye: neckDye, accent: neckStyle === 'tie' && random() < .5 ? neckDye : pickApart(random, DYES, [neckDye]) } : null;

  const shoeStyle = weighted<ShoeStyleId>(random, [['sneakers', 4], ['boots', 2], ['shoes', 3]]);
  const shoes = { style: shoeStyle, dye: shoeStyle === 'sneakers' ? pick(random, [...DYES, DYES[13], DYES[13]]).hex : pick(random, LEATHER).hex };
  return { top, outer, bottom, neckwear, shoes };
}
