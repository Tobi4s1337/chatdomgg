import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, PresenceInputSchema } from '@chatdom/shared';
import { RealmEveningBridge } from '../evening/bridge';
import { IngressGate } from '../ingress';
import { FileForgeApprovals, ForgeWriteGate } from '../wiring';
import type { DurableRealmServices } from '../persistence';
import { RaidChatBridge } from './raid-chat-bridge';
import { RaidChatPresentation } from './raid-chat-presentation';

const now = 1_800_000_000_000, kingdomId = KingdomIdSchema.parse('201');
const herald = `Bearer ${'h'.repeat(32)}`, panel = `Bearer ${'p'.repeat(32)}`;
const chat = (id = 'hello') => ({ version: 1, id, personId: '991001', kingdomId, origin: 'simulated', asOf: now,
  expiresAt: now + 10_000, parts: [{ kind: 'text', text: 'SIMULATED welcome' }] });
const envelope = (id = 'hello') => ({ version: 1, chat: chat(id) });
const cleanup = (id = 'hello') => ({ version: 1, chatCleanup: { type: 'remove', origin: 'simulated', kingdomId, messageIds: [id] } });
function fixture() {
  const raidChat = new RaidChatPresentation({ origin: 'simulated' });
  const bridge = new RaidChatBridge({ origin: 'simulated', ingress: { gate: new IngressGate({ herald: 'h'.repeat(32), panel: 'p'.repeat(32) }, 'simulated'),
    accept: vi.fn() }, gate: new ForgeWriteGate(), approvals: new FileForgeApprovals('/tmp/raid-chat-unused'), raidChat, current: () => true });
  bridge.use({ kingdoms: new Map() } as unknown as DurableRealmServices);
  return { raidChat, bridge };
}
function qualify(raidChat: RaidChatPresentation, id = 'hello') {
  const input = PresenceInputSchema.parse({ version: 1, id: `chat:${id}`, origin: 'simulated', kingdomId, kind: 'observe', source: 'chat',
    coverage: 'activity', observedAt: now, people: [{ personId: '991001', disclosure: 'named', displayName: 'Visitor' }] });
  raidChat.observe(input, { status: 'accepted', guest: null, stamp: { id: `raid-stamp.${'b'.repeat(64)}`, kind: 'raid', kingdomId,
    occurredAt: now, raidId: `raid.${'a'.repeat(64)}`, arrivedWith: null, reward: { eligible: true, reason: 'eligible', day: 20833 } },
    presentation: { origin: 'simulated', kingdomId, personId: PersonIdSchema.parse('991001'), messageId: input.id, at: now,
      proofMessageId: input.id, proofAt: now, raidOccurredAt: now, raid: { raidId: `raid.${'a'.repeat(64)}`,
        fromKingdomId: KingdomIdSchema.parse('101'), fromName: 'Alder' } } });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('admits only strict same-origin Herald messages before touching visitor speech', async () => {
  const { bridge, raidChat } = fixture(); qualify(raidChat);
  expect((await bridge.accept(panel, envelope())).http).toBe(401);
  expect((await bridge.accept('Bearer wrong', envelope())).http).toBe(401);
  expect((await bridge.accept(herald, { ...envelope(), extra: true })).http).toBe(400);
  expect((await bridge.accept(herald, { version: 1, chat: { ...chat(), origin: 'live' } })).http).toBe(403);
  expect(raidChat.read(kingdomId).cues).toEqual([]);
  await bridge.stop();
});

it('publishes the exact qualified message for at most ten seconds, without invoking the home speech path', async () => {
  const { bridge, raidChat } = fixture(); qualify(raidChat);
  const parent = vi.spyOn(RealmEveningBridge.prototype, 'accept');
  expect(await bridge.accept(herald, envelope())).toMatchObject({ http: 202, body: { status: 'relayed' } });
  expect(parent).not.toHaveBeenCalled();
  expect(raidChat.read(kingdomId).cues).toMatchObject([{ parts: chat().parts, asOf: now, expiresAt: now + 10_000 }]);
  await vi.advanceTimersByTimeAsync(10_000); expect(raidChat.read(kingdomId).cues).toEqual([]);
  await bridge.stop();
});

it('delegates unqualified speech and Forge to the original path without emitting a visitor cue', async () => {
  const { bridge, raidChat } = fixture(); const parent = vi.spyOn(RealmEveningBridge.prototype, 'accept');
  const pending = bridge.accept(herald, envelope('outsider')); await vi.advanceTimersByTimeAsync(6_000);
  expect(await pending).toMatchObject({ http: 202, body: { status: 'absent' } });
  const forge = { version: 1, forge: { type: 'clear', origin: 'simulated', kingdomId } };
  expect(await bridge.accept(herald, forge)).toMatchObject({ http: 202, body: { status: 'accepted' } });
  expect(parent).toHaveBeenCalledTimes(2); expect(raidChat.read(kingdomId).cues).toEqual([]);
  await bridge.stop();
});

it('applies authenticated removal to existing and pending speech', async () => {
  const { bridge, raidChat } = fixture(); qualify(raidChat); await bridge.accept(herald, envelope());
  expect(raidChat.read(kingdomId).cues).toHaveLength(1);
  await bridge.accept(herald, cleanup()); expect(raidChat.read(kingdomId).cues).toEqual([]);
  const pending = bridge.accept(herald, envelope('pending'));
  await bridge.accept(herald, cleanup('pending')); qualify(raidChat, 'pending');
  expect(await pending).toMatchObject({ http: 202 }); expect(raidChat.read(kingdomId).cues).toEqual([]);
  await bridge.stop();
});
