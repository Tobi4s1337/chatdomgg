# DK10 integration seam

2026-11-01. DK10 remains unchecked. The dock and API boundary can be reviewed independently; a
successful HTTP rehearsal is not evidence of a ceremony on stream.

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

The current realm has authenticated Herald observation ingress and public watch feeds, but no
dock command/status authority. The dock API already calls the following exact endpoints when
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

## needs: workspace lock importer

`pnpm-lock.yaml` is outside lane scope. Main must run `pnpm install --lockfile-only` after
adopting `apps/dock/package.json` so frozen workspace installs include the new app. During lane
verification dependencies were installed with `pnpm install --ignore-scripts --lockfile=false`;
the tracked lockfile was left untouched. No package versions were upgraded in manifests.

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
