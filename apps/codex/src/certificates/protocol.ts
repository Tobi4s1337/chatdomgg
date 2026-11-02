import type { ForgeDraft } from '@chatdom/shared';
import { FORGE_SUBJECT_MOTIFS, FORGE_SUBJECT_SLOTS, type ForgeCertificateGrade } from '../providers/policy';

export const FORGE_CERTIFICATE_POLICY = 'forge-motif-blind-choice-v1';
export const FORGE_CERTIFICATE_FAMILIES = ['hearth', 'tide', 'grove'] as const;
export const FORGE_CERTIFICATE_FINISHES = ['native', 'copper', 'ceramic'] as const;
export const FORGE_CERTIFICATE_ROUNDS = 3;
export type ForgeCertificateFamily = (typeof FORGE_CERTIFICATE_FAMILIES)[number];
export type ForgeCertificateMotif = (typeof FORGE_SUBJECT_MOTIFS)[number];
export type ForgeCertificateFinish = (typeof FORGE_CERTIFICATE_FINISHES)[number];

/** Each catalogue motif and the one answer that counts as recognising it. */
export const FORGE_CERTIFICATE_ANSWERS: Record<ForgeCertificateMotif, string> = {
  'sleeping-dragon': 'dragon', 'crescent-moon': 'moon', 'watchful-owl': 'owl', 'sleeping-fox': 'fox',
  sunflower: 'sunflower', 'scallop-shell': 'shell', 'shooting-star': 'star',
};
/** The choice list mixes every true answer with near neighbours, so a family resemblance cannot pass. */
export const FORGE_CERTIFICATE_CHOICES = ['dragon', 'lizard', 'snake', 'moon', 'banana', 'owl', 'bird', 'cat', 'fox', 'dog',
  'rabbit', 'squirrel', 'sunflower', 'daisy', 'sun', 'shell', 'fan', 'star', 'heart', 'leaf', 'tree', 'unclear'] as const;
export type ForgeCertificateChoice = (typeof FORGE_CERTIFICATE_CHOICES)[number];

export interface ForgeCertificateTile { motif: ForgeCertificateMotif; finish: ForgeCertificateFinish; kind: (typeof FORGE_SUBJECT_SLOTS)[number] }
/** All motif × finish pairs of one family. Kinds rotate so every mounting appears across the sheet. */
export function forgeCertificateTiles(): ForgeCertificateTile[] {
  return FORGE_SUBJECT_MOTIFS.flatMap((motif, m) => FORGE_CERTIFICATE_FINISHES.map((finish, f) =>
    ({ motif, finish, kind: FORGE_SUBJECT_SLOTS[(m + f) % FORGE_SUBJECT_SLOTS.length]! })));
}
export function forgeCertificateDraft(tile: ForgeCertificateTile): ForgeDraft {
  return { plan: { version: 2, kind: tile.kind, motif: tile.motif, finish: tile.finish, accent: 'none' },
    title: 'Certification piece', plaque: 'An authored kit piece shown without a caption.' };
}
/** A fixed, seeded order per family and round; the order and the motif never appear in the image. */
export function forgeCertificateOrder(family: ForgeCertificateFamily, round: number, count: number): number[] {
  let seed = 0x9e3779b9 ^ (FORGE_CERTIFICATE_FAMILIES.indexOf(family) * 7919 + round * 104729);
  const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
  return order;
}

export const FORGE_CERTIFICATE_PROMPT = `You are identifying small decorative ornaments for storybook houses, built from voxels.
The attached image is a grid of numbered tiles. Each tile shows one whole house part in a lit three-quarter view.
Some parts stand on a post, a chimney stack, a bracket or a small glass lantern chamber: ignore that mounting hardware.
For every tile, choose the single word from the allowed list that best names what the ornament on top depicts.
Choose unclear when you cannot confidently tell. Judge only what you see; the same subject may appear in several tiles, and tiles are independent.
Do not use tools. Return only JSON matching the supplied schema, with exactly one entry per tile number.`;
export function forgeCertificateSchema(count: number): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: ['tiles'], properties: { tiles: {
    type: 'array', minItems: count, maxItems: count, items: { type: 'object', additionalProperties: false, required: ['tile', 'subject'],
      properties: { tile: { type: 'integer', minimum: 1, maximum: count }, subject: { type: 'string', enum: [...FORGE_CERTIFICATE_CHOICES] } } } } } };
}
/** Strict parse: every tile once, only allowed words. Anything else is a failed read, never a partial pass. */
export function readForgeCertificateAnswers(raw: string, count: number): ForgeCertificateChoice[] | undefined {
  try {
    if (raw.length > 32_768) return undefined;
    const parsed = JSON.parse(raw) as { tiles?: unknown };
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.tiles) || parsed.tiles.length !== count) return undefined;
    const answers: (ForgeCertificateChoice | undefined)[] = Array.from({ length: count });
    for (const entry of parsed.tiles as unknown[]) {
      if (!entry || typeof entry !== 'object') return undefined;
      const { tile, subject } = entry as { tile?: unknown; subject?: unknown };
      if (!Number.isInteger(tile) || (tile as number) < 1 || (tile as number) > count || answers[(tile as number) - 1] !== undefined
        || typeof subject !== 'string' || !(FORGE_CERTIFICATE_CHOICES as readonly string[]).includes(subject)) return undefined;
      answers[(tile as number) - 1] = subject as ForgeCertificateChoice;
    }
    return answers as ForgeCertificateChoice[];
  } catch { return undefined; }
}
/** Three blind rounds: all three correct reads; two weak; fewer unread. A failed read counts as a miss. */
export function gradeForgeCertificate(correct: number, rounds = FORGE_CERTIFICATE_ROUNDS): Exclude<ForgeCertificateGrade, 'uncertified'> {
  if (!Number.isInteger(correct) || correct < 0 || correct > rounds || rounds !== FORGE_CERTIFICATE_ROUNDS) throw new RangeError('Invalid certificate count.');
  return correct === rounds ? 'reads' : correct === rounds - 1 ? 'weak' : 'unread';
}
