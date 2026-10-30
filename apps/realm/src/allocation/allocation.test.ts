import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { TenureEvidenceError, TenureEvidenceVerifier, choosePlot, signTenureEvidence, type PlotChoice, type UnsignedTenureEvidence } from './index';

const kingdomId = KingdomIdSchema.parse('41000001'), personId = PersonIdSchema.parse('52000001');
const key = randomBytes(32), now = Date.UTC(2026, 9, 30);
const follow = (followedAt: number, extra: Partial<UnsignedTenureEvidence> = {}) =>
  signTenureEvidence(key, { version: 1, kind: 'follow', source: 'helix.channel-followers', kingdomId, personId, origin: 'live', observedAt: now - 1_000, followedAt, ...extra } as UnsignedTenureEvidence);
const months = (count: number) =>
  signTenureEvidence(key, { version: 1, kind: 'subscription', source: 'chat.badge-info', kingdomId, personId, origin: 'live', observedAt: now - 1_000, months: count });

/** Two quarters (2023, 2024), each with three rows of two plots, ordinals growing outward. */
const plots: PlotChoice[] = [2023, 2024].flatMap((quarterYear, q) => [0, 1, 2, 3, 4, 5].map(ordinal => ({
  plotId: `plot:${quarterYear}:${ordinal}`, slot: q * 1024 + ordinal, quarterYear, rowId: `row:${quarterYear}:${Math.floor(ordinal / 2)}`, ordinal })));

describe('tenure evidence and the address rule', () => {
  it('trusts only signed, matching, observed history, and places by follow year, row and one street of sub months', () => {
    const verifier = new TenureEvidenceVerifier('live', key);
    const expected = { kingdomId, personId, now };
    expect(verifier.verify([follow(Date.UTC(2024, 1, 1)), months(14)], expected)).toMatchObject({ followedAt: Date.UTC(2024, 1, 1), subscribedMonths: 14 });
    expect(verifier.verify([], expected)).toEqual({ followedAt: null, subscribedMonths: null, records: [] });
    const refused = (records: unknown[], label: string) => expect(() => verifier.verify(records, expected), label).toThrow(TenureEvidenceError);
    refused([{ ...follow(Date.UTC(2020, 0, 1)), followedAt: Date.UTC(2019, 0, 1) }], 'a rewritten follow date');
    refused([signTenureEvidence(randomBytes(32), { version: 1, kind: 'subscription', source: 'chat.badge-info', kingdomId, personId, origin: 'live', observedAt: now, months: 3 })], 'another key');
    refused([follow(Date.UTC(2024, 0, 1), { personId: PersonIdSchema.parse('52000002') })], 'another person');
    refused([follow(Date.UTC(2024, 0, 1), { origin: 'simulated' })], 'simulated evidence in a live realm');
    refused([follow(Date.UTC(2024, 0, 1), { observedAt: now + 3_600_000 })], 'observed in the future');
    refused([follow(Date.UTC(2022, 0, 1)), follow(Date.UTC(2025, 0, 1))], 'two follow dates to shop between');

    const none = new Set<string>();
    const at = (followedAt: number | null, subscribedMonths: number | null, occupied = none) => choosePlot(plots, occupied, { followedAt, subscribedMonths });
    // The follow year picks the quarter; its place in the year picks the row.
    expect(at(Date.UTC(2023, 0, 5), null)).toMatchObject({ plot: { plotId: 'plot:2023:0' }, placement: { quarter: 'follow-year', targetRow: 0, spill: null } });
    expect(at(Date.UTC(2023, 11, 20), null)).toMatchObject({ plot: { plotId: 'plot:2023:4' }, placement: { targetRow: 2 } });
    // Older than the founded years: the oldest quarter's root. Unknown: the edge of the newest quarter.
    expect(at(Date.UTC(2019, 5, 1), null)?.placement).toMatchObject({ quarter: 'before-founding', quarterYear: 2023, targetRow: 0 });
    expect(at(null, 30)).toMatchObject({ plot: { plotId: 'plot:2024:2' }, placement: { quarter: 'unknown-newest', followYear: null, subscriptionStep: true, targetRow: 1 } });
    // Sub months move one street toward the castle, once, and never into an older quarter.
    expect(at(Date.UTC(2024, 11, 20), 50)).toMatchObject({ plot: { plotId: 'plot:2024:2' }, placement: { quarterYear: 2024, targetRow: 1, subscriptionStep: true } });
    expect(at(Date.UTC(2024, 0, 2), 50)?.placement).toMatchObject({ quarterYear: 2024, targetRow: 0, subscriptionStep: false });
    // A full row spills outward first; a full quarter spills to the nearest quarter, newer first.
    expect(at(Date.UTC(2023, 0, 5), null, new Set(['plot:2023:0', 'plot:2023:1']))).toMatchObject({ plot: { plotId: 'plot:2023:2' }, placement: { spill: 'row' } });
    const quarterFull = new Set(plots.filter(p => p.quarterYear === 2023).map(p => p.plotId));
    expect(at(Date.UTC(2023, 0, 5), null, quarterFull)).toMatchObject({ plot: { plotId: 'plot:2024:0' }, placement: { spill: 'quarter', quarterYear: 2024 } });
    expect(at(null, null, new Set(plots.map(p => p.plotId)))).toBeNull();
  });
});
