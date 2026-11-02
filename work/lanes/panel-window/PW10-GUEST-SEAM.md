# PW10: a guest's observed light

The panel door truthfully reports `guest`, but the realm currently publishes presence only for installed homes and
the monarch's bound keep. A guest's observation can be committed without a rendered guest light. PW10 therefore
does not demonstrate a lit guest window. No production stub or substitute light has been added.

## The exact current path

1. The API posts the verified person's `source: 'panel'` observation to `POST /internal/realm/ingress`, using
   `REALM_INGRESS_PANEL_SECRET`. `apps/realm/src/ingress/gate.ts` permits exactly one person's panel observation.
2. `RealmIngress.accept` and `PostgresIngressInbox.accept` persist it. `KingdomDrain.apply` in
   `apps/realm/src/ingress/service.ts` passes it to `kingdom.ingest(..., presenceTransition(...))`. The existing
   fenced transaction commits the private checkpoint and public presence frame together.
3. `apps/realm/src/ingress/transition.ts` builds `bindings` solely from `s.homes` and `s.castle`, then calls
   `projectPresence`. `realm_guests` is not read. The person's private presence lease may exist, but the public
   frame has no window for them.
4. `RealmPanelService.presence` in `apps/realm/src/ingress/panel/service.ts` finds a real home or castle slot and
   requires its committed public window plus valid private presence. Without a slot it returns `lit: false`.
5. `apps/web/src/kingdom/founded-content.ts` supplies the renderer's actual home windows and keep.
   `packages/render/src/presence-lights.ts` creates state for those meshes and `setFrame` iterates that state.
   A newly invented frame slot has no mesh and is ignored. Giving a guest an unused real home slot would instead
   light someone else's unclaimed house. Neither is a valid guest light.

## Required owner contract

`needs: integrator / grand-world` Freeze a guest light binding that has both a private identity and an actual public
place to render. This crosses allocation, ingress, scene production and rendering; a mechanical transition-only
patch is not sufficient.

- Allocation remains the only home authority. Its existing `guest` outcome and `realm_guests` row stay outside the
  three-home quota. A presentation binding must create no deed, plot ownership, coal, rights or tenure.
- Persist `(kingdom, origin, person) -> guest presentation slot` before publishing. Slots are unique within a
  kingdom, fit the current `WindowPresenceSchema` range `0..65534`, exclude `REALM_CASTLE_SLOT` (`65534`), and cannot
  overlap **any** home slot in the current adopted layout, including unclaimed homes. Reconcile layout extensions
  and a guest becoming a citizen before publishing the next frame. Do not assume a permanently free numeric range:
  the current allocation contract reserves no guest range.
- `assignPresenceSlot` in `packages/world/src/presence-slots.ts` already chooses a supplied unused slot and preserves
  a returning binding. Reuse it after the owner supplies the allowed slots; it deliberately neither persists nor
  grants a deed. Capacity exhaustion must remain an explicit unavailable outcome, never a shared or fake light.
- At the existing `KingdomDrain.apply` / `presenceTransition` seam, supply the writer's validated guest bindings.
  Compose them with home and castle bindings immediately before `projectPresence`, rejecting duplicate people or
  slots. Persist binding changes with the same fenced checkpoint/public-frame commit, and recover them on reopen.
  The existing presence reducer still decides lit, dim, expiry, moderation and source loss for every source.
- The founded-scene owner must supply a corresponding real guest lantern or traveller's tent anchor for each
  published guest slot. The renderer must mount those anchors through its existing light path. The public scene
  carries slot and position, never person IDs or private moderation. Match guest geometry and frame revisions so a
  slot cannot silently move onto a home during an extension.
- The panel presence reader must resolve the same persisted guest slot after checking home/castle. Keep its existing
  committed-public-window and valid-private-presence checks. This is a read hook, not a second presence reducer.

## Evidence required before closing the seam

Real writer tests must show: a fourth-kingdom guest receives no deed and keeps exactly three homes; their own
committed panel observation lights one unique guest binding; repeat/reopen preserves it; another guest cannot take
it; moderation, expiry and offline transitions dim it; a layout extension or later settlement cannot collide with
it. A screenshot must then show that person's actual guest light in the real scene. Backend frame assertions alone
are not rendering evidence.

This note is read-only reconnaissance apart from this file. No core files were changed, and no additional tests,
servers or git commands were run for it.
