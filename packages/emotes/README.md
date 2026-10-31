# @chatdom/emotes

The channel's emotes, carved into its kingdom (Spec 24). This package turns one decoded emote into
checked voxel geometry for a purpose (plaza statue, heraldry charge, Forge motif, spectacle effect)
in the kingdom's own palette, and lays out the surfaces that carry it.

## Compiler (`compileEmote`)

`compileEmote(input, registry, allowedMaterialIds, profile)` is pure and deterministic. The same
source bytes, palette subset, palette revision, profile and `EMOTE_COMPILER_VERSION` always produce the
same `geometryHash` and `revision`. Failures are typed results (`invalid-source`, `over-budget`, `empty`,
`unsupported-aspect`, `invalid-palette`, `invalid-profile`) and are never thrown.

**Budgets before pixels.** Canvas size (512×512), frame count (120), coalesced RGBA bytes (32 MiB),
playback (30 s) and frame/canvas agreement are checked before any per-pixel work happens.

**Palette.** The kingdom passes an explicit, non-empty subset of the real material registry (at most 64
solid materials, with no air and no repeats). Each source pixel snaps to the nearest entry by integer
redmean distance; equal distances go to the lower material ID. No new material ID, emissive value or
source colour enters the world.

**Alpha and resampling.**
- One crop covers the union of every frame's pixels above alpha 16, so all frames share one origin.
- The crop is fitted to the profile's target height without stretching, and the width follows the
  aspect ratio. A source too wide for the purpose is fitted by width instead, and refused if it then
  stands too short.
- Each grid cell takes area-weighted alpha coverage, and a cell is solid at half coverage or more.
  Occupancy comes from alpha alone: opaque black is solid outline, and transparent black is air.
- The cell's material is the snapped colour with the most alpha-weighted area. An anti-aliasing
  interpolant gets only a damped vote: a pixel lying between two strongly different opposite
  neighbours on any axis. This keeps outlines and eyes crisp, and the cell never averages into an
  in-between colour.
- The sampler asks again (at most twice) when thin anti-aliased rims leave the occupied height under
  the target.

**Speckle.** A lone cell, with no 4-neighbour of its own material, is cleaned to the majority of its
eight neighbours in two cases:
- the snapped colours are within redmean distance 90 of each other;
- its material appears in at most 2 cells of the frame and lies within distance 150 of its
  surroundings.

A lone cell that strongly contrasts with its surroundings, such as a pupil, a stud or a highlight,
always stays.

**Extrusion.** The front face is +Z and Y is up, so the source reads the right way round to a viewer
in front. Depth is 2–6 build cells, depending on the purpose. From 3 cells deep, every silhouette
cell, including the rims of holes, loses its front and back layer. This one-cell bevel softens the
contour without changing the front outline. Holes stay open through the whole depth. Boxes are greedy
and deterministic, and every frame is checked against `VoxelBlueprintSchema` and the per-frame and
whole-animation box, cell and byte budgets.

**Frame timing.** Any delay that is missing, not finite or under 20 ms plays for 100 ms. Delays over
10 s are held at 10 s. The same rule applies in review and at runtime. A single-frame emote is static,
with a duration and period of 0.

| Purpose | Occupied height (cells) | Depth | Max width |
|---|---|---|---|
| statue | 32–48 (4–6 m), default 40 | 2–6, default 6 | 96 |
| heraldry | 14–24, default 20 | 2–3 | 40 |
| motif | 10–16, default 14 | 2–3 | 24 |
| effect | 12–24, default 16 | 2–4 | 40 |

## Surfaces

- `layoutEmoteStatue(frames, materials, id)` builds a stepped plinth (footing, course, body with a
  recessed plate, overhanging cap) sized to the common frame bounds, with a 1 m walking clearance.
  `composeStatueFrame(layout, frame, id)` returns one frame standing on that plinth as a single
  blueprint, so the mesher's AO darkens the joint where the sculpture meets the cap. Hosts cache one
  composite per approved revision and frame.
- `layoutEmoteBanner(mask, materials, id)` builds a plaza banner: stone foot, pole, crossbar, finial
  and a trimmed swallow-tailed cloth. The cloth hangs from 2.25 m, above head height. The heraldry
  charge is inlaid in the cloth and stands one cell proud. This is a bench and preview composition;
  the checked heraldry factory for crest and banner owners comes with the resolvers.
- `layoutEmotePlinth(size, materials, id)` is the same plinth from a frame size alone, and
  `createEmoteDrape(size, {cloth, cord}, id, seed)` with `composeDrapedPlinth(layout, drape, id)`
  covers it. A host draws this when it withdraws a carving: the plinth keeps its place and size,
  under cloth with domed crown, vertical pleats, a pooled hem and a tied cord, until a new carving is
  unveiled there. The covered form is generic and is shaped only by the old frame **size**, so
  nothing of a withdrawn emote's silhouette survives in public.

## Fixtures

`toadWaveFixture()` is **SIMULATED**: original art drawn for this module, not any channel's emote. It is
deliberately asymmetric: open eye on the viewer's left, wink and tilted crown on the right, and a
waving arm that leaves a gap. It is painted from signed distances using only correctly rounded
arithmetic, so its raster and hash match on every engine. Its `sourceHash` hashes the canonical
RGBA because there are no fetched bytes.

`toadWaveAnimatedFixture()` is the same SIMULATED toad as a real 8-frame GIF89a (about 3 KB), built
by `fixtures/gif-encode.ts`. It exercises the decoder the way chat's GIFs do: a full first frame, then
patches with a transparent index, disposal 3 (restore previous), one interlaced frame and a 0 cs last
delay. It decodes to 8 frames and 5 distinct poses (rest, arm up, mid, high, blink) at
[480, 90, 90, 110, 120, 90, 90, 100] ms. Every frame compiles onto one grid, and the left 45% of the
statue (the side the arm never reaches) is identical in every frame, which proves there is no origin drift.

## Decoding (`decodeEmoteImage`)

`decodeEmoteImage(bytes, declaredFormat, signal)` decodes PNG, GIF and WebP into coalesced
straight-alpha RGBA frames, and hashes the fetched bytes (`sourceHash`, SHA-256). It sniffs the format
from the signature and refuses a mismatch with what the provider declared. It refuses SVG and anything
else, and refuses more than 4 MiB of input. Failures are typed (`corrupt`, `over-budget`,
`unsupported`, `aborted`) and never throw out of the facade. `createEmoteImageDecoder()` is the port
the refresher takes.

**Budgets before allocation.** Every decoder reads its headers first and refuses a canvas or frame over
512×512, more than 120 frames, more than 32 MiB of coalesced RGBA or more than 30 s of playback, before
it inflates or allocates anything. This covers the GIF frame scan, the PNG IHDR, the WebP VP8X/ANIM/ANMF
headers and the VP8/VP8L headers. Inflation is capped at the exact size the header declares, so a
decompression bomb stops at that size. LZW output is bounded by the frame rectangle. The decoders yield
between frames and check the abort signal, so a cancelled job stops promptly. Production runs them on
the compile worker, where termination frees everything.

- **PNG:** every colour type and bit depth, `tRNS`, Adam7, CRC on every chunk. APNG (`acTL`/`fcTL`/
  `fdAT`) is refused as `unsupported`: Twitch serves animation as GIF, and 7TV, BTTV and FFZ serve it as
  WebP or GIF. An unknown critical chunk is refused too.
- **GIF:** GIF89a/87a with global and local palettes, transparency, interlacing, frames clipped to the
  logical screen, and disposal 0/1 (keep), 2 (clear to transparent) and 3 (restore previous).
  Coalescing starts from a transparent canvas, the way browsers render emotes, not from the background
  colour.
- **WebP:** RIFF with `VP8 ` (lossy, RFC 6386 key frames with fancy upsampling), `VP8L` (lossless, all
  four transforms and colour cache), `VP8X` with `ALPH` (raw or VP8L-compressed, every filter),
  `ANIM`/`ANMF` with RFC 9649 non-premultiplied alpha blending and dispose-to-transparent.

Frame delays follow the compiler's timing rule above. The decoders are our own code, written from the
specifications (PNG 1.2, GIF89a, RFC 6386, RFC 9649), with no third-party code. They are checked
against reference output: PNG and GIF against Pillow, bit-exact; VP8L against 30 libwebp vectors plus 3
alpha streams, bit-exact; VP8 against 14 vectors, bit-exact; animated WebP within ±1 of libwebp's
blend. The vectors live in `src/decode/testdata/`. Hostile cases (truncation, bad CRCs, header bombs,
inflate bombs, oversize LZW, random fuzz) all fail with a typed code.

## Catalogues

### Providers (read 2026-10-31)

| Provider | Catalogue | Assets | What we take |
|---|---|---|---|
| Twitch | Helix `GET /chat/emotes?broadcaster_id=` (app token, no pagination, 800 points/min) | `static-cdn.jtvnw.net/emoticons/v2/{id}/{format}/{theme}/{scale}` | URLs built from the response `template`: animated emotes as GIF, static as PNG, scale 3.0 and dark theme when offered |
| 7TV (opt-in) | `7tv.io/v3/users/twitch/{id}` | `cdn.7tv.app/emote/{id}/{n}x.{webp,gif,png}` | Animated prefers WebP, then GIF; static prefers PNG, then WebP; the highest scale the files list under 4 MiB and 120 frames. Zero-width, unlisted and refused-flag emotes are skipped |
| BTTV (opt-in) | `api.betterttv.net/3/cached/users/twitch/{id}` | `cdn.betterttv.net/emote/{id}/3x.{webp,png}` | Channel and shared emotes; modifiers skipped |
| FFZ (opt-in) | `api.frankerfacez.com/v1/room/id/{id}` | `cdn.frankerfacez.com/emote/{id}/{scale}` and `/animated/{scale}.webp` | The animated rendition only when the API lists it; the still PNG otherwise. Modifier and hidden emotes skipped |

Findings that shaped the adapters:
- **7TV.** The v3 REST API is in maintenance, and v4 is GraphQL. v3 still answers, so the adapter reads
  it. 7TV's terms forbid exploiting the service "without express written permission". **Before
  production, Tobias needs written permission from 7TV**; until then 7TV stays off by default, like every
  third-party provider.
- **FFZ.** The terms allow Twitch-related applications. The `/animated/` path hangs for static emotes,
  so it is never guessed.
- **BTTV.** BTTV's CDN sends no CORS headers. That doesn't matter here, because the server fetches it.
- **No provider** sends an emote licence. A channel's own emotes are shown back to its own kingdom, and
  carving them stays behind the monarch's approval and the Safety judges.
- A channel with no account on a third-party provider answers 404. That is an ok, empty catalogue, not
  an outage.

Every list is sorted by provider ID and capped at 256 entries (`truncated` is set when the cap cuts
it). Names must match `^[^\s\p{Cc}]{1,64}$`.

### Checked transport (`createCheckedEmoteTransport`)

The adapters never see a raw `fetch`, only an `AuthorizedEmoteTransport`.
- Catalogue URLs come from `PROVIDER_CATALOGUE_URLS`. Asset URLs must pass `checkAssetUrl`: https
  only, no credentials, port, query or fragment, an exact CDN host from `EMOTE_ASSET_POLICY`, and that
  provider's path pattern.
- Each hostname is resolved, every address must be public (`isPublicAddress` refuses private, loopback,
  link-local, CGNAT, documentation and non-global IPv6), and the request is **pinned** to the checked
  address with SNI kept, so DNS rebinding cannot swap the target after the check.
- At most 3 redirects, each re-checked against the same policy.
- The byte limits are enforced on the stream (4 MiB per asset, 8 MiB per catalogue), never trusting
  `Content-Length`. Timeouts are 10 s.
- Status codes map to typed `EmoteTransportError` kinds: `not-found`, `auth`, `rate-limited`, `timeout`,
  `network`, `policy`, `too-large`, `unavailable`.
- Helix gets its headers from the injected `helixHeaders()`. With no binding, Twitch reads fail as
  `unavailable` instead of being sent unauthenticated.

The Node binding lives in the `@chatdom/emotes/server` entry: `createNodePinnedGet()` (`node:https`
with a lookup pinned to the checked address) and `nodeResolve`. Browsers never fetch emotes.

### Refresh (`createEmoteCatalogueRefresher`)

`refresh(input, signal)` reads every enabled provider, fetches and decodes new or changed assets,
stores them content-addressed in an `EmoteBlobStore` (the memory store checks the hash on put and on
get), and returns a new versioned `EmoteCatalogueSnapshot` plus its changes (`added`, `changed`,
`renamed`, `removed`, `withdrawn`, `unavailable`).
- **An outage is not an empty answer.** A provider that fails is `stale` and keeps its previous entries.
  With nothing to keep, it is `unavailable`. Only an observed answer that no longer lists an emote
  removes it.
- **Off means off.** A third-party provider that isn't opted in gets zero requests, and its earlier
  entries are `withdrawn`.
- An asset that fails to fetch keeps its prior record, if it had one. An entry that claims to be
  animated but decodes to one frame is `unsupported`.
- Overlapping refreshes for one kingdom are coalesced, and `createKingdomJobLimiter` runs at most 2 jobs
  per kingdom. Both honour cancellation.

### Live read

`src/server/live-read.test.ts` is one read-only check through the production transport. It is skipped
unless `CHATDOM_EMOTES_LIVE=1`. It writes only redacted counts to `shots/emotes/live-read-<login>.json`.
On 2026-10-31:
- **tobi4s_** took 1.6 s and 6 requests. Twitch returned 2 PNG emotes, both ready. 7TV, BTTV and FFZ
  were current and empty (404).
- **xqc** took 47.7 s and 328 requests. Twitch returned 67 emotes (62 PNG, 5 GIF). 7TV returned 256
  (truncated, 64 skipped). FFZ returned 1. BTTV was empty. All 324 assets decoded and were ready.

### What main binds

- Register the package in the workspace lockfile (see below).
- Bind the server transport with the Herald's app token as `helixHeaders`.
- Back `EmoteRepository` and `EmoteBlobStore` with durable storage.
- Bind `EmoteReviewPort` to Luna, `EmoteAuthority` to the monarch session and `EmoteKingdomPort` to
  the kingdom record (channel ID, sculpting palette and its revision).
- Feed `onStreamState` from the authoritative stream state and call `tick({kingdomId, atMs}, signal)`
  right after it and whenever `nextAt` (or `nextRefresh(kingdomId).dueAt`) passes. `tick` decides
  Genesis, go-live, opt-in or daily and makes no request when nothing is due. Drain `pendingReveals`
  into the world and acknowledge after the commit.
- After every applied refresh or publication, diff `publicPlacements(kingdomId)` against what the
  scene placed with `diffEmotePlacements` and raise, replace or withdraw. Resolve geometry through
  `publicCatalogue(kingdomId).resolveApprovedEmote(id, purpose)`; a withdrawn statue becomes the
  draped plinth, a withdrawn charge a furled standard. Give the banner/crest owner
  `createEmoteHeraldry` and Genesis `genesisFacts` (checked against the real
  `ChannelGenesisFactsSchema.approvedEmotes`).

## Approval and publication (`createEmoteCatalogueService`)

`createEmoteCatalogueService(ports)` owns the lifecycle from channel to plaza. Its ports are the
capabilities: `repository` (`load` plus atomic `compareAndSwap`), `blobs` (content-addressed), the
authorized `transport`, `decoder`, `review` (Luna), `authority` (`requireMonarch` from the server's
session), `kingdom` (`channelId` and the explicit sculpting `palette` with its revision) and `origin`
(`simulated` for rehearsals; it travels with every source, candidate and reveal).

One statue, step by step:
1. `refresh({kingdomId, reason, atMs})` runs the refresher and reconciles. A different channel ID
   never inherits the previous channel's entries, even through an outage.
2. `selectCandidate({kingdomId, id, purpose, revision}, session)`: the monarch chooses a source.
   `revision` is the **source hash** they were shown, so a source that changed meanwhile is `stale`.
   For a third-party emote this is also the per-emote opt-in. It publishes nothing.
3. `prepareCandidate({kingdomId, id, purpose, atMs})` (server worker): decodes the verified source
   blob, carves it in the kingdom palette and stores the compiled geometry content-addressed. The
   candidate record keeps that blob hash, so the bytes reviewed are the bytes later served.
4. `reviewCandidate({kingdomId, id, purpose, revision, requestId})` (server worker, never a public
   route): renders `renderContactSheets` (front and side of **every** frame, depth-shaded, with a
   1.75 m person marker; PNG, at most 16 sheets of 2048²) and asks Luna. Approval counts only when
   `reviewedGeometryHash` equals the stored geometry hash. Hold, cold and refuse stay private.
   Repeating a `requestId` returns the recorded verdict.
5. `confirmStatue({kingdomId, id, revision}, session)` (or `confirmCandidate` with a purpose): the
   monarch confirms that exact carving. Heraldry needs the same two gates as a statue.
6. `onStreamState({kingdomId, live, epoch, atMs})` comes from the host's authoritative stream state,
   never a browser. Going live publishes every confirmed carving once per epoch; confirming while
   live publishes at once. A newer revision retires the one it replaces.
7. `pendingReveals(kingdomId)` lists statue reveals not yet acknowledged; it survives restarts and
   replays until the host calls `acknowledgeReveal({kingdomId, revealId})` after its world commit
   (idempotent). Heraldry is raised quietly with the statues and has no reveal of its own.

**Approval binding.** A candidate binds source hash, geometry hash, compiler version, palette
revision, purpose and target height. A changed source, an observed removal, a provider switched off,
a new palette revision or a new compiler retires it (`source-changed`, `source-removed`,
`provider-withdrawn`, `palette-changed`, `compiler-changed`); a provider outage does not, so known
safe statues stay up while Twitch is unreachable. Retiring is quiet: it is a state, never a spectacle,
and tombstones keep provenance (at most 256).

**Projections.** `publicCatalogue(kingdomId)` returns an `EmoteCatalogueView`. `resolveApprovedEmote`
serves only published carvings whose binding still holds, loaded from verified blobs and re-checked
(revision, geometry hash, common frame grid). `resolveInlineEmote` serves Twitch's flat rendition as
verified bytes (never a URL); a third-party flat needs its own reviewed receipt and resolves to null
for now. `privateCandidates(kingdomId, session)` is the monarch's plaque. `genesisFacts(kingdomId)`
returns `ChannelGenesisFacts.approvedEmotes` entries (geometry hash plus Luna receipt) for published
statues. Compiled visuals and inline bytes sit in caches bounded by entries and bytes.

Every mutation returns `{status: 'applied', revision}` only after its compare-and-swap commits, or
`{status: 'failed', code}` with `unavailable`, `stale`, `forbidden`, `not-found` or `invalid`. A CAS
conflict reloads and re-evaluates (four attempts).

**Reconciling over the days.** `planEmoteRefresh(state)` is pure: Genesis when nothing was read;
`go-live` once per live epoch (it counts only when Twitch answered); `opt-in` straight after the
monarch switches a provider on; otherwise daily, 24 h after Twitch last answered. A read that leaves
Twitch or an enabled provider without an answer, or fails outright, is retried after 15 min, doubling
to at most 6 h. An outage is never due again at once and never waits a whole day. `tick` runs the
plan; `refresh` commits only after re-checking what moved while the network was busy:
- a newer stored read wins (`stale`);
- a channel that changed throws the read away (`stale`);
- a provider switched off meanwhile is stored `disabled`, and its entries count as `withdrawn`;
- a provider switched on meanwhile is read at the next tick.

The returned `changes` are the committed ones. A carving that retires before the host acknowledged
its reveal has that reveal **withdrawn**: it is never replayed, and acknowledging it is a no-op.
`publicPlacements` carries no reason, so a withdrawal looks the same whether the source changed, left
or was switched off. The service wraps the bound blob store in `verifyEmoteBlobStore`, so it checks
every content address itself on write and on read. Stored bytes that come back different count as
absent, whatever the bound store does.

**Stored state** (`EmoteStoredState`) is plain JSON: provider opt-ins, the catalogue snapshot,
selections, candidates with their review receipts, monarch confirmations, publications and
tombstones, reveals with acknowledgements or withdrawals, the last stream state, refresh time and
the refresh `schedule` (go-live epoch read, pending opt-in, failure count, last attempt; optional
for states stored before it existed). No bytes: source
and compiled blobs are referenced by SHA-256. `createMemoryEmoteRepository` copies through JSON,
is bounded by kingdoms and bytes, and is for tests and the workshop only.

**Heraldry.** `createEmoteHeraldry(visual, kingdomId)` accepts only a visual approved for
`heraldry`, takes the first frame explicitly and returns the charge geometry, its back-centre mount,
its front silhouette for appliqué and provenance. It is a charge to compose, not a finished crest.

## Chat in the world (`createEmoteChatPresentation`, `createEmoteWeather`)

The cue is the shared `CitizenChatCue`; nothing else enters. `receive(cue, atMs, positions)` parses
it, refuses foreign kingdom/epoch/origin, expired, early (more than 2 s ahead), duplicate and absent
cues (a slot not in this frame's `positions` has no body, so it says nothing and never becomes a
person), and keeps only what the cue window needs: the newest bubble and pop per slot, one chant
voice per `emote|slot`, and seen IDs until expiry. No names, no messages after expiry, no archive.

- **Parts.** Twitch emotes come only from fragments (`twitch.<fragment id>`); text stays text and is
  never matched against Twitch names. Third-party names match only through `setThirdParty(map)`: whole
  whitespace-separated words, exact case, never inside URLs, longer words or Twitch fragments. An
  emote resolves through `resolveInlineEmote` (verified bytes, cached per catalogue view); unknown,
  unavailable and retired ones keep their typed words (`visual: null`).
- **Pops.** A message that is exactly one emote and optional whitespace lifts that emote above its
  slot for 2.6 s (never past the cue's expiry) instead of a bubble. Mixed text never pops. The host's
  body, face and behaviour stay authoritative; the gesture is a lifted token with lift, scale and
  opacity at caller time.
- **Chant weather.** At least 3 distinct present slots using one emote within 6 s raise 12 s of
  weather, then that emote rests 20 s from the start. One message counts once per emote, for at most
  4 emotes. At most two motifs; particles 72 + 8 per extra voice, capped at half of 256 (desktop) or
  22 + 3, capped at half of 64 (phone). Weather needs an approved `effect` carving; without one it does
  not rain. Its seed is a hash of the chant's emote, start time and revision. Starting weather spends
  those voices.
- **Deletion and clearing.** `removeCue(id)` drops the bubble, cancels the pending pop and removes the
  uncounted chant voice, and refuses a redelivery. Weather already raining is not undone by one
  deletion. `clearSlot(slot)` drops everything from a slot; `clearEpoch(next?)` drops everything,
  weather and cooldowns included. A catalogue change that retires or replaces the effect revision stops
  its weather on the next frame; `setCatalogue(view)` is how the host passes a new view.
- **Bounds.** 64 bubbles, 16 pops, 1,024 voices, 4,096 seen IDs, 2 weathers, 12 spawn points;
  pruning walks from the oldest entry and stops at the first live one, so a 50,000-cue burst stays
  constant work per cue.
- **Sound.** A receipt carries at most one sound: a weather start, or a pop at most every 280 ms.
  `playEmoteChatSound(audio, sound, {pan, distance})` maps it onto the shared `KingdomAudio.cue`: a
  pop is the `material` tap (stone or glass in turn), a weather the `wave` chord. Mute and mix stay
  with that port.

`emoteWeatherParticles(weather, atMs, matrices, fades)` writes the cloud as column-major matrices in
the space of the positions the host gave (carved emotes about 0.8 m tall lift 2.4–6.2 m above the
head, spread on one breeze and shrink away; emission spreads over the first 5.6 s). `createEmoteWeather(host,
{capacity})` drives one batch per raining revision on the emote's own frame timing and disposes
batches the moment their revision stops raining. A host batch is `{show(frame, matrices, fades, count),
hide(), dispose()}`; the workshop's three.js binding (`apps/web/src/emotes/weather-batch.ts`) is an
instanced clay mesh using the material's per-instance dithered `aLodFade`, plus one additive glint per
carving.

On the web, `apps/web/src/emotes/inline.tsx` draws `EmoteInlineParts`, `EmoteChatBubble` and
`EmoteChatPop` from these projections: text nodes only, images from `blob:` URLs made from verified
bytes (`createInlineEmoteImages`, shared per revision and revoked with the last user), alt text on
every image.

**What main binds.** In `apps/web/src/kingdom/citizen-scene.ts`, call `receive` beside the existing
`receiveChat` with that frame's present slot positions and the kingdom's public catalogue view;
call `removeCue`/`clearEpoch` where `clearChat` runs; draw `frame().bubbles` with
`EmoteInlineParts` in place of the current `static-cdn.jtvnw.net` image URL in the bubble; draw
`frame().gestures` over the speaker; and add `createEmoteWeather` with a batch host on the kingdom's
clay material. Herald's sink already sends sanitized fragments; third-party tokenization needs the
monarch's per-emote opt-in names from the catalogue service.

## Workspace link

`src/deps.ts` reaches `@chatdom/shared` through the sibling source until main registers this package
in the workspace lockfile. Main replaces that one line with the package specifier.
