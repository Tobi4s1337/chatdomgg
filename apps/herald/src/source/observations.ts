import {
  DisplayNameSchema, PersonIdSchema, PresenceInputSchema, TokenSchema,
  type KingdomId, type PresenceInput, type PresencePerson,
} from '@chatdom/shared';

/**
 * What Herald saw, already stripped to the fields presence may use. Real Twitch ingest and SIMULATED
 * replay both produce these, so both cross the same mapping into the shared reducer. No observation type
 * has room for message text, fragments, badges, colours or avatars.
 */
export type Observation =
  | { readonly kind: 'chat'; readonly messageId: string; readonly at: number; readonly author: { readonly id: string; readonly displayName: string } }
  | { readonly kind: 'chatters'; readonly sweepId: string; readonly at: number; readonly complete: boolean; readonly ids: readonly string[] }
  | { readonly kind: 'stream'; readonly at: number; readonly live: true; readonly streamId: string }
  | { readonly kind: 'stream'; readonly at: number; readonly live: false }
  | { readonly kind: 'user_clear'; readonly eventId: string; readonly at: number; readonly userId: string };

export type ObservationOrigin = 'live' | 'simulated';

/**
 * Chatdom's finite protective hold after `channel.chat.clear_user_messages`. It names our behavior, not
 * a Twitch ban or timeout duration, which this event does not carry.
 */
export const MODERATED_HOLD_MS = 600_000;

/** Bidi overrides/isolates and control characters never reach a window label. */
const UNSAFE_NAME = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/** A display name a window may carry, or null when nothing safe remains (the author then stays unnamed). */
export function publicDisplayName(raw: string): string | null {
  const cleaned = raw.replace(UNSAFE_NAME, '').trim();
  return DisplayNameSchema.safeParse(cleaned).success ? cleaned : null;
}

/**
 * Maps one observation into a validated trusted presence input, or null when it carries nothing presence
 * may act on. Input IDs are namespaced per key family: a delivery ID, chat message ID and stream ID are
 * different things and can never collide in the reducer's dedupe.
 */
export function toPresenceInput(observation: Observation, kingdomId: KingdomId, origin: ObservationOrigin): PresenceInput | null {
  const common = { version: 1 as const, kingdomId, observedAt: observation.at, origin };
  let input: PresenceInput;
  switch (observation.kind) {
    case 'chat': {
      const personId = PersonIdSchema.parse(observation.author.id);
      const displayName = publicDisplayName(observation.author.displayName);
      const person: PresencePerson = displayName === null ? { personId, disclosure: 'anonymous' } : { personId, disclosure: 'named', displayName };
      input = { ...common, id: token('chat', observation.messageId), kind: 'observe', source: 'chat', coverage: 'activity', people: [person] };
      break;
    }
    case 'chatters': {
      const unique = [...new Set(observation.ids)];
      const people = unique.map(id => ({ personId: PersonIdSchema.parse(id), disclosure: 'anonymous' as const }));
      input = { ...common, id: token('sweep', observation.sweepId), kind: 'observe', source: 'chatters', coverage: observation.complete ? 'complete' : 'partial', people };
      break;
    }
    case 'stream':
      input = observation.live
        ? { ...common, id: token('stream', `${observation.streamId}.${observation.at}`), kind: 'stream', live: true, sessionId: token('session', observation.streamId) }
        : { ...common, id: token('stream', `offline.${observation.at}`), kind: 'stream', live: false, sessionId: null };
      break;
    case 'user_clear':
      input = {
        ...common, id: token('clear', observation.eventId), kind: 'remove', personId: PersonIdSchema.parse(observation.userId),
        reason: 'moderated', until: observation.at + MODERATED_HOLD_MS,
      };
      break;
  }
  return PresenceInputSchema.parse(input);
}

/** A reducer input ID from a provider key. Keys that are not already safe tokens are rejected, not rewritten. */
function token(family: string, key: string): string {
  return TokenSchema.parse(`${family}:${key}`);
}
