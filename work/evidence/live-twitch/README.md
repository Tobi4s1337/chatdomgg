# LT10 evidence: the real channel answers, whole

All runs are on the lane's own bench (`scripts/live/bench.mjs up --fresh`), **SIMULATED** end to end:

- **Realm:** 5198, schema `live_twitch_bench`.
- **Herald door:** 5175.
- **Web:** 5199.
- **Kingdom:** 129634568 (Willowmere), with `tobi4s_`'s adopted 240-plot layout copied read-only and adopted as SIMULATED.
- **Path:** Twitch CLI or a signed webhook → Herald `ChatIngest` → durable realm outbox → realm ingress → moment records / homes → `/api/realm/watch/129634568` → `/stream?source=realm&kingdom=129634568`.

The managed services on 5190–5197 were never touched.

## Stills (1920×1080, stream view)

| Moment | Still | Command |
|---|---|---|
| Raid wakes the Raid Gate | `raid@1920x1080.png` | `node scripts/live/raid.mjs --viewers 140` |
| Cheer at its rung (5,000 Bits → Skyfire) | `cheer@1920x1080.png` | `node scripts/live/cheer.mjs --bits 5000` |
| Hype train brings the dragon (the fight active, the dragon over the town, the festival bunting strung across it) | `hype@1920x1080.png` | `node scripts/live/hype.mjs --level 5 --fighters 16 --stop-at active` |
| Everyone who speaks gets a window (stage held on its window shot, `&camera=window`) | `homes@1920x1080.png` | `node scripts/live/chatters.mjs --count 40` |

`node scripts/live/stills.mjs [homes] [raid] [cheer] [hype]` reproduces them under the shared capture lock. Every still carries the stream view's SIMULATED mark.

The renderer's own count agrees with the watch. On the stream view, `activeWindows` went 0 → 13 → 27 → 40 within 20 s of the 40 chatters speaking, and held at 40. Without chat it falls back to 0 once the 90 s presence lease runs out.

## What reached the kingdom

| Command | Result on the kingdom's public watch |
|---|---|
| `chatters.mjs --count 40 --pace 2500` | homes 0 → 40 in 153,746 ms, and again in 138,359 ms on a fresh bench; windows lit at once: 40 of 40, 7–9 s into the second round |
| `raid.mjs` | `raid · SIMULATED · Hollowbrook brings 48 guests to the Raid Gate`, moment #1 in 330 ms; `--again`: deduplicated |
| `cheer.mjs --bits 5000` | `cheer · SIMULATED · 5000 Bits → the skyfire rung`, moment #2 in 399 ms; `--again`: deduplicated |
| `retry.mjs` | realm ingress answers `202 accepted`, then `202 duplicate`, for the same observation |
| `hype.mjs --level 5 --fighters 16` | the train begins in 629 ms; at level 3 the dragon is summoned 345 ms later in the same transaction; the fight begins on the realm's clock; `victory · 177 strikes from 16 fighters (192 sent)`; the train arrives at level 5. The `end` commits 0.5 s after Herald receives it |
| `cheer.mjs --bits 100 --again` without `twitch` on `PATH` | `Twitch CLI could not trigger channel.cheer (exit ?: spawnSync twitch ENOENT); signing Twitch's documented channel.cheer payload instead`, then the moment in 360 ms `· sent by documented payload (Twitch CLI unavailable)`; the retry is deduplicated |
| `raid.mjs` with a `twitch` that exits 99 with no output (main's host) | `exit 99 …; signing Twitch's documented channel.raid payload instead`; the moment in 375 ms, labelled the same way |

## Found and fixed on the way

- **Spectacles queued behind chat.** Herald's durable realm lane posted strictly oldest-first, so during the fight a train's `end` waited behind the presence posts from 176 `!strike` chats: received 12:06:22.55, committed 12:07:18.45 (56 s). A due spectacle now goes right after urgent cleanups (`apps/herald/src/realm-delivery/delivery.ts`, with a test). On the same run shape the `end` commits in 0.5 s.
- **Battle shots cued too late.** The battle's first 9 s focus window had already passed when a software-rendered 1080p frame landed. The hype still now cues on the summoning, and a still's command ends cleanly if the screenshot fails.
- **Bench left processes behind.** `bench.mjs` now ends every process it started on any exit path, including a failed `stream.online`.

## Fixed in the realm with main's code absorbed

- **Finished battles stayed "current" in the public checkpoint** (`apps/realm/src/outbox/projection.ts`). The projection only ever added `current: true` moment facts, so a stream view that reconnected after a victory was restored into a fight that was over, and old trains piled up. The Hype Train and the battle now each hold one slot, as in the records: a new occupant replaces the last and a finished one leaves (`projection-moments.test.ts`).
- **A fresh kingdom never delivered anything** (`apps/realm/src/outbox/dispatcher.ts`). Earned growth (fcc3de4) commits a `growth` frame as a kingdom's first outbox row, and the store, projection and web observer all read it, but the dispatcher refused it as "not a public message". Delivery held on row 1 forever and the watch answered 503. The dispatcher now delivers growth frames for its own kingdom and still holds on anything else (`dispatcher.test.ts`, which fails without the fix).
- **Cold open and new homes** (main's 9b1c4f8 and c0a0a14, measured here): 40 first-time speakers 150 ms apart all have a home 13.4 s after the first message (it was about 85 s for the last), 40 of 40 windows lit 4.1 s into their next round. The kingdom with those homes reopens and serves its watch 13 s after `bench.mjs up`, with no lost writer lease (it was 503 for 240 s).
- **Re-checked on the merged code:** cheer 5,000 → moment in 349 ms, raid 286 ms, both retries deduplicated; `retry.mjs` → `202 accepted`, then `202 duplicate`.

## LIVE on twitch.tv/tobi4s_

- **Grants:** `check:auth` (2026-11-01 12:59 UTC) shows `bits:read` and `channel:read:hype_train` granted, and every Herald read capability available, including cheers and hype trains.
- **Subscriptions:** Herald's conduit carries `channel.bits.use` v1, `channel.hype_train.begin/progress/end` v2, `channel.raid` v1, `stream.online/offline` and the chat types for 129634568, all `enabled` (Helix, read only).
- **Still to watch on a real stream:** a real cheer, Hype Train or incoming raid on tobi4s_ reaching the stream view labelled LIVE. Nothing here can make one: a cheer needs a viewer's Bits, and a raid needs another channel. `node scripts/live/live-watch.mjs` prints each LIVE fact with its delay after Twitch.

## Not proven here

- **The director's dragon shot.** The dragon flies over the town in the hero shot. In software rendering a 1080p frame lands after the director's 9 s battle focus has passed, so the still never shows the closer battle framing. Check it on a real GPU.
- **Frame timing.** Real-GPU frame timing is not measured here (SwiftShader).
