import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AtlasError } from '../errors';
import { FixtureSource, sweepAt } from '../test/fixture-source';
import { REQUIRED_COLUMNS, SOURCE_SQL, readSourceSnapshot } from './sqlite';

let source: FixtureSource | null = null;
afterEach(() => {
  source?.close();
  source = null;
});

describe('read-only Surveyor snapshot', () => {
  it('has no write path: every statement is a SELECT and no PRAGMA is issued', () => {
    for (const sql of Object.values(SOURCE_SQL)) {
      expect(sql.trim()).toMatch(/^SELECT\b/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|VACUUM|REINDEX)\b/i);
      expect(sql).not.toMatch(/\bPRAGMA\s/i);
    }
    const adapter = readFileSync(new URL('./sqlite.ts', import.meta.url), 'utf8');
    // The only exec calls are the read transactions' BEGIN and ROLLBACK (the full snapshot and the live read).
    expect([...adapter.matchAll(/\.exec\('([^']+)'\)/g)].map((match) => match[1])).toEqual(['BEGIN DEFERRED', 'ROLLBACK', 'BEGIN DEFERRED', 'ROLLBACK']);
    expect(Object.keys(REQUIRED_COLUMNS)).toContain('channels');
  });

  it('opens the source so SQLite itself refuses writes, and leaves the file untouched', () => {
    source = FixtureSource.standard();
    source.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const before = readFileSync(source.path);
    const snapshot = readSourceSnapshot(source.path);
    expect(snapshot.channels).toHaveLength(4);
    expect(Buffer.compare(before, readFileSync(source.path))).toBe(0);
    const readOnly = new DatabaseSync(source.path, { readOnly: true });
    expect(() => readOnly.exec("INSERT INTO games (id, name) VALUES ('1', 'x')")).toThrow(/readonly/i);
    readOnly.close();
  });

  it('reads one consistent snapshot while the collector commits a sweep mid-read', () => {
    source = FixtureSource.standard();
    const writer = source;
    const snapshot = readSourceSnapshot(source.path, {
      afterFirstRead: () => {
        // The live collector's sweep transaction: a new sweep, a new live channel and its category minutes.
        writer.db.exec('BEGIN');
        writer.addSweeps(1);
        writer.addChannel({ id: '900000000000000099', login: 'fixture_late', name: 'Late', firstSweep: 5, lastSweep: 5, live: true, liveMin: 3, viewerMin: 90 });
        writer.db.prepare('UPDATE channels SET live = 0 WHERE id = ?').run('900000000000000001');
        writer.db.exec('COMMIT');
      },
    });
    expect(snapshot.sweeps).toHaveLength(5);
    expect(snapshot.channels.map((row) => row.id)).not.toContain('900000000000000099');
    expect(snapshot.channels.find((row) => row.id === '900000000000000001')?.live).toBe(1);
    expect(snapshot.categories.map((row) => row.channel)).not.toContain('900000000000000099');
    const next = readSourceSnapshot(source.path);
    expect(next.sweeps).toHaveLength(6);
    expect(next.sweeps.at(-1)?.at).toBe(sweepAt(5));
    expect(next.channels.map((row) => row.id)).toContain('900000000000000099');
  });

  it('fails clearly when the inventory is missing instead of inventing one', () => {
    expect(() => readSourceSnapshot(null)).toThrow(expect.objectContaining({ code: 'inventory-missing' }) as AtlasError);
    expect(() => readSourceSnapshot('/nonexistent/surveyor.db')).toThrow(expect.objectContaining({ code: 'inventory-missing' }) as AtlasError);
    source = new FixtureSource();
    source.db.exec('DROP TABLE cat_minutes; ALTER TABLE channels DROP COLUMN started_at');
    try {
      readSourceSnapshot(source.path);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AtlasError);
      expect((error as AtlasError).code).toBe('source-schema');
      expect((error as AtlasError).details).toEqual(expect.arrayContaining(['channels.started_at', 'table cat_minutes']));
    }
  });
});
