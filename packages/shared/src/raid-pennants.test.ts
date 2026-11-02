import { describe, expect, it } from 'vitest';
import { parseRaidPennantFrame, RAID_PENNANT_FRAME_MAX_BYTES, RaidPennantFrameSchema } from './raid-show';

const now = 1_800_000_000_000;
const visit = (n: number) => ({ raidId: `raid.${n.toString(16).padStart(64, '0')}`, from: { kingdomId: '101', login: 'visitor', name: 'Visitor' }, occurredAt: now - 1000 });
const frame = () => ({ version: 1, origin: 'simulated', kingdomId: '202', asOf: now, items: [visit(1), visit(2)] });

describe('public raid pennant history', () => {
  it('keeps multiple visits from the same channel and never expires history', () => {
    expect(parseRaidPennantFrame(frame(), now + 50 * 365 * 86400_000)).toEqual(frame());
  });
  it('rejects duplicate visits, self scope and private metadata', () => {
    expect(RaidPennantFrameSchema.safeParse({ ...frame(), items: [visit(1), visit(1)] }).success).toBe(false);
    expect(RaidPennantFrameSchema.safeParse({ ...frame(), kingdomId: '101' }).success).toBe(false);
    expect(RaidPennantFrameSchema.safeParse({ ...frame(), items: [{ ...visit(1), viewers: 12 }] }).success).toBe(false);
    expect(RaidPennantFrameSchema.safeParse({ ...frame(), viewerId: '42' }).success).toBe(false);
  });
  it('bounds count, bytes, read time and provider time', () => {
    expect(parseRaidPennantFrame({ ...frame(), items: Array.from({ length: 65 }, (_, i) => visit(i)) }, now)).toBeNull();
    expect(parseRaidPennantFrame(' '.repeat(RAID_PENNANT_FRAME_MAX_BYTES + 1), now)).toBeNull();
    expect(parseRaidPennantFrame(JSON.stringify(frame()) + ' '.repeat(RAID_PENNANT_FRAME_MAX_BYTES), now)).toBeNull();
    expect(parseRaidPennantFrame({ ...frame(), asOf: now + 5001 }, now)).toBeNull();
    expect(parseRaidPennantFrame({ ...frame(), items: [{ ...visit(1), occurredAt: now + 5001 }] }, now)).toBeNull();
    expect(parseRaidPennantFrame(frame(), -1)).toBeNull();
  });
});
