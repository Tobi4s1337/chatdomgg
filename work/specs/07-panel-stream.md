# Spec 07: the kingdom under the video, and on the stream

Status: **frozen 2026-10-30; main must install the route hooks below before the worker starts.**
Vision: `chatdom/ChatDom.md` principles 2, 6–9, 15–18 and §5; `chatdom/Twitch.md` §4, §8,
§16–17 and §21; `chatdom/Monarch.md` §3, §6–7 and §13; `chatdom/Quality.md` §2–4;
`chatdom/Artstyle-Soul-Feel.md` §11 and §13. Read each document's Decided list first.

## What and why

Under the video, the kingdom feels close enough to touch: a warm picture, your own window and a little of
tonight's life. The quiet viewer gets the most important action, lighting their window, without having to type.
The panel remains worth opening between streams. It is a compact window into belonging, never a second game client.
On stream, the kingdom is the show: a composed stage at dusk, or a carved corner window and a street along the
bottom. Subjects, light and motion carry the picture at OBS sizes. Labels explain an actual moment, then leave.
The same world appears in both surfaces. No renderer, identity service, tavern game or magic runtime is duplicated.
This lane owns complete presentation and its interaction states, including deliberately SIMULATED demonstrations
of actions whose authoritative services do not exist. It never claims those demonstrations changed a real kingdom.

## Current state

- At draft time `apps/web/src/main.tsx` renders the foundation card for `/panel`; `apps/panel` does not exist.
  Main precreates the panel package and lockfile entries before branching; extend that package rather than replacing it.
- `apps/web/src/kingdom/index.tsx:12` detects `/stream` and hides kingdom controls. Its stream signature is a
  text overlay on the same scene. `apps/web/src/stream` does not exist. Replace this route through main's hook.
- `apps/web/src/kingdom/scene.ts:22` exports `CameraName = 'hero' | 'window'`, `NameLabel`, `SceneOptions` and
  `createKingdomScene`. Its returned instance has `debug`, `setHour`, `setCamera`, `seek`, `capture`, `sound`
  and `dispose`. **`capture(time)` chooses a deterministic scene time; it does not return an image.**
- `apps/web/src/kingdom/presence-feed.ts` supplies the shared `PresenceFeed` implementation, including validated
  live/SIMULATED public frames, stale handling and expected-origin selection. The renderer already consumes it.
- `packages/shared/src/presence.ts` freezes `KingdomPresenceFrame`, `WindowPresenceSchema`, `PresenceFeed`,
  source origins and presence leases. `packages/shared/src/identity.ts` freezes decimal-string `PersonId`,
  `KingdomId` and `CitizenKey`. A window slot is a visual projection, never a deed or a viewer identity.
- `packages/testing/shots.mjs` already captures `/stream` at 1920×1080 and 1280×720 and `/panel` at 318×496.
  Its current assumptions about kingdom debug hooks and bare `/panel` need main's adjustment for these surfaces.
- There is no `apps/api`, Extension EBS, verified viewer session, panel presence endpoint, home/card endpoint,
  snapshot endpoint, authoritative crowd-act endpoint, pool endpoint, Chronicle/Ballad endpoint or Bits receipt
  service. No available presence frame establishes the current viewer's identity, tenure, coals or home ownership.
- No existing shared UI/font/art package is available. Use existing repository assets when present at lane start;
  otherwise small authored code-native fittings and a permission-cleared bundled font belong inside lane scope.
  Do not invent a new global design system or generated art dependency.

## Rules

1. **R1 — Two designed surfaces.** Build a static Solid/TypeScript/Vite Extension app under `apps/panel` with
   `panel.html`, `mobile.html`, `config.html` and `live_config.html`. Export its viewer as the default component
   from `apps/panel/src/Panel.tsx`, with no required props, so main can mount the same view at `/panel` for review.
   Export the default `StreamView` from `apps/web/src/stream/index.tsx`. No route changes belong to this lane.
   Keep Extension assets relative (`base: './'`); load the official Helper as the first script of every Extension
   HTML entry. No remote script substitutes, inline scripts, iframe game/client, Twitch player or second WebGL
   renderer in the panel. A plain browser without the Helper gets a designed connection state, never a crash.
2. **R2 — Make the picture first.** Task PS01 produces a composed 318×496 panel with a framed kingdom picture,
   an unmistakable SIMULATED ribbon, window action and tonight's drawer. Task PS02 produces the distinct stream
   stage/window/strip. Capture the fixture panel picture from **our actual kingdom renderer** through Playwright
   after its readiness flag, as a small WebP or PNG inside `apps/panel/public/`. Record its simulated provenance in
   the adapter/source module. This is a render, not image generation. Do not substitute stock fantasy art, a CSS
   landscape, an empty frame or a fake canvas. A production picture may appear only when an actual adapter supplies
   one; while unavailable, show clear words and a crafted connection state without calling the fixture live.
3. **R3 — The narrow panel has a hierarchy.** At 318×496 retain roughly ten pixels of inner breathing room:
   crest/name and source; the kingdom picture; the personal window action; one useful summary; compact navigation.
   Home, Tonight and Tavern may open one in-frame drawer at a time, with a clear back action. Keep secondary
   detail out of the first view. Drawers can scroll deliberately inside the frame; the default view must not make
   the Twitch iframe scroll horizontally or vertically. Mobile at 390×844 gets an intentional thumb layout,
   44 px targets and portrait/landscape treatment. Long display names wrap intentionally; no raw IDs or clipped
   action text. Parchment, worn brass, wood grain, a restrained seal and readable display/text faces replace the
   foundation card. Avoid glass cards, dashboard tiles, emoji icons and decorative noise.
4. **R4 — Lighting a window is consent, then authority.** Design logged-out, unshared, identity-sharing,
   server-unavailable, unnamed, named, confirmed-present, guest-at-three-homes, resting and disconnected states.
   The choice is “With my name” or “Mine, but unnamed”; both require identity sharing and server confirmation.
   The production Helper may call `actions.requestIdShare()` from a gesture and accept refreshed `onAuthorized`
   tokens into memory. It may report “Twitch connected; the kingdom has not confirmed your light.” It must never
   mark presence confirmed, grant a home or start a presence heartbeat merely because `viewer.id`, `userId`, a
   decoded JWT, a query parameter or local storage says so. `A…` and `U…` opaque IDs are not `PersonId`.
   Missing service is visible: “Your window cannot be lit from the panel yet. Chat still counts.” Do not show a
   success sound or lit-window success animation for this result. Simulated confirmation is allowed only inside
   the visibly SIMULATED adapter and cannot send any real request. Closing/hidden/offline never renews presence.
5. **R5 — A little home, a real night.** The Home drawer presents a compact citizen/home plaque only from the
   selected adapter: window state, named or unnamed preference, place in the street, earned history, and guest
   wording when all three homes are held. Unknown tenure is unknown, never inferred from a slot. Present other
   homes only when a real signed-in card eventually supplies them. Tonight shows supplied factual moments,
   the shared building's carved progress meter and its next benefit, and an offline Ballad/Chronicle **only if
   supplied**. No model-generated retrospective based on public presence. The Tavern drawer names the actual
   table/place represented by its adapter and gives honest watching/seating information, never a fake joined seat.
   Forge stays an explanatory signpost: live-only, earned coals with flat cap three, bounded anvils, private
   refusals. No Forge prompt, door-sign input, arbitrary chat text, game creation or UGC submission in this panel.
   “Walk in” is a secondary link, visibly leaves Twitch, uses a new tab and leads to the kingdom's real entry
   gate; no invented sign-in/home deep link. Missing card/table/night data gets its own clear, lovely empty state.
6. **R6 — Same crowd, same limits.** Design a contextual one-tap crowd act for a supplied vote, errand or earned
   dragon moment, including pending, accepted, rate-limited, ended and unavailable outcomes. These are adapter
   demonstrations until authority exists; fixture actions affect only the fixture. One verified person gets one
   vote and the same command/rate limits as chat. No paid weight, no extra strength, no arbitrary dragon summon.
   The panel cannot read/spend channel points. Pool progress is communal, never personal rewards. Show a Bits
   shelf only with a genuine `isBitsEnabled` signal **and** authoritative product/delivery readiness; absent EBS
   means hidden in production. A fixture can show labelled products, cancellation and a day-long expiry without
   invoking `useBits`. No client receipt, callback or fixture can grant a purchase. Permanent buyer goods,
   tenancy, tenure, coals, rank and brightness are never sold. Refusals remain private and never echo prompts.
7. **R7 — Configuration is understandable and truthful.** Config explains connecting/founding, linking out
   only to a real existing main-owned route. It offers section visibility and the fixed shelf selection as a local
   SIMULATED preview. Live config presents Hide and a content-review availability state. Simulated Hide really
   clears fixture-driven crowd acts and shelf across the fixture model. Without a verified broadcaster service,
   real Hide/save/review commands are unavailable with a reason; no fake saved toast and no “approved” item.
   Helper role/context may guide UI display, but never authorizes a royal or moderation act. Royal powers stay
   monarch-only, and this viewer panel exposes none. Do not build a throne or Watch backend in this lane.
8. **R8 — The stream is its own composition.** `/stream` defaults to a clean stage, with parameters
   `layout=stage|window|strip`, `mood=calm|show` and `seam=starting|break|ending`; reject unknown values to defaults.
   Preserve renderer seed/tier/hour/time/camera/source/presenceOrigin parameters and actual source disclosure.
   Stage is beautiful at 1920×1080 and 1280×720; corner at 480×270 and strip at 1280×180 use close window/street
   subjects, slower motion, almost no text. Frame edges are crafted and thin enough to keep the world dominant.
   Use the existing hero/window camera API; never modify/copy the renderer or invent a moving street/camera API.
   Compose the strip as a deliberate view of the close street, not a compressed overview. If a further camera is
   indispensable, record the exact `needs:` and ask main; keep the finished supported views working.
9. **R9 — Calm and show serve the streamer.** Calm holds a legible subject and gentle motion. Show allows a
   motivated cut between the existing supported compositions, with a minimum eight-second hold and interruptible
   shutter transition; fixture beats can demonstrate a close window coming alight and return to the town.
   Starting shows arrivals; a break tours supplied moments; ending settles on the night town. Never fabricate
   a Ballad, raid procession, dragon or completed scaffold because no corresponding runtime exists. An unavailable
   beat falls back to a good calm shot. Keep broadcaster face/chat space clear by an optional presentation-only
   safe rectangle: fit the canvas and captions inside the remaining rectangular composition area, rather than
   promising renderer-level subject avoidance. Preserve layout dimensions. No royal controls float over the output.
   A standalone preview at `?preview=1` can expose local layout/mood/safe-area controls; label it SIMULATED when
   fixtures are selected, and ensure output mode omits those controls. This is not authorization for real Show,
   Busy, shutter, weather, raids or crowning. Such server-controlled acts are absent until their contracts exist.
10. **R10 — OBS sees only safe facts.** Never show viewer count, lights count, empty seat count, points totals,
    debug counters, Chatdom watermark or tiny numbers on stream. A crest is the kingdom's, not a brand bug.
    One public name can appear briefly at a close-window climax; never extrapolate a name from anonymous slots.
    Suppress labels on stale/disconnected/resting projections. Fixture output always retains a readable
    SIMULATED mark, including the small formats. Real output retains a concise source-loss/resting indication
    when needed. “Earlier tonight” is visible only on supplied, explicitly identified replay material. No raw
    content/holds/refusals enter captions. The renderer's permitted public names are the only live personal text
    this scope can presently consume.
11. **R11 — Pay for one view, only while visible.** Own one `createKingdomScene` instance per stream mount.
    Observe `document.visibilitychange` and OBS `obsSourceVisibleChanged` when present. Dispose the instance
    when hidden and remount when visible; retain local view selection and simulation clock without presenting a
    replay as fresh live evidence. Use the scene's abort signal/dispose path to cancel construction races.
    Do not call `play()` to resume a live source or unlock its UI sound. No duplicate RAF/subscription survives
    a remount. Use actual renderer readiness for `window.__chatdomReady`, and preserve a compatible
    `window.__chatdomKingdom` debug handle for main's evidence runner. Readiness must not declare an error gate
    to be success. WebGL failure has a calm, legible retry treatment.
12. **R12 — Sound belongs to the surface.** The panel gives wood/paper action sounds only after a gesture and
    with a mute control; use tiny procedural variations where no existing shared cue is available. Pending and
    unavailable actions must sound different from confirmed fixture success. The stream must never unlock the
    kingdom's walking/UI sound bus: default output remains quiet because no separate broadcast mix exists yet.
    No browser autoplay claim or silent “audio verified” state. Design an honest mix-unavailable state in preview;
    a future supplied broadcast mix can replace it without UI sound leaking into OBS. No synthesized/generated
    music or Voice of the Realm is required by this presentation lane.
13. **R13 — Every state belongs here.** Loading, stale picture, lost connection, stream resting, missing Helper,
    refused identity consent, absent card, empty tavern, ended act and asset failure all have a clear way forward.
    Snapshot refresh replaces the picture without layout jumps and stops polling while hidden. Production image
    fetches occur only when an actual adapter supplies a permitted URL and refresh policy; there is no guessed
    endpoint. Keyboard focus is deliberately styled; drawers return focus; reduced motion skips shutters but
    preserves state meaning. Helper tokens stay in memory and out of URLs, logs, storage and screenshots.

## Contracts

No new shared contract is required or authorized for this presentation lane. These contracts already exist before
the first consumer starts:

| Existing contract | Use and boundary |
|---|---|
| `packages/shared/src/presence.ts`: `KingdomPresenceFrame`, `PresenceFeed` | Read-only public light/source evidence. Do not expose trusted `PresenceInput` to the browser. |
| `packages/shared/src/identity.ts`: `PersonId`, `KingdomId`, `CitizenKey` | Preserve typed decimal IDs when supplied; never derive them from logins or opaque Extension IDs. |
| `apps/web/src/kingdom/scene.ts`: `SceneOptions`, `CameraName`, returned instance | Main-owned renderer integration. Import read-only; use only its actual methods and callbacks. |
| Twitch official Helper | Request identity consent and receive context/tokens/features. Helper identity/role is display evidence only; a server must verify authority before a real world command. |

The worker defines a **local**, non-exported-across-packages panel view model/adapter inside `apps/panel/src/`.
It represents picture provenance/freshness, light consent/status, supplied home/night/table/pool content and
capability availability. Use discriminated states so “pending” and “unavailable” cannot be mistaken for “accepted”.
Provide a deterministic SIMULATED fixture adapter and an unavailable production adapter; optional real read-only
public presence can use `PresenceFeed`. Separate fixture actions from any production transport. Do not invent
REST URLs, JWT-verification responses, persisted leases, entitlements or future shared message schemas.

Fixtures are selected only by explicit `source=simulated` or by an explicitly marked preview harness. Support
deterministic `state=` cases sufficient for the acceptance captures. A requested real source that is unavailable
must **stay unavailable**; never fall back silently to fixtures. Use the current expected-origin parser for Herald
simulation; transport choice is not proof of live origin. Bare `/panel` is an honest connection/config state.

### Main-owned hooks required before start

1. In `apps/web/src/main.tsx`, lazy-load `./stream` for `/stream`; lazy-load
   `../../panel/src/Panel` for `/panel`. Preserve the kingdom and Atlas routes. Initial lane modules can be
   discovered through `import.meta.glob` like Atlas, so main remains runnable before lane files arrive.
2. Update the foundation capture runner to explicitly request `source=simulated` for its panel and stream fixtures
   and use the new surface readiness
   without treating a connection/error state as the complete fixture panel. Preserve existing kingdom/stream
   debug checks. This belongs to main, not a duplicate root script in the lane.
3. Main precreates `apps/panel/package.json` and integrates `pnpm-lock.yaml` using repository-pinned existing
   Solid/Vite dependencies before branching. The worker extends that scaffold; no version/package-manager bump.

If a requested future production adapter needs server authority, the worker records a concrete `needs:` and
continues with the complete surface and honest unavailable state. Main must freeze/implement the server contract
before enabling its first real consumer. This spec makes no production authentication claim.

## Scope

**May write:** `apps/panel/**`, `apps/web/src/stream/**`, this lane's PRD and progress log. Lane-local capture
and focused behavior tests stay in these folders. Source assets captured from our renderer can live in panel public.

**Read-only:** all other files, especially `packages/shared/**`, `apps/web/src/kingdom/**`, root routes/config,
package lock, testing package and other lanes. Do not change town/castle/home content, upstream renderer lighting,
presence reducer or authoritative identity. You are not alone in this repository; accommodate others' work and
never revert it. No external Twitch writes, Extension publication/review submission, infrastructure or deployment.

## Acceptance

At each task: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` is green. Main runs `pnpm verify` on
integration. Do not create a redundant test catalogue. Add **one meaningful behavior test** for the private action
adapter: unshared/unavailable production cannot become confirmed-present or dispatch a world command, while a
deliberately selected SIMULATED adapter can demonstrate the named/unnamed transition and retains its provenance.
Other interaction checks can share the lane's single Playwright review script rather than become unit-test mirrors.

Provide `node apps/panel/scripts/look.mjs --base-url http://127.0.0.1:5190` for the web-mounted surfaces and
optional `--panel-url http://127.0.0.1:5195` to exercise standalone built Extension entries. It uses the repo's
capture lock/Chrome SwiftShader settings, waits for meaningful readiness, writes `shots/panel-stream/`, and:

- Captures panel logged-out/unshared/named/unnamed/guest/resting/disconnected and Tavern/Forge/act drawer cases
  with `source=simulated` and deterministic state names at 318×496. Include the real unavailable production
  state separately. No iframe overflow, no page/console error. Check representative mobile named/Tavern/resting
  views at 390×844 and 844×390; check the initial static payload is ≤1 MB and excludes three.js.
- Exercises a drawer/back/focus return, named/unnamed fixture light, failed/unavailable real light, ended/rate-limited
  fixture act, and simulated Hide. No real Helper, Bits or world write is needed. Captures the meaningful outcomes.
- Captures stage calm/show at 1920×1080 and 1280×720; starting/break/ending can share a contact sheet. Captures
  window at 480×270 and strip at 1280×180. A safe-area preview capture demonstrates camera/text staying in the
  chosen presentation rectangle. Every fixture output visibly says SIMULATED, with no count/debug/preview controls
  in clean output. Check one live-unavailable stream state rather than claiming a live connection.
- Exercises hide/show during construction and after readiness, verifies disposal and one reconstructed instance,
  and ensures the source label remains truthful. This is a practical browser check, not a frame-rate benchmark.
- Captures config/live-config at 318×496 and mobile width with unavailable real save/Hide and functioning fixture
  preview states; all routes/assets resolve from a nested static base in the standalone build.

Open captures using `$look`/`view_image`; a contact sheet is fine for state variants, but inspect the hero panel,
mobile view and each stream shape at actual size. Retain chosen evidence under `work/evidence/panel-stream/` only
through main at integration, because the lane owns no extra work-document scope. Use ignored `shots/` meanwhile.
Report image paths and the remaining visual doubt. SwiftShader validates pixels/cost counters, never OBS GPU time.
Real-GPU follow-up: compare 1920×1080 stage and small window beside a game in OBS, measure GPU cost and confirm
the hidden source stops drawing; no ≤4 ms/60 fps claim is made on this server.

## Quality bar

Spend depth on the first panel picture, the window coming alight, a legible home plaque, a lovely narrow drawer,
and the silhouette/light/motion of each stream composition. A nine-person hamlet must feel like a cherished place;
a capital reads as a field of belonging, without counting its audience on stream. Wood has direction and depth,
brass catches an edge, parchment carries ink, and controls look pressed into the same material as their frame.
The room picture dominates the panel; the world dominates OBS. Captions stay sparse and readable at 720p.
No copied generic dashboard, fake saved/forged/joined outcomes, rejected-content spectacle or attractive dead button.

## References

- `work/references/herald-presence.md`: consume public projections, retain source/expiry distinctions and keep
  all private identities behind the server. Do not extend its narrow ingestion contract into panel authority.
- `work/references/prototypes.md`, Lanternmere director: take motivated focus/return and cooldown as ideas;
  leave old UI, fake identity, random cinematics and old coals behind. No copied prototype implementation.
- `work/references/sky-fog-time.md`, `voxel-meshing-light.md` and `settlement-streets.md`: the world this lane
  frames already owns these studied rendering/layout techniques. Compose it; do not implement a competing renderer.
- [Twitch Extension design](https://dev.twitch.tv/docs/extensions/designing/): 318×496 framing and offline value.
- [Twitch Helper reference](https://dev.twitch.tv/docs/extensions/reference/): consent, refreshed authorization,
  features and context; opaque identity never establishes an authoritative Chatdom person.
- [Twitch Extension policies](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/): mobile initial
  payload, identity-linked UGC and external-link treatment. Checked 2026-10-30 alongside the local Twitch skills.

No new open-source rendering/motion system is being specified here; the lane composes existing renderer work and
uses the official Helper. If a new library or copied technique becomes necessary, study/license it before use and
ask main for any attribution outside lane scope. Generated paintings belong to a separate art brief, not this lane.

## Not now

This lane does not implement the authoritative systems whose results it displays: Extension JWT/EBS, persisted
panel presence, actual household/tenure allocation, cards/passports, game seats, Forge generation/moderation,
crowd/poll/points commands, Bits receipts/entitlements, director event ingest, Ballad/Chronicle generation, snapshot
publication or a broadcast audio mixer. It does not build the throne, Stream Deck, OBS scene switching or replay
recorder. These are ownership boundaries, not permission to fake their result or leave the designed state blank.
The existing supported kingdom renderer, complete adapters and explicit unavailable production states make every
surface reviewable now. Enabling a real command later requires main's frozen consumer contract first.

## Decisions

- **2026-10-30:** Freeze presentation on existing public-presence/identity contracts. The current repo cannot
  authorize a panel viewer or accept a real panel command; opaque IDs, client JWT parsing and fixtures cannot
  bridge that gap. Real mutation affordances disclose their missing service while the full interaction can be
  demonstrated under SIMULATED. No invented future server protocol is a lane dependency.
- **2026-10-30:** Presence is a warm **window**, overriding earlier open lantern/candle wording. Tier tint never
  increases brightness, size or standing. The stage never shows audience/light totals; the panel may show a public
  observed count only with its actual freshness and coverage, never an all-viewers claim.
- **2026-10-30:** Reuse the exported renderer as it exists. Hidden OBS sources dispose/remount rather than
  requiring an unimplemented renderer pause API. Safe areas are presentation rectangles, not a promised director.
- **2026-10-30:** Panel art is an actual still from our rendered simulated kingdom, labelled accordingly; production
  cannot silently use that still as tonight's real kingdom. The lane creates no generated illustration dependency.
