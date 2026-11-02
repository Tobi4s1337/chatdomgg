import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fault = vi.hoisted(() => ({ failFsync: false, fsyncCalls: 0 }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    fsyncSync(fd: number) {
      fault.fsyncCalls++;
      if (fault.failFsync) throw new Error('injected fsync failure');
      return fs.fsyncSync(fd);
    },
  };
});

import { RoadLedger } from './ledger';

const dirs: string[] = [];
function directory() { const dir = mkdtempSync(join(tmpdir(), 'chatdom-road-fsync-')); dirs.push(dir); return dir; }
afterEach(() => { fault.failFsync = false; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('poisons an uncertain write and recovers the full record and cursor without acknowledging it twice', () => {
  const dir = directory();
  const raid = {
    version: 1, id: 'uncertain', fromKingdomId: '100', toKingdomId: '200', viewers: 20,
    observedAt: 1_700_000_000_000, occurredAt: null,
    evidence: { kind: 'observed', asOf: 1_700_000_000_000 },
    delivery: 'resumable', source: 'surveyor-recorder',
  };
  let ledger = new RoadLedger(dir);
  fault.failFsync = true;
  expect(() => ledger.observe(raid, { checkpoint: { source: 'collector', after: null, cursor: 'one' } }))
    .toThrow('injected fsync failure');
  const journal = readFileSync(join(dir, 'roads', 'ledger.ndjson'), 'utf8');
  expect(journal.endsWith('\n')).toBe(true);
  expect(JSON.parse(journal).body.raid.id).toBe('uncertain');
  expect(() => ledger.observe(raid)).toThrow(/poisoned/);
  expect(() => ledger.advance('collector', null, 'two')).toThrow(/poisoned/);
  expect(() => ledger.checkpoint('collector')).toThrow(/poisoned/);
  expect(() => ledger.road('100', '200')).toThrow(/poisoned/);
  expect(() => ledger.roads()).toThrow(/poisoned/);
  ledger.close();

  fault.failFsync = false;
  ledger = new RoadLedger(dir);
  try {
    expect(ledger.checkpoint('collector')).toBe('one');
    expect(ledger.road('100', '200')).toMatchObject({ raids: 1, viewers: 20 });
    expect(ledger.observe(raid)).toMatchObject({ kind: 'duplicate', raidId: 'uncertain', raids: 1 });
    expect(ledger.roads()).toHaveLength(1);
  } finally { ledger.close(); }
});


it('recovers all completed batch records and the tail cursor after an uncertain fsync', () => {
  const dir = directory();
  const base = 1_700_000_000_000;
  const raids = [0, 1, 2].map((i) => ({
    version: 1, id: `batch-${i}`, fromKingdomId: '100', toKingdomId: '200', viewers: 20,
    observedAt: base + i * 60_000, occurredAt: null,
    evidence: { kind: 'observed', asOf: base + i * 60_000 },
    delivery: 'resumable', source: 'surveyor-recorder',
  }));
  let ledger = new RoadLedger(dir);
  fault.fsyncCalls = 0;
  fault.failFsync = true;
  expect(() => ledger.observeBatch(raids, { checkpoint: { source: 'collector', after: null, cursor: 'tail' } }))
    .toThrow('injected fsync failure');
  expect(fault.fsyncCalls).toBe(1);
  const lines = readFileSync(join(dir, 'roads', 'ledger.ndjson'), 'utf8').trim().split('\n');
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(() => ledger.roads()).toThrow(/poisoned/);
  expect(() => ledger.checkpoint('collector')).toThrow(/poisoned/);
  ledger.close();
  fault.failFsync = false;
  ledger = new RoadLedger(dir);
  try {
    expect(ledger.checkpoint('collector')).toBe('tail');
    expect(ledger.road('100', '200')).toMatchObject({ raids: 3, viewers: 60 });
    expect(ledger.observeBatch(raids).map((receipt) => receipt.kind)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    expect(ledger.road('100', '200')?.raids).toBe(3);
  } finally { ledger.close(); }
});
