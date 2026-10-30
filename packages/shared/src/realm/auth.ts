import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema } from '../identity';
import { RealmJoinSchema } from './messages';

/** Same-origin API session routes. Cookies/tickets are private and responses use Cache-Control:no-store. */
export const REALM_AUTH_ROUTES = {
  session: '/api/realm/session', start: '/api/realm/auth/start', callback: '/api/realm/auth/callback',
  ticket: '/api/realm/ticket', signout: '/api/realm/signout',
} as const;
export const RealmSessionReplySchema = z.discriminatedUnion('status', [
  z.strictObject({ version: z.literal(1), status: z.literal('anonymous') }),
  z.strictObject({ version: z.literal(1), status: z.literal('authenticated'), expiresAt: EpochMsSchema,
    /** Opaque browser storage partition, stable for this Chatdom session. Never an auth credential or person ID. */
    resumeScope: z.string().min(16).max(128), csrfToken: z.string().min(32).max(256) }),
]);
export const RealmTicketRequestSchema = z.strictObject({ version: z.literal(1), kingdomId: KingdomIdSchema, protocol: z.literal(1) });
export const RealmTicketReplySchema = z.strictObject({ version: z.literal(1), status: z.literal('issued'), join: RealmJoinSchema, expiresAt: EpochMsSchema });
export const RealmSignoutReplySchema = z.strictObject({ version: z.literal(1), status: z.literal('signed-out') });
export const RealmApiErrorSchema = z.strictObject({ version: z.literal(1), status: z.enum(['unauthenticated', 'refused', 'unavailable']), message: z.string().min(1).max(240) });
export type RealmSessionReply = z.infer<typeof RealmSessionReplySchema>;
export type RealmTicketRequest = z.infer<typeof RealmTicketRequestSchema>;
export type RealmTicketReply = z.infer<typeof RealmTicketReplySchema>;
export type RealmSignoutReply = z.infer<typeof RealmSignoutReplySchema>;
export type RealmApiError = z.infer<typeof RealmApiErrorSchema>;
