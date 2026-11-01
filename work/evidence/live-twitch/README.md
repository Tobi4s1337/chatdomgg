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
| Hype train brings the dragon | `hype@1920x1080.png` (no dragon drawn on this branch: see below) | `node scripts/live/hype.mjs --level 5 --fighters 16` |
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

## Sent to main (exact patch or report)

- **Finished battles stay "current" in the public checkpoint** (`apps/realm/src/outbox/projection.ts`, main's). The projection only ever adds `current: true` moment facts. A victory (published `current: false`) and a new train taking the slot never remove the last occupant, so a stream view that reconnects after a victory is restored into a fight that is over, and old trains pile up. The patch and its test are in `work/lanes/live-twitch/needs-public-moment-slots.patch`. The test fails on main's file and passes with the patch, and the typecheck is clean.
- **The 40-home kingdom does not cold-open.** On `bench.mjs up` without `--fresh` (40 settled homes), the first watch got 503 "still preparing" for 240 s. The realm log shows `opened … at fact 433` → `writer authority closed …: lease deadline passed` → repeated `opened … at fact 434`. The founded-scene build blocks the event loop past the 15 s writer lease (CPU profile earlier: terrain 14.1 s in one stretch). This is in main's founded scene code.
- **New homes are slow** (founded scene code): each one re-assembles, validates and hashes the whole scene. 40 new speakers 100 ms apart: the last waited about 85 s. Paced at 2.5 s: 138–154 s for 40.

## Not proven here

- **LIVE delivery of Bits and Hype Train from twitch.tv/tobi4s_.** It needs the broadcaster to grant `bits:read` and `channel:read:hype_train`. Main's `check-auth` shows both are missing. `live-watch.mjs` is the command to watch it once they're granted. Raids need no grant.
- **The dragon on the stream view.** The realm summons it, fights it and ends it (above), but this branch's kingdom host still returns no lair anchor (`places.lair()` is `null`). Main's seam 32b0197 (merged as 33fb2e9) supplies it and doesn't apply cleanly here without the rest of main. Re-shoot after the lane absorbs main: `node scripts/live/stills.mjs hype`.
- **Frame timing.** Real-GPU frame timing is not measured here (SwiftShader).
