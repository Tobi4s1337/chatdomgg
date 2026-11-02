/** SIMULATED observations and gate records; these tests never contact Twitch or the live realm. */
import { describe, expect, it, vi } from 'vitest';
import { AtlasRaidSchema, type AtlasRaid } from '../../../../packages/shared/src/atlas-raids';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src/identity';
import { createRaidGateApplication } from './application';
import { GATE_LIMITS } from './contracts';
import { createMemoryRaidGateRepository } from './memory-repository';
import { correlateObservedRaid, RaidObservationConflict, recordObservedRaid } from './observed-raid';
import type { TrustedRaidObservation } from './ports';
import { outboxId, type RaidActionRecord, type RaidGateRepository, type RaidOutboxRecord } from './repository';

const FROM = KingdomIdSchema.parse('41000001'), TO = KingdomIdSchema.parse('41000002');
const OTHER = KingdomIdSchema.parse('41000003');
const NOW = 1_800_000_000_000;
const SIGNAL = new AbortController().signal;

const pending = (): RaidActionRecord => ({
  requestId: 'r1', revision: 1, actorId: PersonIdSchema.parse(FROM), sessionId: 'session1', from: FROM, to: TO,
  target: { kingdomId: TO, founded: true, live: true, classification: 'general' }, state: 'pending',
  previewTokenHash: 'a'.repeat(64), previewExpiresAt: NOW + 120_000, optedIn: 1, createdAt: NOW,
  updatedAt: NOW, observedAt: NOW, raid: null, endReason: null, origin: 'simulated',
  dispatchedAt: NOW, acceptedAt: NOW, rejection: null, raidEventId: null,
});

const effect = (kind: RaidOutboxRecord['kind'], state: RaidOutboxRecord['state'] = 'claimed'): RaidOutboxRecord => ({
  id: outboxId('r1', kind), revision: 1, requestId: 'r1', kind, state, createdAt: NOW,
  claimedAt: state === 'queued' ? null : NOW, settledAt: null, outcome: null, attempts: state === 'queued' ? 0 : 1, origin: 'simulated',
});

function observation(change: Partial<AtlasRaid> = {}): TrustedRaidObservation {
  return { raid: AtlasRaidSchema.parse({
    version: 1, id: 'simulated-raid1', fromKingdomId: FROM, toKingdomId: TO, viewers: 14,
    observedAt: NOW + 30_000, occurredAt: NOW + 30_000,
    evidence: { kind: 'simulated', asOf: NOW + 30_000, label: 'SIMULATED' }, delivery: 'resumable', source: 'simulation', ...change,
  }), upstreamEventId: 'event1', actionRequestId: 'r1', receivedAt: NOW + 30_000 };
}

async function setup(action = pending(), start: RaidOutboxRecord | null = effect('start'), cancel: RaidOutboxRecord | null = null) {
  const repo = createMemoryRaidGateRepository();
  await repo.transaction(async tx => {
    await tx.putGate({ kingdomId: FROM, revision: 1, requestId: action.requestId, updatedAt: NOW }, 0);
    await tx.putAction(action, 0);
    if (start) await tx.putOutbox(start, 0);
    if (cancel) await tx.putOutbox(cancel, 0);
  }, SIGNAL);
  return repo;
}

describe('observed raid transaction authority', () => {
  it('refuses an explicitly correlated action belonging to another origin', async () => {
    const repo = await setup({ ...pending(), origin: 'live' });
    const before = repo.snapshot();
    expect(await repo.transaction(tx => recordObservedRaid(tx, observation(), { origin: 'simulated', now: NOW }), SIGNAL))
      .toEqual({ receipt: { kind: 'ignored', reason: 'untrusted' }, landed: null });
    expect(repo.snapshot()).toEqual(before);
  });
  it('correlates only the source pointer, matching pair and origin, and an actually attempted start', async () => {
    const repo = await setup();
    const correlate = (raid = observation().raid, origin: 'live' | 'simulated' = 'simulated') => repo.transaction(tx => correlateObservedRaid(tx, raid, origin), SIGNAL);
    expect(await correlate()).toBe('r1');
    expect(await correlate(observation({ toKingdomId: OTHER }).raid)).toBeNull();
    expect(await correlate(observation().raid, 'live')).toBeNull();
    expect(await correlate(observation({ fromKingdomId: OTHER }).raid)).toBeNull();
    // A different matching action is never searched for once the current pointer clears.
    await repo.transaction(async tx => {
      await tx.putGate({ kingdomId: FROM, revision: 2, requestId: null, updatedAt: NOW }, 1);
    }, SIGNAL);
    expect(await correlate()).toBeNull();
    for (const start of [null, effect('start', 'queued')]) {
      const unsent = await setup(pending(), start);
      expect(await unsent.transaction(tx => correlateObservedRaid(tx, observation().raid, 'simulated'), SIGNAL)).toBeNull();
      expect(await unsent.transaction(tx => recordObservedRaid(tx, observation(), { origin: 'simulated', now: NOW }), SIGNAL))
        .toMatchObject({ receipt: { kind: 'ignored', reason: 'uncorrelated' }, landed: null });
    }
  });

  it.each(['queued', 'claimed'] as const)('lands once with the road already recorded and settles a %s cancel', async cancelState => {
    const repo = await setup(pending(), effect('start'), effect('cancel', cancelState));
    const options = { origin: 'simulated' as const, now: NOW + 40_000, roadRecorded: true };
    const result = await repo.transaction(tx => recordObservedRaid(tx, observation(), options), SIGNAL);
    expect(result).toMatchObject({ receipt: { kind: 'landed', requestId: 'r1' }, landed: { state: 'landed', revision: 2, observedAt: options.now, updatedAt: options.now } });
    expect(repo.snapshot().outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'start', revision: 2, state: 'settled', outcome: 'accepted' }),
      expect.objectContaining({ kind: 'cancel', revision: 2, state: 'settled', outcome: cancelState === 'queued' ? 'lapsed' : 'rejected' }),
      expect.objectContaining({ kind: 'road', revision: 1, state: 'settled', outcome: 'delivered', attempts: 1, settledAt: options.now }),
    ]));
    const snapshot = repo.snapshot();
    expect(await repo.transaction(tx => correlateObservedRaid(tx, observation().raid, 'simulated'), SIGNAL)).toBe('r1');
    expect(await repo.transaction(tx => recordObservedRaid(tx, observation(), options), SIGNAL))
      .toEqual({ receipt: { kind: 'duplicate', requestId: 'r1' }, landed: null });
    expect(repo.snapshot()).toEqual(snapshot);
    expect(await repo.transaction(tx => recordObservedRaid(tx, observation({ id: 'simulated-raid2' }), options), SIGNAL))
      .toEqual({ receipt: { kind: 'duplicate', requestId: 'r1' }, landed: null });
    expect(await repo.transaction(tx => recordObservedRaid(tx, { ...observation({ id: 'simulated-raid2' }), upstreamEventId: 'event2' }, options), SIGNAL))
      .toEqual({ receipt: { kind: 'ignored', reason: 'conflict' }, landed: null });
  });

  it('leaves state enforcement to the landing authority after correlating a settled attempted request', async () => {
    const repo = await setup({ ...pending(), state: 'cancelled', endReason: 'withdrawn' });
    expect(await repo.transaction(tx => correlateObservedRaid(tx, observation().raid, 'simulated'), SIGNAL)).toBe('r1');
    expect(await repo.transaction(tx => recordObservedRaid(tx, observation(), { origin: 'simulated', now: NOW }), SIGNAL))
      .toEqual({ receipt: { kind: 'ignored', reason: 'settled' }, landed: null });
    expect(repo.snapshot().outbox).toHaveLength(1);
  });

  it('queues a road by default and leaves an uncorrelated observation ignored', async () => {
    const repo = await setup();
    expect(await repo.transaction(tx => recordObservedRaid(tx, { ...observation(), actionRequestId: null }, { origin: 'simulated', now: NOW }), SIGNAL))
      .toEqual({ receipt: { kind: 'ignored', reason: 'uncorrelated' }, landed: null });
    expect(repo.snapshot().actions[0]?.state).toBe('pending');
    await repo.transaction(tx => recordObservedRaid(tx, observation(), { origin: 'simulated', now: NOW }), SIGNAL);
    expect(repo.snapshot().outbox.find(row => row.kind === 'road')).toMatchObject({ state: 'queued', attempts: 0, claimedAt: null, settledAt: null, outcome: null });
  });

  it('uses the recorded event time on delayed delivery and allows receipt-only raids only within their grace window', async () => {
    const repo = await setup();
    const last = NOW + GATE_LIMITS.twitchCountdownMs + GATE_LIMITS.clockSkewMs;
    expect(await repo.transaction(tx => recordObservedRaid(tx, observation({ occurredAt: last + 1 }), { origin: 'simulated', now: last }), SIGNAL))
      .toMatchObject({ receipt: { kind: 'ignored', reason: 'out-of-window' } });
    expect(await repo.transaction(tx => recordObservedRaid(tx, observation({ occurredAt: last }), { origin: 'simulated', now: last + 3_600_000 }), SIGNAL))
      .toMatchObject({ receipt: { kind: 'landed' } });
    const receiptOnly = await setup();
    const limit = NOW + GATE_LIMITS.twitchCountdownMs + GATE_LIMITS.observationGraceMs;
    const at = (time: number) => observation({ occurredAt: null, observedAt: time, evidence: { kind: 'simulated', asOf: time, label: 'SIMULATED' } });
    expect(await receiptOnly.transaction(tx => recordObservedRaid(tx, at(limit + 1), { origin: 'simulated', now: limit }), SIGNAL))
      .toMatchObject({ receipt: { kind: 'ignored', reason: 'out-of-window' } });
    expect(await receiptOnly.transaction(tx => recordObservedRaid(tx, at(limit), { origin: 'simulated', now: limit }), SIGNAL))
      .toMatchObject({ receipt: { kind: 'landed' } });
  });

  it('rolls back the landing and start settlement when creating the road loses a compare-and-set race', async () => {
    const repo = await setup();
    const before = repo.snapshot();
    await expect(repo.transaction(tx => recordObservedRaid({ ...tx, putOutbox: async (record, expected) => record.kind === 'road'
      ? { kind: 'conflict', current: null } : tx.putOutbox(record, expected) }, observation(), { origin: 'simulated', now: NOW }), SIGNAL))
      .rejects.toBeInstanceOf(RaidObservationConflict);
    expect(repo.snapshot()).toEqual(before);
  });

  it('preserves application retries and announces and delivers only after the successful commit', async () => {
    const repo = await setup();
    let collide = true;
    const repository: RaidGateRepository = { transaction: (work, signal) => repo.transaction(tx => work({
      ...tx, async putOutbox(record, expected) {
        if (record.kind === 'road' && collide) { collide = false; return { kind: 'conflict', current: null }; }
        return tx.putOutbox(record, expected);
      },
    }), signal) };
    const changed = vi.fn(() => expect(repo.snapshot().actions[0]?.state).toBe('landed'));
    const observe = vi.fn(async () => { expect(repo.snapshot().actions[0]?.state).toBe('landed'); });
    const app = createRaidGateApplication({
      repository, origin: 'simulated', clock: () => NOW + 40_000,
      policy: { readStanding: async () => { throw new Error('unused'); }, readTarget: async () => null },
      tokens: { issue: () => 'unused', hash: async () => 'a'.repeat(64) },
      notifier: { changed }, roads: { origin: 'simulated', observe },
    });
    expect(await app.ingestRaid(observation())).toEqual({ kind: 'landed', requestId: 'r1' });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(repo.snapshot().actions[0]?.revision).toBe(2);
    expect(repo.snapshot().outbox.find(row => row.kind === 'road')).toMatchObject({ state: 'settled', outcome: 'delivered' });
  });
});
