# Spec 19: a citizen's place, carried on a card

Status: **frozen lane-local card and share-server contract, 2026-10-30.** Ready to branch after main reviews
and commits this handoff. The lane owns working browser and HTTP implementations; main binds the production
auth/router/store ports and kingdom interaction hooks. No new `packages/shared` protocol is declared.
Main creates the branch/worktree; the team starts the worker.
Vision: `chatdom/Moments.md` §2; `chatdom/ChatDom.md` principles 2–5, 15, 17–18 and §4;
`chatdom/World-Tree.md` rule 9, §§3, 10; `chatdom/Atlas.md` §§2.5, 6.2–6.3;
`chatdom/Tech.md` §§7.1, 17; `chatdom/Artstyle-Soul-Feel.md` §§7, 11;
`chatdom/Quality.md` rules 1–3, 7, 14, 17.

## What and why

A four-year quiet viewer should open their card and see that their years have become a place. Their portrait sits
in a brass-and-wood plaque above their name, their street and the plain dates that explain why it is theirs.
The other homes they have chosen to disclose sit together, with a carefully drawn passport, the things they made,
and the games and shared adventures they actually took part in. A house has its own plaque and guestbook.
The same citizen card opens from a person or their home, appears on stream through `!card`, and has a public link
with a beautiful still image. It is public to read without entering the kingdom or signing in. This lane builds
that complete presentation family, public share server, safe projection and guestbook/privacy application
services. Injected repositories supply witnessed history; the lane never manufactures it.

## Current state

- `packages/shared/src/identity.ts:4` defines string `PersonId`/`KingdomId`; `:21` defines `CitizenKey` as their
  pair. Names, logins and house addresses are not identity. Unix-millisecond and text/token schemas already exist.
- `packages/shared/src/presence.ts:39` explicitly says a public visual slot is not a citizen ID, deed, reward or
  proof of tenancy. The public feed has no person ID or tenure. `citizen-chat.ts` is transient witnessed speech,
  with no private archive. Neither is a source for cards, other homes, visits, citizenship or an online badge.
- `apps/web/src/citizens/index.ts:8` provides `CitizenLook`, `CitizenSample` and `createCitizenRenderer()` for the
  actual authored avatar. `packages/shared/src/avatar.ts` and `avatar-cape.ts` describe parts/cloth, not ownership.
  Reuse the real look to render a portrait through a host-supplied image or the existing renderer. Do not invent a
  portrait identity by hashing a visual slot or picking an unrelated default look.
- `apps/web/src/kingdom/index.tsx:55` renders transient speech; `scene.ts:26` projects named visual slots. Main owns
  their interaction/picking, route and all existing kingdom/stream files. There is no card mount or identity bridge.
- `packages/shared/src/forge.ts:39` has `ForgePlacement` with optional **simulated** provenance. Main's local
  `apps/web/src/forge/scene.ts` preserves this across local copies. It is not `ItemCopy`, `ProvenanceV2`, a durable
  LIVE mint or proof of ownership. Show it only as SIMULATED in fixtures; never silently upgrade it to live lineage.
- `packages/shared/src/build.ts` describes draft editing, not deeds, built dates, visitors or published ownership.
  There is no `apps/api/src` implementation, public card/account/passport schema, guestbook service, durable
  tenure store, server share image or `!card` command implementation at this handoff.
- `apps/web/src/main.tsx` is the route integration point; `apps/web/vite.config.ts` owns dev proxies. The lane
  changes neither. Its bench runs through an owned HTML entry and exports a default component for main to mount.
- `work/DECISIONS.md` foundation decision 6 requires privacy/veil/erasure invalidation to reach dependent images
  and cards. A hash or immutable asset location is not publication permission.

## Rules

1. **R1 — One person, a card here.** Bind the displayed card to an actual supplied `CitizenKey`; never resolve a
   person from a name, `slot`, chat colour, item maker token or browser storage. Repeated opens replace the prior
   subject atomically. Ignore stale responses after subject/revision changes or close. King is the broadcaster
   here; a mod is Knight of the Watch, a VIP Noble. A monarch's crown stays home when they are a citizen elsewhere.
   Office and honours are supplied facts; subs, Bits and local UI never assign rank or trust.
2. **R2 — Dates mean what they say.** Show the Twitch name in their supplied chat colour, a readable neutral-ink
   backing if that colour has poor contrast, the real portrait, role, citizen number, home and street. Use plain
   “Following since 14 Feb 2022” and “Subscribed 14 months, Tier 1” when witnessed values exist. Follow date,
   cumulative sub months and active sub tier are separate facts. Missing permission/history is “Not known yet”,
   never “not following”, zero months or a fabricated date. Do not count time from first local render or infer it
   from a cape. A lapsed sub's earned history remains; active tier is not asserted. Format dates consistently in
   UTC without device-timezone day shifts. Preserve long/non-Latin names; no raw IDs as user-facing headings.
3. **R3 — All eligible homes, only on the card.** Show every supplied home, with kingdom, street, house/plot name,
   and a host-provided route. At most three citizen homes; a separately identified own castle does not consume a
   home slot. Before the subject has first signed in, the authoritative projection contains only this kingdom's
   home. This condition concerns the **subject**, not whether the reader is signed in. The lane receives only the
   publishable list, not a full private list plus a browser filter. A guest can have a card without an owned home;
   no card interaction allocates one or moves an existing address. Never add person search or map-wide homes.
4. **R4 — Travels are deliberate disclosure.** Render public passport stamps for both kingdom visits and raids
   ridden, in a designed ink-stamp family with kingdom, kind, date and a road/kingdom link when supplied. A raid
   observation between channels is not proof this person rode it. Repeated visits remain legible without making
   a feed of somebody's location. Hidden travels have no stamp rows, route IDs, kingdom hints or counts in DOM,
   props, accessibility text, image or cached render. “Travels kept private” is enough. No current-location badge,
   friend presence, followed-channel list or audience roster is part of the card.
5. **R5 — A real maker's shelf.** Show forged and imported pieces as small renders of the actual accepted voxel
   objects. A selected piece reveals its supplied story: original maker, first kingdom/date, design/copy lineage
   and importer/source credit where known. Creation, copying, importing and ownership are distinct; an importer
   never acquires original maker credit. No invented cross-kingdom copy totals. Display witnessed game wins and
   Duskscales as keepsakes/honours, with a clear distinction between known zero and unavailable history. No paid
   totals or leaderboard hierarchy. Paginate large shelves/passports without dropping the rest or loading all
   thumbnails at once; pending, empty, unavailable and withdrawn are designed states.
6. **R6 — The home remembers.** The house plaque shows actual built date, installed pieces, visitor count and
   guestbook. Unknown is not zero. Entries are plain escaped text with writer/date supplied by the approved
   projection; no untrusted HTML, URLs rendered as markup, or local moderation heuristics. Only an authenticated,
   permitted writer gets a composer. Pending submission remains pending until the host acknowledges a durable
   accepted entry; rejection preserves their draft privately and offers the supplied safe reason. Never append a
   “published” entry from a timer. Veiled/deleted entries disappear on replacement. This lane neither counts
   visitors nor authors safety/permission decisions.
7. **R7 — One card, three ways to see it.** Export in-world dialog, standalone public page and stream presentation
   modes sharing the same content/layout primitives. Avatar/house opening and `!card @name` resolve through main's
   identity service, never through this component. A house opens the citizen with an obvious House plaque section.
   Stream mode is read-only, hides owner/composer/share controls, and stays inside supplied safe bounds with clear
   name, portrait, home and dates at 1280×720. A large card must not cover the whole show. Main controls when it airs
   and clears; a client request alone never declares it on stream. Modal close restores invoking focus and camera
   input. Keyboard Escape/back, focus containment and touch scrolling work without leaking actions to the world.
8. **R8 — A public link and a still, with the same disclosure.** The host supplies the canonical HTTPS URL and
   current image URL after authorization; copy uses that URL, not an arbitrary location/query/session token.
   Clipboard/share failure offers selectable text, and successful copy is acknowledged only after it resolves.
   Public reading needs no sign-in, Twitch player or WebGL engine. Provide a dedicated 1200×630 image composition
   from the same current safe view, with actual portrait/home image, name, kingdom and tenure. It must read at
   320 px wide. Keep long maker shelves/passports on the linked page; the image does not need every row. Never
   place the identity payload or private data in URL params. A missing/withdrawn card is a small honest public page,
   not a fallback to a different person. The lane emits crawler-visible HTML, canonical and Open Graph/Twitter metadata
   and serves the authorized image; a browser-only metadata mutation is not proof that a share link works.
9. **R9 — Revocation replaces the whole view.** On clear, unavailable, privacy change or withdrawn image, remove
   the prior subject and owned derived images/object URLs, stop pending thumbnail work, and suppress late results.
   Owner-only controls are a separate host capability, never part of a serialized public payload/image. The owner
   switch says “Hide my travels”; show saving/failure and wait for the authoritative replacement before showing
   success. Do not retain card data in localStorage, a service worker, analytics, screenshots named after real
   people or an unbounded in-memory cache. The lane invalidates dependent pages/images; main preserves
   that policy at its production proxy/CDN binding. No client can retract somebody else's already downloaded copy; promise removal from Chatdom's served surfaces.
10. **R10 — Crafted, small and honest.** The plaque uses code/model-rendered wood, brass, parchment and engraved
    details; no image generation, emoji icons, generic dashboard tiles, glass panels or placeholder portraits.
    Reuse the existing licensed Atlas fonts when suitable without copying files. Name/readable facts lead;
    materials serve them. Buttons give immediate pressed/saving response and call the host's existing sound cue;
    do not create an AudioContext. Use restrained page/seal motion and reduced-motion equivalents. Text content is
    semantic DOM; lazy item images need alt text and a designed missing-image state. Cap thumbnail concurrency at
    four and mounted shelf rows at 40. Page mode must render without three.js; load portrait WebGL tooling only in
    the bench or optional host asset generation. A simulation has a prominent SIMULATED label on every mode and
    image; an arbitrary public name never turns it into live evidence.

## Contracts

### Existing frozen inputs only

Consume `CitizenKey`, `PersonId`, `KingdomId` and identity scalar schemas from
`packages/shared/src/identity.ts`; optional real portrait rendering consumes `CitizenLook` from
`apps/web/src/citizens/index.ts` and the existing avatar/content/render pipeline. Existing `ForgePlacement` may
seed only a clearly simulated bench story. Do not change or reinterpret these contracts.

### Exact lane-local interfaces and ownership

Own the runtime-validated source/public types and ports in `apps/api/src/citizen-card/contracts.ts`; web uses
**type-only** imports for the public document/host results. Do not import Node/server code into the client or
export these through `packages/shared`. The following names/semantics are the agreed local boundary. Implement
strict runtime schemas using the existing identity scalars; the worker may choose internal helper names.

- `CardRevision = { person: number; citizen: number }`: nonnegative safe integers. Person revision changes on
  sign-in disclosure, home-list or travel privacy changes; citizen revision changes on this kingdom's card/house
  history or guestbook. Different revisions never silently share rendered output.
- `CardAssetRef = { id: string; revision: number; alt: string }`: bounded token ID, revision and public alt text;
  bytes come only from the approved asset port. No arbitrary URL can reach the server image renderer.
- `CitizenCardDocument` contains `key: CitizenKey`, `kingdomName: string`, `revision: CardRevision`, `origin: 'live' | 'simulated'`,
  `identity: { login: string; name: string; colour: string | null; office: 'monarch' | 'moderator' | 'vip' | null;
  portrait: CardAssetRef | null }`, `tenure: { followedAt: number | null; subscribedMonths: number | null;
  activeTier: 1 | 2 | 3 | null }`, `citizenNumber: number | null`, `address: { home: string; street: string } | null`,
  `homes: readonly CardHome[]`, `castle: CardHome | null`, `passport: { hidden: true } | { hidden: false;
  stamps: CardCollection<CardStamp> }`, `pieces: CardCollection<CardPiece>`, `honours: CardCollection<CardHonour>`,
  and `house: HousePlaqueDocument | null`. Dates use `EpochMs`; null means not witnessed, never a numeric zero.
- `CardHome` has `kingdomId: KingdomId`, `kingdomName: string`, `home: string`, `street: string | null`,
  `image: CardAssetRef | null` and a host-validated same-origin `path: string | null`. Only a castle is separate
  from the at-most-three homes. The server rejects corrupt duplicate/over-cap source records rather than
  silently selecting a person's public homes by array order.
- `CardCollection<T> = { availability: 'known'; entries: readonly T[]; next: string | null } |
  { availability: 'unavailable' }`. Pagination cursors are bounded opaque tokens tied to key/revision/collection;
  collection pages cannot be used to bypass hidden travels or first-sign-in disclosure. A known zero belongs
  inside the relevant `CardHonour`, a known empty collection has zero rows, and unavailable has neither rows nor count.
- `CardStamp` has token `id`, `kind: 'visit' | 'raid'`, `kingdomId`, `kingdomName`, `at: number`, and
  `path: string | null`; `CardPiece` has token `id`, `name`, `kind: 'forged' | 'imported'`, `image`, and explicit
  nullable story fields `makerName`, `kingdomName`, `firstMadeAt`, `originalDesignId`, `copyOf`, `importerName`,
  `sourceCredit`. These are display facts, not executable plans or proof of ownership. `CardHonour` has token
  `id`, `kind: 'game-win' | 'duskscale'`, `name`, known nonnegative `count`, and nullable `at`/`image`.
- `HousePlaqueDocument` has token `id`, `builtAt: number | null`, `visitorCount: number | null`,
  `pieces: CardCollection<CardPiece>`, and `guestbook: CardCollection<GuestbookEntry>`.
  `GuestbookEntry` has token `id`, `writerName: string`, `at: number`, and plain `text: string` (1–500 characters).
  Public entries need no writer person ID, private judge reason or raw rejected text.
- `CardSource` is a trusted **server-only** snapshot: `document: CitizenCardDocument`,
  `subjectFirstSignedInAt: number | null`, `travelsHidden: boolean`, and a bounded dependency list
  `{ assetId: string; revision: number }[]`. It may contain undisclosed homes/passport before projection.
  `projectCard(source)` is lane-owned: filter foreign homes before first sign-in, strip hidden travels including
  counts/cursors, enforce limits and public text/asset validity, and return the safe document. Never serialize
  `CardSource`, rejected guestbook text, owner capabilities or repository metadata into page hydration.

Main binds these injected ports; the lane writes their consumers and a real HTTP fixture adapter:

- `CardRepository.read(key)` supplies a consistent `CardSource | null` from witnessed records, never a visual slot.
  `commitPrivacy({ actor, personId, hideTravels, expectedPersonRevision, commandId })` and
  `commitGuestbook({ actor, key, houseId, text, expectedCitizenRevision, commandId })` return either a durably
  committed source/revision, a conflict/current revision, a forbidden result, or unavailable. Person privacy is
  global to **every** citizen card, not a per-kingdom switch. Commits atomically compare revisions and deduplicate
  command IDs for that actor/operation; retries return the same accepted result. Main implements storage, while
  the lane implements authorization, input normalization, conflict handling and response mapping. Repository
  methods must not acknowledge before durable commit. The owned test adapter uses an atomic temporary-file
  repository and reloads accepted entries/privacy from disk, clearly SIMULATED and outside product storage.
- `CardPrincipalPort.authenticate(request)` returns a verified `PersonId | null`; main's binding validates the
  actual session plus CSRF/origin for mutations. Never read actor from body/query/header chosen by the caller.
  The lane additionally checks privacy actor equals subject, guestbook target exists and the supplied writer
  permission allows this house. `mayWriteGuestbook(actor, key, houseId)` comes from this authenticated port.
- `CardJudge.checkGuestbook({ actor, key, text })` returns `accept` or a private safe rejection/hold; judged
  plain text is the only candidate passed to `commitGuestbook`. The lane handles length/content errors and
  pending/rejected UI; it never publishes before the judge and durable commit agree. Judges never see tokens.
- `CardAssets.read(ref)` returns approved `{ bytes: Uint8Array; mime: 'image/png' | 'image/webp' } | null` for the
  exact current asset revision. `isCurrent(dependencies)` verifies every dependency is still published at that
  revision. Main binds content/media storage; the lane implements public asset transport and invalidation.
- `CardServerOptions` supplies an explicit canonical HTTPS origin, the ports above, bounded clock/log hooks and
  `CardImageRenderer`. Development alone may use the owned runner's explicit loopback HTTP origin.
  Export `createCitizenCardHandler(options)` as a Node request/response handler plus `dispose()`; unowned paths
  return a not-handled result so main can mount it without replacing its router. No API app manifest/root edit.
- `CardImageRenderer.render(document, resolvedAssets)` returns PNG bytes. The lane implements
  `createChromiumCardImageRenderer()` using the existing Playwright installation and its owned HTML/share
  composition, local embedded font bytes and approved asset bytes. Never browse a request-supplied URL.
  One warm browser, one render at a time, bounded queue of four, deadline/abort and explicit disposal. No browser
  launch per visitor, page JS from external origins or indefinite retry. The browser-only public card loads no
  Playwright/three.js. Main's production packaging owns retaining this dependency or binding an equivalent worker;
  the tested default implementation and rendering code belong to this lane.

Web owns `CitizenCard`, `HousePlaque`, `CitizenShareImage`, plus a default bench export from
`apps/web/src/citizen-card/index.tsx`. Its local `CardHost` supplies close/navigation/sound, canonical URLs,
revision-aware collection loading and separate authenticated mutation capabilities. Public and stream hosts
cannot receive owner mutation functions. A request remains pending until the lane service responds with a
committed revision/document; stale results never replace another subject. Fixture UI and HTTP server share the
same safe model/presentation primitives rather than maintaining separate static mockups.

### Public routes and server behavior

Proposed and frozen **within this lane for main review**: `/-/citizens/:kingdomId/:personId`. Both route IDs are
validated decimal strings using existing schemas; IDs survive login changes. The system namespace avoids
colliding with Twitch logins. No person-search/list endpoint. The same subject has:

| Method/path suffix | Lane-owned behavior |
|---|---|
| `GET` base path | Public 200 server-rendered readable HTML, canonical URL, `og:title/description/url/image`, `twitter:card=summary_large_image`, image dimensions/alt, safe card content and optional minimal hydration; no sign-in or JS needed to read it. |
| `GET /data` | Public-safe JSON for that key/revision; named collection/cursor reads return safe bounded pages under the same current disclosure. Never return the raw source. |
| `GET /image.png` | Current authorized 1200×630 PNG. Query `v` may identify an expected revision; stale revision returns unavailable, never an old cached image. The canonical image URL stays revalidatable, never immutable. |
| `GET /asset/:assetId/:revision` | Only a currently published dependency of this card; serve approved bytes, not arbitrary store objects. |
| `POST /privacy` | Authenticated subject-only `{ hideTravels, expectedPersonRevision, commandId }`; acknowledge committed new safe document, conflict or safe error. |
| `POST /guestbook` | Authenticated permitted writer `{ houseId, text, expectedCitizenRevision, commandId }`; judge, commit once, then return projected accepted entry/revision; never echo rejection publicly. |

Missing/withdrawn subjects are 404/410 honest pages without old names/images. Use 400 for invalid inputs, 401/403
for failed identity/permission, 409 for revision conflict, 413 for a body over 8 KiB, 422 for a safe private text
rejection, and 503 for unavailable authority/renderer. Bound body/query/text/cursor sizes and use only escaped
text/validated attribute values in HTML. Private mutation responses are `Cache-Control: no-store`.

Public page/data/image/asset responses also use `Cache-Control: no-store` initially, including errors; do not
invent immutable CDN caching for identity-dependent data. The optional in-process image cache is bounded to
32 MiB and keyed by citizen identity, both revisions and asset dependency fingerprint. Every hit still rereads
current source and validates publication. Privacy/withdrawal changes invalidate affected entries, and each render
checks revisions/dependencies **again after rendering and before writing bytes**. If changed, discard it and
return the current safe result or unavailable; do not leak a late PNG from the earlier projection. The same rule
applies to asset fetch completion. Main's proxy/CDN binding must preserve this policy. No fake success when an
invalidation port is unavailable. Already downloaded copies cannot be recalled.

### Main integration — bindings, not a second implementation

Main supplies the production repository/auth/permission/judge/approved-asset implementations, mounts the handler
on the existing API router, preserves its cache policy, configures canonical origin/runtime packaging, and adapts
actual avatar/house picking plus `!card` scheduling to the exported card. The lane owns route parsing, projection,
HTML/metadata, image rendering/transport/invalidation, pagination and privacy/guestbook application logic. No main
implementation is required to make its owned server demonstrate a real share URL over HTTP. Production acceptance
still needs real bindings; the owned SIMULATED repository proves actual logic, not a claim about live user history.

## Scope

Write only `apps/web/src/citizen-card/**`, `apps/api/src/citizen-card/**`, this spec and
`work/lanes/citizen-card/{PRD.md,progress.txt}`. Everything else is read-only, including root manifests/routes/
proxies, `packages/shared`, API sibling folders, Herald/world/kingdom/stream/citizens/Atlas, other lanes and root
credits. Request dependency/registration changes from main. Do not move files to obtain ownership. You are not
alone: preserve others' work. Owned temporary repository/image/capture output goes under `/tmp` or ignored shots.

The web bench runs through an owned `bench.html` and `bench.tsx` at `/src/citizen-card/bench.html` without root
changes. An owned `apps/api/src/citizen-card/serve.mjs` runner uses Vite `ssrLoadModule()` (as existing capture
scripts do) to load the owned TypeScript handler and bind an explicitly SIMULATED file repository. It listens
only on an explicitly selected available development port 5170–5199; record it and stop only owned processes.
The runner exposes the real stable share route/PNG and mutation handlers, not mocked `fetch()` responses.

## Acceptance

Run `pnpm typecheck`, `pnpm lint`,
`pnpm exec vitest run apps/web/src/citizen-card apps/api/src/citizen-card`, then `pnpm build`.
Keep tests focused on the actual boundaries below; do not grow an exhaustive audit matrix.

1. One meaningful privacy/late-result test loads a pre-sign-in subject, observes local-only homes, signs in through
   trusted repository state, shows eligible homes/passport, then hides travels while a prior image render is
   pending. Assert public JSON/HTML/image never release hidden stamps/counts, the late result is discarded, all
   that person's kingdom cards observe the new person revision, and a late client reply cannot change another
   subject. Include the denied owner mutation in this same scenario.
2. A real HTTP share-flow in the owned capture runner starts the owned handler with a fresh temporary SIMULATED file repository: GET the
   signed-out stable URL and parse server metadata; GET its 1200×630 PNG with a visible SIMULATED label; POST a
   judged guestbook entry as an authenticated permitted fixture writer; retry with the same command ID; restart/
   reload the repository and observe exactly one accepted entry. A denied/unjudged request never appears publicly.
   Change a login in stored history and prove the ID link remains the same subject. No third-party Twitch writes.

Provide `node apps/web/src/citizen-card/capture.mjs`, acquiring
`packages/testing/capture-lock.mjs` before its owned preview/server/browser and releasing after all close. Server
PNG rendering and capture share the same controlled Chromium during this proof, or run serially under that lock;
never start a second independent Chromium beside another lane's capture. Keep Chromium-backed HTTP/PNG work in the owned capture runner, outside Vitest; focused unit tests use injected renderers. Reuse that runner’s browser rather than launching another one. Follow `$look`
Chrome/SwiftShader flags.
Use deterministic labelled fixtures, await fonts/images and meaningful-frame `window.__chatdomReady`, not a fixed
sleep. Store under `shots/citizen-card/` and record exact paths/ports. Exercise product exports, not parallel mocks.

Capture and inspect with `view_image`: desktop 1440×900 and phone 390×844 public card; house/guestbook phone;
stream 1920×1080 and 1280×720; actual HTTP PNG at 1200×630 and its 320 px thumbnail. One contact sheet may cover
local-only/three homes plus own castle, hidden passport, lapsed/unknown sub, long non-Latin name, guest/no home,
empty/unavailable shelf and withdrawn. Tour keyboard close/focus and touch scroll, copy denied, privacy pending/
failure and safe guestbook text while looking; these need no parallel unit-test catalogue. Record console errors,
external requests, bytes and any unreadable material. Do not repeat unrelated town/Forge proof or claim software
rendering timings as device evidence. Main runs `pnpm verify` after integration and checks its real bindings.

## Quality bar

The first visible result is a readable finished plaque, not a form beside a wireframe. Give the portrait, name and
home room to breathe; dates are proud, plain facts. Warm material edges, a small crest and etched marks make it
feel made by this kingdom without turning every row into a panel. Design 390 px first, preserve readable text and
44 px touch targets, and use internal vertical scrolling without horizontal overflow. The maker's real piece and
passport stamps should invite curiosity. Unknown facts and a guest with no home deserve the same care as a full
card. Stream mode is legible over both bright and dark scenes. No generated raster frames or new art dependency.

## References

- `work/references/citizen-motion.md`: public visual slots and real citizen looks are presentation inputs, not
  identity authority; use the existing renderer rather than inventing another avatar system.
- `work/references/atlas-cartography.md`: reuse our original heraldry/font language; public map data never
  becomes a person-tracking surface. Check existing asset licence inventory before reuse.
- `work/references/build-shaping.md`: authored source and derived appearance are distinct; a local draft is not
  a deed or built-date record.
- No new reference engine or external capture is needed: this is a Solid/DOM presentation of existing models.
  Bespoke layout follows Chatdom's own material/art direction. Novel screenshot-service/authority work belongs
  to this lane's injected ports; no new screenshot framework/dependency is required beyond installed Playwright.

## Not now

This lane does not own Twitch scope acquisition, production session verification/history storage, home allocation
or tenure settlement; Atlas people search; raids/travel rewards; guestbook judge policy/model; arbitrary item
minting; Chronicle/Voice generation; deployment/CDN/server configuration or public data harvesting. Main binds
these existing/future authorities. The lane still owns the working safe projection, application services and share
server. No element of Moments §2 is removed or silently simulated as production behavior.

## Decisions

- **2026-10-30:** Spec 19 was unoccupied at handoff. Separate this card presentation folder from the broader
  Chronicle/memory lane in PLAN; main owns production bindings and cross-folder mounts.
- **2026-10-30:** Freeze lane-local web/server contracts together for their first consumer. Existing presence/
  build/Forge contracts cannot be stretched into identity/deed/live lineage. The lane implements the whole share
  server and privacy/guestbook application services through injected main-owned authority/storage bindings; no
  speculative shared catalogue or placeholder main implementation.
- **2026-10-30:** The lane's visible fixture is always SIMULATED, including its still. Complete production card
  acceptance requires the real public URL, server image/metadata, identity opening paths and privacy invalidation.
- **2026-10-30:** Main review expanded ownership to the API citizen-card folder. Six tasks include a working
  local HTTP share link and durable fixture repository. The server is demonstrable now; production binding and
  kingdom hooks are main's integration work, not most of the implementation volume.
