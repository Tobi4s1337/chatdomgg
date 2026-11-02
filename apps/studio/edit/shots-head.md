# The teaser: shot list

For Tobias's approval (K02). This file is written by `node apps/studio/edit/shots-md.mjs` from the shot scripts in
`apps/studio/src/shots/`; edit the scripts (or `apps/studio/edit/shots-head.md` for this preamble), never this file.

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
6. **Raids (0:52–1:16).** Twitch's own raid notice; the caravan under PinkKittyRose's colours; a huge column; the
   gate at the end of the night; riding out; rising to the map; arriving at MashaD4's gate. No signs, cards or
   captions in the world: the picture says "they came to us" and "we rode out to them".
7. **The map and the close (1:16–1:27).** Thousands of kingdoms; the night town with the lurker's window still lit.
   "Every chat deserves a kingdom." chatdom.gg

## Rules the shots keep

- **Staged, never labelled.** The page is our replica of twitch.tv/tobi4s_ and the chat is a seeded crowd of invented
  names, each checked absent on Twitch (`apps/studio/src/chat/names-checked.json`). Nothing on screen says SIMULATED;
  the studio hides leftover chips in its own frames. The YouTube description says plainly that the page and chat are
  staged.
- **Honest scale.** tobi4s_ shows tens of viewers; PinkKittyRose raids with 48 (Decision 4). The huge column (S16)
  has no name and no number.
- **Real names only with consent.** tobi4s_, The_AGGman, PinkKittyRose and MashaD4. On the Atlas no other channel
  may be legible.
- **Every frame is a function of (shot, t).** Page shots render in the studio, kingdom shots on Tobias's GPU through
  the frame-stepped recorder; the same script renders the same frame every time.
- **Narration** is the Voice of the Realm (scratch in the leading candidate, Rowan; see `VOICES.md`): at most eight
  words a line, present tense, never explaining a mechanic. Captions are burned in from the voice's own timings.

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
  moment. Each stand-in says what it waits for; TS11 replaces them with film takes.
