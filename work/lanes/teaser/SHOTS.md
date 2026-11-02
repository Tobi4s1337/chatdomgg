# The teaser: shot list

For Tobias's approval (K02). This file is written by `node apps/studio/edit/shots-md.mjs` from the shot scripts in
`apps/studio/src/shot-list/`; edit the scripts (or `apps/studio/edit/shots-head.md` for this preamble), never this file.

## The idea in one watch

A chat becomes a people, the people get a kingdom, and kingdoms meet on a map of Twitch. Someone who has never heard
of Chatdom watches it muted on a phone and can say what it is: the captions carry the narration, and the pictures
carry the rest.

## The arc

1. **A chat (0:00–0:11).** A real-looking Twitch page, a quiet evening, tens of viewers. A four-year lurker writes
   for the first time. The camera goes through the screen.
2. **A kingdom (0:11–0:29).** The island at golden hour, then the Way Home: road, street, door.
3. **Lights (0:29–0:37).** Chat bursts and the town lights with it; the quiet viewer taps the panel and their window
   lights too.
4. **The Forge (0:37–0:47).** A `!forge` line in chat becomes a dragon chimney on a house.
5. **Growth (0:47–0:52).** The hamlet becomes a town.
6. **Raids (0:52–1:16).** Twitch's own raid notice; the caravan under PinkKittyRose's colours; a huge raid's long
   line of wagons; the gate waking at the end of the night; the camera rising out over the road; the road inking
   across the map; tobi4s_'s own wagons arriving at MashaD4's gate as her windows light. No signs, cards or captions
   in the world: the picture says "they came to us" (her colours coming in) and "we rode out to them" (his colours
   arriving at her gate).
7. **The map and the close (1:16–1:27).** Thousands of kingdoms; the night town with the lurker's window still lit.
   "Every chat deserves a kingdom." chatdom.gg

## Rules the shots keep

- **Staged, never labelled.** The page is our replica of twitch.tv/tobi4s_ and the chat is a seeded crowd of invented
  names, each checked absent on Twitch (`apps/studio/src/chat/names-checked.json`). Nothing inside the film says
  SIMULATED; the kingdom plates are canvas captures, so no product chip can reach them. The film says it once, where
  it cannot break a shot: a line of small print on the close card ("The Twitch page and chat in this film are
  staged. The kingdoms are Chatdom, rendered as they run."), and the YouTube description says the same.
- **Honest scale.** tobi4s_ shows tens of viewers; PinkKittyRose raids with 48 (Decision 4). The huge column (S16)
  has no name and no number.
- **Real names only with consent.** tobi4s_, The_AGGman, PinkKittyRose and MashaD4. On the Atlas no other channel
  may be legible.
- **Every frame is a function of (shot, t).** Page shots render in the studio, kingdom shots on Tobias's GPU through
  the frame-stepped recorder; the same script renders the same frame every time.
- **Narration** is the Voice of the Realm, Rowan (final takes and the pick per line in `VOICE.md`; the comparison in
  `VOICES.md`): at most eight words a line, present tense, never explaining a mechanic. Captions are burned in from
  the voice's own timings.

## The cast

- **tobi4s_**, the broadcaster (real, consenting).
- **nachteule_42**, the four-year lurker who writes for the first time in S02 and whose home the Way Home finds.
- **The quiet viewer** whose screen we are watching: logged in, never chats, taps "Light your window" in S09.
- **Funkenflug_Jo**, who types the `!forge` wish in S10.
- **PinkKittyRose**, raiding with 48 viewers (real, consenting); **MashaD4**, the destination of the ride out.
- About 120 regulars, mods, VIPs and raiders, all invented and checked.

## Status words

- **staged:** a real render of today's build (studio page or GPU take).
- **stand-in:** the closest real still or clip, moved in the edit, until the product (or a set piece) can stage the
  moment. Each stand-in says what it waits for.
- **Film take:** the TS11 plate that replaces the rough cut's source in the first cut: a frame-stepped GPU render of
  a set piece (`apps/studio/src/set/`) or a product route, listed in `apps/studio/rig/film.mjs` and logged in
  `TAKES.md`. The first cut uses a shot's film take once its master is verified, and the rough cut's source until
  then.

## The list (generated from `apps/studio/src/shot-list/list.ts`)

22 shots, 1:27 before the end card's tail; 10 staged on today's build, 12 stand-ins.

| # | Cut | Shot | Narration | Rough cut source | Film take (first cut) | Hooks | Status |
|---|---|---|---|---|---|---|---|
| S01 | 0:00–0:04 | **The channel.** twitch.tv/tobi4s_ live on a quiet evening: the kingdom at dusk in the player, chat trickling, 34 viewers, the Chatdom panel under the video. The cursor drifts like a hand. | “Every stream has a chat.” | studio page (normal layout) |  | /stream source=simulated seam=starting; /panel source=simulated | staged |
| S02 | 0:04–0:07 | **The line.** The camera pushes in on chat: a four-year lurker writes for the first time, with Twitch’s first-time-chatter highlight. | “Every chat… is a people.” | studio page (normal layout) |  | studio virtual camera | staged |
| S03 | 0:07–0:11 | **Through the screen.** The camera slides off the chat line, across the player and through it into the kingdom, where a window lights. |  | studio page (normal layout) → GPU take `stream-dusk` from frame 703 (`/stream?source=simulated&layout=stage&seam=starting&hour=19.3`) | `film-stream-dusk` not shot yet (`/stream?source=simulated&layout=stage&seam=starting&hour=19.3`) from 11.72 s | studio virtual camera; /stream source=simulated seam=starting | staged — From 3.2 s the full-frame stream take continues the same picture the player showed. |
| S04 | 0:11–0:17 | **The island at golden hour.** A slow aerial over the grand land: low by the ships in the harbour, rising over the shore as the peaks, waterfalls and the mere open up, pulling back to the whole island in the sea. Card: CHATDOM. | “And every people deserves a kingdom.” | GPU take `island-golden` from frame 30 (`/studio/set.html?scene=grand&channel=tobi4s_&path=island-golden`) | `film-S04` verified, 420 frames at 3840×2160 from 0.5 s | GrandEngine (read-only import); grandChannel(tobi4s_) | staged Doubt: The grand land carries no town yet on main (GK11 not merged): the shore shows land and ships, not the town. |
| S05 | 0:17–0:21 | **The Way Home I: the road.** Low tracking shot: the lurker walks up the road to the gate at golden hour; banners stir. | “Show up…” | GPU take `stream-show` from frame 630 (`/stream?source=simulated&layout=stage&mood=show&camera=window&hour=19.6`) | `film-S05` not shot yet (`/studio/set.html?scene=kingdom&shot=S05`) from 0 s | /stream source=simulated mood=show (citizen) | stand-in — Stand-in: the stream director’s citizen shot until a walker can be driven along the road. |
| S06 | 0:21–0:25 | **The Way Home II: the street.** The camera lifts over the gate and flies down the street to the old quarter, where four years of following put their home. | “…and the road leads home.” | still `work/evidence/live-twitch/homes@1920x1080.png`, moved | `film-S06` not shot yet (`/studio/set.html?scene=kingdom&shot=S06`) from 0 s | __chatdomKingdom.pose | stand-in — Stand-in: the real dusk street still, moved, until a pose path flies the street. |
| S07 | 0:25–0:29 | **The Way Home III: the door.** Their window lights, the door opens, and they step out in the look they picked. |  | still `work/evidence/live-twitch/homecoming-native-reviewed@1920x1080.png`, moved | `film-S07` not shot yet (`/studio/set.html?scene=kingdom&shot=S07`) from 0 s | homecoming (stream view) | stand-in — Stand-in: the real homecoming still, moved. |
| S08 | 0:29–0:34 | **Chat becomes lights.** Theatre mode: chat bursts as the night warms up, and in the player the town’s windows light with each message, then in a wave. | “Every minute in chat… a light in the window.” | studio page (theatre layout) |  | /stream source=simulated seam=starting | staged |
| S09 | 0:34–0:37 | **The quiet one.** The cursor taps “Light your window” in the Chatdom panel; a dark window on a quiet lane lights. | “Even the quiet ones.” | studio page (normal layout) → GPU take `stream-show` from frame 90 (`/stream?source=simulated&layout=stage&mood=show&camera=window&hour=19.6`) | `film-S09` not shot yet (`/studio/set.html?scene=kingdom&shot=S09`) from 0.4 s | /panel source=simulated state=unshared → named; /stream source=simulated mood=show (window) | staged — The director’s window shot follows the tap. |
| S10 | 0:37–0:39 | **The wish.** A close-up on chat: !forge a chimney shaped like a sleeping dragon. | “Speak it…” | studio page (normal layout) |  | studio virtual camera | staged |
| S11 | 0:39–0:43 | **The Forge.** Runes off the anvil, the blueprint, the pour, the hammer strike. | “…and the Forge makes it real.” | still `work/evidence/forge/dragon@1440x900.png`, moved | `film-S11` verified, 780 frames at 1920×1080 from 1.5 s; `film-S11` verified, 780 frames at 1920×1080 from 4 s; `film-S11` verified, 780 frames at 1920×1080 from 8 s; `film-S11` verified, 780 frames at 1920×1080 from 12.15 s | /stream forgeFixture=1 → __chatdomKingdom.forge | stand-in — Stand-in: the real forged dragon chimney, moved, until the ritual is shot frame by frame. |
| S12 | 0:43–0:47 | **It lands.** The piece arcs across town and settles on the house; smoke curls from the dragon’s nostrils; the neighbours react. |  | still `work/evidence/forge/dragon@1440x900.png`, moved | `film-S12` not shot yet (`/studio/set.html?scene=kingdom&shot=S12&forgeFixture=1`) from 0 s | /stream forgeFixture=1 (landing) | stand-in — Stand-in: the same still pulling back. |
| S13 | 0:47–0:52 | **Growth.** One locked camera: the hamlet becomes a town in seconds, homes rising, streets filling. | “Come back… and it grows with you.” | clip `work/evidence/growth/growth-sequence-1280.mp4` | `film-S13` not shot yet (`/studio/set.html?scene=growth&shot=S13`) from 0 s | growth ceremony / Chronicle replay | stand-in — Stand-in: the growth lane’s real sequence render, cropped clear of its chip and captions. |
| S14 | 0:52–0:54 | **The raid notice.** Twitch’s own raid notice in chat, “PinkKittyRose is raiding with 48 viewers”, and chat erupts. |  | studio page (normal layout) |  | studio chat | staged |
| S15 | 0:54–0:58 | **The caravan.** The caravan rolls in under PinkKittyRose’s banner and colours, lanterns along the road, guests walking in. | “Friends arrive under their own banners.” | still `work/evidence/live-twitch/raid@1920x1080.png`, moved | `film-S15` not shot yet (`/studio/set.html?scene=raid&shot=S15`) from 0 s | raid moments (twitch-moments) | stand-in — Stand-in: the live bench’s real caravan still, moved. |
| S16 | 0:58–1:01 | **The column.** A huge raid: a long line of wagons under one house’s colours, lanterns swinging, pours along the road and in through the gate as the camera cranes up. No name, no number. |  | still `work/evidence/raid-road/before-departure-1920.png`, moved | `film-S16` not shot yet (`/studio/set.html?scene=raid&shot=S16`) from 0 s | raid column (raid-show) | stand-in — Stand-in: the castle beacon over the town (cropped clear of the card) until a column can be staged. |
| S17 | 1:01–1:05 | **The gate wakes.** The end of the night: at the castle gate the braziers catch and the gate swings open; townsfolk with lanterns gather in its light. | “And when the night ends…” | still `work/evidence/raid-road/after-gate-1920.png`, moved | `film-S17` not shot yet (`/studio/set.html?scene=kingdom&shot=S17`) from 0 s | /-/raid-gate | stand-in — Stand-in: the gathering at the gate (cropped clear of text) until the departure is staged without cards. |
| S18 | 1:05–1:08 | **Ride out.** Ride out: from just inside the open gate the camera rises over it and out along the road beyond the town, climbing into the night. | “…ride out.” | still `work/evidence/live-twitch/raid@1920x1080.png`, moved | `film-S18` not shot yet (`/studio/set.html?scene=kingdom&shot=S18`) from 0 s | /-/raid-gate departure | stand-in — Stand-in: the caravan still reversed into a rising pull-back. |
| S19 | 1:08–1:13 | **Rise to the map.** The kingdom falls away into haze and ink, the Atlas of Twitch opens beneath, and the road inks across. | “Every raid leaves a road.” | GPU take `island-rise` from frame 0 (`/studio/set.html?scene=grand&channel=tobi4s_&path=island-rise`) | `film-S19rise` verified, 300 frames at 3840×2160 from 0 s; `film-S19map` verified, 360 frames at 3840×2160 from 0 s | GrandEngine (read-only import); Atlas | staged — The rise is a real GPU take; the ink into the Atlas is a dissolve in the edit until the Atlas can be driven. Doubt: The cloud deck is hidden for the climb; a dithered moon glint shows a faint grid on the sea from 2.5 s. |
| S20 | 1:13–1:16 | **Arrival.** At MashaD4’s gate the party arrives under tobi4s_’s banner, and her town’s lights come on. |  | still `work/evidence/raid-road/before-welcome-1920.png`, moved | `film-S20` not shot yet (`/studio/set.html?scene=raid&shot=S20`) from 0 s | raid arrival (raid-show); grandChannel(mashad4) | stand-in — Stand-in: guests arriving at a Genesis kingdom’s gate (cropped clear of the card and caption); not yet MashaD4’s own town. Doubt: A small “You” marker over the viewer’s walker stays in frame; Decision 9 wants no labels in the raid shots. |
| S21 | 1:16–1:20 | **The Atlas of Twitch.** Pull back to the whole map: thousands of kingdoms, roads between them. | “Thousands of chats. Thousands of kingdoms.” | still `work/evidence/atlas/atlas@1440x900.png`, moved | `film-S21` verified, 300 frames at 3840×2160 from 0 s | Atlas (labels for consenting channels only) | stand-in — Stand-in: the Atlas still, softened so no channel name is legible (only consenting channels may be). |
| S22 | 1:20–1:27 | **Close.** The night town, the lurker’s window still lit. Card: “Every chat deserves a kingdom.” chatdom.gg | “Your chat is waiting.” | GPU take `stream-dusk` from frame 150 (`/stream?source=simulated&layout=stage&seam=starting&hour=19.3`) | `film-S22` not shot yet (`/studio/set.html?scene=kingdom&shot=S22`) from 0 s | /stream source=simulated seam=starting | staged Doubt: Today the close is the dusk overview of the town (a bookend to S01), not yet the night street with the lurker’s window. |
