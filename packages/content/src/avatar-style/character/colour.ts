/** Colours are `#rrggbb` sRGB strings in recipes, and 0..1 sRGB triples inside the mesher. */
export type Hex = `#${string}`;
export type Rgb = readonly [number, number, number];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && HEX.test(value);
}

export function rgb(hex: Hex): Rgb {
  if (!isHex(hex)) throw new Error(`${String(hex)} is not a #rrggbb colour.`);
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function hex(c: Rgb): Hex {
  const b = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${b(c[0])}${b(c[1])}${b(c[2])}`;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Scales value in HSV, so a shade keeps its hue (a deep fold of red cloth stays red, not brown). */
export function shade(c: Rgb, factor: number): Rgb {
  return [c[0] * factor, c[1] * factor, c[2] * factor];
}

/** Relative luminance (sRGB weights on gamma values; good enough to pick contrasts). */
export function luma(c: Rgb): number {
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
