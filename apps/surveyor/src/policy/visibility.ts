import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema } from '@chatdom/shared';
import { RAW_CONTENT_MAX_AGE_MS, type ChannelObservation } from '../export/schema';

/**
 * The one public-visibility gate (Spec 01 R16). Everything this service publishes about a channel (land, holding,
 * name, card) passes through `publicVisibility` first. Reasons stay inside the service: published files only ever
 * learn that a channel is absent or unnamed, never why.
 */

/**
 * Twitch's real-money gambling categories, by game ID (names drift; IDs do not). Simulation and video games that
 * merely mention casinos or poker are games, not gambling streams, and stay on the map. Changing this list is a
 * policy change: bump the version so every published preview records which list it was drawn under.
 */
export const GAMBLING_POLICY = {
  version: 'gambling-categories-1',
  gameIds: [
    '498566', // Slots (formerly "Slots & Casino")
    '29452', // Virtual Casino
    '488190', // Poker
  ],
  /** A channel is a gambling channel when gambling categories hold at least this share of its observed minutes. */
  minShare: 0.25,
} as const;

const GAMBLING = new Set<string>(GAMBLING_POLICY.gameIds);

export function isGamblingCategory(gameId: string | null | undefined): boolean {
  return gameId != null && GAMBLING.has(gameId);
}

/** Share of the channel's observed category minutes spent in gambling categories (0 when none were observed). */
export function gamblingShare(channel: Pick<ChannelObservation, 'categories'>): number {
  let total = 0;
  let gambling = 0;
  for (const category of channel.categories) {
    total += category.minutes;
    if (GAMBLING.has(category.gameId)) gambling += category.minutes;
  }
  return total > 0 ? gambling / total : 0;
}

export type Visibility = 'public' | 'gone' | 'gambling' | 'withheld';

/**
 * Whether a channel may appear on the public map at all. Gambling is judged on the observed minutes and on the
 * stream in progress, so a gambling stream never shows even when its history was elsewhere.
 */
export function publicVisibility(
  channel: Pick<ChannelObservation, 'kingdomId' | 'categories' | 'goneAt' | 'stream'>,
  withheld: ReadonlySet<string> = EMPTY,
): Visibility {
  if (channel.goneAt !== null) return 'gone';
  if (withheld.has(channel.kingdomId)) return 'withheld';
  if (isGamblingCategory(channel.stream?.gameId) || gamblingShare(channel) >= GAMBLING_POLICY.minShare) return 'gambling';
  return 'public';
}

const EMPTY: ReadonlySet<string> = new Set();

/** A raw name may be shown only while the source confirmed it within the last day. */
export function nameFreshUntil(factsAt: number): number {
  return factsAt + RAW_CONTENT_MAX_AGE_MS;
}

/**
 * Channels withheld from the public map by moderation: hidden by their owner, removed, or with a name pulled by
 * name moderation. Kept in this service's own data directory and read on every change, so a withholding takes
 * effect at the next request without redrawing land. It carries no reasons; those live with whoever decided.
 */
export const WITHHELD_FILE = join('moderation', 'withheld.json');
export const WithheldSchema = z.strictObject({
  version: z.literal(1),
  updatedAt: EpochMsSchema,
  kingdomIds: z.array(KingdomIdSchema).max(1_000_000),
});
export type Withheld = z.infer<typeof WithheldSchema>;

export interface WithheldReader {
  /** The current set. A file that cannot be read keeps the last good set; a first unreadable file withholds nothing but is reported. */
  current(): { ids: ReadonlySet<string>; key: string; error: string | null };
}

export function withheldReader(dataDir: string): WithheldReader {
  const path = join(dataDir, WITHHELD_FILE);
  let key = 'none';
  let ids: ReadonlySet<string> = EMPTY;
  let error: string | null = null;
  return {
    current() {
      if (!existsSync(path)) {
        key = 'none';
        ids = EMPTY;
        error = null;
        return { ids, key, error };
      }
      let next: string;
      try {
        const stat = statSync(path);
        next = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
      } catch {
        return { ids, key, error };
      }
      if (next === key) return { ids, key, error };
      try {
        const parsed = WithheldSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        ids = new Set(parsed.kingdomIds);
        key = next;
        error = null;
      } catch (failure) {
        error = `withheld list unreadable: ${failure instanceof Error ? failure.message.slice(0, 160) : String(failure)}`;
      }
      return { ids, key, error };
    },
  };
}
