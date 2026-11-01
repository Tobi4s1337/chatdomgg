# PW10 checkpoint — 1 November 2026

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
