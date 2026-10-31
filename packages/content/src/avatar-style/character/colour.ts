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

/** OKLab (Björn Ottosson, public domain): perceptual distances between colours. */
export function oklab(c: Rgb): Rgb {
  const lin = (v: number) => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const [r, g, b] = c.map(lin) as unknown as Rgb;
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}

/** Perceptual distance between two colours (OKLab, about 0 to 1). */
export function colourDistance(a: Hex, b: Hex): number {
  const [x, y] = [oklab(rgb(a)), oklab(rgb(b))];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
