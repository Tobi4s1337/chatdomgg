# PW11 — Your light burns while you are there

Done 2026-11-02. Quiet and forget are real through the panel door and the realm's chat door. The street sequence was
captured on the real GPU. Every file the lane changes is in its own scope. Three hooks outside it are written as patches:
renewed consent after forget, the Herald's chat commands, and the walker labels. The lane code detects the first and
third by running the shared schema and reducer, so each switches on when its patch lands, with no lane change.

## How it works

- **Light.** Chat, the panel heartbeat and walking are all observations through the realm's ingress. The reducer
  and the 90 s lease decide lit and dim. The panel only stops sending:
  - when it is hidden, paused, offline, unshared or closed;
  - when the stream is not live;
  - when the realm says the person is held or forgotten.
- **Quiet** ("Keep my name off the stream") is one row per person (`realm_panel_privacy`).
  - The stream sees it through a read-time disclosure (`ingress/panel/disclosure.ts`). `main.ts` hands the public
    watch route `disclosedServices(boot.services, …)`: its `retain` returns the kingdom seen through quiet. Public
    deliveries, the public checkpoint and walker frames pass through the redaction; every other member is the kingdom
    itself. The hold resolves only once the quiet set is known, so no frame leaves before it. `bootstrap/watch.ts` is
    unchanged.
  - Presence windows on a quiet person's home or castle lose `publicName`. Moment credits `{ displayName, slot }` on
    those slots become the anonymous credit.
  - Walkers whose home is a quiet slot never reach the stream with their name. Today's shared walker frame requires a
    name, so the stream's frame leaves them and their seat out: they still walk in the kingdom, and only the stream
    does not show them. Once the frame accepts a nameless walker (`WALKER_NAMELESS`, see below), they walk on the
    stream unlabelled instead, with no lane change.
  - Lights, homes, cards, deeds, committed frames and stored names stay exactly as they were.
  - Each kingdom re-reads the quiet set once a second, with one shared query for all its watchers. If the read
    fails, it withholds every name.
  - The panel's own kingdom reader already intersects names with the projection, so the panel reply says
    `projection: applied`.
- **Forget** (`forgetPerson`) is about the person, across every kingdom of the origin, including ones they first
  come to afterwards. It answers only after these steps:
  1. Settlement already under way in this realm (a first chat line, a follow or a shared sub) finishes whole, and
     settlement here leaves the person out from now on (`ForgetGuard.close`).
  2. The person is noted as forgotten in the origin (`realm_panel_forgotten`, migration `0012f`: an account number,
     the origin and a time), and any return from an earlier forget is cleared. From that commit on, in every kingdom
     they have not returned to:
     - an inbox `BEFORE INSERT` trigger stores every observation without their entry, whichever source (chat, panel,
       walker) or realm process sends it. Others in the same observation stay. The sender's digest stays, so a retry
       is still a duplicate;
     - the realm's name store skips their name (a `BEFORE INSERT OR UPDATE` trigger on `realm_citizen_names`; skipped,
       never refused, so no sender fails);
     - first-chat settlement and the moments' settler make no home for them (`ForgetGuard`, composed in `main.ts`).
  3. A barrier: forget takes the shared advisory lock that every guarded write holds while it checks the note. That
     waits out any inbox or name write, in any process, that checked before the note.
  4. Only now are the kingdoms that know them found (deeds, guest rooms, the castle, inbox mentions), so a home settled
     in the meantime is among them. Each founded one ingests a `remove forget` hold, so the window goes dark at once
     and evidence already accepted cannot relight it.
  5. One transaction deletes the citizen name rows, the person's provider name, the quiet row and the pledges, and
     strips the person from every inbox observe row, settled or still waiting for its writer. A settled row left
     empty is deleted; a waiting one stays for its writer, without the person.
  - Taking your place in a kingdom records a return there (`realm_panel_returned`) once no forget hold stands there
    (renewed, or never held). Only that kingdom keeps their evidence again; the name store accepts their name again
    once they have returned anywhere. On main's rules a forget hold stands in kingdoms that knew them, so those stay
    dark; a kingdom they first come to afterwards has no hold, and taking their place there lights the window.
  - The panel's presence reply says `forgotten` in every kingdom that keeps nothing of them, with `renewal: 'applied'`
    where no hold stands, so the API sends no observation there and the panel offers "Take your place".
  - The answer lists what was erased and what was kept: homes (they wait), nights (times only, for tenure) and gift
    receipts (Twitch requires them). The panel says exactly that.
  - Forget is safe to repeat. A kingdom under a moderation hold is skipped, so forget can never lift a ban.
- **Taking your place again** renews consent, where the shared presence rules allow it.
  - `CONSENT_RENEWAL` in `privacy.ts` is a real run of the shared schema and reducer: forget, then
    `restore { consent: 'renewed' }`. It is true only once `PW11-RENEW-NEEDS.patch` has landed.
  - With it, the claim lifts the forget hold (only that hold, and only when newer than it), settles the same home,
    the light returns within 5 s, and the Helix name comes back from the verified claim.
  - Without it (main today), the realm writes no control the shared rules cannot read. The claim still answers with
    the home, but the forget hold stands. Every reply says so with `renewal: 'pending'` (privacy, forget, presence and
    the API's light answer). The API sends no observation. The panel words it plainly: the forget confirmation says
    "Your homes stay yours, but your window stays dark."; the Forgotten page ends "Nothing more is noted. Your window
    stays dark."; the You tab shows the dark window and "Your window stays dark" with no button. That is 4 words.
- **Chat** (`POST /internal/realm/chat/privacy`, Herald secret only) takes `quiet`, `quiet-off` or `forget` for the
  verified chatter's own ID. It answers with the line the Herald posts back.

## Decisions

- **Quiet is a read-time projection, not a rewrite.** Committed frames and replays keep the names the person agreed
  to at the time. What is shown live follows today's choice within a second. Turning quiet off brings the name back
  with no re-ingest.
- **Forget is one step in chat as well as in the panel.** The panel asks once ("Forget you in every kingdom?"). In
  chat, `!chatdom forget` is already deliberate and specific. Its damage is bounded: homes stay, and taking your
  place again restores the light once renewal is live. The earlier two-step challenge design is dropped.
- **Until renewal lands, forget stays available and says what it costs.** Main's reducer makes a forget hold
  permanent. Offering forget is a privacy right, so it is not withheld. The panel states up front that the window
  will stay dark, and never offers a light it cannot give. A lane-only workaround (a moderation reason, or dimming
  without a hold) would either mislabel the person or leave their name in the presence record. Both were rejected.
- **Hooks are detected, not configured.** Renewal and nameless walkers are each probed once by parsing through the
  shared schema, plus the reducer for renewal. No flag can drift from the code that actually runs.
- **The inbox guard is a trigger in the lane's migration, not an edit to `ingress/inbox.ts`.** Every source and every
  realm process stores through that one insert, so this is the only place that keeps a forgotten person out of
  evidence that is in flight or arrives later. It adds a table and a trigger, changes no column, and touches only
  the entries of people noted as forgotten. It reads the stored text as JSON, so the lane's own queries match a
  person by `people @> [{personId}]` rather than by the canonical spelling. The review of the previous checkpoint
  found forget scrubbed only settled rows; this closes it.
- **The note is per person, the return per kingdom.** The review of the previous checkpoint found that a per-kingdom
  note let a chat line in a kingdom the person first came to afterwards store, settle and light them, while the panel
  said nothing more was noted. The note now covers every kingdom of the origin, and only taking your place in a
  kingdom (explicit, fresh consent) opens that one kingdom again.
- **Forget waits for settlement, rather than racing it.** A first-chat settlement that read the observation before
  forget began finishes whole (home and name), and forget then finds that home, darkens it and erases the name. The
  alternative, cutting the name write mid-way, left a pending deed that could never be furnished.
- **Until the walker frame can carry a nameless walker, a quiet walker leaves the stream's frame.** The review found
  quiet said `applied` while walker labels still carried the name. Leaving them out of the stream's frame is the only
  way to keep the name off the stream on today's shared schema; showing a stand-in label would put a name that is not
  theirs over a real person. They keep walking in the kingdom, and the walker room is untouched.
- **Forget never lifts moderation.** A forget hold and a moderation hold are different restrictions. Renewed
  consent lifts only the first. A banned person's forget still erases what can be erased, and leaves the hold.
- **Nights are kept as times.** `presence.confirmInterval` facts feed tenure. They hold no name or text, and the
  answer lists them under "Kept".
- **The forget hold is stamped at `max(databaseNow − 500, controlAt + 1)`.** It sorts after any control already
  seen, and inside the ingress fence.
- **Confirm layout.** While the forget question is open, the intro line and the quiet note step aside, so the
  question and both buttons fit at 318×496.
- **The kingdom name survives forget.** The header keeps the kingdom's public name after the viewer's own reading is
  cleared.

## No owner edits

The review of the first PW11 checkpoint found main-owned files edited in the lane (`bootstrap/watch.ts`,
`packages/shared/src/presence.ts`, `packages/world/src/presence.ts`). They are back to main's text. The quiet
projection moved into the lane's own `disclosure.ts`, composed through `main.ts`. The presence change is now
`PW11-RENEW-NEEDS.patch`.

## Hooks outside the lane

- `PW11-RENEW-NEEDS.patch` (main: `packages/shared/src/presence.ts`, `packages/world/src/presence.ts` and its test):
  - `restore` takes an optional `consent: 'renewed'`;
  - a renewed restore lifts only a forget hold, and only when newer than it; a moderation restore still never lifts
    forget;
  - additive, and dry-run clean. Verified applied: the world reducer suite and the realm privacy suite pass, including
    "taking your place after forget … lights your window again"; then it was reversed.

- `PW11-HERALD-NEEDS.patch` (raid-show, `apps/herald/**`):
  - parses `!chatdom quiet`, `!chatdom quiet off` and `!chatdom forget` after the chat checks (verified event,
    channel, author, time, coverage, deletions);
  - never treats them as chat, so they do not light, settle, speak or credit;
  - posts `{ version: 1, kingdomId, personId, command }` to the realm's chat door with the Herald secret;
  - hands the `reply` line to an injected sender. The sender posts without an @-mention, and in development only to
    twitch.tv/tobi4s_.
  - Dry-run clean; `commands.ts` typechecks on its own. No chat sender exists in the Herald yet, so `privacy` stays
    unset until one is composed.
- `PW11-WALKER-NEEDS.patch` (main for `packages/shared/src/realm/watch.ts`, grand-world for
  `apps/web/src/kingdom/observed-walkers.ts`):
  - `RealmObservedWalker.name` becomes nullable;
  - the stream's walker track maps a nameless walker to an empty label, which is never drawn, so `RealmWalkerPose`
    and its other consumers are unchanged;
  - the lane's redaction (`redactWalkers`, through the `retain` wrapper) is already in place and starts nulling quiet
    walkers' names once the schema accepts it.
  - Dry-run clean. Verified applied together with the renewal patch: tsc clean over `apps/realm`, `apps/web/src/
    {kingdom,walk,realm}` and `packages/shared/src/realm`, the walker suites and the redaction test pass; then it was
    reversed.

## Verification

- After the second review fix (global note, settlement guard, quiet walkers): privacy suite 10 passed and 1 skipped
  on main's rules, and 10 passed and 1 skipped with `PW11-RENEW-NEEDS.patch` applied (then reversed); the panel-door
  files plus `ingress/homecoming.integration.test.ts`, 8 files, 58 passed and 1 skipped. Repository tsc shows no
  errors under `apps/realm`, eslint clean on the changed files, realm bundle rebuilt. `panel_window` was moved onto the
  rewritten `0012f` (the old version was dropped first; it held no notes).

- Realm, dev Postgres (`panel_window`):
  - `privacy.integration.test.ts` covers:
    - quiet: the stream view loses the name and keeps the light; frame, deed and name are unchanged; chat quiet-off
      takes effect within 1.2 s;
    - forget across two kingdoms and an unfounded pledge: the erased list is exact; frames go dark; no mentions
      remain; the neighbour is untouched; in-flight heartbeats and chat cannot relight and are stored without the
      person; a repeat is safe and finds nothing left to erase;
    - forget with a row still waiting for a writer (an unfounded kingdom no writer can open) and six heartbeats and
      chat lines racing the answer: afterwards no inbox row carries the person's ID or name, the waiting row stays
      unsettled with only the neighbour, later observations in both kingdoms are stored without the person, and only
      the person is noted (run four times, all green);
    - quiet through the exact `retain` path the watch route uses: checkpoint, prepared checkpoint and a live delivery
      all nameless; world, revision, walkers and listeners are the kingdom's own;
    - forget, then claim on main's rules: the same home, `renewal: 'pending'`, no renew control written, panel and
      chat stay dark and nameless;
    - forget, then claim with the renewal patch: the same home relights named within 5 s (runs only when
      `CONSENT_RENEWAL`; run with the patch applied, then reversed);
    - walker redaction in both modes: unlabelled once the frame carries it; left out with their seat until then, and
      no quiet name in the frame either way;
    - after forget, a kingdom the person first comes to: a chat line (through the guard and the inbox, as `main.ts`
      composes it), a panel heartbeat and a follow settle and store nothing of them, while Juniper in the same chat
      line is settled and named; an unguarded name write stores nothing; the panel hears `forgotten` with
      `renewal: 'applied'`; taking their place there brings home, name and light back within 5 s, and the kingdom
      where they asked stays dark;
    - forget waits for a settlement already under way, then finds and darkens the home it made and erases the name;
    - ban plus forget: still held;
    - chat door auth and validation.
  - Also run: `presence.integration.test.ts` (chat, panel and walker each lit within 5 s, dimmed after the lease),
    the service and watch suites, and the world presence reducer.
  - After the inbox review fix: the panel-door files plus `ingress/homecoming.integration.test.ts` (the inbox's own
    suite), 8 files, 56 passed and 1 skipped on main's rules; the privacy suite with `PW11-RENEW-NEEDS.patch` applied,
    8 passed and 1 skipped (the pending case), where renewal also brings the person's evidence back into the inbox;
    then the patch was reversed. `0012f` is applied to `panel_window` only. Repository tsc exit 0.
  - After the review fix: the 7 panel-door files, 51 passed and 1 skipped (the renewal case) on main's rules; with
    both patches applied, 8 files with the world reducer, 81 passed and 1 skipped (the pending case). Run with
    `--fsModuleCache=false` (see the PW10 finding).
- Panel and API, 17 files, 163 tests, including "says the window stays dark, and offers no light, while the realm
  cannot lift a forget hold" (reload, panel forget, and a tap answered with a standing hold). Earlier, panel 12 files,
  111 tests:
  - the stop conditions;
  - after forget, nothing is read or observed until Take your place;
  - a reload of a forgotten panel does not resume its heartbeat;
  - unknown kinds in a forget reply are refused;
  - the kingdom name survives forget.
- API: a remembered forget never posts presence, and a tap on a standing hold answers with the home, dark, and
  posts no observation.
- Scoped tsc and eslint are clean on every changed file. The realm bundle was rebuilt.

## Evidence — `work/evidence/panel-window/PW11/gpu/`

The real-GPU lease (RTX 5080), stack on 5192, realm on 5198, real Twitch accounts read through Helix. No writes.

- **Street sequence.**
  - Files: `street/0{1..4}-*/kingdom-*@636x400.png` are the panel's real paintings at 21:30 shared time.
    `street-closeup@900x450.png` is an upscaled crop of each.
  - Sequence:
    - 01: dark.
    - 02: two arrivals by chat (lit in about 180 ms).
    - 03: two arrivals by the panel heartbeat (about 8 ms).
    - 04: one real tap on "Take your place" (518 ms). The blue-roofed house lights between the three already lit.
  - `street-0*@318x496.png` is the Kingdom tab showing each painting.
- **Privacy flow** at 318×496 and 390×844: `privacy`, `privacy-quiet`, `privacy-confirm`, `privacy-forgotten`,
  `forgotten-you`, `rejoined-you`. The window was dark after forget and lit again after rejoining (about 0.55 s),
  in the same home. These were taken with the renewal change applied, so they show the behaviour once
  `PW11-RENEW-NEEDS.patch` lands.
- **What ships on main's rules today:** `work/evidence/panel-window/PW11/renewal-pending/` has `confirm`, `forgotten`
  and `you-dark` at 318×496 and 390×844. They come from headless Chrome under the capture lock, on a temporary page
  that mounted the real Panel and production adapter against a stand-in backend answering `renewal: 'pending'`.
  The page was deleted afterwards and Vite on 5182 stopped. I looked at all six: no scroll, no clipping, no page
  errors. The You tab first view is 4 words.
  - I did not use the lane stack for this, because forgetting real accounts in `panel_window` is permanent on main's
    rules and would break later street captures. `pw11-capture.mjs --only privacy` now refuses to run there
    without `--forget-for-good`, and photographs the dark You tab instead of a rejoin when renewal is pending.
- `capture.json` holds the timings, word counts and the `realm*` checks.
- Rerun:

  ```sh
  chatdom-pc-lease --wait 30 --max 10 -- node --env-file=<lane env> --env-file=<twitch env> apps/panel/scripts/pw11-capture.mjs --gpu [--only street|privacy]
  ```

## Residuals

- **Window glow at panel size is subtle.** The director camera frames the whole kingdom, so a newly lit window is
  a few pixels in a 636×400 painting; the close-ups show it clearly. Glow strength and framing belong to the
  renderer (grand-world).
- **The painter's camera moves between paintings** (01→02→03). From 03 on it holds steady.
- **Credits with `slot: null`** (someone with no home in that kingdom) cannot be tied to a person at read time, so
  quiet does not cover them. They are rare: a moment credit without a home.
- **Clearing `realm_persons.public_name` is per origin.** A person known in both the live and the simulated origin
  keeps the other origin's row.
- **The barrier briefly queues inbox and name writes.** While forget takes the advisory lock once, writes that arrive
  wait behind it (Postgres queues shared requests behind a waiting exclusive one). It is held for no work, only until
  earlier writes commit.
- **Settlement in another realm process is not waited for in-process.** `ForgetGuard` covers this process. A second
  realm process settling the person at the very moment forget notes them would have its name write skipped by the
  trigger, so that home stays pending (logged, retried, never furnished) and the Herald gets a retry answer that the
  note then strips. The realm runs as one process today.
- **Support moments still credit a forgotten person's new Twitch acts.** A follow, sub or cheer they make after forget
  is a public Twitch act, and the kingdom's moment credits their Twitch name the way Twitch's own alert does. No home,
  light or name record is made for them. The moments service is main's; a credit without a home cannot be tied to a
  person at read time.
- **A monarch who forgot themselves, on main's rules,** keeps the castle, but their provider name is not stored again
  until the forget hold can be lifted (`PW11-RENEW-NEEDS.patch`), so the keep's own name check has nothing to read
  until then. Not tested; a monarch forgetting themselves is rare.
- **Forgets run in `panel_window` before `0012f`** left holds without notes. Nothing outside the lane schema has run
  forget, so no backfill is needed. The earlier per-kingdom `0012f` was only ever applied to `panel_window`; it was
  dropped there (no rows) before the rewritten one ran.
- **Forget timing assumes the API clock is within 500 ms of the database clock.** Outside that, the realm answers
  `conflict` and the panel says to try again.
