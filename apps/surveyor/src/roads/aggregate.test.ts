import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, type AtlasRaid } from '@chatdom/shared';
import { RoadLedger } from './ledger';

const dirs: string[] = [];
const ledgers: RoadLedger[] = [];
const t = 1_700_000_000_000;
const id = (value: string) => KingdomIdSchema.parse(value);
function directory() { const dir = mkdtempSync(join(tmpdir(), 'road-aggregate-')); dirs.push(dir); return dir; }
function open(dir: string) { const ledger = new RoadLedger(dir); ledgers.push(ledger); return ledger; }
function close(ledger: RoadLedger) { ledger.close(); ledgers.splice(ledgers.indexOf(ledger), 1); }
function pair(raids = 10, viewersTotal = 100, overrides: Partial<{ fromKingdomId: ReturnType<typeof id>; toKingdomId: ReturnType<typeof id>; lastAt: number }> = {}) {
  return { fromKingdomId: id('100'), toKingdomId: id('200'), raids, viewersTotal, lastAt: t, ...overrides };
}
function raid(name: string, at: number, source: AtlasRaid['source'] = 'surveyor-sse', viewers = 5): AtlasRaid {
  return { version: 1, id: name, fromKingdomId: id('100'), toKingdomId: id('200'), viewers,
    observedAt: at, occurredAt: source === 'surveyor-sse' ? null : at,
    evidence: { kind: 'observed', asOf: at }, delivery: source === 'surveyor-sse' ? 'ephemeral' : 'resumable', source };
}
const opts = (reference: string, cutAt = t) => ({ provenance: 'collector-a', reference, cutAt });
afterEach(() => { for (const ledger of ledgers.splice(0)) ledger.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('durable road aggregate evidence', () => {
  it('reports a known history start for observation-only roads', () => {
    const ledger = open(directory());
    ledger.observe(raid('observed', t + 1_000), { provenance: 'collector-a' });
    expect(ledger.road('100', '200')).toMatchObject({ raids: 1, viewers: 5, observedRaids: 1, observedViewers: 5,
      firstAt: t + 1_000, firstObservedEventAt: t + 1_000, historyStartKnown: true, countBasis: 'observations' });
  });

  it('retains aggregate-only history without inventing events, including after restart', () => {
    const dir = directory(); let ledger = open(dir);
    expect(ledger.reconcile([pair()], opts('snapshot'))).toEqual({ stored: 1, duplicates: 0 });
    expect(ledger.road('100', '200')).toMatchObject({ raids: 10, viewers: 100, observedRaids: 0, observedViewers: 0,
      countBasis: 'at-least', firstAt: null, firstObservedEventAt: null, historyStartKnown: false, lastAt: t, events: [] });
    close(ledger); ledger = open(dir);
    expect(ledger.road('100', '200')).toMatchObject({ raids: 10, viewers: 100, events: [], firstAt: null });
  });

  it('counts only matching post-cut SSE witnesses, once per canonical cluster, with the SSE viewer count', () => {
    const ledger = open(directory()); ledger.reconcile([pair()], opts('snapshot'));
    ledger.observe(raid('covered-recorder', t - 1000, 'surveyor-recorder'), { provenance: 'collector-a' });
    ledger.observe(raid('covered-sse', t - 500), { provenance: 'collector-a' });
    ledger.observe(raid('covered-herald', t - 300, 'herald'));
    ledger.observe(raid('boundary', t), { provenance: 'collector-a' });
    ledger.observe(raid('wrong', t + 40_000), { provenance: 'other' });
    ledger.observe(raid('missing', t + 80_000));
    ledger.observe(raid('post-recorder', t + 120_000, 'surveyor-recorder', 50), { provenance: 'collector-a' });
    ledger.observe(raid('post-herald', t + 120_100, 'herald', 60), { provenance: 'collector-a' });
    expect(ledger.road('100', '200')).toMatchObject({ raids: 10, viewers: 100 });
    expect(ledger.observe(raid('post-sse', t + 120_200, 'surveyor-sse', 7), { provenance: 'collector-a' }).kind).toBe('duplicate');
    expect(ledger.road('100', '200')).toMatchObject({ raids: 11, viewers: 107, firstAt: null, historyStartKnown: false });
  });

  it('retains stronger older baselines and treats reverse directions independently, regardless of delivery order', () => {
    for (const reverseOrder of [false, true]) {
      const ledger = open(directory());
      const old = () => ledger.reconcile([pair(20, 200)], opts('old'));
      const newer = () => ledger.reconcile([pair(12, 120, { lastAt: t + 90_000 })], opts('new', t + 100_000));
      if (reverseOrder) { newer(); old(); } else { old(); newer(); }
      ledger.observe(raid('witness', t + 50_000), { provenance: 'collector-a' });
      ledger.reconcile([pair(3, 30, { fromKingdomId: id('200'), toKingdomId: id('100') })], opts('reverse'));
      expect(ledger.road('100', '200')).toMatchObject({ raids: 24, viewers: 235, observedRaids: 1, observedViewers: 5 });
    }
  });

  it('persists provenance added to an already known ID and counts the alias after restart', () => {
    const dir = directory(); let ledger = open(dir);
    ledger.reconcile([pair()], opts('snapshot'));
    const witness = raid('known', t + 60_000);
    ledger.observe(witness);
    expect(ledger.road('100', '200')?.raids).toBe(10);
    expect(ledger.observe(witness, { provenance: 'collector-a' }).kind).toBe('duplicate');
    close(ledger); ledger = open(dir);
    expect(ledger.road('100', '200')).toMatchObject({ raids: 11, viewers: 105, observedRaids: 1 });
    expect(ledger.observe(witness, { provenance: 'collector-a' }).kind).toBe('duplicate');
    expect(ledger.road('100', '200')?.raids).toBe(11);
  });

  it('rejects conflicting snapshots, invalid batches and stale checkpoints before writing', () => {
    const dir = directory(); const ledger = open(dir); const journal = join(dir, 'roads', 'ledger.ndjson');
    ledger.reconcile([pair()], { ...opts('same'), checkpoint: { source: 'snapshot', after: null, cursor: 'one' } });
    expect(ledger.reconcile([pair()], opts('same'))).toEqual({ stored: 0, duplicates: 1 });
    const before = readFileSync(journal, 'utf8');
    expect(() => ledger.reconcile([pair(11)], opts('same'))).toThrow();
    expect(() => ledger.reconcile([pair()], opts('early', t - 1))).toThrow();
    expect(() => ledger.reconcile([], opts('empty'))).toThrow();
    expect(() => ledger.reconcile(Array.from({ length: 201 }, () => pair()), opts('big'))).toThrow();
    expect(() => ledger.reconcile([pair()], { ...opts('stale'), checkpoint: { source: 'snapshot', after: null, cursor: 'two' } })).toThrow();
    expect(readFileSync(journal, 'utf8')).toBe(before);
    expect(ledger.checkpoint('snapshot')).toBe('one');
  });

  it('skips dominated fresh snapshots without journal growth, while persisting their tail checkpoint', () => {
    const dir = directory(); let ledger = open(dir); const journal = join(dir, 'roads', 'ledger.ndjson');
    ledger.reconcile([pair(20, 200)], opts('strong'));
    const before = readFileSync(journal, 'utf8');
    expect(ledger.reconcile([pair(10, 100)], opts('fresh', t + 10_000))).toEqual({ stored: 0, duplicates: 1 });
    expect(readFileSync(journal, 'utf8')).toBe(before);
    expect(ledger.reconcile([pair(10, 100)], { ...opts('fresh', t + 10_000),
      checkpoint: { source: 'snapshots', after: null, cursor: 'two' } })).toEqual({ stored: 0, duplicates: 1 });
    close(ledger); ledger = open(dir);
    expect(ledger.checkpoint('snapshots')).toBe('two');
    expect(ledger.road('100', '200')).toMatchObject({ raids: 20, viewers: 200 });
    expect(ledger.reconcile([pair(21, 201)], opts('fresh', t + 10_000))).toEqual({ stored: 1, duplicates: 0 });
  });

  it('recovers an interrupted trailing aggregate record and accepts a retry', () => {
    const dir = directory(); let ledger = open(dir); ledger.reconcile([pair()], opts('first')); close(ledger);
    const journal = join(dir, 'roads', 'ledger.ndjson'); const prefix = readFileSync(journal, 'utf8');
    appendFileSync(journal, '{"interrupted":'); ledger = open(dir);
    expect(readFileSync(journal, 'utf8')).toBe(prefix);
    expect(ledger.reconcile([pair(12, 120)], opts('retry'))).toEqual({ stored: 1, duplicates: 0 });
    close(ledger); ledger = open(dir);
    expect(ledger.road('100', '200')).toMatchObject({ raids: 12, viewers: 120, events: [] });
  });

  it('refuses unsafe baseline plus witness arithmetic instead of acknowledging a rounded count', () => {
    const dir = directory(); let ledger = open(dir);
    ledger.reconcile([pair(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)], opts('max'));
    expect(() => ledger.observe(raid('overflow', t + 60_000), { provenance: 'collector-a' })).toThrow();
    close(ledger);
    expect(() => { ledger = open(dir); }).not.toThrow();
    expect(ledger.road('100', '200')).toMatchObject({ raids: Number.MAX_SAFE_INTEGER, viewers: Number.MAX_SAFE_INTEGER, events: [] });
  });
});
