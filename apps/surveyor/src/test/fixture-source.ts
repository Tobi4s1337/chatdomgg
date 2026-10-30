import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SurveyorRecentRaidPair, SurveyorStatus } from '@chatdom/shared';
import type { ImportConfig } from '../config';

/**
 * Test-only stand-in for the running Surveyor: its table layout (from the collector's db.ts) with a handful of
 * clearly fake channels. It exists to exercise the importer; it is never served or counted as an observation.
 */
export const SOURCE_DDL = `
PRAGMA journal_mode = WAL;
CREATE TABLE channels (
  id TEXT PRIMARY KEY, login TEXT, name TEXT, lang TEXT, first_seen INTEGER, last_live INTEGER,
  live_min REAL NOT NULL DEFAULT 0, viewer_min REAL NOT NULL DEFAULT 0, peak INTEGER NOT NULL DEFAULT 0,
  game_id TEXT, game TEXT, title TEXT, viewers INTEGER, started_at TEXT, live INTEGER NOT NULL DEFAULT 0,
  missed INTEGER NOT NULL DEFAULT 0, last_sweep INTEGER NOT NULL DEFAULT 0, avatar TEXT, facts_at INTEGER, gone_at INTEGER);
CREATE TABLE cat_minutes (channel TEXT NOT NULL, game_id TEXT NOT NULL, minutes REAL NOT NULL, PRIMARY KEY (channel, game_id));
CREATE TABLE games (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE raids (from_id TEXT NOT NULL, to_id TEXT NOT NULL, n INTEGER NOT NULL, viewers INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (from_id, to_id));
CREATE TABLE settlers (holding INTEGER PRIMARY KEY, channel TEXT NOT NULL UNIQUE, tier INTEGER NOT NULL, settled_at INTEGER NOT NULL);
CREATE TABLE sweeps (at INTEGER NOT NULL, streams INTEGER NOT NULL, calls INTEGER NOT NULL, ms INTEGER NOT NULL);
CREATE TABLE rec_channels (ix INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL UNIQUE, last_seen INTEGER NOT NULL);
CREATE TABLE rec_frames (at INTEGER PRIMARY KEY, streams INTEGER NOT NULL, data BLOB NOT NULL);
CREATE TABLE rec_raids (at INTEGER NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, viewers INTEGER NOT NULL, kept INTEGER NOT NULL);
`;

export const T0 = 1_793_288_700_000;
export const SWEEP = 180_000;
export const AVATAR = 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-profile_image-300x300.png';

export interface FixtureChannel {
  id: string; login: string; name: string; lang?: string; firstSweep: number; lastSweep: number; live: boolean;
  liveMin: number; viewerMin: number; peak?: number; title?: string | null; game?: [string, string] | null;
  viewers?: number | null; startedAt?: string | null; avatar?: string | null; factsAt?: number | null; goneAt?: number | null;
}

export const sweepAt = (index: number) => T0 + index * SWEEP;

export class FixtureSource {
  readonly dir: string;
  readonly path: string;
  readonly db: DatabaseSync;
  sweeps = 0;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'chatdom-surveyor-src-'));
    this.path = join(this.dir, 'surveyor.db');
    this.db = new DatabaseSync(this.path);
    this.db.exec(SOURCE_DDL);
    // Test speed only; the fixture is disposable.
    this.db.exec('PRAGMA synchronous = OFF');
  }

  addSweeps(count: number): void {
    const insert = this.db.prepare('INSERT INTO sweeps (at, streams, calls, ms) VALUES (?, ?, ?, ?)');
    const own = !this.db.isTransaction;
    if (own) this.db.exec('BEGIN');
    for (let i = 0; i < count; i++) insert.run(sweepAt(this.sweeps++), 100, 2, 900);
    if (own) this.db.exec('COMMIT');
  }

  addGame(id: string, name: string): void {
    this.db.prepare('INSERT OR REPLACE INTO games (id, name) VALUES (?, ?)').run(id, name);
  }

  addChannel(channel: FixtureChannel): void {
    const game: [string, string] | null = channel.game === undefined ? ['509658', 'Just Chatting'] : channel.game;
    if (game) this.addGame(game[0], game[1]);
    this.db.prepare(`INSERT INTO channels (id, login, name, lang, first_seen, last_live, live_min, viewer_min, peak, game_id, game,
      title, viewers, started_at, live, missed, last_sweep, avatar, facts_at, gone_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`).run(
      channel.id, channel.login, channel.name, channel.lang ?? 'en', sweepAt(channel.firstSweep), sweepAt(channel.lastSweep),
      channel.liveMin, channel.viewerMin, channel.peak ?? Math.ceil(channel.viewerMin / Math.max(1, channel.liveMin)),
      game?.[0] ?? null, game?.[1] ?? null, channel.title === undefined ? 'A fixture stream' : channel.title,
      channel.viewers === undefined ? 30 : channel.viewers, channel.startedAt === undefined ? new Date(sweepAt(channel.firstSweep) - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z') : channel.startedAt,
      channel.live ? 1 : 0, channel.lastSweep + 1, channel.avatar === undefined ? AVATAR : channel.avatar,
      channel.factsAt === undefined ? sweepAt(channel.lastSweep) : channel.factsAt, channel.goneAt ?? null);
    if (game) this.db.prepare('INSERT OR REPLACE INTO cat_minutes (channel, game_id, minutes) VALUES (?, ?, ?)').run(channel.id, game[0], channel.liveMin);
  }

  addRaidPair(from: string, to: string, n: number, viewers: number, lastAt: number): void {
    this.db.prepare('INSERT INTO raids (from_id, to_id, n, viewers, last_at) VALUES (?, ?, ?, ?, ?)').run(from, to, n, viewers, lastAt);
  }

  addRaidObservation(at: number, from: string, to: string, viewers: number, kept: boolean): void {
    this.db.prepare('INSERT INTO rec_raids (at, from_id, to_id, viewers, kept) VALUES (?, ?, ?, ?, ?)').run(at, from, to, viewers, kept ? 1 : 0);
  }

  /** A standard small world: five sweeps, three candidates, one small stream, raids between them. */
  static standard(): FixtureSource {
    const source = new FixtureSource();
    source.addSweeps(5);
    source.addChannel({ id: '900000000000000001', login: 'fixture_capital', name: 'Fixture Capital', firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 90_000 });
    source.addChannel({ id: '900000000000000002', login: 'fixture_town', name: 'フィクスチャ町', lang: 'ja', firstSweep: 0, lastSweep: 2, live: false, liveMin: 9, viewerMin: 540, game: ['21779', 'League of Legends'] });
    source.addChannel({ id: '900000000000000003', login: 'fixture_village', name: 'Fixture Village', lang: 'de', firstSweep: 1, lastSweep: 4, live: true, liveMin: 12, viewerMin: 300 });
    source.addChannel({ id: '900000000000000004', login: 'fixture_small', name: 'Fixture Small', firstSweep: 3, lastSweep: 4, live: true, liveMin: 6, viewerMin: 48, avatar: null, factsAt: null });
    source.addRaidPair('900000000000000001', '900000000000000003', 2, 140, sweepAt(3) + 10_000);
    source.addRaidObservation(sweepAt(2) + 5_000, '900000000000000001', '900000000000000003', 70, true);
    source.addRaidObservation(sweepAt(3) + 10_000, '900000000000000001', '900000000000000003', 70, true);
    source.addRaidObservation(sweepAt(3) + 20_000, '900000000000000004', '900000000000000002', 3, false);
    return source;
  }

  status(overrides: Partial<SurveyorStatus> = {}): SurveyorStatus {
    const last = this.sweeps ? sweepAt(this.sweeps - 1) : null;
    return {
      since: T0, sweeps: this.sweeps, lastSweep: last === null ? null : { at: last, streams: 100, calls: 2, ms: 900 },
      channels: 4, kingdoms: 3, kingdomsWith2LiveHours: 0, liveNow: 3, liveKingdoms: 2,
      raidWatch: { watching: 2, verified: 2, cost: { total: 2, max: 10_000 }, enabled: true },
      raids: { pairs: 1, total: 2, sinceStart: { kept: 2, dropped: 1 } },
      recorder: { enabled: true, keepDays: 7, frames: 0, firstFrame: null, lastFrame: null, frameBytes: 0, channels: 0, raidEvents: 3, raidEventsBetweenKingdoms: 2 },
      helixRemaining: 800, streamClients: 0,
      ...overrides,
    };
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export const RECENT: SurveyorRecentRaidPair[] = [
  { from_login: 'fixture_capital', to_login: 'fixture_village', n: 2, viewers: 140, last_at: sweepAt(3) + 10_000 },
];

/** A fetch stand-in for the Surveyor HTTP API. Routes answer with JSON, a status code or never. */
export function fakeSurveyor(routes: Record<string, unknown | ((signal?: AbortSignal | null) => Promise<Response>)>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url.pathname);
    const key = url.pathname.replace(/^.*\/atlas\/api\//, '');
    const route = routes[key];
    if (route === undefined) return new Response('{"error":"not found"}', { status: 404 });
    if (typeof route === 'function') return (route as (signal?: AbortSignal | null) => Promise<Response>)(init?.signal);
    return new Response(JSON.stringify(route), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'chatdom-atlas-data-'));
}

export function configFor(source: FixtureSource | null, dataDir: string, overrides: Partial<ImportConfig> = {}): ImportConfig {
  return {
    surveyorBaseUrl: new URL('http://surveyor.test/atlas/api/'),
    surveyorDbPath: source?.path ?? null,
    dataDir,
    keepRevisions: 3,
    httpTimeoutMs: 500,
    ...overrides,
  };
}

/** A clock that only moves forward, so ledger and pointer times are distinct and deterministic. */
export function clock(start = sweepAt(10)): () => number {
  let now = start;
  return () => (now += 1_000);
}
