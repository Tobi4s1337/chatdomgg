# Art style, soul and feel

How Chatdom looks, feels and carries a soul. Internal. Started 2026-10-29.

The goal is a game with its own identity, beautiful and polished at the level of the most striking games being made
today. The Lanternmere prototype is the baseline, and this file aims well above it.

This file is derived from `ChatDom.md` (above all: belonging, made with love, every kingdom unique) and sits beside
`Quality.md`. `Quality.md` says what must never go wrong; this file says what must go beautifully right. When the two
meet, Quality is the floor and this is the ceiling.

## 1. The identity in one breath

**A handmade toy kingdom at dusk, lit by its people.**

**Three words: handmade, warm, alive.**
- **Handmade:** every piece looks placed by a hand that cared. Nothing looks generated, even when it was.
- **Warm:** light, colour, humour and people. Never cold, never cynical, never grim.
- **Alive:** the world breathes, notices you and remembers you.

**The Chatdom frame.** These six signatures make a single frame recognisable as Chatdom in one second, even as a
thumbnail. A hero shot carries at least three of them.

1. **Warm lights in windows and streets at dusk or night.** Each one is a person in chat.
2. **The dusk sky,** lilac above and gold at the horizon, with the castle's beacon beam rising into it.
3. **The channel's own emotes,** carved in stone in the plaza and flying on the banners.
4. **Small, charming citizens** with nameplates, their faces showing what they feel.
5. **Chunky, soft, storybook architecture:** steep oversized roofs, crooked chimneys, little gardens.
6. **Carved UI,** with wood, brass, parchment and a wax seal bearing the kingdom's crest.

## 2. The soul

These six ideas are the meaning behind the look. Every art decision should serve at least one of them.

**Light is people.**
- Warm light in Chatdom comes from people: their windows, their lights, the fires they gather at, the beacon of
  their monarch.
- At night the world itself is cool, deep blue and violet. The warmth on screen is the community.
- So a busy night looks golden and a quiet one looks blue, and anyone can read a kingdom's life at a glance.
- A sub may tint the edge of a person's light by tier: warm gold, rose, or a rainbow edge at tier 3. The core stays
  the same warm white as everyone's, and the light never
  grows bigger or brighter, so the night still reads as people first (`Twitch.md` §5).
- This is the single most important art rule. It turns the blueprint's heart (belonging) into something you can see.

**Handmade, not manufactured.**
- Tiny irregularities everywhere: a roof a little crooked, stones of slightly different shades, a fence that leans.
- Variation is authored, not random noise. A good craftsperson's hand varies, but it never makes mistakes that look
  like bugs.

**Small world, big heart.**
- Chatdom is a diorama: intimate, close and readable, the way a model village makes you lean in.
- Even a capital feels like a cluster of neighbourhoods, never a sprawl.

**Age is beauty.**
- Time shows, and it shows as beauty, never decay. Old homes gather ivy, moss and patina. Paths wear where people walk.
  A five-year citizen's doorstep is worn smooth.
- The oldest street looks the oldest, so the blueprint's "your history becomes your place" can be seen in the
  materials.

**Gentle humour.**
- The world can laugh without being cheap: the tomato in the stocks, the fishing rod that does one damage to the
  dragon, a pet that refuses to move, a crooked bell tower that chat built.
- Humour lives in the animation and the small details. It is never in the UI's tone at the user's expense.

**Calm by default, spectacular on cue.**
- The everyday is peaceful: wind, birds, smoke, small lights.
- That calm is what lets the big moments land: the dragon, the fireworks, the raid arriving, the crowning.
- Spectacle is rationed, so it always feels earned. A world with confetti everywhere has no celebrations.

## 3. The baseline: what the prototype proved, and what to raise

**Keep, as the starting point:**
- **The dusk lake postcard:** a pink and lilac sky, the beacon on its hill, coloured gable roofs across the water.
  This is the most "Chatdom" daytime image so far.
- **The night town with about 120 warm lights:** the visual proof that light is people.
- **The castle at sunset,** with its banners and beam.
- **The house family** (three styles, five tiers). It already reads like MagicaVoxel diorama art.
- **The citizens** (cute, clean, Crossy Road–adjacent) and the busy festival plaza.

**Raise:**

| Today | Target |
|---|---|
| Stair-stepped terraces that read as Minecraft | Softened terrain edges; slopes read as slopes (§6.1) |
| A giant brown head filling the bottom of the frame | A small, well-framed avatar; the world is the subject (§13) |
| The world ending in a slab over grey fog | A horizon on every side, with aerial perspective (§6.2) |
| Flat, camouflage-like stone on the gate and walls | Stone that reads as stone: block patterns, mortar, moss, wear (§6.1) |
| White blow-outs and heavy halos | Bloom that glows, sized to its source (§6.2) |
| Faint light on the lake | Pillars of reflected light from every window at night (§6.2) |
| Spheres as market goods; a blocky dragon head | Authored hero assets; the dragon is a centrepiece (§7) |
| Dark glass-and-gold UI cards | Carved and crafted UI (§11) |
| Stills only, never seen in motion on a real GPU | Every target judged in motion on real devices (§16) |

## 4. References: what to take, what to leave

Chatdom is not any of these. It takes one lesson from each.

| Reference | Take | Leave |
|---|---|---|
| **Tiny Glade** | Soft light and building where nothing you make can look ugly, because the system adds the beauty | Its muted palette; Chatdom is warmer and more saturated |
| **Lego Builder's Journey** | A toy material under cinematic light, so the toy-ness reads as premium | Photoreal surfaces; ours are clay and painted |
| **Sky: Children of the Light** | Light as people; crowds of small warm lights; how much emotion a lighting change can carry | Its emptiness; Chatdom is a town, not a pilgrimage |
| **Tunic** | Diorama framing, a small world full of secrets, bold colour | The isolation and difficulty |
| **Townscaper, Dorfromantik** | "Intent in, beauty out"; the satisfaction of a piece clicking into place | The lack of people |
| **Animal Crossing: New Horizons** | Chunky soft shapes, character charm, everyday life, seasons | The plastic sheen and generic UI |
| **Teardown** | Proof that voxels can look stunning when light is taken seriously | Grit and destruction |
| **Trove, Cube World** | Voxel items as treasured loot, clarity at distance | Flat lighting and visual noise |
| **Hades, Spiritfarer** | Painted frames and boards with real character and hand | — |
| **Inscryption** | A table as a stage: the game happens on a surface in a room | Its horror |
| **Astro Bot** | The polish of touch: everything you touch responds with delight | — |
| **A Short Hike** | A small world with a big heart and instant readability | — |

**What Chatdom must never look like:**
- **Minecraft:** raw cubes, flat light, stairs for slopes.
- **Roblox defaults.**
- **Mobile-game gloss:** shiny gradients, generic gold buttons.
- **Generic AI art.**
- **A SaaS dashboard.**

## 5. Four registers, one family

Chatdom has four visual registers. Each fits its purpose, and all four share one family.

| Register | Where | Look |
|---|---|---|
| **The world** | Outside: streets, plaza, wilds, the dragon | Clay voxel diorama, light-driven, alive |
| **The interiors** | Inside the tavern, the throne room, the theatre: real rooms you share with other players | The same voxel world with painterly light: candlelight, ink outlines, brush-textured shading (§10) |
| **The game boards** | When you sit at a table and the game opens | Each game in its own painted style: manuscript, chalk, oil, watercolour (§10.1) |
| **The map and the UI** | The Atlas, menus, cards, plaques | Ink, parchment, carved wood, brass and wax |

**What holds them together:**
- one master palette
- one rule for warm light
- one hand (things look made, never printed)
- the same proportions for characters

**Moving between registers is always a moment, never a cut to a loading screen:**
- **Map to world:** the Atlas's drawing of the kingdom fills with colour and comes alive. The full rise of inked
  parchment into voxel terrain is kept for the founding.
- **World to interior:** you walk through the door, and the light turns to paint.
- **Table to game:** you sit down, the camera pushes into the tabletop, and the board opens in its own style.
- **Menus:** panels swing open like shutters.

## 6. The world

### 6.1 Material: the clay voxel

- **Small voxels, soft edges.** Props, builds and forged items use 0.125 m voxels, and characters and pets 0.0625 m.
  At those sizes a thing reads as crafted rather than blocky.
- **Every voxel edge carries a gentle bevel highlight,** catching light like a sanded wooden block. This comes from
  shading, not extra geometry (§16).
- **Ambient occlusion everywhere,** at two scales:
  - contact shading in every corner and seam
  - large-scale sky occlusion, so alleys, eaves and interiors fall into soft shadow

  The two scales together give voxels depth.
- **Colour inside a colour.** Each voxel varies a touch within its palette ramp, so a wall is a hundred shades of one
  stone, not one flat fill.
- **Materials read as what they are.** This is done with pattern, not textures:

  | Material | How it reads |
  |---|---|
  | Stone | Coursed blocks, darker mortar lines, moss in the shade |
  | Wood | Planks with grain stripes and darker ends |
  | Thatch and roof tiles | Rows and overlaps |
  | Metal | Brighter edges and a cooler sheen |
  | Fabric | Softer, with fold shading |
- **Terrain is softened.** Slopes and banks get transitional voxels, grass overhangs, rocks and flowers that break the
  steps. No visible staircase is ever left on a natural slope.

### 6.2 Light, the biggest lever

Light is most of the difference between "voxel game" and "stunning".

- **Every hour has its own grade:**

  | Hour | Sky | Light | Shadow | When |
  |---|---|---|---|---|
  | Dawn | Rose and pale gold | Soft and low | Long and lilac | Before the stream |
  | Day | Clear blue, white clouds | Warm white | Cool blue | Offline, visits |
  | Golden hour | Amber | Deep warm | Long and violet | The approach to dusk |
  | **Dusk** (signature) | Lilac above, gold at the horizon | Rim light on every roof | Indigo | The stream goes live |
  | **Night** (signature) | Deep blue to violet, stars, the real moon | Pools of warm light from people and fires | Cool blue | The live hours |
- **Warm light is people** (§2). At night every lit window, light and fire is warm, and everything else is cool.
  Contrast in colour temperature is how the eye finds life.
- **Light spills.** Windows throw warm patches onto the street, light pools at the foot of each lamppost, and the
  campfire flickers on faces and nearby walls.
- **Hundreds of lights at once.** A voxel world can carry coloured light through its grid cheaply, so a whole town of
  lit windows and lanterns lights its streets without the cost of individual real-time lights (§16).
- **Fog and aerial perspective.** Distance fades and cools toward the sky's colour. This one effect gives the most
  depth, the most painterly feel, and the horizon, and it hides distant detail changes.
- **Light shafts** from the sun at golden hour and from the beacon at night. Used sparingly, on hero shots.
- **Water carries light.** At night every lit window draws a shimmering pillar across the lake. By day the water is
  clear at the shore, deepens in colour and foams where it meets land.
- **Bloom glows; it never blows out.** Bloom is sized to its source, tinted by it, and kept under tight control.

### 6.3 Colour

**A master palette of ramps.**
- Every colour is a ramp from shadow to highlight that shifts in hue as well as brightness: shadows toward blue and
  violet, highlights toward warm yellow. This is the classic painter's and pixel artist's technique, and it is what
  makes colour feel alive rather than shaded.
- All art and all generated content draw only from these ramps (`Quality.md` rule 10).

**A hierarchy of saturation.**
- The environment sits in calmer, mid-saturation tones.
- Characters, interactive things and the kingdom's banners are richer.
- Spectacle uses the most saturated colours.
- So the eye always lands where it should.

**Value first.** Every frame needs three clear groups of brightness, with the focal point at the strongest contrast.
Colour comes after value. A frame that fails in greyscale fails in colour.

**The kingdom's colours** come from its channel at Genesis and appear in banners, accents, the crest and forged
pieces. They tint the kingdom; they do not repaint it. Every kingdom still lives in Chatdom's light and palette.

### 6.4 Shape language

- **Storybook proportions:**
  - Roofs steeper and larger than real.
  - Doors and windows a little oversized, for warmth.
  - Chimneys crooked.
  - Towers slightly too tall.
- **Big, medium, small.** Every view needs a clear big shape (the castle, a hill, the lake), a band of medium shapes
  (houses, trees) and a sprinkle of small ones (flowers, barrels, signs). Roughly 70 / 20 / 10.
- **No long straight lines in nature or old architecture.** Walls bend gently, rooflines sag a voxel, and paths
  meander. Straight lines are reserved for the monarch's castle and new builds, so age reads as softness.
- **Silhouettes first.** Every landmark, creature and character reads from its silhouette alone, at thumbnail size.
- **Round and soft for the everyday, sharp for the special.** Homes, trees and citizens are soft. Magic, crystals,
  the dragon and crowns may be sharp.

### 6.5 Life and motion

**The world is never still:**
- Trees, grass and flowers sway in the wind, each at its own phase.
- Banners and capes ripple, and chimney smoke drifts with the wind.
- Water moves; ducks and fish break the surface.
- Birds cross the sky and land on roofs.
- Fireflies at dusk, moths around lights at night.
- Townsfolk go about their day.

**The world notices you:**
- Grass bends as you walk through it, and birds scatter when you run.
- Doors creak, and the townsfolk, the few keepers of places, greet you by name.
- Your pet looks up when you come home.
- Footsteps leave a moment of dust on dirt paths.

**Weather has character:**
- Rain darkens and wets the voxels and fills puddles that reflect the lights.
- Snow settles on roofs voxel by voxel.
- Fog rolls in through the valleys.

### 6.6 Age and memory

- **Patina by tenure.** A home's materials age with its owner's time in the kingdom, toward beauty: ivy climbs, moss
  settles in stone, wood darkens and warms.
- **Worn paths.** The ground wears where people actually walk, so the kingdom's real routes draw themselves.
- **Plaques and names.** Things that matter carry names in the world: a carved stone, a brass plate, a ribbon on a
  banner. Memory is something you can see.

## 7. Characters

**Proportions.**
- Chibi: a large head (about a third of the height) on a small, sturdy body. Readable, warm and expressive at stream
  distance.
- They sit small in the world, so the kingdom is always the larger thing.
- Citizens are always people, with fey touches such as ears, skin tones and face styles. Animal charm lives in
  companions (`World-Tree.md` §3).

**Faces are where the soul lives.**
- Simple voxel eyes that blink, a mouth, cheeks that can blush.
- A small set of expressions (happy, surprised, sleepy, proud, suspicious, laughing) swapped with a quick, soft
  transition.
- When someone posts an emote, their face briefly shows a matching feeling, so chat literally shows on the citizens'
  faces.

**Variety and clarity.**
- Each avatar is readable at a distance from its silhouette (hats, hair, capes), its colours and its nameplate.
- Sub pieces, tenure pieces and earned light make a person's story visible.
- The tier 3 sub cape is a rainbow, and it moves: an elegant colour shimmer, like the star in Super Mario (founder
  decision). It shimmers in colour, never in glow, so it never outshines a light.

**Crowds.** Every citizen has slight differences in timing, posture and idle habits, so a crowd looks like people,
never like copies.

**Creatures.**
- Pets are plush and bouncy.
- The great beast is majestic and soft.
- **The dragon is the game's centrepiece.** It is authored by hand, with a real silhouette, a wingspan that fills the
  sky, glowing eyes, and a roar you feel. It must look like the boss of a premium game, never a grammar output.

## 8. Animation and game feel

**Animation style: a toy with a soul.**
- Snappy anticipation, a little overshoot, soft settling. Rigid voxel parts move with clear poses and good timing.
- Secondary motion (hair, capes, hats, ears) brings them to life.
- Heads turn to look at whoever is speaking, and at the monarch when the monarch arrives.

**Feel: toy satisfaction.** Everything you touch answers like a well-made wooden toy:
- A placed piece drops a hair, lands with a soft thunk, wobbles once and settles, with a puff of dust and the right
  sound.
- A door swings with weight. A built wall rises with a satisfying stagger, voxel row by row.

**Celebration scales with the moment:**
- A small action gets a small delight.
- A personal milestone gets a moment just for you.
- A community moment gets the sky.

**Restraint** (§2): no constant confetti, no shaking camera for small things, no feedback louder than the action it
answers.

## 9. Effects

**Effects are voxel-native.** Particles are tiny cubes, sparks and motes that share the world's palette and light.
There are no generic soft-sprite clouds pulled from an engine's defaults.

**Cause and effect.** Every effect starts at its cause and travels to its result: the cheer rises from the cheerer's
house, the spark flies from the forge to the roof, the raid's dust trails behind the riders. The eye always knows why
something is happening.

**One language for magic:**
- Magic is light plus voxels in motion.
- The Forge, Genesis and spells share one set of runes: a small Chatdom alphabet drawn for the game.
- **Fireworks** burst into the channel's emotes, in voxels.
- **The Forge ritual:** runes, a glowing blueprint, molten voxels, a wax seal, a hammer strike, the cooling glow. The
  most polished effect in the game.

**Budget.** Effects are planned per moment, so a spectacle stays beautiful rather than noisy, on every device.

## 10. Interiors: step inside, the light turns to paint

**Interiors are real places.** The tavern, the throne room and the theatre are voxel rooms. You walk in through the
door with no loading and no cut, and you share the room with everyone else inside. You can sit at a table, lean on the
bar, stand by the hearth, or walk up to a game and watch. (Founder, 2026-10-29: "a place you can enter and be with
other players".)

**The light turns to paint.** Inside, the same voxel world is rendered with a painterly interior pass:
- warm candle and hearth light flickering on faces and walls
- soft ink outlines on characters and furniture
- brush-textured shading, with colour bleeding gently at the edges of the light
- painted dust drifting in the light beams

The geometry and the citizens are the same; only the hand changes. Stepping through the door feels like stepping
into a painting, and you keep the free camera and the crowd.

**The tavern** is a warm, busy room built for gathering:
- many tables, each one a game, with more tables as the kingdom grows
- a notice board where games and challenges are pinned
- the bar, the hearth, and a corner for the streamer
- spectators gathering around the tables, and room noise that rises with the number of people inside

The tavern grows with the kingdom, so it always feels full and never crushed.

**Tables are games:**
- Walk up and you see the game being played as a voxel miniature on the table: pieces, cards, dice, a little scene.
- Sit down and the camera pushes into the tabletop, and the game opens in its own art style (§10.1).
- Chat can join the streamer's table from Twitch with one message.

**Request a game by prompting.**
- At an empty table, anyone can ask for a game in words: "liar's dice, but pirates, and the loser walks the plank".
- Codex sets it up at that table at once, after automatic checks: the rules are sound and fair, the game always
  finishes, and nothing hidden leaks.
- The table dresses itself: a cloth unrolls, pieces tumble into place, and a small sign is painted with the game's
  name.
- Others can walk up to watch or join.
- The streamer can crown a good one. It then becomes a kingdom game for everyone, with its author's name on it.

### 10.1 Game boards: every game in its own style

When you sit, the tabletop becomes the game's own canvas. Each game has its own art style, inside the family (the
palette, warm light, the hand):

| Game | Style |
|---|---|
| Herald's Quiz | Illuminated manuscript |
| King's Chalk | Chalk on slate |
| Chess | An oil-painted board |
| Dice | A candlelit close-up |
| Regatta | Watercolour map |

**Prompted games** are dressed from a library of board styles and themed piece sets. Codex chooses from the library;
it never invents a new look at runtime.

**Who makes the boards.** Board art and the board-style library are made with Codex image generation under strict
art direction:
- the art bible's style references
- palette quantisation
- the beauty check (`Quality.md` rule 17)
- an art director's pick

The pipeline is in `docs/research/codex-image-generation.md`. The pieces, cards and dice standing on a table as
miniatures are voxel.

## 11. UI: carved and crafted

**Materials:**
- **Wood** with real grain, in two or three tones.
- **Brass** fittings with worn, brighter edges.
- **Parchment** inlays with deckled edges and faint fibres.
- **Wax seals** pressed with the kingdom's crest.
- **Ink** for writing.

**Type:**
- One hand-lettered display face for headings (storybook, warm, never hard to read).
- One humanist text face for everything else, readable at small sizes on a phone and on stream.
- Numbers get their own care, because they change in front of people.

**Icons:**
- One family, drawn for Chatdom, as engraved brass glyphs or small inked marks.
- In inventories and cards, items are shown as small renders of the actual voxel item, lit like the world.

**Motion:**
- Shutters swing, scrolls unroll, seals stamp, wood buttons press in a millimetre, and pages turn.
- Every UI movement has its matching wood, brass or paper sound.

**Lit by the world.** The UI takes a little of the time of day. Parchment warms at dusk and looks candlelit at night,
so even the menus belong to the hour.

**In the world first** (`Quality.md` rule 14): signs, notice boards, carved plaques and the citizen card as a brass
and wood plaque. The overlay stays small and quiet.

**The throne** reads at a glance in a narrow OBS dock and on a phone held upright (`Monarch.md` §7). The stream
view's window has a carved frame whose shutters swing open when a big moment takes the stage.

**How it is made.** Frames, fittings and seals are modelled (voxel or 3D) and rendered with the world's own light, so
the menus are made of the same material as the kingdom. Wood grain and parchment are tuned textures. The crest on
each wax seal is drawn in code from the kingdom's heraldry. None of it is generated images.

## 12. The Atlas

**The look.** The Atlas is drawn as an old explorer's map, the look the founder loved in the e-atlas prototype:
- ink lines and stamped symbols
- watercolour washes for land and sea
- per-channel heraldry
- a compass rose
- a sea monster in the corner

**Pencil, ink and colour.** Waiting land is drawn in pencil, channels mapped from public data in ink, and founded
kingdoms in colour. A founded kingdom is drawn from life: the real kingdom, seen from its hero angle and drawn in ink
and wash, and redrawn when its skyline changes.

**Roads draw themselves in ink as raids happen.** Raid trains become named lines with carriages, and shared chats
become bridges. Crowned kingdoms carry a small gold crown.

**Live kingdoms bloom in paint and hoist their pennant** (founder decision, 2026-10-29). From afar, a live kingdom sits
in a vermilion watercolour wash; up close, its pennant flies from the standard above its shield. Both come in five
size classes by audience, so a hamlet reads and a capital never blows out. Small live channels are dabs of the same
wash from afar and pencil flags up close. The wash blooms in when a stream starts and dries away when it ends.

**The Atlas has no night.** The parchment never darkens. Ink and watercolour can only darken paper, so a glowing
light has no place in the medium. On the map, "warm light is people" (§2) becomes warm pigment: the vermilion wash.
Time of day, with dusk and night as the signature hours, lives inside the kingdoms. The study and mockups are in
`docs/research/atlas-liveness/`.

**The Atlas stops at a drawing of each kingdom.** Entering, the drawing comes alive: colour floods outward from the
castle and the world takes its place. This is the signature transition between the map and the world. The full rise
of inked parchment into voxels is kept for the founding.

**How it is made.** The Atlas is drawn from the open-licensed ink stamps, map pieces and heraldry already in the asset
library, composed in code, as the e-atlas prototype does. Each founded kingdom's drawing is rendered from the kingdom
itself through an ink pass. The Atlas design itself lives in `Atlas.md`.

## 13. Camera and composition

**Two cameras, two jobs:**
- The **player's camera** is calm, low and close to the street, so the world feels large around a small person.
- The **director's camera** (the stream) is a cinematographer.

**Lenses:**
- Long lenses for wide establishing shots, so the town compresses into a diorama.
- Medium lenses at street level.
- Close lenses for faces at the fire and the forge.
- **Tilt-shift and shallow depth of field only on wide director shots,** to sell the miniature without blurring play.

**Composition:**
- **Rule of thirds.** The horizon is never in the centre.
- **Foreground framing:** leaves, a light, a fence post, a banner in the corner.
- **Leading lines:** roads and rivers toward the focal point.
- **Hero light:** the subject in light, the frame edges falling into shadow.

**Hero angles.** Every kingdom gets its postcard angles at Genesis: computed from the layout, then checked for
composition. That way the director always has a beautiful shot to cut to.

**Small frames.** The stream view's corner window and bottom strip get their own shots: closer, slower, bigger
subjects. In the strip the camera walks one street at a time.

**The founding ceremony** is a cartographer's parchment, live on stream: inked, crumpled and redrawn on a live redraw,
then risen into voxels.

## 14. Sound is part of the look

- **Materials sound like what they are.** Wood knocks, brass rings, parchment rustles, and stone footsteps differ from
  grass.
- **The music grows with presence:** a lute alone, then strings, then woodwinds, then a choir. This is presence made
  audible, the twin of light.
- **Ambience changes with the hour:** birds by day, crickets and the hum of a busy town at night, the crackle of the
  fire.
- **The Voice of the Realm** (`ChatDom.md` §5) is part of the identity. Warm, storytelling, never a parody.

## 15. Variety inside one identity

Every kingdom must look like its own place and still be unmistakably Chatdom.

| Fixed for every kingdom | Varies by kingdom |
|---|---|
| The clay material, the light rules, the master palette, the hours, character proportions, the UI kit, the runes, the camera's eye, the sound palette | The biome (meadow, mountain, coast, forest, snow, autumn, fog and marsh, desert); the shape language (cosy, crystal, gothic, driftwood); the kingdom's colours; its emotes in stone; its landmarks and wonders; its flora and native material; what its citizens built and forged |

## 16. How we get there

### 16.1 The process

1. **Art bible v1.** Turn this file into a visual art bible:
   - reference boards for each section
   - the master palette and its ramps
   - do and don't sheets
   - material swatches
   - the character proportion sheet
   - the rune alphabet
   - the UI kit
2. **Target frames before code.** Paint six to eight target frames: what a finished frame must look like. Each is made
   by painting over an engine blockout, so it is achievable, not fantasy.
   - the night town lighting up
   - the dusk lake
   - a street at golden hour
   - the Forge ritual
   - the dragon over the cathedral
   - the tavern interior
   - the campfire
   - the Atlas
3. **The lookdev street.** One fixed street with every material, every hour and the lake. The render stack (§16.2) is
   tuned there until engine screenshots stand next to the target frames without embarrassment. It is judged on a real
   GPU, in motion.
4. **The golden street.** One street at dusk taken to final quality:
   - characters, animation, effects and sound
   - UI and interactions
   - the soft-push crowd

   Everything after that is scaled from it. Nothing is scaled before it is right.
5. **Kits.** Biomes, shape languages and prop families are authored after the golden street passes, so every kit
   inherits the finished look.
6. **Art reviews** happen at every milestone, alongside the `Quality.md` device review. The tests:
   - **Side by side:** next to the target frames and the references.
   - **Squint:** with eyes half-closed, the focal point and the three value groups read.
   - **Greyscale:** the frame works without colour.
   - **Thumbnail:** at 160 pixels wide it still reads, and still looks like Chatdom (§1).
   - **Stream:** encoded the way Twitch delivers it and watched on a phone, it holds up (no noise turning to mush,
     no detail lost that matters).
   - **Motion:** watched moving at full frame rate, never judged only from stills.

### 16.2 The render stack

The techniques that buy the look, and which device tiers (`Quality.md` §4) get them.

| Technique | What it buys | Tiers |
|---|---|---|
| Greedy-meshed voxels with per-vertex ambient occlusion (exists) | Contact depth at low cost | All |
| Edge bevel highlight in the shader, from each voxel's local position | The sanded-block, handmade read without extra geometry | All |
| Per-voxel colour variation within the ramp | "A hundred shades of one stone" | All |
| Sky occlusion baked from the voxel grid | Soft shade under eaves, in alleys and indoors | All |
| Coloured light carried through the voxel grid | Hundreds of warm windows and lights lighting the streets at night | All (detail varies) |
| Real-time sun shadows, kept tight around the camera | Crisp shadows where the eye is | Laptop and up; phone gets baked |
| Height fog and aerial perspective toward the sky colour | Depth, a painterly feel, the horizon, hidden detail changes | All |
| Stylised sky: gradient, sun and moon discs, painted clouds, stars | The signature dusk and night | All |
| Light shafts | Golden hour and the beacon | Gaming PC and stream view |
| Stylised water: depth colour, shore foam, reflected light pillars | The lake at night | All (reflections vary) |
| Wind in the vertex shader for flora, banners and capes | A world that breathes | All |
| Controlled bloom; filmic tone mapping; a colour grade per hour and per kingdom | Glow without blow-out; the mood of each hour | All |
| Tilt-shift depth of field | The miniature look | Director shots only |
| Clean edge antialiasing, tuned for stable voxel edges (no shimmer) | Straight voxel edges that don't crawl | All, by budget |
| Detail levels by voxel downsampling, with a dithered crossfade | No pop (`Quality.md` rule 11) | All |
| Impostors for distant kingdoms and the far city | Capitals and the horizon at low cost | All |
| Painterly interior pass: ink outlines, brush-textured shading, candle flicker | Rooms that feel like paintings while staying walkable and shared | All |

The prototype already has greedy meshing with ambient occlusion, a high-dynamic-range target with Karis bloom, a
neutral tone map, batched drawing and a quality governor. The rest is built on that.

### 16.3 Who makes what

| Made by | What |
|---|---|
| **Hand, by artists** | The master palette and ramps; the house and prop part libraries the grammar draws from; hero assets (castle, gate, tavern, the dragon, the great beasts); character parts and faces; the UI kit, modelled and rendered like the world; the runes; the art bible and its style references; final picks and touch-ups on everything generated; the music and the Voice of the Realm's direction |
| **Systems, under artists' rules** | Kingdoms at Genesis, terrain, flora placement, auto-detail on builds, patina by tenure, worn paths, the Forge's items (assembled only from authored parts and ramps), the Atlas (composed from the open-licensed stamp library), each founded kingdom's ink drawing (rendered from the kingdom itself), dressing a prompted game's table from the board library |
| **Codex image generation, under art direction** | Game-board art and the library of board styles; target frames painted over engine blockouts. Each piece is generated from the art bible's references, quantised to the palette, put through the beauty check, and picked by an art director. Nothing you walk through, build, wear or forge is a generated image. |
| **AI, as help** | Exploring ideas; writing tools and shaders; checking beauty and style in batches (`Quality.md` rule 17). Generic, unstyled or unchecked AI images never reach the product. |

## 17. Taste calls

**Decided by the founder on 2026-10-29:**
1. **Character proportions:** chibi, with the head about a third of the height.
2. **Saturation:** warm and rich, between Animal Crossing and Tunic.
3. **Interiors** are real voxel rooms shared with other players, with painterly light. Image generation is limited
   to game-board art and concept frames (§10, §16.3). There is no human illustrator.
4. **Signature hours:** dusk and night, with day reserved for offline visits and building.

**Decided by the founder on 2026-10-30:**
5. **Presence is the citizen’s own warm window**, named up close; the castle beacon is the kingdom’s light.

## Change log

- **2026-10-29: first version.**
  - Written from the founder's brief: unique, beautiful, polished, its own identity at the level of today's most
    striking games, with the prototype as the baseline.
  - Draws on the prototype review, `docs/05`, `docs/08`–`10`, `ChatDom.md` and `Quality.md`.
- **2026-10-29: taste calls decided.**
  - The founder accepted the recommendations on proportions, saturation and signature hours.
  - Interiors (and UI, Atlas and target-frame art) move to Codex image generation under art direction.
  - A research report was commissioned at `docs/research/codex-image-generation.md`.
- **2026-10-29: interiors are places.**
  - Founder: the tavern is a real place you enter with other players, with tables where you join games or request
    new ones by prompting.
  - Interiors become voxel rooms with a painterly interior pass, replacing painted 2.5D backdrops.
  - Prompted games are instant at your table; the streamer can crown them.
  - Image generation narrows to game-board art and concept frames. UI is modelled and rendered; the Atlas is composed
    from the stamp library.
- **2026-10-29: the planning files' decisions.** A sub may tint the edge of a light, never brighter (§2). Townsfolk
  are the few keepers of places, and citizens are always people (§6.5, §7). The throne reads in a narrow dock and on a
  phone, and the window's shutters swing open for big moments (§11). The Atlas draws in pencil, ink and colour,
  founded kingdoms are drawn from life, and the map stops at a drawing that comes alive on entering (§5, §12, §16.3).
  Small-frame shots and the live founding ceremony join §13. How the Atlas shows live kingdoms waits for the liveness
  study, so §12's light line is unchanged.
- **2026-10-29: paint and pennants on the Atlas.** The founder chose the liveness study's recommendation: live
  kingdoms bloom in vermilion wash and hoist their pennant, small live channels are dabs and pencil flags, and the
  Atlas has no night (§12).
- **2026-10-29: consistency sweep after round 14.** The sub tint goes by tier (§2), and the tier 3 cape is animated
  with a colour shimmer like the Super Mario star (§7).

- **2026-10-30: windows are presence.** Citizen windows light while present, with names up close; the castle beacon represents the whole kingdom. Sound uses credited CC0/permissive libraries plus procedural audio, no silent actions.
