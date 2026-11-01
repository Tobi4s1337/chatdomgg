# 6 Life in the kingdom: Walking in feels like a real game

**End state:** Walking in feels like a real game: the mouse stays captured and never escapes to another screen, an Esc menu holds everything, first or third person, a minimap with your friends, natural chat bubbles, feet on the ground, solid buildings, and every home tells you who lives there.

**Today:** Today a walker can walk, sprint, jump, zoom, wave, sit, enter their own home and stand at the anvil. There is no chat box, map, bag, settings or player list, the cursor is free by default, and bubbles flicker when the camera moves.

## F01 The mouse is always captured
- **Tobias note:** Controls: mouse always captured; no snapping to my second screen when I turn fast; controls never sent to other screens or triggering shortcuts; research this.
- **Today (honest):** Cursor free by default; orbiting is a drag, so fast turns leave the window. Locked mouse moves over 250 px are dropped. Ctrl/Cmd/Alt keys are ignored but still reach the browser. No fullscreen or keyboard lock.
- **Decided:** Always locked (Q2). This reverses the free-cursor founder decision in Tech §8.2 and spec 35 R8.
- **Ambitious end state:** Clicking into the world captures the mouse with raw input where the browser supports it. While walking there is no free cursor; Esc releases it into the menu, and one click returns. Fast flicks are never dropped. A fullscreen mode with keyboard lock stops Ctrl+W, Esc and other shortcuts from reaching the browser. Browser quirks are researched and handled (re-lock cooldown, Safari, multi-screen).
- **Done when:** Tests on input handling; a recorded fast-turn session on a two-screen setup.
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/web/src/walk/input/look.ts:72-81, keyboard.ts:79. Amend Tech §8.2, spec 35 (L13).

## F02 The Esc menu holds everything
- **Tobias note:** Where is the first person view? A settings menu when you press Escape where you can configure everything; nice typography and menu design.
- **Today (honest):** No Esc or settings menu; Esc is passed through.
- **Decided:** An Esc ledger (Q36).
- **Ambitious end state:** Esc opens a carved ledger: settings (camera, first or third person, sensitivity, invert, field of view, audio volumes, quality, label and bubble density, reduced motion, key bindings), your card, things you forged, the way home and help. Same type and kit as the rest.
- **Done when:** Stills of every page; settings persist.
- **Depends on:** F01
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Tobias

## F03 First person at a key press
- **Tobias note:** Where is the first person view? Easy to swap.
- **Today (honest):** First person exists only by scrolling all the way in.
- **Ambitious end state:** V toggles first and third person smoothly; also in the Esc menu.
- **Done when:** Still and test.
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Tobias
- **Notes:** walk/camera/shoulder.ts.

## F04 A live minimap with your friends
- **Tobias note:** A minimap and maybe a large map: main places, where my house is.
- **Today (honest):** None.
- **Decided:** A live minimap with friends, plus the lantern path; never strangers' positions (Q36). The Atlas never shows positions.
- **Ambitious end state:** A painted minimap in the corner: places, your homes, and the positions of your friends only. Never strangers. A big map in the Esc menu is optional.
- **Done when:** Stills; a privacy test that strangers never appear.
- **Depends on:** Friends definition (open question)
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Tobias
- **Notes:** Atlas.md §2.1 (unchanged).

## F05 Chat bubbles that feel natural
- **Tobias note:** Chat bubbles glitch and flicker when the camera animates; rethink for beauty and naturalness.
- **Today (honest):** Bubbles are page elements, positioned every 80 ms (names every frame), so they step and lag. Their size is lost when a name label toggles. Overlaps hide them instantly with no fade.
- **Decided:** Chat-only people speak from their homes (Q13).
- **Ambitious end state:** Bubbles live in the world: updated every frame, eased in and out, faded when hidden behind things, kept on screen long enough to read, stable per speaker, nearest first. Chat-only people's bubbles rise from their lit home. No flicker during any camera move.
- **Done when:** A recorded camera fly-through with active chat, reviewed frame by frame.
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/web/src/walk/labels/index.tsx; scene.ts:650/654; citizen-scene.ts:352-366.

## F06 Footsteps that match the ground
- **Tobias note:** Sound of walking on grass doesn't make sense.
- **Today (honest):** Off the roads everything counts as "earth", which plays dirt-path steps. There are no grass, gravel, sand, snow or shallow-water sounds. Other walkers make no sound.
- **Decided:** No silent actions (ChatDom changelog).
- **Ambitious end state:** Footsteps follow the drawn surface: grass, meadow, gravel, cobble, plank, sand, snow, shallows, indoors. Nearby walkers have quiet steps too.
- **Done when:** A recording walking across each surface.
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Tobias
- **Notes:** packages/audio/src/cues/materials/earth.ts; kingdom/walk-scene.ts.

## F07 Feet on the ground
- **Tobias note:** My shoes are slightly inside the ground.
- **Today (honest):** Physics samples the ground on a half-metre grid; the drawn terrain is smoothed, so feet sink or float on slopes. The gait pitches the feet below the sole.
- **Ambitious end state:** Feet meet the drawn surface on flat ground, slopes, stairs and floors.
- **Done when:** Close-up stills on slopes and stairs.
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Tobias
- **Notes:** packages/world/src/founded-world/collision.ts:14-15; citizens/footsteps.ts.

## F08 Buildings are solid
- **Tobias note:** Forge is not blocking me; I can walk through it.
- **Today (honest):** The anvil is drawn by the browser but is not a solid in the world. Civic fixtures that fail to fit are silently dropped.
- **Ambitious end state:** The anvil, the forge and every civic fixture are solid. A fixture that fails to place is a build error, never a silent omission.
- **Done when:** A collision test walking into each fixture.
- **Phase:** 1 Hackathon
- **Size:** S
- **Source:** Tobias
- **Notes:** apps/realm/src/founded/artifact.ts:12; forge-hearth-furnishings.ts:47-78.

## F09 Every home tells you who lives there
- **Tobias note:** Show info on houses: who owns it, their passport and achievements, their Twitch avatar and a link to Twitch.
- **Today (honest):** You cannot inspect another home. Only your own door works.
- **Decided:** spec 19: the same citizen card opens from a person or their home.
- **Ambitious end state:** Looking at a home shows a plaque (name, Twitch picture, citizen since). Clicking opens their card: following since, nights, homes, things they made, passport (unless hidden), guestbook, "Visit on Twitch".
- **Done when:** Stills; disclosure tests.
- **Depends on:** C03
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Tobias

## F10 Typing in the world posts to Twitch chat
- **Today (honest):** No chat box. The docs say what a walker types is sent as their real chat message.
- **Decided:** Posts to Twitch (Q14).
- **Ambitious end state:** Press Enter to type; it is sent as your real Twitch chat message (permission asked the first time), so AutoMod and the channel's moderators stay in charge. New players also get a phrase wheel.
- **Done when:** Test against Twitch; stills.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** Needs the user:write:chat scope.

## F11 Only walkers have bodies; chat is light
- **Tobias note:** Differentiate actual active players and people just active in Twitch chat walking as NPCs; lighthouse or something; careful with numbers for big streamers.
- **Today (honest):** One body per home slot wanders the streets; chat-only people and walkers look the same.
- **Decided:** Lights only (Q13): chat-only people are their lit window and a bubble over their home; only walkers have bodies. This reverses spec 16 for chat-only people.
- **Ambitious end state:** Bodies in the streets are always real people walking right now. Chat-only people are their lit windows and bubbles over their homes. Keepers stay few and clearly not people. At big scale the nearest 64 walkers are shown in full, the rest as simpler figures.
- **Done when:** Stills of a 9-person hamlet and a 5,000-chatter town.
- **Phase:** 1 Hackathon
- **Size:** M
- **Source:** Tobias
- **Notes:** citizen-scene.ts:109; spec 16. See open question on how the stream view looks.

## F12 Walking together
- **Today (honest):** Gestures are not seen by other players; no neighbour push or friendship.
- **Decided:** Strangers start with gestures.
- **Ambitious end state:** Gestures, emotes and sitting together are seen by everyone; walkers never pass through each other; friends can walk to each other.
- **Done when:** A two-player recording.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** walking-together lane next step.

## F13 Playable offline, live beats wait
- **Today (honest):** Walking works only with sign-in on a founded kingdom.
- **Decided:** Everything but live beats offline (Q12).
- **Ambitious end state:** Between streams you can walk, place, fish and play at tables; the Forge, moments and coal wait for the stream to go live.
- **Done when:** Tests.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added

## F14 Smooth on real hardware
- **Today (honest):** No laptop or phone frame budgets are verified.
- **Ambitious end state:** Set and meet frame budgets for a mid laptop and a recent phone; quality scales down gracefully.
- **Done when:** Timing on real devices.
- **Depends on:** E01
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added

## F15 An accessibility baseline
- **Today (honest):** "Left out, for now" (Quality §6).
- **Ambitious end state:** Reduced motion, text scaling, colour-blind-safe signals, captions for spoken lines, full keyboard use.
- **Done when:** Checklist and stills.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
