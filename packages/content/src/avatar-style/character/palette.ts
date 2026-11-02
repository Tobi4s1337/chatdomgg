import type { Hex } from './colour';

/**
 * Skin tones, lightest to deepest. Twenty human tones with warm, neutral and cool undertones at every depth,
 * so nobody has to settle for "close enough". The deepest swatch stops where one-cell eyes still read
 * against it in the portrait light. A recipe may also carry any other `#rrggbb` skin; these are the
 * builder's swatches and what the seeded default picks from.
 */
export const SKIN_TONES = [
  { id: 'porcelain', hex: '#fbe4d8' }, { id: 'shell', hex: '#f8dcc8' }, { id: 'peach', hex: '#f4cfae' },
  { id: 'rose', hex: '#f0c2ac' }, { id: 'cream', hex: '#efd2a4' }, { id: 'sand', hex: '#e8c08f' },
  { id: 'apricot', hex: '#e5b48e' }, { id: 'honey', hex: '#dba875' }, { id: 'olive', hex: '#c9a477' },
  { id: 'golden', hex: '#cc9862' }, { id: 'clay', hex: '#c08a6a' }, { id: 'caramel', hex: '#b57d4c' },
  { id: 'amber', hex: '#a76d42' }, { id: 'tawny', hex: '#9a6648' }, { id: 'cinnamon', hex: '#8b5434' },
  { id: 'chestnut', hex: '#7c4a2e' }, { id: 'mocha', hex: '#6e402a' }, { id: 'umber', hex: '#623925' },
  { id: 'ebony', hex: '#563221' }, { id: 'midnight', hex: '#4a2b1e' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Natural hair, from black to white. */
export const NATURAL_HAIR = [
  { id: 'black', hex: '#1c191c' }, { id: 'soft-black', hex: '#2a2224' }, { id: 'espresso', hex: '#3a2519' },
  { id: 'brown', hex: '#5a3622' }, { id: 'chestnut', hex: '#7b4322' }, { id: 'auburn', hex: '#8e3318' },
  { id: 'copper', hex: '#e0561f' }, { id: 'ginger', hex: '#d98a2e' }, { id: 'honey', hex: '#c99a4c' },
  { id: 'blond', hex: '#ebc964' }, { id: 'platinum', hex: '#f0e6c8' }, { id: 'ash', hex: '#9b8f82' },
  { id: 'grey', hex: '#8e8c8a' }, { id: 'white', hex: '#f2f0ec' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Dyed hair. Any `#rrggbb` is allowed; these are the swatches. */
export const WILD_HAIR = [
  { id: 'violet', hex: '#8b3df2' }, { id: 'ice', hex: '#a8d4e8' }, { id: 'bubblegum', hex: '#f27db4' },
  { id: 'teal', hex: '#22b2a4' }, { id: 'lime', hex: '#7ccf3e' }, { id: 'cherry', hex: '#d0252f' },
  { id: 'cobalt', hex: '#3559e6' }, { id: 'lilac', hex: '#c6a2f4' }, { id: 'sunshine', hex: '#ffd23a' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Strong, clean garment dyes (spec L5: strong colours, no muddy palettes). */
export const DYES = [
  { id: 'tomato', hex: '#ef4b2c' }, { id: 'red', hex: '#d3202a' }, { id: 'orange', hex: '#f58a1f' },
  { id: 'mustard', hex: '#e6b73a' }, { id: 'yellow', hex: '#f6d23c' }, { id: 'leaf', hex: '#3fae4a' },
  { id: 'forest', hex: '#1f7a3c' }, { id: 'teal', hex: '#1ea59a' }, { id: 'sky', hex: '#43b6ec' },
  { id: 'cobalt', hex: '#2d5fd8' }, { id: 'navy', hex: '#223a7a' }, { id: 'purple', hex: '#8a3fe6' },
  { id: 'pink', hex: '#ef6fae' }, { id: 'white', hex: '#f3f1ee' }, { id: 'charcoal', hex: '#3a3a40' },
  { id: 'black', hex: '#1e1d22' }, { id: 'grey', hex: '#8d8e94' }, { id: 'sand', hex: '#d9c49b' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** The eye blocks: near-black, never pure black, so the bevel still catches light. */
export const EYE_INK: Hex = '#221d24';
/** On deep skin the eyes go darker still, so they read at 128 px on every tone. */
export const EYE_INK_DEEP: Hex = '#0e0b10';
/** Blush pink, mixed into the skin rather than painted over it, so it reads on every tone. */
export const BLUSH_PINK: Hex = '#ff5d7a';
/** Freckles: the skin taken toward a warm dark brown. */
export const FRECKLE_BROWN: Hex = '#5a2a18';

/** Straw and felt for the straw hat, light to dark. Any `#rrggbb` is allowed. */
export const STRAW = [
  { id: 'wheat', hex: '#f1dfb0' }, { id: 'raffia', hex: '#e6cc8e' }, { id: 'toast', hex: '#cfa766' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Metals and frames: earrings, glasses frames, goggle rims. */
export const METALS = [
  { id: 'gold', hex: '#e8b54a' }, { id: 'silver', hex: '#c9cdd4' }, { id: 'rose-gold', hex: '#e1a088' },
  { id: 'gunmetal', hex: '#55565e' }, { id: 'black', hex: '#1f1d22' }, { id: 'tortoise', hex: '#7a4a26' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Lens tints. Lenses are glass: the eyes show through them. */
export const LENS_TINTS = [
  { id: 'clear', hex: '#e9f2ff' }, { id: 'rose', hex: '#ffb7c4' }, { id: 'amber', hex: '#ffcf73' },
  { id: 'sea', hex: '#8fe0d6' }, { id: 'smoke', hex: '#3b3546' }, { id: 'violet', hex: '#b48cff' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Flower petals. The heart is always a warm yellow, the leaf a fresh green. */
export const PETALS = [
  { id: 'poppy', hex: '#ff4d4d' }, { id: 'daisy', hex: '#fbfaf5' }, { id: 'rose', hex: '#ff6fa8' },
  { id: 'marigold', hex: '#ffa526' }, { id: 'violet', hex: '#9f6bff' }, { id: 'cornflower', hex: '#5f8dff' },
] as const satisfies readonly { id: string; hex: Hex }[];
export const FLOWER_HEART: Hex = '#ffd23a';
export const LEAF_GREEN: Hex = '#3fae4a';

/** Cloth for trousers, shorts, skirts and overalls besides the garment dyes: denims, drill and cord. */
export const BOTTOM_CLOTH = [
  { id: 'indigo', hex: '#2f4f86' }, { id: 'stonewash', hex: '#6d8fc4' }, { id: 'raw-denim', hex: '#1f2f55' },
  { id: 'khaki', hex: '#c2a774' }, { id: 'olive', hex: '#5f6b3a' }, { id: 'cord', hex: '#8a5a32' }, { id: 'slate', hex: '#4a4d58' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Leathers for boots and shoes. */
export const LEATHER = [
  { id: 'tan', hex: '#a8693a' }, { id: 'brown', hex: '#5e3a22' }, { id: 'oxblood', hex: '#6a2228' }, { id: 'black', hex: '#24211f' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Buttons and buckles: brass reads on every cloth. */
export const BRASS: Hex = '#d9a441';

/**
 * The paint pot for face paint: bright festival colours only. None is dark, white or near any human skin tone,
 * so paint never reads as a different skin (Safety §3.1); `checkHarmful` refuses any other colour.
 */
export const FACE_PAINTS = [
  { id: 'sunshine', hex: '#ffd23a' }, { id: 'poppy', hex: '#e8333f' },
  { id: 'rose', hex: '#ff6fae' }, { id: 'violet', hex: '#a36bff' }, { id: 'sky', hex: '#4cc3f0' },
  { id: 'teal', hex: '#1fb5a6' }, { id: 'leaf', hex: '#5cc94a' }, { id: 'cobalt', hex: '#3d63ea' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** Fey tints for ears that do not take the skin: clearly not a human tone. Any `#rrggbb` is allowed. */
export const FEY_TINTS = [
  { id: 'moss', hex: '#9cc27a' }, { id: 'lilac', hex: '#c9a8f0' }, { id: 'frost', hex: '#bfe3f2' },
  { id: 'dusk', hex: '#8f7ad8' }, { id: 'blossom', hex: '#f2a7c3' }, { id: 'seafoam', hex: '#8fd9c4' },
] as const satisfies readonly { id: string; hex: Hex }[];

/** The white of a hat's eyes, spots and pompoms. */
export const HAT_WHITE: Hex = '#f6f2e8';
