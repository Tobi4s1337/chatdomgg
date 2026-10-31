import { EpochMsSchema, TokenSchema } from '@chatdom/shared';
import { z } from '../../../web/src/twitch-moments/zod';

/** Raw provider envelopes are server-only. Nothing in this file is ever sent to a browser or written to a record. */
export const PROVIDER_MESSAGE_BYTES = 64 * 1024;

const RFC3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u;
/** Twitch sends nanosecond RFC3339; keep exact milliseconds without trusting a lenient date parser. */
export function parseProviderTime(value: string): number | null {
  const match = RFC3339.exec(value);
  if (!match) return null;
  const ms = Date.parse(`${match[1]}.${(match[2] ?? '').padEnd(3, '0').slice(0, 3)}${match[3]}`);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export const ProviderTimeSchema = z.string().max(40).transform((value, ctx) => {
  const ms = parseProviderTime(value);
  if (ms === null) { ctx.addIssue({ code: 'custom', message: 'Not an RFC3339 provider time' }); return z.NEVER; }
  return ms;
});

/**
 * One authenticated delivery, as the injected transport hands it over: the delivery ID, the subscription it
 * actually belongs to, the provider and local clocks, the verified source origin and the exact event body.
 * The event body stays `unknown` here and is parsed by its own normalizer.
 */
export const ProviderNotificationSchema = z.strictObject({
  deliveryId: TokenSchema,
  subscription: z.strictObject({
    id: TokenSchema,
    type: z.string().min(3).max(96).regex(/^[a-z][a-z0-9_.]*$/u),
    version: z.string().min(1).max(8).regex(/^[a-z0-9]+$/u),
    condition: z.record(z.string().regex(/^[a-z_]{1,40}$/u), z.string().max(64)).refine(c => Object.keys(c).length <= 8, 'Too many condition fields'),
  }),
  occurredAt: EpochMsSchema,
  receivedAt: EpochMsSchema,
  origin: z.enum(['live', 'simulated']),
  event: z.unknown(),
});
export type ProviderNotification = z.infer<typeof ProviderNotificationSchema>;

const WireSubscription = z.object({
  id: z.string(), type: z.string(), version: z.string(), condition: z.record(z.string(), z.string()),
});

const WebSocketNotification = z.object({
  metadata: z.object({ message_id: z.string(), message_type: z.literal('notification'), message_timestamp: ProviderTimeSchema }),
  payload: z.object({ subscription: WireSubscription, event: z.unknown() }),
});

export type ProviderParse = { ok: true; notification: ProviderNotification } | { ok: false; reason: 'oversize' | 'malformed' };

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

/**
 * Transport wrapper for an authenticated EventSub WebSocket/conduit shard frame. The byte limit applies before
 * JSON parsing. The local receipt time comes from the transport, never from the payload.
 */
export function fromEventSubWebSocketFrame(text: string, receivedAt: number, origin: 'live' | 'simulated'): ProviderParse {
  if (text.length > PROVIDER_MESSAGE_BYTES || byteLength(text) > PROVIDER_MESSAGE_BYTES) return { ok: false, reason: 'oversize' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'malformed' }; }
  const frame = WebSocketNotification.safeParse(raw);
  if (!frame.success) return { ok: false, reason: 'malformed' };
  const { metadata, payload } = frame.data;
  const parsed = ProviderNotificationSchema.safeParse({ deliveryId: metadata.message_id, subscription: payload.subscription,
    occurredAt: metadata.message_timestamp, receivedAt, origin, event: payload.event });
  return parsed.success ? { ok: true, notification: parsed.data } : { ok: false, reason: 'malformed' };
}

/** Transport wrapper for an HMAC-verified webhook delivery; the message headers carry ID and timestamp. */
export function fromEventSubWebhook(headers: { messageId: string; messageTimestamp: string }, body: string, receivedAt: number,
  origin: 'live' | 'simulated'): ProviderParse {
  if (body.length > PROVIDER_MESSAGE_BYTES || byteLength(body) > PROVIDER_MESSAGE_BYTES) return { ok: false, reason: 'oversize' };
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return { ok: false, reason: 'malformed' }; }
  const occurredAt = parseProviderTime(headers.messageTimestamp);
  const envelope = z.object({ subscription: WireSubscription, event: z.unknown() }).safeParse(raw);
  if (!envelope.success || occurredAt === null) return { ok: false, reason: 'malformed' };
  const parsed = ProviderNotificationSchema.safeParse({ deliveryId: headers.messageId, subscription: envelope.data.subscription,
    occurredAt, receivedAt, origin, event: envelope.data.event });
  return parsed.success ? { ok: true, notification: parsed.data } : { ok: false, reason: 'malformed' };
}
