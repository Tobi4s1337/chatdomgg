/**
 * Arms for mapped channels: a shield of two tinctures seeded from the channel ID (Atlas.md §4.3).
 *
 * `shieldDesign` is pure data and fully determined by the SHA-256 of the decimal channel ID. The login is never an
 * input, so a channel keeps its arms through a rename. Any change to the tables below changes the arms of real
 * channels on the map: bump `HERALDRY_VERSION` and update the pinned designs in the tests when you mean to.
 *
 * The rules, in order of importance:
 * - Bold and simple. Every shield uses exactly two tinctures, a metal and a colour, so it reads at 16 to 24 px.
 * - The rule of tincture: no metal on metal, no colour on colour. A division always joins a metal and a colour;
 *   an ordinary is the other class from its field; a charge takes whichever of the two tinctures it does not sit
 *   on, and a charge across a division is counterchanged.
 * - A minority (about 30 %) carry a charge; the rest are a division or an ordinary alone.
 * - Gules is a deep madder, never vermilion, and is drawn slightly less often than the other colours: warm
 *   vermilion on the map means "live now".
 */
import { channelSeed, sha256 } from './sha256';
import { CHARGE_KINDS, CHARGE_NAMES, type ChargeKind } from './charges';

export const HERALDRY_VERSION = 1;

export const METALS = ['or', 'argent'] as const;
export const COLOURS = ['azure', 'vert', 'purpure', 'sable', 'gules'] as const;
export type Metal = (typeof METALS)[number];
export type Colour = (typeof COLOURS)[number];
export type Tincture = Metal | Colour;

export interface TinctureSwatch {
  readonly name: string;
  readonly kind: 'metal' | 'colour';
  /** The wash itself, as it dries on parchment. */
  readonly pigment: string;
  /** The same pigment where it pools at the edge of a wash. */
  readonly pooled: string;
  /** Hatching an engraver would use for this tincture, should a renderer want a monochrome fallback. */
  readonly hatch: 'none' | 'dots' | 'vertical' | 'horizontal' | 'bend' | 'bendSinister' | 'cross';
}

/**
 * Pigments tuned for watercolour on parchment (#efe3c6) beside sepia ink (#3b2f25). Or is a warm ochre rather
 * than a lemon gold; argent is a paper white a shade lighter than the map so it still reads as a tincture;
 * gules is a crimson madder, deliberately cooler and darker than the map's live vermilion (#d9502e and kin).
 */
export const TINCTURES: Readonly<Record<Tincture, TinctureSwatch>> = {
  or: { name: 'Or', kind: 'metal', pigment: '#d7a640', pooled: '#b9842a', hatch: 'dots' },
  argent: { name: 'Argent', kind: 'metal', pigment: '#f7f0de', pooled: '#d9cbad', hatch: 'none' },
  azure: { name: 'Azure', kind: 'colour', pigment: '#3d6a99', pooled: '#2b4f78', hatch: 'horizontal' },
  vert: { name: 'Vert', kind: 'colour', pigment: '#45764a', pooled: '#305a37', hatch: 'bend' },
  purpure: { name: 'Purpure', kind: 'colour', pigment: '#6b4a7c', pooled: '#4f345e', hatch: 'bendSinister' },
  sable: { name: 'Sable', kind: 'colour', pigment: '#2f2925', pooled: '#1f1a17', hatch: 'cross' },
  gules: { name: 'Gules', kind: 'colour', pigment: '#842232', pooled: '#621624', hatch: 'vertical' },
};

export function isMetal(t: Tincture): t is Metal {
  return t === 'or' || t === 'argent';
}

export const DIVISIONS = [
  'perPale', 'perFess', 'perBend', 'perBendSinister', 'quarterly', 'perChevron', 'perSaltire', 'gyronny',
] as const;
export const ORDINARIES = [
  'chief', 'fess', 'pale', 'bend', 'bendSinister', 'chevron', 'cross', 'saltire', 'bordure', 'pile',
] as const;
export type Division = (typeof DIVISIONS)[number];
export type Ordinary = (typeof ORDINARIES)[number];
export type FieldPattern = 'plain' | Division | Ordinary;

export const PARTITION_LINES = ['straight', 'wavy', 'indented', 'embattled', 'engrailed'] as const;
export type PartitionLine = (typeof PARTITION_LINES)[number];

/**
 * Where charges sit. `center` and `twoAndOne` are in the open field (beside or around an ordinary when there is
 * one: below a chief, inside a bordure, between a fess or chevron); `onOrdinary` is on the ordinary itself.
 */
export type ChargePlacement = 'center' | 'twoAndOne' | 'onOrdinary';

export interface ShieldCharge {
  readonly kind: ChargeKind;
  readonly count: 1 | 3;
  readonly placement: ChargePlacement;
  /** `counterchanged`: across a division, each part of the charge takes the tincture of the other half. */
  readonly tincture: Tincture | 'counterchanged';
}

export interface ShieldDesign {
  readonly version: typeof HERALDRY_VERSION;
  /** The field: for a division, its first (dexter or chief) half. */
  readonly field: Tincture;
  readonly pattern: FieldPattern;
  /** The line of partition; always `straight` for patterns that do not take one. */
  readonly line: PartitionLine;
  /** The second tincture: the other half of a division, the ordinary, or the charge on a plain field. */
  readonly second: Tincture;
  readonly charge?: ShieldCharge;
  /** A 32-bit value for the painted texture (granulation), so the same arms always dry the same way. */
  readonly grain: number;
}

export function patternKind(pattern: FieldPattern): 'plain' | 'division' | 'ordinary' {
  if (pattern === 'plain') return 'plain';
  return (DIVISIONS as readonly string[]).includes(pattern) ? 'division' : 'ordinary';
}

/**
 * Patterns whose edge may be wavy, indented, embattled or engrailed. Chevrons are left out: any pattern meeting
 * itself at the apex reads as a lump or a staircase at map sizes.
 */
export const LINED_PATTERNS: ReadonlySet<FieldPattern> = new Set<FieldPattern>([
  'perPale', 'perFess', 'perBend', 'perBendSinister', 'chief', 'fess', 'pale', 'bend', 'bendSinister',
]);

// ---------------------------------------------------------------------------------------------------------------
// Weights. Shares are documented in the tests, which hold them within a band.

interface PlacementOption { readonly placement: ChargePlacement; readonly count: 1 | 3; readonly weight: number }
interface PatternRule {
  readonly weight: number;
  /** Chance that a shield of this pattern carries a charge. */
  readonly charged: number;
  readonly placements: readonly PlacementOption[];
}

const FIELD = (count: 1 | 3, weight: number, placement: ChargePlacement = count === 1 ? 'center' : 'twoAndOne'): PlacementOption =>
  ({ placement, count, weight });
const ON = (count: 1 | 3, weight: number): PlacementOption => ({ placement: 'onOrdinary', count, weight });

export const PATTERN_RULES: Readonly<Record<FieldPattern, PatternRule>> = {
  plain: { weight: 7, charged: 1, placements: [FIELD(1, 3), FIELD(3, 2)] },

  perPale: { weight: 7, charged: 0.25, placements: [FIELD(1, 1), FIELD(3, 1)] },
  perFess: { weight: 7, charged: 0.25, placements: [FIELD(1, 1)] },
  perBend: { weight: 6, charged: 0.2, placements: [FIELD(1, 1)] },
  perBendSinister: { weight: 4, charged: 0.2, placements: [FIELD(1, 1)] },
  quarterly: { weight: 6, charged: 0, placements: [] },
  perChevron: { weight: 5, charged: 0.35, placements: [FIELD(3, 1)] },
  perSaltire: { weight: 4, charged: 0, placements: [] },
  gyronny: { weight: 2, charged: 0, placements: [] },

  chief: { weight: 7, charged: 0.5, placements: [ON(3, 2), ON(1, 1), FIELD(1, 2)] },
  fess: { weight: 6, charged: 0.4, placements: [ON(1, 1), ON(3, 1), FIELD(3, 2)] },
  pale: { weight: 5, charged: 0.25, placements: [ON(1, 1), ON(3, 1)] },
  bend: { weight: 6, charged: 0.35, placements: [ON(3, 1)] },
  bendSinister: { weight: 3, charged: 0.3, placements: [ON(3, 1)] },
  chevron: { weight: 6, charged: 0.4, placements: [FIELD(3, 1)] },
  cross: { weight: 6, charged: 0, placements: [] },
  saltire: { weight: 5, charged: 0, placements: [] },
  bordure: { weight: 4, charged: 0.6, placements: [FIELD(1, 3), FIELD(3, 1)] },
  pile: { weight: 3, charged: 0, placements: [] },
};

export const LINE_WEIGHTS: Readonly<Record<PartitionLine, number>> = {
  straight: 60, wavy: 12, indented: 10, embattled: 9, engrailed: 9,
};

/** Gules is held at or below every other colour (see the header). */
export const COLOUR_WEIGHTS: Readonly<Record<Colour, number>> = { azure: 1, vert: 1, purpure: 1, sable: 1, gules: 0.9 };
export const METAL_WEIGHTS: Readonly<Record<Metal, number>> = { or: 1, argent: 1 };

/** Simple silhouettes are favoured; intricate ones are rarer because they blur first. */
export const CHARGE_WEIGHTS: Readonly<Record<ChargeKind, number>> = {
  mullet: 1.2, sun: 0.9, crescent: 1.1, roundel: 0.8, annulet: 0.7, lozenge: 0.8, mascle: 0.5, lily: 1.1,
  crossPattee: 1, tower: 0.9, martlet: 1, fish: 0.8, tree: 0.9, bell: 0.7, trefoil: 0.8, anvil: 0.6,
};

/** Share of ordinaries and plain fields that are a colour field (the rest are a metal field). */
const COLOUR_FIELD_SHARE = 0.55;

// ---------------------------------------------------------------------------------------------------------------

/**
 * Reads uniform numbers from the channel seed, 32 bits at a time. When the 32 seed bytes run out it continues with
 * SHA-256(seed ‖ block counter), so the sequence is easy to reproduce in any language.
 */
class SeedStream {
  private block: Uint8Array;
  private offset = 0;
  private counter = 0;
  constructor(private readonly seed: Uint8Array) {
    this.block = seed;
  }
  u32(): number {
    if (this.offset + 4 > this.block.length) {
      this.counter += 1;
      const input = new Uint8Array(this.seed.length + 1);
      input.set(this.seed);
      input[this.seed.length] = this.counter & 0xff;
      this.block = sha256(input);
      this.offset = 0;
    }
    const b = this.block;
    const o = this.offset;
    this.offset += 4;
    return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  }
  unit(): number {
    return this.u32() / 0x1_0000_0000;
  }
  pick<T>(options: readonly T[], weight: (option: T) => number): T {
    let total = 0;
    for (const o of options) total += weight(o);
    let r = this.unit() * total;
    for (const o of options) {
      r -= weight(o);
      if (r < 0) return o;
    }
    return options[options.length - 1]!;
  }
}

const ALL_PATTERNS = Object.keys(PATTERN_RULES) as FieldPattern[];

/** The arms of a mapped channel. Throws for anything that is not a decimal Twitch channel ID. */
export function shieldDesign(channelId: string): ShieldDesign {
  return designFromSeed(channelSeed(channelId));
}

/** The same derivation from an already computed 32-byte channel seed. */
export function designFromSeed(seed: Uint8Array): ShieldDesign {
  if (seed.length !== 32) throw new RangeError('A channel seed is 32 bytes.');
  const s = new SeedStream(seed);
  // Draw order is part of the contract: pattern, line, tinctures, charge, grain. Every draw is always taken, even
  // when unused, so a change in one choice never shifts the others.
  const pattern = s.pick(ALL_PATTERNS, (p) => PATTERN_RULES[p].weight);
  const lineDraw = s.pick(PARTITION_LINES, (l) => LINE_WEIGHTS[l]);
  const metal = s.pick(METALS, (m) => METAL_WEIGHTS[m]);
  const colour = s.pick(COLOURS, (c) => COLOUR_WEIGHTS[c]);
  const order = s.unit();
  const chargeRoll = s.unit();
  const kind = s.pick(CHARGE_KINDS, (k) => CHARGE_WEIGHTS[k]);
  const placementDraw = s.unit();
  const grain = s.u32();

  const rule = PATTERN_RULES[pattern];
  const kindOfPattern = patternKind(pattern);
  const charged = chargeRoll < rule.charged && rule.placements.length > 0;
  const line = lineFor(pattern, lineDraw, charged && kindOfPattern === 'division');

  // Divisions: metal first or colour first, evenly. Ordinaries and plain fields: field class by COLOUR_FIELD_SHARE.
  const colourFirst = kindOfPattern === 'division' ? order < 0.5 : order < COLOUR_FIELD_SHARE;
  const field: Tincture = colourFirst ? colour : metal;
  const second: Tincture = colourFirst ? metal : colour;

  const base = { version: HERALDRY_VERSION, field, pattern, line, second, grain } as const;
  if (!charged) return base;

  let total = 0;
  for (const p of rule.placements) total += p.weight;
  let r = placementDraw * total;
  let option = rule.placements[rule.placements.length - 1]!;
  for (const p of rule.placements) {
    r -= p.weight;
    if (r < 0) { option = p; break; }
  }

  const tincture: ShieldCharge['tincture'] = kindOfPattern === 'division'
    ? 'counterchanged'
    : option.placement === 'onOrdinary' ? field : second;
  return { ...base, charge: { kind, count: option.count, placement: option.placement, tincture } };
}

/** The line a pattern actually takes: a counterchanged charge over a fancy line turns to noise, so charged divisions stay straight. */
function lineFor(pattern: FieldPattern, drawn: PartitionLine, counterchanged: boolean): PartitionLine {
  return LINED_PATTERNS.has(pattern) && !counterchanged ? drawn : 'straight';
}

/** Which tincture each charge sits on, for checking the rule of tincture. Counterchanged charges sit on both. */
export function tinctureUnderCharge(design: ShieldDesign): Tincture | 'both' | null {
  const { charge } = design;
  if (!charge) return null;
  if (patternKind(design.pattern) === 'division') return 'both';
  if (design.pattern === 'plain') return design.field;
  return charge.placement === 'onOrdinary' ? design.second : design.field;
}

/** True when the design keeps the rule of tincture. */
export function obeysRuleOfTincture(design: ShieldDesign): boolean {
  if (design.field === design.second) return false;
  if (design.pattern !== 'plain' && isMetal(design.field) === isMetal(design.second)) return false;
  const under = tinctureUnderCharge(design);
  const charge = design.charge;
  if (!charge || under === null) return design.pattern !== 'plain';
  if (under === 'both') return charge.tincture === 'counterchanged';
  if (charge.tincture === 'counterchanged') return false;
  return isMetal(charge.tincture) !== isMetal(under);
}

// ---------------------------------------------------------------------------------------------------------------
// Blazon: the arms in words, for cards, tooltips and screen readers.

const PATTERN_WORDS: Record<Exclude<FieldPattern, 'plain'>, string> = {
  perPale: 'Per pale', perFess: 'Per fess', perBend: 'Per bend', perBendSinister: 'Per bend sinister',
  quarterly: 'Quarterly', perChevron: 'Per chevron', perSaltire: 'Per saltire', gyronny: 'Gyronny',
  chief: 'a chief', fess: 'a fess', pale: 'a pale', bend: 'a bend', bendSinister: 'a bend sinister',
  chevron: 'a chevron', cross: 'a cross', saltire: 'a saltire', bordure: 'a bordure', pile: 'a pile',
};

/** A traditional blazon, e.g. "Azure, a fess wavy Or between three mullets Or". */
export function blazon(design: ShieldDesign): string {
  const t = (x: Tincture): string => TINCTURES[x].name;
  const lineWord = design.line === 'straight' ? '' : ` ${design.line}`;
  const c = design.charge;
  const chargeWords = c
    ? `${c.count === 1 ? CHARGE_NAMES[c.kind].one : `three ${CHARGE_NAMES[c.kind].many}`} ${c.tincture === 'counterchanged' ? 'counterchanged' : t(c.tincture)}`
    : '';
  const kind = patternKind(design.pattern);
  if (design.pattern === 'plain') return `${t(design.field)}, ${chargeWords}`;
  if (kind === 'division') {
    const head = `${PATTERN_WORDS[design.pattern as Division]}${lineWord} ${t(design.field)} and ${t(design.second)}`;
    return c ? `${head}, ${chargeWords}` : head;
  }
  const ord = `${PATTERN_WORDS[design.pattern as Ordinary]}${lineWord} ${t(design.second)}`;
  if (!c) return `${t(design.field)}, ${ord}`;
  if (c.placement === 'onOrdinary') return `${t(design.field)}, on ${ord} ${chargeWords}`;
  if (design.pattern === 'chief') return `${t(design.field)}, ${chargeWords}, ${ord}`;
  if (design.pattern === 'bordure') return `${t(design.field)}, ${chargeWords} within ${ord}`;
  return `${t(design.field)}, ${ord} between ${chargeWords}`;
}
