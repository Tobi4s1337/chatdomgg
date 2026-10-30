# Spec 24: The channel's emotes become its kingdom

Status: **frozen 2026-10-30 for lane-owned APIs below; main reviews and commits the handoff before launch.**
The existing shared contracts are usable. New catalogue, compiler, review and presentation types live in the
owned module; they are not claims that a shared emote protocol already exists. Main binds production consumers.

Vision: `chatdom/ChatDom.md` principles 6, 8–10, 15–18 and §§5, 8; `chatdom/Moments.md` §§9–10, 12, 14;
`chatdom/Twitch.md` §§4, 7, 10, 21; `chatdom/Safety.md` §3 surface table, §6 cases 6 and 10, §8 Decided;
`chatdom/Artstyle-Soul-Feel.md` §§6–8, 9, 13 and Decided; `chatdom/Quality.md` rules 2, 8–17.

## What and why

The channel's familiar face stands in the plaza, flies on its banners and becomes the little heart in a
citizen's chimney smoke. Chatting that emote lifts it above a real person's head; a shared chant sends its
colours drifting over the streets. This is the community recognising itself everywhere, with the same emote
handled carefully at chat size and at statue scale. Genesis offers checked sculptures for the monarch to
unveil. Newly added emotes receive their own reveal; retired ones leave the public square quietly. The module
delivers the real catalogue adapters, bounded image-to-voxel pipeline, approval lifecycle and reusable visual
consumers. It also supplies a complete visible demonstration and explicit production ports, so main can wire
Genesis, the throne, chat, content, building, the Forge, spectacles and the panel to the same approved revision.

## Current state

- `packages/shared/src/citizen-chat.ts:5` exports `CitizenChatCueSchema`/`CitizenChatCue`, with `version`,
  `id`, `kingdomId`, `epoch`, `origin: 'live' | 'simulated'`, visual `slot`, `asOf`, `expiresAt` and ordered
  `parts`. Parts are `{kind:'text',text}` or `{kind:'emote',id,alt}`. There is no `CitizenChatVisual` export,
  top-level text field, arbitrary image URL or private actor ID. Cues expire within ten seconds.
- `apps/web/src/kingdom/citizen-scene.ts:10` owns the actual citizen motion/render integration and emits
  `SpeechLabel` records containing those parts. It already rejects foreign kingdom/epoch/origin cues and
  supplies world subjects by slot. Main inserts this lane's inline/gesture consumer there; do not duplicate it.
- `packages/shared/src/voxel.ts:39` and `:75` define the actual `VoxelAsset` and `VoxelBlueprint` formats: build
  lattice is 0.125 m, Y up, stable material IDs with zero air. `packages/content/src/materials.ts:1` exports
  the real `MATERIALS`, `MAT`, `STYLES` and `StyleKey`. `packages/voxel/src/asset.ts:11` supplies ordinary
  rasterization and worker-mesh preparation. No separate image-plane statue material is needed.
- `packages/content/src/forge-motifs/index.ts:6` and `forge-ornaments/index.ts:5` are authored, fixed
  silhouettes. `packages/shared/src/forge.ts` permits only registered motifs in `HousePartPlanSchema` and
  `ComposedHousePartPlanSchema`; `ForgeStyleKitSchema` has no emote list. This lane must not smuggle a new
  motif through those enums. It exports a checked motif factory for main's explicit grammar integration.
- `packages/twitch/src/helix.ts:55` implements `HelixReader` with Get Users and authorization reads only.
  `apps/herald/src/` currently contains auth/config/bootstrap, not a completed emote catalogue producer.
  `work/references/herald-presence.md` establishes the separate read-only ingest direction. An app token
  never implies a monarch's publication authority.
- `apps/web/src/main.tsx` discovers only named existing lane views. Main adds the optional `/-/emotes`
  entry and consumer dependencies; the lane can run its own HTML entry without editing the shared router.
  `apps/panel/`, `apps/web/src/build/`, `apps/web/src/forge/` and kingdom/throne/Genesis owners bind ports at
  integration; this lane cannot change their files or report them as wired before that happens.

## Rules

1. **R1 — A real, current channel catalogue.** Implement Get Channel Emotes using the injected authorized
   transport. Reconcile at go-live and daily; coalesce overlapping refreshes per kingdom. Preserve a successful
   prior catalogue on timeout, auth failure, malformed response or partial provider failure. An observed empty
   successful catalogue is different from unavailable. Compare stable provider IDs plus source content hashes,
   never display names alone. No popularity is supplied by this endpoint: choose initial plaza candidates
   deterministically, let the monarch select/reorder, and use only witnessed aggregate use to suggest favourites.
2. **R2 — Static and animated are both real.** Decode actual PNG and GIF assets. Resolve the provider's
   documented rendition metadata instead of changing a filename extension to guess a GIF. Support third-party
   PNG/GIF/WebP renditions where advertised; a provider with only an unsupported rendition stays unavailable
   with a clear private explanation. Coalesce frame patches onto the full logical canvas with correct disposal,
   transparency and frame delays before snapping. Produce one voxel frame per decoded animation frame; never
   silently turn an animation into its poster. Reject an over-budget animation as a whole. Zero/missing delays
   get one documented bounded normalization, identically in review and runtime.
3. **R3 — Bounded work at every boundary.** Initial hard limits per source: 4 MiB compressed bytes, 512×512
   logical canvas, 120 frames, 32 MiB total coalesced RGBA, 30 s total playback, 10 s network deadline, two
   concurrent source jobs per kingdom, 256 channel entries per provider. Enforce dimensions/frame limits before
   allocation and enforce streaming byte limits without trusting Content-Length. No public URL-fetch endpoint.
   Asset addresses are generated only from checked provider metadata and configured HTTPS provider/CDN
   allowlists. Reject credentials, unusual ports, local/private/link-local addresses and redirects outside the
   same checked policy; test redirect and DNS/rebinding boundaries in the supplied server transport contract.
   Do not accept SVG, HTML or scripts as an image. Full decoding/compilation runs off the browser render thread
   or on the server worker; cancellation releases buffers. Bound compiled caches by bytes as well as entry count.
4. **R4 — The same recognisable sculpture, in the kingdom's palette.** Fit aspect ratio without stretching;
   keep source orientation and holes. Snap opaque colours to an explicit nonempty subset of the real material
   registry supplied by the kingdom, using a deterministic colour distance and material-ID tie break. Alpha
   determines occupancy, never black-as-transparent. Document resampling/alpha policy. No new material IDs,
   emissive powers or source palette sneak into the world. Extrude 2–6 build cells deep with a deliberate
   one-cell silhouette bevel where the mask allows it. Keep the silhouette readable from the side. The statue
   profile fits an occupied height of 32–48 cells (4–6 m), with a separate grounded plinth and walk clearance;
   the motif/heraldry/effect profiles use smaller authored resolutions. Every frame uses a common origin and
   dimensions, so a blink cannot make the statue jump. Geometry passes `VoxelBlueprintSchema`, occupied bounds
   and byte/box budgets before meshing. No arbitrary image plane standing in for a voxel statue.
5. **R5 — Two independent gates before a statue appears.** The actual extruded result, at target scale, goes
   through Luna and then the monarch explicitly confirms each statue. A confirmed source flat image is not an
   approved extrusion. Review all animation frames through bounded contact sheets plus relevant scale/side
   views; no unchecked later frame can appear. A reviewer cold/hold/refuse leaves the candidate private. Only
   the authenticated monarch may select, confirm, replace or opt in providers; no worker boolean, mod, Warden,
   subscription or client-submitted person ID substitutes for that authority. The composed crest/motif gets
   its own required safety review in its consuming publication flow. Approval binds source hash, geometry hash,
   compiler version, palette revision, purpose and target scale. Changing any of these invalidates that approval.
6. **R6 — Unveil, retire and recover honestly.** Candidates can be generated in advance, but public statue
   unveiling occurs during live Genesis or the next live stream after approval. The lifecycle is persistent
   through the injected repository: a crash or repeated go-live never unveils twice. Retired source entries are
   withdrawn quietly from public placements and future motif selection; keep provenance and private source
   records without destroying citizens' earned work. Previously placed work follows main's safe hiding policy,
   never destructive edits to a home. Ordinary source removal is not a public moderation spectacle. Outages
   keep known safe approved assets; confirmed removal/revocation invalidates public resolutions immediately.
7. **R7 — Third-party emotes are an explicit choice.** Implement read adapters for 7TV, BTTV and FFZ from
   their current primary public API documentation; validate current shapes, host policies and rendition formats
   before freezing each parser. Disabled means no third-party fetch or matching. Require the monarch to opt in
   the provider and each emote, and our own flat/voxel checks before use. Provider names and ownership stay in
   private source provenance and appropriate credit. Twitch approval, a provider API and a code library license
   do not make emote artwork generic reusable stock: keep it tied to its source community and authorized use.
   Do not bundle real channels' emotes as sample assets or publish them into a global stock catalogue.
8. **R8 — One approved source serves all surfaces.** Supply profiles and checked factories for plaza statues,
   crest/banner charges, stained glass, weathervanes, door knockers and chimney-smoke masks. Reuse the existing
   registry and mesher, real build lattice and mounting anchors. A motif returns geometry/anchors, never edits a
   home itself, grants a Forge wish, changes a connector or alters a style kit. Forge/build publication still
   reviews the whole composed result. Return precise unavailable/retired results instead of making a fabricated
   channel emblem. Keep provenance by exact source revision when objects travel through a gift, raid or visit.
9. **R9 — The real chat fragment is the cue.** Render ordered inline emote parts safely with alt text; text
   remains text, never innerHTML. Twitch emote IDs come from sanitized EventSub fragments; do not regex-match
   Twitch names out of a sentence. Third-party matching is an explicitly enabled tokenizer with exact case and
   word boundaries, never replacing substrings in URLs or inside existing Twitch emote fragments. Unknown,
   unavailable or retired assets retain readable text/alt without a broken image. Twitch's current flat
   rendition can appear inline without statue approval; an extrusion refusal never pretends Twitch removed
   the original chat emote. Third-party flat use requires its separate review and per-emote opt-in. A message containing one
   emote and only optional surrounding whitespace triggers a short pop above that supplied citizen slot.
   Mixed text never becomes an emote-only gesture. Retain origin/epoch/expiry, honour message deletion/clear,
   do not create people, and do not keep a chat archive. The gesture is a lifted emblem, not a forced face/body
   rig change. The citizen motion/behaviour owner remains authoritative.
10. **R10 — A chant becomes weather without a spam machine.** Implement a bounded, deterministic rolling
    aggregation of accepted chat-cue IDs and emote IDs, capped per source message and visual slot per window.
    Initial tuning: 6 s window, at least 3 distinct supplied slots, 12 s weather, 20 s same-emote cooldown. A
    hamlet can start a shared moment; a capital gets a richer bounded cloud rather than more simulation jobs.
    Up to 64 particles on phones and 256 on desktop, one instanced batch per active emote/material grouping,
    at most two simultaneous weather motifs. Count bursts, not one sound per particle. Retain no names or
    messages after the cue window; deletion removes unconsumed contribution and cancels its pending gesture.
    Use caller time and seeded placement, no Date.now/Math.random/frame-count animation. Weather cannot change
    presence, resources, standing or world climate. Stream/phone clarity wins over filling every pixel.
11. **R11 — Coordinate spectacles rather than implement them twice.** Spec 20's Twitch-moments owner
    choreographs cheers, Power-up balloons and paid celebrations. It consumes this lane's approved effect
    geometry; this lane owns no Bits receipt, cheer threshold, spectacle duration, dragon trigger or payment
    success. In particular a cheer never buys the dragon, standing or a permanent private statue. No live
    Twitch writes are needed anywhere in this lane.
12. **R12 — Every state belongs to the kingdom.** The monarch's candidate plaque, provider choice and reveal
    action work by keyboard and touch, respond within 100 ms, and use the existing wood/brass/parchment kit.
    Loading, no channel emotes, no approved statues, pending monarch, pending Luna, held, cold, retired and
    connection loss have clear private states and an actual way forward. Never show refused previews or words
    on stream. Use the shared sound port for a small material-matched UI/reveal/pop/weather cue with variation,
    respecting user mute and stream mix. Bench sources and mock review decisions say **SIMULATED** visibly.

## Contracts

### Existing frozen contracts, imported unchanged

Use `CitizenChatCue`/`CitizenChatCueSchema`, `VoxelBlueprint`/`VoxelBlueprintSchema`, `MaterialRegistry`,
`KingdomId`, `PersonId`, `TokenSchema` and `Sha256Schema` from `@chatdom/shared`. Use actual `MATERIALS` and
caller-selected kingdom swatches, ordinary voxel workers/materials and the existing citizen scene. Importing
a type does not make the lane a source of presence, identity, reviewer authority or a new event protocol.

### Lane-owned API to implement and export

These are local first-consumer contracts in `packages/emotes/src/types.ts` and package export entrypoints.
Validate runtime boundaries; use typed structured results instead of thrown decoder/provider errors in UI.
Additional internal fields/helpers are fine. Changing consumer-facing semantics requires main review.

```ts
import type { CitizenChatCue, KingdomId, MaterialRegistry, PersonId, VoxelBlueprint } from '@chatdom/shared';
type EmoteProvider = 'twitch' | '7tv' | 'bttv' | 'ffz';
type EmotePurpose = 'statue' | 'heraldry' | 'motif' | 'effect';
type EmoteOrigin = 'live' | 'simulated';
interface EmoteSource {
  id: string;                 // token-safe provider-qualified key; Twitch raw-ID alias retained separately
  provider: EmoteProvider; providerId: string; kingdomId: KingdomId;
  name: string; origin: EmoteOrigin;
  sourceHash: string;         // SHA-256 of fetched bytes, not URL or mutable provider name
  rendition: 'png' | 'gif' | 'webp';
}
interface DecodedEmote {
  width: number; height: number;
  frames: readonly { rgba: Uint8Array; durationMs: number }[]; // full coalesced canvas, top-left source origin
}
interface CompiledEmote {
  id: string; revision: string; origin: EmoteOrigin; purpose: EmotePurpose;
  sourceHash: string; geometryHash: string; compilerVersion: string;
  paletteRevision: number; targetHeightCells: number;
  frames: readonly { blueprint: VoxelBlueprint; durationMs: number }[];
  periodMs: number;
  mask: { width: number; height: number; materialIds: Uint16Array }; // first frame; x contiguous, Y up, 0 air
}
interface ApprovedEmoteVisual {
  id: string; revision: string; origin: EmoteOrigin; purpose: EmotePurpose;
  frames: readonly { blueprint: VoxelBlueprint; durationMs: number }[];
  periodMs: number;
  mask: { width: number; height: number; materialIds: Uint16Array };
}
type EmoteResolution = ApprovedEmoteVisual | null;
interface InlineEmoteVisual {
  id: string; revision: string; origin: EmoteOrigin; alt: string;
  mediaType: 'image/png' | 'image/gif' | 'image/webp'; bytes: Uint8Array;
}
interface EmoteCatalogueView {
  kingdomId: KingdomId; revision: number; checkedAt: number;
  health: 'current' | 'stale' | 'unavailable';
  resolveApprovedEmote(id: string, purpose: EmotePurpose): EmoteResolution;
  resolveInlineEmote(id: string): InlineEmoteVisual | null;
}
interface EmoteImageDecoder {
  decode(bytes: Uint8Array, format: EmoteSource['rendition'], signal: AbortSignal): Promise<DecodedEmote>;
}
interface AuthorizedEmoteTransport {
  // Host owns tokens, token renewal, shared rate budget and checked network policy, never the browser.
  getHelix(path: 'chat/emotes', query: { broadcaster_id: string }, signal: AbortSignal): Promise<unknown>;
  getProviderCatalogue(provider: Exclude<EmoteProvider, 'twitch'>, channelId: string, signal: AbortSignal): Promise<unknown>;
  getAsset(provider: EmoteProvider, checkedRendition: string, signal: AbortSignal): Promise<Uint8Array>;
}
interface EmoteReviewPort {
  review(input: { candidate: CompiledEmote; contactSheets: readonly Uint8Array[];
    requestId: string }, signal: AbortSignal): Promise<{
      decision: 'approve' | 'hold' | 'refuse' | 'cold'; reviewedGeometryHash: string; receiptId: string;
    }>;
  reviewFlat(input: { source: EmoteSource; contactSheets: readonly Uint8Array[];
    requestId: string }, signal: AbortSignal): Promise<{
      decision: 'approve' | 'hold' | 'refuse' | 'cold'; reviewedSourceHash: string; receiptId: string;
    }>;
}
interface EmoteAuthority {
  // Resolved by the server from its session. A client-supplied actor is never trusted.
  requireMonarch(session: unknown, kingdomId: KingdomId): Promise<PersonId>;
}
type EmoteMotifKind = 'stained-glass' | 'weathervane' | 'door-knocker' | 'chimney-smoke';
interface EmoteMotifGeometry {
  blueprint: VoxelBlueprint;
  mount: readonly [number, number, number];
  emitter: readonly [number, number, number] | null;
  provenance: { emoteId: string; revision: string; kingdomId: KingdomId; origin: EmoteOrigin };
}
interface EmoteReveal {
  id: string; kingdomId: KingdomId; emoteId: string; revision: string;
  streamEpoch: string; origin: EmoteOrigin;
}
```

Export real implementations `createTwitchEmoteAdapter(transport)`, `createThirdPartyEmoteAdapter(provider,
transport)`, `createEmoteImageDecoder()`, `compileEmote(input, registry, allowedMaterialIds, profile)` and
`createEmoteCatalogueService(ports)`. The compile input includes source and decoded frames; profile chooses
purpose, depth and target height within fixed bounds. Decoder dependencies must be permissive, pinned in the
owned package manifest, reviewed for decode bombs and credited for any adapted code. No decoding fallback may
pretend an unsupported format succeeded. The service owns parsing, scheduling, reconciliation, hashes,
approval transitions and public/private projections; injected transport/repository/reviewer are capabilities,
not implementations replaced with fixture-only success.

Implement `EmoteRepository` as an exported typed port with `load(kingdomId)` and atomic
`compareAndSwap(kingdomId, expectedRevision, nextState)`. `EmoteStoredState` contains provider preferences,
source metadata/hashes, private compiled candidates and review receipts, monarch selections/confirmations,
published revisions and unveiling IDs, retired revision tombstones and refresh timestamps. Source blobs and
compiled buffers use a separate content-addressed blob port `put(hash,bytes)`/`get(hash)`; verify hash on read.
CAS conflicts reload/re-evaluate; persist before exposing an approved catalogue. The lane supplies a bounded
in-memory implementation for tests and documents the serializable stored representation. Main supplies the
production database/blob implementations; memory storage is never presented as durable production storage.

The catalogue service exports `refresh({kingdomId,reason:'genesis'|'go-live'|'daily',atMs},signal)`,
`setProviderOptIn({kingdomId,provider,enabled},session)`, `selectCandidate({kingdomId,id,purpose,revision},session)`,
`confirmStatue({kingdomId,id,revision},session)`,
`reviewCandidate({kingdomId,id,purpose,revision,requestId},signal)`, `onStreamState({kingdomId,live,epoch,
atMs})`, `privateCandidates(kingdomId,session)` and `publicCatalogue(kingdomId)`. Expose a replayable,
idempotent `pendingReveals(kingdomId)` projection and `acknowledgeReveal({kingdomId,revealId})` after the host commits its
witnessed reveal. Do not dispatch a callback that loses a reveal between publication and delivery. The service
never manufactures a world fact or trusts a browser's `live` value; main supplies authoritative stream state.
`selectCandidate` also records the monarch's explicit per-emote third-party opt-in; it does not publish it.
For third-party flat review, contact sheets include the exact original flat frames as well as transformed
views, and the separate flat-use receipt binds their source hash. Do not reuse a statue verdict as an
unreviewed flat-use verdict. `resolveInlineEmote` returns verified content-addressed bytes, never provider
credentials or an arbitrary remote URL; inline components manage and revoke their own object URLs.
`reviewCandidate` is a server worker operation, never an unguarded public route. Every mutating service method
returns `{status:'applied', revision:number}` or a typed bounded failure with code
`'unavailable'|'stale'|'forbidden'|'not-found'|'invalid'`; no success is returned before its required CAS commits.
`pendingReveals` returns `readonly EmoteReveal[]`. Its acknowledgement takes both `kingdomId` and `revealId`,
is idempotent and is called only by the authoritative host after its world commit, never by the viewer browser.

Export `createEmoteMotif(visual: ApprovedEmoteVisual, kind: EmoteMotifKind, kingdomId: KingdomId):
EmoteMotifGeometry | null` and `createEmoteHeraldry(visual: ApprovedEmoteVisual, kingdomId: KingdomId):
EmoteMotifGeometry | null`. Enforce the matching approved purpose; the heraldry factory returns a charge to
compose into an existing banner/crest, not an unchecked complete crest. Motion/interaction remains with the
host: a door knocker returns its hinge/strike anchors in documented local cells, not a nonfunctional fake door.
The owned module may extend `EmoteMotifGeometry` with typed interaction anchors as required by that consumer.

In `packages/emotes/src/render/`, export the ordinary voxel scene adapter and `createEmoteWeather`, taking
caller scene/worker/materials, positions, catalogue, time and explicit disposal. A pure `sampleEmoteFrame(visual,
elapsedMs)` handles variable frame durations and static frames. Reuse geometry by revision/frame, cap GPU cache
bytes and release on retirement/dispose. `createEmoteChatPresentation` consumes the actual `CitizenChatCue`,
present-slot positions and catalogue, emits inline parts/gesture subjects/weather instances, and has explicit
`removeCue(id)`, `clearSlot(slot)` and `clearEpoch()` methods. A host projection supplies authenticated cue IDs
for deletion; never derive a person ID from a visual slot. Keep frame sampling and aggregation testable without
three.js. Inline Solid components in `apps/web/src/emotes/` accept the same safe projections for web/panel use.

For Spec 20, the exact port is `resolveApprovedEmote(id, 'effect')`. Its local structural consumer may narrow
the result to `{id,revision,origin,frames,periodMs}`. Spec 20 owns fireworks and Power-up choreography, and
must preserve null, immutable revision and simulation origin. Static consumers may select the first frame
explicitly; statue/balloon playback uses actual timing. No direct package dependency is required before merge.

### Main's production binding checklist

These are integration obligations, not permission to expand the worker's write scope:

- Add the new workspace dependency/export consumption, regenerate the lockfile, and register `/-/emotes`.
- Bind the authorized server transport to existing Twitch token/budget machinery; use checked provider/CDN
  network resolution and bounded fetch. Bind durable catalogue/blob storage, real Luna contact-sheet review,
  monarch sessions and authoritative stream live/epoch. Missing capabilities surface unavailable privately.
- Genesis/throne use private candidates, per-statue confirmation and pending reveal acknowledgement. Kingdom
  scene adds approved statues with real placement/collision clearance, without replacing settlement routing.
- Herald supplies sanitized chat fragments, dedupe/deletion and exact third-party tokenization opt-in. Existing
  citizen bubbles/behaviour keep authority; call the emote presentation adapter for inline parts and pops.
- Build/content/Forge consume checked motif factories only through their own reviewed publication contracts.
  Main changes `HousePartPlan`/style-kit shared schemas deliberately if the actual Forge consumer needs it.
- Panel uses the inline component and private review projection only for an authorized monarch; a viewer
  cannot acquire those controls. Spectacle owner consumes the effect profile; banner/crest owners consume
  heraldry. A screenshot of the bench alone does not prove these bindings exist.

## Scope

The worker may write **only** `packages/emotes/**`, `apps/web/src/emotes/**` and
`work/lanes/emotes/{PRD.md,progress.txt}`. It may add the owned package manifest and module README; main
handles root lock/dependency configuration and `THIRD_PARTY.md` integration from an attribution file in the
owned module. All other files, especially `packages/shared/**`, kingdom/build/Forge/panel/Herald consumers,
root scripts and Spec 20, are read-only. The worker is not alone: never revert another lane's edits. Workers'
normal lane commits follow `AGENTS.md`; sub-agents never run git.

## Acceptance

Run `pnpm typecheck`, `pnpm exec eslint packages/emotes apps/web/src/emotes`,
`pnpm exec vitest run packages/emotes apps/web/src/emotes` and `pnpm build`. Main runs final `pnpm verify`
after binding consumers. If a root lockfile refresh is needed, report `needs:` with exact package/version;
keep implementing independent pieces, never edit another lane's manifest or quietly omit animated decoding.

Use focused, meaningful tests for: asymmetric orientation/transparent black/holes; GIF disposal and variable
timing; reject compressed-byte/dimension/frame budgets before unsafe allocation; one complete provider change
cycle including outage versus empty/removal; wrong/stale approval hash and non-monarch confirmation; CAS race
and crash/restart reveal replay; source change invalidation; private hold/cold; provider disabled means zero
fetches; duplicate/mixed/expired chat, deletion and independent-slot weather threshold; bounded 50,000-cue
input with bounded retained state, deterministic frame/weather output and disposed cache resources. These
tests prove behavior, not snapshots of generated voxel boxes. Network tests use local injected responses,
not arbitrary public URL fetches or credentials. One real read-only channel catalogue check is useful when
authorized app credentials/transport are available; save only redacted status and source counts, never tokens.

Task 1 or 2 must visibly show the actual compiled statue in the real clay/voxel renderer and an inline/popped
emote. Create original asymmetric static and animated fixtures, conspicuously labelled **SIMULATED**; do not
ship a familiar real emote borrowed without source permission. The bench's mock approval is also labelled.
It must support genuine injected live catalogue/review ports and show unavailable states honestly. A local
`apps/web/src/emotes/index.html` entry is allowed for development without changing the host router.

Use `$look`, actual Vite preview on a free recorded port 5170–5199, and a scoped
`node apps/web/src/emotes/capture.mjs --base-url http://127.0.0.1:<owned-port>` with the existing capture lock
and readiness handshake. Capture statue front/side with a human-scale citizen, animated frame differences,
banner/motif applications, inline/mixed/unknown text, gesture/weather, and private review pending/cold/retired
states. View the important captures with `view_image`: web **1440×900** and **390×844**, stream composition
**1920×1080**, panel composition **318×496**. Save under `shots/emotes/`. Test touch/keyboard confirmation,
motion reduction, no horizontal overflow, alt text and no public held preview. A stream/panel composition in
the bench proves layout only; main captures the wired real surfaces at integration. Record exact commands,
shots viewed, source origin, production bindings still missing and real-GPU doubts in progress.

## Quality bar

The source joke survives the transformation. Four metres away it reads as that community's emblem; from the
side it is a crafted sculpture with weight, softened contour, a real base and contact shadow. Colour snapping
does not produce isolated speckle, sever eyes or fill intentional holes. The same emblem works in brass on
a door, in glass on a window and at chat size without becoming a generic square sticker. Animation keeps its
meaning and never wobbles the origin. A tiny kingdom can share a chant without looking deserted; a capital
retains readable streets and windows. Controls feel carved, every action has a quiet sound, holds stay
private, and no fabricated emote or approval is passed off as real. No generated raster art is required.

## References

- `work/references/voxel-meshing-light.md`: use the existing greedy mesh, registered palette and clay/AO path;
  do not introduce a separate billboard/material pipeline for sculpture.
- `work/references/vox-import.md`: bounded allocation, occupied-bound normalization and deliberate handedness;
  the emote compiler is original and is not a `.vox` importer.
- `work/references/herald-presence.md`: narrow authorized transport, dedupe, no chat logs and outage honesty.
- Primary [Get Channel Emotes reference](https://dev.twitch.tv/docs/api/reference/#get-channel-emotes), checked
  2026-10-30: app or user token, `chat/emotes?broadcaster_id=…`, stable IDs and rendition template metadata.
  Use documented formats/scales rather than guessing image URLs. API order is not popularity.
- Primary [EventSub chat message documentation](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage):
  structured fragments carry emote identity. The existing shared cue is the sanitized client boundary.
- Primary decoder candidates [gifuct-js](https://github.com/matt-way/gifuct-js) and
  [fast-png](https://github.com/image-js/fast-png): inspect current license/source before adopting a pinned
  dependency, especially GIF patch/disposal and decoder memory behavior. These are candidates, not an approval
  to copy code or a requirement to hand-write an image decoder. Source artwork has separate rights.

Existing reference studies cover the voxel/render architecture. This spec's additional research is a narrow
primary-protocol check, not a claim to have studied or copied a new visual reference implementation. The
worker records pinned decoder/provider findings and attributions inside its owned README before adoption.

## Not now

This lane does not own arbitrary image uploads/URL fetching, a global emote marketplace, identity/presence,
payment/loyalty rewards, a second Forge grammar, spectacle choreography, new settlement routing, Genesis's
whole ceremony, a global safety service, main's durable storage deployment or Twitch writes. All §9 emote
surfaces remain in scope through working factories and adapters; their host integration stays with main.

## Decisions

- **2026-10-30 — Approval follows the transformed object.** Source approval is not statue approval. Purpose,
  geometry, palette, scale and every animation frame bind the publication receipt; a change reopens review.
- **2026-10-30 — Local contracts before shared growth.** Main approved lane-owned catalogue/compiler/review
  ports and a real injected authorized transport. The actual first consumers determine any later shared schema
  addition; no fictional `CitizenChatVisual` export or emote event is introduced here.
- **2026-10-30 — One source, separate choreography owners.** Emotes owns source/compilation, inline/gesture
  and chant weather. Spec 20 consumes approved effect frames for cheers/Power-ups and owns their timing.
- **2026-10-30 — Production behavior through ports.** Real catalogue parsers, bounded decoders, approval
  lifecycle, replayable reveals and visual consumers are implemented by the lane. Main supplies authenticated
  durable/network/reviewer bindings and joins the actual surfaces. A fixture-only implementation is incomplete.
