import { expect, it } from 'vitest';
import type { RealmPublicMessage } from '@chatdom/shared/realm';
import type { TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import { PublicProjection } from './projection';

const fact = (seq: number, body: Record<string, unknown>) => ({ version: 1, kingdomId: '129634568', seq, occurredAt: seq, receivedAt: seq, committedAt: seq,
  origin: 'simulated', type: 'twitch.moment', actor: null, body, cause: { kind: 'scheduled', id: `s${seq}` } }) as unknown as TwitchMomentFact;
const battle = (seq: number, train: string, phase: string) => fact(seq, { kind: 'battle', key: `battle.${train}`, battleKey: train, phase });
const hype = (seq: number, train: string, phase: string) => fact(seq, { kind: 'hype', key: `hype.${train}`, trainKey: train, phase });
const row = (id: number, moment: TwitchMomentFact, current: boolean) => ({ id, sequence: 1, eventId: `m:${id}`, plotId: null,
  message: { type: 'moment', fact: moment, current } as RealmPublicMessage });
const facts = (projection: PublicProjection) =>
  (projection.current().find(m => m.type === 'moments.current') as { facts: TwitchMomentFact[] } | undefined)?.facts.map(f => f.seq) ?? [];

it('lets a finished battle leave current state, and a new train replace the last in its slot', () => {
  const projection = new PublicProjection({ homes: [], cursor: 0, presence: null, sequence: 0 });
  projection.adopt([row(1, hype(1, 'a', 'progress'), true), row(2, battle(2, 'a', 'summoning'), true), row(3, battle(3, 'a', 'active'), true)]);
  expect(facts(projection)).toEqual([1, 3]);
  // Victory is published as no longer current: the restored view must not wake into a fight that is over.
  projection.adopt([row(4, battle(4, 'a', 'victory'), false), row(5, hype(5, 'a', 'end'), true)]);
  expect(facts(projection)).toEqual([5]);
  // The next train takes the hype slot; its battle takes the battle slot.
  projection.adopt([row(6, hype(6, 'b', 'begin'), true), row(7, battle(7, 'b', 'active'), true)]);
  expect(facts(projection)).toEqual([6, 7]);
  // A late, superseded report of an older train is published non-current and leaves the newer occupant alone.
  projection.adopt([row(8, hype(8, 'a', 'progress'), false)]);
  expect(facts(projection)).toEqual([6, 7]);
});

it('keeps other current moments, which are not slotted, untouched by non-current facts', () => {
  const projection = new PublicProjection({ homes: [], cursor: 0, presence: null, sequence: 0 });
  const home = fact(1, { kind: 'home-dress', key: 'home.4142' });
  projection.adopt([row(1, home, true), row(2, fact(2, { kind: 'home-dress', key: 'home.4142' }), false), row(3, fact(3, { kind: 'cheer', key: 'cheer.x' }), false)]);
  expect(facts(projection)).toEqual([1]);
});
