# Quality

The quality bar for everything in Chatdom. Internal. Started 2026-10-29 from the founder's notes and answers.

This file sets out:
- what "polished" means here
- the rules that make it so
- the patterns that are banned
- what each device must get
- how we check, without slowing down

It is derived from two principles in `ChatDom.md`: 17 (real, never a tech demo) and 18 (made with love). Every spec
and every piece of work is held to it. When a rule here turns out to be wrong, change it on purpose and add a line to
the change log at the bottom.

## 1. The bar

**Chatdom must feel crafted, never generated.**

Every surface should look as if someone who loves the kingdom made it by hand and checked how it feels:
- the world
- the avatars
- the menus
- the sounds
- the words
- what the Forge makes

**Slop** is anything that looks:
- **default:** browser controls, a generic app look
- **unfinished:** placeholder shapes, raw errors, bare spinners
- **broken:** walking through walls, floating props, popping detail, snapping animations
- **inconsistent:** mixed scales, off-palette colours, three icon styles
- **unchecked:** AI output nobody looked at

One piece of slop makes everything around it look cheaper. So the bar applies to the smallest thing on screen as much
as to the biggest moment.

The founder's notes, which this file turns into rules:
- It must feel polished, not like slop.
- Interaction should feel smooth.
- World items should work: objects block, and nothing glitches through anything.
- Animations look proper, unique and suitable.
- Consistency throughout.
- Menus are well designed and polished, with no basic HTML slop: the UI must really match the kingdom.

## 2. Rules

Each rule has a **why**, a **so** (what follows from it) and a **check** (how we know).

### Feel

**1. Smooth everywhere.**
- **Why:** the founder's answer was "all these should work, but look polished and awesome everywhere". Chatdom runs on
  four kinds of screen (§4), and a viewer judges it by the one they have.
- **So:**
  - Every device class gets a designed experience, not a broken version of the best one. A lower tier gives up cost,
    never charm.
  - Frame pacing is even: no stutters in normal play.
  - Nothing compiles, loads or streams in a way that freezes a frame. Expensive work happens behind a designed moment
    (a gate opening, a map unrolling) or off the main thread.
  - The stream view must never cost the streamer noticeable frames in the game they are playing.
- **Check:**
  - The frame-time budgets in §4, measured on real devices at milestones (§5).
  - Scene-cost budgets (draw calls, triangles, voxels, memory) checked automatically on every change.

**2. Every input answers within 100 ms.**
- **Why:** a click that does nothing for a moment feels broken, even when it works.
- **So:**
  - Every input gets a visible and audible response within 100 ms, even when the real result takes longer.
  - Slow work is covered by a moment that belongs to the world. The Forge ritual covers the model's seconds. A
    building's scaffold covers the time a build takes to save.
  - The response tells you that it worked, or why it did not.
- **Check:** input-to-response timing is measured in the automated guards for every interactive element.

**3. Control feels right.**
- **Why:** movement and camera are touched every second. If they feel off, nothing else matters.
- **So:**
  - Movement has weight: gentle acceleration, quick stops, smooth turns. Steps and slopes are walked smoothly, never
    climbed in jerks.
  - Looking around is steady: the view never runs away, and the cursor never escapes when it shouldn't.
  - Touch controls are designed for thumbs, not a keyboard pretending to be a phone.
  - The same action works the same way everywhere.
- **Check:** the scripted tour in the device review (§5) is played by hand, not only replayed.

### A world that works

**4. The world is solid.**
- **Why:** the founder's note: "objects block, no glitching through items". A world you can walk through is a picture,
  not a place.
- **So:**
  - Walls, props, furniture, trees, fences and placed items all block.
  - Nothing passes through anything solid: avatars, pets, townsfolk, the dragon, thrown things, and the camera (rule 9).
  - **Avatars soft-push.** They never overlap: they gently push apart and slide past each other when pressed, so a
    crowd feels physical and nobody can wall off a door.
  - Pets and townsfolk find their way around things. They never walk through them, and never get stuck in them.
  - Builds can't trap anyone, can't reach into a neighbour's plot, and can't make a place impossible to leave.
  - Capes, hair and held items never cut through bodies or walls.
- **Check:**
  - Automated collision walks into every kind of wall, prop and doorway, and fails the build if anything ends up
    inside a solid.
  - Crowd and pathing tests run at small and large numbers.

**5. Grounded.**
- **Why:** floating is the quickest way to make a world look fake.
- **So:**
  - Feet meet the ground, even on steps and slopes, and walk speed matches the walk animation (no sliding).
  - Items rest on surfaces and cast contact shadows.
  - Placed and forged pieces attach to real surfaces.
  - Builds connect to the ground or to structure. Nothing floats unless it is magic, and then it looks like magic.
- **Check:** automated placement tests, and the device-review tour.

**6. If it looks usable, it is.**
- **Why:** every fake door teaches people that the world is a backdrop.
- **So:**
  - Every door opens, every chair can be sat in, every lamp can be lit, and every sign can be read.
  - Anything that cannot be used must not look usable.
  - Nothing in the kingdom is there only to fill space and pretend.
- **Check:** each interactive-looking asset is listed with its interaction, and the asset catalogue flags any without
  one.

**7. Never lose work. No dead ends.**
- **Why:** losing a build or a forged piece breaks trust in a way no polish repairs.
- **So:**
  - A disconnect, refresh, crash or closed tab never loses a build, a forge, progress or a seat. Work is saved as it
    happens.
  - Coming back puts you where you were.
  - Every screen and every state has a way forward. Nobody is ever stuck, in the world or in a menu.
- **Check:** automated tests kill the connection and the tab mid-build, mid-forge and mid-game, then confirm nothing
  was lost.

### Look

**8. A crafted diorama, never Minecraft.**
- **Why:** the prototype's stepped grass terraces and big blocky head read as Minecraft. That was the main "cheap"
  note. Chatdom is clearly voxel and clearly handmade.
- **So:**
  - The MagicaVoxel "clay" look: small voxels, soft ambient occlusion, gentle bevels, colour gradients within the
    palette, and soft warm light.
  - Terrain edges are softened, so slopes never look like stairs.
  - Materials read as what they are: stone looks like stone, wood like wood, water like water.
  - Avatars are well proportioned and sit small in the frame (rule 9).
  - **Light glows, it never blows out.** No white blobs, and halos are sized to their source.
  - Every view is composed. Dusk and night, the signature hours, are the most beautiful.
- **Check:** visual regression screenshots from fixed cameras at noon, dusk and night, compared at every change.

**9. The camera never cheats.**
- **Why:** the camera is how everyone sees everything. One clip into a wall undoes the whole scene.
- **So:**
  - The camera never goes inside a wall, roof or prop. When something comes between the camera and your avatar, it
    moves or fades the obstruction.
  - Your avatar sits well in the frame, never as a giant head filling the bottom of the screen.
  - The horizon stays level, the camera never lurches, and motion is smooth, so nobody feels sick.
  - On stream, every cut has a reason, and no shot holds on nothing.
- **Check:** automated camera sweeps through tight spaces, and the device-review tour.

**10. One scale, one palette.**
- **Why:** mixed voxel sizes and stray colours are the fastest way to make a voxel world look assembled from parts.
- **So:**
  - Every object belongs to one scale class: terrain (0.5 m), props, builds and forged items (0.125 m), and avatars
    and pets (0.0625 m), as fixed in `docs/09-depth-synthesis.md` §2.16. A mismatched scale is a bug.
  - Every colour comes from the shared palette and the kingdom's style kit. An off-palette colour is a bug.
  - Each time of day has one lighting mood, used everywhere.
- **Check:** the asset pipeline rejects off-scale and off-palette assets, and the Forge's grammar cannot produce them.

**11. No pop, no seams.**
- **Why:** the eye goes straight to anything that changes when it shouldn't.
- **So:**
  - Nothing visibly pops in or out: detail levels, loading, shadows, crowds.
  - Changes in detail fade or dissolve.
  - No seams between pieces of terrain, no flickering surfaces, and no shadows that crawl or shimmer.
  - **The world never ends in a cliff edge.** There is always a horizon: hills, sea, sky, the Wilds.
- **Check:** visual regression screenshots, plus camera fly-throughs recorded at milestones.

**12. Animation is proper, unique and suitable.**
- **Why:** this is the founder's note. Voxel avatars are made of rigid parts, so all the craft is in timing and
  movement.
- **So:**
  - **Proper:**
    - No snapping between states: every change blends.
    - No foot sliding.
    - No reference poses or default poses ever shown.
    - Actions have anticipation and follow-through, and capes and hair move with them.
  - **Unique:**
    - Every action has its own animation, not one generic "interact".
    - Chatdom has its own moves (bowing to the monarch, raising your light, waving a raid in).
    - Idle crowds never move in sync.
  - **Suitable:** movement matches weight and character. The dragon is heavy, fireflies are light, a child's pet is
    bouncy. UI motion matches its material: shutters swing and scrolls unroll.
- **Check:** every animation state is listed and has its clip, which the automated guards confirm. Crowds and
  creatures are watched in the device review.

**13. Consistent everywhere.**
- **Why:** a kingdom is one place. If any surface speaks a different language, the place breaks.
- **So:** one visual language, one voice, one set of names, one icon family, one motion style and one sound palette,
  across:
  - the world, the UI and the stream view
  - chatdom.gg and the share cards

  The words follow the blueprint's vocabulary (`ChatDom.md` §12). They are written in the kingdom's voice and are
  always clear. There is never "Error 500", "Item #123", lorem or a raw id.
- **Check:** the slop linter (§3) runs on every change. The words are reviewed as part of each feature.

### UI

**14. The UI is carved and crafted.**
- **Why:** the founder's note: "menus well designed and polished, no basic html slop, really matching the kingdom vibe".
- **So:**
  - **Materials:** wood and brass frames, parchment inlays, wax seals, and hand-lettered headings.
  - **Motion:** panels swing open like shutters or unroll like scrolls, buttons press in like wood, and seals stamp.
  - **Type:** one type scale and one family of display and text faces chosen for Chatdom. Readable at every size, on
    every device.
  - **Icons:** one icon family, drawn for Chatdom.
  - **No default controls.** No default browser control ever appears: dropdowns, checkboxes, scrollbars, focus rings,
    alerts and confirm boxes are all designed. They stay usable with keyboard, mouse and touch.
  - **In the world first.** Where possible the UI lives in the world: signs, plaques, notice boards, and the citizen
    card as a carved plaque. The overlay stays light.
  - **The stream view uses the same kit.**
  - The current Lanternmere UI (dark translucent cards with a gold accent) is retired.
- **Check:** every UI component is built once in the kit and reused. The slop linter fails on default controls and
  stray styles.

**15. Every state is designed.**
- **Why:** quality shows most when things are slow, empty or wrong.
- **So:** each state has a designed version that belongs to the kingdom:

  | State | What it looks like |
  |---|---|
  | Loading | The gate opening, the map unrolling |
  | Waiting | The Forge ritual, a scaffold rising |
  | Empty | A kingdom with nobody in it yet is still lovely and alive: the keepers of its places, birds, smoke from chimneys, "the first light could be yours". Townsfolk are never mistaken for people: they carry no light |
  | Error | Said in the kingdom's voice, saying clearly what happened and what to do next |
  | Offline | When the stream is off, the kingdom rests. When the connection drops, the road fogs over while it reconnects. |
  | Success | Every success is seen and heard |

  There are no raw errors, no bare spinners and no blank panels.
- **Check:** each screen and panel lists its states, and the automated guards render each one.

### Sound

**16. Sound for everything.**
- **Why:** a silent action feels unfinished, even when it looks perfect.
- **So:**
  - Every action, place and UI element has its own sound:
    - footsteps that know wood from stone from grass
    - doors, the Forge hammer, the crowd, the fire
    - wooden and brass UI sounds that match the carved UI
  - Sounds come from where they happen.
  - The same sound never plays twice in a row: it has variations.
  - One mix holds everything together, and nothing clips.
  - Music grows with the number of people present.
- **Check:** every action in the action list has a sound assigned, and the automated guards fail on silent ones. The
  mix is reviewed in the device review.

### Made by Codex

**17. AI-made things meet the same bar.**
- **Why:** a forged item that looks like slop is a bug, not "AI being AI". Generated content is in front of the most
  people, because chat makes it live.
- **So:**
  - Everything Codex makes passes the same bar as handmade work: forged items, founded kingdoms, the Voice of the
    Realm's words, games, and generated images.
  - **Generated images** (game-board art) are made from the art bible's style references, quantised to
    the palette, beauty-checked, and picked by an art director. An image that could belong to any other game is
    rejected.
  - **Forged items.** Built only by the grammar, on the palette, at the right scale and within budget. On top of
    moderation, every item passes a beauty check: its silhouette reads from three sides, its colours sit together, and
    it has no voxel noise. A failed item retries on its own before anyone sees it. If it still fails, the Forge
    refuses gracefully. An ugly item never ships.
  - **Founded kingdoms** are tested on a set of real channel profiles (tiny, huge, odd), and each must come out
    beautiful.
  - **Words** follow the kingdom's voice. Generated text has its own banned list of tired AI phrasing.
  - **Refusals** name the kind of limit and offer the nearest thing. They never echo the refused words, never say
    which word or question caught them, and never say "violation", "flagged" or "banned". Each kind of limit has at
    least three wordings (`Safety.md` §5.2).
- **Check:** batches of Forge prompts and Genesis profiles run through the beauty check at every change to the grammar
  or the prompts.

## 3. The slop list

These are banned. The linter catches what it can; review catches the rest.

**UI and words:**
- Default browser controls: dropdowns, checkboxes, radio buttons, scrollbars, focus outlines, alert and confirm boxes.
- A generic app look: system fonts as the only typeface, SaaS cards, dashboard gradients, the retired glass-and-gold
  cards.
- Emoji as icons, or mixed icon families.
- Placeholder text: lorem, "TODO", "Item #123", "undefined", "NaN", raw ids, "1 items".
- On stream: a viewer count, or any small number that makes a stream look empty. Progress shows as carved meters and
  scaffolds, never as a count.
- Layout that jumps as things load. Text that overflows or is cut off without a design for it.
- Bare spinners, blank panels, raw error messages, stack traces.

**World:**
- Walking, clipping or seeing through anything solid. A camera inside a wall.
- Floating objects, foot sliding, reference poses, snapping animations, crowds idling in sync.
- Placeholder geometry: grey boxes, spheres standing in for goods.
- Visible detail pops, flickering surfaces, crawling shadows, seams, the world's edge.
- White blow-outs and oversized halos.
- Off-palette colours and mixed voxel scales.
- Stair-stepped slopes. Anything that reads as Minecraft.

**Sound:**
- Silent actions.
- The same sample repeated identically.
- Sounds that don't match the material.
- Clipping.

**Generated:**
- AI output shown without checks.
- Generic AI-art images: unstyled, off-palette, inconsistent with the art bible, or shipped without a pick. Art-directed
  generated images are allowed (`Artstyle-Soul-Feel.md` §16.3).
- Tired AI phrasing in generated words.
- A refusal that echoes the words, lectures, or reads as an error.

## 4. Devices

Every device gets Chatdom polished and awesome. The numbers are targets to confirm at the first real-device
measurement; the prototype has never been measured on a real GPU.

| Device | Example | Target | May scale down | Never scales down |
|---|---|---|---|---|
| Gaming PC (where we develop) | Mid-range gaming GPU | 60 fps or more at full quality; high refresh welcome | — | — |
| Everyday laptop | Integrated graphics, a few years old | Steady 60 fps | Shadow resolution, far detail, bloom quality, distant crowd density | Lights in windows, the clay look, the horizon, UI quality, animation quality, sound |
| Phone | Recent mid-range phone | Steady 30 fps at least, 60 where it holds; touch controls designed for thumbs | As the laptop, plus draw distance and effect counts | As the laptop |
| Stream view (OBS) | The streamer's PC, beside their game, in three shapes: the stage, a corner window and a bottom strip | Locked 60 fps at 1080p, light on the GPU | Everything the camera is not looking at; internal resolution (down to about 75%, upscaled to 1080p) while the PC is busy | The detail, lights and animation of everything the camera is looking at |

**Smoothness on every device:**
- No frame takes more than twice the target frame time in normal play.
- A designed loading scene appears within one second.
- The kingdom is explorable within five seconds on a laptop with a normal connection. This last target is
  provisional.

## 5. How we check, without slowing down

We develop on the gaming PC. The checks are built to protect quality without becoming a process.

- **Automated guards, on every change.** They take seconds:
  - scene-cost budgets (draw calls, triangles, voxels, memory)
  - collision and pathing walks
  - placement and grounding tests
  - camera sweeps
  - input-response timing
  - kill-and-resume tests for lost work
  - animation and sound coverage
  - every UI state rendered
  - visual regression screenshots at noon, dusk and night
  - the slop linter
  - the beauty check on a batch of Forge prompts and founded kingdoms

  A failed guard is fixed before moving on.
- **Real-device video review, at milestones:**
  - The same scripted tour each time (the gate, a street, a home, the plaza, the Forge, the tavern, a crowd, a big
    event).
  - Recorded as video on the gaming PC, an everyday laptop, a phone and in OBS, and watched at normal speed next to
    the previous milestone.
  - About ten minutes per milestone, played by hand.
  - A vision model can pre-screen the recordings for glitches.
- **Notes go on one list.** Each note names the rule it breaks. Anything on screen on a stream is
  fixed first.

## 6. Considered and left out, for now

These were proposed on 2026-10-29 and not adopted:
- **"Stream-first" as its own rule.** That covered looking perfect after Twitch's video compression, text readable
  for a phone viewer at 720p, and no flashing beyond photosensitivity limits. The stream view is still a device in §4.
  Before launch, revisit flashing effects (fireworks, the dragon, the beacon).
- **An accessibility rule.** It covered reduced motion, colour-blind-safe signals, scalable text and captions for
  every voice.
- **Founder sign-off on every feature,** and a hard "not polished means not done" gate. These are replaced by the
  automated guards and milestone reviews in §5.

## Change log

- **2026-10-29: first version.**
  - The founder's rules: polished not slop, smooth interaction, a solid world, proper and unique animation,
    consistency, and crafted UI with no HTML slop.
  - Founder answers:
    - every device polished
    - avatars soft-push
    - carved and crafted UI
    - the crafted-diorama voxel look
    - adopted rules: 100 ms answer; if it looks usable, it is; same bar for AI-made; never lose work; every state
      designed; sound for everything; one scale, one palette; no pop, no seams; grounded; the camera never cheats
    - checks are automated guards plus real-device video review, kept light
- **2026-10-29: the stream view may lower its internal resolution.** When the streamer's PC is busy, the stream view
  renders at down to about 75% and upscales to 1080p; it never cuts detail, lights or animation in shot (founder
  answer, `Tech.md` §8.5).
- **2026-10-29: the planning files' decisions.** Townsfolk are a few keepers of places and carry no light (rules 4 and
  15). Refusal wording rules join rule 17 and the slop list (`Safety.md` §5.2). Viewer counts on stream are slop
  (`Monarch.md` §3). The stream view comes in three shapes: the stage, a corner window and a bottom strip (§4).
