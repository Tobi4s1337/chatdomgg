# panel-window seams

These seams are frozen from Sun 1 Nov 2026. To change one, write the change into both lanes' `SEAMS.md`. This lane
edits only its own folder, so the integrator carries a change to another lane's file. Each `needs:` line in
`progress.txt` names the owner and gives the exact patch.

## 1. The realm: claim, light and presence

**Owners.**
- Main and the integrator own the realm's persistence, allocation (`apps/realm/src/allocation/**`), the presence
  reducer and transition, and `apps/realm/src/evening/**`.
- This lane owns only the realm's panel door:
  - new `apps/realm/src/ingress/panel*.ts` or `apps/realm/src/ingress/panel/**`;
  - one new migration for the panel's own tables;
  - one composition and mount line in `apps/realm/src/main.ts`.

**What already exists and is used as it is:**
- The ingress gate already grants the `panel` service one person's own `observe` with `source: 'panel'`
  (`apps/realm/src/ingress/gate.ts`). It authenticates with `REALM_INGRESS_PANEL_SECRET`, which must be at least 32
  characters and different from the Herald's secret.
- `PresenceSourceSchema` in `packages/shared/src/presence.ts` already includes `'panel'` and `'walker'`.
- The realm's own rooms already observe walkers, so walking while live needs no new path.
- `createRealmCitizens` (`apps/realm/src/evening/citizens.ts`) settles a person through the existing allocation and
  install services. That gives the three-home cap, guests, the castle and tenure placement. Its exported `settle(...)`
  works for a person with an approved public name. Its `observe(...)` settles only `chat` evidence.
- The API already reads `realm_deeds`, `realm_guests`, `realm_persons` and `realm_citizen_names` read-only in
  `apps/api/src/public/panel/reading.ts`.
- The public watch route streams committed public deliveries (moments and presence frames) for a kingdom.

**What this lane builds in its own door:**
- **Claim.** An internal route on the realm, authenticated with the panel secret and never open to browsers. It takes
  `{ kingdomId, personId, name }`, where the API has already verified the person and looked up the name through Helix.
  It settles the person through the composed citizens service, never a second allocator, and answers one of:
  - `deed`, with the street and place;
  - `guest`;
  - `castle`;
  - `unfounded`;
  - `held` (moderated);
  - `unavailable`.

  The route is idempotent.
- **Light.** After a successful claim, and on every panel heartbeat, the API posts a `panel` observation to
  `POST /internal/realm/ingress` with the panel secret. The ingress inbox, the writer and the lease rules decide lit
  and dim. The panel never decides.
- **Pledge.** A private table keyed by channel ID and person ID, with a time. It sits outside the three-home cap and is
  readable only as a count in bands.
- **Gift delivery (PW12).** The door takes a verified, deduplicated gift and commits it as a public moment with its
  credit line. If the API and the realm must share a new type, it goes in a new file, `packages/shared/src/panel.ts`.
  No existing export changes.
- **Quiet and forget (PW11).** One realm function for each, called by the panel door and later by the Herald's chat
  commands.

**Migration numbering.** Migrations run in number order. Other lanes may also add one tonight. Name ours
`0011_realm_panel.sql`. If another lane takes 0011 first, the integrator renumbers it at merge. The migration only
adds tables and never alters existing ones.

**needs: from main and the integrator:**
- `needs: integrator` The quiet hook. The stream's public name projection must honour a person's quiet flag: their
  window still lights, but their name stays off the stream. Write the exact patch against the presence projection when
  PW11 reaches it.
- `needs: integrator` Production configuration. `REALM_INGRESS_PANEL_SECRET` must be set in the realm's environment and
  in the gateway's environment, if it is not already. Never print it.
- `needs: founding owner` (D02, not in this round) Turning pledges into tents. When a streamer founds live, each
  pledge becomes a real tent through allocation, and the pledge row is cleared.

## 2. The live picture: grand-world owns the scene and the stream

**Owners.**
- grand-world owns `apps/web/src/kingdom/scene.ts` and its composition, the land, and the stream director host
  `apps/web/src/stream/**`.
- This lane owns the new `apps/web/src/panel-painter/**`, one line in the `lanePaths` map of `apps/web/src/main.tsx`,
  and the picture routes in `apps/api/src/panel/**`.

**How the painter uses the scene.**
- It mounts the exported `createKingdomScene` read-only, through the existing hooks.
- It waits for the real readiness flag, and sets the hour from the shared clock (`/api/realm/clock`).
- It captures with the browser's own screenshot: Playwright on this host, or `pc shot` on the real GPU. So the renderer
  needs no change.
- It never copies or forks renderer code, and never adds a second camera API.
- If the grand land becomes every kingdom's land this round, the painting follows automatically.
- Expect slow cold loads on the grand land (about 56 s today). The painter keeps one page warm per active kingdom
  instead of loading one for each painting.

**needs: from grand-world (not blocking PW10):**
- `needs: grand-world` A still from the stream view. The stream host runs on the streamer's real GPU in OBS. It should
  publish one small still a minute to `POST /api/panel/v1/stills`, authenticated by the broadcaster's realm session in
  the same way as the dock. That needs:
  - a method on the scene instance, such as `still(width): Promise<Blob>`, that renders and reads one frame in the
    same task;
  - one call in `apps/web/src/stream/index.tsx` to the lane's publisher module, which is framework-free and lives in
    `apps/panel/src/publish/` or `apps/web/src/panel-painter/publish.ts`.

  Until this lands, the painter is the source and the panel says when each painting was made.
- `needs: grand-world` Gift effects (PW12). Each gift becomes a committed public moment from the realm, with a typed
  payload: kind, credit line, the target home or person, and duration. Playing it in the world and on stream means
  mounting through the scene's existing moment hooks. For each gift, the exact payload and a proposed mount go in a
  `needs:` line. A gift with no effect mounted is not offered on the shelf.

## 3. front-door: the `packages/ui` kit, fonts and the gateway

**Owners.**
- front-door owns `packages/ui/**`, the fonts, `apps/api/src/public/**` and `scripts/public/**` except
  `extension.mjs`.
- This lane owns `scripts/public/extension.mjs` and, this round, `deploy/public/EXTENSION-STEPS.md`.

**The kit.**
- The panel reads `@chatdom/ui/kit.css`: its tokens (`--cd-wood*`, `--cd-brass*`, `--cd-parch*`, `--cd-ink*`), its
  faces and type scale (floor 12 px), and its focus wire. It also uses the passport and card components already in
  `@chatdom/ui`.
- The panel never edits `packages/ui`. If it needs a token or component the kit lacks, it builds it locally inside
  `apps/panel` with kit tokens and writes `needs: front-door` with the proposed addition.
- The panel's `@font-face` rules move from `apps/web/src/atlas/assets/fonts` (atlas-map's folder) to the kit's fonts.
  If front-door changes the faces or tokens tonight, the panel follows on its next session.

**The gateway.**
- `apps/api/src/public/routes.ts` already sends `/api/panel/*` to the panel handler, so it needs no change.
- `apps/api/src/public/main.ts` builds that handler with `createPanelHttp(...)`. This lane needs one line there to
  build its composed handler from `apps/api/src/panel/**` instead. The new handler still serves `/reading` and
  `/passport` through the existing code.
- That is a small additive edit to a front-door file. Make exactly that one change, mention it in progress, and change
  nothing else in `public/`.
- The existing `apps/api/src/public/panel/**` files stay where they are and stay front-door's. This lane wraps them and
  never edits them.
- `PUBLIC_PANEL_EXTRA_ORIGINS` already lets the operator origin call the lane gateway, for example
  `http://localhost:5192`.

**The extension build.**
- `scripts/public/build.mjs` (front-door's) calls `extension.mjs`. Keep its command line and outputs compatible.
- The paintings are images served from `https://chatdom.io`, so the console needs `https://chatdom.io` in the image
  domain allowlist. Put this in `EXTENSION-STEPS.md`.

## 4. Other lanes

- **raid-show (owns `apps/herald/**`).**
  - `needs: raid-show` "!chatdom quiet" and "!chatdom forget" in the Herald's command parser. Each calls the realm's
    quiet or forget function from §1 through the Herald's existing realm route. This lane supplies the realm function
    and its test.
  - `needs: raid-show` Herald scopes. `apps/herald/src/auth/grants.ts` asks for `bits:read`, `channel:read:hype_train`,
    `channel:manage:redemptions` and `channel:manage:polls` at founding. Tech §7.2 says founding asks only for tier 1,
    and tier 2 and tier 3 come later, one press at a time. The panel never asks for scopes. Its config page links to
    "Found your kingdom" and describes tier 1 only.
  - Raid arrivals reach the panel as committed realm deliveries, so no extra seam is needed. The panel only reads them.
- **play.** Walker presence already reaches the realm, so the panel needs nothing for B02. When play's look storage
  lands (`apps/realm/src/look/**`), the plate's portrait reads it read-only (Backlog, C03).
- **forge-wish.** Forge reveals reach the panel as committed realm deliveries, read only. "Walk in" to the Forge links
  to the kingdom's real entry, never to an invented deep link.
- **atlas-map.** No seam. The unclaimed sketch is painted from the land generated for the channel ID by the existing
  generation code, read-only.

## What Tobias provides

These are not seams between lanes, but the panel depends on them:

1. **Create the extension** by following `deploy/public/EXTENSION-STEPS.md`, then set `TWITCH_EXTENSION_CLIENT_ID`
   and `TWITCH_EXTENSION_SECRET` (the base64 extension secret).
2. **For Gifts reconciliation and product registration:** set `TWITCH_EXTENSION_CLIENT_SECRET`. This is the
   extension's OAuth client secret, which is a different value from the extension secret.
3. **Turn Bits on** for the test version, and run Hosted Test on tobi4s_.
4. **For real Bits after review:** complete developer monetisation onboarding on a separate account (`Twitch.md` §17).
5. **Register the sign-in redirect URI**, so that "Walk in" can sign viewers in.
