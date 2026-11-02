# Lane panel-window

**Spec:** the goal rows in `work/lanes/panel-window/context/` (`03-panel.md` C01 to C07, `02-first-night.md` B01 and
B02) and Tobias's answers in `context/decisions.md`, which win over everything else. `work/specs/07-panel-stream.md` is
the earlier panel contract: R1, R3 and R5 to R7 (minus the overrides below), R12 and R13 still hold. Its SIMULATED rules,
its "With my name / Mine, but unnamed" choice and its hidden-in-production shelf are overridden by decisions 25, 5 and 27.

**Branch:** `lane/panel-window`, from main `0e92df4`.

**Worktree:** `/srv/chatdom/panel-window`

**Scope (refined):**
- `apps/panel/**`: the extension (viewer, mobile, config and live config views), its local harness and Helper mock,
  its look script, and a dev bench for fixtures that the zip never contains.
- `apps/api/src/panel/**` (new): the panel backend. It wraps the existing reader in `apps/api/src/public/panel/**`
  (front-door's folder) instead of moving it.
- The realm's panel door: new `apps/realm/src/ingress/panel*.ts` or `apps/realm/src/ingress/panel/**`, and one new
  migration file in `apps/realm/src/persistence/migrations/` for the panel's own tables.
- `apps/web/src/panel-painter/**` (new, claimed by this lane): the page that paints the kingdom's picture with our own
  renderer. Add one line to the `lanePaths` map in `apps/web/src/main.tsx`.
- `scripts/public/extension.mjs`, and `deploy/public/EXTENSION-STEPS.md`. No other lane edits that file this round.
- `packages/shared/src/panel.ts` (new, additive only), if a contract must be shared between the API and the realm.
- Small additive lines in shared entry files, one registration per line: `apps/realm/src/main.ts` to compose and
  mount the panel door, and the panel handler line in `apps/api/src/public/main.ts` (see `SEAMS.md`).
- `work/lanes/panel-window/**` and `work/evidence/panel-window/**`.
- Added 2 Nov 2026 under the 12:18 progress note (finished owner, no active owner this round), for the live Passport
  entry only. These edits must be additive and backward-compatible, and committed separately before the panel's
  change (`SEAMS.md` §3):
  - `packages/ui/package.json` (one export line), `packages/ui/src/passport/live.ts` (new), and the seal lines in
    `Book.tsx` and `Reading.tsx`. Owner: front-door, finished FD10–FD13.
  - `packages/shared/package.json` (one export line), `packages/shared/src/passport-core.ts` and `passport-live.ts`
    (new), and `passport.ts` re-exporting the core. Not owned by any lane this round.
  - `apps/api/src/passport/contracts-core.ts` and `live-contracts.ts` (new), and `contracts.ts` re-exporting the
    core. Not owned by any lane this round; raid-show's stamps port lives in `read.ts`, which this lane doesn't touch.

**Reads:**
- `chatdom/ChatDom.md` (principles, §8 money lines), `chatdom/Twitch.md` §4, §16, §17 and §19, and `chatdom/Tech.md`
  §7.1, §7.2 and §7.5.
- `chatdom/Quality.md` and `chatdom/Artstyle-Soul-Feel.md` (the UI sections).
- `work/specs/07-panel-stream.md`, `03-herald-presence.md`, `26-kingdom-light.md` and `19-citizen-card.md`.
- `work/HANDOFF-LANES.md`, the rows for try-it, panel-stream, card-passport, citizen-card, passport, growth-card and
  live-twitch.
- `apps/realm/README.md` (presence ingress) and `apps/realm/src/evening/README.md` (first-chat settlement).
- `deploy/public/EXTENSION-STEPS.md` and `packages/ui/README.md`.
- `.agents/skills/twitch-extensions`: `helper-api`, `jwt-and-ebs`, `bits-and-monetization`, `config-service` and
  `dev-workflow`.
- `SEAMS.md` in this folder.

**Boundaries:**
- You may read these, but never edit them:
  - the kingdom scene, renderer and stream host (grand-world);
  - `packages/ui/**` and fonts (front-door);
  - `apps/api/src/public/**` except the one gateway line (front-door);
  - `apps/herald/**` (raid-show);
  - the realm's persistence, allocation, presence reducer and `evening/` (main and the integrator);
  - existing exports in `packages/shared`.
- Ask for anything outside your scope with an exact `needs:` line that includes the patch, and keep going.
- Never touch the live gateway on 5480, the realm on 5197, the API on 5196, the preview on 5190, the other ports from
  5193 to 5197, the Atlas data service, containers or routes.
- No extension console actions, no submission for review, no deploys and no Twitch writes.

## The part

The panel is a small, beautiful window under the video. A viewer on twitch.tv/tobi4s_ scrolls below the stream and sees
the kingdom as it is right now: a painting from our own renderer, refreshed every minute, with tonight's lights counted
and the current moment shown as it happens. One button, **Take your place**, shares who they are, claims their home and
lights their window in a single gesture. From then on the plate says "Your window is lit", with their name and street,
and the light burns whenever they are there: chatting, watching with the panel open, or walking in the kingdom while the
stream is live.

There are three tabs and almost no text:
- **Kingdom:** the living picture, tonight's lights, the moment, and "Walk in" links to the kingdom, the tavern and the
  Forge. Each link leaves Twitch and says so.
- **You:** your window, your card and your passport.
- **Gifts:** a permanent shelf of moments the whole kingdom sees, ready for Bits once the extension exists.

Every state has its own picture and one line. That includes:
- logged out of Twitch;
- logged in but not shared yet;
- three homes already held, so a guest light;
- a channel with no kingdom yet, which shows a private sketch of the waiting land, a tent pledge and a nudge to tell the
  streamer;
- moderated, which is quietly dark;
- an unreachable kingdom;
- an offline stream, which shows the resting picture and when it was painted.

Nothing on the panel is simulated or labelled as simulated. It shows real data or a designed absence.

The bar: someone who has never heard of Chatdom understands the panel at a glance, taps once, and sees their own window
lit in the next painting. Every view reads like one carved object, made of the same wood, brass and parchment as the
Atlas and the citizen card. Everything switches on the moment Tobias drops in the extension's client ID and secret,
without a code change.

## Goals

- [x] **PW10 — The window under the video: three tabs, the live kingdom and "Take your place".**
  *Outcome.* The panel is redesigned into the three tabs, Kingdom, You and Gifts, on one quiet plate. Tavern and Forge
  become "Walk in" links inside Kingdom.

  **The Kingdom tab** shows:
  - A painting of the kingdom as it is now, rendered by `apps/web/src/panel-painter` with our real renderer from the
    realm's real state at the shared clock's hour. Each painting carries the time it was made.
  - Tonight's lights, counted from the realm's public presence frames.
  - The current moment in one line, for example a home raised, a Forge reveal or a raid arriving. It is read from the
    realm's committed public deliveries and polled while the panel is visible.

  The painter is a page plus a small runner. It keeps one headless page warm per active kingdom, renders a small frame
  once a minute while the stream is live (once an hour while it rests, and only when something changed), and stores a
  WebP of about 60 KB or less through the panel API.

  **The You tab** carries one button, "Take your place". In one gesture it:
  1. calls `requestIdShare` if needed;
  2. claims the viewer's home through the realm's existing allocation services. The three-home cap, the castle for the
     monarch and placement by tenure all stay with those services, and unknown tenure stays unknown;
  3. lights the window by committing a `panel` presence observation through the existing ingress gate.

  After that the plate always reads "Your window is lit", with the name, the street and a portrait slot that stays
  empty until a real portrait exists. The existing card and passport are one tap deeper.

  **Every B01 state is designed and works against the real code paths:**
  - outside Twitch;
  - logged out;
  - not shared yet;
  - sharing;
  - lit;
  - guest at three homes;
  - channel not founded. This shows a still of the land generated from the channel ID, a tent pledge stored privately
    and outside the three-home cap, and a ready line, "Tell <streamer> their kingdom is waiting";
  - moderated, which is quietly dark and never accusing;
  - the kingdom out of reach;
  - the stream resting.

  **The Gifts tab** exists in this goal in its honest closed state: the shelf of moments with one line saying gifts open
  when the channel turns them on. Nothing on it looks tappable.

  **The backend** lives in `apps/api/src/panel/**`: light, presence, kingdom (picture, lights and moment), picture
  files and pledge. Every route verifies the extension JWT. The channel comes only from the token, and the person only
  from its `user_id`. The realm's panel door handles claim and pledge. `requestLight` stops being a no-op.

  **Fixtures.** The SIMULATED fixture adapter, the `?source=simulated` switch and every "Simulated" chip leave the
  extension. Fixtures live only on a dev bench, unlabelled and unreachable from the zip.

  *Quality bar.*
  - The first view of each tab uses 12 words or fewer.
  - The picture dominates the plate.
  - The decorative face (IM Fell) is used only for headings. Body text uses the kit's readable face at 13 px or more,
    and nothing is smaller than 12 px.
  - Targets are 44 px. The first view at 318×496 never scrolls, and nothing clips.
  - Mobile at 390×844 gets a thumb-first layout with the same three tabs.
  - The window lights within 5 s of the tap in the lane stack, and the next painting shows it lit.
  - First load is 1 MB or less, and the zip contains no three.js.
  - Tokens never reach the DOM, a URL, storage or a log.
  - It reads as one carved object with the Atlas and the card, not as a dashboard.

  *Done when:*
  - The whole path runs end to end in the lane stack: the operator with the Helper mock, which issues real HS256 tokens
    signed with a lane-only test secret, then the lane's own gateway and panel API, then the lane's own realm on its own
    schema and port. The tap commits a real deed and a real panel observation.
  - An integration test against the real realm code covers:
    - claim;
    - a repeated tap (idempotent);
    - guest at three homes;
    - the monarch's castle;
    - an unfounded channel, including the pledge;
    - moderated;
    - unshared and logged-out viewers, who are refused;
    - a forged or expired token, which is refused.
  - Stills taken on the real GPU through `pc-lease` are in `work/evidence/panel-window/` and you have looked at them:
    - every tab;
    - every join state at 318×496 and 390×844;
    - a before, tap and after sequence of the painting, with the window lit after the tap.

    Use one short SwiftShader still only if the tunnel is down, and say so.
  - The evidence notes record a word count for each view.
  - A refresh test shows that the painting changes after a minute and that polling stops while the panel is hidden.
  - `node scripts/public/extension.mjs` builds a zip that passes its checks, contains no fixture code or "simulated"
    strings, and lists the new allowlist needs.
  - Focused typecheck and tests for the packages you touched are green.

  This goal must be reviewed and checkpointed by Monday morning, so build in this order:
  1. the redesign;
  2. the claim and light;
  3. the painting;
  4. the pledge, last.

- [x] **PW11 — Your light burns while you are there.**
  *Outcome.* Once a viewer has shared, their window lights within 5 s of being present and dims after a quiet absence,
  always under their name (decision 5). There are three presence sources:
  - **Chat** through the Herald. This already exists; prove it.
  - **The panel**, open on the live channel. The panel sends a first observation at once, then one a minute inside the
    90 s lease. It counts only while all of these hold:
    - the stream is live;
    - the panel is visible (`onVisibilityChanged`);
    - the video is playing (context `isPaused` is false);
    - the viewer has shared.

    It stops at once when any of these turns false. The viewer is never asked "are you still there?".
  - **Walking** in the kingdom while the stream is live (decision 11), through the realm's walker source. This already
    exists; prove it alongside the others.

  The You tab gains two controls:
  - "Keep my name off the stream", which works like "!chatdom quiet";
  - "Forget me", which works like "!chatdom forget" and needs a clear confirmation.

  Both go through the realm's panel door to one realm function each. That one function also serves the chat commands.
  The Kingdom tab's painting shows a street coming alight as people arrive.

  *Quality bar.*
  - The panel never sends presence for a logged-out or unshared viewer, a hidden panel, a paused video or an offline
    stream.
  - Closing the panel stops the heartbeat at once, with no lingering timers.
  - Dimming follows the realm's lease rules, never a panel timer.
  - Quiet changes only what the stream shows: the card and the home stay the viewer's.
  - Forget erases the person's Twitch-derived records in the realm, says what was erased, and leaves other people's
    things alone.

  *Done when:*
  - Tests in the lane realm show, for each source (chat, panel and walker), lit within 5 s and dim after absence.
  - Tests cover the panel's stop conditions (hidden, paused, offline, unshared and closed).
  - Tests cover quiet and forget through the panel door, including forget followed by a new "Take your place".
  - A real-GPU still sequence of a street lighting up is in the evidence folder, and you have looked at it.
  - The two hooks outside this lane's scope are written out as exact `needs:` lines with patches (see `SEAMS.md` §1
    and §4): the Herald parsing the two chat commands, and the stream's public name projection honouring quiet. If they
    land during the round, an end-to-end test covers them.

- [ ] **PW12 — Gifts, ready for Bits.**
  *Outcome.* The Gifts tab becomes the real shelf (decision 27, C04):
  - It is always one tap away, and it never opens or moves by itself.
  - It holds a catalogue of 15 to 25 moments that the whole kingdom sees. Examples: fireworks for a friend, light every
    lantern on my street, kites over the square, ring the bell for someone, dress my home for the night, a parade and
    a royal feast. "Wear a look for a day" is removed, because decision 27 rules out cosmetic choices for Bits.
  - Twitch prices Bits products per extension, not per channel. So each moment has two or three SKUs at band prices.
    The streamer picks about 8 moments and one band for each (the config page comes in PW13).
  - The panel offers only gifts that can actually be delivered: Bits are enabled (`isBitsEnabled`), the stream is live,
    and the moment's world effect exists.

  The flow:
  1. `useBits(sku)` starts the gift, and a friend picker (a list, never free text) appears where the moment needs it.
  2. The transaction receipt goes to `apps/api/src/panel/**`, which verifies it with the extension secret.
  3. The API removes duplicates by transaction ID and delivers the gift exactly once to the realm's panel door, as a
     committed public moment with a credit line.
  4. The moment appears in every panel's Kingdom tab.

  Once the extension's OAuth client secret is set, the `extension.bits_transaction.create` webhook and Get Extension
  Transactions reconcile gifts from viewers who closed the page before the receipt arrived.

  The rules for every product:
  - The copy follows Twitch's wording: get, use, give. Never buy, spend, cost, price or support.
  - Nothing is permanent or lasts past a day.
  - No random contents, no free text and nothing about an outcome.
  - Nothing gives light, rank, place, coal or tenure.

  Check "a bard's song" against the Bits rule against music on request (6.2.2). Keep it only as a spoken or written
  verse, and record that decision.

  *Quality bar.*
  - The shelf feels like a place for small celebrations: warm, quiet and legible.
  - Never use countdowns, scarcity or nagging.
  - The pending, delivered and cancelled states each look and sound different.

  *Done when:*
  - Stills at both sizes cover the closed state, the open shelf, the friend picker, pending, delivered and cancelled.
  - Tests cover:
    - a forged receipt, which is refused;
    - a replayed receipt, which is delivered once;
    - a cancelled transaction, which is not delivered;
    - the webhook and the receipt racing, which still delivers once;
    - an unknown or retired SKU, which is refused;
    - a gift whose effect does not exist yet, which is not offered;
    - a wording check over all catalogue copy.
  - In the lane stack, a gift made with the Helper mock goes from the tap to the moment line in a second open panel.
  - The world and stream effect for each gift is either mounted by its owner or written out as an exact `needs:`
    (`SEAMS.md` §2).
  - A real test-mode gift in Hosted Test is the first item on PW13's checklist. Until it has happened, say plainly that
    C04's purchase bar is still open.

- [ ] **PW13 — Switched on the moment the extension exists.**
  *Outcome.* The panel works without a code change once two values are set:
  - `TWITCH_EXTENSION_CLIENT_ID`
  - `TWITCH_EXTENSION_SECRET`

  Gifts reconciliation and product registration also need `TWITCH_EXTENSION_CLIENT_SECRET`, the extension's OAuth
  client secret.

  When the values are set, these work:
  - CORS for the extension's origin, and token verification.
  - Extension PubSub broadcasts, so moments reach open panels within a second. Polling stays as the fallback.
  - The Configuration Service, used by `config.html` and `live_config.html` (C07). It holds the tabs the streamer shows,
    their gift picks and bands, and whether the channel is connected. Live config gets a Hide that pauses
    panel-driven moments.
  - A script that registers the products from the catalogue.
  - A script that subscribes the Bits transaction webhook.

  The extension tooling is updated:
  - `scripts/public/extension.mjs` builds the zip.
  - `deploy/public/EXTENSION-STEPS.md` covers Bits on, Configuration set to hosted, Request Identity Link, the image
    domain allowlist for the paintings, and mobile.
  - The config page's "Found your kingdom" link opens only the tier 1 scopes from Tech §7.2. The mismatch in the
    Herald's grants is a `needs:` line, because this lane does not own that file.
  - The mobile view (C06) is finished: the same three tabs, thumb-first, and 1 MB or less.

  *Quality bar.*
  - A rehearsal of the switch-on is boringly reliable.
  - Every missing value is named in one plain line in the health output, never as a stack trace, and never by printing
    a value.

  *Done when:*
  - A switch-on rehearsal passes. It starts the lane gateway with a generated test client ID and secret and walks the
    whole panel through the operator: read, join, light, a moment over PubSub, config save and a gift.
  - Stills of the config page and the live config page are in the evidence folder at both sizes.
  - The zip passes its checks.
  - `work/lanes/panel-window/HOSTED-TEST.md` is a numbered checklist for Tobias, 15 steps or fewer, that ends with the
    first test-mode gift.
  - If Tobias has run Hosted Test during the round, the real results are recorded. If not, the notes say so plainly.

## Decisions

1. **Three tabs: Kingdom, You and Gifts** (C01). Tavern and Forge are "Walk in" links inside Kingdom. Each link opens
   a new tab, is marked as leaving Twitch and is never the panel's main use.
2. **One button, "Take your place"** (decision 5, B01). Sharing once is the consent, so there is no unnamed choice.
   The window is named, and lit while the viewer is present.
3. **Identity comes only from the verified extension JWT.** The person is its `user_id`, present only after the
   share. The channel is its `channel_id`, never a body or query value. An opaque `U` or `A` ID never becomes a
   person, and a logged-out viewer is never tied to anything that lasts.
4. **Claim uses the realm's existing allocation.** That covers the three-home cap, guests, the castle and placement by
   tenure. Unknown tenure stays unknown, and a newcomer gets what a first chat message would give them. The lane writes
   no second allocator. The panel door composes the existing services, for example the citizens settler, in the
   realm's `main.ts`.
5. **The light is a `panel` presence observation through the existing ingress gate.** The gate already grants
   `panel` one person's own observation. Use `REALM_INGRESS_PANEL_SECRET`. The lane never adds a new presence path.
6. **Panel presence rules:** live, visible, video playing, and shared. There is no "still there?" prompt, because a
   prompt would nag, and paused video and visibility are honest idle signals. Refine the rules only with a test and a
   note.
7. **The picture is a render of the real kingdom by our own renderer.** It is never the fixture, stock art, a CSS
   landscape or generated art. Sources, best first:
   1. stills from the stream view running on the streamer's GPU, once `SEAMS.md` §2 lands;
   2. the panel painter.

   Every picture shows when it was painted. While the stream is offline, the panel shows the resting picture and its
   time.
8. **Moments reach the panel by polling in PW10**, then by Extension PubSub in PW13, with polling kept as the fallback.
9. **Unclaimed land (decision 3):** a private sketch, a tent pledge and a nudge.
   - The sketch is a painting of the land generated from the channel ID.
   - A pledge is a private record keyed by channel and person. It is outside the three-home cap and shown only as a
     count in bands.
   - The nudge is a ready line to tell the streamer.

   Turning pledges into tents at founding is a `needs:` for the founding owner.
10. **Gifts (decision 27):**
    - a permanent tab and a catalogue of 15 to 25 moments;
    - the streamer picks about 8;
    - bands are separate SKUs, because Twitch prices per extension;
    - no cosmetic choices;
    - the copy follows Twitch's wording rules;
    - a gift is offered only when it can be delivered;
    - receipts are verified on our server, and each gift is delivered exactly once by transaction ID.
11. **No SIMULATED labels (decision 25).** The fixture leaves the extension. Fixtures live on a dev bench only,
    unlabelled and unreachable from the zip. The zip check fails if fixture code is inside.
12. **Typography:**
    - Use the shared kit's faces from `packages/ui`, not the Atlas folder.
    - The decorative face is for headings only.
    - Body text is 13 px or more; nothing is below 12 px.
    - If front-door changes the kit, the panel follows it.
13. **The panel backend lives in `apps/api/src/panel/**`.** It wraps the existing `public/panel` reader and passport
    routes rather than moving them, so front-door's folder stays theirs.
14. **The painter lives in `apps/web/src/panel-painter/**`.** It uses the exported `createKingdomScene` read-only and
    captures through the browser's own screenshot, so it needs no change to the renderer. When the grand land becomes
    every kingdom's land, the painting follows with no change to the panel.
15. **Quiet and forget** each live in one realm function. The panel controls and the Herald's chat commands both call
    them.

## How to work

- **Goals, not tasks.** Work on the first unticked goal. A goal can take many sessions:
  - Leave everything building.
  - End each session with a line in `progress.txt`: `next: PW1x <what is done> / <what remains>`.
  - Tick a goal only when its done-when bar is truly met.
  - Write ideas into the Backlog, one line each, and don't build them.
- **Never run git.** That means no commits, merges, stashes or resets. A reviewer reads your progress, checks the work
  and commits the checkpoint. This overrides the commit steps in `ralph-lane`.
- **Checkpoints.** After each coherent step, leave the worktree building and write a progress line saying what
  changed, what you checked and what you doubt. The integrator merges reviewed checkpoints continuously. PW10 must be
  reviewable by Monday morning.
- **The local stack.** You test end to end against the real code, never against fixtures.
  - The dev Postgres is on 127.0.0.1:5410. Use your own schema, `panel_window`, through `REALM_DATABASE_SCHEMA`, and
    migrate it with `apps/realm/scripts/migrate.mjs --schema panel_window`. Never use the live schema.
  - Run your own realm and gateway or panel API on free ports between 5170 and 5186. Port 5187 is reserved for
    captures. Check that a port is free before you use it, and write it down in progress.
  - Start them only for a test or a lease, and stop them afterwards.
  - Load secrets with `--env-file` or `source`, and never print them.
  - Generate the lane-only extension test secret and ingress secret yourself, and keep them out of the repo.
- **The Helper mock.** The real Helper only runs inside Twitch, so the operator serves its own `window.Twitch.ext` in
  place of the Twitch CDN script. It must:
  - issue real HS256 tokens signed with the lane's test secret;
  - move between logged out, unshared and shared, including the `requestIdShare` prompt and the refreshed
    `onAuthorized`;
  - drive `onVisibilityChanged` and `onContext` (paused or playing);
  - set `features.isBitsEnabled`;
  - provide `bits` (`getProducts`, `useBits`, and the transaction complete and cancelled events, with signed receipts);
  - provide `listen` for PubSub.

  The mock lives only in the operator, never in the zip. Real Hosted Test needs Tobias.
- **Hands off the live stack.** Never touch the live gateway on 5480, the realm on 5197, the API on 5196, the preview
  on 5190, the other ports from 5193 to 5197, the Atlas data service, containers or routes. Reading chatdom.io's public
  routes like any visitor is fine. Writing to the live realm, or starting a second writer on its schema, is not.
- **Real GPU through `pc-lease`.** Use `chatdom-pc-lease` and read its header first.
  - Inside a lease, serve the operator on 127.0.0.1:5192 and the lane gateway on 5191.
  - Shoot with `chatdom-pc shot http://localhost:5192/... out.png --size 318x496`, and also at 390x844.
  - Paint with the painter on the real GPU too.
  - Keep a lease to a few stills, 10 minutes at most.
  - If the tunnel is down (exit 3), take one short SwiftShader still under the shared capture lock and say so.
    SwiftShader timings are never performance evidence.
- **Look at the stills.** Put PNGs of about 2 MB or less in `work/evidence/panel-window/` and look at them at full
  size. Compare them with `chatdom/Quality.md` and the art style, fix what looks cheap, and record a word count for
  each view.
- **No SIMULATED labels** anywhere the panel can reach, and no fake success. If an authority is missing, the panel
  shows a designed absence in one line.
- **The host is shared.** Typecheck and test only the packages and files you touched. Never run the full suite or
  `pnpm verify`, keep builds niced, and run no long CPU renders.
- **Seams.** `SEAMS.md` is frozen today. For anything outside your scope, write a `needs: <owner> <exact patch>` line
  in progress and keep going on what doesn't depend on it. Never edit another lane's files.
- **Repo text.** Keep thread IDs and tool or model names out of the repo, and write in plain English.
- **Twitch.** Make no writes. If a check really needs a chat line, it goes only to tobi4s_'s own channel.

## Backlog

- C03 real portrait and look on the plate, from play's look storage (`apps/realm/src/look/**`), once it lands.
- C03 passport stamps from real raids and visits, with a working hide switch, from raid-show's stamps.
- C05 live doorways in Kingdom: who is at the tavern tables now, and the last things forged.
- B07 welcome back: the panel's side of the 14-day relight.
- C06 recording on a real phone in the Twitch app (needs Tobias's phone).
- Day-long gifts wait for Twitch's written answer (open question). Submit the end-of-stream gifts first.
- Stills published from the stream view on the streamer's GPU, once grand-world adds the `still()` hook.
- A portrait painting for the phone's tall plate, so the window pan keeps the keep in frame and the picture stays sharp.
- A walkable unclaimed sketch (A05), when someone owns it. The panel shows only its painting.
- Panel crowd acts (strike, vote, haul) with the same limits as chat, once their realm commands exist.

## Round notes (settled across all eight lanes; these win over anything above)

- **Lanes this round:** grand-world, play, forge-wish, front-door, atlas-map, raid-show, panel-window, a video studio lane. They all run at the same time. Each one owns only its own scope. Their reviewed checkpoints are merged together continuously into one integration branch, and that branch becomes the release on Monday.
- **Realm migrations:** each lane has its own number. raid-show `0011`, panel-window `0012`, play `0013`, forge-wish `0014`, grand-world `0015`. A lane that needs a second one appends a letter, for example `0012b`. If the migration runner needs contiguous numbers, the numbers are renumbered when the lanes are merged; never renumber another lane's file.
- **Raid roads:** pull, not push. raid-show owns the durable, append-only feed of witnessed raids, `GET /realm/raid-roads?after=&limit=`, with items that follow `AtlasRaidSchema` (`packages/shared/src/atlas-raids.ts`). atlas-map pulls from that feed with a cursor into its own road ledger, so it can catch up after a restart. atlas-map's `POST /v1/roads/observe` is optional and raid-show does not depend on it.
- **Contracts:** adding to `packages/shared` is allowed for every lane: new files and new optional fields, but no changed or removed exports. The realm modules for your own feature are yours (Forge modules for forge-wish, raid-gate for raid-show, the panel ingress for panel-window, look storage for play). Hooks into the realm core (rooms, lifecycle, server.ts, main.ts) are small, additive and typed, written up in your SEAMS.md. "Widen the contract" is not something to wait on main for.
- **Shared allowlists and configs:** `apps/api/src/public/routes.ts` (the public gateway allowlist, owned by front-door), `apps/web/src/main.tsx`, `apps/web/vite.config.ts` and package.json scripts take one additive line per route or registration from any lane. No reformatting.
- **SIMULATED:** front-door stops the shared kit from rendering any SIMULATED chip but keeps every exported name. Each lane removes the chips and fixtures in its own scope and updates its own tests. Leftovers are fixed when the lanes are merged.
- **Real GPU:** `chatdom-pc-lease` (its header is the manual) and `chatdom-pc shot|fps` with full `http://localhost:5192/...` URLs. Each lease is at most 10 minutes. Render long sequences in chunks across several leases.
- **Engine:** a lane run by an engine that commits its own work commits each checkpoint on its lane branch as `.agents/skills/ralph-lane/SKILL.md` says. A lane whose worker is told "never run git" leaves the commits to its reviewer. Both are fine, and only the instruction you were given applies to you.
