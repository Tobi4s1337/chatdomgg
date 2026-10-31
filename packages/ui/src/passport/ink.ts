import type { CrestView } from './types';

/**
 * Hand-inked, never random. Every stamp's tilt, slip, pressure, broken edge and wax thumbprint derive from its stable
 * record ID, so the same journey looks the same in the panel, on the card page and in the share image, today and
 * next year, and two stamps from the same kingdom still land differently.
 */

/** FNV-1a over UTF-16 code units: small, stable and good enough to scatter ink. */
export function inkHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32: a seeded stream so each property draws its own value from one hash. */
export function inkStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Ink {
  /** Degrees; a hand never presses quite straight, and never more than a short tilt. */
  readonly rotate: number;
  /** Slip from the stamp's slot, as fractions of its box. */
  readonly dx: number;
  readonly dy: number;
  /** 0.78..0.98: how much ink reached the paper. */
  readonly pressure: number;
  /** Where the pad ran dry: an angle in degrees for a soft fade across the impression. */
  readonly dryAngle: number;
  /** Turbulence seed for the broken ink edge. */
  readonly grain: number;
  /** Raid seals: which corner of the impression the wax sits over, its pour angle and thumb rotation. */
  readonly sealCorner: 0 | 1 | 2 | 3;
  readonly sealTurn: number;
  readonly thumbTurn: number;
  /** 0..1 knobs for the poured wax outline. */
  readonly pour: readonly [number, number, number];
}

export function inkFor(recordId: string): Ink {
  const next = inkStream(inkHash(`passport-ink:${recordId}`));
  const signed = (span: number) => (next() * 2 - 1) * span;
  const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
  return {
    rotate: round(signed(7.5), 1),
    dx: round(signed(0.06), 3),
    dy: round(signed(0.05), 3),
    pressure: round(0.78 + next() * 0.2),
    dryAngle: Math.floor(next() * 360),
    grain: 1 + Math.floor(next() * 997),
    sealCorner: Math.floor(next() * 4) as 0 | 1 | 2 | 3,
    sealTurn: round(signed(24), 1),
    thumbTurn: Math.floor(next() * 360),
    pour: [round(next(), 3), round(next(), 3), round(next(), 3)],
  };
}

/* ---------- Colour: the kingdom's tinctures, made to read as ink and wax on parchment. ---------- */

export type Rgb = readonly [number, number, number];

export function parseHex(hex: string): Rgb {
  const value = /^#([a-f0-9]{6})$/i.exec(hex)?.[1];
  if (!value) throw new Error(`Not a #rrggbb tincture: ${hex}`);
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)) as unknown as Rgb;
}

export function toHex(rgb: Rgb): string {
  return `#${rgb.map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Chroma in 0..255: how much colour a tincture carries, so the wax takes the arms' strongest colour. */
export function chroma(rgb: Rgb): number {
  return Math.max(...rgb) - Math.min(...rgb);
}

/** The darkest parchment the book prints on (`--cd-parch-lo`). Every ink is judged against it. */
export const PARCHMENT: Rgb = parseHex('#e3cfa3');
const IRON_GALL: Rgb = parseHex('#24160d');

/** Darken toward iron-gall ink only as far as needed to reach `target` contrast on the darkest parchment. */
function deepen(rgb: Rgb, target: number): Rgb {
  if (contrast(rgb, PARCHMENT) >= target) return rgb;
  // Aim a hair past the target so rounding to whole channels in `toHex` can never drop below it.
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(rgb, IRON_GALL, step / 20);
    if (contrast(candidate, PARCHMENT) >= target + 0.04) return candidate;
  }
  return IRON_GALL;
}

export interface CrestInks {
  /** The stamp's ink: the arms' darkest tincture, deepened to read as a graphic on parchment (at least 3.5:1). */
  readonly ink: string;
  /** A second, softer ink for the road line and date ring: the next tincture, deepened to at least 3:1. */
  readonly accent: string;
  /** Wax: the arms' most coloured tincture, poured a little darker than the cloth it came from. */
  readonly wax: string;
  readonly waxHi: string;
  readonly waxLo: string;
}

export function crestInks(crest: Pick<CrestView, 'colours'>): CrestInks {
  const colours = crest.colours.map(parseHex);
  if (colours.length === 0) throw new Error('A crest needs its tinctures');
  const byDark = [...colours].sort((a, b) => luminance(a) - luminance(b));
  const ink = deepen(byDark[0]!, 3.5);
  const accent = deepen(byDark[1] ?? byDark[0]!, 3);
  const byChroma = [...colours].sort((a, b) => chroma(b) - chroma(a) || luminance(a) - luminance(b));
  const strongest = byChroma[0]!;
  // Wax poured from a pale tincture still needs body: pull it toward a deep sealing-wax base by its lightness.
  const wax = mix(strongest, parseHex('#4a1a12'), Math.min(0.55, 0.12 + luminance(strongest) * 0.6));
  return {
    ink: toHex(ink), accent: toHex(accent), wax: toHex(wax),
    waxHi: toHex(mix(wax, parseHex('#fff0dc'), 0.32)), waxLo: toHex(mix(wax, parseHex('#140804'), 0.45)),
  };
}
