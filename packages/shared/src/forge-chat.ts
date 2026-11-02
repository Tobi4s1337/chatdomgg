import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, TokenSchema, type KingdomId, type PersonId } from './identity';
import { FORGE_WISH_WORDS_MAX } from './forge-words';

/** The Forge's optional chat grant is separate from the openid-only sign-in grant. */
export const FORGE_CHAT_SCOPE = 'user:write:chat' as const;
export const FORGE_CHAT_ROUTES = {
  status: '/api/realm/forge/chat/status',
  authorize: '/api/realm/forge/chat/authorize',
  callback: '/api/realm/forge/chat/callback',
  wish: '/api/realm/forge/chat/wish',
  revoke: '/api/realm/forge/chat/revoke',
} as const;
export const FORGE_CHAT_LIMITS = {
  /** Matches the Herald/Forge intake. Never silently truncate a longer wish. */
  words: FORGE_WISH_WORDS_MAX,
  bodyBytes: 4096,
  stateTtlMs: 10 * 60_000,
  /** Detailed receipt retention; an expired request keeps a durable no-resend tombstone. */
  requestRetentionMs: 24 * 60 * 60_000,
  pollMs: 2000,
  slowPollMs: 10_000,
  validationMs: 60 * 60_000,
} as const;

export const ForgeChatRequestIdSchema = z.string().uuid();
const Version = z.literal(1);
const Message = z.string().min(1).max(240);
const Target = { version: Version, kingdomId: KingdomIdSchema };
/** GET query parser supplies the literal version, since URL query values are strings. */
export const ForgeChatStatusRequestSchema = z.strictObject({
  ...Target, requestId: ForgeChatRequestIdSchema.optional(),
});
export const ForgeChatAuthorizeRequestSchema = z.strictObject(Target);
export const ForgeChatRevokeRequestSchema = z.strictObject({ version: Version });
/** Identity and the target Twitch broadcaster are resolved by the server, never accepted from this body. */
export const ForgeChatWishRequestSchema = z.strictObject({
  ...Target, requestId: ForgeChatRequestIdSchema,
  words: z.string().trim().min(1).max(FORGE_CHAT_LIMITS.words)
    .refine(value => ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), 'A wish must fit on one chat line'),
});

/** This is authorization to send as this session's person, not permission to spend coal or forge. */
export const ForgeChatGrantSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('signed-out') }),
  z.strictObject({ status: z.literal('required'), reason: z.enum(['not-granted', 'expired', 'revoked']) }),
  z.strictObject({ status: z.literal('ready') }),
  z.strictObject({ status: z.literal('unavailable'), reason: z.enum(['not-configured', 'service-unavailable']), message: Message }),
]);
/** Advisory only. The existing authority still checks live/coal/home/moderation at reserve and commit. */
export const ForgeChatAvailabilitySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready') }),
  z.strictObject({ status: z.literal('cold'), reason: z.enum(['stream-offline', 'service-unavailable']), message: Message }),
]);

const Wish = { requestId: ForgeChatRequestIdSchema, kingdomId: KingdomIdSchema, updatedAt: EpochMsSchema };
const Witness = {
  /** Returned only after a successful Twitch send; never used as proof that a piece exists. */
  messageId: TokenSchema,
  /** The existing private receipt id: forge: + the first 48 hex digits of SHA-256(messageId). */
  receiptId: TokenSchema,
};
/** Owner-only transport/progress projection. No wish words, safety evidence, token or raw provider response. */
export const ForgeChatWishSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...Wish, status: z.literal('sending') }),
  z.strictObject({ ...Wish, status: z.literal('unknown'), message: Message }),
  z.strictObject({ ...Wish, ...Witness, status: z.literal('sent') }),
  z.strictObject({ ...Wish, ...Witness, status: z.literal('working') }),
  z.strictObject({ ...Wish, ...Witness, status: z.literal('delivered'), attachmentId: TokenSchema,
    committedAt: EpochMsSchema, message: Message.optional() }),
  z.strictObject({ ...Wish, ...Witness, status: z.literal('held'), message: Message }),
  z.strictObject({ ...Wish, ...Witness, status: z.literal('refused'), message: Message }),
  z.strictObject({ ...Wish, ...Witness, status: z.literal('cold'), message: Message }),
  z.strictObject({ ...Wish, ...Witness, status: z.literal('canceled'), message: Message }),
  z.strictObject({ ...Wish, status: z.literal('not-sent'),
    reason: z.enum(['consent-required', 'stream-offline', 'service-unavailable', 'rate-limited', 'chat-dropped']),
    message: Message, retryAt: EpochMsSchema.optional() }),
]);

export const ForgeChatStatusReplySchema = z.strictObject({
  version: Version, status: z.literal('ok'), kingdomId: KingdomIdSchema,
  grant: ForgeChatGrantSchema, availability: ForgeChatAvailabilitySchema,
  /** Exact requested id, or the latest retained request for this person and kingdom. Never another owner. */
  wish: ForgeChatWishSchema.nullable(),
}).refine(reply => reply.wish === null || reply.wish.kingdomId === reply.kingdomId,
  'The wish must belong to the requested kingdom');
export const ForgeChatAuthorizeReplySchema = z.strictObject({
  version: Version, status: z.literal('authorize'),
  /** Only this fixed Twitch origin/path is a browser navigation target. */
  authorizationUrl: z.string().url().max(4096).refine(value => {
    const url = new URL(value);
    return url.origin === 'https://id.twitch.tv' && url.pathname === '/oauth2/authorize'
      && !url.username && !url.password && !url.hash;
  }, 'Authorization must open Twitch'),
});
/** The accepted request may still be sending, unknown or not-sent. It never promises delivery. */
export const ForgeChatWishReplySchema = z.strictObject({ version: Version, status: z.literal('accepted'), wish: ForgeChatWishSchema });
export const ForgeChatRevokeReplySchema = z.strictObject({ version: Version, status: z.literal('revoked') });
export const ForgeChatErrorSchema = z.strictObject({
  version: Version, status: z.literal('error'),
  code: z.enum(['unauthenticated', 'forbidden', 'invalid-request', 'request-conflict', 'request-expired', 'consent-required',
    'not-configured', 'unavailable', 'rate-limited']),
  message: Message, retryAt: EpochMsSchema.optional(),
});

export type ForgeChatStatusRequest = z.infer<typeof ForgeChatStatusRequestSchema>;
export type ForgeChatAuthorizeRequest = z.infer<typeof ForgeChatAuthorizeRequestSchema>;
export type ForgeChatWishRequest = z.infer<typeof ForgeChatWishRequestSchema>;
export type ForgeChatRevokeRequest = z.infer<typeof ForgeChatRevokeRequestSchema>;
export type ForgeChatGrant = z.infer<typeof ForgeChatGrantSchema>;
export type ForgeChatAvailability = z.infer<typeof ForgeChatAvailabilitySchema>;
export type ForgeChatWish = z.infer<typeof ForgeChatWishSchema>;
export type ForgeChatStatusReply = z.infer<typeof ForgeChatStatusReplySchema>;
export type ForgeChatAuthorizeReply = z.infer<typeof ForgeChatAuthorizeReplySchema>;
export type ForgeChatWishReply = z.infer<typeof ForgeChatWishReplySchema>;
export type ForgeChatRevokeReply = z.infer<typeof ForgeChatRevokeReplySchema>;
export type ForgeChatError = z.infer<typeof ForgeChatErrorSchema>;

/** Internal private seam from the existing Herald/realm run, never a browser or public-event contract. */
export type ForgeChatObservation = {
  readonly origin: 'live' | 'simulated';
  readonly kingdomId: KingdomId;
  readonly personId: PersonId;
  readonly messageId: string;
  readonly at: number;
} & (
  | { readonly status: 'working' }
  | { readonly status: 'delivered'; readonly attachmentId: string; readonly committedAt: number; readonly message?: string }
  | { readonly status: 'held' | 'refused' | 'cold' | 'canceled'; readonly message: string }
);
/** Await/catch at the bridge boundary. Observer failure must never alter the authoritative Forge outcome. */
export type ForgeChatObserver = (observation: ForgeChatObservation) => Promise<void>;
