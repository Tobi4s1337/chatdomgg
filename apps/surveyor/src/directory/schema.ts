import { z } from 'zod';
import { DisplayNameSchema, EpochMsSchema, KingdomIdSchema, TwitchLoginSchema, UIntSchema } from '@chatdom/shared';
import { AvatarUrlSchema, RevisionIdSchema } from '../export/schema';
import { PreviewIdSchema } from '../preview/schema';

/**
 * The public register of one survey preview: search, channel cards and roads (Spec 01 R13, R16, R17). Atlas-local
 * replies of this service, validated again by the browser; not a shared wire contract. Every reply is projected per
 * request through the visibility gate and withheld list; stream titles expire after one day. Names remain available
 * between survey refreshes. Nothing here is about a person: channels, their observed audiences and the raid
 * aggregates between them.
 */
export const DIRECTORY_KIND = 'chatdom-atlas';
/** Results one search returns at most: enough to choose from on a phone without scrolling a long list. */
export const MAX_RESULTS = 8;
/** Roads on a card: the strongest three (R17). */
export const CARD_ROADS = 3;

const Int = z.number().int().min(0).max(65_535);

/**
 * How a channel appears: `mapped` holds land in this preview; `waiting` is publicly named but holds none (a small
 * stream, or one the survey has not mapped); `unseen` is a raid counterpart the survey never observed live (under its
 * five-viewer sweep floor), known only by its ID.
 */
export const PlaceSchema = z.enum(['mapped', 'waiting', 'unseen']);

export const ChannelFaceSchema = z.strictObject({
  id: KingdomIdSchema,
  /** Twitch login and display name from the survey; absent for unseen channels. */
  login: TwitchLoginSchema.nullable(),
  name: DisplayNameSchema.nullable(),
  freshUntil: EpochMsSchema.nullable(),
  place: PlaceSchema,
  /** Settler ordinal and holding tier rank (0 capital … 3 village) for mapped land. */
  ordinal: UIntSchema.nullable(),
  tier: z.number().int().min(0).max(3).nullable(),
  /** The land it holds, or the realm it is pencilled into while it waits; null when unseen. */
  region: Int.nullable(),
  realm: Int.nullable(),
}).superRefine((face, ctx) => {
  if ((face.login === null) !== (face.name === null) || (face.name === null) !== (face.freshUntil === null)) {
    ctx.addIssue({ code: 'custom', message: 'A name, its login and its freshness travel together.' });
  }
  const mapped = face.place === 'mapped';
  if (mapped !== (face.ordinal !== null) || mapped !== (face.tier !== null)) ctx.addIssue({ code: 'custom', message: 'Only mapped land has an ordinal and tier.' });
  if ((face.place === 'unseen') !== (face.realm === null) || (face.realm === null) !== (face.region === null)) {
    ctx.addIssue({ code: 'custom', message: 'Only an unseen channel has no realm.' });
  }
  if (face.place === 'unseen' && face.name !== null) ctx.addIssue({ code: 'custom', message: 'An unseen channel has no name.' });
});
export type ChannelFace = z.infer<typeof ChannelFaceSchema>;

/** The source avatar's own expiry; never the name freshness clock or time of serving. */
export const ChannelPortraitSchema = z.strictObject({ url: AvatarUrlSchema, freshUntil: EpochMsSchema });
export type ChannelPortrait = z.infer<typeof ChannelPortraitSchema>;

const Reply = {
  version: z.literal(1),
  preview: PreviewIdSchema,
  revision: RevisionIdSchema,
  servedAt: EpochMsSchema,
  /** The observation cut of these facts (the survey, or a public lookup). */
  asOf: EpochMsSchema,
};

export const PencilPointSchema = z.strictObject({ x: z.number().finite().min(-100_000).max(100_000), y: z.number().finite().min(-100_000).max(100_000) });

export const SearchResultSchema = z.strictObject({
  channel: ChannelFaceSchema,
  portrait: ChannelPortraitSchema.nullable().optional(),
  /** Observed average audience over the survey window, rounded. */
  average: UIntSchema.nullable(),
  position: PencilPointSchema.optional(),
  language: z.string().min(1).max(16),
});

export const SearchReplySchema = z.strictObject({
  ...Reply,
  kind: z.literal(`${DIRECTORY_KIND}-search`),
  /** The normalized key that was searched, so a reader can tell which reply answers which keystroke. */
  key: z.string().min(1).max(200),
  results: z.array(SearchResultSchema).max(MAX_RESULTS),
  /** More channels matched than were returned. */
  more: z.boolean(),
  unavailable: z.enum(['disabled', 'limited', 'upstream']).optional(),
});
export type SearchReply = z.infer<typeof SearchReplySchema>;

/** Raid aggregates between two channels: counts and travellers summed over the survey, never individual raids. */
export const RoadTallySchema = z.strictObject({
  raids: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  travellers: UIntSchema,
  lastAt: EpochMsSchema,
});

const RoadWindowSchema = z.strictObject({
  /** The raid watch's observations run from the survey's first sweep to the raid inventory's cut. */
  from: EpochMsSchema,
  to: EpochMsSchema,
});

const CoverageSchema = z.strictObject({
  raidWatch: z.strictObject({ enabled: z.boolean(), watching: UIntSchema, liveCandidates: UIntSchema }),
  /** The source collects no content labels; unknown is never upgraded to general. */
  contentLabels: z.literal('not-collected'),
});

export const CardRoadSchema = z.strictObject({
  other: ChannelFaceSchema,
  /** Raids from the card's channel to the other, and back. */
  sent: UIntSchema,
  received: UIntSchema,
  travellers: UIntSchema,
  lastAt: EpochMsSchema,
});
export type CardRoad = z.infer<typeof CardRoadSchema>;

export const CardReplySchema = z.strictObject({
  ...Reply,
  kind: z.literal(`${DIRECTORY_KIND}-card`),
  channel: ChannelFaceSchema,
  portrait: ChannelPortraitSchema.nullable().optional(),
  average: UIntSchema.nullable(),
  position: PencilPointSchema.optional(),
  language: z.string().min(1).max(16),
  firstSeenAt: EpochMsSchema.nullable(),
  lastLiveAt: EpochMsSchema.nullable(),
  /** The last stream the survey saw, kept until a day after the channel was last live. */
  stream: z.strictObject({
    live: z.boolean(),
    game: z.string().min(1).max(256).nullable(),
    title: z.string().max(512).nullable(),
    viewers: UIntSchema.nullable(),
    startedAt: EpochMsSchema.nullable(),
  }).nullable(),
  roads: z.strictObject({
    window: RoadWindowSchema,
    /** Counterparts the card may show (the gate removes the others before counting). */
    total: UIntSchema,
    strongest: z.array(CardRoadSchema).max(CARD_ROADS),
  }).nullable(),
  coverage: CoverageSchema,
});
export type CardReply = z.infer<typeof CardReplySchema>;

export const RoadReplySchema = z.strictObject({
  ...Reply,
  kind: z.literal(`${DIRECTORY_KIND}-road`),
  a: ChannelFaceSchema,
  b: ChannelFaceSchema,
  aToB: RoadTallySchema.nullable(),
  bToA: RoadTallySchema.nullable(),
  window: RoadWindowSchema,
  coverage: CoverageSchema,
});
export type RoadReply = z.infer<typeof RoadReplySchema>;
