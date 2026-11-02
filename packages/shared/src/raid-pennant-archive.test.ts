import { describe, expect, it } from 'vitest';
import { parseRaidPennantArchiveCursor, parseRaidPennantArchivePage, RAID_PENNANT_FRAME_MAX_BYTES } from './raid-show';

const item = { raidId: `raid.${'a'.repeat(64)}`, from: { kingdomId: '2', login: 'visitor', name: 'Visitor' }, occurredAt: 1 };
const page = { version: 1, origin: 'live', kingdomId: '1', asOf: 10, items: [item], next: 'pennants:1:live:1:90:80' };
describe('pennant archive wire contract', () => {
  it('accepts only canonical safe, scoped cursor positions', () => {
    expect(parseRaidPennantArchiveCursor(page.next)).toEqual({ origin: 'live', kingdomId: '1', ceiling: 90, before: 80 });
    for (const cursor of ['pennants:1:live:01:90:80', 'pennants:1:live:1:090:80', 'pennants:1:live:1:90:0', 'pennants:1:live:1:90:91', 'pennants:1:other:1:90:80', 'pennants:1:live:1:9007199254740992:1', 'pennants:1:live:0:90:80']) expect(parseRaidPennantArchiveCursor(cursor), cursor).toBeNull();
  });
  it('keeps old history, but rejects future, foreign, duplicate and private data', () => {
    expect(parseRaidPennantArchivePage(JSON.stringify(page), 10_000_000)).toEqual(page);
    for (const bad of [
      { ...page, asOf: 15_001 }, { ...page, next: 'pennants:1:simulated:1:90:80' },
      { ...page, next: 'pennants:1:live:3:90:80' }, { ...page, items: [item, item] },
      { ...page, items: [{ ...item, occurredAt: 5011 }] }, { ...page, items: [{ ...item, userId: 'private' }] },
      { ...page, items: [], next: page.next }, { ...page, secret: 'private' },
    ]) expect(parseRaidPennantArchivePage(bad, 10_000), JSON.stringify(bad)).toBeNull();
    expect(parseRaidPennantArchivePage(' '.repeat(RAID_PENNANT_FRAME_MAX_BYTES + 1), 10_000)).toBeNull();
  });
});
