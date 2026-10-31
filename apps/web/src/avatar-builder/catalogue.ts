import {
  BEARD_STYLE_IDS, BOTTOM_CLOTH, BOTTOM_STYLE_IDS, DYES, EARRING_STYLE_IDS, EYE_SHAPES, EYE_SPACINGS, FRECKLES, GLASSES_STYLE_IDS,
  HAIR_STYLE_IDS, HAT_STYLE_IDS, LEATHER, LENS_TINTS, METALS, MOUSTACHE_STYLE_IDS, NATURAL_HAIR, NECKWEAR_STYLE_IDS, OUTER_STYLE_IDS,
  PATTERN_IDS, PETALS, SHOE_STYLE_IDS, SKIN_TONES, STRAW, TOP_STYLE_IDS, WILD_HAIR, colourDistance, defaultAccent,
  type CitizenLook, type Garment, type Hex, type PatternId,
} from '../../../../packages/content/src/avatar-style';

/*
 * What the builder offers, as data: tabs of controls, each a set of tiles (shown as small renders of the actual
 * piece on your own citizen) or colour swatches (with any colour beside them). The page and the panel render
 * the same catalogue, so both builders always offer the same things and make the same look.
 */

export type TileView = 'bust' | 'figure' | 'back' | 'chest' | 'nape' | 'face' | 'lower';

export interface TileOption {
  readonly id: string;
  readonly label: string;
  /** The look with this option chosen. */
  apply(look: CitizenLook): CitizenLook;
  selected(look: CitizenLook): boolean;
}

export interface Swatch { readonly id: string; readonly label: string; readonly hex: Hex }

export type Control =
  | { readonly kind: 'tiles'; readonly id: string; readonly label: string; readonly view: TileView; readonly options: readonly TileOption[]; visible?(look: CitizenLook): boolean }
  | {
    readonly kind: 'swatches'; readonly id: string; readonly label: string; readonly groups: readonly { readonly label: string; readonly swatches: readonly Swatch[] }[];
    get(look: CitizenLook): Hex; set(look: CitizenLook, hex: Hex): CitizenLook; visible?(look: CitizenLook): boolean;
  };

export type TabId = 'face' | 'hair' | 'beard' | 'hat' | 'trinkets' | 'top' | 'layer' | 'below' | 'earned';
export interface Tab { readonly id: TabId; readonly label: string; readonly controls: readonly Control[] }

const words: Record<string, string> = {
  'cap-backwards': 'Cap, backwards', 'straw-hat': 'Straw hat', 'pointed-hat': 'Pointed hat', 'top-knot': 'Top knot', 'side-shave': 'Side shave',
  'side-part': 'Side part', 'short-crop': 'Short crop', 'long-waves': 'Long waves', 'wild-tuft': 'Wild tuft', dot: 'Round', tall: 'Tall',
  closed: 'Content', set: 'Close set', wide: 'Wide set', none: 'None', light: 'A few', full: 'Lots', plain: 'Plain', print: 'Chest print',
};
export const label = (id: string): string => words[id] ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
const swatches = (list: readonly { id: string; hex: Hex }[]): readonly Swatch[] => list.map(s => ({ id: s.id, label: label(s.id), hex: s.hex }));
const tile = (id: string, apply: TileOption['apply'], selected: TileOption['selected'], name = label(id)): TileOption => ({ id, label: name, apply, selected });

/** A dye that reads apart from `against`: the first of a tasteful order that is far enough away. */
function apart(against: readonly Hex[], prefer: readonly Hex[] = ['#223a7a', '#8a5a32', '#1f7a3c', '#d3202a', '#f3f1ee', '#e6b73a']): Hex {
  return prefer.find(p => against.every(a => colourDistance(p, a) > .22)) ?? prefer[0]!;
}

/** Swatch groups for any garment dye: the strong dyes, then cloths. */
const DYE_GROUPS = [{ label: 'Dyes', swatches: swatches(DYES) }];
const CLOTH_GROUPS = [{ label: 'Cloth', swatches: swatches(BOTTOM_CLOTH) }, { label: 'Dyes', swatches: swatches(DYES) }];
const HAIR_GROUPS = [{ label: 'Natural', swatches: swatches(NATURAL_HAIR) }, { label: 'Dyed', swatches: swatches(WILD_HAIR) }];

/** Pattern tiles for a garment the look may or may not wear. */
function patternTiles<K extends 'top' | 'outer' | 'bottom'>(key: K): readonly TileOption[] {
  return PATTERN_IDS.map(pattern => tile(pattern, look => {
    const g = look[key] as Garment<string> | null;
    if (!g) return look;
    // A pattern needs a second colour that shows on the dye.
    const accent = pattern !== 'plain' && colourDistance(g.accent, g.dye) < .18 ? defaultAccent(g.dye) : g.accent;
    return { ...look, [key]: { ...g, pattern: pattern as PatternId, accent } };
  }, look => (look[key] as Garment<string> | null)?.pattern === pattern));
}

export const TABS: readonly Tab[] = [
  {
    id: 'face', label: 'Face', controls: [
      {
        kind: 'swatches', id: 'skin', label: 'Skin', groups: [{ label: 'Skin', swatches: swatches(SKIN_TONES) }],
        get: l => l.skin, set: (l, skin) => ({ ...l, skin }),
      },
      { kind: 'tiles', id: 'eyes', label: 'Eyes', view: 'face', options: EYE_SHAPES.map(shape => tile(shape, l => ({ ...l, eyes: { ...l.eyes, shape } }), l => l.eyes.shape === shape)) },
      { kind: 'tiles', id: 'spacing', label: 'Eye spacing', view: 'face', options: EYE_SPACINGS.map(spacing => tile(spacing, l => ({ ...l, eyes: { ...l.eyes, spacing } }), l => l.eyes.spacing === spacing)) },
      { kind: 'tiles', id: 'freckles', label: 'Freckles', view: 'face', options: FRECKLES.map(f => tile(f, l => ({ ...l, freckles: f }), l => l.freckles === f)) },
      { kind: 'tiles', id: 'blush', label: 'Blush', view: 'face', options: [tile('no-blush', l => ({ ...l, blush: false }), l => !l.blush, 'None'), tile('blush', l => ({ ...l, blush: true }), l => l.blush, 'Rosy')] },
    ],
  },
  {
    id: 'hair', label: 'Hair', controls: [
      { kind: 'tiles', id: 'hair', label: 'Style', view: 'bust', options: HAIR_STYLE_IDS.map(style => tile(style, l => ({ ...l, hair: { ...l.hair, style } }), l => l.hair.style === style)) },
      { kind: 'swatches', id: 'hair-colour', label: 'Colour', groups: HAIR_GROUPS, get: l => l.hair.colour, set: (l, colour) => ({ ...l, hair: { ...l.hair, colour } }) },
    ],
  },
  {
    id: 'beard', label: 'Beard', controls: [
      {
        kind: 'tiles', id: 'beard', label: 'Beard', view: 'bust', options: [
          tile('none', l => ({ ...l, beard: null }), l => !l.beard),
          ...BEARD_STYLE_IDS.map(style => tile(style, l => ({ ...l, beard: { style, colour: l.beard?.colour ?? l.hair.colour } }), l => l.beard?.style === style)),
        ],
      },
      {
        kind: 'swatches', id: 'beard-colour', label: 'Beard colour', groups: HAIR_GROUPS, visible: l => !!l.beard,
        get: l => l.beard?.colour ?? l.hair.colour, set: (l, colour) => (l.beard ? { ...l, beard: { ...l.beard, colour } } : l),
      },
      {
        kind: 'tiles', id: 'moustache', label: 'Moustache', view: 'bust', options: [
          tile('none', l => ({ ...l, moustache: null }), l => !l.moustache),
          ...MOUSTACHE_STYLE_IDS.map(style => tile(style, l => ({ ...l, moustache: { style, colour: l.moustache?.colour ?? l.beard?.colour ?? l.hair.colour } }), l => l.moustache?.style === style)),
        ],
      },
      {
        kind: 'swatches', id: 'moustache-colour', label: 'Moustache colour', groups: HAIR_GROUPS, visible: l => !!l.moustache,
        get: l => l.moustache?.colour ?? l.hair.colour, set: (l, colour) => (l.moustache ? { ...l, moustache: { ...l.moustache, colour } } : l),
      },
    ],
  },
  {
    id: 'hat', label: 'Hat', controls: [
      {
        kind: 'tiles', id: 'hat', label: 'Hat', view: 'bust', options: [
          tile('none', l => ({ ...l, hat: null, earned: { ...l.earned, forgedHat: null } }), l => !l.hat && !l.earned.forgedHat),
          ...HAT_STYLE_IDS.map(style => tile(style, l => {
            const was = l.hat;
            const straw = style === 'straw-hat';
            const colour = was && (was.style === 'straw-hat') === straw ? was.colour : straw ? STRAW[1].hex : '#2d5fd8';
            return { ...l, hat: { style, colour, trim: was?.trim ?? '#d3202a' }, earned: { ...l.earned, forgedHat: null } };
          }, l => l.hat?.style === style)),
        ],
      },
      {
        kind: 'swatches', id: 'hat-colour', label: 'Crown', visible: l => !!l.hat,
        groups: [{ label: 'Straw', swatches: swatches(STRAW) }, ...DYE_GROUPS], get: l => l.hat?.colour ?? '#2d5fd8', set: (l, colour) => (l.hat ? { ...l, hat: { ...l.hat, colour } } : l),
      },
      {
        kind: 'swatches', id: 'hat-trim', label: 'Band, bill and trim', visible: l => !!l.hat,
        groups: DYE_GROUPS, get: l => l.hat?.trim ?? '#d3202a', set: (l, trim) => (l.hat ? { ...l, hat: { ...l.hat, trim } } : l),
      },
    ],
  },
  {
    id: 'trinkets', label: 'Trinkets', controls: [
      {
        kind: 'tiles', id: 'glasses', label: 'Glasses', view: 'face', options: [
          tile('none', l => ({ ...l, glasses: null }), l => !l.glasses),
          ...GLASSES_STYLE_IDS.map(style => tile(style, l => ({
            ...l, glasses: { style, colour: l.glasses?.colour ?? METALS[4].hex, lens: l.glasses?.lens ?? (style === 'goggles' ? LENS_TINTS[2].hex : LENS_TINTS[0].hex) },
          }), l => l.glasses?.style === style)),
        ],
      },
      {
        kind: 'swatches', id: 'frame', label: 'Frames', visible: l => !!l.glasses, groups: [{ label: 'Metals', swatches: swatches(METALS) }, ...DYE_GROUPS],
        get: l => l.glasses?.colour ?? METALS[4].hex, set: (l, colour) => (l.glasses ? { ...l, glasses: { ...l.glasses, colour } } : l),
      },
      {
        kind: 'swatches', id: 'lens', label: 'Lenses', visible: l => !!l.glasses, groups: [{ label: 'Tints', swatches: swatches(LENS_TINTS) }],
        get: l => l.glasses?.lens ?? LENS_TINTS[0].hex, set: (l, lens) => (l.glasses ? { ...l, glasses: { ...l.glasses, lens } } : l),
      },
      {
        kind: 'tiles', id: 'earrings', label: 'Earrings', view: 'face', options: [
          tile('none', l => ({ ...l, earrings: null }), l => !l.earrings),
          ...EARRING_STYLE_IDS.map(style => tile(style, l => ({ ...l, earrings: { style, colour: l.earrings?.colour ?? METALS[0].hex } }), l => l.earrings?.style === style)),
        ],
      },
      {
        kind: 'swatches', id: 'earring-colour', label: 'Earring metal', visible: l => !!l.earrings, groups: [{ label: 'Metals', swatches: swatches(METALS) }],
        get: l => l.earrings?.colour ?? METALS[0].hex, set: (l, colour) => (l.earrings ? { ...l, earrings: { ...l.earrings, colour } } : l),
      },
      {
        kind: 'tiles', id: 'flower', label: 'Flower', view: 'bust', options: [
          tile('none', l => ({ ...l, flower: null }), l => !l.flower),
          tile('flower', l => ({ ...l, flower: { colour: l.flower?.colour ?? PETALS[0].hex } }), l => !!l.flower, 'Over the ear'),
        ],
      },
      {
        kind: 'swatches', id: 'petal', label: 'Petals', visible: l => !!l.flower, groups: [{ label: 'Petals', swatches: swatches(PETALS) }],
        get: l => l.flower?.colour ?? PETALS[0].hex, set: (l, colour) => ({ ...l, flower: { colour } }),
      },
    ],
  },
  {
    id: 'top', label: 'Top', controls: [
      { kind: 'tiles', id: 'top', label: 'Top', view: 'bust', options: TOP_STYLE_IDS.map(style => tile(style, l => ({ ...l, top: { ...l.top, style } }), l => l.top.style === style)) },
      { kind: 'swatches', id: 'top-dye', label: 'Dye', groups: DYE_GROUPS, get: l => l.top.dye, set: (l, dye) => ({ ...l, top: { ...l.top, dye } }) },
      { kind: 'tiles', id: 'top-pattern', label: 'Pattern', view: 'bust', options: patternTiles('top') },
      {
        kind: 'swatches', id: 'top-accent', label: 'Pattern colour', groups: DYE_GROUPS, visible: l => l.top.pattern !== 'plain',
        get: l => l.top.accent, set: (l, accent) => ({ ...l, top: { ...l.top, accent } }),
      },
    ],
  },
  {
    id: 'layer', label: 'Layer', controls: [
      {
        kind: 'tiles', id: 'outer', label: 'Worn open over the top', view: 'bust', options: [
          tile('none', l => ({ ...l, outer: null }), l => !l.outer),
          ...OUTER_STYLE_IDS.map(style => tile(style, l => {
            const dye = l.outer?.dye ?? apart([l.top.dye]);
            return { ...l, outer: { style, dye, pattern: l.outer?.pattern ?? 'plain', accent: l.outer?.accent ?? defaultAccent(dye) } };
          }, l => l.outer?.style === style)),
        ],
      },
      {
        kind: 'swatches', id: 'outer-dye', label: 'Dye', groups: DYE_GROUPS, visible: l => !!l.outer,
        get: l => l.outer?.dye ?? l.top.dye, set: (l, dye) => (l.outer ? { ...l, outer: { ...l.outer, dye } } : l),
      },
      { kind: 'tiles', id: 'outer-pattern', label: 'Pattern', view: 'bust', options: patternTiles('outer'), visible: l => !!l.outer },
      {
        kind: 'swatches', id: 'outer-accent', label: 'Pattern colour', groups: DYE_GROUPS, visible: l => !!l.outer && l.outer.pattern !== 'plain',
        get: l => l.outer?.accent ?? l.top.accent, set: (l, accent) => (l.outer ? { ...l, outer: { ...l.outer, accent } } : l),
      },
      {
        kind: 'tiles', id: 'neckwear', label: 'Neckwear', view: 'bust', options: [
          tile('none', l => ({ ...l, neckwear: null }), l => !l.neckwear),
          ...NECKWEAR_STYLE_IDS.map(style => tile(style, l => {
            const dye = l.neckwear?.dye ?? apart([l.top.dye, l.outer?.dye ?? l.top.dye], ['#d3202a', '#f6d23c', '#223a7a', '#1f7a3c', '#f3f1ee']);
            return { ...l, neckwear: { style, dye, accent: l.neckwear?.accent ?? defaultAccent(dye) }, earned: { ...l.earned, scarf: null } };
          }, l => l.neckwear?.style === style)),
        ],
      },
      {
        kind: 'swatches', id: 'neck-dye', label: 'Neckwear dye', groups: DYE_GROUPS, visible: l => !!l.neckwear,
        get: l => l.neckwear?.dye ?? l.top.dye, set: (l, dye) => (l.neckwear ? { ...l, neckwear: { ...l.neckwear, dye } } : l),
      },
      {
        kind: 'swatches', id: 'neck-accent', label: 'Stripes and dots', groups: DYE_GROUPS, visible: l => !!l.neckwear && l.neckwear.style !== 'bowtie',
        get: l => l.neckwear?.accent ?? l.top.accent, set: (l, accent) => (l.neckwear ? { ...l, neckwear: { ...l.neckwear, accent } } : l),
      },
    ],
  },
  {
    id: 'below', label: 'Below', controls: [
      { kind: 'tiles', id: 'bottom', label: 'Bottoms', view: 'lower', options: BOTTOM_STYLE_IDS.map(style => tile(style, l => ({ ...l, bottom: { ...l.bottom, style } }), l => l.bottom.style === style)) },
      { kind: 'swatches', id: 'bottom-dye', label: 'Cloth', groups: CLOTH_GROUPS, get: l => l.bottom.dye, set: (l, dye) => ({ ...l, bottom: { ...l.bottom, dye } }) },
      { kind: 'tiles', id: 'bottom-pattern', label: 'Pattern', view: 'lower', options: patternTiles('bottom').filter(o => o.id === 'plain' || o.id === 'plaid' || o.id === 'stripes') },
      {
        kind: 'swatches', id: 'bottom-accent', label: 'Pattern colour', groups: DYE_GROUPS, visible: l => l.bottom.pattern !== 'plain',
        get: l => l.bottom.accent, set: (l, accent) => ({ ...l, bottom: { ...l.bottom, accent } }),
      },
      { kind: 'tiles', id: 'shoes', label: 'Shoes', view: 'lower', options: SHOE_STYLE_IDS.map(style => tile(style, l => ({ ...l, shoes: { ...l.shoes, style } }), l => l.shoes.style === style)) },
      {
        kind: 'swatches', id: 'shoe-dye', label: 'Shoe colour', groups: [{ label: 'Leather', swatches: swatches(LEATHER) }, ...DYE_GROUPS],
        get: l => l.shoes.dye, set: (l, dye) => ({ ...l, shoes: { ...l.shoes, dye } }),
      },
    ],
  },
  { id: 'earned', label: 'Earned', controls: [] },
];

export const tab = (id: TabId): Tab => TABS.find(t => t.id === id)!;
