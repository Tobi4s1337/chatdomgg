import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PersonIdSchema, KingdomIdSchema, CitizenKeySchema } from './identity';
import { createFactSchema, createIntentSchema } from './events';
import { SurveyorStatusSchema, SurveyorRecentRaidsSchema, SurveyorRaidSchema } from './surveyor';
import { AtlasChannelSchema, AtlasEvidenceSchema, AtlasManifestSchema, assertSettlerIndex, assertSettlersAppendOnly, atlasFreshness, ATLAS_LIVE_STALE_AFTER_MS } from './atlas';
import { createAtlasAlignment, decodeLiveV2, decodeLiveStartsV1, decodeDabsV1, encodeDabsV1, sha256Hex } from './atlas-binary';
import { adaptSurveyorRaid, AtlasRaidSchema } from './atlas-raids';
import { createSimulatedAtlasFixture, FIXTURE_AS_OF } from './fixtures';

describe('identity and fact boundary', () => {
  it('keeps decimal identities distinct beyond JavaScript numeric precision', () => {
    const a = PersonIdSchema.parse('90000000000000001');
    const b = PersonIdSchema.parse('90000000000000002');
    expect(a).not.toBe(b);
    expect(Number(a)).toBe(Number(b));
    expect(PersonIdSchema.safeParse(Number(a)).success).toBe(false);
    expect(KingdomIdSchema.safeParse('streamer_login').success).toBe(false);
    expect(CitizenKeySchema.safeParse({ personId: a, kingdomId: '12', login: 'wrong_key' }).success).toBe(false);
  });

  const TestFact = createFactSchema('test.acknowledged', z.strictObject({ message: z.string().max(20) }));
  const fact = { version: 1, kingdomId: '123', seq: 2, occurredAt: 300, receivedAt: 200, committedAt: 250,
    origin: 'simulated', type: 'test.acknowledged', actor: null, body: { message: 'SIMULATED' }, cause: { kind: 'fact', seq: 1 } };

  it('requires origin, explicit clocks and a known strict body; upstream clock skew is valid', () => {
    expect(TestFact.parse(fact).occurredAt).toBe(300);
    expect(TestFact.safeParse({ ...fact, origin: undefined }).success).toBe(false);
    expect(TestFact.safeParse({ ...fact, origin: 'unknown' }).success).toBe(false);
    expect(TestFact.safeParse({ ...fact, committedAt: 199 }).success).toBe(false);
    expect(TestFact.safeParse({ ...fact, body: { message: 'ok', hidden: true } }).success).toBe(false);
    expect(TestFact.safeParse({ ...fact, at: 200 }).success).toBe(false);
  });

  it('rejects causal cycles and unsafe or fractional sequence numbers', () => {
    for (const seq of [0, 0.5, Number.MAX_SAFE_INTEGER + 1]) expect(TestFact.safeParse({ ...fact, seq }).success).toBe(false);
    expect(TestFact.safeParse({ ...fact, cause: { kind: 'fact', seq: 2 } }).success).toBe(false);
  });

  it('retains a caller idempotency key and rejects extra client authority', () => {
    const Intent = createIntentSchema('test.ask', z.strictObject({ value: z.number().int() }));
    expect(Intent.parse({ id: 'request-1', type: 'test.ask', args: { value: 1 } }).id).toBe('request-1');
    expect(Intent.safeParse({ id: 'request-1', type: 'test.ask', args: { value: 1 }, actor: '123' }).success).toBe(false);
  });
});

describe('observed Surveyor compatibility', () => {
  it('parses the aggregate status captured from the running collector', () => {
    const capture = JSON.parse(readFileSync(new URL('./surveyor-status.fixture.json', import.meta.url), 'utf8')) as { body: unknown; capturedAt: string };
    const status = SurveyorStatusSchema.parse(capture.body);
    expect(status.channels).toBeGreaterThan(0);
    expect(status.lastSweep).not.toBeNull();
    expect(Date.parse(capture.capturedAt)).toBeGreaterThanOrEqual(status.lastSweep?.at ?? 0);
  });

  it('keeps recent cumulative pairs distinct from individual raid events', () => {
    const pair = { from_login: 'simulated_from', to_login: 'simulated_to', n: 3, viewers: 75, last_at: 1000 };
    expect(SurveyorRecentRaidsSchema.parse([pair])[0]?.n).toBe(3);
    expect(SurveyorRaidSchema.safeParse(pair).success).toBe(false);
    expect(() => adaptSurveyorRaid(pair)).toThrow();
  });

  it('adapts receipt time honestly and does not invent an SSE replay cursor or event occurrence', () => {
    const raw = { from: { id: '11', login: null, name: null }, to: { id: '22', login: 'simulated_to', name: 'SIMULATED' }, viewers: 9, at: 1234 };
    const raid = adaptSurveyorRaid(raw);
    expect(raid).toMatchObject({ observedAt: 1234, occurredAt: null, delivery: 'ephemeral', evidence: { kind: 'observed', asOf: 1234 } });
    expect(adaptSurveyorRaid(raw).id).toBe(raid.id);
    expect(AtlasRaidSchema.safeParse({ ...raid, delivery: 'resumable' }).success).toBe(false);
    expect(AtlasRaidSchema.safeParse({ ...raid, occurredAt: 1200 }).success).toBe(false);
    expect(AtlasRaidSchema.safeParse({ ...raid, evidence: { kind: 'observed', asOf: 9999 } }).success).toBe(false);
  });
});

describe('Atlas land, evidence and privacy boundary', () => {
  it('rejects duplicate holdings, duplicate channel IDs and changed land in the same edition', async () => {
    const f = await createSimulatedAtlasFixture();
    expect(() => assertSettlerIndex(f.edition, f.settlers)).not.toThrow();
    expect(() => assertSettlerIndex(f.edition, f.settlers.map((s) => ({ ...s, holdingId: 'same' })))).toThrow();
    expect(() => assertSettlerIndex(f.edition, f.settlers.map((s) => ({ ...s, kingdomId: f.settlers[0]!.kingdomId })))).toThrow();
    expect(() => assertSettlersAppendOnly(f.settlers, f.settlers.slice(0, 2))).toThrow();
    expect(() => assertSettlersAppendOnly(f.settlers, f.settlers.map((s) => ({ ...s, point: { x: s.point.x + 1, y: s.point.y } })))).toThrow();
    expect(() => assertSettlersAppendOnly(f.settlers, f.settlers)).not.toThrow();
  });

  it('never lets a fresh transport response refresh old observations', () => {
    const evidence = { kind: 'observed' as const, asOf: FIXTURE_AS_OF };
    expect(atlasFreshness(evidence, FIXTURE_AS_OF + ATLAS_LIVE_STALE_AFTER_MS)).toBe('fresh');
    expect(atlasFreshness(evidence, FIXTURE_AS_OF + ATLAS_LIVE_STALE_AFTER_MS + 1)).toBe('stale');
    expect(atlasFreshness(evidence, FIXTURE_AS_OF - 1)).toBe('clock-skew');
    expect(atlasFreshness({ kind: 'replay', recordingId: 'night-1', asOf: FIXTURE_AS_OF }, FIXTURE_AS_OF)).toBe('replay');
    expect(AtlasEvidenceSchema.safeParse({ kind: 'simulated', asOf: FIXTURE_AS_OF }).success).toBe(false);
  });

  it('preserves unknown content classification and rejects person-level public data', () => {
    const channel = { kingdomId: '123', login: 'simulated', displayName: 'SIMULATED', language: 'en', founded: false,
      kingdomName: null, contentClassification: 'unknown' };
    expect(AtlasChannelSchema.parse(channel).contentClassification).toBe('unknown');
    for (const field of ['people', 'homes', 'passport', 'follows', 'currentPosition']) {
      expect(AtlasChannelSchema.safeParse({ ...channel, [field]: [] }).success).toBe(false);
    }
    // Parsing is not a publication filter: excluded metadata must remain explicit for the producer gate.
    expect(AtlasChannelSchema.parse({ ...channel, contentClassification: 'excluded' }).contentClassification).toBe('excluded');
  });
});

describe('live-v2 alignment and integrity', () => {
  it('round-trips the exact two-byte format including an observed offline spectacle', async () => {
    const f = await createSimulatedAtlasFixture();
    expect(Array.from(f.live)).toEqual([5, 0, 1, 4, 0, 6]);
    expect(await decodeLiveV2(f.live, f.manifest, f.alignment)).toEqual(f.live);
    expect((await decodeLiveStartsV1(f.startsBytes, f.manifest, f.alignment, f.live)).entries).toEqual(f.starts.entries);
  });

  it('rejects a different edition, world or equal-size reordered index', async () => {
    const f = await createSimulatedAtlasFixture();
    const swapped = [f.settlers[1]!, f.settlers[0]!, f.settlers[2]!].map((s, ordinal) => ({ ...s, ordinal }));
    const reordered = await createAtlasAlignment(f.edition, swapped);
    for (const alignment of [reordered, { ...f.alignment, editionId: 'another-edition' }, { ...f.alignment, worldHash: 'b'.repeat(64) }]) {
      await expect(decodeLiveV2(f.live, f.manifest, alignment)).rejects.toThrow('mismatch');
    }
  });

  it('rejects truncation, trailing bytes and checksum changes', async () => {
    const f = await createSimulatedAtlasFixture();
    for (const bytes of [f.live.subarray(0, 5), new Uint8Array([...f.live, 0])]) {
      await expect(decodeLiveV2(bytes, f.manifest, f.alignment)).rejects.toThrow('length');
    }
    const corrupt = f.live.slice(); corrupt[0] = 4;
    await expect(decodeLiveV2(corrupt, f.manifest, f.alignment)).rejects.toThrow('hash');
  });

  it('rejects illegal live and spectacle values even under a matching artifact checksum', async () => {
    const f = await createSimulatedAtlasFixture();
    for (const [offset, value] of [[0, 6], [1, 7]] as const) {
      const bytes = f.live.slice(); bytes[offset] = value;
      const manifest = { ...f.manifest, live: { ...f.manifest.live, sha256: await sha256Hex(bytes) } };
      await expect(decodeLiveV2(bytes, manifest, f.alignment)).rejects.toThrow('code');
    }
  });

  it('handles offset views and owns data across caller mutation', async () => {
    const f = await createSimulatedAtlasFixture();
    const enclosing = new Uint8Array(f.live.length + 10); enclosing.set(f.live, 3);
    const view = enclosing.subarray(3, 3 + f.live.length);
    const pending = decodeLiveV2(view, f.manifest, f.alignment);
    view.fill(255);
    expect(await pending).toEqual(f.live);
  });

  it('rejects unknown versions and excessive allocation claims before decoding', async () => {
    const f = await createSimulatedAtlasFixture();
    expect(AtlasManifestSchema.safeParse({ ...f.manifest, version: 2 }).success).toBe(false);
    expect(AtlasManifestSchema.safeParse({ ...f.manifest, live: { ...f.manifest.live, format: 'live-v1' } }).success).toBe(false);
    expect(AtlasManifestSchema.safeParse({ ...f.manifest, alignment: { ...f.alignment, settlerCount: 1_000_001 } }).success).toBe(false);
  });

  it('refuses a partial sweep instead of interpreting absent observations as offline', async () => {
    const f = await createSimulatedAtlasFixture();
    const partial = { ...f.manifest, coverage: 'partial' as const };
    await expect(decodeLiveV2(f.live, partial, f.alignment)).rejects.toThrow('partial');
    await expect(decodeDabsV1(f.dabs, partial, f.alignment)).rejects.toThrow('partial');
  });

  it('rejects a sidecar from another observation and missing or offline start entries', async () => {
    const f = await createSimulatedAtlasFixture();
    for (const starts of [
      { ...f.starts, asOf: FIXTURE_AS_OF + 1 },
      { ...f.starts, entries: f.starts.entries.slice(0, 1) },
      { ...f.starts, entries: [...f.starts.entries, { ordinal: 2, startedAt: null }] },
    ]) {
      const bytes = new TextEncoder().encode(JSON.stringify(starts));
      const manifest = { ...f.manifest, starts: { ...f.manifest.starts, sha256: await sha256Hex(bytes), byteLength: bytes.length } };
      await expect(decodeLiveStartsV1(bytes, manifest, f.alignment, f.live)).rejects.toThrow();
    }
  });
});

describe('proposed dabs-v1 codec', () => {
  it('has an explicit endian layout without rounding a 64-bit hash', () => {
    expect(Array.from(encodeDabsV1([{ realmIndex: 2, channelHash: '0123456789abcdef', startedAt: 0x01020304050607 }]))).toEqual([
      2, 0, 0, 0, 1, 35, 69, 103, 137, 171, 205, 239, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
  });

  it('round-trips a nonzero-offset view', async () => {
    const f = await createSimulatedAtlasFixture();
    const enclosing = new Uint8Array(f.dabs.length + 4); enclosing.set(f.dabs, 2);
    expect(await decodeDabsV1(enclosing.subarray(2, -2), f.manifest, f.alignment)).toEqual(f.dabEntries);
  });

  it('rejects unknown realms and unsafe/future timestamps before numeric conversion', async () => {
    const f = await createSimulatedAtlasFixture();
    for (const kind of ['realm', 'time']) {
      const bytes = f.dabs.slice(); const view = new DataView(bytes.buffer);
      if (kind === 'realm') view.setUint32(0, f.edition.realmCount, true);
      else view.setBigUint64(12, 0xffffffffffffffffn, true);
      const manifest = { ...f.manifest, dabs: { ...f.manifest.dabs, sha256: await sha256Hex(bytes) } };
      await expect(decodeDabsV1(bytes, manifest, f.alignment)).rejects.toThrow();
    }
  });

  it('refuses collisions instead of resolving two channels to one hover card', async () => {
    const f = await createSimulatedAtlasFixture();
    expect(() => encodeDabsV1([...f.dabEntries, { ...f.dabEntries[0]!, realmIndex: 1 }])).toThrow('colliding');
    const bytes = new Uint8Array([...f.dabs, ...f.dabs]);
    const manifest = { ...f.manifest, dabs: { ...f.manifest.dabs, count: 2, byteLength: bytes.length, sha256: await sha256Hex(bytes) } };
    await expect(decodeDabsV1(bytes, manifest, f.alignment)).rejects.toThrow('colliding');
  });
});
