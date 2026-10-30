/**
 * The Atlas palette: parchment, sepia ink and soft watercolour. The day map never darkens; vermilion is reserved
 * for live presence and appears nowhere in the land, the sea or the heraldry.
 */
export const PAPER = '#efe4c8';
export const PAPER_DEEP = '#e2d3ae';
export const INK = '#3b2f25';
export const INK_SOFT = 'rgba(59, 47, 37, 0.62)';
export const SEA = '#dcd8c0';
export const SEA_WASH = '#94b2ab';
export const LAND = '#f1e7cb';
export const GRAPHITE = '#5f5a52';

/** Watercolour tints for language lands, chosen so neighbouring continents part clearly without shouting. */
export const REGION_TINTS = [
  '#c4cf9a', // sage
  '#dcc08e', // ochre
  '#c9b3c8', // heather
  '#a9c6b9', // celadon
  '#dcb79f', // apricot clay
  '#c8cf86', // pistachio
  '#b9bfd6', // slate lilac
  '#d9c79a', // sand
  '#b7cfa5', // meadow
  '#d6b2ad', // rose madder, pale
] as const;

export function regionTint(index: number): string {
  return REGION_TINTS[index % REGION_TINTS.length]!;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
