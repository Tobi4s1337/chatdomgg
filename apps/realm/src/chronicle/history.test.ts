import { expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmFact } from '@chatdom/shared/realm';
import { canonicalJson, sha256Hex } from '../persistence/codec';
import { reconstructHistory } from './history';
const kingdomId = KingdomIdSchema.parse('999000001');
const fact = (seq: number, committedAt: number): RealmFact => ({ version: 1, kingdomId, writerEpoch: 'never-public-writer', seq,
  occurredAt: committedAt, receivedAt: committedAt, committedAt, origin: 'simulated', type: 'realm.transaction', actor: null,
  cause: { kind: 'scheduled', id: 'chronicle-test' }, body: { type: 'stream.observe', sessionId: `night-${seq}`, startedAt: committedAt, liveUntil: committedAt + 1000 } });
const row = (value: RealmFact) => { const text = canonicalJson(value); return { seq: String(value.seq), fact: text, digest: sha256Hex(text) }; };
it('reconstructs complete last-of-night snapshots in fact sequence order using the real reducer', () => {
  const rows = [row(fact(1, 1000)), row(fact(2, 2000)), row(fact(3, 86_401_000))];
  const history = reconstructHistory(kingdomId, 'simulated', 3, rows);
  expect(history.map(item => [item.frame.sequence, item.frame.asOf])).toEqual([[2, 2000], [3, 86_401_000]]);
  expect(history[0]?.frame).toMatchObject({ origin: 'simulated', beats: [] });
  expect(JSON.stringify(history.map(item => ({ frame: item.frame, caption: item.caption })))).not.toContain('never-public-writer');
  expect(reconstructHistory(kingdomId, 'simulated', 3, rows)).toEqual(history);
});
it('fails closed for missing, modified, cross-origin, or out-of-clock facts', () => {
  expect(() => reconstructHistory(kingdomId, 'simulated', 2, [row(fact(2, 2000))])).toThrow(/incomplete/);
  expect(() => reconstructHistory(kingdomId, 'simulated', 2, [row(fact(1, 1000))])).toThrow(/gap/);
  expect(() => reconstructHistory(kingdomId, 'simulated', 1, [{ ...row(fact(1, 1000)), digest: '0'.repeat(64) }])).toThrow(/incomplete/);
  expect(() => reconstructHistory(kingdomId, 'live', 1, [row(fact(1, 1000))])).toThrow();
  expect(() => reconstructHistory(kingdomId, 'simulated', 2, [row(fact(1, 2000)), row(fact(2, 1000))])).toThrow(/clock/);
});
it('keeps imported witnessed stream nights distinct when all facts commit today, without source reordering', () => {
  const at = 100 * 86_400_000;
  const imported = [1, 2, 3].map((day, index) => row({ ...fact(index + 1, at + index), body: { type: 'stream.observe', sessionId: `old-night-${day}`, startedAt: day * 86_400_000, liveUntil: at + 10000 } }));
  const history = reconstructHistory(kingdomId, 'simulated', 3, imported);
  expect(history.map(item => item.frame.sequence)).toEqual([1, 2, 3]);
  expect(history.map(item => item.nightAt)).toEqual([1, 2, 3].map(day => day * 86_400_000));
  expect(history.map(item => item.frame.asOf)).toEqual([at, at + 1, at + 2]);
});
it('keeps a midnight-crossing marathon on the date its stream started', () => {
  const startedAt = 86_400_000 - 1000;
  const start = fact(1, startedAt);
  const ended = { ...fact(2, 86_400_000 + 1000), body: { type: 'stream.observe' as const, sessionId: null, startedAt, liveUntil: 0 } };
  const history = reconstructHistory(kingdomId, 'simulated', 2, [row(start), row(ended)]);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ nightAt: startedAt, frame: { sequence: 2, asOf: 86_400_000 + 1000 } });
});
it('reconstructs private rights internally without publishing a date, caption or entry for them', () => {
  const hidden = { ...fact(1, 1000), body: { type: 'citizen.rights' as const, personId: PersonIdSchema.parse('990000999'),
    rights: { revision: 1, forge: false, build: false, blocked: true, safetyIdentifier: 'PRIVATE-moderation-marker' } } };
  expect(reconstructHistory(kingdomId, 'simulated', 1, [row(hidden)])).toEqual([]);
});
