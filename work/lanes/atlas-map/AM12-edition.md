# AM12 — Edition I: the land stops moving

Status on 2 Nov: everything is built, tested and rehearsed on real data. Three things are still missing, and only
Tobias or the calendar can supply them:

- **The founding window.** On this survey's own window, Edition I is eligible from **2026-11-05 15:44 UTC**.
- **Tobias's reviews.** `language-names-1` (see `language-names-1-review.md`) and `families-1` (see
  `families-1-review.md`) are both still `proposed`.
- **Tobias's founder key and signature.** The key ceremony below covers both.

Nothing in this lane founds anything. Founding happens only through `atlas:found` with a signature from Tobias.

## What an edition is on the map

An edition is founded once, from one verified revision. `editions/ed-1/` holds six files: `edition.json`,
`founding.json`, `world.json`, `taxonomy.json`, `ledger.ndjson` and `heads.ndjson`. The world, the taxonomy bytes and
the founding night are frozen. Each later survey adds one night, appended to the hash-chained ledger and never
rewritten.

**Publication.** Each night of an edition is drawn as an *edition publication*. It is a directory under
`previews/<pv-id>/` with exactly the files of a survey preview (`world.json`, `region-N.json`, `names.json`,
`manifest.json`). Every reader keeps working unchanged: service routes, live frames, search, cards, roads, the
gateway allowlist and the browser. No new public route exists. The differences:

| Field | Survey preview | Edition publication |
|---|---|---|
| `status`, `label` | `preview`, "Survey preview" | `edition`, "Edition I" (or "Edition 0") |
| `founding` | `{status:'not-founded', …}` | `{status:'founded', edition, label, foundedAt, worldHash, address, rehearsal, ledger:{lines,settlers,head}, night:{revision,asOf}}` |
| geometry | drawn from this survey | the edition's frozen world, field for field |
| holdings | drawn from this survey's averages | the ledger's: granted point and holding tier, never redrawn |
| tier codes | 0–3 | 0–4 (4 = hamlet, only in region files) |
| settler columns | — | `founded`: the first N entries of each file are founding holdings (the pencil base) |
| `counts.hamlet` | absent | present |
| `names.json` | — | `tombstoned`: hidden, gone and abandoned holdings keep their ground and are drawn bare |

Averages, main games and names still come from the night's survey: the facts move, the land does not.

The publication is a pure function of the edition files and the ledger up to its head. `atlas:check` rebuilds it byte
for byte. Its id is `pv-<asOf>-sha256("chatdom-atlas-edition-publication:<address>:<head>:<revision>")[0:12]`.

**Pointer.** `editions/published.json` names the publication the map serves:
`{version, edition, label, address, preview, revision, asOf, head, lines, foundedAt, worldHash, rehearsal}`. It is
written atomically and fsynced, and only after the publication is verified in place. Once it exists, the service
never falls back to a survey preview. If the publication can't be read, the map waits rather than showing draft land.
`GET /map-data/v1/preview` then also carries
`edition: {id, label, foundedAt, worldHash, address}` (served on 127.0.0.2:5199 by the rehearsal bench:
`work/evidence/atlas-map/am12-served-pointer.json`).

**Content address.** `address = sha256("chatdom-atlas-edition:<id>:<worldHash>:<sha256(edition.json)>:<sha256(founding.json bytes)>:<sha256(taxonomy)>:<founding-night head>")`.
It covers everything the founding wrote and nothing a later night adds. Founding time is the moment Tobias signed
(`issuedAt` of the authorization), not the server clock. So the same signed authorization over the same revision,
taxonomy and withheld list founds the same bytes on any machine, and two services holding the same files derive the
same address.

**Retention.** `prunePreviews` always keeps the published publication. `pruneRevisions` always keeps the revision the
published night was drawn from, because search and cards read its register.

## Decisions

- **Edition worlds are shaped like previews.** A separate edition route family would have meant a new gateway
  allowlist entry, a second loader in the browser and a second register, all for the same geometry. The status field
  and the strict schemas on both sides keep the two from ever being confused.
- **The pencil base is the founding holdings.** A channel without land stands at its pencil place, computed against
  the founding holdings only. Those never change inside an edition, so a searched channel's place is the same every
  night and after every restart. The service (`editionPencilPlace`), the directory (`target.holdingGeometry`) and the
  browser (`pencilBase` in `live/paint.ts`) compute it from the same points. A test checks that all three agree with
  the slot a claim is granted.
- **A claim is granted the slot at its own pencil place.** That slot is free unless a grant tonight took it first; in
  that case the claim gets the nearest free slot. A road drawn to a waiting channel therefore ends on its holding
  once it is granted. Claims settle at the next survey night, not instantly: one writer, one ledger, one place where
  land is decided.
- **Three causes create land:** a witnessed raid from a settled kingdom into a stream, a `signed-in` claim and a
  `founded` claim. Raids come from the survey's own recorder (with each revision) and from raid-show's witnessed feed
  in the road ledger, read-only. Simulations and pair aggregates never grant land. A raid into a channel the survey
  never saw (under 5 viewers) grants land on the facts Twitch gives settlement for it (see *Raid arrivals*); a claim
  for one does, on the facts the claim recorded.
- **Hamlets are drawn at their holding tier.** A granted hamlet stays a hamlet in the files; its average is a fact,
  not a size. The browser gives hamlets the village zoom band and a quiet 3 px dot.
- **Tombstoned land is drawn bare, never reassigned.** That covers hidden (withheld), gone and abandoned holdings.
  Moderation tombstones at the next settle run, without waiting for a survey.
- **Every label stays outside the frozen geometry.** Language land is named by its code in `world.json`, and the
  reviewed name table labels it at reading time (test: the world carries codes only). Realms work the same way since
  2 Nov: `apps/surveyor/src/cartography/realm-names-1.json` names family realms by family id and the fixed lands
  (Crossroads, Wilds, Isles of Many Tongues, Outer Isles) by kind, and the browser applies it in `labelWorld`,
  `geographyOf` and the door holding (`realmWord` in `data/model.ts`). The names a world recorded when it was drawn,
  and the `name`/`realmName` in the frozen taxonomy, are only the record and the fallback: a world drawn with a
  taxonomy the table does not list keeps its own words. The table applies only to the taxonomies it lists, so a later
  `families-2` reusing an id never borrows the wrong word. Today it repeats the current labels exactly (test), so the
  map is unchanged. It is not a founding gate: unlike the land, words can be corrected after founding, so Tobias can
  approve or rename them whenever he likes (answers `families-1-review.md` question 6 before founding, when it
  mattered).
- **Settling follows every import automatically.** Once an edition is founded, `atlas:import` settles and publishes
  the new night in the same run, so the map never waits on a separate job. If settling fails, the import still
  stands, the map keeps its last night, and the command exits 1. Settling founds nothing.
- **A rehearsal can never be mistaken for the edition.** `atlas:rehearse --stage <dir>` founds into a separate bench
  directory, with a key made for that one run (only its public half is written). It records every gate it could not
  pass in `founding.rehearsal.waived`. Every verifier, `atlas:check`, `atlas:settle` and the service refuse it
  unless `ATLAS_REHEARSAL=1`. The map's seal reads "Edition I *Rehearsal*" and keeps the survey wax. The bench's
  edition can never become Edition I: the real founding needs Tobias's key, a fresh signature and a founding from
  scratch.
- **Founding gates for Edition I:** 168 h of observations, a reviewed `families-1`, a reviewed `language-names-1`
  (new), an Ed25519 signature from the configured founder key over
  `{kind, edition, revision, taxonomySha256, issuedAt, issuedBy}`, an authorization not dated in the future, no
  existing `ed-1`, and a readable withheld list. A refusal is logged in `ledger/foundings.ndjson` and writes nothing
  else.

## Raid arrivals

Most raids end in a stream the survey observed. Some end in one no sweep ever listed, because it had fewer than five
viewers. Settlement cannot place such a channel from the survey, so it asks Twitch first, and grants the land on the
answer. The rule is the same as for any raid: a hamlet at the channel's pencil place, so the road keeps its end.

1. Before a new night is settled, `settleWithArrivals` lists the channels to ask about. A channel is listed when a raid
   from a settled, untombstoned kingdom went into it after the founding, and the night's survey did not observe it.
   It must also hold no land, not be withheld, and have no answer yet. Each channel is asked about once, for its
   earliest raid. At most 5,000 are asked a night.
2. They are asked in batches of a hundred through the service's own public lookup (Get Users, then Get Channel
   Information). That is two Helix reads per batch, inside the lookup's 60-a-minute budget and 200-point reserve. The
   whole check stops after 5 minutes, or at the first refusal.
3. Each answer is appended to `claims/raid-arrivals.ndjson` and fsynced before the night reads it. `found` records
   the login, display name, broadcaster language and current game, plus the raid that asked. `absent` records that
   Twitch has no such user (deleted or suspended). Only settlement writes this file, under the data directory's
   lock.
4. The night grants a `found` channel on its facts: the realm the map and search already give it, through the same
   visibility gate as everyone (withheld and gambling streams get nothing). It is granted as a hamlet at its pencil
   place, or at the nearest free slot if a grant earlier that night took it.
5. A raid whose answer could not be had tonight (no credentials, budget, Twitch down) is asked again at the next
   night, while the survey still holds the raid. Its answer then carries the raid, so the land is granted on that
   night. An `absent` channel is asked again only after a newer raid into it.
   A `found` answer's raid is tried again on every night until its channel holds land, without asking Twitch again.
   So a grant deferred for lack of a free slot (its realm and the Outer Isles full) lands on the first night with
   room, at the same pencil place. It still passes that night's gates: a channel withheld since, or a raider hidden
   since, gets nothing that night. The same raid seen in the night's window and in its answer counts once.
   The same holds for a raid into a stream the survey did observe. Settlement reads every raid of the edition its
   sources hold (the recorder's raids in the night's revision and the road ledger), not only those since the last
   night, and skips any whose target already holds land. A witnessed raid's land is therefore owed until it is
   granted: deferred for lack of room, or refused by a gate that has since lifted, it lands at the same pencil place
   on the first night that allows it. A raid from before the founding is never owed. A channel Twitch answered as
   `absent` is not counted as waiting for raids older than that answer.
6. The publication names such a holding from its answer (`names.json`). The survey's own name always wins. A claim's
   Twitch lookup now records `login` and `name` too, for the same purpose. Only answers recorded by the time the
   night's head was acknowledged count, so `atlas:check` rebuilds the publication byte for byte however the logs grow.
   Search and cards find the holding as mapped land with its name, on its holding (`average` and first-seen are
   unknown and shown as such).

Without Twitch credentials the night still settles; those raids wait, and `atlas:settle` says so on its summary line.

Real data, measured on 2 Nov. The rehearsal bench was replayed to night 2, and night 3
(`obs-20261102T065304Z-3e480ce03a59`) was then settled in memory. Nothing was written to the bench.
`work/evidence/atlas-map/am12-raid-arrivals.json` has the numbers.

- 54 channels were asked about: 34 from tonight's window and 20 from earlier nights of the edition. That took one
  batch, two Helix reads and 12.6 s, token included.
- Twitch found 53 and reported 1 as gone.
- Without the answers the night granted 1,090 holdings by raid; with them, 1,143. 51 of the 53 new hamlets stand
  exactly at their pencil place; 2 took the nearest free slot. Nothing moved.
- At today's volume this is 7 to 34 channels a six-hour night: one batch.

Found on the way: the card reply's schema still capped the holding tier at 3, so a card for any hamlet holding failed
to build. It now accepts 4, as the browser already did.

## Claims endpoint (private)

`POST /v1/claims` on the private ingest listener (`ATLAS_INGEST_PORT`, loopback). It requires
`Authorization: Bearer $ATLAS_INGEST_TOKEN`, the same token as `/v1/roads/observe`.

```json
{ "version": 1, "kingdomId": "129634568", "cause": "signed-in", "claimedAt": 1793620000000 }
```

`cause` is `signed-in` (the streamer signed in with Twitch, sent by front-door's session authority) or `founded`
(the kingdom was founded in Chatdom, sent by main's Genesis). A producer never supplies a place, a tier or a realm.
The service adds the facts that decide the realm: the survey's when it knows the channel, otherwise its own public
Twitch lookup. The claim is fsynced to `claims/claims.ndjson` before the reply.

| Reply | Meaning |
|---|---|
| `202 {"kind":"recorded","kingdomId","cause","settles":"next-survey"}` | Stored; land at the next night |
| `200 {"kind":"duplicate",…}` | Same channel and cause already stored (safe to retry, concurrent posts record once) |
| `401` | Wrong or missing token |
| `422 {"kind":"invalid","reason":"json"\|"schema"\|"unknown-channel"}` | Unparseable, extra fields, a future `claimedAt`, or Twitch has no such channel |
| `503 {"kind":"facts-unavailable"}`, `retry-after: 300` | Neither the survey nor the lookup could say where it belongs; retry later |

Claims recorded before an edition is founded wait in the log for its first night. Edition 0 grants nothing by claim.

## Key ceremony (Tobias, on his own machine)

The private key is made and kept on Tobias's machine and never reaches this server or the repo.

1. Make the key and keep it on an encrypted disk or in a password manager, not in a synced folder:
   ```sh
   openssl genpkey -algorithm ed25519 -out chatdom-founder.pem
   chmod 600 chatdom-founder.pem
   openssl pkey -in chatdom-founder.pem -pubout -out chatdom-founder.pub.pem
   openssl pkey -pubin -in chatdom-founder.pub.pem -outform DER | sha256sum   # the key's fingerprint
   ```
2. Send `chatdom-founder.pub.pem` (the public half only) and the fingerprint to the operator through any channel.
   Then confirm the fingerprint by a second channel, for example read aloud.
3. The operator puts the public PEM on the Atlas host, readable only by the service user, and sets
   `ATLAS_FOUNDER_PUBLIC_KEY=/path/chatdom-founder.pub.pem` in the service environment. `atlas:found --prepare` and
   `atlas:check` print the fingerprint they use; it must match step 1.
4. Copy `apps/surveyor/tools/sign-founding.mjs` from the repo to the same machine. It needs Node 20 or newer, and no
   install or network.

## Founding Edition I (after 2026-11-05 15:44 UTC and after both reviews are merged)

On the Atlas host, with the service's environment loaded (`ATLAS_DATA_DIR`, `ATLAS_FOUNDER_PUBLIC_KEY`):

1. Pick the revision: the current one after the last import past the window (`cat $ATLAS_DATA_DIR/current.json`).
2. `pnpm --filter @chatdom/surveyor atlas:found --edition I --revision <obs-id> --prepare --by tobi4s_ --out founding-request.json`.
   It prints every gate. Nothing may be listed but the key and the signature; fix anything else first. The file
   holds the exact payload to sign and a short summary. It is not secret.
3. Tobias, on his machine: `node sign-founding.mjs founding-request.json chatdom-founder.pem --out authorization.json`.
   The tool shows the edition, the observed window, the revision, the taxonomy hash and his key's fingerprint. He
   types `Edition I` to sign; anything else stops it. The tool dates the signature now and checks it before writing.
   He sends `authorization.json` back. It is a signature, not a secret.
4. `pnpm --filter @chatdom/surveyor atlas:found --edition I --revision <obs-id> --authorization authorization.json`.
   It prints the holdings, the world hash, the content address and the publication. A running service switches to
   the edition at its next request, with no restart needed.
5. `pnpm --filter @chatdom/surveyor atlas:check`: it must pass, including "ed-1 publication reproduces".
6. Keep `founding-request.json`, `authorization.json` and the printed address with the release notes.

If step 4 refuses (for example the window or the revision does not match), nothing is written except the refusal line
in `ledger/foundings.ndjson`. Fix the cause, prepare again, sign again.

Dry run (2 Nov, scratch copy of real data, a throwaway key deleted afterwards): openssl and the service printed the
same fingerprint, the tool signed the prepared request, and `atlas:found` verified the signature and refused only for
the window and the two reviews, writing nothing but the refusal line
(`work/evidence/atlas-map/am12-ceremony-dry-run.txt`).

## Adopting the founded edition on the live service (operator)

The live service (127.0.0.1:5193, its own worktree) runs code from before this lane's merge. Adoption:

1. Merge, then rebuild the surveyor in the live worktree (`vite build`). Restart the service the usual way, with its
   Twitch env file, `ATLAS_INGEST_PORT`, `ATLAS_INGEST_TOKEN` and `ATLAS_FOUNDER_PUBLIC_KEY` set. The 6-hourly
   `atlas:import` job also needs the Twitch env file (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`). Its settle step uses
   it for raid arrivals; without it, raids into streams under the sweep wait.
2. **Founded on this host:** nothing to copy. Go to step 4.
3. **Founded on another host** (for example a bench that was later signed for real): copy the founding revision
   (`revisions/<obs-id>/`, if the host doesn't have it) and `editions/ed-1/` (all six files) into the live
   `ATLAS_DATA_DIR`. If that host already settled later nights, copy `claims/` (`claims.ndjson` and
   `raid-arrivals.ndjson`) too: the publications name holdings from them. Compare `sha256sum editions/ed-1/*` with the founding host. Never copy a bench's rehearsal
   edition: the service refuses it.
4. `pnpm --filter @chatdom/surveyor atlas:publish`. It writes the publication of the current head and the pointer,
   and prints the content address. That address must equal the one printed at founding. The command is idempotent.
5. `pnpm --filter @chatdom/surveyor atlas:check` must pass. `curl -s 127.0.0.1:5193/map-data/v1/preview` must show
   `"edition":{"id":"ed-1","label":"Edition I",…}` with the same address.
6. From now on, every `atlas:import` settles and publishes its night. `atlas:settle` can also be run by hand (for
   example right after a moderation change: newly withheld land is tombstoned without waiting for a survey).
7. Claims: point front-door's session authority and Genesis at `http://127.0.0.1:$ATLAS_INGEST_PORT/v1/claims`, using
   the same bearer token as the road ingest.

What never to do: delete or edit anything under `editions/ed-1/` or `claims/` (verification refuses a changed ledger and every
later night with it); found again; set `ATLAS_REHEARSAL=1` on the live service.

## Rehearsal on real data (2 Nov)

The source was a scratch copy in `/tmp/chatdom-am12/source`. It held my local revisions of 1 Nov 18:50 and 22:35,
plus the live service's revisions of 2 Nov 00:53 and 06:53, copied read-only and niced; nothing of the live service
was touched. The command was `atlas:rehearse --edition I --stage /tmp/chatdom-am12/bench` (3 min 26 s).

| Night | Revision | Settled | By raid | Moved |
|---|---|---:|---:|---:|
| founding | `obs-20261101T185031Z-db1a6987a0e6` | 57,289 | — | — |
| 1 | `obs-20261101T223528Z-f83a4722106d` | 2,461 | 935 | **0** |
| 2 | `obs-20261102T005320Z-93903f145ed6` | 1,207 | 600 | **0** |
| 3 | `obs-20261102T065304Z-3e480ce03a59` | 2,223 | 1,090 | **0** |

The result was 63,180 holdings over 4 nights, 138 tombstoned and 0 on the Outer Isles. Waived for the rehearsal:
75.1 h of 168 h, `families-1` proposed, `language-names-1` proposed.

- Address `0c3d88838751f7bf…`, world `96c341c239c25d4e…`, publication `pv-20261102T065304Z-e2282c274bae`.
- `atlas:check` with `ATLAS_REHEARSAL=1` passes (exit 0, `work/evidence/atlas-map/am12-check.txt`). Without it,
  check refuses the rehearsal, as it should.
- The road ledger's raids are the recorder's (124,374) and raid-show SSE's (315); no simulation and no aggregate.
  Most grants come from the recorder raids that arrive with each revision.

Land by raid grows the map by roughly 1,000 hamlets per six-hour survey on today's raid volume. That is the rule as
decided (A13), and each one is a real raid from a kingdom into a real stream. The hamlet slots are far from full.

## Stills

The same view, before and after: the survey preview of revision 3e48 (drawn by this branch) against the Edition I
rehearsal night of the same revision. The views are the overview at 1440×900 and 390×844, plus the German continent
framed on the edition's own geometry. Files are in `work/evidence/atlas-map/am12-{before,after}-{1440,390,de-1440}.png`
and the pair `am12-phone-pair.png`. Script: `apps/web/src/atlas/checks/edition-shots.mjs`; the capture lock was held
67 s.

- The layout differs between the two, and that is the finding. The survey preview redraws the world from every
  survey (since 1 Nov 18:50 Chinese and Italian swapped places, Spanish moved), while the edition keeps the land of
  its founding night.
- The seal reads "Survey 2 Nov 2026" before and "Edition I *Rehearsal*" after, with a crown glyph on the survey wax.
  A real founding shows "Edition I 5 Nov 2026" on the deeper edition wax.
- Not liked, then fixed (2 Nov): a name set left of its holding carried its shield at the far end, so the shield
  stood alone in open sea (metashir2, EWROON, enzzai, two beside the Isles of Many Tongues at 390) and the Japanese
  name ran up to the JAPANESE lettering. A name block left of its stamp is now mirrored: the name, the gap, then the
  shield beside the holding ("metashir2 ⛨ ♜"). One rule, `blockPieces` in `map/collide.ts`, places both the moving
  map's names (`HoldingLabels`) and the still's, so the two stay identical; the block's size and the order of sides
  are unchanged, so nothing else moves. Stills after the fix: `am12-shield-after-{1440,390,de-1440}.png`.

## Tests

- `apps/surveyor/src/edition/publish.test.ts` (new, 11 tests):
  - Publications are byte-identical and verified, and the pointer names the edition.
  - Retention keeps the published publication and its revision.
  - A settlement night after founding moves no founded holding (same file, index, point, tier and realm). The land is
    identical, and newcomers, a capital and a raided hamlet follow the founded ones.
  - Hidden land is listed as tombstoned and is never named.
  - Raid grants land on the pencil place that the service, directory and browser computation agree on.
  - Claims are granted at the pencil place (survey facts or arrival facts), once per channel. A withheld claim waits,
    Edition 0 grants nothing, and verification accepts the claims.
  - Labels stay outside the geometry.
  - Road-ledger raids: only witnessed, non-recorder, non-simulated observations count.
  - Staged Edition I on a temp data directory:
    - Verifiers and the service refuse the rehearsal without `ATLAS_REHEARSAL`.
    - The served pointer carries `ed-1`.
    - The claim endpoint: 401, invalid JSON, schema, future date, unknown channel, recorded, duplicate, concurrent
      posts, facts-unavailable with retry-after, a restart remembering its claims, a torn tail.
    - After a real import, the map keeps the edition and does not fall back to the new survey preview.
    - A night with zero moves: a newcomer (town), a sign-in claim and a recorder raid are each granted exactly at
      their pencil place, and the waiting channel's place is unchanged.
    - Search answers are identical across service restarts and across the night.
    - Publishing again is idempotent.
- `apps/surveyor/src/edition/arrivals.test.ts` (new, 10 tests):
  - Without an answer the raided stream waits. With one it is granted its pencil place in the realm of its own
    language, and nobody moves.
  - Withheld and gambling streams get nothing, and neither does a raid from hidden land.
  - A raid from an earlier night is granted when its answer arrives, and only on that night.
  - The publication names the holding from the answer; the survey's name wins.
  - Who is asked: once per channel, earliest raid first. Never a known, owned or withheld channel, nor a raid from
    land that is not settled. Answered channels are not asked again; a gone channel is asked again after a newer
    raid. At most 5,000 a night.
  - Batches of a hundred, found and gone answers, a stop at the first refusal and at the deadline.
  - The durable log, its torn tail, and the first answer per channel up to a night.
  - Through the real import and settle commands on a staged edition:
    - Twitch down: the night settles and nothing is granted.
    - The next night, Twitch answers. The raided stream gets its hamlet at its pencil place under its own name, as
      mapped land in search and on its card. The gone one gets nothing.
    - Nobody moved, and `checkPublication` passes.
    - Answered channels are not asked again.
- `twitch-lookup.test.ts`: a batch of IDs in two public reads, unknown IDs reported as absent, no live state, no cache,
  and the reserve.
- `edition.test.ts`: the names gate, `byClaim` in every summary, and "claim before Edition I" in the tamper test.
  The founding command is still refused below the window and without an authorization.
- Web: 699 Atlas tests, including the new `ui/edition.test.ts` for the seal, card, still and notice wording on a
  preview, Edition 0, Edition I and a rehearsal.
