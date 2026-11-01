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
| Moment in second actual open panel | API reads committed gift facts; full harness tap-to-second-panel proof outstanding |
| All gift effects | Exact owner transport patch and twenty mount requirements in PW12-NEEDS; none acknowledged ready |
| Required stills at both sizes | One reviewed fallback only; full batch outstanding |
| Real test-mode gift and first PW13 checklist item | HOSTED-TEST.md first item written; C04 purchase bar remains open |

Next stays **PW12**: run the complete GPU batch when connected; integrate real effect capability/dispatch and prove a
gift in two real lane panels. Do not tick PW12 for test ports, bench captures, or merely applying the transport patch.
See `PW12-NEEDS.md` for exact owner seams. PW13 configuration/registration remains a separate task in strict order.
The PRD's existing video-studio round-note edit remains unstaged. This turn corrects PW11's historical busy-lease label
at Tobias's request; erasure and stream disclosure still need their core owners. The progress SHA is the checkpoint's
base, avoiding an impossible self-referential commit ID.
