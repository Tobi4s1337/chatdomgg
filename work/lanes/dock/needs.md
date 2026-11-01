# DK10 integration seam

2026-11-01. DK10 remains unchecked. The dock and API boundary can be reviewed independently; a
successful HTTP rehearsal is not evidence of a ceremony on stream.

**Current status after `2c9a722`:** command/status, authenticated stream witness, scene
binding, same-origin route, workspace importer and authoritative undoable metadata are
supplied and synced. Open main-owned needs are verified moderator observation, directed
undo, attendance wording, and the incoming banner/guest procession and fire gathering
details below. Earlier request sections are retained as handoff history.

**Current capture need:** the live real-service capture60166 is waiting before startup.
With three v2 tickets all inactive, nonblocking shared probes show exclusive holders on
both legacy compatibility files. Main/capture owners need to inspect and finish/cancel
their own obsolete legacy jobs; this lane must not signal an unknown process or unlink a
lock. Exact observations are in `capture-queue-observation.md`. Keep60166, not duplicates.

## Decisions

- All current dock presses are royal acts and therefore broadcaster-only (ChatDom principle 7;
  Monarch §7.5 and §13.1). Verified Twitch moderators may observe the dock; they cannot crown,
  knight, light the campfire, or open the gate. No client-supplied role is trusted.
- The dragon is earned. The moment picker displays only authority-supplied opportunities; the
  realm must not offer an arbitrary dragon spawn. Sky changes and approved Forge showcases may
  be offered by the authority.
- Existing Twitch OIDC sign-in and session cookies are reused. No additional Twitch scopes or
  write calls are introduced. The dock returns to `/dock` after sign-in.
- An action carries a unique ID and expected revision. Uncertain outcomes survive a reload and
  disable further presses until the streamer explicitly checks the stream. No automatic resend.
- Success means a realm-issued delivery receipt. It cannot mean merely enqueued or dispatched.
  A press may have reached the realm even when its reply is lost.
- Named targets are direct buttons, with at most three target entries shown per group. Paging
  reveals other authoritative targets; it never invents candidates. Stable target IDs preserve
  focus across status polling. Only the pressed action changes its label while pending.
- The app stays unavailable when the realm bridge is absent. There is no browser-local live
  fallback and no fabricated Twitch observation. Rehearsal evidence is visibly SIMULATED.

## needs: main-owned authoritative bridge and stream presentation

**Resumed 2026-11-01:** main is implementing this seam. The lane is active again and continues
building session states, sign-out, moderator presentation, recovery, undo and town glance while
capture waits in the shared queue. The earlier blocked audits are historical, not the current
work state. Main's `966e371`, capture queue/importer changes, and shared boundary `13f1a36`
have been synced into `lane/dock`; unrelated reviewed main work through `7a0830f` is synced too.
The action and witness schemas now come directly from shared. The API layers only the optional,
backward-compatible undo presentation hints described below. The original request patch below
is retained as handoff history; main's shared request schemas now supersede that proposal.

At the original request, the realm had authenticated Herald observation ingress and public
watch feeds but no dock command/status authority. The dock API calls these exact endpoints when
`DOCK_REALM_URL` and `REALM_INTERNAL_SECRET` are configured. Main owns their implementation in
`apps/realm/**`, any shared contracts, and ceremony rendering in `apps/web/src/kingdom/**` and
`apps/web/src/stream/**`.

The exact request/response types are implemented in `apps/api/src/dock/contracts.ts`. The
following additive contract patch is proposed for main; it is documentation, not applied code:

```diff
diff --git a/packages/shared/src/realm/dock.ts b/packages/shared/src/realm/dock.ts
new file mode 100644
--- /dev/null
+++ b/packages/shared/src/realm/dock.ts
@@ -0,0 +1,22 @@
+/** Private authenticated API -> realm requests, never browser authority. */
+export interface RealmDockActor {
+  readonly personId: string;
+  readonly sessionId: string;
+}
+export interface RealmDockStatusRequest {
+  readonly version: 1;
+  readonly origin: 'live' | 'simulated';
+  readonly principal: RealmDockActor;
+  readonly kingdomId: string;
+}
+export interface RealmDockActionRequest {
+  readonly version: 1;
+  readonly origin: 'live' | 'simulated';
+  readonly principal: RealmDockActor;
+  readonly action: {
+    readonly id: string; readonly kingdomId: string;
+    readonly kind: 'gate-open' | 'gate-close' | 'fire-light' | 'raid-welcome'
+      | 'citizen-crown' | 'citizen-knight' | 'moment-play' | 'undo';
+    readonly targetId?: string; readonly expectedRevision: string;
+  };
+}
```

`POST /internal/dock/status`: Bearer service authentication; decode the status request above;
independently verify the named session is unrevoked, unexpired and of the requested origin;
derive broadcaster/moderator authority from realm/Twitch records. Return `DockStateSchema` JSON,
or JSON `null` when access is forbidden. Safe approved public display names only. No private
Forge holds, submitted words, credentials or raw provider payloads. The snapshot's revision
must describe the authoritative eligibility and state. Town labels come from actual observations.

`POST /internal/dock/action`: same authentication and session checks, then broadcaster identity
must equal the kingdom's Twitch ID. Validate the exact `DockActionSchema`. In the realm's
transaction, recheck revision, cadence, eligibility, target existence, pending raid provenance,
and undo eligibility; deduplicate `(origin, kingdomId, id)` durably with a payload digest.
Reusing an ID for different bytes is refused. A retried identical ID returns its recorded result.
The closed gate is a gathering/ceremony state, never a means to deny citizens access or fake
Twitch live/offline evidence. Crown/knight does not confer Twitch moderator/VIP status or buy
loyalty. A temporary honour expires automatically and may be gently withdrawn.

Emit committed presentation through the existing realm public watch/outbox. Main must add the
gate wake/goodnight, fire gathering, witnessed incoming raid welcome, crown/knight ceremonies,
and chosen eligible moment to its stream director/scene consumers. A receipt acknowledges a
connected stream consumer's presentation of that committed moment, not just the mutation.
Return `{status:'accepted',message,receipt,witness,state?}` only after that witness. The exact
`witness` shape is `{actionId,kingdomId,origin,streamEventId}`; it must match the requested
action ID, kingdom and origin and identify the presentation event acknowledged by the stream.
Both receipt and event identifiers use the existing shared `TokenSchema`, including realm
tokens with colons and periods. An arbitrary witness object is not independent proof of
presentation: the trusted realm must obtain that acknowledgment before issuing it. Return
`{status:'unknown',message}` if presentation cannot be established after dispatch; refusal and
definitely-undispatched unavailability have distinct outcomes. Every act must be undoable or
gentle; only offer `undo` when a real eligible receipt can be reversed.

Required main checks: revoked/wrong-origin sessions; forged moderator/broadcaster claims;
replayed and conflicting IDs; stale revision; unavailable stream; pending raid consumed twice;
dragon before earned; forbidden hidden targets; success witness after reconnect; persistent
gentle action state; broadcaster/moderator permissions. Then run the dock beside the actual
stream and capture each press and its ceremony, one shared capture lock per still/short clip.

### Additive undo status and in-flight compatibility notes

The API now accepts optional `undoable: [{id,kind,label}]` on `DockState`, at most 20 entries.
`id` is the **receipt ID**, `kind` is the original act kind excluding `undo`, and `label` is an
approved public phrase. A present list is authoritative (empty denies every undo); absent
retains compatibility and lets the realm decide the cached receipt's validity atomically.
The browser persists that cached receipt by the root session's opaque `resumeScope` and
kingdom, never by a client-asserted person or role. The shared schema may adopt the optional
field when main freezes it; it does not change a required bridge field.

Read-only inspection of main's in-flight implementation found a receipt-target mismatch:
`RealmDockService.commit` rejects a target on `undo`, while the agreed API requires a receipt
as its target. If that implementation remains in place, this exact adjustment preserves the
existing public contract (main applies it in its own worktree):

```diff
--- a/apps/realm/src/dock/service.ts
+++ b/apps/realm/src/dock/service.ts
@@
-    if (['gate-open', 'gate-close', 'fire-light', 'undo'].includes(action.kind) && target !== undefined) rejection = 'That royal act has no named target.';
+    if (['gate-open', 'gate-close', 'fire-light'].includes(action.kind) && target !== undefined) rejection = 'That royal act has no named target.';
+    if (action.kind === 'undo' && (!snap.head.undo || target !== `receipt:${snap.head.undo.eventId}`)) rejection = 'That receipt is no longer available to undo.';
```

The current in-flight status implementation also admits only the broadcaster. Verified
moderators still need read access derived from authoritative Twitch grants; they must never
gain royal action rights from a client role. The lane API and UI already enforce that split.
These are integration observations, not claims that main's uncommitted work is final.

The dock now handles `/dock?signin=expired|declined|refused|unavailable`. The existing root
OIDC callback uses `/?signin=expired` when an attempt/binding cannot be recovered; main's root
routing should preserve an intended dock return for that case. We do not weaken root callback
binding or accept an arbitrary return URL inside this lane.

## needs: workspace lock importer

`pnpm-lock.yaml` is outside lane scope. Main's `1bf6b26` has now supplied the dock importer,
and the lane has synced it. This resumed session also added the app's direct dependency on
`@chatdom/shared` for canonical session schemas and realm token validation; main should include
that one additive dependency when taking this checkpoint. Exact lockfile change:

```diff
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@
   apps/dock:
     dependencies:
       '@chatdom/audio':
         specifier: workspace:*
         version: link:../../packages/audio
+      '@chatdom/shared':
+        specifier: workspace:*
+        version: link:../../packages/shared
       '@chatdom/ui':
```

Alternatively run `pnpm install --lockfile-only` after adopting `apps/dock/package.json`.
During lane verification dependencies were installed with
`pnpm install --ignore-scripts --lockfile=false`; the tracked lockfile was left untouched by
the lane. No package versions were upgraded in manifests.

## Serving

The dock builds under `/dock/`; the public origin must route `/dock` and `/dock/**` to this new
app and keep `/api/**` on the existing API. The API mount is the one added line in
`apps/api/src/main.ts`. The dev proxy reads `CHATDOM_DOCK_API`. The evidence harness uses an
owned Unix socket and intercepted browser requests because the permitted TCP capture ports
were occupied. It releases the shared capture lock between individual captures. No services
on 5190–5199 were touched. Production routing/deployment is main's responsibility.

## Main boundary supplied — 2026-11-01

`@chatdom/shared/realm` now owns `DockActionSchema`, `DockStateSchema`, `DockOutcomeSchema`,
`RealmDockStatusRequestSchema`, `RealmDockActionRequestSchema`, `RealmDockPresentationSchema`,
`RealmDockStageStateSchema` and `RealmDockWitnessRequestSchema`. The API file re-exports them.
`apps/realm/src/dock/` implements the retained-writer command/status service and the private
`/internal/dock/{status,action,witness}` routes plus `/internal/dock/presentations/:kingdomId`.
Migration `0010_realm_dock` stores heads, idempotent presses and presentation receipts. No second writer.

The same-origin web build serves `/dock` and `/dock/`; no extra hosting service is needed.
`DOCK_REALM_URL` remains an explicit override; otherwise the API uses root `CHATDOM_REALM_TARGET`.
The existing `REALM_INTERNAL_SECRET` authenticates the API bridge. Workspace frozen install includes the dock.

The live stream consumes `/api/dock/presentations?kingdom=<id>`. Public OBS viewers display committed
acts and quiet lasting-state checkpoints. A broadcaster-signed-in stream receives a per-connection
presentation capability; only its actual visible draw can POST `/api/dock/witness` with session CSRF.
The realm rechecks that session, origin, capability and exact delivered event. No presenter means
`unknown`, never fabricated success. Keep the stream view signed in while demonstrating receipts;
an anonymous OBS source alone cannot confirm them. Source SIMULATED rehearsals must stay labelled.

Scene ports live in `kingdom/dock-acts.ts`, `dock-visuals.ts` and `stream/dock-presenter.ts`; main mounts
supported gate/plaza sites, real public citizen slots, crowd/light/camera effects and quiet checkpoint
restoration. Hidden replacements cannot witness. A missing target/site yields no receipt. The eligible
moment currently offered is the harmless dusk change; no unearned dragon or arbitrary Forge showcase.
Moderator observation still requires an independently verified moderator-ID source. Undo state restores,
but its directed visual receipt remains unavailable until the restored subject is identified. These are
remaining integration needs, not permission to invent targets, authority or a success reply.

## Dock follow-up against the supplied boundary — 2026-11-01

The lane has exercised `apps/realm/src/dock/service.test.ts` with `REALM_DATABASE_TESTS=1`
against a random isolated Postgres schema: both tests pass, including durable unknown →
presenter witness → accepted retrieval and reopening/revocation. This proves storage and
authority, not drawn pixels. UI recovery accepts the exact `receipt:dock:<48 hex>` format.

**needs: main-owned moderator observation.** `RealmDockService.status()` currently admits
only `principal.personId === kingdomId`. Supply a current independently verified moderator
grant for read access; retain broadcaster-only capabilities for every royal act. The dock
already accepts `principal.role: 'moderator'`, displays the role, and disables every mutation.
Neither query parameters, browser role claims nor a fixture may establish that grant.

**needs: main-owned directed undo presentation.** `undoOf` alone identifies an earlier
event, but its target/kind is absent from the current undo event. Have the realm resolve the
stored original presentation in the same transaction and publish enough approved subject
and restored state for the scene to display the reversal and witness it. A current stage
checkpoint may restore state silently; it must not be counted as the visible undo ceremony.
If the restored subject is no longer public/installed, keep the receipt unknown/refused.

For cross-device undo recovery, adopt the optional `undoable` state extension already
implemented in `apps/api/src/dock/contracts.ts` into shared and the realm snapshot:
`[{ id: 'receipt:' + head.undo.eventId, kind: original.kind, label: approvedLabel }]`, only
while the original act is witnessed and `head.undo.until > now`. An empty list explicitly
denies undo. Existing same-session reload already recovers the accepted receipt locally;
the realm remains responsible for atomic authorization and expiry.

**needs: town attendance in the existing label.** `town.presenceLabel` currently says only
whether the stream is awake. DK10 asks who is in town at a glance. Populate this existing
field from the current public presence projection (a safe attendance count and, where
disclosure permits, a short approved name sample). Keep unknown coverage explicit; do not
substitute viewer count or number of homes for observed people. No schema change is needed;
the dock already displays the authoritative label beside Here.

## Stream act fidelity from the supplied renderer — 2026-11-01

`821b71d` now provides a real draw/witness seam and installed-site camera effects. These
source findings concern the requested visible acts, beyond command delivery:

**needs: incoming welcome with its banner.** `dock-visuals.ts` handles `raid-welcome` by
reusing the gate flare and generic attention call; it never reads `act.targetName`, and
contains no incoming banner/road procession. Bind this act to the existing real incoming
raid presentation, using its witnessed raid key and approved source name. Show the banner
and direct currently disclosed real guests up the road, without inventing identified
visitors or issuing a second Twitch raid. The dock's one press is already wired to the
authority-supplied raid target. A gate flare alone does not demonstrate this PRD requirement.

**needs: gathering at the lit fire.** The fire mesh/light persists, but the current crowd
call lasts8.5seconds and only asks for generic cheering/attention. Bind the lasting fire
state to a gathering/seated behavior for actual present citizens at the installed plaza,
with expiry/undo restoring their ordinary life. Reuse the existing campfire behavior where
appropriate. A warm prop without people coming to sit does not demonstrate the requested act.

These findings do not authorize this lane to change the kingdom scene or create substitute
visuals. The actual stills/clips will decide the remaining visual polish.

**needs: preserve presenter access under public viewing.** `RealmDockService.connect()`
currently counts every public and authenticated feed against one global32-connection
ceiling, and `kingdom/index.tsx` opens a feed for each live founded visitor. Public viewers
can therefore fill the pool before the broadcaster's stream connects. Reserve presenter
capacity independently of public observers (and bound public observers per kingdom/host
as appropriate). Test that a full anonymous audience cannot prevent the independently
authenticated broadcaster from receiving a draw capability. This is a main-owned service
budget/authority change; the dock must not manufacture a receipt when admission fails.
