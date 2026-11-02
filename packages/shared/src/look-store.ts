import { z } from 'zod';
import { KingdomIdSchema } from './identity';
import { CITIZEN_STARTER_LOOKS } from './citizen-look';

/*
 * A person's saved look travels as a content token in the walker's existing `look` string: `lk.` plus the first 40
 * hex characters of the SHA-256 of the canonical recipe. A token never changes meaning, so its recipe is public,
 * immutable and cacheable for ever. The six starter ids stay valid tokens. Recipes are validated with `parseLook`
 * from `@chatdom/content/avatar-style`; this file stays free of the content package, so `look` is `unknown` here.
 */
export const LOOK_TOKEN = /^lk\.[a-f0-9]{40}$/;
export const LookTokenSchema = z.string().regex(LOOK_TOKEN);

/** A saved look's token, or one of the six free starter ids. */
export function isLookToken(value: unknown): value is string {
  return typeof value === 'string' && (LOOK_TOKEN.test(value) || (CITIZEN_STARTER_LOOKS as readonly string[]).includes(value));
}
export const AnyLookTokenSchema = z.string().max(64).refine(isLookToken, 'Not a look token');

/** Served by the realm, on the public origin, behind the gateway's `/api/realm/looks/` line. */
export const REALM_LOOK_ROUTES = {
  /** GET, public, immutable: `RealmLookRecipeReply`. `:token` is a look token or a starter id. */
  recipe: '/api/realm/looks/:token',
  /**
   * GET with the signed-in session cookie (`?kingdom=<id>` for the records of that kingdom): `RealmLookMineReply`.
   * PUT with the session cookie and `x-csrf-token` (the token `/api/realm/session` gives): `RealmLookSaveRequest`
   * in, `RealmLookSaveReply` out. The person is always the session's; a body never names one.
   */
  mine: '/api/realm/looks/me',
  /**
   * POST with the session cookie and `x-csrf-token`, `?kingdom=<id>`, no body: "Take your place". Grants the
   * signed-in person a home in that kingdom through the same allocation chat and the panel use: `RealmHomePlaceReply`.
   * Idempotent: asking again answers with the home already granted.
   */
  place: '/api/realm/looks/place',
} as const;

export function lookRecipeUrl(token: string): string {
  if (!isLookToken(token)) throw new Error('Not a look token');
  return REALM_LOOK_ROUTES.recipe.replace(':token', token);
}

export const RealmLookRecipeReplySchema = z.strictObject({
  version: z.literal(1),
  token: AnyLookTokenSchema,
  look: z.unknown(),
});
export type RealmLookRecipeReply = z.infer<typeof RealmLookRecipeReplySchema>;

/** A piece granted to a person on the server (the Forge's worn twin, decision 24). Shown with its card; worn once its recipe fits. */
export const RealmWardrobeGrantSchema = z.strictObject({
  pieceId: z.string().min(1).max(128),
  slot: z.enum(['hat', 'held', 'back', 'neck', 'badge']),
  source: z.literal('forge'),
  title: z.string().min(1).max(120),
  grantedAt: z.number().int().nonnegative(),
  recipe: z.unknown(),
});
export type RealmWardrobeGrant = z.infer<typeof RealmWardrobeGrantSchema>;

/** Twitch serves profile pictures only from its static CDN; anything else is not a picture of the person. */
export const TWITCH_PICTURE_ORIGIN = 'https://static-cdn.jtvnw.net/';
export const TwitchPictureUrlSchema = z.string().max(512).refine(value => {
  if (!value.startsWith(TWITCH_PICTURE_ORIGIN)) return false;
  try { const url = new URL(value); return url.origin === 'https://static-cdn.jtvnw.net' && !url.username && !url.password; } catch { return false; }
}, 'Not a Twitch profile picture');

/** One home a person holds, from their deed: never more than three (a person keeps at most three homes). */
export const RealmCitizenHomeSchema = z.strictObject({
  kingdomId: KingdomIdSchema,
  /** The host-approved name; `this kingdom` for the asked kingdom without one, `a kingdom not yet named` elsewhere. */
  kingdomName: z.string().min(1).max(128),
  street: z.string().min(1).max(128),
  plotId: z.string().min(1).max(128),
  /** When the deed was granted (`realm_deeds.allocated_ms`). */
  since: z.number().int().nonnegative(),
  /** The kingdom that was asked about. */
  here: z.boolean(),
});
export type RealmCitizenHome = z.infer<typeof RealmCitizenHomeSchema>;

/**
 * What the realm really knows about the signed-in person, for their card. Every field has a source; one without a
 * source is null or empty, never a guess. `since` is when their home in the asked kingdom was granted.
 */
export const RealmCitizenFactsSchema = z.strictObject({
  picture: TwitchPictureUrlSchema.nullable(),
  since: z.number().int().nonnegative().nullable(),
  homes: z.array(RealmCitizenHomeSchema).max(3),
});
export type RealmCitizenFacts = z.infer<typeof RealmCitizenFactsSchema>;

export const RealmLookMineReplySchema = z.discriminatedUnion('status', [
  z.strictObject({
    version: z.literal(1), status: z.literal('saved'),
    token: LookTokenSchema, look: z.unknown(), savedAt: z.number().int().nonnegative(),
    /** `CitizenEntitlements` from verified records in the asked kingdom: what the server will accept. */
    entitlements: z.unknown(), granted: z.array(RealmWardrobeGrantSchema),
    /** The card's facts, when a kingdom was asked and the realm could read them; absent otherwise. */
    citizen: RealmCitizenFactsSchema.optional(),
  }),
  z.strictObject({
    /** Signed in, never saved: they still walk in their starter, and the mirror asks for three picks. */
    version: z.literal(1), status: z.literal('none'), starter: AnyLookTokenSchema,
    entitlements: z.unknown(), granted: z.array(RealmWardrobeGrantSchema),
    citizen: RealmCitizenFactsSchema.optional(),
  }),
  z.strictObject({ version: z.literal(1), status: z.literal('anonymous') }),
]);
export type RealmLookMineReply = z.infer<typeof RealmLookMineReplySchema>;

export const RealmLookSaveRequestSchema = z.strictObject({
  version: z.literal(1),
  look: z.unknown(),
  /** The kingdom whose verified records the earned pieces are checked against. Omit to wear no kingdom-bound piece. */
  kingdomId: KingdomIdSchema.optional(),
});
export type RealmLookSaveRequest = z.infer<typeof RealmLookSaveRequestSchema>;

export const LOOK_SAVE_REFUSALS = ['unauthenticated', 'forbidden', 'malformed', 'unearned', 'unsuitable', 'busy', 'unavailable'] as const;
export const RealmLookSaveReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ version: z.literal(1), ok: z.literal(true), token: LookTokenSchema, look: z.unknown(), savedAt: z.number().int().nonnegative() }),
  /** `reason` is a sentence for the person, in the kingdom's voice; `code` is for the client's logic. */
  z.strictObject({ version: z.literal(1), ok: z.literal(false), code: z.enum(LOOK_SAVE_REFUSALS), reason: z.string().min(1).max(400) }),
]);
export type RealmLookSaveReply = z.infer<typeof RealmLookSaveReplySchema>;

/** Why a place was not granted. The domain answers (`castle` … `kingdom-full`) come with HTTP 409. */
export const HOME_PLACE_REFUSALS = ['unauthenticated', 'forbidden', 'malformed', 'unnamed', 'castle', 'unfounded', 'held',
  'three-homes', 'kingdom-full', 'busy', 'unavailable'] as const;
export type HomePlaceRefusal = typeof HOME_PLACE_REFUSALS[number];
export const RealmHomePlaceReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({
    version: z.literal(1), ok: z.literal(true),
    /** False when the home was already theirs: taking your place twice is the same home. */
    fresh: z.boolean(),
    home: z.strictObject({
      kingdomId: KingdomIdSchema,
      plotId: z.string().min(1).max(128),
      street: z.string().min(1).max(128),
      /** 'Number 4 on Lantern Row'. */
      place: z.string().min(1).max(200),
    }),
  }),
  /** `reason` is a sentence for the person; `code` is for the client's logic. */
  z.strictObject({ version: z.literal(1), ok: z.literal(false), code: z.enum(HOME_PLACE_REFUSALS), reason: z.string().min(1).max(400) }),
]);
export type RealmHomePlaceReply = z.infer<typeof RealmHomePlaceReplySchema>;
