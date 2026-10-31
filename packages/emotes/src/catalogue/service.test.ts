import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAT, MATERIALS } from '../../../content/src/materials';
import { KingdomIdSchema, PersonIdSchema } from '../deps';
import { createEmoteImageDecoder } from '../decode/index';
import { toadWaveGifBytes, toadWaveSeasonalGifBytes } from '../fixtures/toad-wave-animated';
import { createEmoteHeraldry } from '../surfaces/heraldry';
import { createMemoryEmoteBlobStore, type EmoteBlobStore } from './blobs';
import { decodeCompiledEmote, encodeCompiledEmote } from './compiled-codec';
import { renderContactSheets } from './contact-sheet';
import { createMemoryEmoteRepository, emptyEmoteState, type EmoteRepository } from './repository';
import { createEmoteCatalogueService, diffEmotePlacements, type EmotePlacement, type EmoteReviewPort } from './service';
import { EMOTE_REFRESH_SCHEDULE, planEmoteRefresh } from './schedule';
import { ChannelGenesisFactsSchema } from '../../../world/src/genesis/contracts';
import { EmoteTransportError, type AuthorizedEmoteTransport } from './types';

const KINGDOM = KingdomIdSchema.parse('900000001');
const MONARCH = PersonIdSchema.parse('900000001');
const THRONE = { monarch: MONARCH };
const VIEWER = { monarch: null };
const TEMPLATE = 'https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}';
const PALETTE = [MAT.stone, MAT.limestone, MAT.darkStone, MAT.cream, MAT.cloth, MAT.grass, MAT.leaf, MAT.fabricGreen, MAT.goldLeaf, MAT.fabricRed, MAT.petal, MAT.hairBlack];
const GIF = toadWaveGifBytes();
const PNG = new Uint8Array(readFileSync(new URL('../decode/testdata/png/rgb8.png', import.meta.url)));
const TOAD = 'twitch.toadwave1';
const signal = () => new AbortController().signal;

const item = (id: string, name: string, animated: boolean) => ({
  id, name, images: {}, tier: '1000', emote_type: 'subscriptions', emote_set_id: '1',
  format: animated ? ['static', 'animated'] : ['static'], scale: ['1.0', '2.0', '3.0'], theme_mode: ['dark'],
});

/** A local channel: what Twitch lists and the bytes its CDN serves. Counts every call. */
function channel() {
  const world = {
    listing: [item('toadwave1', 'toadWave', true)] as unknown[] | null,
    assets: new Map<string, Uint8Array>([['toadwave1', GIF]]),
    calls: { helix: 0, thirdParty: 0, assets: 0 },
  };
  const transport: AuthorizedEmoteTransport = {
    async getHelix() {
      world.calls.helix++;
      if (!world.listing) throw new EmoteTransportError('timeout', 'Twitch did not answer.');
      return { data: world.listing, template: TEMPLATE };
    },
    async getProviderCatalogue() { world.calls.thirdParty++; throw new EmoteTransportError('not-found', 'none'); },
    async getAsset(_provider, url) {
      world.calls.assets++;
      const id = url.split('/')[5]!, bytes = world.assets.get(id);
      if (!bytes) throw new EmoteTransportError('not-found', 'gone');
      return bytes.slice();
    },
  };
  return { world, transport };
}

function harness(options: { repository?: EmoteRepository; paletteRevision?: () => number; verdict?: EmoteReviewPort['review']; wrap?: (transport: AuthorizedEmoteTransport) => AuthorizedEmoteTransport; channelId?: () => string; blobs?: EmoteBlobStore } = {}) {
  const { world, transport: plain } = channel();
  const transport = options.wrap?.(plain) ?? plain;
  const repository = options.repository ?? createMemoryEmoteRepository();
  const blobs = options.blobs ?? createMemoryEmoteBlobStore();
  const reviews: { sheets: number; frames: number; geometryHash: string }[] = [];
  const review: EmoteReviewPort = {
    review: options.verdict ?? (async ({ candidate, contactSheets }) => {
      reviews.push({ sheets: contactSheets.length, frames: candidate.frames.length, geometryHash: candidate.geometryHash });
      return { decision: 'approve', reviewedGeometryHash: candidate.geometryHash, receiptId: `luna.${candidate.geometryHash.slice(0, 12)}` };
    }),
    reviewFlat: async () => { throw new Error('not used'); },
  };
  const make = () => createEmoteCatalogueService({
    origin: 'simulated', repository, blobs, transport, decoder: createEmoteImageDecoder(), review, registry: MATERIALS,
    authority: { async requireMonarch(session) { const s = session as { monarch: unknown }; if (s?.monarch !== MONARCH) throw new Error('not the monarch'); return MONARCH; } },
    kingdom: { channelId: async () => options.channelId?.() ?? '141981764', palette: async () => ({ allowedMaterialIds: PALETTE, paletteRevision: options.paletteRevision?.() ?? 3 }) },
  });
  return { world, repository, blobs, reviews, service: make(), restart: make };
}

/** Refresh, select, carve and review the toad as a statue; returns its candidate revision. */
async function reviewedStatue(h: ReturnType<typeof harness>, purpose: 'statue' | 'heraldry' = 'statue', at = 1000): Promise<string> {
  expect((await h.service.refresh({ kingdomId: KINGDOM, reason: 'genesis', atMs: at }, signal())).status).toBe('applied');
  const source = (await h.service.privateCandidates(KINGDOM, THRONE));
  if (source.status !== 'ok') throw new Error(source.message);
  const hash = source.sources.find(s => s.id === TOAD)!.sourceHash!;
  expect(await h.service.selectCandidate({ kingdomId: KINGDOM, id: TOAD, purpose, revision: hash }, THRONE)).toMatchObject({ status: 'applied' });
  const prepared = await h.service.prepareCandidate({ kingdomId: KINGDOM, id: TOAD, purpose, atMs: at }, signal());
  if (prepared.status !== 'applied') throw new Error(prepared.message);
  expect(await h.service.reviewCandidate({ kingdomId: KINGDOM, id: TOAD, purpose, revision: prepared.candidate!, requestId: `req-${purpose}-${at}` }, signal())).toMatchObject({ status: 'applied' });
  return prepared.candidate!;
}

describe('the catalogue service raises an approved emote', () => {
  it('walks refresh → select → carve → Luna → monarch → live reveal, and serves only the published carving', async () => {
    const h = harness();
    const revision = await reviewedStatue(h);
    expect(h.reviews).toEqual([{ sheets: 1, frames: 8, geometryHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    // Approved by Luna but not confirmed: nothing public.
    expect((await h.service.publicCatalogue(KINGDOM)).resolveApprovedEmote(TOAD, 'statue')).toBeNull();
    expect(await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, VIEWER)).toMatchObject({ status: 'failed', code: 'forbidden' });
    expect(await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, THRONE)).toMatchObject({ status: 'applied' });
    // Confirmed off-stream: still waiting for the next live stream.
    expect((await h.service.publicCatalogue(KINGDOM)).resolveApprovedEmote(TOAD, 'statue')).toBeNull();
    expect(await h.service.pendingReveals(KINGDOM)).toEqual([]);

    expect(await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 'stream-1', atMs: 5000 })).toMatchObject({ status: 'applied' });
    const reveals = await h.service.pendingReveals(KINGDOM);
    expect(reveals).toEqual([{ id: expect.stringMatching(/^reveal\./), kingdomId: KINGDOM, emoteId: TOAD, revision, streamEpoch: 'stream-1', origin: 'simulated' }]);
    const view = await h.service.publicCatalogue(KINGDOM);
    const statue = view.resolveApprovedEmote(TOAD, 'statue');
    expect(statue).toMatchObject({ id: TOAD, revision, origin: 'simulated', purpose: 'statue', periodMs: 1170 });
    expect(statue!.frames).toHaveLength(8);
    expect(new Set(statue!.frames.map(f => f.blueprint.size.join('x'))).size).toBe(1);
    expect(view.resolveApprovedEmote(TOAD, 'heraldry')).toBeNull();
    expect(view.health).toBe('current');
    // Twitch's flat rendition needs no statue approval and comes back as verified bytes, not a URL.
    expect(view.resolveInlineEmote(TOAD)).toMatchObject({ id: TOAD, alt: 'toadWave', mediaType: 'image/gif', origin: 'simulated' });
    expect(view.resolveInlineEmote(TOAD)!.bytes).toEqual(GIF);
    expect(view.resolveInlineEmote('twitch.unknown')).toBeNull();
    expect(await h.service.genesisFacts(KINGDOM)).toEqual([{ emoteId: TOAD, broadcasterId: KINGDOM, asset: { assetHash: expect.stringMatching(/^[a-f0-9]{64}$/), approvalId: expect.stringMatching(/^luna\./) }, allowedUses: ['statue'] }]);
  }, 60_000);

  it('replays reveals after a restart, never unveils twice and acknowledges idempotently', async () => {
    const h = harness();
    const revision = await reviewedStatue(h);
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, THRONE);
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 'stream-1', atMs: 5000 });
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 'stream-1', atMs: 5001 });
    const restarted = h.restart();
    const [reveal] = await restarted.pendingReveals(KINGDOM);
    expect(await restarted.pendingReveals(KINGDOM)).toHaveLength(1);
    // A crash between publication and delivery: the reveal is still there for the host to deliver.
    await restarted.onStreamState({ kingdomId: KINGDOM, live: false, epoch: 'stream-1', atMs: 9000 });
    await restarted.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 'stream-2', atMs: 20_000 });
    expect(await restarted.pendingReveals(KINGDOM)).toEqual([reveal]);
    expect(await restarted.acknowledgeReveal({ kingdomId: KINGDOM, revealId: reveal!.id })).toMatchObject({ status: 'applied' });
    const again = await restarted.acknowledgeReveal({ kingdomId: KINGDOM, revealId: reveal!.id });
    expect(again).toMatchObject({ status: 'applied' });
    expect(await restarted.pendingReveals(KINGDOM)).toEqual([]);
    expect(await restarted.acknowledgeReveal({ kingdomId: KINGDOM, revealId: 'reveal.nope' })).toMatchObject({ status: 'failed', code: 'not-found' });
    expect((await restarted.publicCatalogue(KINGDOM)).resolveApprovedEmote(TOAD, 'statue')?.revision).toBe(revision);
  }, 60_000);

  it('publishes at once when confirmed during a live stream', async () => {
    const h = harness();
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 'stream-7', atMs: 500 });
    const revision = await reviewedStatue(h);
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, THRONE);
    expect((await h.service.pendingReveals(KINGDOM)).map(r => r.streamEpoch)).toEqual(['stream-7']);
  }, 60_000);
});

describe('two independent gates', () => {
  it('needs the monarch for selection, with the source hash they actually saw', async () => {
    const h = harness();
    await h.service.refresh({ kingdomId: KINGDOM, reason: 'genesis', atMs: 1 }, signal());
    const hash = (await h.service.privateCandidates(KINGDOM, THRONE) as { sources: { sourceHash: string | null }[] }).sources[0]!.sourceHash!;
    expect(await h.service.selectCandidate({ kingdomId: KINGDOM, id: TOAD, purpose: 'statue', revision: hash }, VIEWER)).toMatchObject({ code: 'forbidden' });
    expect(await h.service.selectCandidate({ kingdomId: KINGDOM, id: TOAD, purpose: 'statue', revision: 'f'.repeat(64) }, THRONE)).toMatchObject({ code: 'stale' });
    expect(await h.service.selectCandidate({ kingdomId: KINGDOM, id: 'twitch.missing', purpose: 'statue', revision: hash }, THRONE)).toMatchObject({ code: 'not-found' });
    expect(await h.service.privateCandidates(KINGDOM, VIEWER)).toMatchObject({ code: 'forbidden' });
    expect(await h.service.prepareCandidate({ kingdomId: KINGDOM, id: TOAD, purpose: 'statue', atMs: 2 }, signal())).toMatchObject({ code: 'not-found' });
  }, 60_000);

  it('rejects an approval for different geometry and keeps hold, cold and refuse private', async () => {
    for (const decision of ['hold', 'cold', 'refuse'] as const) {
      const h = harness({ verdict: async ({ candidate }) => ({ decision, reviewedGeometryHash: candidate.geometryHash, receiptId: `luna.${decision}` }) });
      const revision = await reviewedStatue(h);
      const plaque = await h.service.privateCandidates(KINGDOM, THRONE);
      expect(plaque.status === 'ok' && plaque.candidates[0]!.state).toBe(decision === 'refuse' ? 'refused' : decision === 'hold' ? 'held' : 'cold');
      expect(await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, THRONE)).toMatchObject({ code: 'stale' });
      await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 's1', atMs: 9 });
      expect((await h.service.publicCatalogue(KINGDOM)).resolveApprovedEmote(TOAD, 'statue')).toBeNull();
      expect(await h.service.pendingReveals(KINGDOM)).toEqual([]);
    }
    const wrong = harness({ verdict: async ({ candidate }) => ({ decision: 'approve', reviewedGeometryHash: '0'.repeat(64), receiptId: `luna.${candidate.revision.slice(-6)}` }) });
    await expect(reviewedStatue(wrong)).rejects.toThrow();
    const plaque = await wrong.service.privateCandidates(KINGDOM, THRONE);
    expect(plaque.status === 'ok' && plaque.candidates[0]!.state).toBe('pending-luna');
  }, 120_000);

  it('a statue approval never serves heraldry, and the heraldry factory checks purpose', async () => {
    const h = harness();
    const statue = await reviewedStatue(h, 'statue');
    const heraldry = await reviewedStatue(h, 'heraldry', 1001);
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision: statue }, THRONE);
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 's1', atMs: 2000 });
    let view = await h.service.publicCatalogue(KINGDOM);
    expect(view.resolveApprovedEmote(TOAD, 'heraldry')).toBeNull();
    expect(createEmoteHeraldry(view.resolveApprovedEmote(TOAD, 'statue')!, KINGDOM)).toBeNull();
    await h.service.confirmCandidate({ kingdomId: KINGDOM, id: TOAD, purpose: 'heraldry', revision: heraldry }, THRONE);
    view = await h.service.publicCatalogue(KINGDOM);
    const charge = createEmoteHeraldry(view.resolveApprovedEmote(TOAD, 'heraldry')!, KINGDOM)!;
    expect(charge.provenance).toEqual({ emoteId: TOAD, revision: heraldry, kingdomId: KINGDOM, origin: 'simulated' });
    expect(charge.blueprint.size[1]).toBeGreaterThanOrEqual(14);
    expect(charge.charge.materialIds.some(id => id !== 0)).toBe(true);
    // Heraldry is raised quietly with the statue; only the statue gets a reveal.
    expect((await h.service.pendingReveals(KINGDOM)).map(r => r.revision)).toEqual([statue]);
  }, 90_000);
});

describe('honest change and recovery', () => {
  async function published(h: ReturnType<typeof harness>) {
    const revision = await reviewedStatue(h);
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, THRONE);
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 's1', atMs: 2000 });
    expect((await h.service.publicCatalogue(KINGDOM)).resolveApprovedEmote(TOAD, 'statue')).not.toBeNull();
    return revision;
  }

  it('an outage keeps the known safe statue; an observed removal retires it quietly', async () => {
    const h = harness();
    await published(h);
    h.world.listing = null;
    expect(await h.service.refresh({ kingdomId: KINGDOM, reason: 'daily', atMs: 3000 }, signal())).toMatchObject({ status: 'applied' });
    let view = await h.service.publicCatalogue(KINGDOM);
    expect(view.health).toBe('stale');
    expect(view.resolveApprovedEmote(TOAD, 'statue')).not.toBeNull();
    h.world.listing = [];
    await h.service.refresh({ kingdomId: KINGDOM, reason: 'daily', atMs: 4000 }, signal());
    view = await h.service.publicCatalogue(KINGDOM);
    expect(view.resolveApprovedEmote(TOAD, 'statue')).toBeNull();
    expect(view.resolveInlineEmote(TOAD)).toBeNull();
    const plaque = await h.service.privateCandidates(KINGDOM, THRONE);
    expect(plaque.status === 'ok' && plaque.candidates.map(c => [c.state, c.retired])).toEqual([['retired', 'source-removed']]);
    // Its reveal was never acknowledged, and a carving that left the square is never unveiled late.
    expect(await h.service.pendingReveals(KINGDOM)).toEqual([]);
  }, 60_000);

  it('new source bytes, a new palette revision or a changed channel invalidate the approval', async () => {
    const h = harness();
    await published(h);
    h.world.assets.set('toadwave1', PNG);
    h.world.listing = [item('toadwave1', 'toadWave', false)];
    const changed = await h.service.refresh({ kingdomId: KINGDOM, reason: 'daily', atMs: 3000 }, signal());
    expect(changed).toMatchObject({ status: 'applied', changes: { changed: [TOAD] } });
    expect((await h.service.publicCatalogue(KINGDOM)).resolveApprovedEmote(TOAD, 'statue')).toBeNull();
    const plaque = await h.service.privateCandidates(KINGDOM, THRONE);
    expect(plaque.status === 'ok' && plaque.candidates[0]!.retired).toBe('source-changed');

    let paletteRevision = 3;
    const p = harness({ paletteRevision: () => paletteRevision });
    await published(p);
    paletteRevision = 4;
    expect((await p.service.publicCatalogue(KINGDOM)).resolveApprovedEmote(TOAD, 'statue')).toBeNull();
    expect(await p.service.genesisFacts(KINGDOM)).toEqual([]);
  }, 90_000);

  it('a disabled provider gets zero requests, and opting in or out is the monarch\'s alone', async () => {
    const h = harness();
    await h.service.refresh({ kingdomId: KINGDOM, reason: 'genesis', atMs: 1 }, signal());
    expect(h.world.calls.thirdParty).toBe(0);
    expect(await h.service.setProviderOptIn({ kingdomId: KINGDOM, provider: 'bttv', enabled: true }, VIEWER)).toMatchObject({ code: 'forbidden' });
    expect(await h.service.setProviderOptIn({ kingdomId: KINGDOM, provider: 'bttv', enabled: true }, THRONE)).toMatchObject({ status: 'applied' });
    await h.service.refresh({ kingdomId: KINGDOM, reason: 'daily', atMs: 2 }, signal());
    expect(h.world.calls.thirdParty).toBe(1);
  }, 30_000);

  it('re-evaluates on a CAS conflict and reports stale when the conflict never clears', async () => {
    const inner = createMemoryEmoteRepository();
    let conflicts = 1;
    const racing: EmoteRepository = {
      load: kingdomId => inner.load(kingdomId),
      async compareAndSwap(kingdomId, expected, next) {
        if (conflicts > 0) {
          conflicts--;
          // Someone else commits first: the store moves on under this writer.
          const current = await inner.load(kingdomId);
          const bumped = { ...(current ?? emptyEmoteState(kingdomId)), revision: expected + 1, refreshedAt: expected + 1 };
          await inner.compareAndSwap(kingdomId, expected, bumped);
          return false;
        }
        return inner.compareAndSwap(kingdomId, expected, next);
      },
    };
    const h = harness({ repository: racing });
    expect(await h.service.onStreamState({ kingdomId: KINGDOM, live: false, epoch: 's0', atMs: 1 })).toEqual({ status: 'applied', revision: 2 });
    conflicts = 99;
    expect(await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 's1', atMs: 2 })).toMatchObject({ status: 'failed', code: 'stale' });
    const down = harness({ repository: { load: async () => { throw new Error('db down'); }, compareAndSwap: async () => false } });
    expect(await down.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 's1', atMs: 2 })).toMatchObject({ code: 'unavailable' });
    expect((await down.service.publicCatalogue(KINGDOM)).health).toBe('unavailable');
  });
});

describe('stored geometry and review sheets', () => {
  it('round-trips compiled geometry, refuses tampering and draws every frame on PNG contact sheets', async () => {
    const h = harness();
    const revision = await reviewedStatue(h);
    const plaque = await h.service.privateCandidates(KINGDOM, THRONE);
    if (plaque.status !== 'ok') throw new Error('plaque');
    const state = await h.repository.load(KINGDOM);
    const record = state!.candidates.find(c => c.revision === revision)!;
    const bytes = (await h.blobs.get(record.blobHash))!;
    const compiled = decodeCompiledEmote(bytes)!;
    expect(compiled.revision).toBe(revision);
    expect(encodeCompiledEmote(compiled)).toEqual(bytes);
    const tampered = JSON.parse(new TextDecoder().decode(bytes));
    // A frame that no longer shares the common grid would make the statue jump: refused.
    tampered.frames[1].blueprint.size[0] += 1;
    expect(decodeCompiledEmote(new TextEncoder().encode(JSON.stringify(tampered)))).toBeNull();
    const sheets = renderContactSheets(compiled, MATERIALS);
    expect(sheets).toHaveLength(1);
    // A real PNG: signature, IHDR size within bounds, and an IDAT that inflates to every filtered row.
    const sheet = sheets[0]!, view = new DataView(sheet.buffer, sheet.byteOffset);
    expect([...sheet.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const width = view.getUint32(16), height = view.getUint32(20);
    expect(width).toBeLessThanOrEqual(2048);
    const [w, , d] = compiled.frames[0]!.blueprint.size;
    // Eight tiles, each the front, the side and the 1.75 m marker.
    expect(Math.floor(width / ((w + d + 10) * Math.floor(width / 8 / (w + d + 10))))).toBeGreaterThanOrEqual(1);
    const idat = sheet.subarray(41, 41 + view.getUint32(33));
    expect(inflateSync(idat).length).toBe((width * 3 + 1) * height);
  }, 60_000);
});

/** The channel re-uploaded seasonal art under the same emote ID: new bytes, same frames. */
const recolouredGif = (): Uint8Array => toadWaveSeasonalGifBytes();

describe('reconciling source changes over the days', () => {
  const DAY = EMOTE_REFRESH_SCHEDULE.dailyMs, RETRY = EMOTE_REFRESH_SCHEDULE.retryMs;

  it('reads at Genesis, once per go-live and daily; retries an outage with backoff; withdraws changed and removed carvings', async () => {
    const h = harness();
    const t0 = 1_000;
    // Genesis: the host's first tick reads the channel.
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: t0 }, signal())).toMatchObject({ status: 'applied', reason: 'genesis', changes: { added: [TOAD] }, nextAt: t0 + DAY });
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: t0 + 5 }, signal())).toMatchObject({ reason: null, nextAt: t0 + DAY });
    expect(h.world.calls.helix).toBe(1);
    const plaque = await h.service.privateCandidates(KINGDOM, THRONE);
    const hash = plaque.status === 'ok' ? plaque.sources[0]!.sourceHash! : '';
    await h.service.selectCandidate({ kingdomId: KINGDOM, id: TOAD, purpose: 'statue', revision: hash }, THRONE);
    const carved = await h.service.prepareCandidate({ kingdomId: KINGDOM, id: TOAD, purpose: 'statue', atMs: t0 + 10 }, signal());
    const revision = carved.status === 'applied' ? carved.candidate! : '';
    await h.service.reviewCandidate({ kingdomId: KINGDOM, id: TOAD, purpose: 'statue', revision, requestId: 'day-1' }, signal());
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, THRONE);

    // Go-live: the stream state publishes, and the next tick reads the channel once for this epoch.
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 'night-1', atMs: t0 + 100 });
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: t0 + 101 }, signal())).toMatchObject({ reason: 'go-live', nextAt: t0 + 101 + DAY });
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: t0 + 200 }, signal())).toMatchObject({ reason: null });
    expect(h.world.calls.helix).toBe(2);
    let placed: readonly EmotePlacement[] = [];
    let diff = diffEmotePlacements(placed, await h.service.publicPlacements(KINGDOM));
    expect(diff).toEqual({ raise: [{ id: TOAD, purpose: 'statue', revision, origin: 'simulated' }], replace: [], withdraw: [] });
    placed = await h.service.publicPlacements(KINGDOM);
    const [reveal] = await h.service.pendingReveals(KINGDOM);
    expect(reveal).toMatchObject({ emoteId: TOAD, revision, streamEpoch: 'night-1' });

    // The daily read meets an outage: the statue stays, and the read is retried soon, doubling.
    h.world.listing = null;
    const day1 = t0 + 101 + DAY;
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: day1 - 1 }, signal())).toMatchObject({ reason: null });
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: day1 }, signal())).toMatchObject({ status: 'applied', reason: 'daily', nextAt: day1 + RETRY });
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: day1 + RETRY - 1 }, signal())).toMatchObject({ reason: null });
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: day1 + RETRY }, signal())).toMatchObject({ reason: 'daily', nextAt: day1 + RETRY * 3 });
    expect(h.world.calls.helix).toBe(4);
    expect(await h.service.publicPlacements(KINGDOM)).toEqual(placed);
    expect((await h.service.publicCatalogue(KINGDOM)).health).toBe('stale');

    // Twitch answers again with new art under the same ID: the carving is withdrawn quietly, its
    // unacknowledged reveal is dropped, and chat's flat emote already shows the new bytes.
    h.world.listing = [item('toadwave1', 'toadWave', true)];
    h.world.assets.set('toadwave1', recolouredGif());
    const changed = await h.service.tick({ kingdomId: KINGDOM, atMs: day1 + RETRY * 3 }, signal());
    expect(changed).toMatchObject({ status: 'applied', reason: 'daily', changes: { changed: [TOAD], removed: [] }, nextAt: day1 + RETRY * 3 + DAY });
    diff = diffEmotePlacements(placed, await h.service.publicPlacements(KINGDOM));
    expect(diff).toEqual({ raise: [], replace: [], withdraw: [{ id: TOAD, purpose: 'statue', revision, origin: 'simulated' }] });
    expect(await h.service.publicPlacements(KINGDOM)).toEqual([]);
    expect(await h.service.pendingReveals(KINGDOM)).toEqual([]);
    expect(await h.service.acknowledgeReveal({ kingdomId: KINGDOM, revealId: reveal!.id })).toMatchObject({ status: 'applied' });
    const view = await h.service.publicCatalogue(KINGDOM);
    expect(view.resolveApprovedEmote(TOAD, 'statue')).toBeNull();
    expect(view.resolveInlineEmote(TOAD)!.bytes).toEqual(recolouredGif());
    expect(view.health).toBe('current');
    // The old selection named the old bytes, so the monarch chooses again before anything is carved.
    expect(await h.service.prepareCandidate({ kingdomId: KINGDOM, id: TOAD, purpose: 'statue', atMs: day1 + RETRY * 3 + 1 }, signal())).toMatchObject({ code: 'not-found' });

    // Removed from the channel the next day: nothing stands, nothing is pending, chat keeps its words.
    h.world.listing = [];
    const day2 = day1 + RETRY * 3 + DAY;
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: day2 }, signal())).toMatchObject({ reason: 'daily', changes: { removed: [TOAD] } });
    expect((await h.service.publicCatalogue(KINGDOM)).resolveInlineEmote(TOAD)).toBeNull();
    expect(await h.service.publicPlacements(KINGDOM)).toEqual([]);

    // The next stream is a new epoch: read once more at go-live.
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 'night-2', atMs: day2 + 10 });
    expect(await h.service.tick({ kingdomId: KINGDOM, atMs: day2 + 11 }, signal())).toMatchObject({ reason: 'go-live' });
  }, 90_000);

  it('a published carving replaced by a new one is swapped in place, and the old reveal is withdrawn', async () => {
    const h = harness();
    const first = await reviewedStatue(h);
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision: first }, THRONE);
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 'night-1', atMs: 2_000 });
    const placed = await h.service.publicPlacements(KINGDOM);
    h.world.listing = [item('toadwave1', 'toadWave', true)];
    h.world.assets.set('toadwave1', recolouredGif());
    await h.service.refresh({ kingdomId: KINGDOM, reason: 'daily', atMs: 3_000 }, signal());
    const second = await reviewedStatue(h, 'statue', 4_000);
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision: second }, THRONE);
    const after = await h.service.publicPlacements(KINGDOM);
    // Confirmed while live: unveiled now. The first carving retired earlier, so its reveal never plays.
    expect(diffEmotePlacements(placed, after)).toEqual({ raise: [], replace: [{ from: placed[0], to: { id: TOAD, purpose: 'statue', revision: second, origin: 'simulated' } }], withdraw: [] });
    expect((await h.service.pendingReveals(KINGDOM)).map(r => r.revision)).toEqual([second]);
  }, 90_000);

  it('re-checks the channel and the provider choices when a slow read commits', async () => {
    let release!: () => void, entered!: () => void;
    let gate = new Promise<void>(resolve => { release = resolve; });
    let reached = new Promise<void>(resolve => { entered = resolve; });
    const slow = (transport: AuthorizedEmoteTransport): AuthorizedEmoteTransport => ({
      ...transport,
      async getHelix(path, query, s) { entered(); await gate; return transport.getHelix(path, query, s); },
    });
    let channelId = '141981764';
    const h = harness({ wrap: slow, channelId: () => channelId });
    const reset = () => {
      gate = new Promise<void>(resolve => { release = resolve; });
      reached = new Promise<void>(resolve => { entered = resolve; });
    };

    // 7TV on, then switched off by the monarch while the read is in flight: it stays withdrawn.
    expect(await h.service.setProviderOptIn({ kingdomId: KINGDOM, provider: '7tv', enabled: true }, THRONE)).toMatchObject({ status: 'applied' });
    expect(await h.service.nextRefresh(KINGDOM)).toMatchObject({ reason: 'genesis' });
    let running = h.service.refresh({ kingdomId: KINGDOM, reason: 'genesis', atMs: 1_000 }, signal());
    await reached;
    await h.service.setProviderOptIn({ kingdomId: KINGDOM, provider: '7tv', enabled: false }, THRONE);
    // BTTV switched on meanwhile: the read did not include it, so the next one is due at once.
    await h.service.setProviderOptIn({ kingdomId: KINGDOM, provider: 'bttv', enabled: true }, THRONE);
    release();
    expect(await running).toMatchObject({ status: 'applied' });
    const stored = await h.repository.load(KINGDOM);
    expect(stored!.snapshot!.providers['7tv']).toMatchObject({ health: 'disabled', entries: [] });
    expect(stored!.snapshot!.providers.bttv).toMatchObject({ health: 'disabled' });
    expect(await h.service.nextRefresh(KINGDOM)).toEqual({ reason: 'opt-in', dueAt: Number.NEGATIVE_INFINITY });

    // The kingdom's channel changes while a read is in flight: that read is thrown away.
    reset();
    running = h.service.refresh({ kingdomId: KINGDOM, reason: 'opt-in', atMs: 2_000 }, signal());
    await reached;
    channelId = '999999999';
    release();
    expect(await running).toMatchObject({ status: 'failed', code: 'stale' });
    expect((await h.repository.load(KINGDOM))!.snapshot!).toMatchObject({ channelId: '141981764', refreshedAt: 1_000 });
  }, 60_000);

  it('verifies blob addresses itself, whatever the bound store returns', async () => {
    const inner = createMemoryEmoteBlobStore();
    let lie = false;
    const lying: EmoteBlobStore = {
      put: (hash, bytes) => inner.put(hash, bytes),
      async get(hash) {
        const bytes = await inner.get(hash);
        if (!bytes || !lie) return bytes;
        bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1;
        return bytes;
      },
    };
    const h = harness({ blobs: lying });
    const revision = await reviewedStatue(h);
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, THRONE);
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 's1', atMs: 2_000 });
    lie = true;
    // A fresh service has nothing cached: every byte comes back through the lying store.
    const view = await h.restart().publicCatalogue(KINGDOM);
    expect(view.resolveInlineEmote(TOAD)).toBeNull();
    expect(view.resolveApprovedEmote(TOAD, 'statue')).toBeNull();
    lie = false;
    expect((await h.restart().publicCatalogue(KINGDOM)).resolveApprovedEmote(TOAD, 'statue')).not.toBeNull();
  }, 60_000);

  it('hands Genesis facts that pass its real contract, and none once the source changes', async () => {
    const h = harness();
    const revision = await reviewedStatue(h);
    await h.service.confirmStatue({ kingdomId: KINGDOM, id: TOAD, revision }, THRONE);
    await h.service.onStreamState({ kingdomId: KINGDOM, live: true, epoch: 's1', atMs: 2_000 });
    const facts = await h.service.genesisFacts(KINGDOM);
    const approvedEmotes = ChannelGenesisFactsSchema.shape.approvedEmotes;
    expect(approvedEmotes.safeParse(facts).success).toBe(true);
    expect(facts).toHaveLength(1);
    h.world.assets.set('toadwave1', recolouredGif());
    await h.service.refresh({ kingdomId: KINGDOM, reason: 'daily', atMs: 3_000 }, signal());
    expect(await h.service.genesisFacts(KINGDOM)).toEqual([]);
  }, 60_000);

  it('plans reads purely: an outage backs off, doubling to its cap, and is never due at once', () => {
    const snapshot = { version: 1 as const, kingdomId: KINGDOM, channelId: '1', revision: 1, refreshedAt: 0, reason: 'daily' as const, providers: { twitch: { provider: 'twitch' as const, health: 'current' as const, lastSuccessAt: 0, attemptedAt: 0, problem: null, truncated: false, skipped: [], entries: [] } } };
    const plan = (failures: number, lastAttemptAt = 1_000) => planEmoteRefresh({ snapshot, stream: null, schedule: { goLiveEpoch: null, providersChanged: false, failures, lastAttemptAt } });
    expect(plan(0)).toEqual({ reason: 'daily', dueAt: DAY });
    expect(plan(1).dueAt).toBe(1_000 + RETRY);
    expect(plan(3).dueAt).toBe(1_000 + RETRY * 4);
    expect(plan(30).dueAt).toBe(1_000 + EMOTE_REFRESH_SCHEDULE.retryMaxMs);
    expect(plan(1, DAY * 3).dueAt).toBe(DAY * 3 + RETRY);
    expect(planEmoteRefresh({ snapshot: null, stream: null })).toEqual({ reason: 'genesis', dueAt: Number.NEGATIVE_INFINITY });
    expect(planEmoteRefresh({ snapshot, stream: { live: true, epoch: 'e' }, schedule: { goLiveEpoch: 'e', providersChanged: false, failures: 0, lastAttemptAt: 0 } }).reason).toBe('daily');
    expect(planEmoteRefresh({ snapshot, stream: { live: true, epoch: 'f' }, schedule: { goLiveEpoch: 'e', providersChanged: false, failures: 0, lastAttemptAt: 0 } }).reason).toBe('go-live');
  });
});
