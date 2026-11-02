import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, truncateSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema } from '@chatdom/shared';

/**
 * A streamer's own choice to leave the Atlas (decision 39: every channel is on the map, with a self-serve hide).
 *
 * The log is append-only and lives beside the operator's withheld list. Only the Atlas service writes it, through
 * its private visibility endpoint, which only the signed-in session authority calls with the verified broadcaster
 * ID; every reader (serving, live paint, settlement, the check) folds its hidden channels into the withheld set, so a
 * hidden channel is gone from land, names, search, cards, roads and the wash exactly like a withheld one, and
 * published files never learn which of the two it was. The operator's list always wins: showing a channel again
 * lifts only the owner's own hide.
 */
export const OWNER_VISIBILITY_FILE = join('moderation', 'owner-visibility.ndjson');
export const ownerVisibilityPath = (dataDir: string) => join(dataDir, OWNER_VISIBILITY_FILE);

export const OWNER_ACTS = ['hide', 'show'] as const;
export type OwnerAct = typeof OWNER_ACTS[number];

export const OwnerVisibilityLineSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('chatdom-atlas-owner-visibility'),
  kingdomId: KingdomIdSchema,
  act: z.enum(OWNER_ACTS),
  /** When the broadcaster pressed the button, by the session authority's clock. */
  at: EpochMsSchema,
  /** When this service recorded it. Order in the file decides; this is only the record. */
  receivedAt: EpochMsSchema,
});
export type OwnerVisibilityLine = z.infer<typeof OwnerVisibilityLineSchema>;

/** What the session authority posts: only the act's time. The channel comes from the path, the path from the session. */
export const OwnerVisibilityRequestSchema = z.strictObject({
  version: z.literal(1),
  at: EpochMsSchema,
});

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The channels whose owner's latest act is `hide`, in file order. A torn last line (a crash mid-append) was never
 * acknowledged and is ignored; any other unreadable line is an error, because a hide must never silently lapse.
 */
export function parseOwnerHidden(text: string): Set<string> {
  const lines = text.split('\n');
  lines.pop();
  const hidden = new Set<string>();
  lines.forEach((raw, index) => {
    if (!raw) return;
    let line: OwnerVisibilityLine;
    try {
      line = OwnerVisibilityLineSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error(`owner visibility line ${index + 1} is unreadable`);
    }
    if (line.act === 'hide') hidden.add(line.kingdomId);
    else hidden.delete(line.kingdomId);
  });
  return hidden;
}

/** A stable content key for a hidden set: empty is `''`, so a service without any owner hide keys exactly as before. */
export function ownerHiddenKey(hidden: ReadonlySet<string>): string {
  if (hidden.size === 0) return '';
  const hash = createHash('sha256').update([...hidden].sort().join('\n')).digest('hex');
  return `+owner:${hash.slice(0, 16)}`;
}

/** One read of the log, for runs that must not fall back (settlement, live paint, founding). Throws when unreadable. */
export function readOwnerHidden(dataDir: string): ReadonlySet<string> {
  const path = ownerVisibilityPath(dataDir);
  if (!existsSync(path)) return EMPTY;
  return parseOwnerHidden(readFileSync(path, 'utf8'));
}

export interface OwnerHiddenReader {
  /** The current hidden set, re-read only when the file changes. An unreadable log keeps the last good set and reports. */
  current(): { ids: ReadonlySet<string>; key: string; error: string | null };
}

export function ownerHiddenReader(dataDir: string): OwnerHiddenReader {
  const path = ownerVisibilityPath(dataDir);
  let stamp = 'none';
  let ids: ReadonlySet<string> = EMPTY;
  let error: string | null = null;
  return {
    current() {
      let next: string;
      try {
        const stat = statSync(path);
        next = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
      } catch {
        if (existsSync(path)) return { ids, key: ownerHiddenKey(ids), error };
        stamp = 'none';
        ids = EMPTY;
        error = null;
        return { ids, key: '', error };
      }
      if (next !== stamp) {
        try {
          ids = parseOwnerHidden(readFileSync(path, 'utf8'));
          stamp = next;
          error = null;
        } catch (failure) {
          error = `owner visibility unreadable: ${failure instanceof Error ? failure.message.slice(0, 160) : String(failure)}`;
        }
      }
      return { ids, key: ownerHiddenKey(ids), error };
    },
  };
}

/**
 * Records one act and fsyncs it before returning, so a hide is durable before anyone is told it happened. An act
 * that changes nothing (hiding a hidden channel) writes nothing and answers `unchanged`. Single writer: the service
 * runs one handler at a time and this is synchronous, so concurrent identical presses record once.
 */
export function appendOwnerAct(dataDir: string, line: OwnerVisibilityLine, hiddenNow: ReadonlySet<string>): 'recorded' | 'unchanged' {
  const parsed = OwnerVisibilityLineSchema.parse(line);
  if ((parsed.act === 'hide') === hiddenNow.has(parsed.kingdomId)) return 'unchanged';
  mkdirSync(join(dataDir, 'moderation'), { recursive: true });
  const path = ownerVisibilityPath(dataDir);
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    if (bytes.length && bytes[bytes.length - 1] !== 0x0a) truncateSync(path, bytes.lastIndexOf(0x0a) + 1);
  }
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, `${JSON.stringify(parsed)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return 'recorded';
}
