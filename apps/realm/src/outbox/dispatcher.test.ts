import { expect, it } from 'vitest';
import type { KingdomId } from '@chatdom/shared';
import type { RealmPublicDelivery, RealmPublicMessage } from '@chatdom/shared/realm';
import type { RealmOutboxRow } from '../persistence/postgres-repository';
import { OutboxDispatcher } from './dispatcher';

const growth = (kingdomId: string) => ({ type: 'growth', frame: { version: 1, kingdomId, origin: 'simulated', sequence: 1, asOf: 1_793_537_963_863,
  homes: [], civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 }, beats: [] } }) as unknown as RealmPublicMessage;
const presence = { type: 'presence', frame: { version: 1, kingdomId: '129634568', origin: 'simulated', epoch: 'realm:129634568', sequence: 1,
  asOf: 1_793_537_963_863, connection: 'fresh', streamLive: true, windows: [] } } as unknown as RealmPublicMessage;
const row = (id: number, message: RealmPublicMessage): RealmOutboxRow => ({ id, sequence: id, eventId: `e${id}`, plotId: null, message });

function dispatcher(rows: RealmOutboxRow[]) {
  const logs: string[] = [], acknowledged: number[] = [];
  const outbox = new OutboxDispatcher({ kingdomId: '129634568' as KingdomId, writerEpoch: 'w1', delivered: 0,
    read: async after => rows.filter(item => item.id > after), acknowledge: async through => { acknowledged.push(through); },
    project: () => {}, current: () => true, fenced: () => {}, log: line => logs.push(line) });
  const delivered: RealmPublicDelivery[] = [];
  outbox.subscribe(delivery => delivered.push(delivery));
  return { outbox, logs, acknowledged, delivered };
}

it('delivers a fresh kingdom whose first committed row is its growth frame', async () => {
  const { outbox, logs, acknowledged, delivered } = dispatcher([row(1, growth('129634568')), row(2, presence)]);
  await outbox.kick();
  outbox.stop();
  expect(delivered.map(item => item.message.type)).toEqual(['growth', 'presence']);
  expect(acknowledged.at(-1)).toBe(2);
  expect(logs).toEqual([]);
});

it('still holds on a growth frame for another kingdom', async () => {
  const { outbox, logs, delivered } = dispatcher([row(1, growth('42'))]);
  await outbox.kick();
  outbox.stop();
  expect(delivered).toEqual([]);
  expect(logs[0]).toMatch(/row 1 is not a public message/);
});
