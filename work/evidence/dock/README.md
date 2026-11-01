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
capture is queued as exec session 41052, owned by `/root/dock_evidence` (tool sessions
are agent-scoped; follow up that agent to poll), which imports the latest rehearsal only after
admission. Browser assertions have not run. No image or clip in
this folder has been reviewed. Capture and inspect ready at 390×844 and 1440×900,
real-unavailable at 318×900, the ambiguous reply after reload, and one action UI clip.
Exercise anonymous, forbidden, expired, fault, moderator and remaining action states as
the lock permits. Each invocation starts no server before acquiring the lock and releases
it after closing Chrome and its socket. It has no automatic queue timeout.

The process remains live after reporting it queued. The main thread is investigating a
possible [shared queue registry](../../../packages/testing/capture-lock.mjs) issue across isolated PID namespaces; no conclusion about
this particular wait is established, and the lock has not been altered here.

The realm/stream bridge is absent: these UI rehearsals cannot establish that a royal act
reaches a real stream. Once that seam exists, separately demonstrate every required act
beside the actual stream and inspect the stills and short clips. Do not mark DK10 done on
the strength of fixture receipts.
