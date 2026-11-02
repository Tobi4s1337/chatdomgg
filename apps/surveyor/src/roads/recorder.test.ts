import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureSource, sweepAt } from '../test/fixture-source';
import { ROAD_SOURCE_SQL, readRoadSource } from '../source/road-source';
import { RoadLedger } from './ledger';
import { recoverRecorder } from './recorder';

const sources: FixtureSource[] = [];
const dirs: string[] = [];
const ledgers: RoadLedger[] = [];
const cut = sweepAt(10);
const source = () => { const s = FixtureSource.standard(); sources.push(s); return s; };
const directory = () => { const d = mkdtempSync(join(tmpdir(), 'road-recorder-')); dirs.push(d); return d; };
const open = (dir: string) => { const l = new RoadLedger(dir); ledgers.push(l); return l; };
const close = (l: RoadLedger) => { l.close(); ledgers.splice(ledgers.indexOf(l), 1); };
const signal = () => new AbortController().signal;
afterEach(() => { vi.restoreAllMocks(); for (const l of ledgers.splice(0)) l.close(); for (const s of sources.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('recorder road recovery', () => {
  it('reads a consistent, read-only snapshot and sees late rows on the next pass', () => {
    const s = source();
    s.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const before = readFileSync(s.path); const stat = statSync(s.path);
    const first = readRoadSource(s.path, { now: () => cut, afterFirstRead: () => {
      s.addRaidObservation(sweepAt(1), '900000000000000003', '900000000000000001', 4, true);
      s.addRaidPair('900000000000000003', '900000000000000001', 1, 4, sweepAt(1));
    } });
    expect(first.raids).toHaveLength(3); expect(first.pairs).toHaveLength(1);
    expect(readFileSync(s.path)).toEqual(before);
    expect(statSync(s.path)).toMatchObject({ mtimeMs: stat.mtimeMs, mode: stat.mode });
    const second = readRoadSource(s.path, { now: () => cut });
    expect(second.raids).toHaveLength(4); expect(second.pairs).toHaveLength(2);
    expect(second.raids[0]).toMatchObject({ id: `recorder:${sweepAt(1)}:900000000000000003:900000000000000001:4`, observedAt: sweepAt(1), source: 'surveyor-recorder' });
    expect(second.reference).not.toBe(first.reference);
  });

  it('declares only SELECT queries against schema and the two road tables', () => {
    expect(Object.keys(ROAD_SOURCE_SQL).sort()).toEqual(['columns', 'observations', 'pairs', 'tables']);
    for (const sql of Object.values(ROAD_SOURCE_SQL)) expect(sql).toMatch(/^SELECT\s/i);
    expect(ROAD_SOURCE_SQL.observations).toMatch(/\bFROM rec_raids\b/i);
    expect(ROAD_SOURCE_SQL.pairs).toMatch(/\bFROM raids\b/i);
    expect(Object.values(ROAD_SOURCE_SQL).join(' ')).not.toMatch(/\b(?:channels|rec_channels|rec_frames|sweeps)\b/i);
  });

  it('validates future rows but does not count them until their cut', () => {
    const s = source(); s.addRaidObservation(cut + 1, '100', '200', 8, true); s.addRaidPair('100', '200', 1, 8, cut + 1);
    const early = readRoadSource(s.path, { now: () => cut });
    expect(early).toMatchObject({ cutAt: cut, futureRows: 2, firstAt: sweepAt(2) + 5000, lastAt: sweepAt(3) + 20000 });
    expect(early.raids).toHaveLength(3); expect(early.pairs).toHaveLength(1);
    const later = readRoadSource(s.path, { now: () => cut + 1 });
    expect(later.futureRows).toBe(0); expect(later.raids).toHaveLength(4); expect(later.pairs).toHaveLength(2);
    s.db.prepare('INSERT INTO rec_raids VALUES (?, ?, ?, ?, ?)').run(cut + 100, '100', '200', -1, 1);
    expect(() => readRoadSource(s.path, { now: () => cut })).toThrow('The road source contains invalid raid rows.');
  });

  it('rescans late older observations, retains aggregate uncertainty and avoids dominated aggregate growth', async () => {
    const s = source(); const dir = directory(); const l = open(dir);
    const first = await recoverRecorder(l, s.path, 'fixture', signal(), { now: () => cut });
    expect(first).toMatchObject({ stored: 3, events: 3, aggregates: 1, futureRows: 0 });
    expect.soft(l.road('900000000000000001', '900000000000000003')).toMatchObject({ raids: 2, observedRaids: 2, historyStartKnown: false, countBasis: 'at-least' });
    const journal = join(dir, 'roads', 'ledger.ndjson');
    const beforeRetry = readFileSync(journal);
    const retry = await recoverRecorder(l, s.path, 'fixture', signal(), { now: () => cut });
    expect(retry).toMatchObject({ stored: 0, duplicates: 0, aggregates: 0 });
    expect(readFileSync(journal)).toEqual(beforeRetry);
    s.addRaidObservation(sweepAt(1), '900000000000000003', '900000000000000001', 4, true);
    const late = await recoverRecorder(l, s.path, 'fixture', signal(), { now: () => cut + 1000 });
    expect(late).toMatchObject({ stored: 1, duplicates: 3, events: 4 });
    expect(l.road('900000000000000001', '900000000000000003')).toMatchObject({ raids: 3, observedRaids: 3 });
    const aggregatesBefore = readFileSync(journal, 'utf8').split('\n').filter((line) => line.includes('"kind":"aggregate"')).length;
    await recoverRecorder(l, s.path, 'fixture', signal(), { now: () => cut + 2000 });
    const aggregatesAfter = readFileSync(journal, 'utf8').split('\n').filter((line) => line.includes('"kind":"aggregate"')).length;
    expect(aggregatesAfter).toBe(aggregatesBefore);
  });

  it('does not change the ledger or checkpoint when a later snapshot contains an invalid row', async () => {
    const s = source(); const dir = directory(); const l = open(dir);
    await recoverRecorder(l, s.path, 'fixture', signal(), { now: () => cut });
    const journal = join(dir, 'roads', 'ledger.ndjson');
    const before = readFileSync(journal); const checkpoint = l.checkpoint('recorder-db:fixture');
    s.addRaidObservation(sweepAt(1), '100', '200', 2, true);
    s.db.prepare('INSERT INTO rec_raids VALUES (?, ?, ?, ?, ?)').run(cut + 100, '100', '200', -1, 1);
    await expect(recoverRecorder(l, s.path, 'fixture', signal(), { now: () => cut + 1 })).rejects.toThrow('The road source contains invalid raid rows.');
    expect(readFileSync(journal)).toEqual(before);
    expect(l.checkpoint('recorder-db:fixture')).toBe(checkpoint);
    expect(l.road('100', '200')).toBeNull();
  });

  it('leaves no completed checkpoint when interrupted and resumes from durable IDs after restart', async () => {
    const s = source(); const dir = directory(); let l = open(dir);
    for (let i = 0; i < 40; i++) s.addRaidObservation(sweepAt(4) + i, '100', '200', i + 1, true);
    const abort = new AbortController(); const original = l.observeBatch.bind(l);
    vi.spyOn(l, 'observeBatch').mockImplementation((...args) => { const result = original(...args); abort.abort(new Error('interrupted')); return result; });
    await expect(recoverRecorder(l, s.path, 'fixture', abort.signal, { now: () => cut })).rejects.toThrow('interrupted');
    expect(l.checkpoint('recorder-db:fixture')).toBeNull();
    close(l); l = open(dir);
    const resumed = await recoverRecorder(l, s.path, 'fixture', signal(), { now: () => cut });
    expect(resumed).toMatchObject({ events: 43, stored: 11, duplicates: 32 });
    expect(l.checkpoint('recorder-db:fixture')).not.toBeNull();
    expect(l.road('100', '200')).toMatchObject({ observedRaids: 40 });
  });
});
