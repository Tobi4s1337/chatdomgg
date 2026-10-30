import { TwitchIdSchema } from '@chatdom/shared';
import { z } from 'zod';
import { EventSubIdSchema, type EventSubSubscription } from './admin';

/** Frames beyond this are malformed for our purposes; a chat notification is a few kilobytes. */
export const MAX_FRAME_CHARS = 256 * 1024;

const MessageIdSchema = z.string().min(1).max(128);

/** RFC3339 with up to nanoseconds, always UTC/offset. Returns epoch milliseconds, or null. */
export function parseTwitchTime(raw: string): number | null {
  if (raw.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at >= 0 ? at : null;
}

const TimeSchema = z.string().transform((raw, ctx) => {
  const at = parseTwitchTime(raw);
  if (at === null) {
    ctx.addIssue({ code: 'custom', message: 'Invalid timestamp' });
    return z.NEVER;
  }
  return at;
});

const MetadataSchema = z.object({
  message_id: MessageIdSchema,
  message_type: z.string().max(32),
  message_timestamp: TimeSchema,
  subscription_type: z.string().max(128).nullish(),
  subscription_version: z.string().max(16).nullish(),
});

const SessionSchema = z.object({
  id: z.string().min(1).max(256),
  status: z.string().max(32),
  keepalive_timeout_seconds: z.number().int().min(1).max(600).nullish(),
  reconnect_url: z.string().max(2_048).nullish(),
});

const FrameSubscriptionSchema = z.object({
  id: EventSubIdSchema,
  status: z.string().max(64),
  type: z.string().max(128),
  version: z.string().max(16),
  condition: z.record(z.string().max(64), z.string().max(128)),
  transport: z.object({ method: z.string().max(16), conduit_id: z.string().max(128).nullish() }),
});

export interface FrameMetadata {
  /** Twitch's delivery ID. A resend repeats it; it is not a chat message ID. */
  readonly messageId: string;
  readonly at: number;
}

export type EventSubFrame =
  | { readonly kind: 'welcome'; readonly meta: FrameMetadata; readonly sessionId: string; readonly keepaliveSeconds: number }
  | { readonly kind: 'keepalive'; readonly meta: FrameMetadata }
  | { readonly kind: 'reconnect'; readonly meta: FrameMetadata; readonly reconnectUrl: string }
  | { readonly kind: 'notification'; readonly meta: FrameMetadata; readonly subscription: EventSubSubscription; readonly event: unknown }
  | { readonly kind: 'revocation'; readonly meta: FrameMetadata; readonly subscription: EventSubSubscription };

/**
 * Parses one WebSocket text frame. Returns null for anything malformed or of an unknown message type; the
 * raw text is never kept or reported. A notification's `event` stays unparsed here and must go through one
 * of the narrow event schemas below, which drop every field presence does not use (including chat text).
 */
export function parseFrame(text: string): EventSubFrame | null {
  if (text.length > MAX_FRAME_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const envelope = z.object({ metadata: MetadataSchema, payload: z.unknown() }).safeParse(raw);
  if (!envelope.success) return null;
  const { metadata, payload } = envelope.data;
  const meta: FrameMetadata = { messageId: metadata.message_id, at: metadata.message_timestamp };
  switch (metadata.message_type) {
    case 'session_welcome': {
      const parsed = z.object({ session: SessionSchema }).safeParse(payload);
      if (!parsed.success) return null;
      return { kind: 'welcome', meta, sessionId: parsed.data.session.id, keepaliveSeconds: parsed.data.session.keepalive_timeout_seconds ?? 10 };
    }
    case 'session_keepalive':
      return { kind: 'keepalive', meta };
    case 'session_reconnect': {
      const parsed = z.object({ session: SessionSchema }).safeParse(payload);
      const url = parsed.success ? parsed.data.session.reconnect_url : null;
      return url ? { kind: 'reconnect', meta, reconnectUrl: url } : null;
    }
    case 'notification': {
      const parsed = z.object({ subscription: FrameSubscriptionSchema, event: z.unknown() }).safeParse(payload);
      if (!parsed.success || parsed.data.event === undefined) return null;
      if (metadata.subscription_type && metadata.subscription_type !== parsed.data.subscription.type) return null;
      return { kind: 'notification', meta, subscription: toSubscription(parsed.data.subscription), event: parsed.data.event };
    }
    case 'revocation': {
      const parsed = z.object({ subscription: FrameSubscriptionSchema }).safeParse(payload);
      return parsed.success ? { kind: 'revocation', meta, subscription: toSubscription(parsed.data.subscription) } : null;
    }
    default:
      return null;
  }
}

function toSubscription(wire: z.infer<typeof FrameSubscriptionSchema>): EventSubSubscription {
  return {
    id: wire.id, status: wire.status, type: wire.type, version: wire.version, condition: { ...wire.condition },
    conduitId: wire.transport.method === 'conduit' ? wire.transport.conduit_id ?? null : null,
  };
}

/*
 * The seven v1 event payloads Herald reads, each reduced to identity and key fields. zod objects drop
 * unknown keys, so `message.text`, fragments, badges, colours, replies and cheer data never leave parsing.
 */
const NullableId = TwitchIdSchema.nullish();

export const ChatMessageEventSchema = z.object({
  broadcaster_user_id: TwitchIdSchema,
  chatter_user_id: TwitchIdSchema,
  chatter_user_name: z.string().max(256),
  message_id: MessageIdSchema,
  /** Set when the message was sent in another channel of a shared chat session. */
  source_broadcaster_user_id: NullableId,
});
export const ChatMessageDeleteEventSchema = z.object({
  broadcaster_user_id: TwitchIdSchema,
  target_user_id: TwitchIdSchema,
  message_id: MessageIdSchema,
});
export const ChatClearEventSchema = z.object({ broadcaster_user_id: TwitchIdSchema });
export const ChatClearUserMessagesEventSchema = z.object({ broadcaster_user_id: TwitchIdSchema, target_user_id: TwitchIdSchema });
export const StreamOnlineEventSchema = z.object({
  id: z.string().min(1).max(64),
  broadcaster_user_id: TwitchIdSchema,
  /** `live`, `playlist`, `watch_party`, `premiere` or `rerun`. Only `live` is a broadcast. */
  type: z.string().max(32),
  started_at: TimeSchema.nullish(),
});
export const StreamOfflineEventSchema = z.object({ broadcaster_user_id: TwitchIdSchema });
export const AuthorizationRevokeEventSchema = z.object({ client_id: z.string().max(64), user_id: TwitchIdSchema });
