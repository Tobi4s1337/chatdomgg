import { expect, it } from 'vitest';
import { RealmSupportObservationSchema } from './moments';
import { TwitchMomentFactSchema } from '../twitch-moments';

const support = {
  version: 1, id: 'eventsub:gift:1', kingdomId: '129634568', origin: 'live', occurredAt: 1000, receivedAt: 1100,
  notice: { kind: 'aggregate', groupKey: 'gift:1', gifter: { personId: null, name: null }, tier: '1', total: 5 },
};
const fact = {
  version: 1, kingdomId: '129634568', seq: 1, occurredAt: 1000, receivedAt: 1100, committedAt: 1200,
  origin: 'live', actor: null, type: 'twitch.moment', cause: { kind: 'external', source: 'twitch.eventsub', id: 'eventsub:gift:1' },
  body: { kind: 'gifts', key: 'gift:1', displayUntil: 301000, groupKey: 'gift:1', giver: null, tier: '1', total: 5, recipients: [], forwardedFrom: null },
};

it('freezes stripped private support evidence separately from its public committed fact', () => {
  expect(RealmSupportObservationSchema.parse(support)).toEqual(support);
  expect(TwitchMomentFactSchema.parse(fact)).toEqual(fact);
  expect(RealmSupportObservationSchema.safeParse({ ...support, message: 'raw chat' }).success).toBe(false);
  expect(RealmSupportObservationSchema.safeParse({ ...support, notice: { ...support.notice, gifter: { personId: null, name: 'Hidden' } } }).success).toBe(false);
  expect(RealmSupportObservationSchema.safeParse({ ...support, notice: { ...support.notice, coal: 3 } }).success).toBe(false);
  expect(TwitchMomentFactSchema.safeParse({ ...fact, personId: '123' }).success).toBe(false);
  expect(TwitchMomentFactSchema.safeParse({ ...fact, actor: '123' }).success).toBe(false);
});
