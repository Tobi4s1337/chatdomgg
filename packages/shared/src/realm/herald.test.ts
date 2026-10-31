import { expect, it } from 'vitest';
import { RealmHeraldEnvelopeSchema } from './herald';

it('keeps service speech person-bound and private wishes separate from authority grants', () => {
  const chat = { version: 1, id: 'message:1', kingdomId: '123', personId: '456', origin: 'live',
    asOf: 1000, expiresAt: 9000, parts: [{ kind: 'text', text: 'Home, at last.' }] };
  expect(RealmHeraldEnvelopeSchema.safeParse({ version: 1, chat }).success).toBe(true);
  for (const extra of [{ slot: 3 }, { epoch: 'chosen' }, { grantCoal: true }]) {
    expect(RealmHeraldEnvelopeSchema.safeParse({ version: 1, chat: { ...chat, ...extra } }).success).toBe(false);
  }
  expect(RealmHeraldEnvelopeSchema.safeParse({ version: 1, chat: { ...chat, expiresAt: 11001 } }).success).toBe(false);
  const forge = { type: 'wish', origin: 'live', command: { kingdomId: '123', personId: '456',
    messageId: 'message:2', slot: 9, words: 'a sleeping dragon chimney', observedAt: 1000 } };
  expect(RealmHeraldEnvelopeSchema.safeParse({ version: 1, forge }).success).toBe(true);
  expect(RealmHeraldEnvelopeSchema.safeParse({ version: 1, forge: { ...forge,
    command: { ...forge.command, approved: true } } }).success).toBe(false);
  expect(RealmHeraldEnvelopeSchema.safeParse({ version: 1, forge: { type: 'clear', kingdomId: '123' } }).success).toBe(false);
});
