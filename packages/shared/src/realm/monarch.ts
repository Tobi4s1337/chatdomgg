import { z } from 'zod';
import type { RealmPrincipal } from './messages';

/**
 * The monarch in the world (Monarch.md §7.6). Only the verified broadcaster of a kingdom is its monarch: a live,
 * provider-signed principal whose person is the kingdom's own channel. Nobody is ever named monarch by guess, by name
 * or by a staged sign-in.
 */
export const MONARCH_TITLES = ['Monarch', 'King', 'Queen'] as const;
export const MonarchTitleSchema = z.enum(MONARCH_TITLES);
export type MonarchTitle = z.infer<typeof MonarchTitleSchema>;
/** The title every kingdom starts with; "King" or "Queen" only when the streamer chooses it. */
export const DEFAULT_MONARCH_TITLE: MonarchTitle = 'Monarch';

/** The verified broadcaster only: a live sign-in whose person is the kingdom's own channel id. */
export function isVerifiedMonarch(principal: Pick<RealmPrincipal, 'personId' | 'kingdomId' | 'origin'>): boolean {
  const person: string = principal.personId, kingdom: string = principal.kingdomId;
  return principal.origin === 'live' && typeof person === 'string' && person.length > 0 && person === kingdom;
}

/** The streamer's own stored choice, or the default. Anything unreadable is the default, never a guess. */
export function monarchTitleOf(chosen: unknown): MonarchTitle {
  const parsed = MonarchTitleSchema.safeParse(chosen);
  return parsed.success ? parsed.data : DEFAULT_MONARCH_TITLE;
}

/** The walker's wire mark: the title while the walker is the verified monarch, else nothing. */
export function monarchCrownOf(mark: unknown): MonarchTitle | null {
  const parsed = MonarchTitleSchema.safeParse(mark);
  return parsed.success ? parsed.data : null;
}

/** The name tag over the monarch: "Monarch tobi4s_", "Queen Hazel"; the title alone when the name is withheld. */
export function monarchNameTag(title: MonarchTitle, name: string): string {
  const shown = name.trim();
  return shown ? `${title} ${shown}` : title;
}

export type ArrivalStanding = 'monarch' | 'citizen' | 'guest';
export interface ArrivalLineInput {
  /** The kingdom's approved name. */
  readonly kingdom: string;
  /** The verified broadcaster's public name, when the realm knows it. */
  readonly monarch: string | null;
  readonly standing: ArrivalStanding;
}

/**
 * The one calm line a person reads when they first arrive. A citizen is home, a guest is visiting, the monarch is
 * welcomed home to their own kingdom. Without the monarch's name the line names the kingdom only.
 */
export function arrivalLine(input: ArrivalLineInput): { readonly place: string; readonly standing: string } {
  const kingdom = input.kingdom.trim(), monarch = input.monarch?.trim() ?? '';
  if (input.standing === 'monarch') return { place: `${kingdom}, your kingdom`, standing: 'welcome home' };
  return { place: monarch ? `${kingdom}, the kingdom of ${monarch}` : kingdom,
    standing: input.standing === 'citizen' ? 'this is your home' : 'you are visiting' };
}

/** The room channel that answers who rules here and lets the monarch choose a title. */
export const MONARCH_CHANNEL = 'monarch';
export const MonarchChannelRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ version: z.literal(1), type: z.literal('who') }),
  z.strictObject({ version: z.literal(1), type: z.literal('title'), title: MonarchTitleSchema }),
]);
export type MonarchChannelRequest = z.infer<typeof MonarchChannelRequestSchema>;
export const MonarchChannelReplySchema = z.strictObject({
  version: z.literal(1), type: z.literal('monarch'),
  /** The verified broadcaster's public name, or null while the realm has none on record. */
  name: z.string().trim().min(1).max(64).nullable(),
  title: MonarchTitleSchema,
  /** True only on the reply to the verified monarch themselves. */
  you: z.boolean(),
});
export type MonarchChannelReply = z.infer<typeof MonarchChannelReplySchema>;
