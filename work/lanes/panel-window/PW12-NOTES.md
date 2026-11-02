# PW12 — durable gifts checkpoint

PW12 remains unchecked. The catalogue, viewer flow, payment verification, durable realm ledger and recovery are real
implementations. Production gifts remain closed because no product-specific world/stream effect authority is mounted.
Neither the fixture bench nor a test dispatch port establishes that a production gift can be given.

## What changed

- Twenty fixed shared celebrations, sixty stable band SKUs, eight default selections. Bands change the registered
  Bits amount, never the effect or standing. Helper products supply visible amounts. Dress my home targets the actual
  purchaser's home. Street lanterns are decoration, never attendance/window light. The bard gives a written verse,
  never requested music. Legacy look/song products were removed; catalogue wording has an automated check.
- The production panel exposes its gift transport and shelf. It gates new checkouts on visibility, shared identity,
  live stream, Helper Bits support, real Helper products and realm effect readiness. Friend selection precedes a
  durable immutable intent and Helper useBits. No callback can grant a gift. Pending, delivered and cancelled have
  separate text and sound cues. The tab never opens itself.
- Signed receipt verification requires topic, expiry, domain, identity, SKU and amount/mode. A canonical Get Extension
  Transactions result binds the channel, purchaser, transaction, timestamp and product: receipt fields alone do not
  establish the channel. Digit-string amounts and omitted released-product mode normalize only after signature
  verification and must agree with the canonical row. Hosted Test compatibility remains unproven.
- Verified EventSub messages enter a durable minimal inbox before acknowledgement; raw receipts are never persisted.
  A bounded worker validates extension OAuth, drains known paid work, overlaps the latest provider history page,
  advances a durable cursor only after evidence acceptance and retries independently of the viewer page. Known paid
  work drains even while OAuth credentials are temporarily unavailable. It uses the extension's own OAuth secret,
  never the Atlas application's secret.
- The owned realm ledger shares DurableKingdom.writeMoments, its serial queue, row lock and writer fence. Transaction
  ID, intent binding, public gift fact, outbox and real effect dispatch commit together. Payment survives an offline
  stream, unavailable/failed effect append and uncertain commits. Gift facts have their own sequence and type; they
  are never forged Twitch cheers/redemptions and award no attendance or permanent buyer goods.
- Cancellation retains old targets and cannot invalidate a paid transaction. Ambiguous old/new checkouts require a
  distinct authenticated post-payment choice; receipt intentId cannot force a newer target. Choices page through old
  retained selections. Recovery excludes already committed checkouts, discovers late payments even after every dialog
  was cancelled, and follows the actually selected older intent. Lost cancellation replies and abandoned unpaid
  checkouts can be recovered without automatically opening Twitch's dialog again.

## Evidence

Final focused panel/API run: **73 tests passed** (adapters, Helper gates, gift transport, catalogue, HTTP composition,
receipt verification, webhook/reconciliation). The production adapter test proves the new shelf actually reaches its
snapshot and delegates useBits; it is explicitly a fake API protocol test.

Gift realm suite: **13 tests passed** on random isolated schemas on development Postgres port 5410. It uses actual
allocation, presence, native homes, writer leases and SQL transactions, with an explicit test-only atomic dispatch
port. Tests include replay and receipt/webhook races, conflicting channel/payment evidence, quiet friend filtering,
self targeting, cancellation/late payment, cancelled and historically completed recovery, pagination, manual target
resolution, and background drain after offline/effect-append failure. Dispatch is inspected before status can retry;
repeated drains still produce one fact/outbox/dispatch. The existing realm service/privacy suites also passed (11
checks), earlier in this turn. Crash/lease-loss injection was not performed.

Scoped TypeScript and ESLint pass. Panel, realm and public API SSR builds pass. `0012c_realm_panel_gifts.sql` was applied
only to the isolated `panel_window` development schema and is now frozen. The owner patch passes `patch --dry-run -p1`;
it was not applied. No root suite, live schema, external write, deploy, main change or push was used.

Reproduce the gift database suite:

```sh
REALM_DATABASE_TESTS=1 node --env-file=/tmp/panel-window-realm.env node_modules/vitest/vitest.mjs run \
  --fsModuleCachePath /tmp/panel-window-pw12-final-cache \
  apps/realm/src/ingress/panel/gifts.integration.test.ts
```

## Visual evidence and GPU state

Tobias corrected the lease procedure: `--wait 30`, batch all required stills, continue work while queued. A busy shared
lease is not a PW11 blocker. This turn's batched command returned **exit 3 immediately** because GPU Chrome was
disconnected. Later `chatdom-pc status` still reported no connection. There is no live queued lease job.

The prepared command captures PW11's real street/painter/privacy sequence and all PW12 bench states at both sizes:

```sh
chatdom-pc-lease --wait 30 --max 10 -- node \
  --env-file=/root/.config/chatdom/atlas.env --env-file=/tmp/panel-window-realm.env \
  apps/panel/scripts/pw12-capture.mjs
```

It uses only its own services: realm 5172, lease gateway 5191 and harness/panel 5192; PW11 chooses three free temporary
ports from 5170–5186, excluding 5172, and fails rather than touching another lane's process. It never closes Tobias's
Chrome. No fps run is needed for these static panel views; no performance number is claimed.

One short SwiftShader fallback was captured under the shared capture lock, and opened with view_image:
`work/evidence/panel-window/PW12/choosing-paid-swiftshader@318x496.png`. Parchment, wood, names and the paid-choice paging
control read cleanly without clipping. This is fixture layout evidence only, not a payment or world-effect proof.
Earlier temporary shelf/phone captures were inspected, but they are not substitutes for the complete batch and some
preceded copy corrections. The full six-state/two-size acceptance and real-GPU sequence remain unverified.

All processes created for the fallback are stopped; the failed busy-port start exited without touching its existing
holder. The lease batch did not start any services.

## Requirement audit and next action

| Requirement | Current evidence |
|---|---|
| Permanent Gifts tab; 15–25 gifts; bands; wording | Implemented; twenty gifts and catalogue tests |
| True product/stream/Helper capability gates | Implemented; absent production effect authority means zero offers |
| Immutable target before Helper; verified receipt; exactly one durable gift | Protocol tests and isolated SQL dispatch tests; actual Hosted Test not run |
| Cancellation, hidden/closed viewer and ambiguous payment recovery | Covered by client and Postgres regressions; no invented success |
| Moment in second actual open panel | Two real browser panels through the API and realm now pass; canonical provider and atomic effect dispatch are explicit test ports |
| All gift effects | Exact owner transport patch and twenty mount requirements in PW12-NEEDS; none acknowledged ready |
| Required stills at both sizes | One reviewed fallback only; full batch outstanding |
| Real test-mode gift and first PW13 checklist item | HOSTED-TEST.md first item written; C04 purchase bar remains open |

Next is **PW13** under the repeated-failure rule. Three consecutive PW12 turns invoked the full batch with
`--wait 30 --max 10` and received exit 3 because GPU Chrome was disconnected. None created a queued lease job or
started services. This is missing visual proof, not a failed test, a busy lease, or evidence that PW12 is complete.
PW11 is not blocked on shared lease contention. Resume the outstanding PW12 capture once Chrome is connected,
using the same complete batch; do not shorten the lease wait or restart a live queued job.

The two-panel browser path has isolated-stack proof, with the limits below. Production gift capability/dispatch
still needs its effect owner (`PW12-NEEDS.md`). Do not tick PW12 for test ports, bench captures, or merely applying
the transport patch. PW13 configuration/registration is the next separate task; its work does not waive PW12's bar.
The PRD's existing video-studio round-note edit remains unstaged. This turn corrects PW11's historical busy-lease label
at Tobias's request; erasure and stream disclosure still need their core owners. The progress SHA is the checkpoint's
base, avoiding an impossible self-referential commit ID.

## Follow-up: real HTTP path and keyboard continuity

The development Helper now supplies explicitly configured Bits products and records each admitted dialog request.
It completes or cancels only through an explicit harness control; neither `useBits` nor a product list grants a
gift. Its receipt signer runs in Node, with the signing secret excluded from generated browser source. Eight
Node tests cover the production Helper bridge, signed claims, bounded product shapes and cancellation.

`apps/api/src/panel/gifts/browser.integration.test.ts` starts its own three free services between 5170 and 5186,
creates a random isolated schema on development Postgres 5410, and opens two actual panel pages. It composes the
real panel reader, JWT verifier, API gift service, authenticated realm HTTP door, allocation, ingress and durable
gift ledger. The final run used realm 5170, API 5171 and panel 5172, all bound to 127.0.0.1 (checked with `ss` during
the run) and all stopped afterwards. A test-local adapter supplies the native realm listener's loopback host because
the installed transport ignores its hostname parameter; its normal socket registration and shutdown remain in use.
Only the remote OAuth/Helix provider and mounted effect dispatch are test ports. The dispatch writes
an isolated SQL row in the same transaction as the public fact; it is not a renderer or a production capability.
It makes no Twitch requests or writes, renders no kingdom scene and takes no performance measurements.

The browser test demonstrates a keyboard checkout, an explicitly completed signed receipt, a delivered result
and the same committed moment in the other panel through its real polling loop. Two API receipt replays still
leave one transaction, fact, outbox entry and dispatch. A separate cancelled dialog adds none. Both panels keep
their selected tab, tokens and provider identifiers stay out of the DOM/URLs/storage, and all owned services and
the test schema are removed afterwards. The shared browser capture lock is acquired before services start, with
a bounded five-minute queue wait; the browser journey itself has a sixty-second limit. It runs only when both
flags are explicitly set:

```sh
REALM_DATABASE_TESTS=1 PANEL_BROWSER_TESTS=1 node --env-file=/tmp/panel-window-realm.env \
  node_modules/vitest/vitest.mjs run --fsModuleCachePath /tmp/panel-window-pw12-browser-cache \
  apps/api/src/panel/gifts/browser.integration.test.ts
```

Checkout transitions now retain keyboard continuity: the new heading receives focus when the replaced control
owned focus inside the visible shelf; Back restores the originating gift. Background refreshes and hidden shelves
do not take focus. Paid-choice pagination keeps its control when its last page arrives. Separate local browser
checks covered all nine bench states at 318×496 and 390×844, page bounds, 44 px controls, and friend-to-confirmation
keyboard transitions. Those are functional fixture checks, not payment or full visual acceptance.

The real-GPU batch was called with `--wait 30 --max 10` and returned exit 3: Chrome was disconnected, with no live
queued job. One fallback still under the shared capture lock was inspected and its closed-state wrapping balanced:
`work/evidence/panel-window/PW12/closed-wrapping-swiftshader@318x496.png`. The message now occupies two balanced lines
without clipping or a lone last word. This replaces no required GPU evidence. The temporary Vite on 127.0.0.1:5182
was stopped. The batch runner also observes child completion at spawn, preventing a fast child failure from being
missed by a later wait.

The follow-up focused panel/API regression suite passed 73 tests, the Helper suite eight tests and the complete
two-panel browser journey one test. Scoped TypeScript, focused ESLint and the panel build pass. Unscoped typecheck processes started
during test preparation were stopped; only scoped verification is used as evidence. Full screenshot acceptance,
real world/stream effects and Twitch Hosted Test remain open; C04's purchase bar is still open. PW12 stays unchecked.

## The shelf, redrawn (2 Nov 2026, afternoon)

The working shelf read like a form: eight near-identical cards, 116 words in the first view, a tan "100 Bits" bar under
each, and one ✧ mark for every answer. It is now a place for small celebrations:

- **The shelf** is a grid of carved tokens, two by two at 318 px. Each token has its gift's own emblem, its title and
  a brass chip with the amount Twitch gives for it (a range if the streamer offers more than one band). The first
  view is 51 words, down from 116. Tapping a token opens that gift's page.
- **A gift's page** shows the emblem in a brass medallion, the title, what it does, how long it stays ("For a minute",
  "For five minutes", "For an hour", "For a day"), and for friend gifts "then choose a friend". One button per band
  Twitch offers reads "Give · 100 Bits". It sits at the foot of the page, under the thumb on a phone. This extra step
  lets a newcomer read what a gift does before Twitch's own window opens. `data-gift-sku` stays on the Give button,
  so checkout code and tests address the same control.
- **The answers look different before any word is read.** The medallion carries the gift's own emblem. Waiting shows a
  dotted brass ring that ticks round. Given shows a warm lit disc with rays and the emblem rising, and the credit line
  in bold. Closed and out of reach show a greyed, faded emblem on a dull ring with a muted heading. The sounds were
  already distinct: two brass ticks, a glass note, a dull knock. Reduced motion stops every animation.
- **Closed** keeps one line and now shows the moments on a shelf behind glass: eight engraved emblems, sepia and
  faded, with no buttons and nothing that looks tappable (PW10's closed state, C04).
- **Emblems** (`apps/panel/src/gifts/emblems.tsx`, about 10 KB) are 20 hand-inked SVG stamps in one family: a 1.8
  stroke, round joins, and colours only through `--emblem-*` custom properties, so the states tint them with CSS. The
  bard's verse is a scroll and a quill, never an instrument. Unknown ids get a plain star. The sheet was reviewed at 56 and 36 px.
  `emblem-sheet.html` is the development sheet, not a build input.
- **Focus.** The page closes when the checkout state arrives, not on the tap, so focus goes from Give straight to the
  checkout's heading. Back to gifts returns focus to that gift's token.
- **Wording check** now also scans every string in `GiftShelf.tsx`, against a wider list: buy, spend, cost, price,
  pay, support, random, chance, win, prize, forever, permanent, limited, hurry and others. A test checks that every
  catalogue gift has a drawn emblem.

Bench: `apps/panel/src/gifts/bench.html?state=<state>` now mounts the real `Panel` (header, plate, tabs) opened on
Gifts, through a development-only `initialTab` prop. The states are closed, open, detail, choosing, choosing-paid,
confirming, pending, delivered, cancelled and unavailable.

Checks this session: a scoped strict tsc over `apps/panel/src` and `apps/api/src/panel/gifts` is clean, and eslint
is clean. The panel and panel-API vitest suites pass: 17 files, 165 tests (2 skipped behind their database flags). The two-panel browser journey passes 2/2
on the lane stack, through the new token, page, Give and Back flow. `node scripts/public/extension.mjs` passes
every hosted-asset check (17 files, 495 KB).

### Real-GPU stills

Two leased runs on the RTX 5080 with `chatdom-pc-lease --wait 30 --max 10 -- node apps/panel/scripts/pw12-capture.mjs`.
The script now captures only the shelf: the bench on 5192, ten states at 318×496 and 390×844, and its own server
stopped afterwards. PW11 and PW13 have their own capture scripts. The stills are in
`work/evidence/panel-window/PW12/gpu/`, with contact sheets in `gpu/sheets/`, and I looked at all of them.

The first run found two faults, both fixed before the second run:
- **The shelf fell to one column at 318 px.** The GPU Chrome draws a classic scrollbar, which narrowed the shelf below
  two 132 px tracks. The grid is now always two columns.
- **The delivered medallion was caught at its first frame.** The tunnelled browser does not advance CSS animations
  (the same artefact PW10 hit), so the emblem was faded and the rays were missing. The bench now finishes one-shot
  entrances before it says it is ready. Endless ones, like the waiting ring, keep running. The live panel is
  unchanged.

The second run shows every state as designed, with nothing clipped and no page scroll. Only the shelf list scrolls,
and it shows two tokens in the first view at 318 px and eight at 390 px.

First-view words, from the local measurement: closed 9, shelf 51 (titles and amounts), gift page 28, friend picker 25,
waiting for Twitch 8, on its way 11, given 12, window closed 9.

## Where PW12 stands

Ticked under Tobias's pace rule (13:55): the outcome is real, it works end to end on the lane stack, and it has been
looked at once on the GPU. These follow-ups are still open and are not held against the tick:
- **Production world and stream effects.** No `PanelGiftEffectAuthority` is mounted, so the production shelf offers
  nothing and shows its closed state honestly. The exact needs are in `PW12-NEEDS.md` and `.patch`, and the mount
  recipe is in `SEAMS.md` §2.
- **C04's purchase bar is still open.** No real test-mode gift has gone through Hosted Test yet. It is the first item
  of `HOSTED-TEST.md` (PW13).
