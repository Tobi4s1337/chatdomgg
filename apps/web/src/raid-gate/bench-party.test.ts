import { describe, expect, it } from 'vitest';
import { RAID_PARTY_DRAWN, parseRaidPartyFrame } from '@chatdom/shared';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import { RAID_PARTY_SETOUT_MS } from '../../../realm/src/raid-gate/raid-party-frame';
import { createGateBench } from './bench';

const FERN = '41000002' as KingdomId, OAKEN = '41000003' as KingdomId;

describe('the gate party frame on the bench (the realm’s own rule)', () => {
  it('draws exactly who joined, the monarch first, through gather, countdown and the witnessed set-out', async () => {
    let now = 1_800_000_000_000;
    const bench = createGateBench({ viewer: 'walker', authority: 'ready', clock: () => now });
    expect(await bench.partyFrame()).toBeNull();

    const preview = await bench.monarchPreview(FERN);
    if (preview.kind !== 'preview') throw new Error('No preview');
    const { requestId } = preview.value;
    // The gate is open and nobody has chosen yet: a party of no one, led by the crown's standard.
    expect(await bench.partyFrame()).toMatchObject({ phase: 'gather', marchers: [], more: 0, destination: { kingdomId: FERN, land: 'founded', name: 'Fernhollow' } });

    now += 1_000; await bench.walkersJoin(2, requestId);
    now += 1_000; await bench.monarchJoin(requestId);
    const gathered = await bench.partyFrame();
    expect(gathered?.marchers.map(each => [each.name, each.leader])).toEqual([['King Alder', true], ['Tamsin', false], ['Citizen', false]]);
    expect(parseRaidPartyFrame(gathered, now)).not.toBeNull();
    // Keys are opaque and stable; nothing in the frame is a person ID.
    expect(new Set(gathered!.marchers.map(each => each.key)).size).toBe(3);
    expect(JSON.stringify(gathered)).not.toContain('52000002');

    now += 1_000; await bench.monarchStart(requestId);
    const counting = await bench.partyFrame();
    expect(counting).toMatchObject({ phase: 'countdown', countdownEndsAt: now + 90_000, departedAt: null, raidId: null });

    now += 8_000; await bench.witness(requestId, 140);
    const leaving = await bench.partyFrame();
    expect(leaving).toMatchObject({ phase: 'setout', departedAt: now });
    expect(leaving?.raidId).toMatch(/^raid\.[a-f0-9]{64}$/u);
    expect(leaving?.marchers).toHaveLength(3);

    // The set-out is told for a while, then the gate holds no party again.
    now += RAID_PARTY_SETOUT_MS;
    expect(await bench.partyFrame()).toBeNull();
  });

  it('tells a road to waiting land as such, and never draws more than the frame may hold', async () => {
    let now = 1_800_000_000_000;
    const bench = createGateBench({ viewer: 'monarch', authority: 'ready', clock: () => now });
    const preview = await bench.monarchPreview(OAKEN);
    if (preview.kind !== 'preview') throw new Error('No preview');
    now += 500; await bench.walkersJoin(7, preview.value.requestId);
    const frame = await bench.partyFrame();
    expect(frame).toMatchObject({ phase: 'gather', destination: { kingdomId: OAKEN, land: 'waiting' }, more: 0 });
    expect(frame!.marchers.length).toBeLessThanOrEqual(RAID_PARTY_DRAWN);
    expect(frame!.marchers.every(each => !each.leader)).toBe(true);
  });
});
