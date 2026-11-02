# 2 First night: The first night: from one message to a home

**End state:** Someone types their first message or taps the panel, and within a minute they have a lit window with their name and a tent or home on a street that matches their history. If they walk in, a 60 to 90 second "Way Home" ends with them stepping out of their own door, wearing a look they picked.

**Today:** Today a walker goes door, Twitch sign-in, a static arch with "Finding your way home", then is dropped into the world as one of six starter looks. Nothing explains the light, the coal, the home or the Forge.

## B01 Join from the panel: "Take your place"
- **Tobias note:** Panel: "Think through how to ..." (completed: how to join from the panel). Window always lit with your name, no option; consider the state where the person has not joined yet.
- **Today (honest):** In production the panel cannot light anything: requestLight is a no-op and no panel light service exists. The fixture offers "with my name" or "mine, but unnamed".
- **Decided:** Sharing once is the consent; after that the window is named and lit while present (Q5). Twitch requires the identity share.
- **Ambitious end state:** One button, "Take your place", shares your Twitch identity, pitches your tent or assigns your plot by the tenure rules, and lights your window, all in one gesture. The plate then always reads "Your window is lit", your name, your street, your portrait. Every state is designed: not logged in to Twitch; not shared yet; already 3 homes (a guest light); channel not founded (pledge a tent on the waiting land); moderated (quietly dark).
- **Done when:** Stills of all five states at 318x496 and on mobile; integration test against the real light service.
- **Depends on:** C01 panel kit
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/panel/src (LightChoiceSheet, adapters/production.ts:113-130). Needs /api/panel/v1/light (HANDOVER §8.5).

## B02 Your light burns while you are there
- **Tobias note:** Window always lit with your name, no option.
- **Today (honest):** Chat presence lights windows (Herald). Panel presence cannot. Walking does not count.
- **Decided:** Lit while watching or chatting; walking while live counts too (Q11). The opt-out lives in card settings and "!chatdom quiet".
- **Ambitious end state:** Your window lights within 5 seconds of you being present (chat, panel open on the live channel with idle checks, or walking while live) and dims after a quiet absence. It is always named once you have shared. "!chatdom quiet" keeps your name off the stream; "!chatdom forget" erases you.
- **Done when:** Tests for each presence source and the commands; a still of a street lighting up.
- **Depends on:** B01
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Added
- **Notes:** Twitch.md §2.5, §16; Tech §7.1. Neither command exists yet.

## B03 The Way Home intro
- **Tobias note:** Onboarding of a chat player: creative intro section in the game, cinematic wow scenes, playful.
- **Today (honest):** None. No spec covers a first walk.
- **Decided:** 60 to 90 seconds, once per kingdom, doubles as the loader (Q28).
- **Ambitious end state:** You arrive by the road at the gate; the crier calls your real tenure ("following since 2022, the oldest quarter"); the camera flies down your street; your window lights; you pick your look at the mirror (B04); you step out of your own door. Then three hands-on nudges: walk, wave, your coal at the Forge. Variants: newcomer (a tent), veteran (a worn doorstep), guest, raider (arrives with the raid column), monarch (the castle). Skippable, replayable from the Esc menu.
- **Done when:** Frame sequences for each variant reviewed; tests that it plays once per kingdom.
- **Depends on:** B05, B04, E01
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Tobias
- **Notes:** Monarch §5.4 "teaches by doing".

## B04 Pick your look in the intro
- **Tobias note:** Integrate the builder into the game.
- **Today (honest):** Walkers get one of 6 starter looks by hash.
- **Decided:** A mirror in the intro (Q22).
- **Ambitious end state:** Three quick picks (hair, top, colour) from the accepted style at a mirror in the intro, saved to your real look, so nobody walks as a default.
- **Done when:** Stills; the look persists across devices.
- **Depends on:** H01
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Tobias

## B05 A beautiful loader that tells the truth
- **Tobias note:** Much more beautiful loading bar and screen, nicer typography.
- **Today (honest):** Static arch SVG and two lines of text. The six real steps appear only in error messages. Grand land takes about 56 s to be ready.
- **Decided:** Quality §15: the gate opening, the map unrolling, no bare spinners; designed scene within 1 s, explorable in 5 s.
- **Ambitious end state:** One loader for kingdom, grand land, Chronicle and panel: the parchment map unrolls, your street is inked, the ink rises into voxels, your window lights. Each beat is bound to a real step; progress is real, never a fake percentage. Beautiful type. You can walk your own street while the far land streams in.
- **Done when:** Frame sequence of a cold load; timing to first scene and to walkable.
- **Depends on:** E01 load time
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/web/src/kingdom-entry/index.tsx:68-74; live.ts.

## B06 A lantern path home
- **Tobias note:** A minimap or large map; where is my house; an easy way to find your house.
- **Today (honest):** Window names say "home again" for up to 3 homes; nothing else.
- **Decided:** Lantern path plus live minimap (Q36).
- **Ambitious end state:** On arrival, and from the Esc menu, a trail of lanterns and signposts leads you to your home; your door plaque glows as you approach.
- **Done when:** Stills.
- **Depends on:** F04
- **Phase:** 2 Launch
- **Size:** S
- **Source:** Tobias

## B07 Welcome back
- **Today (honest):** The homecoming greeting is merged; the 14-day relight is not proven on a real return.
- **Decided:** ChatDom promise 9: "my home was still there and everyone said welcome back".
- **Ambitious end state:** Coming back after 14 days or more relights your window with a small ceremony and a crier line on stream; nothing was lost while you were away.
- **Done when:** Test and still.
- **Phase:** 2 Launch
- **Size:** S
- **Source:** Added
