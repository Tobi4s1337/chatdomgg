<!-- Copy of FILM.md as of Sun 1 Nov 2026 (the 2:57 three-minute script). The teaser is a new, shorter cut; see ../PRD.md. -->
# The film: Chatdom's three-minute demo, written first

Date: 2026-10-29. Written after reading every document in `docs/`, the earlier build spec and all six prototypes, plus
the founder's notes of today. Nothing here is decided. This file proposes:

1. one reading of what Chatdom is
2. where each founder note lands against the 08/09 decisions
3. the ideas this round adds
4. a script for the submission video
5. everything the script needs, worked backwards: the build, and the AI-steered pipeline that shoots and cuts the film

Where this file disagrees with a decision in `09-depth-synthesis.md`, it says so and names the exception to record.
The founder's brief for this round: "Be ambitious and know no limits", and "optimize for the sickest 3-minute demo
possible … think about the best possible script for this video and work from that backwards."

**Revised the same day** after a second round of founder notes:
- the plot is "Who will have the most epic kingdom?"
- chapters should be quick, plain promises such as "Raid other kingdoms, connecting communities" and "Forge items
  unique to your community"
- Twitch emotes should appear in the kingdom automatically
- show Bits and train events quickly
- viewers get rewarded for showing up
- the film should feel cinematic but authentic, with the founder's own voice in places and an epic ElevenLabs
  narrator

That round added §3.9–3.13 and rewrote §4 as version 2. It also extended §5–§7. A third note asked to show avatar
customisation and real voxel building with unlockable items. That added §3.14 and chapter 3, "Make it yours".

**Revised again on 2026-10-29 (evening)** for the founder's decisions in the five new planning files
(`ChatDom/World-Tree.md`, `Twitch.md`, `Atlas.md`, `Monarch.md`, `Safety.md`). The film's structure and timings are
unchanged. What changed:
- subs get sub pieces on their own home, not a plot in a sub quarter
- an ad break means the kingdom holds its breath, and nobody is paid for watching ads
- refusal beats follow `ChatDom/Safety.md`: nameless, and the same whatever the reason
- each forge costs a coal, and the forge burns only while the stream is live
- Genesis plays live only, on stream, with no private draft
- the kingdom never makes clips; the Gallery hangs director stills
- the Affiliate line follows Monetization for All

**2026-10-29: consistency sweep after round 14.** Chatdom makes no video of its own: no founding clip and no recaps,
and Chronicles keep stills (§2, §3.1, §3.8, §6). Our own film is separate and stays. The sub tint goes by tier
(§3.6). Campfire seats need trust tier 1, as in `ChatDom/Tech.md` §10.6 (§3.5).

## 0. What Chatdom is, as I read it

Chatdom gives every Twitch channel a persistent place: a kingdom that its chat lives in.

- The streamer rules the kingdom, and every viewer is a citizen with a home.
- The channel's real life on Twitch happens in the world as something you can see: who is in chat right now, who
  has been here four years, and every sub, cheer, raid, poll and Hype Train.
- Codex works inside it under rules: it reads the channel and drafts the kingdom, forges what chat asks for, and
  writes the night's ballad and the quiz about the stream.
- Watchers see everything through the director view on stream. Walkers open chatdom.gg and move in.

**What exists today:**
- **Lanternmere** (`prototyping/kingdoms/f-lanternmere`) proves:
  - the dusk and night look
  - the event-sourced core (WorldEvent → reducer → beat), with a beat for most Twitch events
  - an offline Forge with six-angle renders and provenance
  - a director camera with scripted paths
  - a raid, Hype Train and boss loop on a fake feed
- **What Lanternmere lacks:** it has never run on a real GPU, and has no server, no real Twitch, no interiors, no
  voice, no wardrobe UI and no capture pipeline.
- **e-atlas** has the world map, per-channel heraldry and a smooth zoom from continent to plot.
- **The depth docs (08/09)** hold far more design than any film can show. The film should borrow five or six of
  their best moments, not their vocabulary.

**The entry has changed.** The earlier build spec (§12) and docs 02/03 still plan the hackathon around ezpug and
put Kingdoms after 2 November. Today's notes make Chatdom the entry, and this file assumes that. The spec and README
need the same change.

## 1. The pitch

**One line:** Chatdom turns a Twitch chat into a living kingdom. Every viewer gets a home, every Twitch moment
happens in the world, and Codex forges whatever chat imagines.

**Tagline:** Every chat deserves a kingdom.

**The question the product asks:** Who will build the most epic kingdom?

**Three things a judge should be able to repeat after one viewing:**

1. My viewers' history on the channel became a place: a four-year lurker now has a house on the oldest street.
2. Everything on Twitch happens in the world, and the world writes back to Twitch.
3. Chat typed a sentence, and Codex made a real thing in the world in seconds, safely. The thing exists only in that
   community.

## 2. The founder's notes, against the docs

| Note | What the docs already say | Proposal | Exception to record |
|---|---|---|---|
| Player cards showing house details and how long someone has followed or subbed | Nameplate pips, tenure garb (ribbons at 3/6/9 months, a hood at 12), and the item card (items §3.8). No person card. | The **citizen card**, and tenure as architecture (§3.2) | None |
| Avatar customisation | Fully designed (items §3.5–3.6): 9 silhouettes, 24 hair styles, 120 garb pieces, the dye book. No UI exists. | Build the **wardrobe**. Defaults come from Twitch: name colour for the cloak, sub-badge colour for the trim. | None |
| Build unique things: real voxel building, unlocking special items | Six layers of freedom; the citizen owns the large shapes and the system the small ones; free geometry only as charter Monuments (building §3.1) | **Build mode** (§3.14): free voxels on your own plot within a tier budget, auto-detailing, publish behind a Luna render check; unlockable pieces from chests, tenure and events | Free voxels on your own plot |
| Codex invents items with a magical forge effect, Luna as the moderation judge, house items only, instant | King approval queue, a broad item scope (garb, pets, crests), no designed effect | The **Forge ritual** (§3.3): house parts only, published instantly behind two Luna gates. The ritual hides the model's latency. The streamer keeps an unforge key. | Instant publishing for house parts (09 requires king approval); the Forge's scope narrowed |
| Trading; carrying items into other kingdoms | No market; won items may be gifted once; placeables stay in their home kingdom (items §3.11) | **Barter caravans:** item-for-item swaps by consent, with no currency and no cash-out. Every item keeps its origin crest and gets an "Imported from" plaque. Raids and visits carry goods. Decided 2026-10-29: swaps happen only between kingdoms, on visits and raids; at home, things are only given (`ChatDom/World-Tree.md` rule 10). | Placeables may travel; forged items may be swapped one for one |
| Size the kingdom from channel data, so every streamer size is welcome | Wards unlock from 28-day active citizens; size brackets disagree between docs | **Kingdom Genesis** (§3.1) seeds the founding size from followers, subscribers and average viewers. After that, growth runs on activity, as docs/07 says. | Channel numbers are used once, at founding |
| Minigames in hubs such as a tavern you can enter, with a genuinely nice art style that isn't forced voxel | Everything is voxel; tables sit in the Tavern; games are drawn on a 2D phone panel | **The tavern as a place** (§3.4): a shared voxel room with painterly light; each game opens in its own art style; anyone can prompt a new game at a table | Painterly interiors and game-board styles in the art bible; prompted games instant at your table |
| An outdoor campfire for werewolf-style games with the real characters, maybe LiveKit voice | Dusk Court sits at a round table indoors; voice is refused (social §3.15) | **The campfire** (§3.5): Dusk Court moves outdoors, with voice only for seated players and strict scoping | Voice, for campfire seats only |
| An AI-steered demo: simulated events and chat, AI recording, cutting and camera | A director exists and the fake feed is seeded; no capture pipeline | **The studio** (§6), for our own film only; **Chronicles** keep stills (§3.8) | None |

## 3. Ideas this round adds

### 3.1 Kingdom Genesis: your channel, as a place

The streamer clicks Connect with Twitch. Chatdom reads what Helix exposes about the channel. Codex turns it into a
charter: data fields from fixed lists, never code. The generators then build the kingdom from the charter.

| Channel data | Becomes |
|---|---|
| Channel emotes (Get Channel Emotes) | Voxelised plaza statues, weathervanes, banner charges and stained glass: palette-snapped, extruded 2–6 voxels deep. The palette snap and `.vox` import already exist (d-voxel-diorama, the f-lanternmere `.vox` upload). The channel's own emotes as monuments is the most Twitch-specific image in the product. |
| Profile image and name colour | Crest and banner colours; e-atlas `src/world/heraldry.ts` draws the coat of arms |
| Category and schedule | Biome mix and landmarks: a Celeste streamer gets a mountain, a Stardew streamer farmland, a horror streamer fog and a crooked chapel |
| Description and panels | Name suggestions, a motto and founding lore; the streamer picks |
| Followers, subscribers, average viewers | Founding tier and plot count (table below). Everyone gets a place by tenure on day one: the follow year sets the tenure quarter, and sub months count toward the street within it (§3.2, `ChatDom/Twitch.md` §5). |

**Founding size.** The numbers are placeholders; the shape is the point.

| Community at founding | Tier | Plots | What it feels like |
|---|---|---|---|
| Fewer than 5 average viewers | Hamlet | 16, plus one tavern table | Everyone has a home and the whole chat fits round one table. Named NPC townsfolk keep it alive between viewers, so it is never an empty map. |
| 5–50 | Village | 64 (one ward) | A green, a pier, a market cart |
| 50–500 | Town | 128–256 | Tenure quarters, Old Row, a market square |
| 500–5,000 | City | 4–12 wards | Districts and a cathedral site |
| Above 5,000 | Capital | 12–40 wards | Homes by tenure and lottery; everyone else present is a light on the walls and in the sky. The crowd is represented, never simulated (docs/07). |

After founding, wards unlock from active citizens only. A bought follower count does not keep paying.

**Founding as a film beat.** Genesis runs only live, on the streamer's own stream at their press, with no private
draft (founder decision, `ChatDom/Monarch.md` §5.2). Chat votes the name; the charter draws itself as an inked
parchment map in the Atlas look. Then the ink lines rise into voxel terrain, the river cuts, the castle assembles and
the emote statues extrude. This takes about 15 s. The director keeps stills of it for the kingdom's first Chronicle.
Chatdom makes no founding video and never creates clips on Twitch (founder decision).

### 3.2 The citizen card, and tenure as architecture

**Opening it.** Click an avatar or a house. In chat, `!card @name` puts the card on stream. Every card has a share
URL with an image, like the item card (items §3.8).

**What it shows:**
- Twitch name in their chat colour, a portrait, and a title: King for the streamer, Knight for a mod, Noble for a VIP.
- **"Following since 14 Feb 2022."** From `followed_at` in Get Channel Followers, which needs the broadcaster's or a
  mod's `moderator:read:followers`.
- **"Subscribed 14 months, Tier 1."** From the subscriber badge info on every chat message, and `cumulative_months`
  on resub messages.
- Citizen number, home and street.
- Forged pieces with their provenance, and imported pieces.
- Passport stamps (kingdoms visited on raids), games won, and Duskscales.

**The house plaque** shows the date built, the pieces on the house, the visitor count and a guestbook.

**Tenure as architecture.** The oldest follows live on the oldest streets, by the castle (Old Row). A five-year
follower has a stone house with a carved doorstep stone. A new follower starts with a tent in the Outskirts, which
becomes a hut on their third night in chat. You can read a community's history by walking it.

### 3.3 The Forge ritual

**Scope: house parts only.** Roofs, chimneys, doors, windows, shutters, porches, fences, gates, garden pieces,
fountains, lamps, signs, weathervanes, mailboxes and small statues. The plan is data, the grammar builds legal voxels,
and the result can only attach to a slot on a house. That narrow scope is what makes instant publishing defensible.

| Step | What the viewer sees | What runs | Budget |
|---|---|---|---|
| 0 | `!forge …` in chat, or the Forge on chatdom.gg | Twitch chat; AutoMod has already seen the line | 0 s |
| 1 | The words lift off the chat line as runes and circle the anvil | Gate 1, outside the Codex run: filters, the moderation endpoint and Luna on the Decisions API (pass, soften, hold or refuse) | under 1 s |
| 2 | The runes snap into a glowing blueprint; the plan JSON is readable for half a second | Codex: prompt → `ForgePlan` (base, motifs, palette, emitters) | 2–5 s |
| 3 | Molten voxels pour into the blueprint layer by layer, with sparks | Grammar assembly, quantise and budget (all exist) | under 0.5 s |
| 4 | A wax seal stamps "Fit for the realm" | Gate 2, outside the run: a flat-colour contact sheet and the composed name and plaque (the renderer exists; today's check is a heuristic) | under 1 s |
| 5 | A hammer strike and a white flash; the piece cools from orange into its colours | Mint `ItemCopy` with `ProvenanceV2` | — |
| 6 | It arcs across town and snaps onto the house; smoke or light starts, and the neighbours' bubbles react | Placement on the plot's slot, plus a beat for the director | 2 s |

**The ritual hides the latency.** It runs long enough to cover Codex's few seconds, so "instant" is how it feels.

**Update from `ChatDom/Tech.md` (2026-10-29):** the founder chose Codex for every piece of magic, so the whole Forge
is one Codex run (plan, assembly and the render check as tool calls), targeted at 15 to 30 s. The ritual's stages
follow the run's tool calls. The film may shorten the wait with a visible cut. Later the same day,
`ChatDom/Safety.md` §4.2 moved both gates outside the run: the spell runtime calls the judges before and after it,
never the agent.

**Refusals are part of the show, nameless.** On stream the forge coughs soot and sulks, with a line from one shared
pool, the same for every kind of refusal. It never shows or hints at the words or the maker, and at most one refusal
beat airs every 10 minutes (`ChatDom/Safety.md` §5.3). Only the maker hears why ("The Forge only shapes things for
homes").

**Streamer control.** The streamer keeps an unforge key and can switch the channel to approval mode. The forge burns
only while the stream is live, and each forge takes a coal: one for each stream night a citizen is there
(`ChatDom/Safety.md` §3.2).

**Copies.** Others can commission a copy of a popular piece, for a coal. The copy keeps the original's name and
lineage: "first forged by cozy_otter, now on 212 homes in 9 kingdoms".

**Using Luna.** Earlier research found that Luna at low effort skipped tool use (`docs/research/codex-leverage.md` §3). So
the binding gates are direct calls outside the run: give Luna the text and images inline on the Decisions API, ask a
fixed set of questions, and give it no tools (`ChatDom/Safety.md` §4).

### 3.4 The tavern: a place, with tables that are games

Revised 2026-10-29. The founder wants the tavern to be a real place you enter and share with other players, with
tables where you join games, or request them by prompting. That replaces the painted-backdrop idea. The full art
direction is in `ChatDom/Artstyle-Soul-Feel.md` §10.

**The room.** A voxel room you walk into through the door, with no loading, full of other citizens. Inside, the light
turns to paint: candlelight, soft ink outlines, brush-textured shading.

**Tables are games:**
- From across the room you see each game as a voxel miniature on its table.
- Sit down and the camera pushes into the tabletop, and the game opens in its own art style:
  - **Herald's Quiz:** an illuminated manuscript.
  - **King's Chalk:** chalk on slate.
  - **Crown vs Crowd:** an oil-painted board with glowing move arrows.
  - **Liar's Dice:** a candlelit close-up of cup and dice.
  - **Lantern Regatta:** a watercolour map.

**Prompted games.**
- At an empty table, anyone can ask for a game in words: "liar's dice, but pirates, and the loser walks the plank".
- Codex sets it up at once, after automatic checks (sound rules, fair, always finishes, nothing hidden leaks). This is
  the Chalk and Taster pipeline from `08-depth-minigame-engine.md`.
- The table dresses itself from a library of board styles.
- The streamer can crown a good game for the whole kingdom, with its author's name on it.

**How it works technically.** A game surface is mounted in place of the tabletop. Tableware already draws every game
as a 2D panel (engine §3.5) and as a voxel table miniature, so this needs a transition and the board styles, not a
second engine.

**Hubs:**
- the Tavern, for table games for chat
- the Theatre, later, for stage games and Folly reveals
- the throne room, for the Royal Audience

### 3.5 The campfire

**The scene.** Outdoors at the edge of the Wilds, at night. Dusk Court (viewer-games #7) moves here from its round
table:
- The real avatars sit on logs, their faces lit by the fire.
- Seated players talk over LiveKit, with spatial audio around the fire.
- Each avatar's head and mouth move with its player's voice.
- The streamer is the Magistrate, or an AI narrator voices the night from lines Codex writes from the game log: "Dawn.
  One lantern did not survive the night."
- Chat is the Gallery and votes with `!sus name`.

**The voice exception, scoped:**
- Voice is only for the 6–12 seated players.
- Seats go by streamer invite or by lottery among trust tier 1 (30+ days followed, `ChatDom/Tech.md` §10.6).
- Push-to-talk, and the streamer can mute or unseat anyone.
- Nothing is recorded beyond the broadcast, which is already public, as with Guest Star.

Everyone else keeps text, as social §3.15 wants.

**The same rig, later:** the Royal Audience in the throne room. A viewer redeems, steps onto the dais and talks to the
streamer for 30 s, on stream.

### 3.6 Twitch, both ways

**Twitch → world:**

| Twitch | Source | In the world |
|---|---|---|
| Go live / go offline | `stream.online` / `stream.offline` | The sky spins to dusk and the beacon catches / the kingdom eases into night and the Ballad is sung |
| Chat message | `channel.chat.message` | A bubble over your avatar; your light is on |
| Follow | `channel.follow` v2 | A tent with your name in the Outskirts; it becomes a hut on your third night |
| Sub | `channel.subscribe` | Your banner unfurls on your own home in your tier colour; sub pieces, and a sub tint on your light (warm gold, rose, or a rainbow edge at tier 3) |
| Resub | `channel.subscription.message` | Month ribbons on your banner and cape; months count toward your street when you settle |
| Gift subs | `channel.subscription.gift` | Parcels parachute onto doorsteps, sealed with the giver's name |
| Cheer | `channel.bits.use` | Fireworks scaled to the Bits, writing the cheerer's name |
| Power-ups | `channel.bits.use` | Gigantify an Emote → a voxel parade balloon of that emote; Message Effects → a spell around that avatar's bubble; Celebration → a confetti storm over the castle |
| Channel points | `channel.channel_points_custom_reward_redemption.add` | Kingdom rewards: rain, plant a tree, ring the bell; points given to the pool raise the tavern |
| Hype Train | `channel.hype_train.*` v2 | A steam train circles the town with contributors in the carriages; level 3 brings the Duskwyrm |
| Goals | `channel.goal.*` | A great banner woven in the plaza, a stripe for each step; a goal never fills a wonder (`ChatDom/Twitch.md` §7) |
| Poll | `channel.poll.*` | A royal decree, and the winning option gets built |
| Prediction | `channel.prediction.*` | An odds board in the Tavern; the outcome lights up on the table |
| Incoming raid | `channel.raid` | A caravan under the raider's banner, with a tribute forged in their colours |
| Shared Chat | `channel.shared_chat.*` | A bridge to the other kingdom that both chats walk across |
| Shoutout | `channel.shoutout.create` | The crier announces it, and a signpost to that kingdom appears |
| Ad break | `channel.ad_break.begin` | The kingdom holds its breath: vote windows freeze and the director holds a calm wide shot. Nobody is paid for watching ads |
| Timeout / ban | `channel.chat.clear_user_messages` | Your avatar goes home and the door shuts / your home is hidden; nothing is destroyed |
| Mod or VIP added | `channel.moderator.add`, `channel.vip.add` | A knighting ceremony: Knight of the Watch, or Noble |
| Category change | `channel.update` | The weather follows the game: fog for horror, snow for a Celeste run |
| Charity | `channel.charity_campaign.*` | A wishing well fills, and each coin is a name |
| Clips | Get Clips | A still in the Gallery, credited to the clipper, that opens the clip on Twitch |

**World → Twitch.** This direction is what makes the integration deep rather than decorative.

| In the world | Helix call | Scope |
|---|---|---|
| The king issues a decree | Create Poll | `channel:manage:polls` |
| Crown vs Crowd, or an arena bout | Create Prediction, then resolve it | `channel:manage:predictions` |
| A knighting (the streamer confirms) | Add Channel VIP | `channel:manage:vips` |
| The town crier speaks | Send Chat Announcement | `moderator:manage:announcements` |
| The streamer opens the Raid Gate | Start a Raid | `channel:manage:raids` |
| A visit to another kingdom's signpost | Send a Shoutout | `moderator:manage:shoutouts` |
| A walker types in the world | Send Chat Message with the walker's own token, so AutoMod and mods apply | `user:write:chat` |

The kingdom never makes clips (founder decision), so there is no Create Clip row. Since 13 May 2026 (Monetization for
All), subs, Bits, channel points, polls and predictions are open to eligible streamers below Affiliate. Ads, charity,
goals beyond follower goals and Bits in Extensions are not. That shapes casting (§5).

### 3.7 The Raid Gate and the Atlas road

**The raid out.** At the end of a stream, the streamer walks to the gate and picks a kingdom on the Atlas. Opening the
gate calls Start a Raid. The citizens who are present follow the streamer out, across the bridge and onto the road.
The camera rises from the 3D world into the Atlas and follows the procession along an inked road to the other
kingdom. Its gates open as the raid lands on Twitch.

**The Atlas draws Twitch's real social graph.** Every raid leaves a road, every Shared Chat session a bridge, and
every swap a trade route. This also settles Atlas placement: the docs noted follower graphs are not public, but the
raids we observe are ours to draw.

**When the target is not on Chatdom,** the road ends at an unclaimed region carrying that channel's name. That is
"settlers before kings" (docs/04 §3.1).

**The film's map** (`ChatDom/Atlas.md` §10.2, founder decision 2026-10-29) uses as much real Surveyor data as there is,
labelled with its date: live kingdoms blooming in vermilion wash on a day map, with their pennants, and real raid roads.
The Atlas has no night. A clip the real night lacks, such as a raid train, may be simulated on the real map and is
labelled SIMULATED. This replaces the "glowing raid roads (SIMULATED population)" planned for 0:14 in §4.2.

### 3.8 Chronicles: the director as a product

The director that frames the stream also keeps the night, in stills only (founder decision: Chatdom makes no video of
its own, so no recaps). After every stream, it produces:

- **The night's chapter**: the Ballad of Tonight and the night's beats, in words and stills.
- **Director stills** of each climax, hung in the Gallery. The kingdom never makes Twitch clips (founder decision).
- **A personal card for every citizen**, with a share link: "your night in lumi's kingdom", covering your forge, your
  fight, and your seat at the fire.

Small streamers get an illustrated record of every night, and share cards their viewers can post. Discovery is the growth problem they actually
have, and this is the Impact story.

### 3.9 Emotes everywhere, automatically

Channel emotes have already passed Twitch's emote rules as flat images at chat size. A 4 m statue is a new object, so
the streamer confirms each statue and the extruded version passes Luna before its unveiling (`ChatDom/Safety.md` §6,
case 6). This happens at Genesis, and again whenever the channel adds an emote.

**The pipeline:**
1. Get Channel Emotes returns static PNGs and animated GIFs.
2. Each emote is palette-snapped and extruded 2–6 voxels deep, with a bevel.
3. Animated emotes become voxel flipbooks, one frame per GIF frame.

The palette snap and the `.vox` import already exist (d-voxel-diorama, f-lanternmere).

| Where | How |
|---|---|
| Plaza statues | The channel's top emotes at 4–6 m, unveiled at Genesis. A new sub emote gets its own unveiling on stream. |
| Crest and banners | An emote as the heraldic charge |
| Stained glass, weathervanes, door knockers, chimney smoke | Motifs in the Forge (§3.10) |
| Chat bubbles | Emotes drawn inline over the avatar |
| Emote weather | When chat spams an emote, it rains over the town as voxel confetti (crowd-scale social, social §3.12) |
| Fireworks | Cheers burst into the shape of an emote |
| Gigantify an Emote | The parade balloon over the castle |
| Gestures | A message that is only an emote pops that emote above your avatar's head |

Emotes from 7TV, BTTV and FFZ can come in through those services' public APIs as a streamer option. They need our own
check first, because Twitch has not reviewed them.

### 3.10 Forge items unique to your community

At Genesis, Codex writes each kingdom a **style kit**. It picks from fixed lists only:
- **a palette**, from the channel's colours
- **motifs**, from the channel's emotes
- **a native material**, from the biome: summit crystal for the Celeste mountain, bog iron for the horror fog
- **a shape language**: round and cosy, crystal and angular, gothic, or driftwood

The Forge draws on the kit, so the same prompt gives two different items in two kingdoms. A dragon chimney forged in
lumi's kingdom is lilac and blows heart-shaped smoke. In HexHeroes' kingdom the same prompt comes out hex-crystal blue.

This gives trading and raids their meaning. Items are recognisably from somewhere. The only way to get a lumi-heart
lantern into another kingdom is to be given one, or to swap for one, on a raid.

### 3.11 Show up, get rewarded

- **Presence pays.** Every minute in chat earns materials (Hearth, 1 a minute, through `presence.tick`; 09 §2.11).
- **Lurkers count.** Get Chatters (`moderator:read:chatters`) lists everyone with chat open, whether they type or
  not. A lurker's light burns and they earn like everyone else.
- **First light.** A small chest on your first minute of each stream.
- **Streaks.** A flame over your door grows with consecutive streams. Your best streak is kept forever (progression
  §3).
- **Tenure.** Follow milestones unlock house pieces, such as carved doorstep stones, that cannot be bought. Sub months
  add ribbons, never tenure pieces.
- **The rule.** Rewards for showing up never depend on money. This is the source-class ledger rule (09 §3).

### 3.12 Spectacles: Bits, trains and raid trains

**Cheers.** The streamer sets thresholds, the way alert boxes work. The Bits go to the streamer as they always do.

| Cheer | Spectacle |
|---|---|
| 100 | Fireworks bursting into the channel's emotes |
| 500 | A meteor shower; chat makes `!wish`es |
| 1,000 | The kingdom's great beast (the Hearthbeast, pets §3.11) flies low over the town |
| 5,000 | Skyfire: an aurora and a firework procession around the walls |

The dragon is earned only: the Hype Train or the Wyrm Bell wakes it, never a cheer (founder decision).

These are reactions to ordinary cheers. The Lantern Fair Bits menu is dropped; the panel's shelf offers chosen moments
and things that last one day (`ChatDom/Twitch.md` §17).

**The Hype Train** is a steam train circling the town. Each level adds carriages, and level 3 brings the dragon.

**The raid train** is a Twitch tradition: a chain of streamers raiding each other in sequence. In Chatdom it becomes
a literal train on the Atlas:
- It stops at each kingdom on the route, and each stop adds a carriage under that kingdom's banner.
- When it ends, the route stays on the map as a named line: "the Autumn Raid Train, 7 kingdoms".

### 3.13 The race for the most epic kingdom

Every community is asked one question: **who will build the most epic kingdom?**

**Seasons.** About 13 weeks each, between solstices and equinoxes (09 §2.10).

**Leagues by size**, so a hamlet competes with hamlets. This needs one bracket table; the docs currently disagree
(building, progression and viewer games each use different ones).

**Splendour, the score,** is built only from things money cannot buy (the 09 §3 ledger rule):
- How lovely the homes are, by median, not sum. "The sickest kingdom is the one where the most homes are lovely"
  (atlas, Building tab).
- Wonders finished.
- How many citizens took part.
- Raids and visits given and received.
- Games won, including the chat's Crowd rating.
- Garlands from visitors: raiders and tourists vote for the kingdoms they visit.

**Rewards:**
- **Crowning.** At the end of each season, the winner of each bracket gets a permanent crown on its Atlas region and a
  monument in its plaza. Codex writes the citation.
- **Kingdom of the Week.** A spot on the front page of chatdom.gg. For small streamers this is discovery, which is the
  Impact case.

**Rivalry stays additive** (docs/07): no one can damage another kingdom. You win by building and connecting.

### 3.14 Make it yours: the wardrobe and build mode

**The wardrobe** (items §3.5–3.6):
- **Pieces, never full skins:** silhouettes, hair, garb and dyes. The defaults come from Twitch: name colour for the
  cloak, sub-badge colour for the trim.
- **Unlocks** come from showing up, tenure, events and games:
  - the Twelve-Moon Hood at 12 months subscribed
  - a scale cape from the Duskwyrm
  - a season crown

  Each piece's card says how it was earned. Nothing that glows can be bought: "light is earned, never bought".
- **The kingdom's style kit** (§3.10) adds local pieces, such as clasps and patterns drawn from the channel's emotes.

**Build mode: free voxel building on your own plot.**
- **The canvas.** Your plot is a voxel canvas at the prop scale (0.125 m). Its voxel budget grows with your house tier.
- **The tools** come from d-voxel-diorama's editor: place, erase, paint, fill, mirror and templates. Its greedy mesher
  meshed a whole plot in 0.94 ms in a worker.
- **"The citizen owns the large shapes; the system owns the small shapes"** (building §3.1). You place walls, and the
  kingdom adds trims, roof edges, arches and window glow as you build. That is Townscaper's lesson, and
  b-townscaper's corner-state mesher is the reference.
- **The palette is the kingdom's style kit,** so a street of very different houses still reads as one place.
- **Unlocked items** drop into slots or anywhere on the plot: a waterwheel from a first-light chest, a Duskscale
  banner, the forged dragon chimney.
- **Build privately, publish to the street.** On publish, a six-angle render goes through Luna (the building
  moderation pipeline, building §3.13). The director then gives the house a 6 s Housewarming orbit with the owner's
  name over the door (building §1).
- **`.vox` import** from MagicaVoxel for dedicated builders: palette-snapped and budgeted. This already exists in
  f-lanternmere.

**Exception to record.** The building doc allows arbitrary geometry only as charter Monuments. This opens free
voxels on your own plot, within a budget and behind the publish check.

### 3.15 Progression you can see (Tobias, Sat 31 Oct ~11:45)

The pitch beat is coming back: Chatdom is a habit you build with your community, and that progress means something
in Twitch chat. The product already promises it (World-Tree §8: everything grows forward at the pace of days, never
for money, never shrinks; growth shows in the world, never only as a number).

- **Your home grows with you:** time in chat, streaks and returning grow the home through the Hearth/Tide tiers
  (tent → hut → cottage → house → manor → hall), with a small ceremony on the plot each time. Tenure pieces from
  follow milestones; sub months add ribbons, never tenure; max three homes.
- **The town levels up with its people:** market, tavern, forge, castle court and bridge gain visible levels as the
  community shows up (presence, channel points given to the pool, full nights). Never down.
- **Things to earn and collect:** embers from presence (lurkers count), numbered keepsakes from moments, Forge pieces,
  wardrobe pieces. Earned, never bought; shown on the citizen card's shelf.
- **Chat announces it:** the crier's line in chat, framed by the stream view ("The tavern reached level 3").
- **The Chronicle replay:** the kingdom's growth over weeks, replayed live in the engine from its own record and
  scrubbable. Not a video (founder decision: the kingdom makes no videos of its own), which is what makes it honest.
  It gives the montage its fast shot.
- Seeded weeks of history are fine for the shot, labelled SIMULATED in the product.

Briefed to chatdom-main as product only (`briefs/0034`), after the live evening. Its shots are in Part 2 (§4.2) and §5.

## 4. The film

Version 2, after founder feedback the same day. The film is now a trailer built around one question, with short
chapters that each make a plain promise. The story threads from version 1 (lumi's stream, and cozy_otter the lurker)
run through it as recurring faces.

### 4.1 Rules of the film

1. **The question is the spine.** Open on "Who will build the most epic kingdom?" and close on the season crowning.
2. **Chapters are promises.** Eight title cards, each in plain words a streamer would repeat:
   - Your channel. Your kingdom.
   - Show up. Get rewarded.
   - Make it yours.
   - Forge items unique to your community.
   - Your stream shapes the world.
   - Play together.
   - Raid other kingdoms. Connect communities.
   - Who will build the most epic kingdom?
3. **Every chapter starts on Twitch and lands in the world.** Show the real Twitch moment first (a chat line, an
   alert, the raid dialog), then cut to what it caused.
4. **Two voices.** The Narrator sells the legend; Tobias shows it is real.
   - **The Narrator** is an epic storyteller generated with ElevenLabs. Lines are at most eight words, present tense,
     with room to breathe, and the Narrator never explains a mechanic.
   - **Tobias** is a real recording over real footage, explaining what is happening.
   - The campfire players' voices and lumi's raid call are the only other speech.
5. **Cinematic but authentic.**
   - Cinematic: the director's camera, the score, the cuts.
   - Authentic:
     - real Twitch UI in every chapter
     - a "LIVE · twitch.tv/…" bug on real footage, and "SIMULATED" on simulated footage
     - no UI on screen that does not exist in the product
6. **Captions are burned in,** because judges may watch muted. Every voice line is also a caption.
7. **The music is original,** and the score swells chapter by chapter.

### 4.2 Script: "Who will build the most epic kingdom?" (2:57)

| Part | Time | Title card | Mostly proves |
|---|---|---|---|
| Cold open | 0:00–0:14 | CHATDOM | Design |
| The question | 0:14–0:21 | WHO WILL BUILD THE MOST EPIC KINGDOM? | Innovation |
| 1 | 0:21–0:38 | YOUR CHANNEL. YOUR KINGDOM. | Innovation, Impact |
| 2 | 0:38–0:53 | SHOW UP. GET REWARDED. | Impact |
| 3 | 0:53–1:11 | MAKE IT YOURS. | Design, depth |
| 4 | 1:11–1:29 | FORGE ITEMS UNIQUE TO YOUR COMMUNITY. | Codex, Innovation |
| 5 | 1:29–1:49 | YOUR STREAM SHAPES THE WORLD. | Twitch depth, Design |
| 6 | 1:49–2:05 | PLAY TOGETHER. | Design |
| 7 | 2:05–2:23 | RAID OTHER KINGDOMS. CONNECT COMMUNITIES. | Innovation, Impact |
| 8 | 2:23–2:33 | (the question returns) | Impact |
| Built with Codex | 2:33–2:51 | BUILT WITH CODEX | Tech, Codex |
| Close | 2:51–2:57 | chatdom.gg | — |

**Cold open · 0:00–0:14**
- Picture:
  1. Black. One line appears in real Twitch chat: `cozy_otter: been lurking for 4 years. first time chatting 👋`
  2. Cut to a dark voxel town. One window lights, with "cozy_otter" over it.
  3. Hundreds of windows light in a wave, and the castle beacon fires into the clouds.
- NARRATOR: "Every stream has a chat." · "Every chat… is a people." · "And every people deserves a kingdom."
- Card: **CHATDOM**

**The question · 0:14–0:21**
- Picture: the camera rises through the clouds into the Atlas. Thousands of kingdoms on the day map: vermilion washes where
  streams are live, pennants, and inked raid roads (real data where we have it, the rest SIMULATED and labelled; §3.7).
- NARRATOR: "Thousands of communities. Thousands of kingdoms." · "Only one can be the most epic."
- Card: **WHO WILL BUILD THE MOST EPIC KINGDOM?**

**1 · Your channel. Your kingdom. · 0:21–0:38**
- Picture:
  1. Connect with Twitch, the real consent screen, and the ledger: followers, subs, emotes.
  2. Live on lumi's stream (Genesis runs only live), chat picks the name, the ink map rises into voxel terrain and the
     castle assembles.
  3. lumi's emotes extrude into plaza statues, and the banners carry her heart emote.
  4. A triptych (SIMULATED): hamlet, town, capital.
- TOBIAS: "Connect your Twitch channel, and Chatdom builds your community a kingdom."
- NARRATOR: "Your colours on its banners. Your emotes in its stone."
- TOBIAS: "It's sized to you. Five viewers get a cosy hamlet; fifty thousand get a capital."
- Card: **YOUR CHANNEL. YOUR KINGDOM.**

**2 · Show up. Get rewarded. · 0:38–0:53**
- Picture:
  1. lumi goes live, seen in the Twitch player. The sky spins to dusk and the lights come on.
  2. cozy_otter's citizen card: "Following since Feb 2022 · Subscribed 14 months".
  3. Materials ticking up per minute, and a streak flame showing "9 streams". A glowing first-light chest lands on
     their doorstep, still closed.
  4. **The progression montage (about 6 s, fast cuts on the beat; §3.15):** cozy_otter's cottage scaffolds and
     settles into a house on Old Row, chimney catching, while chat reads "cozy_otter's cottage became a house!" ·
     the tavern grows a lit second floor, "The tavern reached level 3" · a keepsake drops onto the card's shelf
     beside the streak flame · then the Chronicle: weeks of the kingdom in two seconds, homes rising, streets
     filling in, the castle growing on its rise (SIMULATED history, labelled).
  Beats 1–3 run tighter (about 2 + 3 + 3 s) to make room; the cut stays at 15 s.
- NARRATOR: "Every viewer, a citizen." · "Every minute in chat… a light in the window." · "Even the quiet ones.
  Especially the quiet ones."
- TOBIAS: "Just being in chat earns rewards, even if you only lurk. Come back, and your home and your town grow with
  you."
- Card: **SHOW UP. GET REWARDED.**

**3 · Make it yours · 0:53–1:11**
- Picture:
  1. The wardrobe: cozy_otter on a turntable. Hair, cloak and dye in three quick cuts. "Unlocked: Twelve-Moon Hood ·
     12 months subscribed" shimmers in, and they put it on.
  2. Build mode: their empty plot under a voxel grid. In a timelapse they place walls, mirror a tower and paint the
     roof. The kingdom adds trims, arches and window glow as they go, and a crooked little tower with a balcony
     rises.
  3. The first-light chest from chapter 2 pops open to reveal a rare waterwheel. They drop it by the stream and it
     starts turning.
  4. Publish: the director's six-second Housewarming orbit, with "cozy_otter" over the door. Pull back to a street
     where no two homes look alike.
- NARRATOR: "Dress the part." · "Raise it… block by block." · "And what you earn… nobody can buy."
- TOBIAS: "Change your look, build your home voxel by voxel, and unlock rare pieces by showing up, not by paying."
- Card: **MAKE IT YOURS.**

**4 · Forge items unique to your community · 1:11–1:29**
- Picture:
  1. Real chat: `cozy_otter: !forge a chimney shaped like a sleeping dragon`.
  2. A coal leaves cozy_otter's scuttle, then the ritual: runes, the blueprint, the pour, the seal, the strike.
  3. The chimney arcs onto the new tower and puffs lilac heart-shaped smoke.
  4. Montage: chat's other forges, all in this kingdom's style.
  5. Split second: the same prompt in HexHeroes' kingdom comes out hex-crystal blue.
- NARRATOR: "Speak it…" · "and the Forge makes it real." · "Forged here. Found nowhere else."
- TOBIAS: "Codex designs it, a voxel grammar builds it, and it's on your house in seconds. It's made from your
  community's emotes, so it only exists here."
- Card: **FORGE ITEMS UNIQUE TO YOUR COMMUNITY.**

**5 · Your stream shapes the world · 1:29–1:49** (each beat opens on its Twitch inset)
- Picture:
  1. A cheer of 500 → fireworks burst into lumi's emotes.
  2. 20 gift subs → parcels parachute onto doorsteps.
  3. Hype Train → the steam train circles the town and gains carriages.
  4. At level 3 the Duskwyrm lands on the cathedral. Chat spams `!strike` and the whole town fights.
  5. It falls; loot rains down, and a gold pillar of light rises over cozy_otter.
- NARRATOR: "Cheer, and the sky answers." · "Gift, and the heavens deliver." · "Ride the Hype Train…" · "and wake the
  dragon."
- Card: **YOUR STREAM SHAPES THE WORLD.**

**6 · Play together · 1:49–2:05**
- Picture:
  1. The tavern door opens onto a warm, crowded room. As the camera crosses the threshold, the light turns to paint.
  2. At a side table a citizen asks for "liar's dice, but pirates". The table dresses itself: a sail-cloth unrolls and
     a tiny plank slides out.
  3. The camera pushes into lumi's table, and the tabletop becomes an oil-painted board: lumi against 600 chatters at
     chess. A Twitch prediction opens on its own.
  4. Cut to night at the campfire: eight avatars on logs, their mouths moving with real voices.
- NARRATOR: "Gather in the tavern." · "Trust no one at the fire."
- Real campfire voices: lumi: "Otter, your light was the last one lit." · cozy_otter: "I was at the forge!"
- Voice of the Realm, inside the product: "Dawn. One light did not survive the night."
- Card: **PLAY TOGETHER.**

**7 · Raid other kingdoms. Connect communities. · 2:05–2:23**
- Picture:
  1. lumi on stream: "Let's raid HexHeroes!" She opens the Raid Gate, and the real raid dialog counts down.
  2. The citizens march out with their lights, and the camera rises into the Atlas.
  3. The procession follows a glowing road to HexHeroes. Their gates open, and a raider hands over a dragon chimney
     with an "Imported from lumi's kingdom" plaque.
  4. Pull back: a raid train rolls from kingdom to kingdom, gaining a carriage at each stop.
- NARRATOR: "And when the night ends…" · "ride out." · "Every raid leaves a road." · "Every road, a bond."
- Card: **RAID OTHER KINGDOMS. CONNECT COMMUNITIES.**

**8 · The question returns · 2:23–2:33**
- Picture:
  1. The season board on the Atlas, with brackets from Hamlet to Capital.
  2. A nine-viewer hamlet tops its bracket beside a 40k capital (SIMULATED season).
  3. Crowns settle on the winning regions.
- NARRATOR: "Seasons. Leagues. Glory." · "Big or small…" · "every kingdom can claim the crown."
- Card: **WHO WILL BUILD THE MOST EPIC KINGDOM?**

**Built with Codex · 2:33–2:51**
- Picture:
  1. The `chatdom-main` thread in time-lapse: PRD boxes ticking, a fan-out, tests going green, and a stats card
     (real numbers only).
  2. Four tiles showing Codex inside the product: Genesis, Forge, Voice of the Realm lines, and games.
- TOBIAS: "I built Chatdom with Codex: one long-running thread that planned, built and tested it. And Codex runs
  inside it, designing kingdoms, forging items and narrating the night, always as data inside fixed rules."

**Close · 2:51–2:57**
- Picture: the night town. cozy_otter's window, the crooked tower, and the chimney puffing hearts.
- NARRATOR: "Your chat is waiting." · "Build its kingdom."
- Card: **chatdom.gg**

**Pacing check.** The narrator speaks about 150 words in total, and Tobias about 120. At roughly 2.5 words a second,
Tobias fills about 50 s. The narrator is slower, with pauses, and fills about 75 s. That leaves about 30% of the film
with no voice, for the Twitch moments, real chat and sound design. If it feels crowded, cut "Gift, and the heavens
deliver" and "Forged here. Found nowhere else." first.

### 4.3 If it runs long

Cut in this order:
1. The triptych.
2. The parcels.
3. The prediction.
4. The raid-train pull-back.
5. The HexHeroes style contrast.

Never cut the cold open, the citizen card, the build timelapse, the Forge, the dragon, the campfire voices, the raid road or the question.
Inside Part 2's progression montage, drop the keepsake cut first; keep the home growing and the Chronicle sweep.

### 4.4 Version 1, kept as a fallback

Version 1 was "One Night in lumi's Kingdom": one stream from go-live to the raid out, with captions only and no
narrator. Its shots are the same as version 2's. If the narrator ever tests as too much in front of Twitch judges,
fall back to it by dropping the narrator track and the chapter cards, and keep everything else.

### 4.5 Narration, ready for ElevenLabs

The narrator track for version 2 is written as ElevenLabs audio tags: each line has a delivery tag in brackets, and
ellipses mark the pauses. Generate each part as its own request, so takes can be swapped part by part. Tobias's
lines use the same tags, but as reading notes for a real recording.

Two companion files:
- `10-narration.txt` (kept outside the repo) has the whole track as plain text.
- `10-narration-elevenlabs.txt` (kept outside the repo) has only the narrator lines, ready to paste.

**Cold open · 0:00–0:14**
[dark narrator voice] Every stream has a chat.
[building tension] Messages. Scrolling. Gone in seconds.
[soft] But every chat… is a people.
[reverent, rising] And every people deserves a kingdom.

**Alternative cold open, in a mystery register**
[dark narrator voice] They said chat was just a box at the side of the screen.
[building tension] Messages. Scrolling. Gone.
[soft] Four years of saying hello… and nowhere to live.
[dismissive] Nobody thought it mattered.
[focused] Nobody looked.
[whisper] But every chat… is a people.

**The question · 0:14–0:21**
[grand, slow] Thousands of communities. Thousands of kingdoms.
[low, deliberate] Only one… will be the most epic.

**1 · Your channel. Your kingdom. · 0:21–0:38**
TOBIAS [friendly, direct] Connect your Twitch channel, and Chatdom builds your community a kingdom.
[proud, warm] Your colours on its banners. Your emotes… carved in stone.
TOBIAS [matter-of-fact] It's sized to you. Five viewers get a cosy hamlet; fifty thousand get a capital.

**2 · Show up. Get rewarded. · 0:38–0:53**
[gentle] Every viewer… a citizen.
[soft] Every minute in chat… a light in the window.
[knowing] Even the quiet ones. [whisper] Especially the quiet ones.
TOBIAS [warm] Just being in chat earns rewards, even if you only lurk. Come back, and your home and your town grow with you.

**3 · Make it yours · 0:53–1:11**
[playful, warm] Dress the part.
[building] Raise it… block by block.
[knowing, low] And what you earn… nobody can buy.
TOBIAS [enthusiastic] Change your look, build your home voxel by voxel, and unlock rare pieces by showing up, not by
paying.

**4 · Forge items unique to your community · 1:11–1:29**
[hushed, conspiratorial] Speak it…
[building] …and the Forge makes it real.
TOBIAS [excited, quick] Codex designs it, a voxel grammar builds it, and it's on your house in seconds. It's made from
your community's emotes, so it only exists here.
[proud] Forged here. Found nowhere else.

**5 · Your stream shapes the world · 1:29–1:49**
[commanding] Cheer… [booming] and the sky answers.
[warm] Gift… and the heavens deliver.
[building tension] Ride the Hype Train…
[whisper] …and wake the dragon.

**6 · Play together · 1:49–2:05**
[warm, inviting] Gather in the tavern.
[dark, low] Trust no one… at the fire.
VOICE OF THE REALM, in the product [grim, quiet] Dawn. One light did not survive the night.

**7 · Raid other kingdoms. Connect communities. · 2:05–2:23**
[quiet resolve] And when the night ends…
[rallying] …ride out.
[reverent] Every raid leaves a road.
[soft] Every road… a bond.

**8 · The question returns · 2:23–2:33**
[building, triumphant] Seasons. Leagues. Glory.
[intimate] Big or small…
[triumphant] …every kingdom can claim the crown.

**Built with Codex · 2:33–2:51**
TOBIAS [calm, proud] I built Chatdom with Codex: one long-running thread that planned, built and tested it. And Codex
runs inside it, designing kingdoms, forging items and narrating the night, always as data inside fixed rules.

**Close · 2:51–2:57**
[soft, almost a whisper] Your chat is waiting.
[firm, final] Build its kingdom.

## 5. Working backwards: what each shot needs

| Shot | What must be real | Exists today | Gap |
|---|---|---|---|
| Cold open: lights in a wave | A real chat line → presence → a window light; the night look | Lantern presence and `night-1.png` quality (f-lanternmere) | Real chat ingest; presence reskinned from lanterns to windows or lights |
| Genesis: consent and ledger | Twitch OAuth; Helix reads | — | OAuth on chatdom.gg, the channel reader, the ledger UI |
| Genesis: map → terrain | Charter → layout generator sized by tier | The e-atlas inked map; the f-lanternmere layout tool (fixed at 159 plots) | Parameterised layout, an ink-to-voxel transition, the emote voxeliser, a heraldry port |
| Size triptych | Three generated kingdoms (SIMULATED) | `_shared` village/town/metropolis sizes; e-atlas at 50k | Rendering a capital (impostors, HLOD) |
| Go live | `stream.online` → sky spin, beacon | Beacon and online/offline beats | EventSub |
| Citizens arrive | A server; real chat → bubbles; walkers | Bubbles, avatars, the arrival wave on the fake feed | Authoritative kingdom room (Colyseus), persistence, real identities |
| Citizen card | Follow date, sub months | A basic citizen panel and plot sign | Card UI, tenure data, share image |
| Wardrobe | Sub months for the hood unlock | Avatar parts (3 bodies × 6 hair, palettes) | Wardrobe UI, pieces, unlock moments |
| Build mode | A real build session on a real plot | d-voxel-diorama editor (place, erase, paint, fill, mirror, templates) and mesher; `.vox` import; b-townscaper corner-state mesher as the auto-detail reference | Build mode inside the kingdom, tier budgets, auto-detailing, publish check, Housewarming orbit, chests with unlocks |
| House on Old Row | Tenure-based placement | Scaffold → 5 tiers × 3 styles | Placement by tenure; the Outskirts tents |
| Forge | `!forge` from real chat; Codex; Luna | Offline parser, grammar, six-angle render, provenance, the `?forge=remote` contract | `/api/forge` with Codex, both gates outside the run, coals and the scuttle, the house-slot grammar, the ritual VFX |
| Twitch physics | EventSub for each beat (Affiliate channel) | Raid, festival, Duskwyrm, gift cart, fireworks, walls | Goal banner, parcels, name fireworks, emote balloon, the train, decree → build, the door shutting on a timeout |
| Tavern | Prediction write-back; a real prompted game | Exterior and modal only | Walkable voxel interior, painterly interior pass, table miniatures, push-in to board styles, prompt-a-game at a table, Crown vs Crowd (chess.js) |
| Campfire | Real people in voice | — | Scene, seating, Dusk Court lite, LiveKit, voice-driven animation, narrator TTS |
| The road | Start a Raid on a real channel | Raid choreography; e-atlas zoom (a separate PixiJS app) | Raid Gate, a matched 3D → Atlas transition, the procession, road drawing, a receiving kingdom |
| Emotes everywhere | Get Channel Emotes on the partner channel | Palette snap, `.vox` import | Extrusion with bevel, animated flipbooks, statue/banner/firework/bubble placements |
| Progression montage: home grows | Growth model (clocks, tiers), the grow ceremony on a real plot | Hearth/Tide tier homes (5 tiers × 3 styles) | Tier stages driven by presence/streaks/tenure, the ceremony, the crier line (briefs/0034) |
| Progression montage: town levels | Civic levels from community presence | Civic props, market wares, tavern exterior | Levels per civic place visible in the world, chat announcement |
| Progression montage: keepsake + card shelf | Keepsakes from a real moment | Citizen card lane (19) | Shelf, streak flame, next-growth hint on the card |
| Chronicle time-lapse | The kingdom's own record replayed in-engine; SIMULATED weeks of seeded history | Event log in Postgres (realm) | Chronicle view (scrub, pause), seeded history, the 2-second sweep framing |
| Rewarded for showing up | Get Chatters (lurkers), presence ledger | Lantern presence, Hearth on the fake feed | Real presence ticks, the first-light chest, the streak flame on the door |
| Unique forges | Style kit at Genesis | The grammar's palettes and motifs | Per-kingdom kits (palette, emote motifs, native material, shape language); a second kingdom for the contrast shot |
| Bits spectacles | Cheers on an Affiliate channel | Fireworks, Duskwyrm | Threshold settings, emote-shaped fireworks, meteor shower, beast flyover, the Hype Train as a train |
| Raid train | A real chain of raids, or SIMULATED | — | The train on the Atlas rails, carriages per stop, named lines |
| The season board | SIMULATED season (no season will have run) | e-atlas regions | Brackets, Splendour, crowns on regions, the crowning beat |
| Voices | Tobias recorded; campfire players live | — | The ElevenLabs narrator voice; Voice of the Realm in the product (§6 step 9) |
| Built with Codex | The build happening in `chatdom-main` | The earlier build spec | The thread itself, exports, stats, a time-lapse capture |
| Every shot | Real-GPU look and motion | Stills at roughly 60–70% of trailer quality, never seen at 60 fps | GPU validation; horizon and world edge; avatar framing; terrace risers; gate and wall stone; Duskwyrm motion |

**People the film needs:**
- a real Affiliate partner streamer with a real community
- a second streamer to raid
- eight viewers for the campfire
- about thirty real chatters for the live beats
- consent from everyone shown

## 6. The studio: the AI-steered pipeline that shoots the film

```
screenplay (YAML)
   │
   ▼
event sources ── real EventSub ─┐
               ─ Twitch CLI ────┼──▶ kingdom server ──▶ event log
               ─ the Chorus ────┘                          │
                                                           ▼
director (shot plan) ──────────────────────────▶ film-mode renderer (replay, fixed timestep, 4K)
                                                           │
                                                           ▼
                        editor (EDL, score, captions, Twitch insets) ──▶ dailies critic ──▶ master + cutdowns
```

1. **The screenplay is data.** Each scene in `film/scenes/*.yaml` holds:
   - a world seed and starting snapshot
   - a timeline of WorldEvents, or "wait for real" markers
   - the Chorus mood
   - caption text
   - intents such as "hero: cozy_otter's roof" or "climax: the wyrm falls"

   Codex drafts the scenes from §4.2.
2. **Three sources, one ingest.**
   - Real EventSub from the partner channels, for the hero beats.
   - Twitch CLI `event trigger` and the mock EventSub WebSocket, for repeatable beats (labelled).
   - The Chorus.
3. **The Chorus is a synthetic crowd.**
   - It runs on a small, fast model with personas: tenure, sub status, emote habits, typing speed, in-jokes.
   - Each persona reacts to the beat stream in context ("OTTER NO WAY" after the forge).
   - It writes only to the in-world chat and the film's chat overlay. It never posts to real Twitch, because mass fake
     accounts break Twitch's rules and the hackathon's "function as depicted".
   - On screen it is labelled SIMULATED.
4. **Record once, shoot forever.**
   - The world is an event log run through a deterministic reducer with `ctx.rng` (docs/07 §1.1), so a live session
     replays exactly.
   - Film mode advances simulated time by exactly 1/60 s per frame, however long the frame takes. The replay can
     render at 4K with every quality setting at maximum (shadows, bloom, accumulated motion blur, depth of field) at
     2 fps and still produce perfect 60 fps footage.
   - Capture uses WebCodecs `VideoEncoder`, or PNG frames to ffmpeg.
   - Reshoots never need the streamer again.
5. **The director turns beats into shots.**
   - **In:** the beat stream (level, drama score, focus) plus the screenplay's intents.
   - **Out:** a shot list as data: rig, path, lens, duration, transition.
   - **Shot vocabulary:** establishing crane, push-in through a door, orbit, over-the-shoulder, insert close-up, whip
     pan, rise-to-map.
   - **Rules in code:** cut on beats, hold climaxes, keep the 180° rule, never show a secret (09 §3).
   - **Choosing:** a model proposes three candidate shots per beat. Each is rendered as a thumbnail strip, and a
     vision model scores composition and picks one.
   - **Base to build on:** the existing OBS director (`src/systems/director.ts`) and `camera.play`.
6. **The editor assembles the cut.**
   - It builds an EDL from the shot list and snaps cuts to the score's beat grid.
   - It burns in captions and composites Twitch insets from real OBS captures of the Twitch page.
   - It adds the LIVE and SIMULATED bugs, and sound design: the forge hammer, the crowd, the fire.
   - **Outputs:** a 2:58 16:9 master, 60 s and 30 s cuts, and 9:16 versions.
7. **Dailies.** A vision model watches each render and lists problems with timecodes: blown highlights, z-fighting, a
   UI glitch, an avatar clipping a wall, a caption over a face, a dead second. Fix the problem and re-render only that
   scene.
8. **The score is original.** One score that grows the way the kingdom's music does (world §3.13: lute, then strings,
   then choir), commissioned or generated with a tool whose licence allows it. Keep the receipt.
9. **The voices.**
   - **The Narrator** is an ElevenLabs voice designed for Chatdom (Voice Design), or a Voice Library voice whose licence
     covers commercial use.
     - The sound to aim for is deep, warm and a little weathered: a storyteller at a fire, not a parody of a movie
       trailer.
     - Never use a clone or soundalike of a real actor.
     - Generate three to five takes per line and choose by ear.
   - **Tobias** records his chapters for real, over the real footage. An ElevenLabs clone of his own voice is used only
     to patch a pickup line, if one is needed.
   - **Lines and timing.** Lines come from the screenplay and go through text-to-speech with timestamps. ElevenLabs
     returns character-level alignment, so captions are timed from it and the editor snaps cuts to the ends of lines
     as well as to the score's beats. The music ducks under each voice.
   - **Sound effects** (forge hammer, dragon roar, crowd, fire crackle) are generated with ElevenLabs sound effects or
     recorded.
   - **The voice is also a product feature.** The narrator becomes the **Voice of the Realm**: it sings the Ballad of
     Tonight, narrates the campfire, calls as the crier and reads the season crowning. The trailer voice is the one
     streamers will actually hear on stream.

The pipeline stays ours, for the film. Chatdom makes no video of its own; its Chronicles keep the director's stills
(§3.8).

## 7. Decisions for the founder

1. **The entry.** Is Chatdom's kingdom the submission? The earlier build spec (§12), the README and docs 02/03 still say ezpug.
2. **Lanterns.** Keep "your light is on while you are in chat" as the mechanic and the hero shot. Drop
   Lanternmere/Lumi/lanterns as the brand: each kingdom names itself at Genesis, and its lights can be lanterns,
   windows, candles or torches depending on the biome. Lanternmere has about 400 references to rename; the reducer is
   unaffected.
3. **The six exceptions in §2:**
   - instant forging for house parts
   - barter swaps whose items travel
   - founding size from channel numbers
   - painted interiors
   - campfire voice
   - free voxel building on your own plot
4. **Partner channels.** The film needs a real streamer with a community, a second streamer to raid, and viewers who
   agree to be shown. Who? Since Monetization for All (13 May 2026), subs, cheers, channel points, polls and
   predictions no longer need Affiliate. Ads, charity and Bits in the panel still do, and Twitch's pages disagree on
   Hype Trains below Affiliate, so an Affiliate partner is still the safer choice.
5. **The truth line.**
   - **Real:** the Twitch consent screen, go-live, chat, the Forge, the citizen card and the raid.
   - **Simulated and labelled:** the triptych, crowd scale and the Chorus.
6. **Codex compliance.** The build the film shows has to happen in the `chatdom-main` Codex thread. Re-implement
   Lanternmere there, using f-lanternmere as the reference.
7. **The narrator's voice.** Design three candidate voices and record the cold open with each. Choose with fresh ears,
   then keep that voice for both the film and the Voice of the Realm.
8. **One league table.** Set a single set of size brackets for founding size, leagues and balance. The docs currently
   use three different sets.
9. **The founder's on-camera presence.** The script uses Tobias's voice only. A five-second face shot in Built with
   Codex would add authenticity, at the cost of screen time.
