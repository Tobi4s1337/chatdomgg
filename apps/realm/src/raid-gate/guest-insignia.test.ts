import { describe, expect, it } from 'vitest';
import { Decoder, Encoder } from '@colyseus/schema';
import {
  PRESENCE_LEASE_MS, RAID_GUEST_VISUAL_LEASE_MS, RAID_GUEST_VISUAL_MAX_BYTES,
  RaidGuestVisualMarkSchema, encodeRaidGuestVisualMark, parseRaidGuestVisualMark,
} from '@chatdom/shared';
import { REALM_WALKER_FRAME_LIMIT, REALM_WALKER_FRAME_MAX_BYTES, RealmObservedWalkerSchema, RealmWalkerFrameSchema, WalkerSchema } from '@chatdom/shared/realm';
import { RaidGuestProjectionSchema } from '../../../api/src/raid-gate/guest-contracts';
import { deriveRaidGuestVisualMark } from './guest-insignia';

const at = 1_800_000_000_000;
const raidId = `raid.${'a'.repeat(64)}`;
const guest = RaidGuestProjectionSchema.parse({
  version: 1, origin: 'simulated', raidId, kingdomId: '129634568', personId: '811',
  entryId: '50000000-0000-4000-8000-000000000001',
  from: { kingdomId: '123', login: 'mashad4', name: 'MashaD4' },
  to: { kingdomId: '129634568', login: 'tobi4s_', name: 'Tobi4s_' },
  raidOccurredAt: at - 1_000, arrivedAt: at,
});
const mark = deriveRaidGuestVisualMark(guest, at, at)!;
const walker = { id: 'walker.public.1', name: 'Ash', look: 'neutral', homeSlot: 65535,
  x: 1, y: 2, z: 3, yaw: 0, distance: 0, speed: 0, placement: 0 };

describe('current admitted raid guest insignia', () => {
  it('projects only the real source channel and one existing 90-second authority lease', () => {
    expect(RAID_GUEST_VISUAL_LEASE_MS).toBe(PRESENCE_LEASE_MS);
    expect(mark).toEqual({ raidId, fromKingdomId: '123', fromName: 'MashaD4', expiresAt: at + 90_000 });
    expect(Object.keys(mark).sort()).toEqual(['expiresAt', 'fromKingdomId', 'fromName', 'raidId']);
    expect(encodeRaidGuestVisualMark(mark, at)).not.toMatch(/personId|sessionId|entryId|origin|arrivedAt|reward|position/);
  });

  it('never renews from response completion or a repeated projection', () => {
    expect(deriveRaidGuestVisualMark(guest, at, at + 60_000)).toEqual(mark);
    expect(deriveRaidGuestVisualMark(guest, at, at + 90_000)).toBeNull();
    expect(deriveRaidGuestVisualMark(guest, at + 15_000, at + 60_000)?.expiresAt).toBe(at + 105_000);
    expect(deriveRaidGuestVisualMark(guest, at - 1, at)).toBeNull();
    expect(deriveRaidGuestVisualMark(guest, at + 1, at)).toBeNull();
  });

  it('does not turn an invitation, chat attribution or malformed private projection into dress', () => {
    const invitation = { raidId, kingdomId: guest.kingdomId, from: guest.from, expiresAt: at + 600_000 };
    const attribution = { raidId, from: guest.from, to: guest.to, occurredAt: at - 1_000 };
    for (const raw of [invitation, attribution, { ...guest, arrivedAt: at + 600_000 }, { ...guest, personId: undefined }]) {
      expect(deriveRaidGuestVisualMark(raw as typeof guest, at, at)).toBeNull();
    }
  });

  it('uses one fail-closed reader for the schema string and public object and expires without another frame', () => {
    const wire = encodeRaidGuestVisualMark(mark, at);
    expect(parseRaidGuestVisualMark(wire, at + 89_999)).toEqual(mark);
    expect(parseRaidGuestVisualMark(mark, at + 89_999)).toEqual(mark);
    expect(parseRaidGuestVisualMark(wire, at + 90_000)).toBeNull();
    expect(encodeRaidGuestVisualMark(mark, at + 90_000)).toBe('');
    for (const raw of ['', null, undefined, '{', '[]', true, { ...mark, expiresAt: at + 90_001 }]) {
      expect(parseRaidGuestVisualMark(raw, at)).toBeNull();
    }
    for (const clock of [NaN, Infinity, -1, at + 0.5]) expect(parseRaidGuestVisualMark(mark, clock)).toBeNull();
  });

  it('refuses extra identity/authority/pose fields instead of silently stripping them', () => {
    for (const field of ['personId', 'sessionId', 'entryId', 'x', 'y', 'z', 'origin', 'kingdomId', 'homeSlot', 'reward', 'power', 'crest']) {
      const raw = { ...mark, [field]: 'not-public' };
      expect(RaidGuestVisualMarkSchema.safeParse(raw).success).toBe(false);
      expect(parseRaidGuestVisualMark(raw, at)).toBeNull();
      expect(parseRaidGuestVisualMark(JSON.stringify(raw), at)).toBeNull();
    }
  });

  it('bounds parsing in UTF-8 and admits complete, clean source names without truncation', () => {
    for (const name of ['\u4e00'.repeat(128), '🌙'.repeat(64), '"'.repeat(128)]) {
      const raw = { ...mark, fromKingdomId: '9'.repeat(32), fromName: name };
      const wire = encodeRaidGuestVisualMark(raw as typeof mark, at);
      expect(wire).not.toBe('');
      expect(new TextEncoder().encode(wire).byteLength).toBeLessThanOrEqual(RAID_GUEST_VISUAL_MAX_BYTES);
      expect(parseRaidGuestVisualMark(wire, at)?.fromName).toBe(name);
    }
    for (const fromName of ['', 'x'.repeat(129), 'Ash\n', 'Ash\u202e', '\ud800']) {
      expect(parseRaidGuestVisualMark({ ...mark, fromName }, at)).toBeNull();
    }
    expect(parseRaidGuestVisualMark(' '.repeat(RAID_GUEST_VISUAL_MAX_BYTES) + JSON.stringify(mark), at)).toBeNull();
    expect(parseRaidGuestVisualMark(`{"fromName":"${'\u4e00'.repeat(220)}"}`, at)).toBeNull();
    expect(parseRaidGuestVisualMark({ ...mark, raidId: 'raid.' + 'A'.repeat(64) }, at)).toBeNull();
    expect(parseRaidGuestVisualMark({ ...mark, fromKingdomId: '0' }, at)).toBeNull();
  });

  it('preserves old walkers and frames while carrying only a typed optional mark', () => {
    expect(new WalkerSchema().raidGuest).toBe('');
    expect(RealmObservedWalkerSchema.parse(walker)).not.toHaveProperty('raidGuest');
    expect(RealmObservedWalkerSchema.parse({ ...walker, raidGuest: null }).raidGuest).toBeNull();
    const frame = { version: 1, kingdomId: guest.kingdomId, origin: 'simulated', writerEpoch: 'writer.1',
      layoutRevision: 'layout.1', collisionRevision: 1, sampledAt: at, walkers: [{ ...walker, raidGuest: mark }] };
    expect(RealmWalkerFrameSchema.parse(frame).walkers[0]?.raidGuest).toEqual(mark);
    expect(RealmWalkerFrameSchema.safeParse({ ...frame, walkers: [{ ...walker, raidGuest: { ...mark, personId: '811' } }] }).success).toBe(false);
  });

  it('patches and clears the appended Colyseus field without changing the walker pose, look or home', () => {
    const source = new WalkerSchema({ ...walker, district: 'gate', grounded: true,
      vx: 0, vy: 0, vz: 0, collisionRevision: 1 });
    const target = new WalkerSchema(), encoder = new Encoder(source), decoder = new Decoder(target);
    decoder.decode(encoder.encodeAll());
    expect(target.raidGuest).toBe('');
    encoder.discardChanges();
    source.raidGuest = encodeRaidGuestVisualMark(mark, at);
    decoder.decode(encoder.encode());
    expect(parseRaidGuestVisualMark(target.raidGuest, at)).toEqual(mark);
    expect(target.toJSON()).toMatchObject({ name: 'Ash', look: 'neutral', homeSlot: 65535, x: 1, y: 2, z: 3 });
    encoder.discardChanges(); source.raidGuest = ''; decoder.decode(encoder.encode());
    expect(parseRaidGuestVisualMark(target.raidGuest, at)).toBeNull();
  });

  it('keeps a full room with ordinary bounded names within the existing public frame budget', () => {
    const frame = RealmWalkerFrameSchema.parse({ version: 1, kingdomId: guest.kingdomId, origin: 'simulated',
      writerEpoch: 'writer.1', layoutRevision: 'layout.1', collisionRevision: 1, sampledAt: at,
      walkers: Array.from({ length: REALM_WALKER_FRAME_LIMIT }, (_, index) => ({ ...walker, id: `walker.${index}`,
        name: 'A'.repeat(128), raidGuest: { ...mark, fromName: 'B'.repeat(128) } })),
    });
    expect(new TextEncoder().encode(JSON.stringify(frame)).byteLength).toBeLessThan(REALM_WALKER_FRAME_MAX_BYTES);
  });
});
