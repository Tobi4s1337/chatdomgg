/**
 * Heraldry for the Atlas: every mapped channel bears a shield of two tinctures seeded from its channel ID.
 *
 *   const design = shieldDesign('12826');       // pure data, deterministic, never from the login
 *   drawShield(ctx, design, x, y, 20, { halo: true });
 *   blazon(design);                             // "Azure, a fess wavy Or" for cards and screen readers
 */
export { channelSeed, isChannelId, sha256, toHex, CHANNEL_ID_PATTERN } from './sha256';
export {
  shieldDesign, designFromSeed, blazon, obeysRuleOfTincture, tinctureUnderCharge, patternKind, isMetal,
  HERALDRY_VERSION, TINCTURES, METALS, COLOURS, DIVISIONS, ORDINARIES, PARTITION_LINES, LINED_PATTERNS,
  PATTERN_RULES, LINE_WEIGHTS, COLOUR_WEIGHTS, METAL_WEIGHTS, CHARGE_WEIGHTS,
} from './design';
export type {
  ShieldDesign, ShieldCharge, ChargePlacement, Tincture, Metal, Colour, TinctureSwatch, FieldPattern, Division,
  Ordinary, PartitionLine,
} from './design';
export { CHARGE_KINDS, CHARGE_NAMES, chargeShape } from './charges';
export type { ChargeKind, ChargeShape } from './charges';
export { SHIELD_ASPECT, FESS_Y, shieldOutline, shieldPolygon, secondRegion, chargeSpots } from './geometry';
export type { ChargeSpot } from './geometry';
export { drawShield, shieldPath, SHIELD_INK, SHIELD_PAPER } from './draw';
export type { DrawShieldOptions, ShieldHalo, ShieldContext } from './draw';
export { tracePath } from './path';
export type { PathCommand, PathPiece, PathSink, Point } from './path';
