// Runs the real emote catalogue service off the render thread with SIMULATED capabilities: a local
// channel that lists one original animated emote, a reviewer that approves exactly what it is shown,
// and a bench monarch. Everything else is production code: the refresher reads and hashes the GIF,
// the service carves it in the bench kingdom's palette, sends every frame's contact sheet to review,
// takes the monarch's confirmation of that exact geometry, publishes at the authoritative go-live and
// resolves the approved statue and heraldry from verified blobs. The page receives only resolved,
// schema-checked geometry. Terminating this worker cancels it and frees every buffer at once.
import { MATERIALS } from '@chatdom/content';
import { PersonIdSchema } from '@chatdom/shared';
import {
  createEmoteCatalogueService, EMOTE_COMPILER_VERSION, createEmoteImageDecoder, createMemoryEmoteBlobStore, createMemoryEmoteRepository, decodeEmoteImage,
  EmoteTransportError, SIMULATED_KINGDOM, toadWaveAnimatedFixture,
  type ApprovedEmoteVisual, type AuthorizedEmoteTransport, type CompiledEmote, type EmoteMutationResult, type EmotePurpose, type EmoteReviewPort, type EmoteSource,
} from '../../../../packages/emotes/src/index';

export interface BenchCompileRequest { readonly palette: readonly number[]; readonly paletteRevision: number }

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
    statue: CompiledEmote; statueMaterials: number[]; heraldry: CompiledEmote; catalogue: BenchCatalogue; decodeMs: number; compileMs: number }
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
        return bytes.slice();
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
    for (const purpose of ['statue', 'heraldry'] as const) {
      applied(await service.selectCandidate({ kingdomId, id: EMOTE_ID, purpose, revision: listed.sourceHash }, THRONE), `Choosing the ${purpose}`);
      const prepared = await service.prepareCandidate({ kingdomId, id: EMOTE_ID, purpose, atMs: 2_000 }, signal);
      applied(prepared, `Carving the ${purpose}`);
      revisions[purpose] = prepared.status === 'applied' ? prepared.candidate! : '';
      applied(await service.reviewCandidate({ kingdomId, id: EMOTE_ID, purpose, revision: revisions[purpose]!, requestId: `bench-${purpose}` }, signal), `Reviewing the ${purpose}`);
    }
    trail.push({ step: 'Carved', detail: 'statue and banner charge, kingdom palette' });
    trail.push({ step: 'Luna', detail: `approved the carved geometry · ${sheets} contact sheets` });
    applied(await service.confirmStatue({ kingdomId, id: EMOTE_ID, revision: revisions.statue! }, THRONE), 'Confirming the statue');
    applied(await service.confirmCandidate({ kingdomId, id: EMOTE_ID, purpose: 'heraldry', revision: revisions.heraldry! }, THRONE), 'Confirming the banner');
    trail.push({ step: 'Monarch', detail: 'confirmed the statue and the banner' });
    applied(await service.onStreamState({ kingdomId, live: true, epoch: EPOCH, atMs: 3_000 }), 'Going live');
    const [reveal] = await service.pendingReveals(kingdomId);
    const view = await service.publicCatalogue(kingdomId);
    const statue = view.resolveApprovedEmote(EMOTE_ID, 'statue'), heraldry = view.resolveApprovedEmote(EMOTE_ID, 'heraldry');
    if (!statue || !heraldry) throw new StepFailed('The public catalogue did not resolve the approved statue and banner.');
    // The workshop is its own host: it commits the reveal by drawing it, then acknowledges once.
    if (reveal) applied(await service.acknowledgeReveal({ kingdomId, revealId: reveal.id, atMs: 3_001 }), 'Acknowledging the reveal');
    trail.push({ step: 'Unveiled', detail: reveal ? `live · ${reveal.streamEpoch}` : 'already unveiled' });

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
      statue: bound(statue), statueMaterials, heraldry: bound(heraldry),
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
