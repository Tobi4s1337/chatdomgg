# Dock UI rehearsal

`capture.mjs` serves the actual dock app and a local HTTP fixture over an owned Unix socket.
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

The shared capture lock has not yet admitted a rehearsal capture. Three earlier bounded
attempts timed out before starting the server or Chrome. A new unbounded lane-priority
capture is queued as exec session 23423, owned by `/root/dock_evidence` (tool sessions
are agent-scoped; follow up that agent to poll), which imports the latest rehearsal only after
admission. Browser assertions have not run. No image or clip in
this folder has been reviewed. Capture and inspect ready at 390×844 and 1440×900,
real-unavailable at 318×900, the ambiguous reply after reload, and one action UI clip.
Exercise anonymous, forbidden, expired, fault, moderator and remaining action states as
the lock permits. Each invocation starts no server before acquiring the lock and releases
it after closing Chrome and its socket. It has no automatic queue timeout.

The earlier queued process was stopped after main supplied a cross-namespace
[shared queue registry](../../../packages/testing/capture-lock.mjs) fix; this new process
uses that helper. The lock has not been altered here.

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
the ignored main-checkout `.env`; its contents must not be printed or copied. At the last
read-only listener check, only 5171 was free among the allowed capture ports. A possible
one-port harness can serve actual API handlers and web Vite middleware on IPv4 loopback
and bootstrap the real realm on an owned Unix socket. It must preserve streaming SSE and
sign-in and replicate the production realm composition rather than fake a presenter. Do not
stop another service to obtain a port; recheck availability at execution time.

`integration-capture.mjs` and `integration.mjs` are an **untested scaffold**, not evidence.
They compose the real durable realm, API handlers, simulated OIDC and the integrated web Vite front
door on IPv4 loopback and the real realm on a Unix socket, with one random schema and temporary
founded directory. They bind port 5171 exclusively only after acquiring the capture lock; a
conflict must fail. A first still can show the actual stream and signed-in dock beside one another,
but exercises no act and asserts no delivery. The script does not send a witness itself.
It needs runtime verification and visual inspection before use as evidence; the wrapper
requires `CHATDOM_DOCK_BENCH_UNTESTED=1`. After admission its supervisor has an eight-minute
deadline, tracks its worker and Chrome process groups, waits for them to stop, then removes
only its generated schema and temporary directory before releasing the lock. These cleanup
paths are not yet runtime-tested. If Chrome cannot be tracked or confirmed closed, it retains
the lock for intervention. Do not run alongside another lane-owned browser capture.

For later action evidence, send normalized simulated presence/chat observations through
the real authenticated evening ingress, then wait for allocation, disclosure and public
watch to expose a named citizen and slot. Send a simulated normalized raid observation
through the same ingress and wait until the dock authority lists it. Use the real dock
controls and require the renderer's independent witness; record the receipt and actual
visible beat. The scaffold provisions an isolated Herald credential but does not yet seed
these events or claim their availability.

Next: poll the existing agent-owned 23423 handle; on admission inspect its ready 390×844
viewport still, then queue each remaining UI still separately. Validate the scaffold's
owned socket, isolated schema cleanup, real sign-in and both SSE relays before relying on
its still. Then seed actual simulated observations, use dock controls and verify stream
draws and witnesses one act at a time. A read-only queue snapshot showed five inactive
tickets; compatibility locks may still be held. This does not identify an owner.
