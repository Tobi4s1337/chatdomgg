/**
 * Guards for the travel coordinator's distinct invariants (spec 23 Acceptance): cancellation releases a known
 * uncommitted hold, a destination denial keeps the source, waiting land reserves nothing, a full destination moves
 * nobody, an ambiguous commit that did not happen rolls back, and a reload before commit cannot strand a hold.
 * The room transport and the march check are SIMULATED.
 */
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PersonId } from '../../../../packages/shared/src/identity';
import { readGateReply, type GateContext, type TravelReason } from '../../../api/src/raid-gate/contracts';
import type { RaidMarchCheck, RaidMarchVerdict, TravelReply } from '../../../api/src/raid-gate/ports';
import { createRaidTravelCoordinator, TRAVEL_LIMITS } from './coordinator';
import { createMemoryTravelRepository } from './memory-repository';
import { createSimulatedRooms } from './simulated-rooms';

const SOURCE = KingdomIdSchema.parse('41000001');
const MIRA = KingdomIdSchema.parse('41000002');
const WAITING = KingdomIdSchema.parse('41000003');
const WREN = PersonIdSchema.parse('52000001');
const T0 = 1_800_000_000_000;
const RAID: TravelReason = { kind: 'raid', requestId: 'r1', raidId: 'simulated-raid-1' };

function setup(options: { prepareSteps?: number; verdict?: RaidMarchVerdict } = {}) {
  let now = T0;
  const clock = () => now;
  const repository = createMemoryTravelRepository();
  const rooms = createSimulatedRooms({ clock, rooms: [SOURCE, MIRA], prepareSteps: options.prepareSteps ?? 0 });
  let verdict: RaidMarchVerdict = options.verdict ?? { kind: 'marching', from: SOURCE, to: MIRA, founded: true, origin: 'simulated' };
  const marches: RaidMarchCheck = { check: async () => verdict };
  let issued = 0;
  const coordinator = createRaidTravelCoordinator({ repository, rooms: rooms.transport, marches, origin: 'simulated', clock, tickets: () => `t${++issued}` });
  const as = (personId: PersonId, sessionId = `session-${personId}`) => {
    const context = (): GateContext => ({ principal: { personId, sessionId, sourceKingdomId: SOURCE, sourceRole: 'citizen' }, now, signal: new AbortController().signal });
    const checked = async (reply: Promise<TravelReply>) => {
      const value = await reply;
      expect(readGateReply(structuredClone(value))).toEqual(value);
      return value;
    };
    return {
      reserve: (requestId: string, target = MIRA, reason: TravelReason = RAID) => checked(coordinator.reserve(context(), requestId, target, reason)),
      prepare: (ticket: string) => checked(coordinator.prepare(context(), ticket)),
      commit: (ticket: string) => checked(coordinator.commit(context(), ticket)),
      cancel: (ticket: string) => checked(coordinator.cancel(context(), ticket)),
      reconcile: (ticket: string) => checked(coordinator.reconcile(context(), ticket)),
      whereabouts: () => checked(coordinator.whereabouts(context())),
    };
  };
  return {
    coordinator, repository, rooms, clock, wren: as(WREN), wrenElsewhere: as(WREN, 'session-reloaded'),
    advance(ms: number) { now += ms; },
    refuse(code: 'stale' | 'unauthorized') { verdict = { kind: 'refused', code }; },
  };
}

const travelOf = (reply: TravelReply) => {
  if (reply.kind !== 'travel') throw new Error(`expected a journey, got ${JSON.stringify(reply)}`);
  return reply.value;
};

describe('Raid travel coordinator guards (SIMULATED rooms)', () => {
  it('releases a known hold on cancel, and a hold answered after the cancel', async () => {
    const s = setup({ prepareSteps: 3 });
    s.rooms.place(WREN, SOURCE);
    expect(travelOf(await s.wren.reserve('j1'))).toMatchObject({ state: 'reserved' });
    expect(travelOf(await s.wren.prepare('t1'))).toMatchObject({ state: 'preparing' });
    expect(travelOf(await s.wren.cancel('t1'))).toMatchObject({ state: 'cancelled' });
    expect(s.rooms.openHolds()).toBe(0);
    expect(s.rooms.membership(WREN)).toEqual({ kingdomId: SOURCE, generation: 0 });
    // A late readiness answer for the cancelled ticket changes nothing.
    expect(travelOf(await s.wren.prepare('t1'))).toMatchObject({ state: 'cancelled' });
    expect(await s.wren.commit('t1')).toMatchObject({ value: { state: 'cancelled' } });
    expect(s.rooms.calls.filter(call => call.startsWith('commit'))).toEqual([]);

    // The reserve answer was lost while the destination did hold a place: cancel still releases it.
    s.rooms.loseNextReserveAnswer();
    expect(travelOf(await s.wren.reserve('j2'))).toMatchObject({ state: 'reserved' });
    expect(s.rooms.openHolds()).toBe(1);
    expect(travelOf(await s.wren.cancel('t2'))).toMatchObject({ state: 'cancelled' });
    expect(s.rooms.openHolds()).toBe(0);
    expect(s.repository.snapshot().travel.every(record => record.release === 'none')).toBe(true);
  });

  it('keeps the source when the destination refuses at the door, and lets the walker try again', async () => {
    const s = setup();
    s.rooms.place(WREN, SOURCE);
    await s.wren.reserve('j1');
    expect(travelOf(await s.wren.prepare('t1'))).toMatchObject({ state: 'ready' });
    s.rooms.denyNextCommit();
    expect(travelOf(await s.wren.commit('t1'))).toMatchObject({ state: 'denied', role: null, arrivalId: null });
    expect(s.rooms.membership(WREN)).toEqual({ kingdomId: SOURCE, generation: 0 });
    expect(s.rooms.calls.filter(call => call.startsWith('release-source'))).toEqual([]);
    expect(s.rooms.openHolds()).toBe(0);
    expect(s.repository.snapshot().whereabouts).toEqual([expect.objectContaining({ kingdomId: SOURCE, generation: 0, active: null, fence: null })]);
    expect(s.repository.snapshot().arrivals).toEqual([]);
    expect(travelOf(await s.wren.reserve('j2'))).toMatchObject({ state: 'reserved', from: SOURCE });
  });

  it('reserves nothing for waiting land or a full destination, and nothing for someone who stayed home', async () => {
    const waiting = setup({ verdict: { kind: 'marching', from: SOURCE, to: WAITING, founded: false, origin: 'simulated' } });
    expect(await waiting.wren.reserve('j1', WAITING)).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(waiting.rooms.calls).toEqual([]);
    expect(waiting.repository.snapshot().travel).toEqual([]);

    const full = setup();
    full.rooms.fillNextAdmission();
    expect(await full.wren.reserve('j1')).toEqual({ kind: 'denied', code: 'full' });
    expect(full.repository.snapshot().travel).toEqual([]);
    // Waiting for room is simply asking again later; nothing was held in between.
    expect(travelOf(await full.wren.reserve('j1'))).toMatchObject({ state: 'reserved' });

    const stayed = setup({ verdict: { kind: 'refused', code: 'unauthorized' } });
    expect(await stayed.wren.reserve('j1')).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(stayed.rooms.calls).toEqual([]);
  });

  it('does not move a walker who chose to stay home after reserving', async () => {
    const s = setup();
    s.rooms.place(WREN, SOURCE);
    await s.wren.reserve('j1');
    await s.wren.prepare('t1');
    s.refuse('unauthorized');
    expect(travelOf(await s.wren.commit('t1'))).toMatchObject({ state: 'cancelled' });
    expect(s.rooms.membership(WREN)).toEqual({ kingdomId: SOURCE, generation: 0 });
    expect(s.rooms.openHolds()).toBe(0);
  });

  it('rolls back an ambiguous commit the destination never made, and frees the walker', async () => {
    const s = setup();
    s.rooms.place(WREN, SOURCE);
    await s.wren.reserve('j1');
    await s.wren.prepare('t1');
    // Simulate a commit that never reached the room: fenced and committing, no answer.
    await s.repository.transaction(async tx => {
      const travel = (await tx.getTravel('t1'))!;
      const here = (await tx.getWhereabouts(WREN))!;
      await tx.putWhereabouts({ ...here, revision: here.revision + 1, fence: 't1' }, here.revision);
      await tx.putTravel({ ...travel, revision: travel.revision + 1, state: 'committing', committingAt: s.clock() }, travel.revision);
    }, new AbortController().signal);
    // Too soon to ask: the commit may still be answering.
    expect(travelOf(await s.wren.cancel('t1'))).toMatchObject({ state: 'committing' });
    expect(await s.wren.reserve('j2', MIRA, { kind: 'visit' })).toEqual({ kind: 'denied', code: 'stale' });
    s.advance(TRAVEL_LIMITS.commitStallMs);
    expect(await s.coordinator.recover(s.clock(), 10)).toMatchObject({ reconciled: 1 });
    expect(s.repository.snapshot().travel).toEqual([expect.objectContaining({ ticket: 't1', state: 'expired', release: 'none' })]);
    // Nothing is outstanding and Wren never arrived anywhere: Wren is simply where Wren always was.
    expect(await s.wren.whereabouts()).toEqual({ kind: 'denied', code: 'stale' });
    expect(s.rooms.membership(WREN)).toEqual({ kingdomId: SOURCE, generation: 0 });
    // The room refuses that ticket from now on, so a late commit cannot move anyone.
    expect(await s.rooms.transport.commit({ ticket: 't1', personId: WREN, sessionId: 'x', from: SOURCE, to: MIRA, generation: 1, kind: 'raid' }, new AbortController().signal)).toEqual({ kind: 'denied' });
    expect(travelOf(await s.wren.reserve('j2'))).toMatchObject({ state: 'reserved' });
  });

  it('cancels a journey a reload left before the commit, and lapses one nobody finished', async () => {
    const s = setup();
    s.rooms.place(WREN, SOURCE);
    await s.wren.reserve('j1');
    await s.wren.prepare('t1');
    // The reloaded page has a new session: it may not step through on the old one, and finding it cancels it.
    expect(await s.wrenElsewhere.commit('t1')).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(travelOf(await s.wrenElsewhere.whereabouts())).toMatchObject({ ticket: 't1', state: 'ready' });
    expect(travelOf(await s.wrenElsewhere.reconcile('t1'))).toMatchObject({ state: 'cancelled' });
    expect(s.rooms.openHolds()).toBe(0);

    await s.wren.reserve('j2');
    s.advance(TRAVEL_LIMITS.maxLeaseMs);
    s.rooms.failReleases(true);
    expect(await s.coordinator.recover(s.clock(), 10)).toEqual({ expired: 1, reconciled: 0, released: 0 });
    expect(s.rooms.openHolds()).toBe(1);
    // The owed release is retried until the room server answers.
    s.rooms.failReleases(false);
    expect(await s.coordinator.recover(s.clock(), 10)).toEqual({ expired: 0, reconciled: 0, released: 1 });
    expect(s.rooms.openHolds()).toBe(0);
  });

  it('refuses a live coordinator wired to controlled rooms', () => {
    const rooms = createSimulatedRooms({ clock: () => T0, rooms: [MIRA] });
    expect(() => createRaidTravelCoordinator({
      repository: createMemoryTravelRepository(), rooms: rooms.transport, origin: 'live', clock: () => T0,
      marches: { check: async () => ({ kind: 'refused', code: 'stale' }) },
    })).toThrow(/simulated/);
  });
});
