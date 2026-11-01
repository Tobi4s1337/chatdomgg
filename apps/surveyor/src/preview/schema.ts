import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, Sha256Schema, TwitchLoginSchema, UIntSchema } from '@chatdom/shared';
import { GAMBLING_POLICY } from '../policy/visibility';
import { GameIdSchema, RevisionIdSchema } from '../export/schema';

/**
 * The survey preview: immutable draft land drawn from one observation revision (Spec 01 R2). It is real data on
 * draft land: never Edition 0, never founded, never SIMULATED. These are Atlas-local artifacts served by this
 * service below /map-data, not a shared wire contract; the browser validates the same shape before drawing.
 *
 * The immutable files (world.json, region-N.json) hold geometry keyed by channel ID and no raw Twitch content:
 * logins and display names live only in names.json, which is never served as is. The service projects it per
 * request (withheld channels removed, names older than a day dropped) with a short cache (R16).
 */
export const PREVIEW_KIND = 'chatdom-atlas-survey-preview';
export const PREVIEW_ALGORITHM = 'survey-preview-5';
export const PREVIEW_LABEL = 'Survey preview · land awaiting founding';
export const ISLES_NAME = 'The Isles of Many Tongues';
export const OUTER_NAME = 'The Outer Isles';
export const CROSSROADS_NAME = 'The Crossroads';
export const WILDS_NAME = 'The Wilds';
export const REALM_KINDS = ['crossroads', 'family', 'wilds', 'isle', 'outer'] as const;
export const PreviewIdSchema = z.string().regex(/^pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/);
export const TIER_CODES = ['capital', 'city', 'town', 'village'] as const;

const Int = z.number().int().min(-2_000_000_000).max(2_000_000_000);
const MAX_SETTLERS = 1_000_000;

export const SettlerColumnsSchema = z.strictObject({
  ids: z.array(KingdomIdSchema).max(MAX_SETTLERS),
  /** Index into TIER_CODES. */
  tier: z.array(z.number().int().min(0).max(3)).max(MAX_SETTLERS),
  x: z.array(Int).max(MAX_SETTLERS),
  y: z.array(Int).max(MAX_SETTLERS),
  /** Observed average viewers, rounded: viewer-minutes over live-minutes, never the current audience. */
  average: z.array(UIntSchema).max(MAX_SETTLERS),
  /** Index into the preview's games table, or -1 when the source recorded no category. */
  game: z.array(z.number().int().min(-1)).max(MAX_SETTLERS),
  region: z.array(z.number().int().min(0).max(65_535)).max(MAX_SETTLERS),
  realm: z.array(z.number().int().min(0).max(65_535)).max(MAX_SETTLERS),
}).superRefine((columns, ctx) => {
  const n = columns.ids.length;
  for (const key of ['tier', 'x', 'y', 'average', 'game', 'region', 'realm'] as const) {
    if (columns[key].length !== n) ctx.addIssue({ code: 'custom', path: [key], message: 'Settler columns must have equal lengths.' });
  }
});
export type SettlerColumns = z.infer<typeof SettlerColumnsSchema>;

const FileRefSchema = z.strictObject({
  path: z.string().regex(/^[a-z0-9-]+\.json$/),
  sha256: Sha256Schema,
  bytes: UIntSchema,
  records: UIntSchema,
});

/** One region of land: a language's continent or isle, or one of the Outer Isles. */
export const RegionFields = {
  index: UIntSchema,
  /** Null only for the Outer Isles, which belong to no language. */
  language: z.string().min(1).max(16).nullable(),
  /** Legacy label fields. New artifacts keep the language code here; display labels live outside geometry. */
  name: DisplayNameSchema,
  englishName: DisplayNameSchema,
  kind: z.enum(['continent', 'isle', 'outer']),
  x: Int, y: Int, r: Int,
  members: UIntSchema,
};

/** The drawn world: what an edition freezes and what a survey preview draws from one revision. */
export const GeometryFields = {
  /** The family taxonomy and placement rules the realms were drawn with. A proposal is never founder approval. */
  taxonomy: z.strictObject({
    id: z.string().regex(/^families-[0-9]{1,4}$/),
    status: z.enum(['proposed', 'reviewed']),
    sha256: Sha256Schema,
    variety: z.literal('variety-1'),
    realmThreshold: z.literal('realm-threshold-1'),
  }),
  lattice: z.strictObject({ id: z.literal('hex-1'), hamletRadius: z.number().positive(), shore: z.number().positive(), gap: z.number().positive() }),
  coordScale: z.literal(20),
  bounds: z.strictObject({ minX: Int, minY: Int, maxX: Int, maxY: Int }),
  tiers: z.strictObject({
    minAverage: z.strictObject({ capital: UIntSchema, city: UIntSchema, town: UIntSchema, village: UIntSchema }),
    holdingRadius: z.strictObject({ capital: z.number(), city: z.number(), town: z.number(), village: z.number() }),
  }),
  isles: z.strictObject({ name: z.literal(ISLES_NAME), x: Int, y: Int, r: Int }).nullable(),
  outer: z.strictObject({ name: z.literal(OUTER_NAME), x: Int, y: Int, r: Int }),
  /** The families of the taxonomy, by index: plain map labels. */
  families: z.array(z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/), name: DisplayNameSchema })).max(32),
  realms: z.array(z.strictObject({
    index: UIntSchema,
    region: UIntSchema,
    kind: z.enum(REALM_KINDS),
    /** Index into families for a family realm, otherwise -1. */
    family: z.number().int().min(-1),
    name: DisplayNameSchema,
    x: Int, y: Int, r: Int,
    members: UIntSchema,
    /** Free hamlet slots in this realm's waiting land. */
    slots: UIntSchema,
  })).min(1).max(4_096),
  games: z.array(z.strictObject({ gameId: GameIdSchema, name: z.string().min(1).max(256).nullable() })).max(20_000),
  /** Patches of ground inside a realm: one main category, a mixed group, or empty waiting land (game -1). */
  clusters: z.array(z.strictObject({ region: UIntSchema, realm: UIntSchema, game: z.number().int().min(-1), x: Int, y: Int, r: Int, members: UIntSchema })).max(20_000),
  /** Delta-encoded closed rings: [x0, y0, dx1, dy1, …] in 1/coordScale units. */
  coasts: z.array(z.strictObject({ region: UIntSchema, points: z.array(Int).min(6).max(400_000) })).max(50_000),
  /** Triples [code, x, y]; code = kind << 12 | band mask << 7 | variant (0–127). Kinds: mountain, hill, forest, marsh, monster, ship. */
  decor: z.array(Int).max(600_000),
};

export const PreviewWorldSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal(PREVIEW_KIND),
  id: PreviewIdSchema,
  // Retained v4 previews keep serving open sessions and their aligned live frames.
  algorithm: z.enum(['survey-preview-4', PREVIEW_ALGORITHM]),
  label: z.literal(PREVIEW_LABEL),
  status: z.literal('preview'),
  revision: RevisionIdSchema,
  asOf: EpochMsSchema,
  window: z.strictObject({
    firstObservationAt: EpochMsSchema, lastObservationAt: EpochMsSchema, hours: z.number().min(0), sweeps: UIntSchema, gapCount: UIntSchema,
  }),
  coverage: z.strictObject({
    sweepFloorViewers: UIntSchema,
    candidateMinAverage: UIntSchema,
    contentLabels: z.literal('not-collected'),
    missing: z.array(z.string().max(300)).max(20),
  }),
  founding: z.strictObject({ status: z.literal('not-founded'), edition0EligibleAt: EpochMsSchema, editionIEligibleAt: EpochMsSchema }),
  /** The visibility policy the land was drawn under, and how many otherwise-mapped candidates it kept off the map. */
  policy: z.strictObject({ gambling: z.literal(GAMBLING_POLICY.version), excludedGambling: UIntSchema }),
  counts: z.strictObject({
    channelsObserved: UIntSchema, mapped: UIntSchema, languages: UIntSchema,
    capital: UIntSchema, city: UIntSchema, town: UIntSchema, village: UIntSchema,
    /** Free hamlet slots on the drawn land: room for later settlers without moving any border. */
    hamletSlots: UIntSchema,
  }),
  ...GeometryFields,
  regions: z.array(z.strictObject({ ...RegionFields, chunk: FileRefSchema })).min(1).max(512),
  /** Capitals and cities of every region, so the world view draws before any region chunk arrives. */
  head: SettlerColumnsSchema,
});
export type PreviewWorld = z.infer<typeof PreviewWorldSchema>;

export const PreviewChunkSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal(`${PREVIEW_KIND}-region`),
  preview: PreviewIdSchema,
  region: UIntSchema,
  /** Towns and villages of one region. */
  settlers: SettlerColumnsSchema,
});
export type PreviewChunk = z.infer<typeof PreviewChunkSchema>;

/**
 * Raw names for the mapped holdings, as the source last confirmed them. Stored beside the preview and removed with
 * its revision; served only through the names projection, never as an immutable file.
 */
export const PreviewNamesSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal(`${PREVIEW_KIND}-names`),
  preview: PreviewIdSchema,
  revision: RevisionIdSchema,
  ids: z.array(KingdomIdSchema).max(MAX_SETTLERS),
  logins: z.array(TwitchLoginSchema).max(MAX_SETTLERS),
  names: z.array(DisplayNameSchema).max(MAX_SETTLERS),
  /** When the source last confirmed each login and name. */
  factsAt: z.array(EpochMsSchema).max(MAX_SETTLERS),
}).superRefine((names, ctx) => {
  for (const key of ['logins', 'names', 'factsAt'] as const) {
    if (names[key].length !== names.ids.length) ctx.addIssue({ code: 'custom', path: [key], message: 'Name columns must have equal lengths.' });
  }
});
export type PreviewNames = z.infer<typeof PreviewNamesSchema>;

/** What the browser receives from /names: the projection of names.json at one moment. */
export const ServedNamesSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal(`${PREVIEW_KIND}-served-names`),
  preview: PreviewIdSchema,
  servedAt: EpochMsSchema,
  /** Holdings drawn as bare land from now on: no stamp, shield, name or card. Reasons are never published. */
  withheld: z.array(KingdomIdSchema).max(MAX_SETTLERS),
  ids: z.array(KingdomIdSchema).max(MAX_SETTLERS),
  logins: z.array(TwitchLoginSchema).max(MAX_SETTLERS),
  names: z.array(DisplayNameSchema).max(MAX_SETTLERS),
  /** After this moment each name is stale and the browser falls back to the shield. */
  freshUntil: z.array(EpochMsSchema).max(MAX_SETTLERS),
});
export type ServedNames = z.infer<typeof ServedNamesSchema>;

/** Small pointer the service keeps beside the files; the world file's hash pins the drawing, names.json is pinned here. */
export const PreviewManifestSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal(`${PREVIEW_KIND}-manifest`),
  id: PreviewIdSchema,
  revision: RevisionIdSchema,
  asOf: EpochMsSchema,
  world: FileRefSchema,
  names: FileRefSchema,
});
export type PreviewManifest = z.infer<typeof PreviewManifestSchema>;
