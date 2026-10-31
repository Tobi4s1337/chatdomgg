import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  AtlasManifestSchema, EpochMsSchema, assertAtlasAlignment, decodeDabsV1, decodeLiveStartsV1, decodeLiveV2,
  type AtlasAlignment, type AtlasManifest,
} from '@chatdom/shared';
import { PreviewIdSchema } from '../preview/schema';
import type { BuiltFrame, DecodedFrame } from './frame';

/**
 * live/<preview>/manifest.json           the one current frame of that land, swapped by rename
 * live/<preview>/<frame>/{live.bin, starts.json, dabs.bin}   immutable, content addressed
 * live/state.json                         what the producer last saw of the source (complete, partial, …)
 *
 * The manifest is the only mutable file a reader follows. A frame is written and verified with the shared decoders
 * before the manifest names it, and an older observation never replaces a newer one. A few earlier frames stay, so
 * a reader that fetched the previous manifest a moment ago still finds its bytes.
 */
export const LIVE_DIR = 'live';
export const KEEP_FRAMES = 4;
export const LIVE_FILES = { live: 'live.bin', starts: 'starts.json', dabs: 'dabs.bin' } as const;
export const FrameIdSchema = z.string().regex(/^lf-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/);

export const LiveSourceStateSchema = z.strictObject({
  version: z.literal(1),
  /** When the producer last read the source. */
  checkedAt: EpochMsSchema,
  /** complete: the latest sweep is the published frame · partial/incoherent/future/empty: it was refused · unavailable: no read. */
  state: z.enum(['complete', 'partial', 'incoherent', 'future', 'empty', 'unavailable', 'moderation-unreadable']),
  /** The latest sweep the source recorded, when it could be read. */
  sweepAt: EpochMsSchema.nullable(),
  /** The newest complete sweep any frame was built from. */
  completeAt: EpochMsSchema.nullable(),
  /** The frame before this one was more than two sweeps earlier: the source missed sweeps in between. */
  gapBefore: z.boolean(),
  reason: z.string().max(300).nullable(),
  rule: z.string().max(64),
});
export type LiveSourceState = z.infer<typeof LiveSourceStateSchema>;

export function liveRoot(dataDir: string): string {
  return join(dataDir, LIVE_DIR);
}

export function liveTargetDir(dataDir: string, previewId: string): string {
  return join(liveRoot(dataDir), PreviewIdSchema.parse(previewId));
}

export function framePath(previewId: string, frameId: string, file: keyof typeof LIVE_FILES): string {
  return `/v1/live/${previewId}/${frameId}/${LIVE_FILES[file]}`;
}

function writeDurable(path: string, bytes: Uint8Array | string): void {
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, typeof bytes === 'string' ? Buffer.from(bytes) : bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDir(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readLiveManifest(dataDir: string, previewId: string): AtlasManifest | null {
  const path = join(liveTargetDir(dataDir, previewId), 'manifest.json');
  if (!existsSync(path)) return null;
  return AtlasManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function readLiveState(dataDir: string): LiveSourceState | null {
  const path = join(liveRoot(dataDir), 'state.json');
  if (!existsSync(path)) return null;
  return LiveSourceStateSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeLiveState(dataDir: string, state: LiveSourceState): void {
  const root = liveRoot(dataDir);
  mkdirSync(root, { recursive: true });
  const tmp = join(root, `.state-${process.pid}.tmp`);
  writeDurable(tmp, JSON.stringify(LiveSourceStateSchema.parse(state)));
  renameSync(tmp, join(root, 'state.json'));
}

/** Reads one frame back through the shared decoders: hashes, lengths, alignment, codes, start entries and dabs. */
export async function verifyFrame(dataDir: string, previewId: string, manifest: AtlasManifest, expected: AtlasAlignment): Promise<void> {
  await readFrame(dataDir, previewId, manifest, expected);
}

/** The frame a manifest names, decoded and verified. */
export async function readFrame(dataDir: string, previewId: string, manifest: AtlasManifest, expected: AtlasAlignment): Promise<DecodedFrame> {
  assertAtlasAlignment(manifest.alignment, expected);
  const read = (path: string) => {
    const match = /^\/v1\/live\/(pv-[^/]+)\/(lf-[^/]+)\/(live\.bin|starts\.json|dabs\.bin)$/.exec(path);
    if (!match || match[1] !== previewId || !FrameIdSchema.safeParse(match[2]).success) throw new Error(`Unexpected live asset path ${path}.`);
    return new Uint8Array(readFileSync(join(liveTargetDir(dataDir, previewId), match[2]!, match[3]!)));
  };
  const liveBytes = read(manifest.live.path);
  const slots = await decodeLiveV2(liveBytes, manifest, expected);
  const starts = await decodeLiveStartsV1(read(manifest.starts.path), manifest, expected, liveBytes);
  const dabs = await decodeDabsV1(read(manifest.dabs.path), manifest, expected);
  return { asOf: manifest.evidence.asOf, slots, starts: starts.entries, dabs };
}

export type PublishOutcome = 'published' | 'existing' | 'older';

/**
 * Publishes one frame: write the files into a staging folder, verify them, rename the folder into place, then swap
 * the manifest by rename. A frame observed no later than the current one is never published over it.
 */
export async function publishFrame(dataDir: string, previewId: string, frame: BuiltFrame, expected: AtlasAlignment): Promise<{ outcome: PublishOutcome; manifest: AtlasManifest }> {
  const dir = liveTargetDir(dataDir, previewId);
  mkdirSync(dir, { recursive: true });
  const current = readLiveManifest(dataDir, previewId);
  const manifest = frame.manifest({
    live: framePath(previewId, frame.frameId, 'live'),
    starts: framePath(previewId, frame.frameId, 'starts'),
    dabs: framePath(previewId, frame.frameId, 'dabs'),
  });
  if (current && current.alignment.settlerOrderHash === expected.settlerOrderHash) {
    if (current.live.path === manifest.live.path) return { outcome: 'existing', manifest: current };
    // The same sweep may be published again with other content only later, and only because the gate changed
    // (a channel withheld or released between runs); an earlier observation never replaces a later one.
    const sameSweepLater = current.evidence.asOf === manifest.evidence.asOf && manifest.publishedAt > current.publishedAt;
    if (current.evidence.asOf > manifest.evidence.asOf || (current.evidence.asOf === manifest.evidence.asOf && !sameSweepLater)) {
      return { outcome: 'older', manifest: current };
    }
  }
  const final = join(dir, frame.frameId);
  if (!existsSync(final)) {
    const staging = join(dir, `.staging-${frame.frameId}-${process.pid}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging);
    writeDurable(join(staging, LIVE_FILES.live), frame.live);
    writeDurable(join(staging, LIVE_FILES.starts), frame.starts);
    writeDurable(join(staging, LIVE_FILES.dabs), frame.dabs);
    fsyncDir(staging);
    renameSync(staging, final);
    fsyncDir(dir);
  }
  await verifyFrame(dataDir, previewId, manifest, expected);
  const tmp = join(dir, `.manifest-${process.pid}.tmp`);
  writeDurable(tmp, JSON.stringify(manifest));
  renameSync(tmp, join(dir, 'manifest.json'));
  fsyncDir(dir);
  pruneFrames(dataDir, previewId, manifest);
  return { outcome: 'published', manifest };
}

/** Keeps the current frame and the few before it; removes older frames and stray staging folders. */
export function pruneFrames(dataDir: string, previewId: string, current: AtlasManifest): string[] {
  const dir = liveTargetDir(dataDir, previewId);
  const keep = current.live.path.split('/')[4]!;
  const frames = readdirSync(dir).filter((name) => FrameIdSchema.safeParse(name).success).sort();
  const removed: string[] = [];
  // By observation stamp only: a frame re-gated from the same sweep shares the stamp, and its hash says nothing
  // about which came first, so the one a reader may still hold stays beside it.
  const sweepOf = (name: string) => name.slice(0, 'lf-YYYYMMDDTHHMMSSZ'.length);
  const kept = frames.filter((name) => sweepOf(name) <= sweepOf(keep)).slice(-KEEP_FRAMES);
  for (const name of frames) {
    if (name === keep || kept.includes(name)) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
    removed.push(name);
  }
  for (const name of readdirSync(dir)) if (name.startsWith('.staging-')) rmSync(join(dir, name), { recursive: true, force: true });
  return removed;
}

/** Live folders of previews that are gone leave with them. */
export function pruneLiveTargets(dataDir: string, previews: ReadonlySet<string>): string[] {
  const root = liveRoot(dataDir);
  if (!existsSync(root)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(root)) {
    if (!PreviewIdSchema.safeParse(name).success || previews.has(name)) continue;
    rmSync(join(root, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}
