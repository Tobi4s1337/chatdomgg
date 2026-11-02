import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, type AtlasRaid } from '@chatdom/shared';
import { RoadLedger } from './ledger';

const dirs: string[] = [];
const ledgers: RoadLedger[] = [];
const t = 1_700_000_000_000;
const DAY = 86_400_000;
const id = (value: string) => KingdomIdSchema.parse(value);
function directory() { const dir = mkdtempSync(join(tmpdir(), 'road-reads-')); dirs.push(dir); return dir; }
function open(dir: string) { const ledger = new RoadLedger(dir); ledgers.push(ledger); return ledger; }
function close(ledger: RoadLedger) { ledger.close(); ledgers.splice(ledgers.indexOf(ledger), 1); }
function raid(name: string, from: string, to: string, at: number, viewers = 5, source: AtlasRaid['source'] = 'herald'): AtlasRaid {
  return { version: 1, id: name, fromKingdomId: id(from), toKingdomId: id(to), viewers, observedAt: at + 100, occurredAt: source === 'surveyor-sse' ? null : at,
    evidence: { kind: 'observed', asOf: at + 100 }, delivery: source === 'surveyor-sse' ? 'ephemeral' : 'resumable', source };
}
afterEach(() => { for (const ledger of ledgers.splice(0)) ledger.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('road ledger reads', () => {
  it('tallies each direction under the same rules as the totals, across restart', () => {
    const dir = directory(); let ledger = open(dir);
    ledger.observe(raid('a', '300', '200', t, 10));
    ledger.observe(raid('b', '300', '200', t + DAY, 20));
    ledger.observe(raid('c', '200', '300', t + 2 * DAY, 7));
    // The key orders IDs as text: 200~300, so forward is 200 → 300.
    expect(ledger.road('300', '200')).toMatchObject({ key: '200~300', raids: 3, viewers: 37, forward: { raids: 1, viewers: 7 }, backward: { raids: 2, viewers: 30 }, countBasis: 'observations' });
    ledger.reconcile([{ fromKingdomId: id('300'), toKingdomId: id('200'), raids: 9, viewersTotal: 90, lastAt: t + 3 * DAY }], { provenance: 'collector-a', reference: 'snap', cutAt: t + 3 * DAY });
    const expected = { raids: 10, viewers: 97, forward: { raids: 1, viewers: 7 }, backward: { raids: 9, viewers: 90 }, countBasis: 'at-least', firstAt: null };
    expect(ledger.road('200', '300')).toMatchObject(expected);
    // Aggregates add no events: only the three witnessed raids are the road's story.
    expect(ledger.road('200', '300')!.events).toHaveLength(3);
    close(ledger); ledger = open(dir);
    expect(ledger.road('200', '300')).toMatchObject(expected);
    expect(ledger.lines('300')).toEqual([expect.objectContaining(expected)]);
  });

  it('lists one channel\'s roads from its index without events, newest stories first, and never forgets an old road', () => {
    const ledger = open(directory());
    ledger.observe(raid('old', '100', '200', t - 400 * DAY));
    ledger.observe(raid('x', '100', '300', t));
    ledger.observe(raid('y', '400', '100', t + 1_000));
    ledger.observe(raid('z', '400', '500', t + 2_000));
    const lines = ledger.lines('100');
    expect(lines.map((line) => line.key)).toEqual(['100~200', '100~300', '100~400']);
    expect(lines.every((line) => !('events' in line))).toBe(true);
    expect(ledger.lines('999')).toEqual([]);
    expect(ledger.roads('100').map((road) => road.key)).toEqual(['100~200', '100~300', '100~400']);
    expect(ledger.lines('100')[0]).toMatchObject({ lastAt: t - 400 * DAY, raids: 1 });
    expect(ledger.earliestEventAt()).toBe(t - 400 * DAY);
    ledger.observe(raid('later', '100', '300', t + 50_000));
    ledger.observe(raid('earlier', '300', '100', t - 50_000));
    expect(ledger.recent('300', '100', 2).map((event) => event.id)).toEqual(['later', 'x']);
    expect(ledger.recent('100', '300', 5).map((event) => event.id)).toEqual(['later', 'x', 'earlier']);
    // A returned list is a copy: changing it cannot change the ledger.
    lines[0]!.forward.raids = 99;
    expect(ledger.lines('100')[0]!.forward.raids).toBe(1);
  });

  it('ranks the busiest roads by raids, travellers, recency and key, and refreshes the ranking after a change', () => {
    const ledger = open(directory());
    ledger.observe(raid('a1', '1', '2', t, 5)); ledger.observe(raid('a2', '1', '2', t + DAY, 5));
    ledger.observe(raid('b1', '3', '4', t, 50));
    ledger.observe(raid('c1', '5', '6', t + 5, 50));
    ledger.observe(raid('d1', '7', '8', t + 5, 50));
    expect(ledger.busiest(10).map((road) => road.key)).toEqual(['1~2', '5~6', '7~8', '3~4']);
    expect(ledger.busiest(2).map((road) => road.key)).toEqual(['1~2', '5~6']);
    expect(ledger.busiest(2, (road) => road.from !== '5').map((road) => road.key)).toEqual(['1~2', '7~8']);
    ledger.observe(raid('b2', '4', '3', t + 2 * DAY, 1)); ledger.observe(raid('b3', '4', '3', t + 3 * DAY, 1));
    expect(ledger.busiest(1)[0]).toMatchObject({ key: '3~4', raids: 3, forward: { raids: 1 }, backward: { raids: 2 } });
  });
});
