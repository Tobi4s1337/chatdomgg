// Runs the real emote catalogue service off the render thread with SIMULATED capabilities: a local
// channel that lists one original animated emote, a reviewer that approves exactly what it is shown,
// and a bench monarch. Everything else is production code: the refresher reads and hashes the GIF,
// the service carves it in the bench kingdom's palette, sends every frame's contact sheet to review,
// takes the monarch's confirmation of that exact geometry, publishes at the authoritative go-live and
// resolves the approved statue and heraldry from verified blobs. The page receives only resolved,
// schema-checked geometry. Terminating this worker cancels it and frees every buffer at once.
// In `check` mode the same kingdom then lives through its go-live read and the next daily read, in
// which the SIMULATED channel has re-uploaded toadWave with seasonal art: the service withdraws the
// carvings, drops nothing it should keep, and the monarch's fresh carving waits privately for review.
import { MATERIALS } from '@chatdom/content';
import { PersonIdSchema } from '@chatdom/shared';
import {
  createEmoteCatalogueService, diffEmotePlacements, EMOTE_COMPILER_VERSION, toadWaveSeasonalGifBytes, createEmoteImageDecoder, createMemoryEmoteBlobStore, createMemoryEmoteRepository, decodeEmoteImage,
  EmoteTransportError, SIMULATED_KINGDOM, toadWaveAnimatedFixture,
  type ApprovedEmoteVisual, type AuthorizedEmoteTransport, type EmoteCatalogueChanges, type EmotePurpose as Purpose, type CompiledEmote, type EmoteMutationResult, type EmotePurpose, type EmoteReviewPort, type EmoteSource, type InlineEmoteVisual,
} from '../../../../packages/emotes/src/index';

export interface BenchCompileRequest {
  readonly palette: readonly number[];
  readonly paletteRevision: number;
  /** `raised` stops at the live unveiling; `check` goes on through the next daily catalogue read. */
  readonly mode: 'raised' | 'check';
}

/** What the daily read found and what the square does about it; no reason ever reaches the public placements. */
export interface BenchDailyCheck {
  readonly kingdomId: string;
  readonly reason: string;
  readonly changes: EmoteCatalogueChanges;
  readonly health: 'current' | 'stale' | 'unavailable';
  /** Purposes the scene withdrew, from `diffEmotePlacements`. */
  readonly withdrawn: readonly Purpose[];
  readonly placementsAfter: number;
  readonly pendingReveals: number;
  /** The withdrawn statue's frame size and banner charge size: the placement keeps its plinth and standards. */
  readonly statueCells: readonly [number, number, number];
  readonly chargeCells: readonly [number, number];
  /** The monarch's fresh carving of the new art, waiting privately; never public. */
  readonly nextCarving: string;
  readonly nextReadAt: number;
  readonly trail: readonly BenchCatalogueStep[];
}

/** One step of the approval path, as the plaque shows it. */
export interface BenchCatalogueStep { readonly step: string; readonly detail: string }

export interface BenchCatalogue {
  readonly kingdomId: string;
  readonly revision: number;
  readonly health: 'current' | 'stale' | 'unavailable';
  readonly statueRevision: string;
  readonly heraldryRevision: string;
  readonly reveal: { id: string; streamEpoch: string; acknowledged: boolean } | null;
  readonly contactSheets: number;
  readonly trail: readonly BenchCatalogueStep[];
}

export type BenchCompileReply =
  | { ok: true; source: EmoteSource; bytes: number;
    flat: { width: number; height: number; frames: { rgba: Uint8Array; durationMs: number }[] };
    /** The approved statue as the public catalogue resolved it, with its approval binding. */
    statue: CompiledEmote; statueMaterials: number[]; heraldry: CompiledEmote;
    /** The small carving chant weather rains, approved on its own. */
    effect: CompiledEmote;
    /** The verified flat image the public catalogue resolves for chat, or null. */
    inline: InlineEmoteVisual | null;
    catalogue: BenchCatalogue; decodeMs: number; compileMs: number; check?: undefined }
  | { ok: true; check: BenchDailyCheck; source: EmoteSource; bytes: number;
    /** Chat's flat rendition of the new art, verified bytes; flat Twitch use needs no carving approval. */
    inline: InlineEmoteVisual | null; decodeMs: number; compileMs: number }
  | { ok: false; message: string };

interface CompileScope {
  onmessage: ((event: MessageEvent<BenchCompileRequest>) => void) | null;
  postMessage(reply: BenchCompileReply, transfer?: ArrayBuffer[]): void;
}
const scope = self as unknown as CompileScope;

/** The SIMULATED channel's Twitch ID and the emote it lists; neither is a real channel or emote. */
const CHANNEL_ID = '900000001';
const EMOTE_PROVIDER_ID = 'simtoadwave1';
const EMOTE_ID = `twitch.${EMOTE_PROVIDER_ID}`;
const THRONE = { bench: 'simulated-monarch' };
/** The SIMULATED bench monarch; a real host resolves the monarch from its own session. */
const BENCH_MONARCH = PersonIdSchema.parse('900000001');
const EPOCH = 'simulated-stream-1';

class StepFailed extends Error {}
const applied = (result: EmoteMutationResult, step: string): number => {
  if (result.status !== 'applied') throw new StepFailed(`${step}: ${result.message}`);
  return result.revision;
};

scope.onmessage = event => {
  void (async () => {
    const started = performance.now();
    const { bytes } = toadWaveAnimatedFixture();
    // The SIMULATED channel's art; the daily read in `check` mode finds it re-uploaded.
    let served = bytes;
    const signal = new AbortController().signal;
    const transport: AuthorizedEmoteTransport = {
      async getHelix() {
        return {
          data: [{ id: EMOTE_PROVIDER_ID, name: 'toadWave', images: {}, tier: '1000', emote_type: 'subscriptions', emote_set_id: 'simulated', format: ['static', 'animated'], scale: ['1.0', '2.0', '3.0'], theme_mode: ['light', 'dark'] }],
          template: 'https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}',
        };
      },
      async getProviderCatalogue() { throw new EmoteTransportError('unavailable', 'Third-party providers are off in the workshop.'); },
      async getAsset(_provider, url) {
        if (!url.includes(`/${EMOTE_PROVIDER_ID}/animated/`)) throw new EmoteTransportError('not-found', 'The SIMULATED channel has no such image.');
        return served.slice();
      },
    };
    let sheets = 0;
    const review: EmoteReviewPort = {
      async review({ candidate, contactSheets }) {
        sheets += contactSheets.length;
        return { decision: 'approve', reviewedGeometryHash: candidate.geometryHash, receiptId: `simulated-luna.${candidate.geometryHash.slice(0, 16)}` };
      },
      async reviewFlat() { throw new Error('Flat third-party review is not part of the workshop.'); },
    };
    const service = createEmoteCatalogueService({
      origin: 'simulated', repository: createMemoryEmoteRepository(), blobs: createMemoryEmoteBlobStore(), transport, decoder: createEmoteImageDecoder(), review, registry: MATERIALS,
      authority: { async requireMonarch(session) { if (session !== THRONE) throw new Error('Not the bench monarch.'); return BENCH_MONARCH; } },
      kingdom: { channelId: async () => CHANNEL_ID, palette: async () => ({ allowedMaterialIds: event.data.palette, paletteRevision: event.data.paletteRevision }) },
    });
    const kingdomId = SIMULATED_KINGDOM, trail: BenchCatalogueStep[] = [];

    applied(await service.refresh({ kingdomId, reason: 'genesis', atMs: 1_000 }, signal), 'Reading the channel');
    const plaque = await service.privateCandidates(kingdomId, THRONE);
    if (plaque.status !== 'ok') throw new StepFailed(plaque.message);
    const listed = plaque.sources.find(s => s.id === EMOTE_ID);
    if (!listed?.sourceHash) throw new StepFailed(listed?.problem ?? 'The SIMULATED channel listed no emote.');
    trail.push({ step: 'Read', detail: `${plaque.sources.length} Twitch emote · GIF · ${listed.frames} frames` });
    const decodedAt = performance.now();

    const revisions: Partial<Record<EmotePurpose, string>> = {};
    for (const purpose of ['statue', 'heraldry', 'effect'] as const) {
      applied(await service.selectCandidate({ kingdomId, id: EMOTE_ID, purpose, revision: listed.sourceHash }, THRONE), `Choosing the ${purpose}`);
      const prepared = await service.prepareCandidate({ kingdomId, id: EMOTE_ID, purpose, atMs: 2_000 }, signal);
      applied(prepared, `Carving the ${purpose}`);
      revisions[purpose] = prepared.status === 'applied' ? prepared.candidate! : '';
      applied(await service.reviewCandidate({ kingdomId, id: EMOTE_ID, purpose, revision: revisions[purpose]!, requestId: `bench-${purpose}` }, signal), `Reviewing the ${purpose}`);
    }
    trail.push({ step: 'Carved', detail: 'statue, banner charge and chant weather, kingdom palette' });
    trail.push({ step: 'Luna', detail: `approved the carved geometry · ${sheets} contact sheets` });
    applied(await service.confirmStatue({ kingdomId, id: EMOTE_ID, revision: revisions.statue! }, THRONE), 'Confirming the statue');
    applied(await service.confirmCandidate({ kingdomId, id: EMOTE_ID, purpose: 'heraldry', revision: revisions.heraldry! }, THRONE), 'Confirming the banner');
    applied(await service.confirmCandidate({ kingdomId, id: EMOTE_ID, purpose: 'effect', revision: revisions.effect! }, THRONE), 'Confirming the chant weather');
    trail.push({ step: 'Monarch', detail: 'confirmed the statue, the banner and the chant weather' });
    applied(await service.onStreamState({ kingdomId, live: true, epoch: EPOCH, atMs: 3_000 }), 'Going live');
    const [reveal] = await service.pendingReveals(kingdomId);
    const view = await service.publicCatalogue(kingdomId);
    const statue = view.resolveApprovedEmote(EMOTE_ID, 'statue'), heraldry = view.resolveApprovedEmote(EMOTE_ID, 'heraldry'), effect = view.resolveApprovedEmote(EMOTE_ID, 'effect');
    if (!statue || !heraldry || !effect) throw new StepFailed('The public catalogue did not resolve the approved statue, banner and weather.');
    const inline = view.resolveInlineEmote(EMOTE_ID);
    // The workshop is its own host: it commits the reveal by drawing it, then acknowledges once.
    if (reveal) applied(await service.acknowledgeReveal({ kingdomId, revealId: reveal.id, atMs: 3_001 }), 'Acknowledging the reveal');
    trail.push({ step: 'Unveiled', detail: reveal ? `live · ${reveal.streamEpoch}` : 'already unveiled' });

    if (event.data.mode === 'check') {
      const placedBefore = await service.publicPlacements(kingdomId);
      // The host's clock: the go-live read for this stream (nothing changed yet), then the next daily read.
      const live = await service.tick({ kingdomId, atMs: 3_002 }, signal);
      applied(live, 'The go-live read');
      if (live.reason !== 'go-live') throw new StepFailed(`The go-live read ran as ${live.reason ?? 'nothing'}.`);
      served = toadWaveSeasonalGifBytes();
      const plan = await service.nextRefresh(kingdomId);
      if ('status' in plan) throw new StepFailed(plan.message);
      const daily = await service.tick({ kingdomId, atMs: plan.dueAt }, signal);
      applied(daily, 'The daily read');
      if (daily.reason !== 'daily' || !daily.changes?.changed.includes(EMOTE_ID)) throw new StepFailed('The daily read did not see the new art.');
      const placedAfter = await service.publicPlacements(kingdomId);
      const diff = diffEmotePlacements(placedBefore, placedAfter);
      const after = await service.publicCatalogue(kingdomId);
      if (after.resolveApprovedEmote(EMOTE_ID, 'statue') || after.resolveApprovedEmote(EMOTE_ID, 'heraldry') || after.resolveApprovedEmote(EMOTE_ID, 'effect')) throw new StepFailed('A withdrawn carving still resolves in public.');
      // The monarch chooses the new art for the plinth; its carving waits for Luna, privately.
      const seen = await service.privateCandidates(kingdomId, THRONE);
      if (seen.status !== 'ok') throw new StepFailed(seen.message);
      const fresh = seen.sources.find(s => s.id === EMOTE_ID);
      if (!fresh?.sourceHash || fresh.sourceHash === listed.sourceHash) throw new StepFailed('The new art was not read.');
      applied(await service.selectCandidate({ kingdomId, id: EMOTE_ID, purpose: 'statue', revision: fresh.sourceHash }, THRONE), 'Choosing the new art');
      const carving = await service.prepareCandidate({ kingdomId, id: EMOTE_ID, purpose: 'statue', atMs: plan.dueAt + 1 }, signal);
      applied(carving, 'Carving the new art');
      const pending = await service.pendingReveals(kingdomId);
      const next = await service.nextRefresh(kingdomId);
      const changes = daily.changes;
      const check: BenchDailyCheck = {
        kingdomId, reason: daily.reason, changes, health: after.health, withdrawn: diff.withdraw.map(p => p.purpose), placementsAfter: placedAfter.length,
        pendingReveals: pending.length, statueCells: statue.frames[0]!.blueprint.size, chargeCells: [heraldry.mask.width, heraldry.mask.height],
        nextCarving: carving.status === 'applied' ? carving.candidate! : '', nextReadAt: 'status' in next ? 0 : next.dueAt,
        trail: [
          { step: 'Read', detail: `daily · Twitch answered · ${changes.changed.length} changed, ${changes.removed.length} removed` },
          { step: 'Square', detail: `withdrew the ${(['statue', 'heraldry', 'effect'] as const).filter(p => diff.withdraw.some(w => w.purpose === p)).map(p => ({ statue: 'statue', heraldry: 'banner charge', effect: 'chant weather' })[p]).join(', ')} quietly; the plinth waits under cloth` },
          { step: 'Next', detail: 'a fresh carving, after review and the monarch’s word' },
        ],
      };
      const newSource: EmoteSource = { id: EMOTE_ID, provider: 'twitch', providerId: EMOTE_PROVIDER_ID, kingdomId, name: fresh.name, origin: 'simulated', sourceHash: fresh.sourceHash, rendition: 'gif' };
      scope.postMessage({ ok: true, check, source: newSource, bytes: served.length, inline: after.resolveInlineEmote(EMOTE_ID), decodeMs: decodedAt - started, compileMs: performance.now() - decodedAt });
      return;
    }

    const final = await service.privateCandidates(kingdomId, THRONE);
    if (final.status !== 'ok') throw new StepFailed(final.message);
    const bound = (visual: ApprovedEmoteVisual): CompiledEmote => {
      const record = final.candidates.find(c => c.revision === visual.revision && c.purpose === visual.purpose)!;
      return { ...visual, sourceHash: listed.sourceHash!, geometryHash: record.geometryHash, compilerVersion: EMOTE_COMPILER_VERSION, paletteRevision: event.data.paletteRevision, targetHeightCells: visual.frames[0]!.blueprint.size[1] };
    };
    const statueMaterials = [...new Set(statue.frames.flatMap(f => f.blueprint.boxes.map(b => b.material)))].sort((a, b) => a - b);

    // The plaque also shows the flat GIF frames as chat would; decode them once more for display.
    const flatDecoded = await decodeEmoteImage(bytes, 'gif', signal);
    if (!flatDecoded.ok) throw new StepFailed(flatDecoded.message);
    const frames = flatDecoded.decoded.frames.map(frame => ({ rgba: frame.rgba, durationMs: frame.durationMs }));
    const source: EmoteSource = { id: EMOTE_ID, provider: 'twitch', providerId: EMOTE_PROVIDER_ID, kingdomId, name: listed.name, origin: 'simulated', sourceHash: listed.sourceHash, rendition: 'gif' };
    const reply: BenchCompileReply = {
      ok: true, source, bytes: bytes.length, flat: { width: flatDecoded.decoded.width, height: flatDecoded.decoded.height, frames },
      statue: bound(statue), statueMaterials, heraldry: bound(heraldry), effect: bound(effect), inline,
      catalogue: {
        kingdomId, revision: view.revision, health: view.health, statueRevision: statue.revision, heraldryRevision: heraldry.revision,
        reveal: reveal ? { id: reveal.id, streamEpoch: reveal.streamEpoch, acknowledged: (await service.pendingReveals(kingdomId)).length === 0 } : null,
        contactSheets: sheets, trail,
      },
      decodeMs: decodedAt - started, compileMs: performance.now() - decodedAt,
    };
    scope.postMessage(reply, frames.map(frame => frame.rgba.buffer as ArrayBuffer));
  })().catch(error => scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }));
};
