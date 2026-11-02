# PW10 checkpoint — 2 November 2026

PW10 is still unticked. The browser path from tap to lit window to painting now runs end to end on the lane stack, with stills at both sizes. Four things are still outside this lane: real-GPU stills, the accepted zip, guest windows and the waiting-land painting.

## Implemented this session

- Kingdom tab foot: one quiet row reads the lights count and the moment, with a 44 px "Walk in ↗" button. Tapping it opens a "Leaves Twitch for chatdom.gg" line plus Kingdom, Tavern and Forge links. Each has an aria-label saying it leaves Twitch. Switching tabs closes it again. The foot shows only once the panel has lights, a moment or a gate. The picture caption is a brush mark and the time, with "Painted at …" as its accessible name.
- Unfounded channels: the kingdom route carries the streamer's display name, but only for unfounded channels and up to 25 characters. The header reads "<streamer>'s land" and the nudge reads "Tell <streamer> their kingdom is waiting".
- Moment lines were shortened so the Kingdom foot fits one row at 318 px (for example "Raiders at the gate", "A home is raised").
- The You tab's plate links "Privacy ›" and "Your card ›". Their accessible names are "Your privacy" and "Your citizen card".
- The Kingdom foot never tells anything stale. If the kingdom cannot be read, it says "Out of reach since <time of the last good read>". While the stream rests, it says "Resting" (with a dimmed dot) instead of a lights count that would always be 0.
- Unfounded channels: the Kingdom tab says "No kingdom here yet" instead of the out-of-reach line. Once pledged, the You tab reads "Your tent waits". Out of reach on the You tab reads "Out of reach for now". These keep every first view at 12 words or fewer.
- Card text that was 11.5 px (portrait slot, fact labels, portrait note) is now 12 px.
- Painter: failures carry a reason (first line, bearer redacted, at most 400 characters), and page errors are collected for the runner log. A refusal now explains itself instead of reading "renderer refused".
- Helper substitute: `share=hold` keeps Twitch's identity prompt open until the operator grants or declines it, so the "sharing" state is captured for real.
- `apps/api/src/panel/serve.mjs` exports `createLaneGateway`, so the panel stack can mount the real gateway in-process. Its CLI mode is unchanged.
- `apps/panel/scripts/pw10-stack.mjs` is one loopback host for the panel views, the painter page, the Helper substitute, `/api/panel/*` (real gateway) and `/api/realm/*` (lane realm).
- `apps/panel/scripts/pw10-capture.mjs` is the full lane-stack capture. It starts the lane realm and stack on two free capture ports, takes Twitch IDs from Helix and drives herald stream live/offline through the realm ingress. It paints with the real runner inside its own lock hold and records the words, scrolling, clipping and sub-12 px text for every still in `work/evidence/panel-window/PW10/capture.json`.

## Verified this session

- Focused TypeScript over `apps/panel/src` and `apps/api/src/panel` passes, and so does lint on every touched file.
- Vitest across `apps/panel`, `apps/api/src/panel` and `apps/web/src/panel-painter`: 147 passed. New tests cover the unfounded streamer name, the next minute's painting replacing the blob URL, and zero sends for five minutes while the panel is hidden.
- `node --test` painter runner and Helper: 12 passed, including the held identity prompt.
- Browser capture against the lane realm, the real gateway and the real painter, rendered with SwiftShader (the GPU tunnel was disconnected all session):
  - Tap to lit at 318×496: 1401 ms, with the realm's presence frame confirming the window. A repeat tap at 390×844 took 227 ms and stayed idempotent. Both are under the 5 s bar. The earlier runs took 869–1373 ms and 246–478 ms.
  - Painting 01 was stored at 0 lights before the tap. Painting 02 was made by the runner while the viewer was present, stored at 1 light, and replaced the Kingdom picture in the open panel. Each WebP is about 19 KB at 636×400, well under 60 KiB. Each SwiftShader painting takes about 48 s.
  - Word counts for Kingdom/You (head and main, without the tab bar), identical at both sizes: outside 9/7; logged out 11/9; unshared 11/4; sharing 4; lit 11/11; walk-in open 10; gifts 10; held 11/9; unfounded 6/12, pledged 12; resting 10/11; out of reach 11/12. The card is one tap deeper and allowed to say more (46). Across the 49 records, no still scrolls, none clips and none has text under 12 px.
- I looked at every still at 318×496 and 390×844 (`work/evidence/panel-window/PW10/*.png`).

## Doubts and gaps

- In SwiftShader, painting 02 differs from painting 01 only in moving clouds and a few warm specks near the market. The single lit window is not obvious at panel size. The light count is real (realm presence), but judging the glow needs the real-GPU still.
- The early-morning paintings (4:20 and 5:57 AM shared-clock hour) render a mauve pre-dawn sky. That is the kingdom renderer's hour look; it is not the panel's to change.
- The guest-at-three-homes state needs a second founded kingdom; the lane stack has one. Realm integration tests cover the cap and the honest guest result. needs: integrator bind guest public windows.
- The unfounded Kingdom tab shows a calm absence, not waiting land. needs: grand-world bare waiting-land render (see the shared-kit request below).
- `node scripts/public/extension.mjs` still rejects the zip, only on shared strings: `packages/ui/src/provenance.ts` through the passport Book, and the `live|simulated` origin enum in `packages/shared/src/passport.ts`. needs: main/front-door apply PW13-PASSPORT-NEEDS.patch then PW13-PASSPORT-PANEL.patch.

- Finding for main (outside this lane's scope): while the realm boots, `apps/realm/src/main.ts` holds its port with a reservation socket server. That server accepts connections and never answers, and `close()` waits for them. A readiness probe sent during boot therefore stalls the boot itself. The probe's connection holds the release, and the realm never listens until the client gives up. Repeated by-hand starts stalled about one time in three or four; after waiting for the listening line, 10 of 10 were ready in under 3 s. The capture now waits for the realm's "realm on <port>:" line before probing. A one-line realm fix would let other probes stop waiting: destroy each socket the reservation accepts.

## Reproduction

```
node --env-file=/tmp/panel-window-realm.env --env-file=$HOME/.config/chatdom/atlas.env \
  apps/panel/scripts/pw10-capture.mjs [--gpu] [--only states,tap,held,unfounded,resting,reach]
```

Build the realm first (`apps/realm/dist/realm.mjs`). Without `--gpu` the capture picks two free capture ports (5198/5199 first). With `--gpu` the stack takes the lease port 5192 and connects to the tunnel's Chrome at 127.0.0.1:9333, so run it inside `chatdom-pc-lease`. `--only` without `tap` skips the paintings. The capture has two lock holds, each about two minutes. Give it a long enough outer timeout to wait in the queue between them. A painting that fails is tried once more, as the live painter would on its next pass. The runner names a page crash in its reason. A stream heartbeat miss is logged, and the run aborts only after three misses in a row, before the 180 s lease could lapse. `capture.json` is saved after every entry and merged by still, painting and tap name, so a partial run keeps what it proved. Every run sends stream offline and stops its children on exit or interrupt.

# PW10 checkpoint — 1 November 2026 (earlier)

PW10 is not done and its box remains unticked. No visual result has been accepted.

## Implemented

- Kingdom, You and Gifts share one framed panel. Identity sharing continues the original join gesture only after refreshed authorization. Logged-out and unshared tokens cannot write.
- The API wraps the existing reading/passport routes. New light, presence, kingdom, private pledge and authenticated painting routes verify the Extension JWT; only its channel and linked person select records. The realm verifies the internal service credential separately.
- Claim composes the existing settlement and allocation services. It preserves unknown tenure, the three-home cap, idempotency and native monarch keep binding. Panel observations enter the existing durable ingress, and light success waits for committed realm evidence.
- The painter mounts the existing renderer with exact approved realm scene bytes, committed public windows and the shared clock. Its runner holds one warm page per active kingdom, bounds WebP output to 60 KiB and uploads atomically. The Extension fetches pictures using an authorization header, then a memory-only blob URL.
- Fixtures have no viewer entry selector and only a separate development bench. Configuration has an honest unavailable state until PW13 connects its authority. The zip rejects fixture code, visible simulation labels and renderer code.

## Verified

- 43 focused panel/API tests passed after the final changes.
- 11 realm panel tests passed, including isolated development Postgres, actual allocator/native furnishing/writer/ingress, moderation, repeated claim, cap, keep and persistent pledge.
- Seven painter scheduling/orchestration tests and two Helper harness tests passed.
- Focused TypeScript and lint checks passed. Panel, realm and public gateway SSR builds passed.
- A real isolated realm and panel gateway ran on ports 5172 and 5171. The panel and Helper harness ran on 5170 and 5173. The browser test passed authenticated reads for logged-out, unshared and shared identities and checked that tokens stayed out of DOM, URLs, storage and logs.
- All four lane servers were stopped. Nothing on the live ports or schemas was changed.

## Not demonstrated

- No screenshot exists for this checkpoint. The real-GPU tunnel was connected, but three immediate lease attempts returned exit 75 because another lane held it. The repeated-failure rule ended this iteration. A busy lease is not the tunnel-down exception permitting a software-rendered still.
- No browser tap-to-deed-and-painted-window sequence was run. Service tests demonstrate the backend separately; do not describe that as the complete browser path.
- No word counts, full join-state still matrix, minute browser painting refresh proof or visual quality judgment has been recorded.
- The extension zip correctly fails its new label guard: shared passport components still import the shared provenance label and legacy origin discriminants. The Vite asset build succeeds, but the uploadable zip is not accepted. The guard is case-insensitive, so protocol field names must also leave the production-only entry before it can pass.
- Existing guests have no public window binding. Their API result cannot truthfully claim a lit rendered window.
- The current renderer always includes civic buildings, so it cannot honestly paint unfounded waiting land. The panel shows an absence rather than substituted scenery.

## Reproduction and continuation

Private lane configuration is outside the repo at `/tmp/panel-window-realm.env`. It contains only development Postgres on 127.0.0.1:5410, schema `panel_window`, lane-generated credentials and the approved public channel ID/name. Public Twitch app credentials remain in their existing external file. Never print either file.

The lane schema has a real generator plan seeded by the channel ID, adopted through allocation, and native scene artifacts in `/tmp/panel-window-founded`. These are isolated lane records, not the live realm. Temporary tests use disposable `panel_window_test_*` schemas.

Run a fresh realm build before starting `apps/realm/dist/realm.mjs` with the lane environment. Run `apps/api/src/panel/serve.mjs` with the lane environment and the existing external Twitch app environment. The gateway only accepts the development database and `panel_window` schema.

The reusable local harness is `apps/panel/scripts/pw10-harness.mjs`; its secret file must match the gateway's Extension secret. `apps/panel/scripts/pw10-browser.mjs` takes `PANEL_TEST_GATEWAY`, `PANEL_HARNESS_URL`, `PANEL_TEST_CHANNEL` and `PANEL_TEST_USER`. Use matching localhost/127.0.0.1 origins in the build and the browser test.

A prepared, unstarted lease orchestration module is `/tmp/pw10-painter-lease.mjs`. It owns only temporary web 5182 and harness 5192, uses the same-origin API proxy, runs the painter against real public state through the GPU tunnel, fails without an actual painting and stops its children. Check its ports are free before running. The painter's README documents its permanent command and options.

Per the user's repeated-failure instruction, the next iteration may move to PW11 while PW10 stays recorded as blocked. Revisit this goal before any claim that the lane is complete.

## Exact shared-kit request

needs: front-door In `packages/ui/src/passport/Book.tsx`, remove the `ProvenanceSeal` import and the two simulation-only seal branches; in `packages/ui/src/passport/Reading.tsx`, remove that import and its closed-book simulation-only seal branch, preserving existing exported names. Add a production-only passport entry which reuses the book/reading layout with live-only source validation and omits the legacy simulation origin/prop from emitted runtime code. The panel can then import that entry instead of the general bench-capable `@chatdom/ui/passport`. Merely hiding labels with CSS does not satisfy the zip check. Local protocol aliases in the panel also require removal once that entry exists.

needs: grand-world The guarded waiting-land dispatch and required owner implementation are specified as a proposed diff in `apps/web/src/panel-painter/README.md`. Never substitute a founded kingdom or a generated illustration for unfounded land.
