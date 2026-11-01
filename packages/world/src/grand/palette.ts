/**
 * The grand land's material table: one byte per voxel, 255 materials. IDs are fixed so generation,
 * meshing and shading agree; colours are per kingdom (stone family, grass season, leaf tints), so two
 * lands share a grammar but never a look. Every colour is a ramp: shades lean blue-violet in shadow and
 * warm yellow in light, after Artstyle §6.3.
 */
export const GrandKind = {
  air: 0, grass: 1, earth: 2, sand: 3, rock: 4, snow: 5, leaf: 6, bark: 7, crop: 8, water: 9, glow: 10, flower: 11, ice: 12,
  stone: 13, plaster: 14, roof: 15, wood: 16, metal: 17, fabric: 18, glass: 19,
} as const;
export type GrandKindId = typeof GrandKind[keyof typeof GrandKind];

export const M = {
  air: 0,
  grass: [1, 2, 3, 4] as const,
  meadow: [5, 6] as const,
  forestFloor: 7,
  dirt: 8, dirtDark: 9, path: 10,
  sand: 11, sandWet: 12, shingle: 13,
  /** Sixteen strata bands, indexed by height plus a slow warp. */
  strata: 14,
  scree: 30, cliffDark: 31,
  snow: 32, snowShade: 33, ice: 34,
  riverbed: 35, water: 36,
  /** Sea fill: occupies cells under the sea plane so nothing beneath it is meshed; never drawn itself. */
  sea: 37,
  bark: { oak: 40, birch: 41, pine: 42, cherry: 43, teal: 44, willow: 45, dead: 46, root: 47 } as const,
  leaf: {
    oak: 48, lime: 52, gold: 56, red: 60, pine: 64, cherry: 68, teal: 72, willow: 76, birch: 80, hedge: 84,
  } as const,
  accent: { orange: 88, blossom: 89, berry: 90, lilac: 91, gold: 92, moss: 93 } as const,
  crop: {
    wheat: 96, wheatPale: 97, barley: 98, lavender: 99, lavenderDark: 100, rapeseed: 101, cabbage: 102,
    ploughed: 103, furrow: 104, sunflower: 105, sunflowerHead: 106, pumpkin: 107, hay: 108, flax: 109,
  } as const,
  flower: { poppy: 112, buttercup: 113, daisy: 114, cornflower: 115, violet: 116, pink: 117, marigold: 118 } as const,
  glow: { lava: 120, lavaCrust: 121, crystalTeal: 122, crystalPink: 123, lantern: 124, window: 125 } as const,
  /** 128..255 are reserved for the kingdom on the land (GK11): stone, plaster, roofs, timber and crest colours. */
  structureBase: 128,
} as const;

/** Leaf families have four shades: deep shadow, body, light body, sunlit crown. */
export const LEAF_SHADES = 4;
export const STRATA_COUNT = 16;

export type StoneFamily = 'sandstone' | 'granite' | 'slate' | 'chalk';
export type GrassSeason = 'spring' | 'summer' | 'highland' | 'late';

export interface GrandPaletteStyle {
  readonly stone: StoneFamily;
  readonly grass: GrassSeason;
  /** -1..1: small hue drift applied to grass and leaves, so neighbouring lands of one family still differ. */
  readonly hueDrift: number;
  /** 0..1: how gold the autumn groves run. */
  readonly autumn: number;
}

export interface GrandMaterial { readonly id: number; readonly colour: string; readonly kind: GrandKindId }

const STRATA: Record<StoneFamily, readonly string[]> = {
  // Warm banded browns and buff, the cliffs of a storybook range.
  sandstone: ['#8a7058', '#9c8066', '#7a604c', '#a88e72', '#b49a7c', '#8f765e', '#6f5848', '#a08468', '#c0a684', '#94785e', '#7f6652', '#b09274', '#9a7c62', '#86705c', '#a6886c', '#bca080'],
  granite: ['#7d7c82', '#8c8a8e', '#6e6e76', '#9a9692', '#a6a29c', '#807e86', '#6a6870', '#948f8a', '#b0aaa2', '#85838a', '#77767e', '#a09a94', '#8a8786', '#73737b', '#9b9690', '#aca69e'],
  slate: ['#5e6472', '#6b707e', '#555a68', '#767a86', '#80838c', '#626877', '#4e5362', '#71757f', '#8a8c93', '#666b79', '#5a5f6d', '#7c7f89', '#6a6e7a', '#585d6b', '#757984', '#868991'],
  chalk: ['#b8b0a0', '#c6beac', '#aaa292', '#d0c8b6', '#d8d0bc', '#bdb5a4', '#a39b8c', '#cbc3b0', '#e0d8c4', '#b2aa9a', '#a8a090', '#d2cab8', '#c0b8a6', '#aea696', '#ccc4b2', '#dcd4c0'],
};

const GRASS: Record<GrassSeason, readonly [string, string, string, string, string, string, string]> = {
  // grass ×4, meadow ×2, forest floor
  spring: ['#6aa046', '#7cb24e', '#8cbc58', '#5a8e3e', '#9cc45e', '#b0c862', '#4e6e36'],
  summer: ['#74a042', '#86ac48', '#9ab452', '#628c3a', '#a8bc56', '#c0c25c', '#55703a'],
  highland: ['#5f9248', '#6e9e4e', '#82aa58', '#507e40', '#8eb05e', '#a2b868', '#466638'],
  late: ['#80a044', '#94aa4a', '#aab454', '#6c8c3c', '#b8b656', '#ccbc5a', '#5c6e38'],
};

const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
function parse(colour: string): [number, number, number] {
  const v = Number.parseInt(colour.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
/** Hue shift in degrees, plus value scale; enough for authored drifts, not a colour science. */
export function shiftColour(colour: string, degrees: number, value = 1, saturation = 1): string {
  const [r, g, b] = parse(colour).map(c => c / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-6) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + degrees + 360) % 360;
  const l = (max + min) / 2, s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const s2 = Math.min(1, s * saturation), l2 = Math.min(1, l * value);
  const c = (1 - Math.abs(2 * l2 - 1)) * s2, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l2 - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${hex((r1 + m) * 255)}${hex((g1 + m) * 255)}${hex((b1 + m) * 255)}`;
}

/** A four-step ramp from one body colour: shadow leans cool, crown leans warm. */
function ramp(body: string): [string, string, string, string] {
  return [shiftColour(body, 14, 0.74, 1.05), body, shiftColour(body, -6, 1.12, 1.02), shiftColour(body, -14, 1.26, 0.96)];
}

export function grandPalette(style: GrandPaletteStyle): GrandMaterial[] {
  const out: GrandMaterial[] = [];
  const put = (id: number, colour: string, kind: GrandKindId) => { out.push({ id, colour, kind }); };
  const drift = style.hueDrift * 9;
  const g = GRASS[style.grass].map(c => shiftColour(c, drift));
  M.grass.forEach((id, i) => put(id, g[i]!, GrandKind.grass));
  M.meadow.forEach((id, i) => put(id, g[4 + i]!, GrandKind.grass));
  put(M.forestFloor, g[6]!, GrandKind.grass);
  put(M.dirt, '#8a6a4c', GrandKind.earth); put(M.dirtDark, '#6c523c', GrandKind.earth); put(M.path, '#a08462', GrandKind.earth);
  put(M.sand, '#e6d3a2', GrandKind.sand); put(M.sandWet, '#c8b488', GrandKind.sand); put(M.shingle, '#a8a294', GrandKind.sand);
  STRATA[style.stone].forEach((c, i) => put(M.strata + i, c, GrandKind.rock));
  const rockMid = STRATA[style.stone][3]!;
  put(M.scree, shiftColour(rockMid, 0, 0.92), GrandKind.rock); put(M.cliffDark, shiftColour(rockMid, 10, 0.68), GrandKind.rock);
  put(M.snow, '#f4f6fa', GrandKind.snow); put(M.snowShade, '#dfe6f0', GrandKind.snow); put(M.ice, '#bfe0ee', GrandKind.ice);
  put(M.riverbed, '#7c7464', GrandKind.earth); put(M.water, '#3f8fa6', GrandKind.water); put(M.sea, '#2c6e8a', GrandKind.water);
  const bark: Record<keyof typeof M.bark, string> = { oak: '#5e4330', birch: '#e4ddd0', pine: '#5a3e2c', cherry: '#5a3a36', teal: '#4c4458', willow: '#6a5a42', dead: '#7a6a5a', root: '#4e3828' };
  for (const key of Object.keys(M.bark) as (keyof typeof M.bark)[]) put(M.bark[key], bark[key], GrandKind.bark);
  const autumnGold = shiftColour('#e8b41c', -6 * style.autumn), autumnRed = shiftColour('#d8642a', -4 * style.autumn);
  const leaf: Record<keyof typeof M.leaf, string> = {
    oak: shiftColour('#4e8a32', drift), lime: shiftColour('#7cb63a', drift), gold: autumnGold, red: autumnRed,
    pine: shiftColour('#2e5e3e', drift * 0.5), cherry: '#f0a0bc', teal: '#2fa59a', willow: shiftColour('#8cae42', drift),
    birch: shiftColour('#92c04c', drift), hedge: shiftColour('#44782e', drift),
  };
  for (const key of Object.keys(M.leaf) as (keyof typeof M.leaf)[]) ramp(leaf[key]).forEach((c, i) => put(M.leaf[key] + i, c, GrandKind.leaf));
  put(M.accent.orange, '#f08a24', GrandKind.leaf); put(M.accent.blossom, '#fbe8ee', GrandKind.leaf);
  put(M.accent.berry, '#c0303a', GrandKind.leaf); put(M.accent.lilac, '#b89ae0', GrandKind.leaf);
  put(M.accent.gold, '#ffd24a', GrandKind.leaf); put(M.accent.moss, '#6e8a3a', GrandKind.leaf);
  const crop: Record<keyof typeof M.crop, string> = {
    wheat: '#e2bc52', wheatPale: '#ecd27a', barley: '#d4c068', lavender: '#9a7cd0', lavenderDark: '#7a5cb0', rapeseed: '#f2d43a',
    cabbage: '#6ea050', ploughed: '#7c5c42', furrow: '#5e4432', sunflower: '#5c7a30', sunflowerHead: '#f6c21e', pumpkin: '#e88a2a',
    hay: '#d8be78', flax: '#8aa8e0',
  };
  for (const key of Object.keys(M.crop) as (keyof typeof M.crop)[]) put(M.crop[key], crop[key], GrandKind.crop);
  const flower: Record<keyof typeof M.flower, string> = { poppy: '#e0402e', buttercup: '#f6d23a', daisy: '#f6f2e6', cornflower: '#5a86e0', violet: '#9a62d0', pink: '#f08ab4', marigold: '#f4962a' };
  for (const key of Object.keys(M.flower) as (keyof typeof M.flower)[]) put(M.flower[key], flower[key], GrandKind.flower);
  const glow: Record<keyof typeof M.glow, string> = { lava: '#ff7a1c', lavaCrust: '#5a2c22', crystalTeal: '#5ef0e0', crystalPink: '#f6a0ff', lantern: '#ffc070', window: '#ffb45c' };
  for (const key of Object.keys(M.glow) as (keyof typeof M.glow)[]) put(M.glow[key], glow[key], key === 'lavaCrust' ? GrandKind.rock : GrandKind.glow);
  return out.sort((a, b) => a.id - b.id);
}

/** RGBA float table (256 entries): rgb in linear-ready sRGB 0..1, alpha carries the kind. */
export function paletteTable(materials: readonly GrandMaterial[]): Float32Array {
  const table = new Float32Array(256 * 4);
  for (const m of materials) {
    const [r, g, b] = parse(m.colour);
    table.set([r / 255, g / 255, b / 255, m.kind], m.id * 4);
  }
  return table;
}

/** Kind per id, for the mesher and the voxeliser (0 is air). */
export function kindTable(materials: readonly GrandMaterial[]): Uint8Array {
  const kinds = new Uint8Array(256);
  for (const m of materials) kinds[m.id] = m.kind;
  return kinds;
}
