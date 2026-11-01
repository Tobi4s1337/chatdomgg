import { expect, it } from 'vitest';
import { GrowthSceneFrameSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmCapability, RealmDomainCommand, RealmFact } from '@chatdom/shared/realm';
import { VOXEL_FIXTURE, WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import { applyRealmFact, createRealmState, decideRealm, projectRealmFact } from './reducer';

const dayMs = 86_400_000;
const quiet = PersonIdSchema.parse('300');
const home = { id: 'plot:growth', ownerId: personId, slot: 0, allocationReceipt: 'private:allocation', layoutRevision: 'founded:1',
  revision: 'home:1', digest: 'a'.repeat(64), family: 'hearth' as const, blueprint: VOXEL_FIXTURE,
  attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'names:1' }, attachments: {} };

function harness() {
  let state = createRealmState(kingdomId, 'live'), now = 0;
  const facts: RealmFact[] = [];
  const decide = (command: RealmDomainCommand, capability: RealmCapability) => decideRealm(state, command,
    { now, capability, writerEpoch: 'writer:growth', commandId: `growth:${state.sequence + 1}`, current: true, anvilCapacity: 2 });
  const commit = (command: RealmDomainCommand, capability: RealmCapability) => {
    const result = decide(command, capability);
    if (result.kind !== 'accepted') throw new Error(`Expected accepted growth source, got ${result.kind}`);
    state = result.state; facts.push(result.fact); return result;
  };
  const night = (day: number, id = `stream:${day}`) => {
    now = day * dayMs;
    return commit({ type: 'stream.observe', sessionId: id, startedAt: now, liveUntil: now + 3_600_000 }, 'presence');
  };
  const interval = (from: number, through: number, person = personId) => {
    now = Math.max(now, through);
    return commit({ type: 'presence.confirmInterval', personId: person, streamSessionId: state.stream.sessionId!, from, through,
      evidenceReceipt: `private:interval:${facts.length}` }, 'presence');
  };
  return { decide, commit, night, interval, facts, get state() { return state; } };
}

it('commits witnessed growth with its source fact, counts quiet citizens once, and replays ceremonies exactly', () => {
  const h = harness();
  h.commit({ type: 'home.installAllocated', home }, 'allocation');
  expect(h.state.growth?.citizens[personId]).toBeUndefined(); // Geometry does not invent a trusted tier floor.
  const binding = { type: 'growth.bindHome' as const, homeId: home.id, installedTier: 'hut' as const, evidenceReceipt: home.allocationReceipt };
  expect(h.decide(binding, 'presence')).toMatchObject({ kind: 'rejected', reason: 'forbidden' });
  expect(h.decide({ ...binding, homeId: 'absent' }, 'allocation').kind).toBe('rejected');
  expect(h.decide({ ...binding, evidenceReceipt: '' }, 'allocation').kind).toBe('rejected');
  expect(h.decide({ ...binding, evidenceReceipt: 'forged:receipt' }, 'allocation').kind).toBe('rejected');
  const bound = h.commit(binding, 'allocation');
  expect(bound.public).toMatchObject([{ type: 'growth', frame: { homes: [{ stage: 'hut', qualifiedDays: 0 }], beats: [] } }]);
  expect(h.decide(binding, 'allocation').kind).toBe('unchanged');
  for (let day = 1; day <= 7; day++) {
    const start = day * dayMs;
    h.night(day);
    const short = h.interval(start, start + 300_000);
    expect(short.public).toEqual([]);
    const crossing = h.interval(start + 100_000, start + 600_000);
    const growth = crossing.public.find(message => message.type === 'growth');
    expect(growth?.frame.homes[0]?.qualifiedDays).toBe(day);
    if (day === 7) {
      expect(growth?.frame.beats).toEqual([
        { kind: 'home-grown', sourceSeq: crossing.fact.seq, at: crossing.fact.committedAt, plotId: home.id, from: 'hut', to: 'cottage', qualifiedDays: 7 },
        { kind: 'streak-reached', sourceSeq: crossing.fact.seq, at: crossing.fact.committedAt, plotId: home.id, days: 7 },
        { kind: 'civic-levelled', sourceSeq: crossing.fact.seq, at: crossing.fact.committedAt, place: 'tavern', from: 1, to: 2 },
      ]);
      expect(projectRealmFact(h.state, crossing.fact)).toMatchObject([{ type: 'growth', frame: { beats: [] } }]);
      expect(projectRealmFact(h.state, crossing.fact, h.facts.slice(0, -1).reduce(applyRealmFact, createRealmState(kingdomId, 'live')))).toEqual(crossing.public);
    }
    expect(h.interval(start, start + 600_000).public).toEqual([]);
    h.interval(start, start + 600_000, quiet);
    expect(h.interval(start, start + 600_000, quiet).public).toEqual([]);
  }
  expect(h.state.growth?.citizens[personId]).toMatchObject({ qualifiedDays: 7, home: { stage: 'cottage' } });
  expect(h.state.growth?.citizens[quiet]).toMatchObject({ qualifiedDays: 7, home: null });
  expect(h.state.growth?.civic).toMatchObject({ qualifiedDays: 7, personDays: 14 });
  expect(h.state.coals).toEqual({});
  expect(h.state.homes[home.id]).toEqual(home);
  expect(h.decide(binding, 'allocation').kind).toBe('unchanged'); // An allocation recovery cannot downgrade earned growth.
  const replay = h.facts.reduce(applyRealmFact, createRealmState(kingdomId, 'live'));
  expect(replay).toEqual(h.state);
  for (const fact of h.facts) {
    const before = h.facts.slice(0, fact.seq - 1).reduce(applyRealmFact, createRealmState(kingdomId, 'live'));
    for (const message of projectRealmFact(applyRealmFact(before, fact), fact, before)) if (message.type === 'growth') {
      GrowthSceneFrameSchema.parse(message.frame);
      expect(JSON.stringify(message)).not.toMatch(/personId|evidenceReceipt|private:|allocationReceipt|stream:/);
    }
  }
});

it('ignores stream lease renewals and demonstrably older witnessed starts during recovery', () => {
  const h = harness();
  h.night(2);
  const witnessed = h.state.growth;
  expect(h.commit({ type: 'stream.observe', sessionId: 'stream:2', startedAt: 2 * dayMs, liveUntil: 2 * dayMs + 4_000_000 }, 'presence').public).toEqual([]);
  expect(h.state.growth).toBe(witnessed);
  expect(h.commit({ type: 'stream.observe', sessionId: 'delayed:1', startedAt: dayMs, liveUntil: 2 * dayMs + 4_000_000 }, 'presence').public).toEqual([]);
  expect(h.interval(dayMs, dayMs + 600_000).public).toEqual([]);
  expect(h.state.growth).toBe(witnessed);
  expect(h.facts.reduce(applyRealmFact, createRealmState(kingdomId, 'live'))).toEqual(h.state);
  h.night(3);
  h.interval(3 * dayMs, 3 * dayMs + 600_000);
  expect(h.state.growth?.citizens[personId]?.qualifiedDays).toBe(1);
});
