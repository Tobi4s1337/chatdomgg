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

# LT11 evidence: every Twitch event shapes the kingdom

Same bench and path as LT10, **SIMULATED** end to end, with the door on 5173 this time (5175 was held by another
worktree's API): `CHATDOM_BENCH_DOOR_PORT=5173 node scripts/live/bench.mjs up`. The managed services on 5190–5197 were
never touched.

## What reached the kingdom

| Command | Result on the kingdom's public watch |
|---|---|
| `online.mjs` | `stream.online · SIMULATED · Night N opens: the gate is lit`; a second notice for the same stream is the same night |
| `follow.mjs --id 990000310 --name Hollis_Reed` | `a new home on slot 4100`, `grove: a sapling by the door of slot 4100`; `--again`: deduplicated, no second sapling |
| `sub.mjs --name Maren_Holt --months 14` (a new subscriber) | no home yet: settled on slot 4102 with 14 months as tenure evidence (one street toward the castle), then the banner unfurls on it |
| `redeem.mjs --reward 'Show My Home'` / `'Ring the Bell'` | the director visits the redeemer's home and its window flares / the bell rings from the castle |
| `redeem.mjs --reward 'Call a Festival'` | the festival is the current `festival` fact: ten minutes, in the town's colours |
| `redeem.mjs --reward 'Plant a Tree'` (a redeemer with no home) | settled first (slot 4101), then a tree on their own plot, added to the `grove`; a redeemer whose deed predates the bench's layout revision has no current home and the tree is refused as stale |
| `redeem.mjs --reward 'Hydrate!'` | nothing: a streamer's own reward is theirs |
| `poll.mjs` (votes 2 · 5 · 5, paid votes taken off) | the board stands while the poll runs; at the end `the town is divided`, nothing changes |
| `poll.mjs` (votes 2 · 1 · 5) | `the town chose Meadow`; `decree.colours` is Meadow from then on (Postgres `realm_moment_values` holds the decree record) |
| `online.mjs --rest`, then `online.mjs --who ID:name,…` (three citizens settled before tonight) | a new night; each returning citizen's first chat plays `Welcome back, ‹name›` at their own home, the one they left; their second message tonight plays nothing |

## Stills (1920×1080, stream view)

`CHATDOM_BENCH_DOOR_PORT=5173 node scripts/live/stills.mjs follow sub online homecoming bell festival tree poll decree`.
These beats last seconds, and on this host a software-rendered 1080p frame lands 40–90 s after the cue. So each still
holds the page's wall clock (Playwright `clock.setFixedTime`) at a fixed offset into the beat the page itself admitted:
the frame drawn is the one a GPU would show at that instant. Every still carries the SIMULATED mark.

| Moment | Still | Held at |
|---|---|---|
| A follow: a new home on the edge of town and its sapling, the director on the front garden, "Hollis_Reed · follows · a new home on the edge of town · their sapling takes root" | `follow@1920x1080.png` | 4.2 s into the beat |
| A sub settles a new subscriber on their tenure street: "Maren_Holt · 14 months under the banner" over their door (slot 4096). This native home has no wall the banner fits (a door between two windows), so the cloth does not hang: see the doubts | `sub@1920x1080.png` | 4 s into the beat |
| Going live: the gate's braziers lit, the standard up in the town's colours, "The gate opens · Night 5 · welcome home, everyone" | `online@1920x1080.png` | 7 s into the beat |
| Ring the Bell: the castle's crown rings out over the town, "Hollis_Reed · rings the castle bell" | `bell@1920x1080.png` | 2.4 s into the beat (the second stroke's rings) |
| Welcome back: Hollis_Reed's first chat of Night 6 lights their own home (slot 4100, the one their first follow gave them), the neighbours' lamps answer, "Welcome back, Hollis_Reed · the lights come on at home"; their sapling still stands by the door | `homecoming@1920x1080.png` | 2.2 s into the beat |
| Plant a Tree: a fresh redeemer (Ilsabet_Rowe) is settled on slot 3073 and their tree grows in their own front garden, 2.3 m off the path, "Ilsabet_Rowe · plants a tree at home" | `tree@1920x1080.png` | 5.4 s into the beat |

## LIVE on twitch.tv/tobi4s_

- **Going live** needs no grant: Herald's conduit already carries `stream.online/offline` for 129634568. The gate
  opens on the real channel once the managed realm runs this code.
- **Follows, kingdom rewards and polls** wait on three broadcaster grants. `check:auth` (2026-11-01 14:48 UTC):
  `✗ follows · missing moderator:read:followers`, `✗ kingdom rewards · missing channel:manage:redemptions`,
  `✗ polls and decrees · missing channel:manage:polls`. To grant them, tobi4s_ runs
  `pnpm --filter @chatdom/herald authorize -- --role broadcaster`, then `provision:source`. Herald keeps no user token
  by design, so nothing here creates a reward or a poll on Twitch: the monarch makes the four rewards (`Ring the Bell`,
  `Call a Festival`, `Plant a Tree`, `Show My Home`) and starts a poll (Ember / Tide / Meadow) in the Creator
  Dashboard; `follow.mjs --live`, `redeem.mjs --live`, `poll.mjs --live` and `online.mjs --live` wait for the real act.
- **Subs** need a real subscriber.

## Found and fixed on the way (LT11)

- **The director missed the town's beats in stills.** A software frame lands most of a minute after the cue, long after a sapling's or a gate's shot has ended. The stills now hold the page's clock at a fixed offset into the beat the page admitted (the controller's metrics name the latest beat and when it takes the stage).
- **A planting's caption hung off the top of the frame.** The banner's close shot framed the doorstep; the words over the door fell outside it. Home beats of the town (sapling, tree, window answering, welcome) take a front-garden shot from the street instead.
- **The poll board was framed from under the balloon.** The plaza's shot looks 20 m up at a float; the board stood below the frame. Board, decision and colours beats frame the board from across the square, question and every pennant in it.
- **The poll's board left the stage before the votes moved,** and from across the town its pennant labels piled on each other. The poll's opening now holds the board for 12 s (the beat runs 14 s), and a pennant only gets its own label when the board is near enough for the labels to stand apart.
- **The festival looked up at the castle.** A festival is the whole town dressed: it no longer takes the camera, and the director's view over the streets is its shot.
- **A tree stepped along the wall into the neighbour's garden** when the window stood where it would grow. It now stands out in its own front garden, off the path.
- **The gate's standard rose out of a brazier** from the director's angle: it stands on the verge, 5.4 m across.
- **`redeem.mjs` missed an uncredited redemption** (a redeemer the town cannot name is credited to a friend of the realm): it now also accepts the uncredited fact of the same reward.

## Not proven here (LT11)

- **A sub's banner on every home.** `bannerMount` (main's `apps/web/src/kingdom/moments/anchors.ts`) finds no wall on some native homes (slot 4096: a door between two windows), so the sub's caption shows and the cloth does not hang. Needs main: a mount for those homes.
- **A bell you can see.** The castle keep has no bell; the bell is drawn as its sound (rings and a strike glint at the crown). A belfry belongs in the castle kit.
- **LIVE follows, rewards and polls** wait on tobi4s_'s three grants (above); a real stream's going-live waits on the managed realm running this code.
- **Real-GPU look and timing** of the beats (the clock-held stills show their peak, not their motion).
- **Bench oddity:** chatters settled before the bench's layout revision have no current home, so their tree is refused and their bell is credited to a friend of the realm. Fresh people (as the stills use) are settled and named.

## Integration review, 2026-11-01

All nine existing LT11 stills were inspected together in `/tmp/live-twitch-review-contact.png`. The decree still is
only the opening/loading screen and is **rejected as evidence**. The poll still is a distant town view and does not
demonstrate the board. The other stills show the actual scene; the subscriber's missing banner remains the explicit
anchor limitation above. These existing captures predate the integration review; no new capture or live Twitch act
was performed for this review.

The final focused regression run passes 69 tests across seven files, and `pnpm typecheck` plus scoped ESLint pass.
Regressions cover redemption retry/rollback, reordered and reconciled nights, older polls/decrees, the real growth
binding in citizen installation, and a maximum-epoch 4,096-entry grove restored through both public projection and
browser controller within the 288 KiB outbound budget. The renderer's fixed first-512 planting selection remains a
large-town visual limitation; record/transport coverage does not demonstrate every home's planting on screen.
