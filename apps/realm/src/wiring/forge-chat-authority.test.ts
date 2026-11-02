import { expect, it, vi } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import type { DurableKingdom, DurableRealmServices } from '../persistence';
import { forgeMessageKey } from './forge';
import { forgeChatAuthority } from './forge-chat-authority';

const otherKingdom = KingdomIdSchema.parse('987654321');
const messageId = 'simulated-message';

function fixture() {
  const made = { forgeKey: forgeMessageKey(kingdomId, messageId), ownerId: personId, attached: false,
    attachment: { id: 'historical-piece', kingdomId, committedAt: 1234, provenance: { source: 'simulated' } } };
  const kingdom = { current: true, origin: 'simulated', kingdomId, databaseNow: vi.fn(() => 1000),
    privateState: { stream: { sessionId: 'live-session', liveUntil: 1001 }, attachments: { piece: made }, forgeOutcomes: {} } };
  const release = vi.fn(async () => {});
  let loaded = false;
  const retain = vi.fn(async () => { loaded = true; return { kingdom: kingdom as unknown as DurableKingdom, release }; });
  const founded = vi.fn(() => loaded);
  const authority = forgeChatAuthority({ origin: 'simulated', services: { retain } as Pick<DurableRealmServices, 'retain'>, founded });
  return { authority, kingdom, made, retain, release, founded };
}

it('retains before checking the founded cache and checks live status against the kingdom clock', async () => {
  const f = fixture();
  expect(await f.authority.resolveTarget(kingdomId)).toEqual({ broadcasterId: kingdomId, availability: { status: 'ready' } });
  expect(f.retain).toHaveBeenCalledExactlyOnceWith(kingdomId);
  expect(f.founded).toHaveBeenCalledExactlyOnceWith(kingdomId);
  expect(f.retain.mock.invocationCallOrder[0]).toBeLessThan(f.founded.mock.invocationCallOrder[0]!);
  f.kingdom.databaseNow.mockReturnValue(1001);
  expect(await f.authority.resolveTarget(kingdomId)).toEqual({ broadcasterId: kingdomId, availability: {
    status: 'cold', reason: 'stream-offline', message: expect.stringContaining('stream is offline') } });
  f.kingdom.privateState.stream.sessionId = null as unknown as string;
  f.kingdom.databaseNow.mockReturnValue(1);
  expect(await f.authority.resolveTarget(kingdomId)).toMatchObject({ availability: { status: 'cold', reason: 'stream-offline' } });
  expect(f.release).toHaveBeenCalledTimes(3);
});

it('releases held kingdoms on rejected targets and exceptions', async () => {
  const f = fixture();
  f.kingdom.current = false;
  expect(await f.authority.resolveTarget(kingdomId)).toBeNull();
  f.kingdom.current = true; f.kingdom.origin = 'live';
  expect(await f.authority.resolveTarget(kingdomId)).toBeNull();
  f.kingdom.origin = 'simulated'; f.kingdom.kingdomId = otherKingdom;
  expect(await f.authority.resolveTarget(kingdomId)).toBeNull();
  f.kingdom.kingdomId = kingdomId; f.founded.mockReturnValue(false);
  expect(await f.authority.resolveTarget(kingdomId)).toBeNull();
  f.founded.mockImplementation(() => { throw new Error('founded unavailable'); });
  await expect(f.authority.resolveTarget(kingdomId)).rejects.toThrow('founded unavailable');
  expect(f.release).toHaveBeenCalledTimes(5);
});

it('recovers a historical committed attachment only for the exact owner, kingdom, message and origin', async () => {
  const f = fixture(), input = { kingdomId, personId, messageId };
  expect(await f.authority.recoverCommitted(input)).toEqual({ attachmentId: 'historical-piece', committedAt: 1234 });
  expect(await f.authority.recoverCommitted({ ...input, personId: 'another-person' })).toBeNull();
  expect(await f.authority.recoverCommitted({ ...input, messageId: 'another-message' })).toBeNull();
  f.made.attachment.kingdomId = otherKingdom;
  expect(await f.authority.recoverCommitted(input)).toBeNull();
  f.made.attachment.kingdomId = kingdomId; f.made.attachment.provenance.source = 'live';
  expect(await f.authority.recoverCommitted(input)).toBeNull();
  f.made.attachment.provenance.source = 'simulated'; f.kingdom.origin = 'live';
  expect(await f.authority.recoverCommitted(input)).toBeNull();
  f.kingdom.origin = 'simulated'; f.kingdom.kingdomId = otherKingdom;
  expect(await f.authority.recoverCommitted(input)).toBeNull();
  f.kingdom.kingdomId = kingdomId; f.kingdom.current = false;
  expect(await f.authority.recoverCommitted(input)).toBeNull();
  expect(f.release).toHaveBeenCalledTimes(8);
});

it('never turns a released outcome into delivery and releases on recovery errors', async () => {
  const f = fixture();
  f.kingdom.privateState.attachments = {} as typeof f.kingdom.privateState.attachments;
  f.kingdom.privateState.forgeOutcomes = { [forgeMessageKey(kingdomId, messageId)]: { status: 'released' } };
  const input = { kingdomId, personId, messageId };
  expect(await f.authority.recoverCommitted(input)).toBeNull();
  Object.defineProperty(f.kingdom.privateState, 'attachments', { get() { throw new Error('state unavailable'); } });
  await expect(f.authority.recoverCommitted(input)).rejects.toThrow('state unavailable');
  expect(f.release).toHaveBeenCalledTimes(2);
});
