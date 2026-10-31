import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ATLAS_LIMITS, ATLAS_SPECTACLE, AtlasLiveStartsSchema, AtlasManifestSchema, EpochMsSchema, KingdomIdSchema, encodeDabsV1,
  encodeLiveV2, sha256Hex, type AtlasDab, type AtlasLiveSlot, type AtlasManifest,
} from '@chatdom/shared';
import { GameIdSchema, SOURCE_SWEEP_CADENCE_MS, SOURCE_SWEEP_FLOOR_VIEWERS } from '../export/schema';
import { publicVisibility, type Visibility } from '../policy/visibility';
import type { SourceLiveSnapshot } from '../source/sqlite';
import type { LiveTarget } from './target';

/**
 * One live frame (Spec 01 R8, R11): the size class of every holding of a land, the real start of each live one, and
 * the small live channels without land as dabs. It is built only from a complete sweep. Bytes are the shared
 * live-v2 / live-starts-v1 / dabs-v1 formats, encoded by `@chatdom/shared`, never by a local writer.
 */

/**
 * Sweep rule `sweep-complete-1`. The collector writes a sweep's channels and its `sweeps` row in one transaction,
 * so the latest row always describes a whole write. Whether the sweep itself saw all of Twitch is judged here:
 *  - coherent: every live channel was seen by that sweep (`last_live` equals its time);
 *  - reached the floor: the collector pages by viewers and stops after a whole page below five viewers, so a
 *    finished sweep counted streams below the floor (`streams` minus the channels it kept live). A sweep cut
 *    short (call budget, timeout) never got there;
 *  - not collapsed: at least 60 % of the median stream count of the ten sweeps before it. Twitch rises and falls
 *    by time of day, but not by 40 % in three minutes (the real minimum over 400 sweeps was 93 %).
 * A sweep that fails any of these is partial: it never replaces a frame, and its absent channels never go offline.
 */
export const SWEEP_RULE = Object.freeze({ id: 'sweep-complete-1', minBelowFloor: 50, minShareOfMedian: 0.6, medianOf: 10, maxFutureMs: 60_000 });

/** Live classes (Spec 01 R8): 1 ≥5,000 · 2 ≥500 · 3 ≥50 · 4 ≥25 · 5 the small live channels, 5–24. 0 is offline. */
export const CLASS_MIN_AVERAGE = [Infinity, 5_000, 500, 50, 25, 0] as const;

export function liveClassFor(average: number): 1 | 2 | 3 | 4 | 5 {
  if (average >= 5_000) return 1;
  if (average >= 500) return 2;
  if (average >= 50) return 3;
  if (average >= 25) return 4;
  return 5;
}

/**
 * The class a holding shows. Its observed average audience sets the class, but the drawing may grow at most one
 * tier beyond its holding (R3): a village whose average passed 500 shows as a town, never as a city.
 */
export function holdingClass(average: number, tierRank: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(liveClassFor(average), Math.max(1, tierRank)) as 1 | 2 | 3 | 4 | 5;
}

const LiveRowSchema = z.strictObject({
  id: KingdomIdSchema,
  lang: z.string().min(1).max(16),
  viewers: z.number().int().min(0).max(100_000_000),
  started_at: z.string().max(40).nullable(),
  game_id: z.union([GameIdSchema, z.literal('')]).nullable(),
  live_min: z.number().finite().min(0),
  viewer_min: z.number().finite().min(0),
  last_live: EpochMsSchema,
  gone_at: EpochMsSchema.nullable(),
});

const SweepRowSchema = z.strictObject({ at: EpochMsSchema, streams: z.number().int().min(0), calls: z.number().int().min(0), ms: z.number().int().min(0) });

export interface LiveChannel {
  id: string;
  language: string;
  viewers: number;
  startedAt: number | null;
  gameId: string | null;
  average: number;
  categories: { gameId: string; minutes: number }[];
  goneAt: number | null;
}

export type SweepJudgement =
  | { ok: true; asOf: number; streams: number; previousAt: number | null; channels: LiveChannel[]; rejected: number }
  | { ok: false; state: 'empty' | 'future' | 'incoherent' | 'partial'; sweepAt: number | null; reason: string };

function parseStart(value: string | null): number | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Applies `sweep-complete-1` to one live read. Pure: the clock is injected. */
export function judgeSweep(source: SourceLiveSnapshot, now: number): SweepJudgement {
  const sweeps = source.sweeps.map((row) => SweepRowSchema.safeParse(row)).filter((row) => row.success).map((row) => row.data);
  const latest = sweeps[0];
  if (!latest) return { ok: false, state: 'empty', sweepAt: null, reason: 'The source has recorded no sweep yet.' };
  if (latest.at > now + SWEEP_RULE.maxFutureMs) {
    return { ok: false, state: 'future', sweepAt: latest.at, reason: 'The latest sweep is dated in the future; the source clock or row is wrong.' };
  }
  const categories = new Map<string, { gameId: string; minutes: number }[]>();
  for (const row of source.categories) {
    const minutes = Number(row.minutes);
    if (typeof row.channel !== 'string' || typeof row.game_id !== 'string' || !GameIdSchema.safeParse(row.game_id).success || !(minutes > 0)) continue;
    const list = categories.get(row.channel) ?? [];
    list.push({ gameId: row.game_id, minutes });
    categories.set(row.channel, list);
  }
  const channels: LiveChannel[] = [];
  let rejected = 0;
  for (const row of source.channels) {
    const parsed = LiveRowSchema.safeParse(row);
    if (!parsed.success) {
      rejected++;
      continue;
    }
    const r = parsed.data;
    if (r.last_live !== latest.at) {
      return { ok: false, state: 'incoherent', sweepAt: latest.at, reason: 'A channel marked live was not seen by the latest sweep.' };
    }
    channels.push({
      id: r.id,
      language: r.lang,
      viewers: r.viewers,
      startedAt: (() => {
        const start = parseStart(r.started_at);
        return start !== null && start <= latest.at ? start : null;
      })(),
      gameId: r.game_id || null,
      average: r.live_min > 0 ? r.viewer_min / r.live_min : 0,
      categories: categories.get(r.id) ?? [],
      goneAt: r.gone_at,
    });
  }
  if (rejected > 0) {
    return { ok: false, state: 'incoherent', sweepAt: latest.at, reason: `${rejected} of ${source.channels.length} live rows failed validation.` };
  }
  const belowFloor = latest.streams - channels.length - rejected;
  if (belowFloor < SWEEP_RULE.minBelowFloor) {
    return { ok: false, state: 'partial', sweepAt: latest.at, reason: `The latest sweep never paged below ${SOURCE_SWEEP_FLOOR_VIEWERS} viewers (${Math.max(0, belowFloor)} streams under the floor); it was cut short.` };
  }
  const previous = sweeps.slice(1, 1 + SWEEP_RULE.medianOf).map((sweep) => sweep.streams).sort((a, b) => a - b);
  if (previous.length >= 3) {
    const median = previous[Math.floor(previous.length / 2)]!;
    if (latest.streams < median * SWEEP_RULE.minShareOfMedian) {
      return { ok: false, state: 'partial', sweepAt: latest.at, reason: `The latest sweep counted ${latest.streams} streams against a recent median of ${median}; it was cut short.` };
    }
  }
  return { ok: true, asOf: latest.at, streams: latest.streams, previousAt: sweeps[1]?.at ?? null, channels, rejected };
}

/** 64 bits of SHA-256 over the decimal channel ID (the shared dab hash), as hex. */
export function dabHash(channelId: string): string {
  return createHash('sha256').update(channelId).digest('hex').slice(0, 16);
}

export interface FrameCounts {
  live: number;
  byClass: [number, number, number, number, number];
  dabs: number;
  startsUnknown: number;
  /** Live channels the visibility gate kept off the frame, by reason. Reasons stay inside the service. */
  gated: Record<Exclude<Visibility, 'public'>, number>;
  /** Small live channels left without a dab because the source gave no start time (a dab needs one). */
  dabsWithoutStart: number;
  dabsOverLimit: number;
}

export interface BuiltFrame {
  frameId: string;
  live: Uint8Array;
  starts: Uint8Array;
  dabs: Uint8Array;
  /** The manifest without its asset paths, which depend on where the frame is published. */
  manifest: (paths: { live: string; starts: string; dabs: string }) => AtlasManifest;
  counts: FrameCounts;
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/**
 * Builds one frame of a land from one complete sweep. Every live channel passes the one visibility gate first:
 * gone, gambling and withheld channels never paint, whether they hold land or would be a dab. No spectacle is
 * written: spectacles belong to founded kingdoms, and none has a founded record yet.
 */
export async function buildFrame(target: LiveTarget, sweep: Extract<SweepJudgement, { ok: true }>, withheld: ReadonlySet<string>, publishedAt: number): Promise<BuiltFrame> {
  const n = target.ids.length;
  const slots: AtlasLiveSlot[] = Array.from({ length: n }, () => ({ liveClass: 0, spectacle: ATLAS_SPECTACLE.none }));
  const startOf = new Map<number, number | null>();
  const dabs: AtlasDab[] = [];
  const counts: FrameCounts = {
    live: 0, byClass: [0, 0, 0, 0, 0], dabs: 0, startsUnknown: 0, gated: { gone: 0, gambling: 0, withheld: 0 }, dabsWithoutStart: 0, dabsOverLimit: 0,
  };
  const seenHashes = new Set<string>();
  // ID order, so dab collisions and the dab limit resolve the same way on every run.
  const channels = [...sweep.channels].sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const channel of channels) {
    const visibility = publicVisibility({ kingdomId: channel.id as never, categories: channel.categories, goneAt: channel.goneAt, stream: { gameId: channel.gameId, game: null, title: null, viewers: null, startedAt: null } }, withheld);
    if (visibility !== 'public') {
      counts.gated[visibility]++;
      continue;
    }
    const ordinal = target.ordinalOf.get(channel.id);
    if (ordinal !== undefined) {
      const liveClass = holdingClass(channel.average, target.tierRank[ordinal]!);
      slots[ordinal] = { liveClass, spectacle: ATLAS_SPECTACLE.none };
      startOf.set(ordinal, channel.startedAt);
      counts.live++;
      counts.byClass[liveClass - 1] = counts.byClass[liveClass - 1]! + 1;
      if (channel.startedAt === null) counts.startsUnknown++;
      continue;
    }
    // Without land: a dab in its realm's waiting land. A dab carries a real start, never an invented one.
    if (channel.startedAt === null) {
      counts.dabsWithoutStart++;
      continue;
    }
    if (dabs.length >= ATLAS_LIMITS.dabs) {
      counts.dabsOverLimit++;
      continue;
    }
    const channelHash = dabHash(channel.id);
    if (seenHashes.has(channelHash)) continue;
    seenHashes.add(channelHash);
    dabs.push({ realmIndex: target.realmFor(channel), channelHash, startedAt: channel.startedAt });
  }
  counts.dabs = dabs.length;
  return assembleFrame(target, sweep.asOf, slots, startOf, dabs, counts, publishedAt);
}

/** Encodes a frame with the shared writers and names it by its content. */
async function assembleFrame(target: LiveTarget, asOf: number, slots: AtlasLiveSlot[], startOf: Map<number, number | null>, dabs: AtlasDab[], counts: FrameCounts, publishedAt: number): Promise<BuiltFrame> {
  const live = encodeLiveV2(slots);
  const entries = [...startOf.entries()].sort((a, b) => a[0] - b[0]).map(([ordinal, startedAt]) => ({ ordinal, startedAt }));
  const startsDoc = AtlasLiveStartsSchema.parse({ version: 1, alignment: target.alignment, asOf, entries });
  const starts = new TextEncoder().encode(JSON.stringify(startsDoc));
  const dabBytes = encodeDabsV1(dabs);
  const [liveSha, startsSha, dabsSha] = await Promise.all([sha256Hex(live), sha256Hex(starts), sha256Hex(dabBytes)]);
  const frameId = `lf-${stamp(asOf)}-${(await sha256Hex(new TextEncoder().encode(`${target.alignment.settlerOrderHash}\n${liveSha}\n${startsSha}\n${dabsSha}\n`))).slice(0, 12)}`;
  return {
    frameId, live, starts, dabs: dabBytes, counts,
    manifest: (paths) => AtlasManifestSchema.parse({
      version: 1,
      alignment: target.alignment,
      evidence: { kind: 'observed', asOf },
      publishedAt: Math.max(publishedAt, asOf),
      realmCount: target.edition.realmCount,
      coverage: 'complete-sweep',
      live: { format: 'live-v2', path: paths.live, sha256: liveSha, byteLength: live.byteLength },
      starts: { format: 'live-starts-v1', path: paths.starts, sha256: startsSha, byteLength: starts.byteLength },
      dabs: { format: 'dabs-v1', path: paths.dabs, count: dabs.length, sha256: dabsSha, byteLength: dabBytes.byteLength },
    }),
  };
}

/** True when two sweeps are further apart than the source's cadence allows: the frame follows a gap. */
export function followsGap(sweep: Extract<SweepJudgement, { ok: true }>): boolean {
  return sweep.previousAt !== null && sweep.asOf - sweep.previousAt > SOURCE_SWEEP_CADENCE_MS * 2;
}

/** A published frame, decoded by the shared readers. */
export interface DecodedFrame {
  asOf: number;
  slots: Uint8Array;
  starts: { ordinal: number; startedAt: number | null }[];
  dabs: AtlasDab[];
}

/**
 * The published frame with every channel now withheld taken off it: its holding's class and start, or its dab.
 * Moderation must reach the map at the next run, not at the next complete sweep, so this runs on every run
 * whatever the source says. The observation time stays the sweep's own; only the publication time is new. Returns
 * null when nothing on the frame is withheld.
 */
export async function regateFrame(target: LiveTarget, frame: DecodedFrame, withheld: ReadonlySet<string>, publishedAt: number): Promise<BuiltFrame | null> {
  if (withheld.size === 0) return null;
  const hidden = new Set<number>();
  for (const id of withheld) {
    const ordinal = target.ordinalOf.get(id);
    if (ordinal !== undefined && frame.slots[ordinal * 2]) hidden.add(ordinal);
  }
  const hiddenHashes = new Set([...withheld].map(dabHash));
  const dabs = frame.dabs.filter((dab) => !hiddenHashes.has(dab.channelHash));
  if (hidden.size === 0 && dabs.length === frame.dabs.length) return null;
  const n = target.ids.length;
  const counts: FrameCounts = {
    live: 0, byClass: [0, 0, 0, 0, 0], dabs: dabs.length, startsUnknown: 0, gated: { gone: 0, gambling: 0, withheld: hidden.size + frame.dabs.length - dabs.length },
    dabsWithoutStart: 0, dabsOverLimit: 0,
  };
  const slots: AtlasLiveSlot[] = Array.from({ length: n }, (_, ordinal) => {
    const liveClass = hidden.has(ordinal) ? 0 : frame.slots[ordinal * 2]!;
    if (liveClass) {
      counts.live++;
      counts.byClass[liveClass - 1] = counts.byClass[liveClass - 1]! + 1;
    }
    return { liveClass: liveClass as AtlasLiveSlot['liveClass'], spectacle: hidden.has(ordinal) ? ATLAS_SPECTACLE.none : frame.slots[ordinal * 2 + 1]! as AtlasLiveSlot['spectacle'] };
  });
  const startOf = new Map<number, number | null>();
  for (const entry of frame.starts) {
    if (hidden.has(entry.ordinal)) continue;
    startOf.set(entry.ordinal, entry.startedAt);
    if (entry.startedAt === null) counts.startsUnknown++;
  }
  return assembleFrame(target, frame.asOf, slots, startOf, dabs, counts, publishedAt);
}
