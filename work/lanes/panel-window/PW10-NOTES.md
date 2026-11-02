# PW10 checkpoint — 2 November 2026, occlusion and framing

PW10 is still unticked. This session took the reviewer's follow-up, "check occlusion and framing changes in dense kingdoms". The check found two real faults in the last checkpoint, and both are fixed.

## What was wrong

- **The "Yours" ring sat on glass nobody could see.** Slot 11's first pane faces east. From the hero eye at (-65, 40, 128) that glass at (-65.5, 10, 84) is edge-on: the dot product of its outward normal with the line to the eye is 0.5 m. The ring in the last painting sat on the edge of the house, not on a lit window. Nothing checked whether the pane faced the camera or was hidden.
- **Widening moved the camera in, not out.** `captureView()` puts its target only 16 m in front of the eye. The old widening stepped back 1 to 3.4 times the eye-to-target distance from a point halfway to the town, so the "wider" shot stood 16 to 54 m from that point, closer than the hero. The unit test had used a target 140 m away and so never showed it.

## Implemented

- **Sightline** (`apps/web/src/panel-painter/windows.ts` `createSight`). This is a ray from the eye to the glass, lifted 6 cm off the pane. It is tested against the voxel boxes of every placement the renderer draws: homes, civic buildings, props and trees, from `foundedContent(...).content`. Each placement is rejected first by its bounding sphere, then by its local bounds. The ray is also tested over the land (`terrainHeight`), read on a 1 m lattice and remembered. Each 8 m tile gets a ceiling from five samples plus 4 m, so the exact land is read only where the line runs low. Authored panes sit in a recess inside their own wall, and the probe showed every house hiding its own glass. So the building whose bounds hold the glass is left out of its own sightline.
- **Facing.** `paintedWindows` leaves out glass whose outward normal (same table as `createWindowLights`) faces away from the eye, and, given a sightline, glass that is hidden. Its signature only gained an optional `sight`.
- **Framing** (`paintingView`). The hero shot stays when every lit window shows in it, and on an empty night. Otherwise the page tries the hero composition turned around the keep (`plan.castle.centre` + 12 m) by 0, ±25, ±50 and ±75 degrees. Each turn is re-centred on the facing lit glass and the keep, and starts at the shot's own distance along its own line before stepping back. A turn is skipped if its eye is less than 4 m above the land, if a hill hides the keep or if the castle leaves the frame. The turn that shows the most lit glass wins, and the nearer turn wins a tie. When no turn shows more than the hero, the hero stays.
- The painter page passes `{ castle, sight, ground }` to both calls. The renderer is untouched.

## Verified

- A probe against the lane's two real founded scenes (13 homes; 162 and 227 placements), with the renderer's real hamlet hero (market + (-65, 31, 118), looking at the castle):
  - A first sightline that did not leave out the host building hid 10 of the 13 panes behind their own walls. With the host left out, the hero sees slots 2, 3, 4, 6 and the royal window. The rest face away or sit behind the next home down the slope, for example slot 1 behind 3, 5 and 7, and slot 10 behind 11.
  - Slot 11 alone: the hero shows nothing. The +25° turn shows it at (0.13, 0.82) with the keep in frame (eye (-38, 31, 136)).
  - Slot 0 alone: the −25° turn. Slots 1, 3 and 5: the +25° turn shows 2 of 3.
  - All 13 lit: the +50° turn shows 9, where the hero shows 4–5.
  - Framing takes 70–120 ms on a warm land cache, and 300–700 ms the first time.
- Vitest `apps/web/src/panel-painter`: 9 passed. Four of them are new: a recessed window is marked, while one behind a neighbour's wall, behind a hill or turned away is not; land reads are remembered across 50 sightlines; the turn to a newcomer whose glass faces away keeps the castle; and a buried home keeps the hero. The existing edge-of-town widening test still passes with direction kept.
- `node --test` painter runner and policy: 8 passed. Focused `tsc` over the painter and `eslint apps/web/src/panel-painter` are clean.
- Lane-stack capture `--only tap`, rendered with SwiftShader because the GPU tunnel was down (`chatdom-pc status` exit 3):
  - Painting 01 at 0 lights kept the hero shot.
  - Tap to lit took 1418 ms at 318×496 and 370 ms at 390×844, both confirmed by the realm.
  - Painting 02 at 1 light took the +25° turn and lists `11:1328:8242`, which is what the offline probe predicted. The WebP is 30.9 KB.
  - I looked at painting 02, `lit-kingdom@318x496` and `lit-kingdom@390x844`. The ring and the "Yours" tag sit on the edge home's front window, the one facing the camera. At 318×496 the castle still crowns the picture. At 390×844 the panel pans to the window, so the castle crops out at the right edge, as before.
  - Word counts are unchanged: lit Kingdom 12, walk-in 11, lit You 11, card 46 and Gifts 10.
  - The first attempt this session lost painting 02 when the SwiftShader page closed under host load (load average about 23). The real error was hidden behind dev-server noise. The runner's page notes now skip the dev server's own error forwarding. The capture now waits up to 150 s for a light left over from the previous run to lapse, instead of stopping.

## Doubts

- Thin occluders count as solid: a lamp post's box or a fence can hide a pane by a hair. Partly hidden glass is judged by its centre only.
- The land ceiling assumes the land rises at most 4 m inside an 8 m tile above its corners and centre. A sharper ridge could let a mark through.
- The picture may now turn by 25–75° from one minute to the next as lights come and go. A turn is chosen only when it shows more lit glass than the hero does. Whether the panel's change of picture reads as a cut needs a real-GPU look.
- Walkers and citizens are not occluders.

# PW10 checkpoint — 2 November 2026, morning

PW10 is still unticked. This session closed the doubt from the last checkpoint ("the lit window is hard to distinguish in the painting"). The cause was not the glow: the viewer's window was never in the picture.

## What was wrong

The lane kingdom is a hamlet of 13 homes. The first person to take a place was given slot 11, at the edge of town, where allocation puts newcomers. The renderer's hero shot frames slots 0–9 and the castle; slots 10 and 11 fall below and beside the frame. So the painting made after the tap could not show that person's window, however it was lit. On a real GPU it would have been just as invisible.

## Implemented

- **The painting holds every lit window.** `apps/web/src/panel-painter/windows.ts` `paintingView()` starts from the renderer's own hero view (`captureView()`). When every lit window already sits inside 82% of the frame, the hero shot is kept unchanged, and so is an empty night. Otherwise the painter keeps the hero's direction and field of view, eases its aim halfway toward the lit homes and steps back in 10% steps, up to 3.4 times the distance, until the castle the hero aimed at and every lit window fit. It applies this through the scene's existing `pose()`. The page settles on the hero, re-poses once if needed and waits for a fresh, settled frame. The renderer is unchanged.
- **The painting knows where its lit windows are.** The page projects the first authored pane of each present house through the frozen frame's camera. That is the same pane `createWindowLights` makes glow, using the same public houses (`foundedContent` plus the royal window). The runner sends the list as `X-Chatdom-Windows: slot:x:y,…` in ten-thousandths of the frame. It is strict, at most 400 entries, with no duplicate slots, and malformed lists are refused at both ends. The evidence directory also gets `kingdom-<id>.windows.txt`.
- **The API keeps the marks with the picture.** `pictures.ts` stores `windows` beside the WebP. The kingdom reply lists them under `picture.windows`. `/picture` names its bytes' revision in `x-chatdom-revision`, which is exposed to the extension origin. Sketch uploads may not carry windows.
- **The realm tells the viewer only their own slot, only while lit.** The panel door's presence reply gains `slot` when `lit` is true. The API passes it through on `/light` and `/presence`.
- **The panel marks "Yours".** The adapter keeps the viewer's slot from the realm's lit answer. It marks a picture only when the light is lit, this painting's reply lists that slot, and the fetched bytes' revision matches that reply. Newer bytes carry no mark until a reply describes them. On the plate, the picture pans to the window (`object-position` at the mark's own fraction, so the point stays in frame at every size) with a 1.4 s ease. A brass ring with a slow warm glow sits on the pane, under a small parchment tag that reads "Yours". The motion stops under reduced motion. The image's alt text adds "Your lit window is marked." The tag flips below or to the side near the frame's edges.

## Verified

- Focused TypeScript over the panel, panel API, painter and realm panel door, and lint on every touched file, are clean.
- Vitest across `apps/panel`, `apps/api/src/panel` and `apps/web/src/panel-painter`: 154 passed, plus 2 Postgres-gated tests skipped. `node --test` painter policy and runner: 8 passed. The new tests cover the projection (centre, pane rotation, frame and behind-camera culling), keeping the hero shot and widening it for an edge-of-town window at this lane's real coordinates (castle kept, direction kept), the strict header, upload, storage and the reply, the revision header, and the panel's mark rules (no mark before the painting shows it, a mark after, none on mismatched bytes, none while resting, malformed lists refused).
- Realm panel door against dev Postgres (disposable `panel_window_test_*` schema): 8 of 8, including the new own-slot check.
- Lane-stack capture, SwiftShader because the GPU tunnel was down again (`chatdom-pc status` exit 3): painting 01 at 0 lights, hero shot, "0 lit windows in frame". Tap to lit took 1522 ms at 318×496 and 1267 ms at 390×844, both confirmed by the realm (an earlier run this session took 1458 and 898 ms). Painting 02 at 1 light reads "1 lit window in frame", `11:3040:9061`, about 23 KB. The open panel replaced its picture and shows the mark at both sizes. I looked at painting 02 and at `lit-kingdom`, `tap-kingdom-before` and the other tap stills at both sizes. The new home is clearly in the foreground, the castle still crowns the picture, and the ring sits on the glowing side pane.
- Word counts from this capture: lit Kingdom is now 12 (the tag adds "Yours"), walk-in 11, lit You 11, sharing 4, Gifts 10 and card 46. The other states are unchanged from the earlier matrix. No still scrolls, clips or has text under 12 px.
- `node scripts/public/extension.mjs` still fails only on shared-owner strings: the provenance words in `packages/ui` and the `live|simulated` enum in the shared Passport schema. Nothing added this session appears in the findings.

## Doubts

- Occlusion is not tested. A lit pane hidden behind another house would still be marked. Homes on the hamlet slope do not hide one another in this framing, but a dense town might.
- The framing jumps between the hero shot and a wider shot from one minute to the next when an edge-of-town window lights or dims. That is honest, and it is quiet at panel size, but a real-GPU look would tell whether it reads as a cut.
- The mark sits close to the time caption when a home is at the bottom edge (y ≈ 0.91). They do not overlap.
- Finding for main (outside this lane's scope): vitest's default `fsModuleCache` (`node_modules/.vitest-cache`) keeps the transformed `apps/realm/src/persistence/migrate.ts` with a stale `import.meta.glob`. Freshly added migrations (here 0012b–0012e) are not applied in tests, and every panel door test that reads settings fails with "relation realm_panel_settings does not exist". Running with `--fsModuleCache=false`, or clearing the cache, fixes it. Repository-wide, `fsModuleCache: false` in `vitest.config.ts` (or a cache key including the migration list) would prevent the false red.

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
