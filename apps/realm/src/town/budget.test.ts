import { expect, it } from 'vitest';
import { EpochMsSchema, KingdomIdSchema } from '@chatdom/shared';
import type { RealmPublicMessage } from '@chatdom/shared/realm';
import { GROVE_LIMIT, MOMENT_MESSAGE_BYTES, TwitchMomentFactSchema } from '@chatdom/shared/twitch-moments';
import { createTwitchMoments } from '../../../web/src/twitch-moments/controller';
import { PublicProjection } from '../outbox/projection';

it('carries every one of 4096 fully planted homes within the outbound budget and restores it through both consumers', () => {
  const kingdomId = KingdomIdSchema.parse('9'.repeat(32));
  const at = EpochMsSchema.parse(8_640_000_000_000_000);
  const fact = TwitchMomentFactSchema.parse({
    version: 1, kingdomId, seq: Number.MAX_SAFE_INTEGER, occurredAt: at, receivedAt: at, committedAt: at,
    origin: 'simulated', type: 'twitch.moment', actor: null,
    body: { kind: 'grove', key: 'grove', displayUntil: at,
      plantings: Array.from({ length: GROVE_LIMIT }, (_, i) => ({ slot: 65534 - i, sapling: at, tree: at })) },
    cause: { kind: 'external', source: 'twitch.eventsub', id: 'x'.repeat(128) },
  });
  const message: RealmPublicMessage = { type: 'moment', fact, current: true };
  expect(Buffer.byteLength(JSON.stringify(message), 'utf8')).toBeLessThanOrEqual(MOMENT_MESSAGE_BYTES);
  const decoded: RealmPublicMessage = { ...message, fact: TwitchMomentFactSchema.parse(JSON.parse(JSON.stringify(fact))) };
  const projection = new PublicProjection({ homes: [], cursor: 0, presence: null, sequence: 0 });
  projection.adopt([{ id: 1, sequence: 0, eventId: 'grove:1', plotId: null, message: decoded }]);
  const current = projection.current().find(value => value.type === 'moments.current');
  if (current?.type !== 'moments.current') throw new Error('Missing grove checkpoint');
  expect(Buffer.byteLength(JSON.stringify(current), 'utf8')).toBeLessThanOrEqual(MOMENT_MESSAGE_BYTES);
  const browser = createTwitchMoments({ kingdomId, expectedOrigin: 'simulated', clock: { now: () => at } });
  try {
    expect(browser.reset({ epoch: 'grove-test', throughSeq: fact.seq, asOf: at, current: current.facts })).toEqual({ accepted: true });
    const restored = browser.currentFacts()[0];
    if (restored?.body.kind !== 'grove') throw new Error('Missing restored grove');
    expect(restored.body.plantings).toHaveLength(GROVE_LIMIT);
    expect(restored.body.plantings.at(-1)).toEqual({ slot: 65535 - GROVE_LIMIT, sapling: at, tree: at });
    expect(browser.sample(at).captions).toEqual([]);
  } finally { browser.dispose(); }
});
