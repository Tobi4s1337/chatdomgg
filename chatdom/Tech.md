# Tech

How Chatdom is built: the architecture, the early decisions and the reasons for them. Internal. Started 2026-10-29
from the founder's answers and nine research reports.

The tech serves the vision, never the other way round. This file is derived from:
- `ChatDom.md` (what Chatdom is)
- `Quality.md` (the bar)
- `Artstyle-Soul-Feel.md` (the look)

When this file disagrees with one of those three, they win. Either this file changes, or they change on purpose with a
line in their change logs.

Five sibling files, written on 2026-10-29, own design that this file builds:
- `World-Tree.md`: what beings, things and places exist, and their rules
- `Twitch.md`: every Twitch surface, the Chatdom panel and Bits in it
- `Atlas.md`: the map of Twitch, and the source of truth for everything Atlas
- `Monarch.md`: the streamer's side, the throne and how the kingdom sits in a stream
- `Safety.md`: the rules for what people make, the judges and the Watch's review

They own the design; this file owns how it is built. Where this file would repeat one of them, it points there instead.

The evidence lives in `docs/research/tech/`:
- `lanternmere-autopsy.md`
- `colyseus-realtime.md`
- `twitch-integration.md`
- `voxel-building-controls.md`
- `characters-animation-crowds.md`
- `rendering-devices.md`
- `ui-audio-shell.md`
- `livekit-voice.md`
- `minigames-forge-ai.md`

Each section below names the report behind it. Where this file and a report disagree, this file wins. It also
supersedes the technical parts of `docs/06`, `docs/07` and `docs/09` where they conflict.

Numbers marked *measured* were measured on our build box (an i7-8700 with an Intel UHD 630). Every other number is a
starting estimate, to be confirmed on real devices (§16).

## 1. What the tech must serve

Each line of the blueprint becomes a demand on the system.

| The blueprint says | So the tech must |
|---|---|
| Twitch is the physics (principle 6) | Turn every Twitch moment into something visible in under a second, never lose a paid or durable event, and speak back to Twitch through polls, predictions, raids and shoutouts, never clips |
| Presence is light (§5, principle 2) | Know who is in chat each minute, lurkers included, and draw thousands of lights without thousands of real lights |
| Watching is playing (principle 8) | Make the stream view a first-class client, and make one chat message a complete way to take part |
| Every size is welcome (principle 9) | Run one architecture from 5 viewers to 50,000. A small kingdom costs nearly nothing; a big one never feels like a queue |
| Nothing is lost (principle 5, Quality rule 7) | Save work as it happens, survive crashes, and put people back where they were |
| Make it yours (principle 11) | Support free voxel building on a growing plot, a wardrobe, and Forge parts, all in a shared world that stays beautiful |
| Games are places (principle 12) | Make the tavern a shared room, make tables into games, and let anyone prompt a new game that is verified before it opens |
| Kingdoms connect (principle 13) | Carry a crowd from one kingdom to another, across servers, without a visible seam |
| Magic, under rules (principle 16) | Have Codex run every piece of magic, inside shapes the world already allows, never acting on its own |
| Real, never a tech demo (principle 17) | Run on real streams for months, measured on real devices, honest about what is simulated |
| The map of Twitch (§7) | Draw the Atlas from every kingdom without the map ever touching a game server |
| Quality §2 | Answer every input within 100 ms, keep the world solid, keep the camera clean, never pop, and work on four devices |

## 2. Principles

Each principle has a **why** and a **so**. Derive designs from the "so" lines.

**1. The server holds the truth; the client gives the feel.**
- **Why:** anything that counts (light, homes, items, Hearth, scores, seats) must be the same for everyone and safe from
  a modified client. But the 100 ms rule (Quality rule 2) cannot wait for a round trip, least of all from the US to
  Europe.
- **So:**
  - Everything counted is decided on the server.
  - Every input gets an instant local answer: a predicted move, a ghost block, the ritual starting.
  - The server's answer arrives a moment later, and the client reconciles quietly.
  - Your own movement is the one exception: the client moves your avatar and the server checks it (§6.3).

**2. One log of facts.**
- **Why:** the prototype's best idea was `WorldEvent → reducer → beat`. One stream of facts drives:
  - the world
  - the show
  - the Chronicle
  - the Voice of the Realm
  - recovery after a crash
- **So:**
  - Clients send **intents**, and the kingdom's single writer turns them into **facts** with a sequence number.
  - Facts are stored in Postgres.
  - **Beats** are derived from facts, and are the only door to presentation.
  - Every fact the Voice of the Realm speaks is a row in the log.

**3. Represent the crowd; never stream it.**
- **Why:** a capital has tens of thousands of chatters and thousands of walkers. Streaming every person to every
  person does not scale, and nobody can see that many anyway.
- **So:**
  - Chatters exist as data (lights, homes, counts, bubbles), not as connections.
  - Walkers see their nearest neighbours in full, and the rest as a crowd summary.
  - Big kingdoms split walkers into layers (§6.2).

**4. Shapes before magic.**
- **Why:** principle 16, "Everything it makes fits shapes the kingdom already allows". AI that writes code or voxels
  directly can break the world.
- **So:**
  - Codex writes **plans** in fixed formats: a house-part plan, a game variant, a Chalk rule set, a Charter, a ballad.
  - Deterministic code that we wrote turns those plans into things.
  - Nothing generated runs as code.

**5. The same rules on both sides.**
- **Why:** prediction only works if the client predicts with the server's own rules. Two copies drift, and drift looks
  like glitches.
- **So:** collision, build validation, the reducer, Chalk and the Forge assembler are shared TypeScript packages, run
  unchanged in the browser and on the server.

**6. Small is free; big is possible.**
- **Why:** most of Twitch is small (principle 9), and kingdoms are granted, never sold (§8). A kingdom has to cost
  almost nothing while it sleeps.
- **So:**
  - A kingdom with nobody in it has no room running. Its events wait in the inbox until someone arrives.
  - One process holds hundreds of small kingdoms.
  - Splitting into layers is a per-kingdom flag, not a different product.

**7. Never lose work. No dead ends.**
- **Why:** Quality rule 7. Losing a build breaks trust in a way polish cannot repair.
- **So:**
  - Build edits, Forge results and seats are durable within one second, and held in the browser until confirmed.
  - Every room can be rebuilt from Postgres.
  - Every disconnect has a designed reconnect.

**8. Data over code, versioned forever.**
- **Why:** content, games, items and kits change far more often than the engine. Data is cheaper to author, check and
  moderate.
- **So:**
  - Kits, props, clips, games and plot versions are immutable, content-addressed files on the CDN.
  - Code reads them; it does not contain them.

**9. Twitch's rules are our rules.**
- **Why:** the whole product stands on Twitch's goodwill and API keys.
- **So:**
  - Request the minimum scopes, at the moment of use.
  - Validate tokens hourly.
  - Delete what Twitch says to delete.
  - Never read a chat that has not consented.
  - Never put "Twitch" in our name.

**10. Measured, not believed.**
- **Why:** every prototype number until today came from software rendering. The first real-GPU run surprised us
  (§8.5).
- **So:**
  - Budgets are tests that run on every change.
  - Devices are measured at milestones.
  - Nothing is called fast until it has been timed.

**11. Boring where it is hidden; crafted where it is felt.**
- **Why:** time is best spent where people feel it: input, camera, animation, building, light, UI and sound.
- **So:**
  - Use plain, proven tools for storage, servers and queues: Postgres, Node, Valkey.
  - Write our own code where feel lives: the input layer, camera rig, pose evaluator, voxel mesher, carved UI kit and
    audio mixer.

**12. Built with Codex.**
- **Why:** principle 16 makes Codex the kingdom's magic.
- **So:**
  - Every line of the product is written in the `chatdom-main` Codex thread.
  - Codex runs every piece of magic at runtime (§11).
  - This file is the spec those threads build from.

## 3. What the prototypes taught us

From `lanternmere-autopsy.md`, with file:line evidence there. Lanternmere passed 69 tests and still broke in the ways
the founder felt, because no test played it like a person.

**The three complaints, and their real causes:**

| Complaint | Root cause | The fix (section) |
|---|---|---|
| Mouse interaction was glitchy, and holding the right button to move felt weird | Pointer lock was the default, and Chrome sends spurious jumps under it. A heuristic fallback then switched players into "hold right button to look" on normal fast flicks. Every panel released the mouse. The camera collided only with terrain, so it went inside buildings. Cinematics never handed the camera back, which froze the player for the whole dragon fight. Slow frames threw mouse movement away. | Free cursor by default, a camera that follows on its own, collision with everything (§8.2) |
| Animations were meh; the whole body rotated for every tool use | The body always faced the camera. One generic swing twisted the torso 57°, carrying the big chibi head. Nothing blended, nothing anticipated, and feet slid. | A layered pose evaluator with an upper-body mask and an aim layer; gait driven by distance (§8.3) |
| No real building, only house level-ups | It was a design decision (`docs/05:13`). Plots had no voxel data, and collision could not represent rooms or overhangs. | Free voxel building on a 0.125 m lattice, with plots that grow (§9) |

**Keep** (as design, often as code):
- **The event pipeline:** the reducer, beats, choreography as presentation, and the director's priority queue of
  shots.
- **The Forge's shape:** model plan, then grammar, then palette-locked voxels, then six-view render, then provenance.
- **The greedy mesher** with baked AO in a worker pool.
- **The renderer:** the packed voxel material, HDR with guarded bloom, batched drawing, row-by-row reveal and the
  quality governor.
- **Assets:** the 64-colour palette and the content-pack format.
- **Tooling:** the scenario runner, contact sheets and contracts-first working.
- **From the other prototypes:**
  - prototype D's plot editor
  - e-atlas's heraldry and deep zoom
  - `_shared`'s networked command model, which was the right shape and went unused

**Drop:**
- the input layer and the body-faces-camera control
- column-span collision
- the hand-written animation `switch`
- localStorage saves and `setTimeout` game timers
- the 1,050-line systems file
- the glass-and-gold UI
- heuristic moderation
- 134 empty `catch {}` blocks

**Architectural lessons:**
- **Lanternmere was single-player in disguise.**
  - All state lived in the tab.
  - Clients sent results ("I earned 40 Hearth"), not requests.
  - The renderer owned the game clock.
  - Logic depended on frame rate.
  - 37 `Math.random` calls touched the simulation.
- **The rebuild fixes each of these:**
  - The server owns state and time.
  - Clients send intents.
  - The simulation steps on a fixed clock, separate from rendering.
  - Every random draw comes from a seed carried by the event.
  - Choreography is presentation only.
  - Lint rules keep it that way.

## 4. The system at a glance

```
                           ┌──────────────────────────── Twitch ────────────────────────────┐
                           │ EventSub (conduit, webhook shards)      Helix (writes, lookups) │
                           └───────┬─────────────────────────────────────────▲──────────────┘
                                   ▼                                         │
                           herald ×N: verify, dedupe, map to kingdom    actions queue: tokens,
                                   │  inbox (Postgres)                    cooldowns, chat budget
                                   │  chat fast path (Valkey)                │
 ═══════════════ Valkey: Colyseus presence + driver, pub/sub, rate counters ═════════════════
        │                     │                       │                       │
   ┌────▼──────────┐   ┌──────▼─────────┐   ┌─────────▼────────┐   ┌──────────▼─────────┐
   │ KingdomRoom   │   │ LayerRoom ×n   │   │ MatchRoom ×n     │   │ DraftRoom ×n       │
   │ the single    │   │ avatars, zones │   │ a table, the     │   │ a plot's build     │
   │ writer        │   │ (tavern, fire) │   │ campfire game    │   │ draft              │
   └────┬──────────┘   └──────▲─────────┘   └─────────▲────────┘   └──────────▲─────────┘
        │ facts, snapshots     │ ws 10 Hz              │ ws                    │ ws
        ▼                      │                       │                       │
   Postgres  ◄──────── api: sign-in, sessions, REST, matchmaker, LiveKit tokens, publish
   R2 + CDN  ◄──────── baker: plot bakes, impostors, renders · codex: the magic · taster: game checks
        │                      │
        ▼                      ▼
   chatdom.gg client (walkers) · stream view (OBS) · throne · /map (Atlas) · panel (Twitch Extension)
                                   │ WebRTC, campfire seats only
                                   ▼
                              LiveKit Cloud
```

| Piece | What it does | Section |
|---|---|---|
| **web** (`chatdom.gg`) | The client: the kingdom, the build mode, the tables, the Atlas, the throne and the stream view, all one codebase | §8 |
| **panel** | The Chatdom panel, a Twitch Extension under the video: its own small client, reviewed and hosted by Twitch, fed by our CDN and Extension PubSub (`Twitch.md` §16) | §7.1, §8 |
| **realm** | Colyseus processes running the four room types | §6 |
| **api** | Twitch sign-in, sessions, room tokens, REST for cards and publishing, the matchmaker, LiveKit tokens, and the panel's Extension backend | §6, §7 |
| **herald** | Twitch ingest (EventSub), reconcilers, and the actions service that writes back to Twitch | §7 |
| **codex** | The runtime for the magic: Codex agents with our tools (Forge, Genesis, games, the Voice), and the judges that gate them from outside the run | §11 |
| **taster** | The worker pool that verifies games | §10 |
| **baker** | The publish pipeline: plot meshes, LODs, impostors, contact sheets for the judges, the Atlas's kingdom drawings, CDN upload | §9 |
| **surveyor** | The Atlas service (`Atlas.md` §8; its data half is in `docs/12`) | §6.8, §7.6 |
| **studio** | The wire recorder and the replay renderer | §14 |
| **Postgres** | The truth | §12 |
| **Valkey** | Room table, inter-process calls, pub/sub, counters. Never the truth | §6 |
| **R2 + CDN** | Every immutable file: plot versions, Forge parts, bakes, game manifests, clips, recordings | §12 |
| **LiveKit Cloud** | Voice at the campfire and the throne room | §10.6 |

## 5. The world model

The shared package `packages/world` is the heart of the system. It runs in the KingdomRoom on the server, in the
client for prediction and presentation, and in tools for replay and tests.

**State is split four ways** (the prototype mixed them, with "me" built into its reducer 46 times):

| State | Holds | Lives |
|---|---|---|
| **Kingdom** | Clock anchor, weather, the boss, commissions, plot revisions, light bitsets, the season | KingdomRoom; rebuilt from Postgres |
| **Person** | One Twitch identity across kingdoms: look and worn things, the passport, the list of at most three homes | Postgres; cached by the client |
| **Citizen** | One person in one kingdom: home, purse, placed pieces, keepsakes, sub pieces, light tint, coals, streaks, trust tier | KingdomRoom memory for those present; Postgres always |
| **Local** | Camera, open panels, build drafts in progress, settings | The client only |

What travels with the person and what belongs to one kingdom is `World-Tree.md` rule 9.

**Intents and facts:**
- A client sends an intent: `{id, type, args}`, with an idempotency key.
- The KingdomRoom checks the intent and emits zero or more facts: `{seq, at, type, actor, body, cause}`.
- The reducer applies the facts and yields new state plus beats.
- A retried intent with the same key changes nothing.

**Rules for the reducer:**
- **It is pure.** Time comes from `ctx.now` and randomness from `ctx.rng`, both seeded by the event. A lint rule bans
  `Math.random` and `Date.now` in simulation packages.
- **Timers are state.** A dragon arriving in 40 s is a scheduled fact in the snapshot, not a `setTimeout`.
- **Economy goes through the ledger.** Every `econ.mint` row carries a source class: `presence`, `deed`, `play`,
  `event`, `grant` or `support`. The reducer rejects any `support` row (money) aimed at a purse, a rank or a score.
  This is principle 4 in code.
- **Everything made or won is an `ItemCopy`** with a provenance record. Provenance sentences are templated from that
  record, never typed.

**The event catalogue** merges the eight `docs/08` designs into one list, with the collisions settled in `docs/09`
§2.19. Two shapes recur everywhere:
- `presence.tick`: once a minute, who was in chat, who chatted and who walked.
- `crowd.tally`: any aggregated chat input over a window, such as a vote, `!haul` or a game move.

**Beats** have four levels (`tick`, `moment`, `reveal`, `climax`) and a drama score. The director and the Chronicles
consume them. Beats are not stored, except climaxes, which are indexed by `seq` for the Chronicle.

**Identity:**
- A kingdom is keyed by the broadcaster's Twitch user ID.
- A person is keyed by their Twitch user ID, always as a string.
- Logins change, so nothing is keyed by login.
- A person holds a citizen row with a home in at most three kingdoms (founder decision). A monarch's castle is not one
  of the three (founder decision, `Twitch.md` §12). Elsewhere they are a guest: their light burns and their presence
  still gathers, so if they settle there later their history is waiting.

## 6. Realtime: Colyseus

From `colyseus-realtime.md`. Be ambitious with Colyseus, but plan for the costs we measured.

### 6.1 Versions

Pin these exactly:
- `colyseus` 0.18.10 (`@colyseus/core` 0.18.20 or later)
- `@colyseus/schema` 5.0.42 (5.0.41 or later)
- `@colyseus/sdk` 0.18.8
- the uWebSockets transport

The floors fix patch corruption for slow clients and an encoder memory leak. Colyseus 1.0 will break APIs, so room
code sits behind a thin adapter. Install the official Colyseus skill for the Codex builders, because most models
learned pre-0.18 Colyseus.

### 6.2 Four rooms

| Room | Id | Holds | Rate | Who connects |
|---|---|---|---|---|
| **KingdomRoom** | `k:<kingdomId>` | The single writer: reducer, ledger, timers, event log, snapshots. Schema state carries only the kingdom header (clock, weather, boss, plot revisions, light bitsets). Beats go out as messages; private data goes as messages to its owner. | Patch 4 Hz, beats at once | Every walker, the stream view, the monarch |
| **LayerRoom** | `k:<kingdomId>:l<n>` | Live presence: avatars, interiors as zones, seats on benches and logs, bubbles filtered by distance, a summary of the crowd in the other layers. The monarch is mirrored into every layer. | Patch 10 Hz | Walkers: soft cap 300, hard cap 400 |
| **MatchRoom** | `m:<matchId>` | One game: a tavern table, the campfire's Dusk Court, any prompted game. It has its own rules, lifecycle and failure domain. | Event-driven | Seated players and spectators |
| **DraftRoom** | `d:<kingdomId>:<plotId>` | One plot's private build draft: sequences edits, validates them with the shared rules, and persists the op log | Messages only | The plot's editors |

**Layers, not zones.** Chatdom's crowds gather in one place at one moment: the plaza for the dragon, the gate for a
raid. Cutting the town into areas would put everyone in one area exactly when it matters. Instead, a big kingdom runs
several copies of the town ("layers") of up to about 300 walkers each.
- Every layer shows the same homes, lights, events, dragon and monarch, because those live in the KingdomRoom or are
  mirrored.
- People in other layers appear as lights, murmur and the crowd summary.
- A hamlet has one layer, so the split costs it nothing.
- A 5,000-walker capital runs about 17.

**The royal layer** holds the monarch and the stream view.
- **Founder decision: it fills first come.** Nothing can buy a place in it.
- When it is full, new walkers go to other layers.
- A walker who asks to "go to the monarch" joins a waiting line, and the next free place goes to whoever waited
  longest.
- Three groups always appear in the royal layer, because they are part of the scene:
  - players seated at the monarch's table or campfire, mirrored in
  - citizens the monarch summons to a ceremony (a royal audience, a knighting), mirrored in for its length
  - an arriving raid party, which gets its own layer if it does not fit
- Friends can follow each other into a layer that has room.

**Interest management.**
- Inside a layer, each client sees its nearest 64 avatars (32 on phones) through a per-client `StateView`, patched at
  10 Hz and drawn 200 ms in the past for smooth interpolation.
- This is the expensive part (*measured*: 2.3 ms a tick at 250 clients, 14 to 17 ms at 1,000), which is why layers
  cap at about 300.
- If per-client views prove too costly, the fallback is our own per-cell channel for avatar transforms.

**Bandwidth:** about 1.6 to 3.7 KB/s down and 0.2 KB/s up per walker (*measured*).

### 6.3 Movement

- **Client-authoritative, with server checks.** The client moves its own avatar with the shared collision module at a
  fixed 60 Hz step and sends a quantised transform at up to 12 Hz.
- **The server checks** speed, bounds, zone transitions (doors) and, later, a coarse collision grid. It relays only
  valid positions, so nobody ever sees a cheat walk through a wall. On a failed check it sends a correction, and the
  client eases back.
- **Why not server-run movement:** it would need every plot's voxel collision and character physics on the server for
  every walker, to stop cheating in a game where nobody can harm anyone (principle 13).
- **Soft push** (Quality rule 4) runs on each client: avatars never overlap; they push apart and slide past. After
  0.6 s of pressing against someone who will not move, you slide through, so nobody can block a door.

### 6.4 Interiors, tables and the campfire

- **Interiors are zones inside the LayerRoom.** Walking through the tavern door changes one field, with no network
  hand-off. That is the only way to keep "no loading, no cut". The painterly pass blends in over the doorway (§8.5).
- **Tables are MatchRooms.**
  - A table's state is mirrored into every layer as a 1 Hz summary, which drives its voxel miniature and its sign.
  - Sitting down reserves a seat in the MatchRoom.
  - Every layer of the tavern shows the same tables, and a match survives a layer restart.
- **The campfire** is a zone with log seats. Its Dusk Court game is a MatchRoom. Its voice is a LiveKit room, and the
  MatchRoom grants voice only to seated players (§10.6).

### 6.5 Building edits

A DraftRoom opens when someone starts building.
- The client applies each edit at once, so the ghost and the block land within the frame.
- The server sequences edits, validates them with the same `packages/voxel` rules, and persists them within a second.
  The client keeps unacknowledged edits in IndexedDB.
- When housemates touch the same cell, the last edit wins.
- Publishing runs the checks and bakes (§9.6), then bumps the plot's revision in the KingdomRoom, which every client
  sees.

### 6.6 Twitch events into rooms

1. The herald writes each durable event to the Postgres `inbox`. Twitch's message ID is the unique key, so duplicates
   die there.
2. It then publishes on `k:<id>:in` through Valkey.
3. The KingdomRoom applies inbox rows in order and records `applied_seq`. On start it drains anything left unapplied.
4. A sleeping kingdom costs nothing. Its rows wait, and the next visitor or a scheduled wake applies them.

Only a live broadcast wakes a kingdom. A `stream.online` of type rerun or playlist does not, and earns no presence.

Chat never becomes per-message facts:
- Bubbles go to layers in 150 ms batches.
- Commands become `crowd.tally` per window. A crowd act tapped in the panel is the same command, with the same rate
  limits and one vote per person.
- Presence becomes one `presence.tick` a minute. Lights lit from the panel join the same tick, under the same idle
  checks as chat (founder decision, `Twitch.md` §16).

**Targets:** EventSub delivery to a visible beat in under 1 s at p95; a chat bubble on screen in under 1.5 s.

### 6.7 Raids

1. The monarch opens the gate. Only the streamer can (founder decision). The api calls Helix Start a Raid.
2. Walkers are asked "March with your monarch?" and the party walks out of the gate.
3. The camera rises to the Atlas road. The march is the same public caravan everyone sees on the Atlas (`Atlas.md`
   §7.5, §7.6).
4. The KingdomRoom of the destination reserves seats for the whole party in one cross-process call
   (`matchMaker.reserveMultipleSeatsFor`), into its royal layer if there is room, otherwise into a fresh layer that
   keeps the party together.
5. Clients swap rooms while the road cinematic plays, so the switch is never seen.

If the destination has no kingdom yet, its waiting land receives them ("settlers before kings"). A target with no land
on the Atlas may get a pencilled hamlet slot so the road has an end; that waits on `Atlas.md` question 3.

Visitors keep their identity, wear a guest badge, take trust 0 there, earn no coals there, and get a passport stamp.
Passports are public on the citizen card, with a personal "hide my travels" switch (founder decision). The
destination's bans apply.

### 6.8 The stream view and the Atlas

- **The stream view is a privileged client** of the KingdomRoom and the royal layer, signed by a revocable token in
  its URL.
  - Its interest view follows the director's camera, not an avatar, with a larger radius (about 150 avatars) and the
    crowd summary of every layer, so wide shots of a capital look full.
  - It never receives a secret: role cards, hidden ballots and private guesses are never in any schema, only in
    private messages to their owner.
  - It never receives a made thing that is held or refused, or one that has not passed both checks (`Safety.md` §2,
    principle 1).
- **The Atlas never connects to a game server.** `Atlas.md` §8 is the source of truth for how the map is made.
  - Each KingdomRoom posts a pulse every 10 s: live, walkers, lights lit, and one spectacle code.
  - The surveyor folds the pulses into static tiles, `live.bin` and one event stream: raids, raid-train stops,
    bridges, spectacle changes and founded kingdoms going live.
  - Live shows as paint and pennants (founder decision, `Atlas.md` §5.1), so `live.bin` holds two bytes per settler:
    the size class (0 offline, 1 to 5 by average viewers) and the spectacle code. Exact viewer counts stay on the
    card, from the API.
  - `dabs.bin` lists the small live channels (5 to 24 viewers): realm, a hash of the channel ID and the start time.
    The client turns the hash into a pencil place on the realm's hamlet-slot grid, which is computed from the frozen
    world, so nothing is stored. From Edition I, a channel a kingdom raids is granted that slot and kept.
  - There is no night layer and no time-of-day state on the Atlas.
  - A million map viewers cost the game servers nothing.

## 7. Twitch, both ways

From `twitch-integration.md`, verified against dev.twitch.tv on 2026-10-29. What each Twitch surface becomes, and
what the kingdom writes back, is designed in `Twitch.md`; this section is the plumbing. The Chatdom panel, a Twitch
Extension, is in scope since 2026-10-29 (founder decision), which reverses the report's "Extensions are out of scope".

### 7.1 Accounts and sign-in

- **Two Twitch apps,** "Chatdom" and "Chatdom Dev", both confidential (server-side, with a client secret).
  - Consent and EventSub cost are counted per app, so the kingdoms and the Atlas share one production app.
  - The surveyor already runs on an app registered as "Chatdom Atlas" (since 2026-10-29). Rename that app "Chatdom"
    rather than registering a second one.
  - Rotate its secret before launch.
- **One bot account, the Herald.**
  - It reads and sends chat with the app token, which gives it the Chat Bot badge and no channel-join limit.
  - Twitch remembers the Herald's one-time grant, so we never store its user token.
  - After the founding stream, each streamer is offered (never required) the chance to make the Herald a mod. That
    raises its chat budget in their channel from 20 to 100 messages per 30 s and lets the crier make announcements.
    It is never part of connecting (`Monarch.md` §5.1).
- **The Chatdom panel, a Twitch Extension,** with its own client ID and secret (`Twitch.md` §16).
  - Its backend is the api. Viewer tokens from the panel are verified with the Extension's secret.
  - An opaque `U` ID is never tied to a light without the viewer's identity share. A logged-out `A` ID is never tied
    to anything that lasts.
  - Panel updates go over Extension PubSub: about 1 message a second per channel (Twitch's building guide; the API
    reference allows 100 a minute), at most 5 KB each. The configuration service holds settings. Heavy data, such as
    the night painting, comes from our CDN.
  - Bits in the panel need developer monetisation onboarding. It runs on a separate Chatdom account, because Twitch
    blocks it on an account that did creator monetisation onboarding before reaching Affiliate (`Twitch.md` §17).
- **Signing in with Twitch is required to enter a kingdom.** *Founder decision.*
  - It is OIDC with `openid` only. We keep our own session and discard the Twitch token.
  - The Atlas (`/map`) and share cards stay public.
  - Raiders arrive from a link, and the sign-in is one click.
  - "Light up my Twitch" on the Atlas asks a signed-in viewer for `user:read:follows` at that moment, uses the list
    for that view only and never stores it (`Atlas.md` §6.2).
- **Citizens exist before they sign in.** A person row is created the first time someone chats in an authorised
  kingdom. Signing in claims every citizen row at once, because OIDC's `sub` is the same Twitch user ID. There is no
  merge step.
- **Lurkers are anonymous lights until they act.** *Founder decision.*
  - Get Chatters tells us who is watching.
  - A lurker adds an unnamed light to the town: counted and visible, never named.
  - Their presence still accrues privately under their user ID, so principle 2 holds ("the quiet ones count").
  - The first time they chat, sign in or light up from the panel with their name, their home lights with their name
    and their history is already there.
  - This is disclosed in the privacy policy, and `!chatdom forget` erases it.

### 7.2 Streamer consent in tiers

Twitch's agreement requires asking only for what current features need, so consent comes in tiers.

| Tier | When | Scopes | What it becomes |
|---|---|---|---|
| 1. Found your kingdom | "Connect your channel", before any stream (`Monarch.md` §5.1) | `channel:bot` `moderator:read:chatters` `moderator:read:followers` `moderator:read:blocked_terms` `moderator:read:shield_mode` `moderation:read` | Everything that makes the place:<br>• the Herald, chat lights and lurker lights<br>• tents on follow and "following since"<br>• sub months from badges<br>• sub, gift, cheer and raid notices<br>• going live and Shared Chat<br>• deletes and timeouts<br>• emotes and badges<br>• the channel's blocked terms and AutoMod checks on words people make, from the live founding on (`Safety.md` §4.1)<br>• Shield Mode closes the gate and quiets making |
| 2. Every Twitch moment | Offered after the founding stream | `channel:read:subscriptions` `bits:read` `channel:read:redemptions` `channel:read:hype_train` `channel:read:goals` `channel:read:polls` `channel:read:predictions` `channel:read:ads`; optional `moderator:read:shoutouts`, `channel:read:vips` (new VIPs) and `channel:moderate` (tells a ban from a timeout). New mods arrive through tier 1's `moderation:read` | Authoritative subs and lapses (sub pieces dim, the tint fades); Bits and Power-ups; the Hype Train; goals; polls and predictions in the world; ad breaks (the kingdom holds its breath); signposts and pennants without the tier 3 power |
| 3. Royal powers | One scope at a time, the first time the monarch uses the power | Decree `channel:manage:polls`; Crown vs Crowd `channel:manage:predictions`; Raid Gate `channel:manage:raids`; kingdom rewards and the pool `channel:manage:redemptions`; signposts `moderator:manage:shoutouts`; knighting `channel:manage:vips` | The world speaking back to Twitch, only on the streamer's own press |

The three safety reads in tier 1 serve `Safety.md`. Check AutoMod Status takes only the broadcaster's own token, 100
strings a call, 5 calls a minute and 50 an hour per channel (30 and 300 for Partners). Twitch returns only a channel's
non-private blocked terms. The kingdom never asks for `clips:edit`: it never makes clips (founder decision).

Since 13 May 2026, Bits, subs, emotes, badges and channel points are open to eligible streamers worldwide, and
Twitch's help centre adds polls, predictions and Hype Trains. Ads, charity, goals other than follower goals, and Bits in
Extensions stay Affiliate and Partner only. So features are tried rather than gated on Affiliate status, and a refusal
falls back (`Twitch.md` §14).

**The panel path.** Installing the panel grants no scopes. Its config page opens tier 1 in a new window, and Twitch's
Required Configuration keeps the panel inactive until the channel is connected.

### 7.3 Ingest

- **One EventSub conduit with webhook shards**, behind the same Traefik that serves the surveyor.
- **The herald:**
  - verifies the signature on the raw body
  - writes durable facts to the inbox (the message ID dedupes)
  - publishes to Valkey
  - replies within a second
- **Chat text goes a fast path** through Valkey and is never written to Postgres.
- **At thousands of live kingdoms,** chat moves to a second conduit with WebSocket shards.
- **The conduit is critical infrastructure.** Recreating about 450,000 subscriptions takes about 25 hours. It gets
  alerting and an always-on canary shard.
- **Twitch never replays missed events.** After any gap, a reconciler per fact type fills what it can from Helix:
  - new followers
  - unfulfilled redemptions
  - Hype Train status
  - the chatter list

  Recovered facts are marked recovered and are never staged as live spectacle. Missed cheers and raids cannot be
  recovered.
- **Panel Bits** arrive as `extension.bits_transaction.create`, on a webhook or conduit subscription under the
  Extension's client ID. They are durable facts, deduped by transaction ID, and Get Extension Transactions is their
  reconciler. `channel.bits.use` never carries them.

### 7.4 Writing back

Rooms never call Twitch. They emit intents to the **actions queue**, and the actions service:
- picks the right token
- enforces cooldowns and the Herald's chat budget
- retries safely
- writes the result back as a fact

**The binding limit is chat.**
- The Herald may send 20 messages per 30 s across all of Twitch, or 100 where it is a mod.
- So the kingdom tells its story on stream, not in chat. Chat lines are rare and earned.
- The streamer sets the Herald to silent, rare (the default) or herald (`Monarch.md` §6.9). Its lines are in
  `Twitch.md` §13.

**Who may write.**
- Anything posted to Twitch on someone's behalf is shown to them as a preview first. The monarch sees every decree
  before it becomes a poll.
- Only the broadcaster's own account can trigger a royal write. There are no stewards (founder decision).
- The kingdom never creates clips on the streamer's account (founder decision). The Gallery hangs the director's own
  stills. Stream markers stay optional.

### 7.5 Compliance, built in

- Validate every stored token at startup and hourly, and end sessions on an invalid token.
- Subscribe to `user.authorization.revoke`.
- Twitch data lives in its own tables, so that deletion on revocation or on request is a clean delete that leaves
  Chatdom's own content alone.
- Never store chat logs.
- Content from channels that have not connected is kept for at most 24 hours. Their emotes are voxelised in the
  browser straight from Twitch's CDN.
- Encrypt tokens at rest with AES-256-GCM, with the key outside the database.
- Refresh tokens single-flight under a Postgres advisory lock.
- `!chatdom quiet` and `!chatdom forget` work in every channel.
- **The panel follows Twitch's Extension guidelines** (`Twitch.md` §16, §17):
  - It checks `isBitsEnabled` and hides the Bits shelf when it is false.
  - Bits copy says get, use, exchange, give or earn. It never says cost, spend, donate, support, sell, price, buy,
    purchase or "cheering".
  - Nothing for Bits has free text, random contents or charity, and nothing bought with Bits lasts past a day.
  - Links off Twitch are marked as leaving Twitch and are never the panel's main use.
  - Nobody submits content through the panel.
  - Its first load stays at or under 1 MB, so it runs in the phone apps.
  - Only one version is in review at a time, currently 3 to 15 working days. Data and images from our declared
    domains change without review.

### 7.6 Our own client, and testing

- **We write a thin typed Twitch client** (`packages/twitch`) from the tested skill templates and the official docs.
  Twurple cannot consume conduit shards, refreshes tokens per process, and lacks newer fields.
- **Testing:** the Twitch CLI mocks what it can. Recorded payloads cover the rest (chat, `bits.use`, Hype Train v2),
  and a real dev conduit runs against our test channels.
- **The panel** is tested in Local Test, then Hosted Test, then submitted for review.
- **The Atlas** shares the app and its 800-calls-a-minute budget with the kingdoms. We ask Twitch for a higher limit
  early.

## 8. The client

One codebase, `apps/web`, serves:
- the walker on chatdom.gg
- the throne (the monarch's console: an OBS dock, a tab, an installable phone page or Stream Deck keys, `Monarch.md`
  §7)
- the stream view in OBS
- the Atlas

**The panel is its own client** (`apps/panel`). Twitch reviews and hosts it as a zip, so it is small and changes
rarely. It is a living picture, not the game: a painting of the kingdom's night refreshed every minute from the stream
view's own renders, your home card, tonight's moments, the pool's bar, crowd acts and the Bits shelf (`Twitch.md`
§16). It shares the carved kit's tokens and the `shared` schemas, never the engine.

### 8.1 The engine's shape

- **three.js 0.186 on `WebGLRenderer` (WebGL2)** at launch.
  - three's WebGPU renderer is still experimental and costs 2 to 5 times more CPU on scenes with many objects.
  - OBS on Windows has no WebGPU, and the fallback path is the slowest one.
- **We prepare the move instead of making it:**
  - The voxel and character materials are written in TSL, which three now runs on WebGL too.
  - Switching later is then a setting, not a rewrite. We switch when three's CPU cost is fixed, OBS ships WebGPU, and
    we need compute.
  - Babylon.js and PlayCanvas were considered and rejected: a rewrite for little gain.
- **A fixed simulation step,** separate from rendering:
  - The client simulates its own avatar, collision and prediction at 60 Hz, renders at the display rate, and
    interpolates between the two.
  - Animation and effects run on elapsed time, never on frame counts.
  - Below 30 fps nothing slows down; it just gets choppier.
- **Workers** do the meshing, snapshot decoding, pathing and voxel lighting. We avoid `SharedArrayBuffer`, because the
  security headers it needs would break Twitch embeds and OAuth pop-ups.
- **Modules:**

  | Module | Does |
  |---|---|
  | `core` | Loop, clock, tiers |
  | `net` | Rooms, prediction, interpolation |
  | `input` | Every device into one intent stream |
  | `camera` | Player rig, director rig, replay rig |
  | `voxel` | Chunks, meshing, collision |
  | `actors` | Rig, animation, crowds |
  | `build` | Build mode |
  | `fx` | Effects |
  | `ui` | The kit |
  | `audio` | Sound and music |

  Choreography consumes beats and drives `fx`, `camera` and `actors`, and never writes simulation state.

### 8.2 Input and camera

From `voxel-building-controls.md` §4. **Founder decision: a free cursor, with a camera that follows.** Nothing ever
needs a held button.

| Device | Move | Look | Act |
|---|---|---|---|
| Mouse and keyboard | WASD, relative to the camera. The avatar faces where it walks | The camera eases back behind you after 1.5 s without input. Left-drag, right-drag or Q/E orbit; the wheel or a pinch zooms. Under 8 px and 300 ms is a click; anything more is a drag | Left-click uses what is under the cursor, walking there first if it is out of reach (2.5 m). Left-click on the ground walks there. Right-click opens secondary actions. F uses the nearest highlighted thing. V toggles opt-in mouse look |
| Touch | A floating joystick on the left, with analog speed and running past 80% | Drag anywhere else to orbit; pinch to zoom | Tap a thing to use it or walk to it. Long-press for secondary actions. One context button appears near usable things |
| Gamepad | Left stick | Right stick, with a squared curve and a 0.15 dead zone. The camera auto-follows | A uses the best target, scored by distance and angle with hysteresis so it never flickers. The bumpers cycle targets. No virtual mouse |

**One picking pipeline for every device.** Whatever the device, a pick resolves to the same targets:
- homes and plaques
- citizens and their cards
- seats and tables
- doors
- placed pieces

The highlight and the prompt update every frame, not every 150 ms.

**The camera (Quality rule 9):**
- **Placement:** centred, low and calm, about 7 m back and 18° down.
- **Collision:**
  - Walls, roofs and terrain pull it in instantly, and it eases back out over 0.35 s.
  - Thin things (trees, posts, props, other avatars) dither-fade instead of moving it.
  - It collides with everything, using the same occupancy query as the avatar.
- **Indoors:** a dollhouse cutaway takes over.
- **Motion:** it never rolls, and it never loses mouse input to a slow frame. Smoothing is time-based.
- **Cinematics:** they always hand control back. A guard test checks that you can move after every beat.

**Build mode** swaps to an orbit rig built on `camera-controls` (yomotsu, 3.1.2).

### 8.3 Characters and animation

From `characters-animation-crowds.md`, adjusted by the founder: **a Trove- or Minecraft-level body that looks polished,
is deeply customisable, and has capes that really work.**

**The body:**
- A rigid-part voxel character at 0.0625 m. Each part is bound to one bone.
- About 14 bones: hips, chest, head, two arms with hand sockets, two legs, plus sockets for hat, face, back and both
  hands.
- Every body shape shares the skeleton. Sitting is legs swung forward, as in Minecraft.
- Knees and elbows can be added later without changing the pipeline, because parts bind to bones whatever the bone
  count.

**Faces** are a plate on the front of the head, drawn at the voxel grid.
- Blinking, eye direction and a talking mouth are animated in the shader at almost no cost.
- Expressions swap during a blink.
- A chat emote briefly shows on the face.

**Capes and hair:**
- Capes, long hair and ears are short spring chains of two or three bones (`@pixiv/three-vrm-springbone`, MIT). They
  collide with a body capsule, so they never cut through the body.
- Sub capes come in three tiers. **The tier 3 cape is a rainbow, and it is animated:** an elegant colour shimmer,
  like the star in Super Mario (founder decision), as a shader that cycles through the palette's own ramps, so it
  stays on the palette. It shimmers in colour, never in glow.
- When a sub lapses, its pieces dim but never vanish (principle 4).

**A pose evaluator of our own** (about 500 lines) replaces three's `AnimationMixer`. The mixer averages every clip
that touches a bone and has no per-bone masks, so "the arms swing a hammer while the legs keep walking" needs hacks.

Six layers, in order:

| Layer | Does |
|---|---|
| **Locomotion** | Walk, run and turn, advanced by distance travelled rather than time, so feet cannot slide |
| **Stance** | Sit, kneel, ride, lie |
| **Upper-body action** | Masked to arms, chest and head; the legs keep walking underneath |
| **Additive** | Breathing, idle habits, flinches |
| **Face** | Eyes, mouth, expression |
| **Procedural** | Look-at (heads turn to whoever speaks, and to the monarch), a little lean into turns, squash on landing, springs |

**The tool-use fix:**
- An aim layer twists the chest and head up to about 35° toward the target. Beyond that, the feet take a turning
  step. The whole body never spins.
- Every action has its own clip, with anticipation and follow-through.
- The hit lands a quarter to a third of the way in, and the world's response is timed to that frame.

**Clips:**
- Authored pose to pose in a TypeScript clip format, compiled to keys, and checked by guards: no reference pose, no
  snapping, every state has a clip.
- Reviewed on an in-browser animation bench that records video.
- References are KayKit's CC0 library and the Quaternius library (now under its own licence; archive the downloads).
- Never Mixamo, Synty, ActorCore or LaFAN1 data.
- Golden street: about 32 clips. Launch: about 110.

**The network sends state, never poses:** position, yaw, stance, an action event (id, sequence, start tick) and an
appearance hash. The client derives the rest.

### 8.4 Crowds

**Who has a body:**
- Walkers are people playing.
- Named chatters who are not walking have server-driven bodies near their homes and the plaza. They follow a seeded
  schedule from their ID and the kingdom clock, so every client and the stream view see the same crowd. Their bubbles
  rise over their heads.
- Lurkers are lights only (§7.1).

**One renderer for everyone:**
- Each part style (a hat, a hair) is one instanced draw that reads each character's bone matrices from a pose texture.
- Near characters are posed on the CPU.
- The crowd is posed on the GPU from a baked clip texture.
- `BatchedMesh` is not used for crowds.

**Five detail tiers, chosen by on-screen size and relevance,** so the director's long lenses keep their subjects sharp:

| Tier | Gaming PC | Laptop | Phone | Stream view |
|---|---|---|---|---|
| Full (CPU-posed) | 64 | 24 | 12 | 16 (the shot's subjects) |
| Near crowd | 400 | 150 | 60 | 200 |
| Mid crowd (half voxel resolution) | 1,500 | 600 | 250 | 800 |
| Box figures | 4,000 | 2,000 | 800 | 2,500 |
| Beyond | lights only | lights only | lights only | lights only |

- Tier changes cross-fade with a dither and hysteresis, so nothing pops.
- Individuality is seeded per citizen: tempo, posture, three idle habits from a pool of sixteen, blink rhythm, cheer
  variant and reaction delay.
- Reactions ripple outward from their cause with 80 to 350 ms of jitter, so a crowd never moves in sync (Quality rule
  12).

### 8.5 Rendering

From `rendering-devices.md`.

**The first real-GPU measurement.**
- This build box has an Intel UHD 630. On it the prototype ran at 1080p (*measured*):
  - 53 fps at low settings
  - 8 to 21 fps at medium and high
- Pixel count dominated, then MSAA and shadows.
- A current laptop iGPU is roughly 3 to 6 times faster, so a steady 60 fps on laptops is reachable with Medium-tier
  choices.

**Light is people, as data, not as real lights.** A capital can have 15,000 to 25,000 homes. Four layers keep the cost
flat however many are lit:
1. **Emissive windows** driven by a presence texture, one texel per plot. A citizen joining chat changes one texel:
   no remesh, no recompile.
   - A named light may carry a sub tint by tier (warm gold at tier 1, rose at tier 2, a slow rainbow edge at tier 3),
     as a second channel in the same texture (founder decision, `Twitch.md` §5). The tint colours the edge only and never changes size, brightness or reach. On a lapse
     it fades to a thread at the flame's foot. Unnamed lights never carry one.
2. **A 3D light volume around the camera,** flood-filled through the voxel grid like Minecraft's light (Art §6.2).
   - It makes warm pools on the street, is blocked by walls, and lights characters.
   - It costs 0.5 to 5 MB.
   - It is the hardest new system; if it slips, windows and bloom still carry the idea at a distance.
3. **A small pool of real lights** (4 to 24 by tier) for fire, the Forge and spells.
4. **A town glow in the fog,** so a busy kingdom looks golden from far away.

**Bake what voxels make easy:**
- **AO:** corner AO and sky occlusion are baked in the mesher. There is no screen-space AO in play.
- **Shadows:**
  - Sun shadows use cascades, with the far cascade cached and shadow casters drawn at low detail. The prototype hit
    8.7 million triangles by drawing casters at full detail.
  - Phones get no shadow map.
- **Colour:** grading uses a lookup table per hour and per kingdom.
- **Anti-aliasing:** MSAA on strong tiers, SMAA on weak ones, no TAA for now.
- **The clay material:** colour variation, edge bevels and material patterns live in the shader, never in the voxel
  data. Baking colour noise into data made a cottage 16.5 times heavier (*measured*).

**Painterly interiors (Art §10):**
- Most of the paint is in the material: brush-textured light bands, stable in motion.
- On top sit ink outlines from depth, normals and object IDs, plus paper grain.
- A small anisotropic Kuwahara pass runs at full resolution on PC, half on laptops, and off on phones ("painterly
  lite").
- The door transition blends all of it in over about 0.6 s.
- Kuwahara is tested for flicker on the lookdev street before anything depends on it.

**No pop, by design (Quality rule 11):**
- Every detail change is a dithered cross-fade of about 0.4 s.
- Quality features change only at cuts, doors or loading screens.
- Load spikes are absorbed by dynamic resolution, which resizes the viewport and never reallocates.

**Six tiers,** detected at start, then held steady by the governor:

| Tier | Target | GPU time per frame | Triangles (with shadows) | Tab memory |
|---|---|---|---|---|
| Ultra | Gaming PC, 60+ fps | ≤ 10 ms | ≤ 6 M | ≤ 2.5 GB |
| High | Strong laptop | ≤ 12 ms | ≤ 3 M | ≤ 1.5 GB |
| Medium | Everyday laptop, 60 fps | ≤ 12 ms | ≤ 2 M | ≤ 1.2 GB |
| Low | Phone, 30 fps (60 where it holds) | ≤ 20 ms | ≤ 0.8 M | ≤ 900 MB (iOS kills a page at about 1.5 to 2 GB) |
| Stream | OBS, 1080p60 | ≤ 4 ms | ≤ 2 M | ≤ 900 MB |
| Replay | Offline, 4K | unbounded | unbounded | unbounded |

**The stream view (OBS) recipe:**
- WebGL2 only, opaque by default.
- It stops rendering when the source is hidden, and cold-starts in under 2 s because OBS reloads pages.
- It handles WebGL context loss and passes a 6-hour soak test.
- The director preloads every shot before it cuts.
- It animates from elapsed time.
- It shows the streamer its own cost.
- It comes in three shapes from one URL: the stage (1920 × 1080), a corner window and a bottom strip (`Monarch.md`
  §6.2). The window can open to fill the screen inside its own source, so no scene switch is needed.
- It asks OBS for nothing beyond visibility. OBS's "advanced access" (scene switching) is requested only if the monarch
  chooses a scene switch for moments that open by themselves.
- Before founding, it shows the channel's waiting land in pencil, with settlers' tents and chat lights.
- **Dynamic resolution is allowed** (*founder decision*). When the streamer's PC is busy, the stream view renders at a
  lower internal resolution (down to about 75%) and upscales to 1080p. Detail, lights and animation are never cut for
  this. `Quality.md` §4 records the exception.

**The Atlas hand-off** (`Atlas.md` §7.3, which re-judged this section).
- Two stacked canvases: PixiJS 8 for the Atlas, three.js for the kingdom. There is no shared WebGL context, which keeps
  three.js out of the public Atlas bundle.
- The baker draws each founded kingdom in ink from its hero angle, and the 3D camera starts at that same angle under
  the same ink pass, so the frames match by content.
- The drawing is the loading scene. Loading takes about 3 to 8 s by device.
- When the near world is ready, a 1.5 s reveal fades the drawing into the world.
- The full rise from flat parchment into voxel terrain, over 15 s, is kept for the live founding only.
- Only the target kingdom is ever 3D.
- The Atlas has no night (founder decision). Time of day exists only in the kingdom's renderer, and the map is drawn
  in a single hour of parchment and watercolour.

**Assets:**
- **Voxel models:** checked for palette and scale in the build, with prebuilt LODs compressed with meshoptimizer.
- **Textures:** KTX2.
- **glTF:** via gltf-transform, only for things that are not voxel models.
- **Shaders:** every variant is compiled during loading, never mid-play.

### 8.6 The UI kit

From `ui-audio-shell.md`.

- **SolidJS 1.9 with TypeScript and Vite.** It is 5 KB, has no virtual DOM, and updates only what changed, which suits
  a UI over a 60 fps canvas.
  - Move to Solid 2.0 once its router and ecosystem follow.
  - Preact with signals is the fallback if Codex keeps writing React habits.
- **Our own carved kit (Quality rule 14)**, built on what browsers provide: the native `dialog`, popover, `inert`,
  focus styles, and `@floating-ui/dom` for positioning. There is no headless library by default.
- **World first, DOM for input.**
  - Signs, plaques, the notice board and nameplates are 3D: lit by the world and hidden by walls.
  - When you inspect one, a DOM panel in the same art fades in exactly over it, so text stays crisp and editable.
- **Nameplates** are one instanced, depth-tested draw from a canvas-drawn name atlas, which handles any script. Only
  the hovered or selected citizen gets DOM.
- **No default controls, enforced three ways:**
  - ESLint bans raw controls outside the kit, native tooltips and browser dialogs.
  - Stylelint bans `outline: none`, `backdrop-filter`, raw colours and stray scrollbar styling.
  - Kit components accept only design-token names, and a Playwright walk fails if a browser dialog ever fires.

### 8.7 Audio

From `ui-audio-shell.md`.

- **A small engine of our own on Web Audio,** grown from the prototype's class:
  - buses, mix states and a master limiter
  - voice limits
  - variation banks, so the same sound never plays twice in a row
  - positional sources
- **Music grows with presence.** Stems join at bar lines and leave only after a delay, so the music never flaps.
  - Version 1 uses 8-bar loops, at most four stems in memory, and 24 kHz decoding on phones.
  - Version 2 streams.
- **Formats:**
  - Opus first, AAC as the fallback, chosen by a decode test at start-up.
  - Loop points are stored as sample offsets.
- **Phones:**
  - On touch, audio unlocks on the finger lifting.
  - The iPhone silent switch is respected by default, with a setting to play through it.
- **The stream view plays a separate broadcast mix:** music, ambience, spectacle and the Voice of the Realm, but no UI
  clicks or footsteps. It is quiet by default. Streamers tick "Control audio via OBS" to give the kingdom its own fader.
- **Rejected:** FMOD and Wwise (licence cost, logos, megabytes of WASM), Howler (unmaintained), Tone.js (too big for
  what we use).

### 8.8 The app shell

**Routes:**

| Route | What |
|---|---|
| `chatdom.gg/<login>` | A kingdom, resolved to the broadcaster's ID, so renamed logins redirect |
| `/map` | The Atlas (public). Not `/atlas`, because `atlas` is a valid Twitch login |
| `/map/<login>` | The Atlas, flown to that kingdom with its card open, or to a channel's waiting land or pencil place |
| `/map/road/<login>/<login>` | A road between two kingdoms and its story |
| `/map/line/<id>` | A named raid train |
| `/map/season/<n>` | A season's board and crowns |
| `/me` | Your citizen cards across kingdoms |
| `/<login>/throne` | The monarch's console. It answers only to the broadcaster's own Twitch account; mods see the Watch drawer and the safety keys only. Also an OBS dock and an installable phone page (`Monarch.md` §7) |
| `/<login>/stream#k=<token>` | The stream view. The token sits after `#`, so it never reaches server logs, and it rotates in one click if it leaks on stream. Offered as OBS drag links carrying `layer-name`, `layer-width` and `layer-height`: the stage (1920 × 1080), the corner window and the bottom strip (`Monarch.md` §6.8) |
| `/-/…` | System pages. Twitch logins have at least four characters, so short system paths never collide |

**Loading** (Quality §4):
- The server sends about 14 KB of HTML that already contains this kingdom's loading scene (its crest, name, postcard
  and gate), painted within about 600 ms.
- The engine, the world and the connections stream in behind it.
- The gate opening covers the last uploads, so the kingdom is explorable at about 3 to 3.5 s on a laptop. The phone
  target is 8 s.

**Code and caching:**
- Files are hashed and cached permanently on the CDN.
- A service worker makes repeat visits instant and gives us our own offline page instead of the browser's error.
- **Budgets** (gzipped):

  | What | Budget |
  |---|---|
  | Shell | 60 KB |
  | Engine | 250 KB |
  | Nearby world | 400 KB |
  | Audio before first input | 400 KB |

  The Colyseus SDK alone is 54 KB, so it loads with the engine, not the shell.

**Errors and telemetry:**
- Sentry's SDK, loaded late, reports to a self-hosted Bugsink.
- An error shows a short "seal number", never "Error 500".
- Performance numbers go to our own beacon endpoint.

**Phones:**
- Each kingdom has its own installable manifest with its crest. Since iOS 26, anything added to the Home Screen opens
  as an app.

## 9. Voxels and building

From `voxel-building-controls.md`. The founder's direction: free voxel building on your own plot. The plot grows as you
progress, so you have more space and more items to build with, and nobody starts empty.

### 9.1 One lattice, brush sizes

- **Everything built sits on one 0.125 m lattice** (Quality rule 10), so a 2 m avatar is 16 build voxels tall:
  crafted, not Minecraft.
- **Brushes:**
  - The default brush places a 0.5 m block aligned to the terrain grid, because placing voxels one at a time would
    make a cottage about 7,000 clicks.
  - The 0.25 m and 0.125 m brushes are there from day one.
  - Brush sizes are never unlocked; materials, parts and pieces are.
- **Materials** draw their stone courses and plank grain per 0.125 m voxel in world space, so a wall of blocks reads
  as one wall.
- **Terrain** stays at 0.5 m. Avatars and their wearables stay at 0.0625 m.
- **Forge parts** are 0.125 m house parts. The prototype forged at 0.0625 m; that changes.

### 9.2 Structure and pieces

Two layers share the lattice:

| Layer | What | Why |
|---|---|---|
| **Structure** | Voxels you sculpt: material IDs | Walls, floors, roofs, anything you shape by hand |
| **Placed pieces** | Instances with identity, provenance, state and interactions: furniture, doors, lamps, chests, every Forge part | A door must open (Quality rule 6), a forged chimney must keep its name, a lamp must light |

"Placed piece" keeps the term apart from worn things: `ChatDom.md` says "sub pieces" and "tenure pieces" for those
(`World-Tree.md` §13).

**Placed pieces carve.** A forged window or door cuts its opening into structure without changing the stored voxels,
so removing it heals the wall.

Starter homes and kits stamp into structure and become fully yours to edit, published once you may publish free voxels
(§9.6).

### 9.3 Plots that grow

*Founder decision: a deep lot, where the fence moves back.*

- **The whole lot is reserved when you claim it:** 8 m of street frontage, 16 m deep, 20 m tall.
- **Growth by tier:**

  | Tier | Hut | Cottage | House | Manor | Hall |
  |---|---|---|---|---|---|
  | Depth | 8 m | 10 m | 12 m | 14 m | 16 m |

  - A Hut uses the front 8 × 8 m.
  - Each tier moves the back fence 2 m and raises the height cap, up to twice the footprint and about six times the
    volume.
- **The locked part is a tended meadow,** never bare ground.
- **Nothing ever moves.** Neighbours stay where they are, and streets look full from the first night.
- **Addresses by tenure quarter** (founder decision, `World-Tree.md` §5, `Twitch.md` §5).
  - Genesis lays out one quarter per year of follow, oldest by the castle, each growing at its own edge.
  - Your follow year sets your quarter. Within it, your street is set once, when you settle, from months followed,
    nights present and months subscribed. Nobody moves afterwards.
  - A newcomer's tent stands at the edge of the newest quarter.
- **Homes never fold for absence.** A home whose owner is away rests on its lot (`World-Tree.md` rule 6).
- **At most three homes.** To settle a fourth kingdom, a person leaves one home. It folds whole into their keepsakes,
  and its lot rests as a tended garden with their name, so the street keeps its shape. If they come back with a free
  place, the home unfolds on the same lot (`World-Tree.md` rule 9). A home also folds if its kingdom is deleted
  (`Monarch.md` §10).
- **Every new citizen starts with an editable starter home** in the kingdom's style: three to five designs per style
  kit, plus kits and a Settler's Bundle.
- **Progression unlocks space, height, materials, parts and pieces.** Tenure pieces are earned only (principle 4).

### 9.4 Data

- **Terrain:** 0.5 m voxels in 32³ chunks.
- **Plots:** 0.125 m voxels in plot-local 32³ chunks (4 m cubes), stored sparsely. A typical home fills 8 to 15 of
  its 40 chunk slots.
- **Voxel values:** each voxel is a `u16` material ID into the kingdom's material table. Each chunk has its own
  palette, bit-packed (1, 2, 4 or 8 bits) on disk and on the wire, with a shortcut for single-material chunks.
- **In memory:** indices plus 32-bit column masks, decoded only for about 25 nearby plots (about 11 MB).
- **`CVOX` v1:** each published plot version is one immutable, content-addressed, deflate-compressed file of chunks,
  placed pieces and ground. A home is expected to be under about 16 KB (to measure).

### 9.5 Meshing and collision

- **Meshing:**
  - Greedy meshing with baked AO in a worker pool, merging faces only when material and the four AO values match.
  - Vertices are 8 bytes.
  - Chunk meshes are swapped in place.
  - *Measured:* a 32³ chunk meshes in about 2.2 ms. A whole lot in one pass takes 91 ms, which would break the 100 ms
    rule, so meshing is per chunk.
- **Auto-detail** (eave lips, sills, moss) is an optional pass that adds the kingdom's small shapes without changing
  stored data ("the citizen owns the big shapes, the kingdom owns the small ones", principle 11).
- **Collision** is our own deterministic TypeScript module (`packages/voxel`), shared by client and server.
  - The avatar is a 0.7 × 1.85 m box, swept through one occupancy query covering terrain, structure minus carves,
    placed pieces and open doors.
  - It steps up 0.5 m, with the visual step smoothed.
  - Rapier is not used for walking. It stays an option for future thrown toys.

### 9.6 Edits, drafts and publishing

*Founder decision: build in a draft, then publish.*

**Edits are operations,** not voxel lists: stroke, shape, extrude, paint, stamp, piece move, undo.

**The flow:**
1. The client predicts each edit with the shared validator.
2. The DraftRoom checks it:
   - ownership, rate, bounds and budget
   - item ownership and placement rules
   - nobody standing in the cells
3. The DraftRoom applies it, persists it within 1 s, and acknowledges it.
4. A rejected edit rolls back, and the ghost says why in plain words ("Needs support").

**Timing and history:**
- The ghost updates in the same frame. The final mesh lands within 50 ms at p95; the acknowledgement within 150 ms.
- Undo keeps 200 steps on the server, so it survives a refresh.

**While you build, others see a scaffold with you working on it.**

**Who may publish free voxels:** returning citizens, after a return visit or 30 days of follow. Newcomers use starter
homes, placed pieces and Forge parts (founder decision, `Safety.md` §3.1). Drafts stay private to their builders.

**Publishing re-checks** before anyone sees the result:
- support (nothing floats unless it is magic)
- a path from door to street
- every room reachable
- that no shape spells something nasty: shape detectors on flat orthographic views and colour layers, then the judges
  (`Safety.md` §4)

Moderation is a flat-colour contact sheet of the build, checked by direct judge calls outside any Codex run
(`Safety.md` §4), with the channel's mods as the authority. A clear hit refuses the publish with the region outlined;
an unclear one is held for the Watch. The last approved version stays live until the new one passes. Then the baker
makes LODs, impostors and the contact sheet, uploads the `CVOX` file, and the plot's revision bumps with a
housewarming beat. Only a passed version gets one.

The baker also draws each founded kingdom in ink for the Atlas, from life (founder decision): at Genesis, when a
wonder is finished or a ward opens, at a new season, and at most daily. It draws only from passed versions, and each
drawing passes the beauty check and is checked whole before it replaces the last (`Atlas.md` §8.5, `Safety.md` §3.1).

### 9.7 Building mode

- **Tools:** Place, Shape (box, wall, floor), Extrude, Paint, Erase, Pieces, Select (copy, mirror, save as blueprint),
  Eyedropper.
- **The ghost:** gold when valid, red with a reason and the budget cost when not.
- **The thunk:** a 120 ms settle animation that also hides the re-mesh (Art §8).
- **Touch:** one finger is the tool and two fingers move the camera. You tap to show a ghost, then confirm, so a thumb
  never misplaces.
- **Gamepad:** a grid cursor on a working plane, triggers to raise or lower the plane, and tool and material wheels.

### 9.8 Thousands of plots

- **Four LOD rings per device:**
  1. full detail
  2. merged 0.25 m plot meshes
  3. merged 0.5 m plot meshes
  4. one server-baked impostor per ward

  Rings swap with dithered cross-fades.
- **Per-plot caps:** 25,000 triangles of structure and 25,000 of placed pieces.

| | Gaming PC | Laptop | Phone |
|---|---|---|---|
| World triangles | ≤ 3 M | ≤ 1.5 M | ≤ 600 k |
| Draw calls | ≤ 500 | ≤ 300 | ≤ 150 |
| Full-detail ring | 40 m | 30 m | 20 m |

## 10. Games

From `minigames-forge-ai.md`, `livekit-voice.md` and `docs/08-depth-minigame-engine.md`.

### 10.1 The engine

The names come from `docs/08`:
- **Chalk** is the rules language.
- **Trestle** is the match host.
- **Tableware** is the table renderer.
- **The Royal Taster** is verification.

**Chalk is data, run by a total interpreter.** Visibility is declared and views are derived, so an author cannot write
a game that leaks by accident. Generated code never runs. QuickJS (rebuilt on quickjs-ng 0.16 or later) hosts only our
own small vetted helpers.

Two fixes are needed before any game ships:
- **The leak check must replay move sequences.** A one-moment snapshot check missed a planted leak across 100,515
  samples (*measured*); a trace check found it in two moves.
- **Taint-check the conditions on actions and phase changes.** A move that is legal only when the hidden dice say so
  leaks the dice through the list of legal moves.

**The match** runs in a MatchRoom:
- Chalk state is plain JavaScript, capped at 64 KB.
- On every move, each viewer class's view is derived once, encoded once, and sent as bytes.
- Bots up to level 2 run in the room. Deeper bots and every Taster job go to the taster pool, never the room's event
  loop.
- `match.result` goes to the KingdomRoom, which pays rewards through the ledger. Games never mint.

**Tableware** draws any game from its state: cards, dice, tokens, grids, hands, bids. It is dressed by a board-style
library made under art direction (Art §10.1).

### 10.2 Tables in the tavern

- **Watching:** walking past, you see a voxel miniature and a sign ("6 watching"). Leaning in shows the painted board
  with the spectator view.
- **Sitting:** the camera pushes into the table, and the game opens in its own board style.
- **The streamer's table:**
  - One chat message (`join`, or the variant's own word) enters a seat lottery, gated by trust tier.
  - Chat can also play as one seat, by 20 s votes that close on stream time plus the measured stream delay.
  - When a seat holds private state (a dice cup), chat's cup is shown on stream and chat bluffs in public. The game
    declares this explicitly.
- **Other tables:** chat watches through the director, and joining needs a seat.

### 10.3 Prompted games

Anyone may ask for a game at an empty table. "Instant" is a ladder:

| Rung | When | Time |
|---|---|---|
| **Reuse** | The request matches a verified game on the shelf | Under 1 s |
| **Variant** | One of about 12 hand-made, pre-verified families fits: family, settings, house rules from a fixed menu, and a skin (names, lines, board style, piece set) | A Codex run of about 10 to 20 s, covered by the table dressing itself (§11) |
| **New rules** | No family fits | **Off at launch** (*founder decision*). It switches on once 60% or more of 100 real chat prompts pass every check. Until then the innkeeper offers the nearest variant |
| **Crown lane** | In the background, for any played game the streamer may crown | A deep check, a Codex polishing run, human plays, then the streamer's crown |

Every family is verified across its whole settings grid before it ships, so a variant inherits that proof. The variant
also states what the prompt promised, in a form the checks can test: "the loser walks the plank" becomes "every game
contains an elimination".

**The checks at the table,** run in the taster pool in about 1.5 s:

| Promise | How it is checked |
|---|---|
| Sound rules | Parse, types, a timer on every phase, and fuzzing with random and illegal moves |
| Fair | Win rates per seat over bot playouts |
| Always finishes | The language cannot loop, every game has a round limit, and playouts confirm it |
| No hidden information leaks | The two-worlds trace check: re-roll everything a player cannot see, replay the same public moves, and that player's view must not change |

*Measured:* 1,571 random playouts a second per core for 4-seat liar's dice, and 124,000 hostile moves with no
exception.

**Rewards:**
- Uncrowned games pay the `practice` class, so nobody can farm an easy game they invented.
- Played games stay on the kingdom's shelf (principle 5).
- Crowned games carry their author's name everywhere they travel.

### 10.4 The campfire and Dusk Court

- **The campfire** is a zone in the layer with log seats.
- **Dusk Court** is the werewolf game, written in Chalk. It uses the roles from `docs/08` (Snuffer, Watchman,
  Lamplighter, Fool, Townsfolk) and a Gallery for chat.
- **Night choices are taps and phrasebook lines,** never voice. There is no private voice anywhere (§10.6).
- **The streamer sits as Magistrate.** Thousands watch on stream, so each game has about ten voice connections.

### 10.5 Voice: the architecture

- **LiveKit Cloud** for now. The free plan covers development, and Ship ($50 a month) covers a pilot.
  - Krisp background voice cancellation comes with Cloud and does not work self-hosted.
  - The project is created in the **US region** to match our servers; the region cannot change later.
  - Our code stays off Cloud-only APIs, or wraps them in one place, so the open-source server can replace Cloud.
- **Colyseus decides everything; LiveKit only carries audio.**
  - The MatchRoom mints 2-minute tokens, microphone only, with no data channel and no metadata writes, only for seated
    players.
  - There is one LiveKit room per match.
  - The MatchRoom calls LiveKit's API only to act: a death, a moderator mute, an unseat.
- **Enforce with permissions, never with mutes.** Server mutes and unsubscribes are undone by a modified client in
  one call. Taking away `canPublish` or `canSubscribe` holds (*measured*: listening stopped within about 260 ms and
  could not be regained).
- **Re-check every join against the seat list.** On Cloud, revoke tokens with a cut-off time. A self-hosted server has
  no token revocation (*measured*: a removed player rejoined with the same token), so every join must be checked.
- **The streamer joins from the throne panel,** mic only.
  - The stream view is a hidden listener that plays every seat except the streamer, whose mic is already in OBS.
  - The streamer monitors through OBS and must wear headphones.
- **The Voice of the Realm is not a LiveKit agent.** The codex service writes the line, ElevenLabs renders it once,
  and every client and the stream view play the clip locally on cue. That is cheaper, works without voice, and replays
  exactly.

**Cost:** one 25-minute game is about $0.10 to $0.13 of voice. A kingdom playing three games a week costs about $1.50
a month.

### 10.6 Voice: the rules

Principle 15 says voices are heard only where the streamer invites them. These rules are code, not policy text.

1. **Where and when.** Voice only at the campfire and the throne room, only while the channel is live, and only with
   the streamer seated.
2. **Every word is public.** No private voice: no wolves' den, no ghost room, no voice messages.
3. **Push-to-talk by default.** Open mic only by the streamer's choice, and only on desktop.
4. **Who may speak.** Signed in, **16+ self-declared** (*founder decision*), trust tier 1 with 30 days of follow age,
   no active timeout, ban or warning, and a one-time voice consent. Then the streamer's invite or the seat lottery.
   Everyone else can take a text seat.
5. **Twitch acts within a second.** A ban, timeout or warning on Twitch unseats the person and removes their voice.
6. **The dead cannot speak.** This is enforced by permissions.
7. **Kill switches.** Silence the stream view locally, mute a seat, unseat, or time out on Twitch. Every use is logged
   with a reason.
8. **No secrets** in LiveKit metadata or attributes.
9. **Chatdom records no voice.** The Twitch broadcast and its VOD are the record. A report carries who was holding
   the talk key and when, plus the VOD timestamp.
10. **Protect the mix.** Krisp is on where supported, to keep bystanders off the stream, and the stream mix has a
    limiter.
11. **Recordings of real people** need signed releases, adults only, and are deleted on a stated date.

## 11. Magic: Codex at runtime

*Founder decision: Codex runs every piece of magic.* Principle 16 names Codex as the kingdom's quiet magic, and that is
literally true. Every spell is a Codex agent run. Rituals cover the wait. The judges that guard each spell are not part
of it: they are direct model calls made before and after the run (§11.3, `Safety.md` §4.2).

### 11.1 The codex service

- **The engine:**
  - The Codex SDK (`@openai/codex-sdk`, pinned; 0.165.0 at the time of writing) runs agents in our own workers,
    authenticated with an **API key**.
  - The OpenAI Agents API (the Codex harness as a managed API) is the alternative once it leaves beta.
  - `codex app-server` is marked experimental, so it is not used in production.
  - A ChatGPT sign-in never powers a viewer feature, because the consumer terms forbid it.
- **A spell** is a fixed recipe:
  - skill instructions
  - a tool set
  - an output schema
  - a model and reasoning effort
  - a time budget
  - a fallback
- **Tools are ours and deterministic.** They are served to Codex over MCP:
  - the Forge assembler, renderer and beauty check
  - the Chalk compiler and the Taster
  - the Genesis layout generator
  - event-log queries for the Voice of the Realm
  - OpenAI's moderation endpoint and the Luna judges, as advisory tools only, so the agent can steer itself ("would
    this motif pass?"). The binding gates are direct calls made by the spell runtime before and after the run, never
    by the agent (`Safety.md` §4.2)
- **The agent works in a read-only sandbox** with a scratch folder and no network beyond our tool server.
- **Codex never acts.** A spell returns a plan; the KingdomRoom validates it and applies it as facts. Magic answers
  people's words and never acts on its own (principle 16).
- **Warm pools:**
  - Workers keep Codex sessions started and the skill prompts cached, because a cold `codex exec` measured about 12 s
    and about 34,000 input tokens for a trivial task.
  - Skill prompts and tool sets are kept small to cut that overhead.
  - Model per spell: Luna for routing, Terra for plans and variants, Sol or Astra for Genesis and crown polish.
  - The judges outside the run use Luna through the Decisions API, and Terra for a second opinion on uncertain images
    (§11.3).

### 11.2 The spells

| Spell | What Codex does | Output | Time, covered by |
|---|---|---|---|
| **Forge** | After gate 1 passes (run by the spell runtime, outside the agent): reads the citizen's words; picks a house slot (one of 18) and enums from this kingdom's style kit; calls the assembler; looks at the render; fixes or retries. Gate 2 then runs outside the agent on the contact sheet and the composed name and plaque (`Safety.md` §4) | A `HousePartPlan` (hashed) and the assembled voxels | Target 15 to 30 s, covered by the Forge ritual (`Moments.md` §3). Only while the stream is live; one coal per forge (`Safety.md` §3.2) |
| **Table variant** | Matches the request to a family; sets settings, house rules and the skin; runs the Taster as a tool until green | A variant manifest | Target 10 to 20 s, covered by the table dressing itself |
| **New rules** (gated, §10.3) | Writes Chalk as a flat node table, compiles, tastes, repairs | A Chalk manifest | 30 to 90 s |
| **Crown polish** | Loops on a played game with the Taster: taste, read the report, edit, re-taste | Chalk plus a changelog | Background, minutes |
| **Genesis** | Reads the channel (name, emotes, colours, category, size) through tools; returns name candidates first, then writes a Charter that ranks three landscapes; checks the layout's postcard angles | A `Charter` that the deterministic generator turns into a kingdom | 1 to 3 minutes, run only live on stream at the monarch's press, with no private draft (founder decision). Chat votes on names while the charter is written; a live redraw takes the next landscape with no new run; a deterministic fallback charter takes over at 4 minutes or if the spell fails. Each word and shape is checked before the ceremony reveals it (`Monarch.md` §5.2, `Safety.md` §6 case 10) |
| **Voice of the Realm** | Queries tonight's facts; writes the Ballad, the crier's lines and the season crowning; the monarch can veto | Lines, then ElevenLabs audio | After the stream, minutes |
| **Build check** | Not a Codex run: shape detectors, then Luna on the Decisions API with a flat-colour contact sheet, then Terra if unsure (`Safety.md` §4) | A pass, a hold for the Watch, or a refusal with a reason | Inside the publish scaffold, 10 to 20 s |
| **Motif drafts** | Weekly: drafts new Forge motifs that chat asked for and did not get | Drafts for an artist to pick | Offline |

**The 100 ms rule still holds.** The ritual starts the instant the words arrive, and a refusal ends the ritual
gracefully ("the forge fire gutters"), never with an error. Any refusal may later air on stream as a nameless comic
beat that never shows or hints at the words, at most one every 10 minutes (founder decision, `Safety.md` §5.3).

### 11.3 Guarding the magic

- **The Forge only composes authored parts.** It never generates voxels.
  - Palette and style are locked by construction.
  - Automatic beauty checks look for floating or noisy voxels, a readable silhouette, colour limits, and a fit on
    sample homes.
  - A failed part retries once, then the Forge refuses gracefully (Quality rule 17).
  - It opens branch by branch (founder decision, `World-Tree.md` rule 4): house slots now, worn pieces on sockets once
    their shapes and golden set exist, creatures never.
- **Provenance** is the hash of the plan, the model snapshot and the tool versions. The voxels are stored too, so a
  later grammar change never alters a part someone owns.
- **Two gates around every spell that takes words, run by the spell runtime, never by the agent** (`Safety.md` §4.2):
  - Gate 1 on the words before the run: filters (the channel's blocked terms among them), OpenAI's moderation endpoint
    and Luna on the Decisions API, in parallel. It can pass, soften, hold or refuse. Harmful words never reach the
    generating model.
  - Gate 2 on the result: a flat-colour contact sheet and the composed display text, written and spoken.
  - Two thresholds per question, with a hold band between. A judge that times out counts as unsure, never as a pass.
  - Custom questions cover what the moderation endpoint misses: it reads hate in text only, never in images.
  - The same judges check names, notes, signs and builds with no spell at all. What every kind of made thing passes
    is `Safety.md` §3.1.
- **Quotas:**
  - **Coals and anvils** (`Safety.md` §3.2). A citizen with a home gets one coal for each stream night present, held up
    to 3 for everyone. A forge or a copy costs one coal. The forge burns only while the stream is live. A kingdom
    forges at most as many things at once as it has anvils: 2, plus one for about every 50 present, up to 24. One
    thing in the fire per person. Nothing buys coals. A monarch earns and spends coals in their own kingdom; the
    castle acts as their home for coals, but is not one of the three homes.
  - A roar, after a Hype Train or by the monarch's decree, lights two extra anvils and never adds coals, so its
    rewards stay inside daily caps. Coals come only from showing up; nobody can grant one (founder decision).
  - Prompting games is rate-limited per citizen and per kingdom.
  - A prompt-to-result cache answers repeats at once.
- **When the magic is down,** the world goes on: the forge is "cold tonight", and tables offer the shelf. Without
  Luna, publishes wait and names keep their default.
- **Pin model snapshots** in every record where OpenAI offers them. `gpt-6-luna` has only an alias, so the golden
  suites run nightly against the live model and raise an alarm on drift. Every OpenAI call carries a hashed, stable
  `safety_identifier` per citizen, so OpenAI can block a person rather than Chatdom.

**Spikes to run first:** warm-session latency for each spell with MCP tools (the Forge's 15 to 30 s target depends on
it); token cost per run with caching; and the 100-prompt test of the variant spell.

## 12. Data

Postgres is the truth. Valkey is never the truth. Room state is a cache.

| Store | Holds |
|---|---|
| **Postgres 18** | `kingdom` (with `writer_epoch`, `last_seq`); `person`, `citizen`; `plot`, `plot_rev`, `draft`, `draft_op`; `item_copy`; `ledger` (source classes, idempotency key); `world_event` (partitioned by time); `snapshot` (state, timers, RNG); `inbox`; `match`, `game_manifest`; `twitch_grant` (encrypted) and the other Twitch tables, kept apart for clean deletion; `recording` |
| **R2 + CDN** | `CVOX` plot versions; Forge parts; ward bakes and impostors; game manifests and Taster reports; kits, clips and sounds; wire recordings for replay mode; Chronicle stills |
| **Valkey 9** | The Colyseus room table, inter-process calls, pub/sub channels and rate-limit counters |

**Writing:**
- The event log is written in batches every 100 to 250 ms.
- Economy facts are written before they are acknowledged.
- Snapshots are taken every 1,000 events or 5 minutes, on stream offline, and on shutdown.

**Single writer:** a KingdomRoom bumps `writer_epoch` when it starts, and every insert is conditional on that epoch.
Two processes can never both write a kingdom.

**Crash recovery:**
1. Load the snapshot.
2. Replay the log after it.
3. Apply unapplied inbox rows.

A crash can lose at most one batch of non-economic history (250 ms), and never a build, a Forge result or a coin. The
target is a kingdom back in under 5 s.

**Retention:**
- Twitch data follows §7.5.
- Wire recordings exist only for replay mode. They are kept only for kingdoms whose streamer opted in, with a stated
  retention period.
- Nothing else expires (principle 5).

## 13. Safety

Principle 15 says the channel's own moderators and Twitch's rules are the authority. The tech makes their decisions
travel, and adds nothing that harms anyone's home.

- **Trust tiers.**
  - Tier 0, 1 or 2, from follow age (0, 30 or 90 days) and knighthood. A sub never raises it: the Forge's free words
    open with time and presence only, never with a paid sub (founder decision).
  - The tier sets free text rights, what a citizen may bring to the Forge (menus at tier 0, their own words from
    tier 1), prompt access, voice seats and seat lotteries.
  - It never sets vote weight: one person, one vote, and a sub never adds weight (founder decision). Trust may only
    decide who may vote, as a guard against brigades (decided 2026-10-29).
- **Twitch moderation travels.**
  - Message deletes, clears, timeouts and bans hide bubbles at once, unseat people and remove voice.
  - Deletes propagate everywhere they were shown.
- **Nothing harms another person's home.** No intent can touch another person's plot, items or standing. The
  validators enforce it, not the UI.
- **Every made thing is gated and checked.** The rules for everything people make, the judges, refusals, holds and
  the Watch's review live in `Safety.md`. This file builds them in §9.6, §11.3 and here.
- **The Watch decides; the system proposes.** Automatic actions only hold or hide a thing. Holds go to the channel's
  mods, and to Wardens if the monarch appoints them; Wardens decide holds only (founder decision). Holds nobody decides
  stay private to their maker, and the monarch sees the count at go-live (founder decision, `Safety.md` §5.4).
- **Voice rules** are in §10.6.
- **Reports** carry evidence (who, what, when, VOD timestamp). Fresh accounts' reports count for nothing. Actions are
  "hide and revert with a reason", never silent deletion. Reports act on things, never people. A thing auto-veils at a
  weighted 3 from at least 2 distinct tier 1+ reporters; a neighbour's report of a sign about them hides it for them at
  once (`Safety.md` §5.6, §6 case 11).
- **The stream is the streamer's.** The stream view receives a made thing only after both checks and, where the
  streamer turned on the stream pass when connecting (on by default above 1,000 average viewers), a human pass
  (founder decision, `Safety.md` §5.8). Held and refused things are never in its data. Twitch's Shield Mode quiets
  making and closes the gate to newcomers.

## 14. The stream view, Chronicles and replays

- **The director** (`apps/web`, the stream view) carries the prototype's director forward:
  - a priority queue of beats into shots: establishing crane, push-in through a door, orbit, over the shoulder,
    insert, whip pan, rise to the map
  - cutting on beats and holding climaxes
  - the 180° rule
  - never showing a secret
  - a check that every shot is free of occlusion before cutting
  - the kingdom's postcard angles from Genesis
- **The director's rules for made things** (`Safety.md` §3.1, §5.3):
  - never airing a made thing before both checks, and cutting away within 1 s of a veil
  - sending a frame of each wide shot every 10 s to Luna, and cutting away on a flag
  - at most one nameless refusal beat every 10 minutes, the same whatever the reason
  - reading a door sign's sentence on screen only after it has stood one stream night unreported, or a human passed it
- **The director's duties to the streamer** (`Monarch.md` §6):
  - a shot set for small frames (the corner window and the bottom strip): closer, slower, bigger subjects
  - two moods on the stage: calm (a backdrop, no hard cuts) and show (cuts on beats), and safe areas the streamer
    marks for their camera and chat box
  - Busy: no suggestions, nothing opens by itself, calm framing; climaxes still play on Twitch's clock (founder
    decision)
  - moments the monarch ticked may open the stage by themselves after a 5-second "not now" on the throne
  - "Earlier tonight": at the next break, a labelled replay of about 20 s of any climax the streamer missed
  - the shutter: a calm wide shot with no names, made things or voices, in under a second
  - the live founding ceremony's script, with its fallbacks (`Monarch.md` §5.2)
- **Recording the wire.**
  - A recorder client joins the rooms being recorded (the royal layer, the KingdomRoom, active MatchRooms) and stores
    every frame with its timestamp in 10 s chunks: about 10 to 40 MB an hour.
  - Replay mode feeds those frames back through the same SDK decoder at exactly 1/60 s per rendered frame.
  - That needs no determinism at all, as with Quake or CS demos.
  - The event log stays for the Chronicle and debugging. A spike proves the wire replay first.
- **Replay rendering** (offline, at full quality):
  - The page renders each frame on request, behind a barrier that waits for meshing, loads and shader compiles.
  - 16 sub-frames are averaged in HDR for motion blur, anti-aliasing and depth of field.
  - Frames go to a local receiver and through ffmpeg (ProRes, then x264).
  - A 4K master overnight is an estimate. Time 300 frames first; 1440p is the fallback.
- **Chronicles keep stills only** (founder decision, `Moments.md` §8): the night's words and the director's stills,
  which the Gallery also hangs. Chatdom makes no video of its own: no founding video, no recaps, no Twitch clips. The
  wire recorder and replay rendering above are our own tools, never a feature that publishes video.
- **The truth line:** the Chorus (a simulated crowd for tests and rehearsals) only ever writes to the in-world chat,
  never to real Twitch, and it is labelled SIMULATED on screen.

## 15. Quality guards, in code

`Quality.md` §5 asks for automated guards that take seconds. One Playwright suite runs against a test build with hooks
compiled in, aiming for about 90 s in total.

| Guard | How |
|---|---|
| Scene-cost budgets | Draw calls, triangles and memory at fixed cameras, against the tier tables (§8.5, §9.8) |
| Collision and pathing walks | Scripted avatars walk into every wall, prop and doorway in the lookdev street; fail if any ends inside a solid |
| Placement and grounding | Every piece and Forge part placed on sample homes: no floating, no overlap |
| Camera sweeps | The rig is pushed through tight spaces; fail if the near plane ever enters a solid |
| "Can I still move" | After every beat and cinematic, input must move the avatar (the prototype's frozen-player bug) |
| Input to response | From the input event's timestamp to the first frame that shows a response, and an audible sound |
| Kill and resume | Cut the connection mid-build, mid-forge and mid-game; go offline; close the tab; kill the server. Nothing may be lost |
| Animation and sound coverage | Every state in the action list has a clip and a sound |
| UI states | A gallery renders every state of every panel |
| Visual regression | Fixed cameras at noon, dusk and night, rendered in software for stable screenshots (regression only; the look is judged on devices) |
| The slop linter | Code and copy (banned controls, raw ids, placeholders), rendered pages, and sound files |
| Beauty batches | Forge prompts and Genesis profiles through the beauty check on every grammar or prompt change |
| Server | `@colyseus/testing` for room flows; a 200-bot load test per change set, 1,000 bots at milestones |
| Lint for the simulation | No `Math.random`, `Date.now` or render imports in `packages/world`, `voxel`, `chalk` or `forge` |

The device review (`Quality.md` §5) records the same tour on the gaming PC, an everyday laptop, a phone and in OBS at
every milestone.

## 16. Hosting and operations

*Founder decision: our own servers, in US East.* That is closest to most of Twitch and to
TwitchCon.

**Launch:**

```
Cloudflare (DNS, CDN, R2) → Traefik ─┬─ chatdom.gg          static client
                                     ├─ api.chatdom.gg      api + standalone matchmaker
                                     ├─ eventsub.chatdom.gg herald replicas (conduit webhook shards)
                                     └─ rt.chatdom.gg/<port> realm: one Colyseus process per core
                                            pool "world": KingdomRooms, LayerRooms, DraftRooms
                                            pool "play":  MatchRooms
 Valkey 9 · Postgres 18 (WAL backups to R2, point-in-time recovery) · codex and taster workers · baker
 surveyor (Atlas) · LiveKit Cloud (US) · Prometheus + Grafana · Bugsink
```

- **Machines:** Hetzner's Ashburn (US East) location; one or two machines for the first hundreds of kingdoms.
- **Processes:**
  - one Colyseus process per core (PM2 fork mode or one container each), routed by a static Traefik path per port
  - a placement rule keeps the two pools apart and spreads layers by measured event-loop load
- **Valkey** rather than Redis: Valkey is BSD-licensed, and Redis 8 no longer is.
- **Deploys:**
  - Graceful: flush and snapshot, then clients rejoin by id elsewhere.
  - Roll processes one at a time.
  - Never deploy the world pool during a big stream unless urgent.
- **Metrics:** Colyseus ships no metrics exporter, so we add our own:
  - rooms
  - clients per layer
  - event-loop delay
  - patch bytes
  - inbox lag
  - spell latency
- **Growth:**
  - More machines, same topology.
  - Each kingdom gets a home region chosen from its audience, with a global directory in Postgres. Cross-region raids
    reserve seats through the destination region's API.
  - Mirror rooms only once one kingdom passes about 5,000 connections.
  - WebTransport for avatar transforms once Colyseus marks it stable.

Until launch it runs on the existing box behind Traefik, with previews under `*.chatdom.io`. It moves to US East before
anyone outside the team plays.

## 17. Repository and stack

One pnpm workspace, TypeScript everywhere, Node 24 LTS on the server, Vite and Vitest, Playwright for guards.

```
apps/
  web/        the client: kingdom, build mode, tables, throne, stream view, Atlas (Solid + engine)
  panel/      the Chatdom panel, a Twitch Extension (no engine; reviewed by Twitch as a zip)
  realm/      Colyseus rooms: kingdom, layer, match, draft
  api/        sign-in, sessions, REST, matchmaker, LiveKit tokens
  herald/     Twitch ingest, reconcilers, actions
  codex/      the spell runtime and the MCP tool server
  taster/     game verification workers
  baker/      publish and bake pipeline
  surveyor/   the Atlas service (Atlas.md §8; data half in docs/12)
  studio/     wire recorder, replay renderer, editor
packages/
  world/      events, reducer, state, ledger, rng, beats
  shared/     ids, schemas (zod), messages, budgets: frozen contracts
  voxel/      CVOX, chunks, mesher, collision, validator, brushes
  chalk/      the rules language, interpreter, Taster core
  forge/      grammar, assembler, beauty checks, provenance
  anim/       rig, clip format, pose evaluator
  render/     materials (TSL), light field, post, tiers
  ui/         the carved kit
  audio/      the audio engine
  twitch/     the thin typed Helix and EventSub client
  content/    palettes, style kits, props, starter homes, clips, sounds (data)
  testing/    guards, bots, fixtures, recorded payloads
```

**Pinned at the time of writing** (exact pins in the lockfile):

| Package | Version |
|---|---|
| `three` | 0.186.1 |
| `colyseus` | 0.18.10 |
| `@colyseus/schema` | 5.0.42 |
| `@colyseus/sdk` | 0.18.8 |
| `solid-js` | 1.9.17 |
| `camera-controls` | 3.1.2 |
| `three-mesh-bvh` | 0.9.17 |
| `@pixiv/three-vrm-springbone` | 3.5.5 |
| `@gltf-transform/core` | 4.5.1 |
| `livekit-client` | 2.23.0 |
| `livekit-server-sdk` | 2.19.2 |
| `@openai/codex-sdk` | 0.165.0 |

## 18. Build order

There are no phases and no reduced first version. Build the real thing described in this file and the vision,
end to end, at the quality bar. What to work on next is decided turn by turn in the main thread, with contracts
(`packages/shared`, `packages/world`) frozen before parallel work starts on top of them. Anything that is not real
yet and appears on screen is labelled SIMULATED.

## 19. Still open

Decisions this file does not make, for the founder:
1. **Animation:**
   - Hire a contract animator for about 15 hero clips (the Forge, the crowning, the dragon, the raid wave-in, the cape
     flourish)?
   - Or have Codex write every clip, with review on the bench?
2. **Music and sound:** who makes them? If they work in FMOD, the audio decision is revisited.
3. **The runtime AI budget per kingdom,** and what happens when it runs out. Kingdoms are free, and every spell is a
   Codex run. The Forge's anvils cap a kingdom's concurrent spells (`Safety.md` §3.2).
4. **Recording:** may live sessions be recorded for replay mode, with the streamer's opt-in, and for how long?
   Chronicles keep stills only, so they need no recording.
5. **Raids:** opt-in or opt-out for the receiving kingdom? What a raid into a channel with no land draws on the map
   is `Atlas.md` question 3.
6. **Phones:** the device floor (an iPhone 13 and a 2023 mid-range Android are assumed). Is Firefox first-class? Is OBS
   on macOS a launch target?
7. **Resolved 2026-10-30:** presence is the citizen’s own warm window, named up close; the castle beacon is the kingdom’s light.
8. **Crowned games across kingdoms:** must the adopting streamer re-crown, and does the author's name travel with
   every copy?
9. **The stocks:** may a timed-out citizen be shown in the stocks, and may knighting grant a real Twitch VIP?
   `Safety.md` recommends keeping the stocks off, because they shame a person in public. `Twitch.md` §13 and
   `Monarch.md` §7.3 grant VIP only on the monarch's extra click.
10. **Day-long Bits things on chatdom.gg:** Twitch's written answer (developers@twitch.tv) on whether a thing that
    lasts one day in the kingdom is an "experience outside Twitch". If it is, day-long things shrink to the end of the
    stream (`Twitch.md` §17).
11. **Twitch Data and AI providers.** The Developer Services Agreement §VI.C bars sharing Twitch Data with third
    parties without written permission. Get a legal reading or Twitch's permission before prompts typed in Twitch chat
    go to OpenAI (`Safety.md` §7).
12. **The Atlas.** Its questions were decided on 2026-10-29 (`Atlas.md` §12): paint and pennants on a day map with no
    night, small live channels shown now with land by raid from Edition I, and `live.bin` as size classes (§6.8).
    Still open: Twitch's written answers on derived data, the EventSub cap and the night recorder's 7 days.

## 20. Words

| Word | Meaning |
|---|---|
| Intent | What a client asks for |
| Fact | What the kingdom decided happened, with a sequence number |
| Beat | A fact made visible: tick, moment, reveal, climax |
| KingdomRoom | A kingdom's single writer |
| Layer | One copy of the town for up to about 300 walkers |
| Royal layer | The layer with the monarch and the stream view, filled first come |
| MatchRoom | One game at one table |
| DraftRoom | One plot's build draft |
| Herald | The bot account, and the service that listens to and writes back to Twitch |
| Inbox | Where every Twitch event lands once, before it reaches a kingdom |
| Person | One Twitch identity across every kingdom, with a home in at most three |
| Structure | Voxels you sculpt |
| Placed piece | A thing with identity placed on the lattice: a door, a lamp, a Forge part |
| `CVOX` | One published plot version, as a file |
| Spell | One kind of Codex run: a recipe of skill, tools, schema and budget |
| Judges | The direct model calls, outside any Codex run, that gate words and check results |
| Coal | What the forge takes: one for each stream night you are here |
| Anvil | One forging at a time; a kingdom's anvils cap how many run at once |
| Kingdom reward | A channel-point reward Chatdom creates in the monarch's channel. Never called a spell |
| Pool | Channel points given toward a building's next level |
| Panel | Chatdom's Twitch Extension, under the video |
| Chalk, Trestle, Tableware, Taster | The rules language, the match host, the table renderer, the checks |
| Light field | The voxel light volume and window texture that make presence visible |
| Stream view | The kingdom in OBS: the stage, the corner window or the bottom strip |

## Change log

- **2026-10-29: first version.**
  - Written from nine research reports in `docs/research/tech/` and the founder's answers:
    - **Controls:** a free cursor, with a camera that follows.
    - **Building:** drafts, then publish. Deep lots where the fence moves back.
    - **Characters:** a Trove- or Minecraft-level body, polished and customisable, with capes that work (a rainbow
      cape for tier 3 subs).
    - **Crowds:** the royal layer fills first come.
    - **Lurkers:** anonymous lights until they act.
    - **Voice:** 16+ with the campfire rules.
    - **Servers:** our own, in US East.
    - **Sign-in:** Twitch sign-in required to enter a kingdom.
    - **Games:** variants first, new rules gated.
    - **Stream view:** dynamic resolution allowed.
    - **Magic:** Codex runs every piece of magic.
- **2026-10-29: the five sibling files and the founder's answers.** Folded in from `World-Tree.md`, `Twitch.md`,
  `Atlas.md`, `Monarch.md` and `Safety.md`, and the founder's answers to about 45 questions:
  - **Header:** the five sibling files listed; this file points to them instead of repeating them.
  - **§1:** the kingdom speaks back through polls, predictions, raids and shoutouts, never clips.
  - **§4, §8, §17:** the Chatdom panel, a Twitch Extension, as its own client (`apps/panel`). This reverses "we ship
    no Extension".
  - **§5:** state split four ways: a Person record (look, worn things, passport, at most three homes) beside the
    Citizen record per kingdom. A monarch's castle is not one of the three homes.
  - **§6:** summoned citizens join the royal layer; reruns do not wake a kingdom; panel lights count as presence; the
    raid march is the Atlas's public caravan; the pulse carries one spectacle code and the Atlas event stream carries
    trains, bridges, spectacle and go-live.
  - **§7:** the panel's plumbing (its own client ID, viewer tokens, Extension PubSub, developer onboarding); three
    safety reads added to tier 1 and `channel:read:ads` and an optional shoutout read to tier 2; `clips:edit` dropped;
    channel-point "spells" renamed kingdom rewards, with the pool; Monetization for All; panel Bits as
    `extension.bits_transaction.create` with Get Extension Transactions as reconciler; Herald modes; only the
    streamer presses royal acts; the kingdom never makes clips; Extension compliance; the Herald's mod request moved
    after the founding stream.
  - **§8:** the sub tint in the light field; the stream view's three shapes and OBS permissions; the Atlas hand-off
    re-judged by `Atlas.md` (two canvases, the drawing's angle, a 1.5 s reveal, the full rise only at founding); new
    Atlas routes and the throne route.
  - **§9:** "piece" on the lattice renamed "placed piece"; addresses by tenure quarter with sub months counting toward
    the street; homes never fold for absence; at most three homes; free voxels for returning citizens; the build check
    uses a contact sheet and the judges.
  - **§11:** the judges run outside the Codex run (gates 1 and 2, Luna on the Decisions API, Terra if unsure); coals
    and anvils replace the weekly free Forge and its Hearth price; a Hype Train roar adds anvils, never coals; the
    Forge only while live; Genesis live only, with names first and a fallback charter; the Forge opens branch by
    branch; refusals may air as nameless beats; the Luna alias is watched nightly.
  - **§13:** trust from follow age and knighthood, never from subs; one person, one vote; Wardens decide holds; stale
    holds stay private; reports act on things; the stream pass.
  - **§14:** the director's rules for made things and its duties to the streamer.
  - **§19:** the no-land raid question moved to `Atlas.md`; Safety's advice on the stocks; new items for day-long Bits
    things, Twitch Data and AI providers, and the Atlas liveness study. Questions the founder answered (castle and the
    three homes, sub votes, a paid sub and the Forge's words) are not listed.
  - **§20:** new words: person, placed piece, judges, coal, anvil, kingdom reward, pool, panel.
- **2026-10-29: the Atlas decisions** (`Atlas.md` §12). §6.8: `live.bin` holds five size classes and a spectacle code;
  `dabs.bin` carries small live channels to pencil places on the hamlet-slot grid; no night layer. §8.5: the Atlas has
  no night. §8.8: `/map/<login>` also reaches waiting land and pencil places. §19 item 12: decided.
- **2026-10-29: consistency sweep after round 14.** §8.3: the tier 3 cape is animated, with a colour shimmer like
  the Super Mario star. §8.5: the sub tint goes by tier (warm gold, rose, a rainbow edge). §11.3: no roar gives coals
  and royal coals are gone; a monarch earns and spends coals in their own kingdom. §12, §14, §19: Chronicles keep
  stills only; wire recordings serve replay mode alone.
- **2026-10-29: flat coal cap and optional scopes.** §11.3: everyone holds at most 3 coals. §7.2: tier 2 adds optional
  `channel:read:vips` and `channel:moderate` for the Watch ceremonies and ban events in `Twitch.md` §10.

- **2026-10-30: scaffold direction.** Node 22.23.4 is supplied and sufficient for the scaffold. Freeze small tested contracts when their first consumer starts. Presence uses citizen windows; sound uses CC0/permissive libraries plus procedural audio, credited in THIRD_PARTY.md.
