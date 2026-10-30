import { expect, it } from 'vitest';
import { PersonIdSchema, type PresenceInput } from '@chatdom/shared';
import { VOXEL_FIXTURE, WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as alice } from '@chatdom/shared/world-fixtures';
import type { RealmIngressCheckpoint } from '@chatdom/shared/realm';
import { createRealmState, decideRealm } from '@chatdom/world/realm';
import { decodeIngressCheckpoint, presencePerson } from './codec';
import { IngressGate } from './gate';
import { presenceTransition } from './transition';

it('a source-loss barrier survives checkpoint recovery without erasing independent people or bridging unseen time', () => {
  const bob = PersonIdSchema.parse('4442');
  let state = createRealmState(kingdomId, 'simulated');
  const home = (personId: typeof alice, slot: number) => ({ id: `plot:${slot}`, ownerId: personId, slot, allocationReceipt: 'test:allocation',
    layoutRevision: 'test:layout', revision: 'home:1', digest: 'a'.repeat(64), family: 'hearth' as const, blueprint: VOXEL_FIXTURE,
    attribution: { makerName: 'SIMULATED', kingdomName: 'SIMULATED', approvalId: 'test:names' }, attachments: {} });
  state = { ...state, homes: { 'plot:0': home(alice, 0), 'plot:1': home(bob, 1) } };
  let checkpoint: RealmIngressCheckpoint | null = null;
  const common = (at: number, id: string) => ({ version: 1 as const, kingdomId, origin: 'simulated' as const, observedAt: at, id });
  const observe = (at: number, source: 'chat' | 'panel', personId = alice): PresenceInput => ({ ...common(at, `${source}:${at}`), kind: 'observe', source,
    coverage: 'activity', people: [{ personId, disclosure: 'named', displayName: source === 'chat' ? 'Juniper' : 'Rowan' }] });
  const send = (observation: PresenceInput, now = observation.observedAt) => {
    const result = presenceTransition({ service: observation.kind === 'observe' && observation.source === 'panel' ? 'panel' : 'herald', observation, writerEpoch: 'writer:1' })(state, checkpoint, now);
    for (const planned of result.commands) {
      const decision = decideRealm(state, planned.command, { now, writerEpoch: 'writer:1', commandId: planned.commandId,
        capability: planned.capability, current: true, anvilCapacity: 2 });
      if (decision.kind !== 'accepted') throw new Error('A proposed source command must commit');
      state = decision.state;
    }
    checkpoint = result.checkpoint;
    return result.presence;
  };
  send({ ...common(0, 'stream:0'), kind: 'stream', live: true, sessionId: 'night:1' });
  send(observe(1_000, 'chat')); send(observe(61_000, 'chat'));
  send(observe(61_000, 'panel', bob));
  expect(state.qualification[`${alice}:night:1`]?.coveredMs).toBe(60_000);
  const lost: PresenceInput = { ...common(62_000, 'loss:chat'), kind: 'source-lost', sources: ['chat'], reason: 'unavailable' };
  const frame = send(lost);
  expect(frame).toMatchObject({ connection: 'fresh', windows: [{ slot: 0, present: false, publicName: null }, { slot: 1, present: true, publicName: 'Rowan' }] });
  expect(decodeIngressCheckpoint(checkpoint!, kingdomId, 'simulated').presence.sourceLostThrough.chat).toBe(62_000);
  send({ ...observe(62_000, 'chat'), id: 'chat:equal' }, 62_000);
  send({ ...observe(61_500, 'chat'), id: 'chat:old' }, 62_000);
  send({ ...observe(62_500, 'chat'), id: 'chat:recovered', origin: 'recovered' }, 63_000);
  expect(state.qualification[`${alice}:night:1`]?.coveredMs).toBe(60_000);
  send(observe(63_000, 'chat')); send(observe(64_000, 'chat'));
  expect(state.qualification[`${alice}:night:1`]?.coveredMs).toBe(61_000);
  const revoke: PresenceInput = { ...common(65_000, 'loss:all'), kind: 'source-lost', sources: ['chat', 'chatters', 'stream'], reason: 'revoked' };
  expect(send(revoke)).toMatchObject({ connection: 'stale', streamLive: false });
  expect(state.stream).toEqual({ sessionId: 'night:1', startedAt: 0, liveUntil: 65_000 });
  const privatePresence = decodeIngressCheckpoint(checkpoint!, kingdomId, 'simulated').presence;
  expect(presencePerson(privatePresence, alice)).toBeUndefined();
  expect(presencePerson(privatePresence, bob)).toMatchObject({ publicName: 'Rowan', disclosureSource: 'panel' });
  const restored = send({ ...common(66_000, 'stream:66'), kind: 'stream', live: true, sessionId: 'night:1' });
  expect(restored).toMatchObject({ connection: 'fresh', windows: [{ present: false }, { present: true, publicName: 'Rowan' }] });
  const gate = new IngressGate({}, 'simulated');
  expect(gate.observe('herald', revoke).ok).toBe(true);
  expect(gate.observe('panel', revoke).ok).toBe(false);
  expect(gate.observe('walker', revoke).ok).toBe(false);
});
