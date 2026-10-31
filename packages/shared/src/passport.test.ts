import { expect, it } from 'vitest';
import { PassportBookSchema } from './passport';

it('keeps witnessed raid identity and provenance while withholding every travel field when hidden', () => {
  const kingdom = { kingdomId: '456', name: 'Copperleaf', crest: { key: 'crest:456:1', shape: 'heater', charge: 'oak', colours: ['#7a432b', '#d4ab61'], assetHash: null } };
  const stamp = { id: 'arrival:1', kind: 'raid', at: 1000, kingdom, gifts: [{ id: 'gift:1', name: 'A copper acorn', direction: 'left', keepsakeId: null }], raidId: 'raid:1', road: { id: 'road:123:456', from: '123', to: '456' }, leader: { personId: '123', name: 'The Willow King' } };
  const book = { version: 1, origin: 'simulated', visibility: 'visible', holder: { personId: '789', name: 'Juniper' }, revision: 'passport:1', asOf: 2000,
    stamps: { items: [stamp], nextCursor: null }, kingdoms: { items: [{ kingdom, firstAt: 1000, lastAt: 1000 }], nextCursor: null },
    bonds: { items: [], nextCursor: null }, keepsakes: { items: [], nextCursor: null } };
  expect(PassportBookSchema.parse(book)).toMatchObject({ stamps: book.stamps });
  for (const changed of [
    { ...book, stamps: { items: [stamp, stamp], nextCursor: null } },
    { ...book, stamps: { items: [{ ...stamp, road: { ...stamp.road, to: '999' } }], nextCursor: null } },
    { ...book, stamps: { items: [{ ...stamp, at: 3000 }], nextCursor: null } },
    { ...book, privatePresence: ['789'] },
    { ...book, visibility: 'hidden' },
  ]) expect(PassportBookSchema.safeParse(changed).success).toBe(false);
  expect(PassportBookSchema.parse({ version: 1, origin: 'live', visibility: 'hidden' })).toEqual({ version: 1, origin: 'live', visibility: 'hidden' });
  expect(PassportBookSchema.safeParse({ version: 1, origin: 'live', visibility: 'hidden', stampCount: 12 }).success).toBe(false);
});
