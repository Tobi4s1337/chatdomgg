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
- Done in PW11 (2026-11-02), inside the lane: the quiet projection. `main.ts` (one composition line) gives the public
  watch route `disclosedServices(boot.services, createQuietDisclosure(…))` from the lane's `ingress/panel/disclosure.ts`.
  Its `retain` returns the kingdom seen through quiet. `bootstrap/watch.ts` is unchanged.
- `needs: main` Renewed consent after forget. `restore` gains an optional `consent: 'renewed'` in
  `packages/shared/src/presence.ts`, and the reducer in `packages/world/src/presence.ts` lets it lift only a forget
  hold. The change is additive and comes with a reducer test. The exact patch is in `PW11-RENEW-NEEDS.patch`
  (dry-run clean). Until it lands, the lane reports `renewal: 'pending'` and the panel says the window stays dark
  after forget.
- `needs: main` + `needs: grand-world` Walker labels under quiet. `RealmObservedWalker.name` becomes nullable, and
  the stream's walker track draws no label for a nameless walker. Until it lands, the lane's redaction leaves a quiet
  walker (and their seat) out of the stream's walker frame, so their name never reaches the stream; they still walk in
  the kingdom. Once the schema accepts a nameless walker, the same redaction lets them walk on the stream unlabelled,
  by itself. The exact patch is in `PW11-WALKER-NEEDS.patch` (dry-run clean).
- `needs: raid-show` The Herald parses `!chatdom quiet`, `!chatdom quiet off` and `!chatdom forget`. It posts
  `{ version: 1, kingdomId, personId, command }` with the Herald secret to `POST /internal/realm/chat/privacy`, and
  passes the realm's `reply` line to a chat sender. The sender posts without an @-mention, and in development only
  to twitch.tv/tobi4s_. The exact patch is in `PW11-HERALD-NEEDS.patch` (dry-run clean).
- Done in PW11 (2026-11-02), inside the lane, and the one exception to "never alters existing ones": migration
  `0012f_realm_panel_forgotten.sql` adds `realm_panel_forgotten` (one row per person and origin) and
  `realm_panel_returned` (kingdoms they took their place in again since), with two triggers on main's tables:
  - `BEFORE INSERT` on `realm_ingress_inbox` stores an observation without the entry of anyone forgotten in its origin
    who has not returned to that kingdom. It changes no column or existing row, leaves the digest and every other
    person as sent, and does nothing while nobody is forgotten. Every ingress source and realm process stores through
    that insert.
  - `BEFORE INSERT OR UPDATE` on `realm_citizen_names` skips (never refuses) the name write of a forgotten person who
    has returned nowhere since.
  - Both take one shared advisory lock (`realm_panel_forget_barrier`); forget takes it exclusively once after its note
    commits, so it waits out writes that checked before the note.
  `ingress/inbox.ts` and `evening/citizens.ts` are unchanged. If main would rather own these rules in
  `PostgresIngressInbox.accept` and the citizens' name write, the triggers are the exact rules to move, and the lane's
  tests in `privacy.integration.test.ts` cover them either way.
- Done in PW11, `main.ts` composition: `ForgetGuard` (lane, `ingress/panel/privacy.ts`) wraps first-chat settlement
  (`beforeObservation`) and the moments' settler (`useSettler`), so neither makes a home or a name for a forgotten
  person, and is handed to the panel and chat doors so forget waits for settlement already under way. Two changed
  lines and one added line; `evening/` and `moments/` are unchanged.
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

**Mount recipe for the gifts (PW12), for grand-world's install on the grand land.**
- Entry: the realm's gift feed, `RealmPanelGifts.feed(kingdomId, afterSequence)` (64 facts a page), carried to the
  stream and the walkable kingdom by the transport in `PW12-NEEDS.patch` as a `panel-gifts` event of `PanelGiftFact`
  (`packages/shared/src/panel.ts`). A gift fact is its own type, never a Twitch moment.
- Anchors: each fact names its gift (`giftId`), and `target` is the committed `{plotId, slot}` of a real home, or
  null. The plaza, the gate, the streets, water and the sky are the land's own anchors. The full table of the 20 gifts
  with their anchor and duration is in `PW12-NEEDS.md`.
- Props: one effect per gift id, the same for all three bands. It runs for `endsAt - committedAt` at most (a minute
  to a day), ends by itself, and restores quietly on reconnect without replaying sounds or camera moves.
- Switch-on: an effect is offered on the panel only once `PanelGiftEffectAuthority.ready(giftId)` answers for it from
  `apps/realm/src/main.ts` (contract in `PW12-NEEDS.md`). Until then the shelf stays closed, honestly.

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

**The live Passport entry (applied by this lane, 2 Nov 2026).** front-door finished its round without taking the
Passport patch, so this lane applied it here under the round's rule for finished owners. It is additive and
backward-compatible: the general `@chatdom/ui/passport`, the shared Passport schema and `apps/api/src/passport/contracts`
keep every export, and the bench protocol still reads.
- Owner change (`PW13-PASSPORT-NEEDS.patch`, its own commit): `@chatdom/ui/passport/live` (Book, Reading, session,
  `CrestArms`, view types; no fixtures), `packages/shared` `passport-core`/`passport-live` (live books accept only
  `origin: 'live'`), `apps/api/src/passport` `contracts-core`/`live-contracts`, and the three provenance-seal branches
  removed from Book and Reading (decision 25).
- Panel change (`PW13-PASSPORT-PANEL.patch`, its own commit): the panel's three Passport imports and its transport move
  to the live entry and `readLivePassportReply`.
- Merging with `lane/front-door`: FD11 touched the same three seal lines and `packages/ui/package.json`. Resolve to
  the result of `PW13-PASSPORT-NEEDS-FRONT-DOOR.patch` on front-door: front-door's four exports plus `./passport/live`,
  and no seal lines. The files come out byte-identical either way (`PW13-PASSPORT-PATCH.md`).
  `apps/api/src/passport/share.test.ts:242` expecting `<b>SIMULATED</b>` fails on front-door with or without this
  change. That test is front-door's own FD11 leftover.
- Who owns these files, checked 2 Nov 2026 at 12:30. front-door has ticked FD10 to FD13 and has no open goal. No
  round lane (grand-world, play, forge-wish, atlas-map, raid-show, integrator) has changed `packages/ui/package.json`,
  `packages/ui/src/passport/**`, `packages/shared/src/passport.ts`, `packages/shared/package.json` or
  `apps/api/src/passport/**` against main. raid-show's stamps work plugs into `apps/api/src/passport/read.ts`, which
  this change leaves alone. The PRD scope records the addition.
- Proof that it is backward-compatible: strict tsc is clean over every consumer of these exports, including raid-show's
  `apps/web/src/passport` and `apps/api/src/raid-gate`, the citizen card, the dock and front-door's `public/panel`.
  The shared, API and UI Passport suites pass unchanged, together with every panel suite (211 tests).
- Commit split. The owner change goes in first, as its own commit: `packages/ui/package.json`,
  `packages/ui/src/passport/{live.ts,Book.tsx,Reading.tsx}`, `packages/shared/package.json`,
  `packages/shared/src/{passport.ts,passport-core.ts,passport-live.ts}`,
  `apps/api/src/passport/{contracts.ts,contracts-core.ts,live-contracts.ts}` and this `SEAMS.md`. The panel change
  follows: `apps/panel/src/{Panel.tsx,card/CardSheet.tsx,passport/PanelPassport.tsx,passport/transport.ts,passport/transport.test.ts}`,
  together with `PRD.md`, `PW10-NOTES.md`, `progress.txt` and `work/evidence/panel-window/PW10/passport-live/`.

**Integrator merge, found 2 Nov 2026 at 14:35.** `lane/integrator` (f3b19e19) has both this lane's Passport commit
and front-door's FD11, but its merge kept FD11's text in `packages/ui/src/passport/Book.tsx` and `Reading.tsx`: the
three `ProvenanceSeal state="simulated"` branches and the import came back. Through `@chatdom/ui/passport/live` they
reach the panel's viewer chunk, so `scripts/public/build.mjs` fails with `assets/viewer-*.js: simulation string in the
extension`. `apps/panel/src/model.ts` is not the cause: its `'simulated'` kinds are types, which never reach the bundle.
- `needs: integrator` Apply `PW12-INTEGRATOR-PASSPORT.patch` (`patch -p1`; Book.tsx and Reading.tsx only, the same two
  file hunks as `PW13-PASSPORT-NEEDS-FRONT-DOOR.patch`). Checked on an exported copy of f3b19e19: the patch applies
  cleanly, strict tsc over `packages/ui`, `apps/panel` and `apps/web/src/passport` is clean, and
  `node scripts/public/extension.mjs` passes every hosted-asset check (17 files, 489 KB). The removed props
  (`Cover.simulated`, `ClosedPassport.simulated`) are internal to those files.

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

## from launch

- 2 Nov (LA10): the zip passes; the panel build defines `__CHATDOM_STAGED__=false` (front-door's `## from launch`).
- needs (2 Nov, LA10 walk, for whoever owns the passport now that panel-window is finished): there is no passport on the
  web. On chatdom.io a visitor cannot see their passport or raid stamps at all; inside Twitch it opens from the panel's
  "You" tab. Either a signed-in web route (`/passport`) or a decision that it lives only in the panel.
- 2 Nov (LA10, panel live in Hosted Test on tobi4s_): the open "Walk in" row said "Leaves Twitch for chatdom.gg" and
  its links' labels named chatdom.gg, a domain that does not answer; the links themselves followed the realm's full
  walk address (`https://chatdom.io/?walk=1&kingdom=…`). `gateHref`/`hostOf` now live in `apps/panel/src/gate.ts`
  (base `https://chatdom.io` for a bare path; tested in `gate.test.ts`), and both `Panel.tsx` and `ui/places.tsx` name
  the host the link really opens. Extension zip 0.0.3 carries it (no `chatdom.gg` left in the bundle).
- 2 Nov (LA10): the panel's picture reads "The kingdom is out of view" on Twitch because no panel painter runs in
  production; the steps to run it are `deploy: 4` in launch `SEAMS.md`.
