import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, type AtlasRaid } from '@chatdom/shared';
import { RoadLedger } from './ledger';

const dirs: string[] = [];
const openLedgers: RoadLedger[] = [];
const base = 1_700_000_000_000;
const kingdom = (id: string) => KingdomIdSchema.parse(id);
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'chatdom-road-ledger-'));
  dirs.push(dir);
  return dir;
}
function open(dir: string) {
  const ledger = new RoadLedger(dir);
  openLedgers.push(ledger);
  return ledger;
}
function close(ledger: RoadLedger) {
  ledger.close();
  openLedgers.splice(openLedgers.indexOf(ledger), 1);
}
function raid(id: string, overrides: Partial<AtlasRaid> = {}): AtlasRaid {
  return {
    version: 1, id, fromKingdomId: kingdom('100'), toKingdomId: kingdom('200'), viewers: 25,
    observedAt: base, occurredAt: null, evidence: { kind: 'observed', asOf: base },
    delivery: 'resumable', source: 'surveyor-recorder', ...overrides,
  };
}
afterEach(() => {
  for (const ledger of openLedgers.splice(0)) ledger.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('durable road ledger', () => {
  it('persists a witnessed raid, cross-source aliases and its checkpoint across restart', () => {
    const dir = directory();
    let ledger = open(dir);
    const first = raid('recorded');
    const alias = raid('herald-id', { source: 'herald', occurredAt: base + 1_000 });
    expect(ledger.observe(first, { checkpoint: { source: 'collector', after: null, cursor: 'one' }, recovered: true }).kind).toBe('stored');
    expect(ledger.observe(alias)).toMatchObject({ kind: 'duplicate', raidId: 'herald-id' });
    close(ledger);
    ledger = open(dir);
    expect(ledger.checkpoint('collector')).toBe('one');
    expect(ledger.observe(alias).kind).toBe('duplicate');
    expect(ledger.observe(first).kind).toBe('duplicate');
    expect(ledger.road('200', '100')).toMatchObject({ from: '100', to: '200', raids: 1, viewers: 25, firstAt: base, lastAt: base });
    expect(ledger.roads('100')).toHaveLength(1);
    expect(ledger.roads('999')).toHaveLength(0);
  });

  it('counts distinct same-source and reverse-direction raids while deduplicating cross-source observations in the window', () => {
    const ledger = open(directory());
    expect(ledger.observe(raid('later', { observedAt: base + 50_000, evidence: { kind: 'observed', asOf: base + 50_000 } })).kind).toBe('stored');
    expect(ledger.observe(raid('earlier')).kind).toBe('stored');
    expect(ledger.observe(raid('same-source')).kind).toBe('stored');
    expect(ledger.observe(raid('reverse', { fromKingdomId: kingdom('200'), toKingdomId: kingdom('100'), source: 'herald' })).kind).toBe('stored');
    expect(ledger.observe(raid('cross-source', { source: 'herald', occurredAt: base + 30_000 })).kind).toBe('duplicate');
    const summary = ledger.road('100', '200');
    expect(summary).toMatchObject({ raids: 4, viewers: 100, firstAt: base, lastAt: base + 50_000 });
    expect(summary?.events).toHaveLength(4);
    expect(ledger.roads()).toHaveLength(1);
  });

  it('serializes simultaneous deliveries on one instance', async () => {
    const ledger = open(directory());
    const results = await Promise.all(Array.from({ length: 12 }, async () => ledger.observe(raid('same'))));
    expect(results.filter((result) => result.kind === 'stored')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'duplicate')).toHaveLength(11);
    expect(ledger.road('100', '200')?.raids).toBe(1);
  });

  it('rejects conflicting IDs, malformed inputs and simulated observations without changing a road', () => {
    const ledger = open(directory());
    ledger.observe(raid('stable'));
    expect(() => ledger.observe(raid('stable', { toKingdomId: kingdom('300') }))).toThrow();
    expect(() => ledger.observe(raid('bad', { viewers: 0 }))).toThrow();
    expect(() => ledger.observe(raid('sim', { source: 'simulation', evidence: { kind: 'simulated', asOf: base, label: 'SIMULATED' } }))).toThrow();
    expect(() => ledger.observe(raid('replay', { evidence: { kind: 'replay', asOf: base, recordingId: 'recording' } }))).toThrow();
    expect(ledger.roads()).toHaveLength(1);
    expect(ledger.road('100', '200')?.raids).toBe(1);
  });

  it('atomically compares and advances cursors and refuses stale observations', () => {
    const dir = directory();
    let ledger = open(dir);
    ledger.advance('collector', null, 'first');
    expect(() => ledger.advance('collector', null, 'wrong')).toThrow();
    expect(() => ledger.observe(raid('stale'), { checkpoint: { source: 'collector', after: null, cursor: 'wrong' } })).toThrow();
    expect(ledger.roads()).toHaveLength(0);
    expect(ledger.checkpoint('collector')).toBe('first');
    ledger.observe(raid('current'), { checkpoint: { source: 'collector', after: 'first', cursor: 'second' } });
    close(ledger);
    ledger = open(dir);
    expect(ledger.checkpoint('collector')).toBe('second');
    expect(ledger.road('100', '200')?.raids).toBe(1);
  });

  it('excludes a second writer and permits reopening after close', () => {
    const dir = directory();
    const ledger = open(dir);
    expect(() => new RoadLedger(dir)).toThrow();
    close(ledger);
    expect(open(dir).roads()).toHaveLength(0);
  });

  it('rejects a corrupt complete journal record instead of serving partial history', () => {
    const dir = directory();
    const ledger = open(dir);
    ledger.observe(raid('journal-marker'));
    close(ledger);
    appendFileSync(join(dir, 'roads', 'ledger.ndjson'), '{"unexpected":true}\n');
    expect(() => new RoadLedger(dir)).toThrow();
  });

  it('recovers only an interrupted trailing append, retaining the complete prefix', () => {
    const dir = directory();
    let ledger = open(dir);
    ledger.observe(raid('prefix'));
    close(ledger);
    const journal = join(dir, 'roads', 'ledger.ndjson');
    const prefix = readFileSync(journal, 'utf8');
    appendFileSync(journal, '{"incomplete":');
    ledger = open(dir);
    expect(readFileSync(journal, 'utf8')).toBe(prefix);
    expect(ledger.road('100', '200')?.raids).toBe(1);
    expect(ledger.observe(raid('next')).kind).toBe('stored');
    close(ledger);
    ledger = open(dir);
    expect(ledger.road('100', '200')?.raids).toBe(2);
    expect(readFileSync(journal, 'utf8').startsWith(prefix)).toBe(true);
  });


  it('deduplicates across a batch and persists its tail cursor and aliases on restart', () => {
    const dir = directory();
    let ledger = open(dir);
    const first = raid('batch-first');
    const alias = raid('batch-alias', { source: 'herald', occurredAt: base + 1_000 });
    const next = raid('batch-next', { observedAt: base + 60_000, evidence: { kind: 'observed', asOf: base + 60_000 } });
    const results = ledger.observeBatch([first, alias, next], { checkpoint: { source: 'collector', after: null, cursor: 'tail' }, recovered: true });
    expect(results.map((receipt) => receipt.kind)).toEqual(['stored', 'duplicate', 'stored']);
    expect(results.map((receipt) => receipt.raidId)).toEqual(['batch-first', 'batch-alias', 'batch-next']);
    expect(ledger.road('100', '200')?.raids).toBe(2);
    close(ledger);
    ledger = open(dir);
    expect(ledger.checkpoint('collector')).toBe('tail');
    expect(ledger.observe(alias).kind).toBe('duplicate');
    expect(ledger.road('100', '200')).toMatchObject({ raids: 2, viewers: 50 });
  });

  it('validates the entire batch before writing any bytes or advancing its checkpoint', () => {
    const dir = directory();
    const ledger = open(dir);
    const journal = join(dir, 'roads', 'ledger.ndjson');
    const before = readFileSync(journal, 'utf8');
    expect(() => ledger.observeBatch([raid('valid'), raid('invalid', { viewers: 0 })], {
      checkpoint: { source: 'collector', after: null, cursor: 'tail' },
    })).toThrow();
    expect(readFileSync(journal, 'utf8')).toBe(before);
    expect(ledger.checkpoint('collector')).toBeNull();
    expect(ledger.roads()).toEqual([]);
    expect(() => ledger.observeBatch([])).toThrow();
    expect(() => ledger.observeBatch(Array.from({ length: 201 }, (_, i) => raid(`overlimit-${i}`)))).toThrow();
    expect(readFileSync(journal, 'utf8')).toBe(before);
  });

});
