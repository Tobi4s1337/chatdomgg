# Dock UI rehearsal

`capture.mjs` builds the actual dock app into a temporary directory and serves it with a
local HTTP fixture over an owned Unix socket. The production build contains no Vite HMR client.
Playwright intercepts `http://dock.capture` and forwards it through that socket, so no TCP
port is opened or existing service touched. Chrome treats that test-only origin as secure
for browser APIs. It acquires the host capture lock before starting the server or Chrome,
and closes them before releasing it. It never connects to a stream or realm. Every frame
is visibly marked SIMULATED. Fixture acknowledgements describe only the rehearsal and
must never be interpreted as a delivered act.

Run one capture per invocation:

```
node work/evidence/dock/capture.mjs ready 318x900 still
node work/evidence/dock/capture.mjs open 390x844 clip
```

Scenarios are `ready`, `anonymous`, `declined`, `forbidden`, `expired`, `fault`, `offline`, `unavailable`,
`real-unavailable`, `moderator`, `empty`, `pending`, `refused`, `unknown`, `undo`, `sessionreplace`, `signout`, `ambiguous`, `open`, `close`, `fire`, `raid`, `crown`, `knight`, and `moment`. Sizes are `318x900`,
`390x844`, and `1440x900`; formats are `still` (PNG) and `clip` (WebM).
Still captures default to the viewport; append `full` as a fourth argument for a full-page
PNG in a separate lock hold.
The fixture models a SIMULATED session cookie and CSRF token. The expired scenario exercises
the anonymous session response with the expired sign-in return. Unavailable is a fixture
response, not evidence of the live API.
`real-unavailable` executes the actual dock HTTP handler with a simulated session lookup
and no bridge configured. It tests the handler's response, not a deployed service.
The actions use a delayed simulated receipt so the dock's pending and acknowledgement
states can be reviewed. Their witness fields are fixture values that exercise the protocol;
they are not evidence of stream delivery. No real stream imagery is fabricated here.
`ambiguous` closes the HTTP reply after the request to exercise uncertainty; it does not
assert that an act was delivered.

Each capture checks browser exceptions and console errors (excluding expected failed
HTTP resource messages on intentional failure scenarios), as well as horizontal document overflow. The ready scenario
checks that action focus survives a status poll. The ambiguous scenario reloads and
checks that actions stay locked and no second POST is sent.

## Outstanding evidence

Earlier bounded attempts timed out. Subsequent attempts admitted, but two exposed Vite
HMR harness failures and produced no screenshots. Inspected simulated dock captures are
`ready-390x844-viewport.png`, `ready-318x900-full.png`, `ready-1440x900-viewport.png`, and
`anonymous-390x844-viewport.png`, `moderator-390x844-viewport.png`,
`undo-390x844-viewport.png`, `unknown-390x844-viewport.png`,
`real-unavailable-318x900-viewport.png` and `signout-390x844-viewport.png`. No browser console/page errors or horizontal overflow were
observed; ready action focus persisted through a poll, so its visible focus ring is intentional.
The first undo fixture incorrectly retained the gate state; it was fixed, recaptured and
checked after reload. Unknown survives a reload and the fixture asserts no second POST.
Capture and inspect the ambiguous reply after reload and one action UI clip.
Exercise forbidden, expired, fault and remaining action states as
the lock permits. Each invocation starts no server before acquiring the lock and releases
it after closing Chrome and its socket. It has no automatic queue timeout.

The earlier queued process was stopped after main supplied a cross-namespace
[shared queue registry](../../../packages/testing/capture-lock.mjs) fix; current processes
use that helper. The lock has not been altered here.

These UI rehearsals cannot establish that a royal act reaches a real stream. Once the
renderer integration is ready, separately demonstrate every required act
beside the actual stream and inspect the stills and short clips. Do not mark DK10 done on
the strength of fixture receipts.

## End-to-end bench requirements (2026-11-01)

Main has since supplied the realm/API bridge and merged the stream renderer;
the fixture above remains UI-only. An end-to-end rehearsal needs an isolated SIMULATED
Postgres schema migrated through `0010_realm_dock`, an adopted and furnished kingdom whose
ID matches a simulated OIDC broadcaster, and the actual realm and API sharing that schema
and an ephemeral `REALM_INTERNAL_SECRET`. Route the dock and stream through one browser
origin and sign that broadcaster into the same browser context. The presenter must remain
connected and visibly draw the committed event before its witness can produce a receipt.
An anonymous stream is not a witness. The existing live bench hardcodes forbidden ports
and is not safe to start unchanged.

The realm offers a dusk moment by default. A raid requires a recent normalized simulated
raid fact, and honours require a public named citizen with a current real slot/presence;
these must be seeded through actual authority paths and remain visibly SIMULATED. Neither
fixtures nor a fabricated witness demonstrate a stream act. Main verified Postgres using
the ignored main-checkout `.env`; its contents must not be printed or copied. Recent
read-only listener checks showed the allowed IPv4 capture ports occupied. The one-port
harness serves actual API handlers and a fresh production web build on IPv6 loopback
and bootstraps the real realm on an owned Unix socket. It must preserve streaming SSE and
sign-in and replicate the production realm composition rather than fake a presenter. Do not
stop another service to obtain a port; recheck availability at execution time.

`integration-capture.mjs` and `integration.mjs` are a **runtime-unverified scaffold**, not evidence.
They compose the real durable realm, API handlers, simulated OIDC and the integrated production web front
door on IPv6 loopback and the real realm on a Unix socket, with one random schema and temporary
founded directory. They bind `[::1]:5171` with `ipv6Only` exclusively only after acquiring the capture lock; a
conflict must fail. A first still can show the actual stream and signed-in dock beside one another,
but exercises no act and asserts no delivery. The script does not send a witness itself.
The first initial still attempt, agent-owned session 21613, exited 1 while loading workspace
services; it opened no listener or browser and produced no image. Its supervisor reported
no cleanup error. Import-only preflight found Vite runner/CJS interop failing on zod; a
temporary SSR build using the realm's Vite configuration and a native Node import then exposed
all required service factories successfully without starting a server or touching the database.
The corrected bench later failed during town preparation, as recorded below. The wrapper
requires `CHATDOM_DOCK_BENCH_UNTESTED=1`. After admission its supervisor has an eight-minute
deadline, tracks its worker and Chrome process groups, waits for them to stop, then removes
only its generated schema and temporary directory before releasing the lock. These cleanup
paths have run before browser startup, but browser shutdown remains unverified. If Chrome cannot be tracked or confirmed closed, it retains
the lock for intervention. Do not run alongside another lane-owned browser capture.

The scaffold now seeds simulated stream and named chat observations through the real
authenticated evening ingress, and seeds a simulated raid for the raid scenario. Its
action driver requires a real signed-in presenter and an accepted simulated witness;
no runtime attempt has established that these seeds or any visual beat work yet.

Run one actual-service still or short clip at a time (explicit opt-in while runtime
verification is pending):

```sh
CHATDOM_DOCK_BENCH_UNTESTED=1 node --env-file=/root/chatdomgg-harness/chatdomgg/.env work/evidence/dock/integration-capture.mjs initial still
```

After `initial` is verified, use `open`, `close`, `fire`, `raid`, `crown`, `knight`, `moment`
or `undo` in its place, and `clip` for one short WebM. Each invocation creates a fresh own
schema, signs in through the real simulated OIDC provider and builds current production
assets. Witness metadata written beside an action capture contains only simulated action,
receipt and public witness IDs; no CSRF or presenter capability is recorded.

The corrected capture in agent-owned session 60166 acquired the lock and exited 1 before opening a browser: the `dock-simulated` town with firstYear 2019 and year 2026 failed generation (quarter 2023, 47/48 clear canonical frontages). Its supervisor reported cleanup and no image was created. The requested `tobi4s_` 2019–2026 town also failed generation (quarter 2024, 25/48 frontages); both inputs and failures were sent to main as world-generator needs. No capture is currently queued. Do not use either seed as if it had passed.

A separate backend-only diagnostic loaded the real service graph and created an isolated simulated schema and founded directory; it opened no listener, browser, presentation or witness. The incomplete experimental script was removed. Its session is directly inserted and is not an OIDC test. The established `simulated-founded-town` 2022–2026 seed passed generation, adoption and readiness; one run opened the retained realm and encountered an ingress refusal, while subsequent attempts returned a storage-opening 503 after slow preparation; the final attempt reported that its writer lease was no longer held. No complete backend preflight or real-stream evidence has passed yet. Each completed run reported removal of its own schema and tempdir. The diagnostic did not reach a complete passing run, and no integrated capture was requeued.

Next: resolve the world-generator and writer-lease failures, validate the backend inputs, then queue the integrated still one at a time under the shared lock. Verify the real socket, OIDC, stream, dock and draw witnesses before claiming any action evidence.
