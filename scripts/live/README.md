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

Reads the managed LIVE realm (default `http://127.0.0.1:5197`, or `CHATDOM_LIVE_REALM`) and prints every **LIVE** moment fact for kingdom 129634568 as it lands, with its delay after Twitch. Cheer, start a Hype Train or raid on twitch.tv/tobi4s_ to see it.

- **Grants:** Bits and Hype Train need the broadcaster's `bits:read` and `channel:read:hype_train`; both are granted on tobi4s_ (`pnpm --filter @chatdom/herald check:auth` lists every capability as available). If they are ever withdrawn, run `pnpm --filter @chatdom/herald authorize -- --role broadcaster`, then `provision:source`. Raids need no grant.
- **Before going live:** `check:auth` should end `Every Herald read capability is authorized.` Herald's conduit then carries `channel.bits.use`, `channel.hype_train.begin/progress/end` (v2), `channel.raid` and the chat types for 129634568, all enabled.
- **What you should see on stream:** the same presentations as on the bench, labelled LIVE instead of SIMULATED, a few seconds after the cheer, train or raid lands on Twitch.
- **Labels:** SIMULATED acts never appear here.

### Stills

`node scripts/live/stills.mjs [homes] [raid] [cheer] [hype]` captures one 1920×1080 still per moment on the stream view while firing it, into `work/evidence/live-twitch/`. Each still holds the shared capture lock only for its own page.

## Many brand-new speakers at once

A first-time speaker claims a home already standing in the approved scene, so the town is not rebuilt for each of them.

- **In one burst:** 40 first-time speakers 150 ms apart all have a home 13.4 s after the first message, and 40 of 40 windows light within 4.1 s of their next message.
- **Cold open:** the kingdom with those homes reopens and serves its watch 13 s after the bench starts, with no lost writer lease.
