# Live Twitch, proven end to end

One command per moment. Each sends a Twitch notification through the real path:

**Twitch CLI or a signed webhook → Herald (ingest → durable outbox) → realm ingress → moment records / homes → the kingdom's public watch → the stream view**

It then waits for the result on the same public watch that `/stream?source=realm` reads. Everything the bench does is **SIMULATED**: its Herald door stamps every act `origin: simulated`, a live realm refuses those acts, and the stream view labels them SIMULATED. The only thing here that touches LIVE data is `live-watch.mjs`, which reads the running realm and never writes to it.

## The bench

```sh
node --env-file=<file with DATABASE_URL> scripts/live/bench.mjs up [--fresh] [--profile]
node scripts/live/bench.mjs status
node scripts/live/bench.mjs down
```

`up` builds the realm and Herald and migrates its own Postgres schema, `live_twitch_bench`. It copies the adopted layout of `tobi4s_` (kingdom 129634568, 240 plots) read-only from the live schema and adopts it there as SIMULATED. Then it starts three processes:

| Process | Port | What it is |
|---|---|---|
| Realm | 5198 | `REALM_SIMULATED=1`, the bench's own schema and founded store |
| Herald door | 5175 | `herald mock`: a Twitch-signed EventSub webhook door. It uses the same `ChatIngest`, presence source and durable realm outbox as `herald dev` |
| Web | 5199 | Vite, proxying `/api/realm/*` to 5198 |

`up` then announces `stream.online` through Twitch CLI and stays in the foreground, owning the three processes. Stop it with Ctrl-C or `down`.

- **State:** secrets, logs, the outbox and scenes live in `~/.local/state/chatdom/live-twitch-bench/` (owner-only), never in the repository.
- **Running services:** the services on 5190–5197 are never touched.
- **`--fresh`:** drops only the bench's own schema and scenes first.
- **`--profile`:** writes a CPU profile of the realm when it stops.

Watch it in a browser at `http://127.0.0.1:5199/stream?source=realm&kingdom=129634568`.

### When Twitch CLI can't run

Twitch CLI writes the payloads; it is never asked to send anything to Twitch.

- **If it fails** (for example, exit 99 with no output on a host where it can't write its own config), the command prints the CLI's exit code and its last error line.
- **Then it signs the payload itself:** the documented v1 payload for that type (`stream.online`, `channel.cheer`, `channel.raid`, `channel.hype_train.*`), through the same signed door with the same message ID.
- **It says so:** each result line ends `· written by documented payload (Twitch CLI unavailable)` instead of `· written by Twitch CLI`.
- **No other types:** a type without a documented payload stops with "nothing was sent".
- **`bench.mjs up`:** if `stream.online` doesn't reach the door, it stops its own three processes and exits.

## The moments

### A cheer lights the sky at its rung

`node scripts/live/cheer.mjs [--bits 5000] [--from 990000101] [--anonymous] [--again]`

- **How it is sent:** Twitch CLI forwards `channel.cheer` itself, signed with the bench's webhook secret. Herald reads `channel.bits.use`, and the door maps the CLI's retired cheer shape onto it field by field.
- **What you should see:** the sky beat at the rung for that many Bits. 5,000 Bits is Skyfire. The rungs are 1 spark, 100 street fireworks, 500 castle volley, 1,000 hearthbeast, 5,000 skyfire and 10,000 kites.
- **How you know it reached the kingdom:** `cheer · SIMULATED · 5000 Bits → the skyfire rung`, then `reached kingdom 129634568 as moment #N in … ms`.
- **Retry:** `--again` re-sends the identical delivery (same `Twitch-Eventsub-Message-Id`) and confirms nothing new reaches the kingdom.

### A hype train brings the dragon

`node scripts/live/hype.mjs [--level 5] [--fighters 16] [--stop-at summoning|active|victory|end]`

- **How it is sent:** the train climbs level by level. Every payload is written by Twitch CLI (`-D`) and sequenced by the script under one train ID. Twitch CLI only speaks hype train v1, so the door maps it onto v2 without claiming a record, a shared train or a golden one.
- **What you should see:**
  1. At level 3 the realm summons the dragon in the same transaction as the train fact.
  2. Ten seconds later, on the realm's clock, the fight begins.
  3. SIMULATED chatters type `!strike`, and Herald relays each strike once to the realm's battle.
  4. The battle ends in victory, or retreat if the crowd doesn't win.
  5. The train ends.
- **How you know it reached the kingdom:** one line per step, ending with `victory · N strikes from M fighters`.
- **For a still:** `--stop-at active` leaves the dragon circling for the fight's three minutes; `stills.mjs hype` uses it.

### A raid wakes the Raid Gate and the guests arrive

`node scripts/live/raid.mjs [--viewers 48] [--from 990000777] [--login hollowbrook] [--name Hollowbrook] [--again]`

- **How it is sent:** the payload is Twitch CLI's `channel.raid`, signed like Twitch's webhook. The CLI picks a random viewer count and a fixed test name, so the script sets both.
- **What you should see:** the gate's braziers catch and the raider's standard unrolls. A caravan of wagons, sized by the viewer count, rolls up the road under the caption `‹name› rides in · A raid of N · Raiders who chat are our guests tonight`.
- **How you know it reached the kingdom:** `raid · SIMULATED · Hollowbrook brings 48 guests to the Raid Gate`, then the moment number and latency.

### The channel shapes the town

Each of these fires one event through the door and waits for its fact on the kingdom's watch. Each takes `--live` instead: it then reads the managed LIVE realm and waits for the real act on twitch.tv/tobi4s_ (nothing is written to Twitch from these scripts).

- **A follow: a new home and a sapling.** `node scripts/live/follow.mjs [--id 990000300] [--name Hollis_Reed] [--again]`
  - Twitch CLI's `channel.follow` v2, with the follower set. The realm settles the follower in a home placed by their follow date (the edge of the newest quarter), then plants a sapling by the door with their name tag.
  - You see the soil break by the new door, the sapling unfold and its tag swing, under `Hollis_Reed · follows · a new home on the edge of town`. The sapling stays: it is in the `grove` fact.
  - Prints `follow · SIMULATED · Hollis_Reed follows`, the home slot and the grove. An unfollow and a follow again plays nothing new.
- **A sub: the banner and the tenure street.** `node scripts/live/sub.mjs [--id 990000301] [--name Maren_Holt] [--months 14] [--tier 1000]`
  - Twitch CLI's `channel.subscribe` (one month) or `channel.subscription.message` (more). The door turns it into the shared chat notice production reads. Someone with no home yet is settled first on their tenure street: more months, a street nearer the castle.
  - You see the banner unfurl at their home, under `‹name› · 14 months under the banner`.
- **The channel goes live: the gate opens, everyone comes home.** `node scripts/live/online.mjs [--returning 4]`, and `--rest` for `stream.offline`
  - Twitch CLI's `stream.online`. The realm opens the night (`Night N`): the gate's braziers catch, its standard climbs in the town's colours and the castle beacon is lit. With `--returning`, SIMULATED citizens who already have homes speak; each is welcomed home once tonight. Their window flares and the neighbours' windows answer, under `Welcome back, ‹name›` (with the days counted after fourteen or more away).
  - `--rest` closes the gate. Every home, sapling, banner and colour stays where it was for the next night.
- **Channel points: the kingdom rewards.** `node scripts/live/redeem.mjs [--reward "Call a Festival"] [--id 990000100] [--name Wrenna]`
  - Twitch CLI's redemption, with the reward's title set. Herald reads the title only, never what the viewer typed. The four kingdom rewards are **Ring the Bell** (three strokes from the castle), **Call a Festival** (the streets dress in the town's colours for ten minutes), **Plant a Tree** (a tree grows by the redeemer's home, one to a plot) and **Show My Home** (the camera visits it and its window flares). Any other reward is the streamer's own, and nothing happens in the town.
  - To make them real on tobi4s_, create four custom rewards with exactly these titles in the Creator Dashboard (Viewer Rewards → Channel Points). Then `redeem.mjs --live` waits for one.
- **A poll: the town decides together.** `node scripts/live/poll.mjs [--title "Our colours"] [--choices Ember,Tide,Meadow] [--votes 3,7,2] [--paid 0,1,0] [--seconds 20]`
  - Twitch CLI's `channel.poll.begin`, `channel.poll.progress` (twice) and `channel.poll.end`, as one poll. The decree board rises in the plaza and each pennant climbs to its share of votes.
  - One person, one vote: votes bought with channel points are counted apart (`--paid`).
  - A poll whose every choice is one of the town's colours (Ember, Gold, Rose, Tide, Meadow, Dusk, Snow, Night) is a decree: the winner's colours run out across the town's bunting and the gate's standard, and stay. A tie, or a poll Twitch moderated, decides nothing, and the board says so. Any other poll is decided on the board and changes nothing.
- **For the LIVE ones:** see the grants below.

### Everyone who speaks gets a home window, beyond the old 12

`node scripts/live/chatters.mjs [--count 40] [--pace 2500]`

- **How it is sent:** the CLI cannot write `channel.chat.message`, so the script signs Twitch's documented shape itself. Each of 40 SIMULATED chatters speaks once. The realm settles a home for every one of them: Herald's 12-slot presentation is not a cap here. Then they keep chatting.
- **What you should see:** 40 lit windows at once.
- **How you know it reached the kingdom:** `homes … 0 → 40` and `windows lit at once: 40 of 40`.

### Nothing double-fires on retry

`node scripts/live/retry.mjs`

The same spectacle is posted twice to the realm's ingress, as Herald's durable outbox does after a lost reply. The realm answers `accepted`, then `duplicate`.

Herald also drops a repeated `Twitch-Eventsub-Message-Id`; `--again` above shows it. The dragon's strikes are transient, rate-limited per person and never stored.

### LIVE

`node scripts/live/live-watch.mjs [--realm http://127.0.0.1:5197] [--minutes 30]`

Reads the managed LIVE realm (default `http://127.0.0.1:5197`, or `CHATDOM_LIVE_REALM`) and prints every **LIVE** moment fact for kingdom 129634568 as it lands, with its delay after Twitch. Cheer, start a Hype Train, raid, follow, subscribe, redeem a kingdom reward, start a poll or go live on twitch.tv/tobi4s_ to see it.

- **Grants:** Bits and Hype Train need the broadcaster's `bits:read` and `channel:read:hype_train`; both are granted on tobi4s_. Follows, kingdom rewards and polls need three more from the broadcaster: `moderator:read:followers`, `channel:manage:redemptions` and `channel:manage:polls` (Twitch requires the manage scopes even to read redemptions and polls). Until they are granted, `check:auth` lists `follows`, `rewards` and `polls` as waiting, and everything else carries on. To grant them, run `pnpm --filter @chatdom/herald authorize -- --role broadcaster` as tobi4s_ (it keeps every scope already granted), then `provision:source`. Raids and going live need no grant.
- **Before going live:** `check:auth` should end `Every Herald read capability is authorized.` Herald's conduit then carries `channel.bits.use`, `channel.hype_train.begin/progress/end` (v2), `channel.raid`, `channel.follow` (v2), `channel.channel_points_custom_reward_redemption.add`, `channel.poll.begin/progress/end`, `stream.online/offline` and the chat types for 129634568, all enabled.
- **What you should see on stream:** the same presentations as on the bench, labelled LIVE instead of SIMULATED, a few seconds after the cheer, train or raid lands on Twitch.
- **Labels:** SIMULATED acts never appear here.

### Stills

`node scripts/live/stills.mjs [homes] [raid] [cheer] [hype] [follow] [sub] [online] [homecoming] [bell] [festival] [tree] [poll] [decree]` captures one 1920×1080 still per moment on the stream view while firing it, into `work/evidence/live-twitch/`. Each still holds the shared capture lock only for its own page. The town's beats last seconds and a software-rendered 1080p frame takes most of a minute, so for those stills the page's wall clock is held at the beat's peak while the frame is drawn. A follow, a sub and a planted tree use fresh people each run; the homecoming welcomes `CHATDOM_RETURNING=ID:name` (default `990000310:Hollis_Reed`), who must already have a home from before tonight. A decree only plays when it changes the colours the town flies: its still elects Ember unless `CHATDOM_DECREE_VOTES` (votes for Ember,Tide,Meadow) says otherwise.

## Many brand-new speakers at once

A first-time speaker claims a home already standing in the approved scene, so the town is not rebuilt for each of them.

- **In one burst:** 40 first-time speakers 150 ms apart all have a home 13.4 s after the first message, and 40 of 40 windows light within 4.1 s of their next message.
- **Cold open:** the kingdom with those homes reopens and serves its watch 13 s after the bench starts, with no lost writer lease.
