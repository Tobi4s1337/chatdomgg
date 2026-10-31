import { z } from 'zod';
import { DisplayNameSchema } from '@chatdom/shared';
import { sha256 } from '../export/project';
import { GameIdSchema } from '../export/schema';
import { isGamblingCategory } from '../policy/visibility';
import FAMILIES_1 from './families-1.json?raw';

/**
 * Realms are families of games (Spec 01 R4). The families live in a checked-in, versioned proposal; this module
 * reads it and decides each channel's place from its observed category minutes. A proposal is never founder
 * approval: its review block says who reviewed it, and Edition I refuses anything still `proposed`.
 */
export const TAXONOMY_KIND = 'chatdom-atlas-family-taxonomy';
export const FamilyIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);

export const TaxonomySchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal(TAXONOMY_KIND),
  id: z.string().regex(/^families-[0-9]{1,4}$/),
  review: z.strictObject({
    status: z.enum(['proposed', 'reviewed']),
    proposedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    basis: z.string().min(1).max(600),
    reviewedBy: z.string().min(1).max(120).nullable(),
    reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
  families: z.array(z.strictObject({
    id: FamilyIdSchema,
    /** Plain map label. */
    name: DisplayNameSchema,
    /** A proposed cartographic realm name, shown only once the taxonomy is reviewed. */
    realmName: DisplayNameSchema,
    games: z.array(z.strictObject({ gameId: GameIdSchema, name: z.string().min(1).max(256) })).max(5_000),
  })).min(1).max(32),
  unassigned: z.array(z.strictObject({ gameId: GameIdSchema, name: z.string().min(1).max(256), why: z.string().max(300) })).max(5_000),
  notes: z.array(z.string().max(400)).max(30),
}).superRefine((taxonomy, ctx) => {
  const families = new Set<string>();
  const games = new Set<string>();
  const seen = (gameId: string, path: (string | number)[]) => {
    if (games.has(gameId)) ctx.addIssue({ code: 'custom', path, message: `Game ${gameId} appears twice.` });
    if (isGamblingCategory(gameId)) ctx.addIssue({ code: 'custom', path, message: `Gambling category ${gameId} cannot belong to a realm.` });
    games.add(gameId);
  };
  taxonomy.families.forEach((family, f) => {
    if (families.has(family.id)) ctx.addIssue({ code: 'custom', path: ['families', f, 'id'], message: 'Family ids must be unique.' });
    families.add(family.id);
    family.games.forEach((game, g) => seen(game.gameId, ['families', f, 'games', g]));
  });
  taxonomy.unassigned.forEach((game, g) => seen(game.gameId, ['unassigned', g]));
  const reviewed = taxonomy.review.status === 'reviewed';
  if (reviewed !== (taxonomy.review.reviewedBy !== null && taxonomy.review.reviewedAt !== null)) {
    ctx.addIssue({ code: 'custom', path: ['review'], message: 'A reviewed taxonomy names its reviewer and date; a proposal names neither.' });
  }
});
export type Taxonomy = z.infer<typeof TaxonomySchema>;

export interface TaxonomyRef {
  id: string;
  status: 'proposed' | 'reviewed';
  /** SHA-256 of the file's bytes: what a founding authorization names. */
  sha256: string;
}

export interface LoadedTaxonomy {
  taxonomy: Taxonomy;
  ref: TaxonomyRef;
  /** gameId → family index. */
  familyOf: ReadonlyMap<string, number>;
}

/** Parses the file as checked in; its hash is over these exact bytes, the document a reviewer signs. */
export function loadTaxonomy(text: string): LoadedTaxonomy {
  const taxonomy = TaxonomySchema.parse(JSON.parse(text));
  const familyOf = new Map<string, number>();
  taxonomy.families.forEach((family, index) => {
    for (const game of family.games) familyOf.set(game.gameId, index);
  });
  return {
    taxonomy,
    ref: { id: taxonomy.id, status: taxonomy.review.status, sha256: sha256(text) },
    familyOf,
  };
}

/** The checked-in proposal this build draws with. */
export function currentTaxonomy(): LoadedTaxonomy {
  return loadTaxonomy(FAMILIES_1);
}

/** The checked-in proposal's exact bytes, which a founding copies into its edition. */
export function currentTaxonomyText(): string {
  return FAMILIES_1;
}

/**
 * Variety rule `variety-1`, documented in Spec 01: a channel belongs to the Crossroads when its observed minutes
 * are spread across communities. Each family counts as one community, each unassigned game as its own. A channel
 * is variety when it has at least two hours on record, no community holds half its minutes, and at least three
 * communities hold 12 % or more each. Otherwise its place is the community with the most minutes; when that is an
 * unassigned game, the channel lives in the Wilds.
 */
export const VARIETY_RULE = Object.freeze({ id: 'variety-1', minMinutes: 120, maxTopShare: 0.5, minCommunities: 3, communityShare: 0.12 });

export type Placement =
  | { kind: 'family'; family: number }
  | { kind: 'variety' }
  | { kind: 'unassigned' };

export function placementOf(categories: readonly { gameId: string; minutes: number }[], familyOf: ReadonlyMap<string, number>): Placement {
  const minutes = new Map<string, number>();
  let total = 0;
  for (const category of categories) {
    if (!(category.minutes > 0)) continue;
    const family = familyOf.get(category.gameId);
    const key = family === undefined ? `g:${category.gameId}` : `f:${family}`;
    minutes.set(key, (minutes.get(key) ?? 0) + category.minutes);
    total += category.minutes;
  }
  if (total <= 0) return { kind: 'unassigned' };
  // Ties go to a family before an unassigned game, then to the lower family index or game ID: deterministic.
  const ranked = [...minutes.entries()].sort((a, b) => b[1] - a[1] || rankKey(a[0]) - rankKey(b[0]) || compareKeys(a[0], b[0]));
  const [topKey, topMinutes] = ranked[0]!;
  const spread = ranked.filter(([, value]) => value / total >= VARIETY_RULE.communityShare).length;
  if (total >= VARIETY_RULE.minMinutes && topMinutes / total < VARIETY_RULE.maxTopShare && spread >= VARIETY_RULE.minCommunities) return { kind: 'variety' };
  return topKey.startsWith('f:') ? { kind: 'family', family: Number(topKey.slice(2)) } : { kind: 'unassigned' };
}

const rankKey = (key: string) => (key.startsWith('f:') ? 0 : 1);
function compareKeys(a: string, b: string): number {
  if (a.startsWith('f:') && b.startsWith('f:')) return Number(a.slice(2)) - Number(b.slice(2));
  const x = a.slice(2);
  const y = b.slice(2);
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}
