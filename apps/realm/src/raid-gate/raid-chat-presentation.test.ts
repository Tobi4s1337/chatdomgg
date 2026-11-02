import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PresenceInputSchema, RAID_CHAT_CUE_TTL_MS, RAID_CHAT_FRAME_MAX_BYTES, RaidChatFrameSchema, parseRaidChatFrame,
  type PresenceInput } from '@chatdom/shared';
import { RealmHeraldEnvelopeSchema, type RealmHeraldChat } from '@chatdom/shared/realm';
import type { RaidGuestChatResult } from './guests';
import { RaidChatPresentation, RAID_CHAT_JOIN_MS, RAID_CHAT_MAX_PENDING } from './raid-chat-presentation';

const base = 1_800_000_000_000, kingdom = KingdomIdSchema.parse('201');
const raid = { raidId: `raid.${'a'.repeat(64)}`, fromKingdomId: KingdomIdSchema.parse('101'), fromName: 'Alder' };
const input = (id = 'hello', personId = '991001', at = Date.now()): PresenceInput => PresenceInputSchema.parse({
  version: 1, id: `chat:${id}`, origin: 'simulated', kingdomId: kingdom, kind: 'observe', source: 'chat',
  coverage: 'activity', observedAt: at, people: [{ personId, disclosure: 'named', displayName: 'Visitor' }],
});
const speech = (id = 'hello', personId = '991001', asOf = Date.now()): RealmHeraldChat => {
  const envelope = RealmHeraldEnvelopeSchema.parse({ version: 1, chat: { version: 1, id, personId, kingdomId: kingdom,
    origin: 'simulated', asOf, expiresAt: asOf + RAID_CHAT_CUE_TTL_MS,
    parts: [{ kind: 'text', text: 'A warm welcome <b>is plain text</b>' }, { kind: 'emote', id: '25', alt: 'Kappa' }] } });
  if (!('chat' in envelope)) throw new Error('Fixture is not speech'); return envelope.chat;
};
const result = (observation: PresenceInput, status: 'accepted' | 'duplicate' = 'accepted'): RaidGuestChatResult => {
  if (observation.kind !== 'observe') throw new Error('Fixture is not observation');
  return { status, guest: null, stamp: { id: `raid-stamp.${'b'.repeat(64)}`, kind: 'raid', kingdomId: kingdom,
    occurredAt: observation.observedAt, raidId: raid.raidId, arrivedWith: null, reward: { eligible: true, reason: 'eligible', day: 20_833 } },
  presentation: { origin: 'simulated', kingdomId: kingdom, personId: observation.people[0]!.personId,
    messageId: observation.id, at: observation.providerAt ?? observation.observedAt,
    proofMessageId: observation.id, proofAt: observation.providerAt ?? observation.observedAt, raidOccurredAt: base, raid } };
};
const instances: RaidChatPresentation[] = [];
function presentation() { const value = new RaidChatPresentation({ origin: 'simulated' }); instances.push(value); return value; }
const accept = (value: RaidChatPresentation, chat = speech()) => value.accept({ version: 1, chat });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(base); });
afterEach(() => { for (const value of instances.splice(0)) value.close(); vi.useRealTimers(); });

describe('qualified caravan speech', () => {
  it('joins original authority evidence to exact speech without a destination home or invented identity', async () => {
    const value = presentation(), observed = input();
    value.observe(observed, result(observed));
    expect(await accept(value)).toBe('handled');
    const frame = value.read(kingdom);
    expect(frame.cues).toHaveLength(1);
    expect(frame.lights).toMatchObject([{ lightId: frame.cues[0]!.lightId, raid, asOf: base, expiresAt: base + 90_000 }]);
    expect(frame.cues[0]).toMatchObject({ raid, parts: speech().parts, asOf: base, expiresAt: base + 10_000 });
    expect(RaidChatFrameSchema.safeParse(frame).success).toBe(true);
    const wire = JSON.stringify(frame);
    for (const privateField of ['personId', 'sessionId', 'entryId', 'slot', '991001', 'Visitor', 'chat:hello']) expect(wire).not.toContain(privateField);
    expect(frame.cues[0]!.id).toMatch(/^raid-chat\.[a-f0-9]{64}$/u);
    // Public frames cannot mutate the retained short-lived body.
    frame.cues[0]!.parts.splice(0);
    expect(value.read(kingdom).cues[0]!.parts).toEqual(speech().parts);
  });

  it('joins speech arriving first for at most one second and never extends its original deadline', async () => {
    const value = presentation(), observed = input(), chat = speech();
    const waiting = accept(value, chat);
    await vi.advanceTimersByTimeAsync(800);
    value.observe(observed, result(observed));
    expect(await waiting).toBe('handled');
    expect(value.read(kingdom).cues[0]!.expiresAt).toBe(base + 10_000);
    await vi.advanceTimersByTimeAsync(9_200);
    expect(value.read(kingdom).cues).toEqual([]);
    expect(value.read(kingdom).lights).toHaveLength(1);
    expect(await accept(value, chat)).toBe('unhandled');
    const orphan = accept(value, speech('orphan'));
    await vi.advanceTimersByTimeAsync(RAID_CHAT_JOIN_MS);
    expect(await orphan).toBe('unhandled');
  });

  it('requires signed-in authority qualification and named disclosure, never just a link, count or presence', async () => {
    const value = presentation();
    for (const [id, reason] of [['outsider', 'not_tied'], ['unsigned', 'not_signed_in']] as const) {
      value.observe(input(id), { status: 'ignored', reason });
      expect(await accept(value, speech(id))).toBe('unhandled');
    }
    const anonymous = PresenceInputSchema.parse({ ...input('anonymous'), people: [{ personId: '991001', disclosure: 'anonymous' }] });
    value.observe(anonymous, result(anonymous));
    expect(await accept(value, speech('anonymous'))).toBe('unhandled');
    expect(value.read(kingdom).cues).toEqual([]);
    expect(value.read(kingdom).lights).toEqual([]);
  });

  it('lights a qualified command or text-free message immediately for the original presence lease', async () => {
    const value = presentation(), observed = input('command');
    value.observe(observed, result(observed));
    const frame = value.read(kingdom);
    expect(frame.cues).toEqual([]); expect(frame.lights).toHaveLength(1);
    expect(frame.lights[0]!.expiresAt).toBe(base + 90_000);
    await vi.advanceTimersByTimeAsync(89_999);
    expect(value.read(kingdom).lights).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(value.read(kingdom).lights).toEqual([]);
  });

  it('delayed evidence uses remaining original light time and cannot revive its expired bubble', async () => {
    const value = presentation(), observed = input(), chat = speech();
    vi.setSystemTime(base + 20_000);
    value.observe(observed, result(observed));
    expect(value.read(kingdom).lights).toMatchObject([{ asOf: base, expiresAt: base + 90_000 }]);
    expect(await accept(value, chat)).toBe('unhandled');
    expect(value.read(kingdom).cues).toEqual([]);
    vi.setSystemTime(base + 90_000);
    expect(value.read(kingdom).lights).toEqual([]);
    value.observe(observed, result(observed));
    expect(value.read(kingdom).lights).toEqual([]);
  });

  it('removes the latest proof light without falling back to old messages, keeping cleanup across late evidence', async () => {
    const value = presentation(), old = input('old'); value.observe(old, result(old));
    vi.setSystemTime(base + 1);
    const latest = input('latest'); value.observe(latest, result(latest));
    expect(value.read(kingdom).lights).toHaveLength(1);
    const remove = (messageIds: string[]) => value.accept({ version: 1, chatCleanup: {
      type: 'remove', origin: 'simulated', kingdomId: kingdom, messageIds,
    } });
    await remove(['old']);
    expect(value.read(kingdom).lights[0]!.asOf).toBe(base + 1);
    await remove(['latest']);
    expect(value.read(kingdom).lights).toEqual([]);
    vi.setSystemTime(base + 20_000);
    value.observe(latest, result(latest)); value.observe(old, result(old));
    expect(value.read(kingdom).lights).toEqual([]);
    const fresh = input('fresh'); value.observe(fresh, result(fresh));
    expect(value.read(kingdom).lights).toHaveLength(1);
  });

  it('retains the original provider time for qualification and matches only normalized speech time', async () => {
    const value = presentation();
    const observed = PresenceInputSchema.parse({ ...input(), providerAt: base + 5_000 });
    value.observe(observed, result(observed));
    expect(await accept(value, speech('hello', '991002'))).toBe('unhandled');
    vi.setSystemTime(base + 5_000);
    expect(await accept(value, speech('hello', '991001', base + 5_000))).toBe('unhandled');
    expect(await accept(value, speech('hello', '991001', base))).toBe('handled');
    const invalid = input('bad-provider'), invalidResult = result(invalid);
    if (invalidResult.status === 'ignored') throw new Error('Fixture');
    value.observe(invalid, { ...invalidResult, presentation: { ...invalidResult.presentation!, at: base + 5_001 } });
    expect(await accept(value, speech('bad-provider'))).toBe('unhandled');
  });

  it('rejects original proof at the ten-minute boundary while continued visits keep the earlier proof', async () => {
    const value = presentation();
    vi.setSystemTime(base + 600_000);
    const atEnd = input('at-end'); value.observe(atEnd, result(atEnd));
    expect(await accept(value, speech('at-end'))).toBe('unhandled');
    const continued = input('continued'), committed = result(continued);
    if (committed.status === 'ignored') throw new Error('Fixture');
    value.observe(continued, { ...committed, presentation: { ...committed.presentation!, proofMessageId: 'chat:original', proofAt: base + 599_999 } });
    expect(await accept(value, speech('continued'))).toBe('handled');
    expect(value.read(kingdom).cues).toHaveLength(1);
  });

  it('deduplicates deliveries and one author lights only one lantern; older speech cannot replace newer', async () => {
    const value = presentation(), original = input(), firstChat = speech();
    value.observe(original, result(original)); await accept(value, firstChat);
    const first = value.read(kingdom).cues[0]!;
    value.observe(original, result(original, 'duplicate'));
    expect(await accept(value, firstChat)).toBe('handled');
    vi.setSystemTime(base + 100);
    const newer = input('newer'); value.observe(newer, result(newer)); await accept(value, speech('newer'));
    const next = value.read(kingdom).cues[0]!;
    expect(next.lightId).toBe(first.lightId); expect(next.id).not.toBe(first.id);
    const delayed = input('delayed', '991001', base + 50); value.observe(delayed, result(delayed));
    await accept(value, speech('delayed', '991001', base + 50));
    expect(value.read(kingdom).cues).toEqual([next]);
    expect(value.read(kingdom).lights).toHaveLength(1);
  });

  it('does not replay committed duplicates, stale speech or the previous process opaque identity', async () => {
    const value = presentation(), observed = input(), chat = speech();
    value.observe(observed, result(observed)); await accept(value, chat);
    const old = value.read(kingdom).cues[0]!;
    value.close(); vi.setSystemTime(base + 1);
    const restarted = presentation(); restarted.observe(observed, result(observed));
    expect(await accept(restarted, chat)).toBe('unhandled');
    const duplicate = input('duplicate'); restarted.observe(duplicate, result(duplicate, 'duplicate'));
    expect(await accept(restarted, speech('duplicate'))).toBe('handled');
    expect(restarted.read(kingdom).cues).toEqual([]);
    expect(restarted.read(kingdom).lights).toEqual([]);
    const fresh = input('fresh'); restarted.observe(fresh, result(fresh)); await accept(restarted, speech('fresh'));
    expect(restarted.read(kingdom).cues[0]!.lightId).not.toBe(old.lightId);
  });

  it('fences deletion before chat and cleanup while evidence is pending, without asynchronous gaps', async () => {
    const value = presentation();
    void value.accept({ version: 1, chatCleanup: { type: 'remove', origin: 'simulated', kingdomId: kingdom, messageIds: ['hello'] } });
    const observed = input(); value.observe(observed, result(observed));
    expect(await accept(value)).toBe('handled'); expect(value.read(kingdom).cues).toEqual([]);
    const waiting = accept(value, speech('pending'));
    void value.accept({ version: 1, chatCleanup: { type: 'clear', origin: 'simulated', kingdomId: kingdom, personId: speech().personId } });
    expect(await waiting).toBe('handled');
    const pending = input('pending'); value.observe(pending, result(pending));
    expect(await accept(value, speech('pending'))).toBe('handled'); expect(value.read(kingdom).cues).toEqual([]);
    vi.setSystemTime(base + 1);
    const fresh = input('fresh'); value.observe(fresh, result(fresh)); await accept(value, speech('fresh'));
    expect(value.read(kingdom).cues).toHaveLength(1);
    value.clear(kingdom); expect(value.read(kingdom).cues).toEqual([]);
  });

  it('clears only the actual author or room, and isolates live from simulated evidence and cleanup', async () => {
    const value = presentation();
    for (const personId of ['991001', '991002']) {
      const observed = input(personId, personId); value.observe(observed, result(observed)); await accept(value, speech(personId, personId));
    }
    void value.accept({ version: 1, chatCleanup: { type: 'clear', origin: 'live', kingdomId: kingdom } });
    expect(value.read(kingdom).cues).toHaveLength(2);
    void value.accept({ version: 1, chatCleanup: { type: 'clear', origin: 'simulated', kingdomId: kingdom, personId: speech().personId } });
    expect(value.read(kingdom).cues).toHaveLength(1);
    value.observe(PresenceInputSchema.parse({ ...input('live'), origin: 'live' }), result(input('live')));
    expect(await value.accept({ version: 1, chat: { ...speech('live'), origin: 'live' } })).toBe('unhandled');
    value.observe(PresenceInputSchema.parse({ version: 1, id: 'lost', origin: 'simulated', kingdomId: kingdom,
      observedAt: base, kind: 'source-lost', sources: ['chat'], reason: 'unavailable' }), null);
    expect(value.read(kingdom).cues).toEqual([]);
  });

  it('bounds waiting text, active cues and overload cleanup without deleting a protective tombstone', async () => {
    const value = presentation(), waiting: Promise<string>[] = [];
    for (let n = 0; n < RAID_CHAT_MAX_PENDING; n++) waiting.push(accept(value, speech(`pending-${n}`)));
    expect(await accept(value, speech('overflow'))).toBe('unhandled');
    await vi.advanceTimersByTimeAsync(RAID_CHAT_JOIN_MS); expect(await Promise.all(waiting)).toHaveLength(RAID_CHAT_MAX_PENDING);
    for (let n = 0; n < 40; n++) {
      const observed = input(`person-${n}`, String(991100 + n)); value.observe(observed, result(observed));
      await accept(value, speech(`person-${n}`, String(991100 + n)));
    }
    expect(value.read(kingdom).cues).toHaveLength(32);
    expect(value.read(kingdom).lights).toHaveLength(32);
    for (let n = 0; n < 1_100; n++) {
      const observed = input(`volume-${n}`, String(992000 + n)); value.observe(observed, result(observed));
    }
    expect(value.read(kingdom).lights).toHaveLength(32);
    for (let batch = 0; batch < 5; batch++) void value.accept({ version: 1, chatCleanup: { type: 'remove', origin: 'simulated', kingdomId: kingdom,
      messageIds: Array.from({ length: 1_000 }, (_, n) => `removed-${batch}-${n}`) } });
    const observed = input('overloaded'); value.observe(observed, result(observed));
    expect(await accept(value, speech('overloaded'))).toBe('handled'); expect(value.read(kingdom).cues).toEqual([]);
  });

  it('validates wire scope and bounded parts, expires without frames, and refuses private fields', async () => {
    const value = presentation(), observed = input(); value.observe(observed, result(observed)); await accept(value);
    const frame = value.read(kingdom), cue = frame.cues[0]!;
    expect(parseRaidChatFrame(frame, base + 10_000)?.cues).toEqual([]);
    expect(parseRaidChatFrame(frame, base + 10_000)?.lights).toHaveLength(1);
    expect(parseRaidChatFrame(frame, base + 90_000)?.lights).toEqual([]);
    expect(parseRaidChatFrame({ ...frame, lights: [] }, base)).toBeNull();
    expect(parseRaidChatFrame({ ...frame, cues: [{ ...cue, slot: 0 }] }, base)).toBeNull();
    expect(parseRaidChatFrame({ ...frame, origin: 'live' }, base)).toBeNull();
    expect(parseRaidChatFrame({ ...frame, cues: [cue, cue] }, base)).toBeNull();
    expect(parseRaidChatFrame({ ...frame, cues: [{ ...cue, expiresAt: base + 10_001 }] }, base)).toBeNull();
    expect(parseRaidChatFrame({ ...frame, cues: [{ ...cue, parts: [{ kind: 'text', text: 'x'.repeat(241) }] }] }, base)).toBeNull();
    expect(parseRaidChatFrame(' '.repeat(96 * 1024 + 1), base)).toBeNull();
  });

  it('keeps maximum UTF-8 names and emote parts inside the public byte budget', async () => {
    const value = presentation();
    for (let n = 0; n < 32; n++) {
      const personId = String(991100 + n), observed = input(`unicode-${n}`, personId), qualified = result(observed);
      if (qualified.status === 'ignored') throw new Error('Fixture');
      value.observe(observed, { ...qualified, presentation: { ...qualified.presentation!, raid: { ...raid, fromName: '漢'.repeat(128) } } });
      await accept(value, { ...speech(`unicode-${n}`, personId), parts: Array.from({ length: 16 }, () => ({ kind: 'emote' as const,
        id: 'a'.repeat(128), alt: '語'.repeat(30) })) });
    }
    const frame = value.read(kingdom);
    expect(frame.lights).toHaveLength(32); expect(frame.cues.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThanOrEqual(RAID_CHAT_FRAME_MAX_BYTES);
    expect(parseRaidChatFrame(frame, base)).not.toBeNull();
  });
});
