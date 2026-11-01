import { expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
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
