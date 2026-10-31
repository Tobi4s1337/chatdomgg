import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runImport } from '../import';
import { WITHHELD_FILE } from '../policy/visibility';
import type { SourceLiveRow, SourceLiveSnapshot } from '../source/sqlite';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { loadLiveTarget, type LiveTarget } from './target';

/**
 * Live-layer fixtures: one small survey preview drawn by a real import of the standard fixture source (plus a few
 * extra holdings in several tiers), and hand-written live reads, so every sweep the producer judges is explicit.
 */

/** Holdings of the fixture land, by channel ID. Logins are only in the source's channels table, never in a frame. */
export const IDS = {
  capital: '900000000000000001',
  town: '900000000000000002',
  village: '900000000000000003',
  small: '900000000000000004',
  bright: '900000000000000005',
  modest: '900000000000000006',
  quiet: '900000000000000007',
} as const;

/** Channels the live read sees that hold no land. The last one is shorter, so it sorts first by numeric ID order. */
export const LANDLESS = ['800000000000000001', '800000000000000002', '800000000000000003', '80000000000000004'] as const;

export const LOGINS = ['fixture_capital', 'fixture_town', 'fixture_village', 'fixture_small', 'fixture_bright', 'fixture_modest', 'fixture_quiet'];

export interface Land {
  dataDir: string;
  previewId: string;
  target: LiveTarget;
  cleanup: () => void;
}

/** Imports the fixture source once into a fresh data directory, which then holds exactly one survey preview. */
export async function fixtureLand(): Promise<Land> {
  const source = FixtureSource.standard();
  source.addChannel({ id: IDS.bright, login: 'fixture_bright', name: 'Fixture Bright', firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 15 * 900 });
  source.addChannel({ id: IDS.modest, login: 'fixture_modest', name: 'Fixture Modest', firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 15 * 120 });
  source.addChannel({ id: IDS.quiet, login: 'fixture_quiet', name: 'Fixture Quiet', firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 15 * 30 });
  const dataDir = tempDataDir();
  try {
    const outcome = await runImport(configFor(source, dataDir), {
      fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(sweepAt(10)),
    });
    if (!outcome.ok) throw new Error(`import failed: ${outcome.error.code} ${outcome.error.message}`);
    const previewId = outcome.preview.id;
    const target = await loadLiveTarget(dataDir, previewId);
    return { dataDir, previewId, target, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
  } finally {
    source.close();
  }
}

/** A private copy of an imported land, so one import serves a whole file without tests sharing state. */
export function copyLand(base: Land): Land {
  const dataDir = tempDataDir();
  cpSync(base.dataDir, dataDir, { recursive: true });
  return { dataDir, previewId: base.previewId, target: base.target, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

/** The live-read sweep times: far after the fixture land's own observation, three minutes apart. */
export const L0 = sweepAt(100);
export const SWEEP_MS = 180_000;
export const liveAt = (index: number) => L0 + index * SWEEP_MS;

export interface LiveChannelSpec {
  id: string;
  lang?: string;
  viewers?: number;
  /** Observed average audience (viewer minutes over live minutes). */
  average?: number;
  startedAt?: string | null;
  gameId?: string | null;
  goneAt?: number | null;
  lastLive?: number;
}

export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * One live read as `readLiveSource` returns it: the latest sweep at `at` with `streams` counted, and the ten sweeps
 * before it (newest first) at the same count unless `history` says otherwise.
 */
export function liveSnapshot(at: number, channels: readonly LiveChannelSpec[], options: { streams?: number; history?: readonly number[] } = {}): SourceLiveSnapshot {
  const streams = options.streams ?? 1_000;
  const history = options.history ?? Array.from({ length: 10 }, () => streams);
  const sweeps = [{ at, streams, calls: 40, ms: 9_000 }, ...history.map((count, i) => ({ at: at - (i + 1) * SWEEP_MS, streams: count, calls: 40, ms: 9_000 }))];
  const rows: SourceLiveRow[] = channels.map((channel) => ({
    id: channel.id,
    lang: channel.lang ?? 'en',
    viewers: channel.viewers ?? Math.round(channel.average ?? 40),
    started_at: channel.startedAt === undefined ? iso(at - 3_600_000) : channel.startedAt,
    game_id: channel.gameId === undefined ? '509658' : channel.gameId,
    live_min: 60,
    viewer_min: 60 * (channel.average ?? 40),
    last_live: channel.lastLive ?? at,
    gone_at: channel.goneAt ?? null,
  }));
  const categories = channels.filter((channel) => channel.gameId !== null).map((channel) => ({ channel: channel.id, game_id: channel.gameId ?? '509658', minutes: 60 }));
  return { openedAt: at + 1_000, readMs: 3, sweeps, channels: rows, categories };
}

export function writeWithheld(dataDir: string, ids: readonly string[] | string): void {
  mkdirSync(join(dataDir, 'moderation'), { recursive: true });
  writeFileSync(join(dataDir, WITHHELD_FILE), typeof ids === 'string' ? ids : JSON.stringify({ version: 1, updatedAt: L0, kingdomIds: ids }));
}
