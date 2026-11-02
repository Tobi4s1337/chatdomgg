# PW10 checkpoint — 2 November 2026, the window on the You tab dissolves

PW10 is still unticked. Main is still at `0e92df4`, and the Passport provenance seal is still in place on front-door and on the integrator, so the zip fails only on those shared strings, as before. The GPU tunnel was down all session (`chatdom-pc status` exit 3).

## What was below the bar

The last checkpoint's follow-up: the arch on the You tab still swapped the moment a painting arrived. Two things happened at once. When the first painting showing the newcomer's window came in, the drawn lit window was replaced by the painting crop. When a later painting came in, one crop was replaced by the next. That second case happens once a minute, and the window may sit somewhere else in a turned painting.

## Implemented

- `apps/panel/src/dissolve.ts`: one dissolve for both views. `dissolveStep` is the pure rule. A changed picture dissolves over the one before it only when its view is on screen and the viewer has not asked for reduced motion. A change to no picture cuts at once. A first picture fades in only where the view asks for it. `createDissolve` holds the underlay, hides the new image until it has loaded and been drawn for two frames, and drops the underlay when the opacity transition ends. The Kingdom plate now uses it, with the same behaviour as before.
- The arch (`Panel.tsx`, `window.css`) uses it with `fromNothing`. The arch is drawn over lit glass, a warm radial gradient. The crop always covers the arch, so the glass shows only while a painting fades in. The first painting therefore clears out of the lit window instead of cutting in. Later paintings rise over the old crop at its own framing. The ring fades in 1.2 s into the fade, so it never sits on the old crop. Under reduced motion, or if the painting arrives while another tab is open, it swaps at once.

## Verified

- `apps/panel/src` vitest: 12 files and 108 tests passed, including 5 new `dissolveStep` tests. Repository `tsc --noEmit` shows no errors under `apps/panel`. ESLint is clean on the touched files.
- Arch still sequence. Headless Chrome, with no WebGL needed, ran under the shared capture lock, queued for about 25 minutes and held for under a minute. A temporary page, deleted afterwards, mounted the real `Panel` in the lit bench state and swapped in the lane's real painting 02 with its mark (11:1328:8242). Vite ran on 5182 and has been stopped. The new crop's opacity was 0.008 at 120 ms, then 0.48 at 318×496 and 0.55 at 390×844 at about 0.8 s. The ring was at 1 when settled. I looked at `work/evidence/panel-window/PW10/arch/sheet-318x496.png` and `sheet-390x844.png`, which show drawn, clearing, mid and settled. The lit glass reads as the same window opening up. The crop clears through it, and the ring lands on the newcomer's front window only once settled. Nothing clips, and the words are unchanged (lit You stays 11).

## Doubts

- The drawn window is smaller than the arch: 72 px against 112 px at 318, and 96 px against 150 px on a phone. So the first frame of the clearing jumps in size. The lit glass is the same colour, so it reads as the window opening, but on a real GPU it may look like a pop.
- The crop-to-crop case on the arch was not shot, because the lane has only one painting with a mark. It runs through the same code path as the Kingdom plate, whose crossfade was shot last checkpoint.

# PW10 checkpoint — 2 November 2026, the painting dissolves

PW10 is still unticked. Main has not moved since this lane branched (`0e92df4`), and front-door's branch still keeps the Passport provenance seal, so the zip still fails only on those shared strings. The GPU tunnel was down for this whole session (`chatdom-pc status` exit 3).

## What was below the bar

The last checkpoint's doubt was whether a change of picture reads as a cut. It did, in every case: each new painting replaced the last one in a single frame. That happens once a minute while the stream is live, and the painter may also turn the camera 25–75° when a lit window falls outside the hero shot. The adapter also revoked the old painting's blob URL the moment the new one arrived, so the panel had nothing to dissolve from.

## Implemented

- **The adapter keeps the replaced painting readable** (`apps/panel/src/adapters/production.ts`). On each swap it revokes the painting from two swaps back and keeps the one just replaced, so at most two painting blobs are held at once. Both are revoked when the painting becomes unavailable and on disposal. No timers are involved. The contract is written on `Picture.url` in `model.ts`.
- **The plate dissolves** (`Panel.tsx`, `window.css`). When the painting's URL changes while the Kingdom tab is open, the old painting stays underneath as an `aria-hidden` image at its own framing. The new one is hidden until it has loaded and been drawn once (two animation frames), then fades in over 1.8 s while its pan toward the viewer's window runs. The "Yours" mark waits until the picture has settled: it fades in 1.2 s after the fade starts, so the ring never appears over the old painting. When the fade ends, the underlay is removed. Reduced motion, another tab being open, a failed load or a change to no picture all swap at once, as before. The words do not change.
- `pw10-capture.mjs` takes one more still, `tap-kingdom-dissolve`, 700 ms after painting 02 reaches the open panel. It then waits for the dissolve and the mark to settle before taking `lit-kingdom`.

## Verified

- Vitest across `apps/panel/src` (11 files, 103 tests) passed, including the updated adapter tests. They now check that the replaced painting stays readable across one swap, that the painting from two swaps back is revoked, and that disposal revokes both. The minute-refresh test still shows the next minute's painting and no polling while hidden. Repository `tsc --noEmit` shows no errors under `apps/panel`. ESLint on the touched files is clean. `node --check` passes on the capture script.
- `node scripts/public/extension.mjs` builds and still fails only on the two shared simulation strings (viewer and window chunks), with nothing new.
- Dissolve still sequence. The GPU tunnel was down, and nothing here needs WebGL, so headless Chrome ran under the shared capture lock (about 20 minutes queued, under a minute held). A temporary local page, deleted afterwards, mounted the real `Panel` and swapped the lane's own two real paintings: 01 (hero, 06:58) to 02 (+25° turn with the newcomer's mark, 06:59). The Vite server was on 5175 and has been stopped.
  - 650 ms after the swap, the underlay is present and the new painting is at opacity 0.26 (318×496) and 0.24 (390×844). After 4.2 s, the underlay has been removed and the picture and the "Yours" mark are both at opacity 1.
  - I looked at `work/evidence/panel-window/PW10/dissolve/sheet-318.png` and `sheet-390.png` (before, mid and after). The turned painting rises out of the hero shot without a cut. Mid-way, the two castles ghost over each other for a moment. The ring and tag appear only on the settled picture, on the newcomer's front window. Nothing clips, and the words are unchanged (Kingdom 2 visible on this bench page, which has no lights foot; the lane's lit Kingdom stays 12).

## Doubts

- A painting fetched while the You tab is open swaps without a dissolve. The Kingdom tab then shows the new picture when it opens, which is the right moment for it, but the arch crop on the You tab still changes at once.
- The dissolve has only been seen in software rendering. Whether 1.8 s feels calm or slow at panel size should be judged on a real GPU alongside the window glow.

# PW10 checkpoint — 2 November 2026, the window on the You tab

PW10 is still unticked. Main has not moved since this lane branched (`0e92df4`), so the shared Passport patches have not landed and the zip still fails on their strings alone. The GPU tunnel was down again at the start of this session (`chatdom-pc status` exit 3). This session looked again at the You tab, the view a newcomer lands on after the tap, and found three things below the bar.

## What was below the bar

- **The You tab never showed the viewer their own window.** After the tap it drew an icon of a lit window. The real lit window, which the painting already marks, was only on the Kingdom tab.
- **The portrait slot was missing.** The PRD asks for the plate to read "Your window is lit" with the name, the street and a portrait slot that stays empty until a real portrait exists. Only the name and street were there.
- **The phone layout was not thumb-first.** At 390×844 the window icon, the line and the button sat as one small group in the middle of 700 px of parchment.

## Implemented

- **The arch looks into the painting** (`apps/panel/src/window-view.ts`, `Panel.tsx`, `window.css`). While the light is lit and the current painting's reply marks this viewer's slot (the same rule as the Kingdom tab's "Yours" mark), the arch on the You tab shows a crop of that painting. The crop is drawn at 4.2 times the arch's width, which is about the painting's own pixel size, and centred on the window. Near the painting's edge the crop stops at the edge and the ring moves off-centre toward the window, so the arch never shows past the painting. A brass ring with the same slow glow sits on the pane. The arch is a 112 px button (150 px on a phone) whose name is "Your lit window in the painting from <time>. Show the kingdom". Tapping it opens the Kingdom tab. Before the next painting shows the window, or if the picture fails, the drawn lit window stays. The visible words do not change.
- **The portrait slot** is a 30 px brass locket before the name and street. It stays empty parchment until the card carries a real portrait, which then fills it (its own load failure falls back to the empty locket).
- **Thumb-first on tall views** (`min-height: 640px`). The window stands centred in the upper plate and is larger (96×134 drawn, 150 px arch), while the line, the 52 px "Take your place" button and the links sit in a group 44 px above the tab bar. At 318×496 the composition is unchanged and centred.
- `pw10-capture.mjs` takes one more still, `lit-you-painted`, on the You tab after painting 02.

## Verified

- Vitest `apps/panel/src/window-view.test.ts` (4: centred, the corner clamp with the ring still on the window, the newcomer's real mark at 0.1328/0.8242, refusals) plus `apps/panel/src/adapters` (36): 40 passed. Repository `tsc --noEmit` shows no errors under `apps/panel`. ESLint on the three touched files is clean.
- `node scripts/public/extension.mjs` builds; it still fails only on the two shared simulation strings (viewer and window chunks), with nothing new.
- Lane-stack capture `--only tap`, rendered with SwiftShader because the GPU tunnel was down (exit 3). It waited about 10 minutes for two free capture ports, then ran with the realm on 5170 and the stack on 5171, both stopped afterwards.
  - Painting 01 was stored at 0 lights. Tap to lit took 891 ms at 318×496 and 235 ms at 390×844, both confirmed by the realm. Painting 02 was stored at 1 light, with the mark `11:1328:8242` (the +25° turn, as before).
  - I looked at `lit-you-painted` at both sizes. The arch shows the newcomer's own cottage, with its neighbours and the lane behind, and the ring sits on its lit side pane. `lit-you` (before painting 02 reached the panel) shows the drawn lit window and the locket. On the phone, the arch stands in the upper plate and the line, locket and links sit under the thumb. `sharing-you@390x844` puts "Waiting for Twitch…" where the button was.
  - Words: lit You is 11 (head 1, main 10), unchanged, and sharing is 4. None of the 15 stills from this run scrolls, clips or has text under 12 px.

## Doubts

- In SwiftShader the window's own glow is faint, so the ring is doing the work. On a real GPU the crop should show the pane glowing. That still needs judging.
- The empty locket is honest, but it is one more round shape near the arch. If it reads as a missing image to someone new, it could shrink to 24 px.
- The phone layout (`min-height: 640px`) is keyed to the viewport height. A panel iframe taller than 640 px on desktop would also take the thumb-first layout. Twitch panels are at most 500 px tall, so this only reaches the mobile view.

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
