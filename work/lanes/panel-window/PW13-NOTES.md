# PW13 checkpoint — 2 November 2026

PW13 is not complete and its box remains unticked. Earlier goal boxes also remain unticked. This checkpoint continues the first available goal after PW12's recorded repeated disconnected-GPU failures; it does not waive their acceptance bars.

## Implemented

The real Configuration and Live Configuration pages use the shared panel materials. The broadcaster chooses visible You/Gifts tabs, at most eight catalogue gifts and one fixed band each. Kingdom remains the safe entry. Visible Bits amounts come only from valid Helper products. Live Hide pauses new checkout and holds already-paid delivery without erasing obligations. The viewer follows authoritative settings without opening Gifts automatically.

New shared types and strict settings validation feed authenticated API and realm doors. Only a signed, current broadcaster token with linked person equal to channel can save. Connected status comes from actual realm authority. Settings survive restart in migration `0012d_realm_panel_settings.sql`, with compare-and-save revisions, bounded pending saves and unavailable responses for unsupported stored values. The existing realm writer fence and queue serialize founded settings with gift commits; unfounded saves never found a kingdom. Paid receipts stay durable even when settings cannot be read.

The API's PubSub worker watches only public committed evidence, rate-limits/coalesces channel invalidations and disposes its timers and requests. The client uses one Helper subscription, authenticates every reread and keeps five-second polling. Local/test and simulated compositions cannot accidentally publish to Twitch. Health names missing settings without values. An extension-owner ID is explicitly required rather than guessed; the two-value outcome remains open.

Operator tools default to offline dry runs. Product registration refuses released/retired replacement, and webhook subscription checks existing callback/status before creating anything. App tokens validate their client binding. The webhook HMAC is derived privately from the Extension Secret with a fixed purpose string. No credentials or tokens are committed. No operator apply command was run.

## Verification

- 86 focused API/configuration/PubSub/viewer/gift adapter tests passed together; the final production adapter mock typing correction also passed its 30 tests.
- 37 backend checks passed across settings, gifts, realm service/HTTP and API configuration; final corrupt-settings paid-obligation hardening passed all eight settings database tests. These use disposable lane-owned Postgres schemas and the real writer code, never the live schema. New migration discovery requires Vitest `--no-fsModuleCache`.
- Eight Helper harness tests and 14 operator-script tests passed. The operator dry-run tests trap external fetches.
- Panel and realm production builds and the public API SSR build passed. The strict extension packager built its assets but correctly failed the simulation-string check in shared Passport chunks; no uploadable zip is accepted.
- The final local asset graph, including referenced CSS fonts and textures, is 901,462 bytes for Mobile, 901,477 for Panel, 632,658 for Config and 632,663 for Live Config. Twitch's remote Helper and API payloads are outside these local-byte totals.
- Final scoped TypeScript and changed-file ESLint checks passed, including the strengthened browser test. The composed HTTP/broadcast regression rerun passed 13/13 after the optional-field typing fix. No root suite or `pnpm verify` was run on this shared host.
- The real two-panel browser suite passed 2/2 after correcting configuration scrolling. PW12 retains real timers and demonstrates polling. PW13 runs actual Config/Live Config controls, commits Fern's deed and panel observation, saves bands and tabs, pauses/resumes gifts, then delivers a unique bell moment to the witness through a signed local PubSub provider. The witness's clock is paused before navigation so the five-second fallback cannot satisfy this assertion. Observed relay-to-caption latency was 140 ms, below the asserted one second. This excludes Twitch networking and is not proof of live Twitch latency or production effects.
- Browser command: `REALM_DATABASE_TESTS=1 PANEL_BROWSER_TESTS=1 node --env-file=/tmp/panel-window-realm.env node_modules/vitest/vitest.mjs run --no-fsModuleCache apps/api/src/panel/gifts/browser.integration.test.ts`. The final run used realm 5171, API 5172 and panel 5173, all stopped and its disposable schema removed. Parent Vite 5182 was also stopped. The fallback recapture overwrote the same single evidence artifact after the scroll fix, and it was inspected again.

## Visual evidence

One permitted local SwiftShader fallback still is `work/evidence/panel-window/PW13/config@318x496.png`. It was inspected at native size: warm wood, brass switches, readable parchment, clear connected status and tab hierarchy. This is a fixture layout, not proof of Twitch persistence. Its first fold has 41 visible words, excluding decorative glyphs. The long configuration document deliberately scrolls; the viewer's no-scroll first-view rule is unchanged. The first capture exposed an unscrollable frame during the real browser rehearsal; Config now marks its document separately and returns its frame to normal document flow. Lower controls and the Live Configuration views still require the full real-GPU review.

The complete real-GPU batch was attempted with `--wait 30 --max 10` and returned exit 3 immediately because GPU Chrome was disconnected. No queued lease or leased service survived. A busy shared lease is not a PW11 blocker. The batch now includes PW11's street/painter/privacy sequence, PW12's gift states and PW13's config/live-config/band stills at both sizes:

```sh
chatdom-pc-lease --wait 30 --max 10 -- node \
  --env-file=/root/.config/chatdom/atlas.env --env-file=/tmp/panel-window-realm.env \
  apps/panel/scripts/pw12-capture.mjs
```

There is no fps claim: these are static panel views. The batch owns only its documented temporary services, realm 5172, gateway 5191 and panel/harness 5192, with extra free 5170–5186 ports selected by PW11. Do not restart an already queued command.

## Open bars

- The ordered Twitch Configuration Service mirror is not complete: page pre/postchecks detect stale writes but cannot atomically prevent a newer save between check and set. See `PW13-NEEDS.md`.
- The original two-value bootstrap, actual founding link, strict zip, complete screenshots, real Twitch mobile check, production effects and Hosted Test remain open.
- Hosted Test has **not run**. C04's purchase bar remains open. The checklist has 15 steps and ends with the first real test-mode gift.
- Do not describe provider stubs, local signed receipts, fake broadcasts or a test-only effect port as Twitch delivery or production world effects.

Next remains PW13: finish the ordered configuration mirror and bootstrap contract, apply owner seams through their owners, then capture and run Hosted Test when those authorities exist. No new Backlog item was taken.
