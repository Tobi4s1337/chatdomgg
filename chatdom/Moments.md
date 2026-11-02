# Signature moments

The experiences that make Chatdom feel like Chatdom: how a channel becomes a place, the citizen card, the Forge
ritual, the tavern, the campfire, Twitch both ways, the Raid Gate and the Atlas road, Chronicles, emotes everywhere,
forges unique to a community, rewards for showing up, spectacles, seasons, and making your home your own.
Where a topic file (`ChatDom.md`, `World-Tree.md`, `Twitch.md`, `Monarch.md`, `Safety.md`, `Atlas.md`, `Tech.md`)
or its Decided list says something different, that file wins.

## 1. Kingdom Genesis: your channel, as a place

The streamer clicks Connect with Twitch. Chatdom reads what Helix exposes about the channel. Codex turns it into a
charter: data fields from fixed lists, never code. The generators then build the kingdom from the charter.

| Channel data | Becomes |
|---|---|
| Channel emotes (Get Channel Emotes) | Voxelised plaza statues, weathervanes, banner charges and stained glass: palette-snapped, extruded 2–6 voxels deep. The palette snap and `.vox` import already exist (d-voxel-diorama, the f-lanternmere `.vox` upload). The channel's own emotes as monuments is the most Twitch-specific image in the product. |
| Profile image and name colour | Crest and banner colours; e-atlas `src/world/heraldry.ts` draws the coat of arms |
| Category and schedule | Biome mix and landmarks: a Celeste streamer gets a mountain, a Stardew streamer farmland, a horror streamer fog and a crooked chapel |
| Description and panels | Name suggestions, a motto and founding lore; the streamer picks |
| Followers, subscribers, average viewers | Founding tier and plot count (table below). Everyone gets a place by tenure on day one: the follow year sets the tenure quarter, and sub months count toward the street within it (§2, `chatdom/Twitch.md` §5). |

**Founding size.** The numbers are placeholders; the shape is the point.

| Community at founding | Tier | Plots | What it feels like |
|---|---|---|---|
| Fewer than 5 average viewers | Hamlet | 16, plus one tavern table | Everyone has a home and the whole chat fits round one table. Named NPC townsfolk keep it alive between viewers, so it is never an empty map. |
| 5–50 | Village | 64 (one ward) | A green, a pier, a market cart |
| 50–500 | Town | 128–256 | Tenure quarters, Old Row, a market square |
| 500–5,000 | City | 4–12 wards | Districts and a cathedral site |
| Above 5,000 | Capital | 12–40 wards | Homes by tenure and lottery; everyone else present is a light on the walls and in the sky. The crowd is represented, never simulated (docs/07). |

After founding, wards unlock from active citizens only. A bought follower count does not keep paying.

**Founding, live.** Genesis runs only live, on the streamer's own stream at their press, with no private
draft (founder decision, `chatdom/Monarch.md` §5.2). Chat votes the name; the charter draws itself as an inked
parchment map in the Atlas look. Then the ink lines rise into voxel terrain, the river cuts, the castle assembles and
the emote statues extrude. This takes about 15 s. The director keeps stills of it for the kingdom's first Chronicle.
Chatdom makes no founding video and never creates clips on Twitch (founder decision).

## 2. The citizen card, and tenure as architecture

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

## 3. The Forge ritual

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

**Update from `chatdom/Tech.md` (2026-10-29):** the founder chose Codex for every piece of magic, so the whole Forge
is one Codex run (plan, assembly and the render check as tool calls), targeted at 15 to 30 s. The ritual's stages
follow the run's tool calls. Later the same day,
`chatdom/Safety.md` §4.2 moved both gates outside the run: the spell runtime calls the judges before and after it,
never the agent.

**Refusals are part of the show, nameless.** On stream the forge coughs soot and sulks, with a line from one shared
pool, the same for every kind of refusal. It never shows or hints at the words or the maker, and at most one refusal
beat airs every 10 minutes (`chatdom/Safety.md` §5.3). Only the maker hears why ("The Forge only shapes things for
homes").

**Streamer control.** The streamer keeps an unforge key and can switch the channel to approval mode. The forge burns
only while the stream is live, and each forge takes a coal: one for each stream night a citizen is there
(`chatdom/Safety.md` §3.2).

**Copies.** Others can commission a copy of a popular piece, for a coal. The copy keeps the original's name and
lineage: "first forged by cozy_otter, now on 212 homes in 9 kingdoms".

**Using Luna.** Testing found that Luna at low effort skipped tool use (`docs/research/codex-leverage.md` §3). So
the binding gates are direct calls outside the run: give Luna the text and images inline on the Decisions API, ask a
fixed set of questions, and give it no tools (`chatdom/Safety.md` §4).

## 4. The tavern: a place, with tables that are games

Revised 2026-10-29. The founder wants the tavern to be a real place you enter and share with other players, with
tables where you join games, or request them by prompting. That replaces the painted-backdrop idea. The full art
direction is in `chatdom/Artstyle-Soul-Feel.md` §10.

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

## 5. The campfire

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
- Seats go by streamer invite or by lottery among trust tier 1 (30+ days followed, `chatdom/Tech.md` §10.6).
- Push-to-talk, and the streamer can mute or unseat anyone.
- Nothing is recorded beyond the broadcast, which is already public, as with Guest Star.

Everyone else keeps text, as social §3.15 wants.

**The same rig, later:** the Royal Audience in the throne room. A viewer redeems, steps onto the dais and talks to the
streamer for 30 s, on stream.

## 6. Twitch, both ways

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
| Goals | `channel.goal.*` | A great banner woven in the plaza, a stripe for each step; a goal never fills a wonder (`chatdom/Twitch.md` §7) |
| Poll | `channel.poll.*` | A royal decree, and the winning option gets built |
| Prediction | `channel.prediction.*` | An odds board in the Tavern; the outcome lights up on the table |
| Incoming raid | `channel.raid` | A caravan under the raider's banner and colours, carrying lanterns and cloth |
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
goals beyond follower goals and Bits in Extensions are not.

## 7. The Raid Gate and the Atlas road

**The raid out.** At the end of a stream, the streamer walks to the gate and picks a kingdom on the Atlas. Opening the
gate calls Start a Raid. The citizens who are present follow the streamer out, across the bridge and onto the road.
The camera rises from the 3D world into the Atlas and follows the procession along an inked road to the other
kingdom. Its gates open as the raid lands on Twitch.

**The Atlas draws Twitch's real social graph.** Every raid leaves a road, every Shared Chat session a bridge, and
every swap a trade route. This also settles Atlas placement: the docs noted follower graphs are not public, but the
raids we observe are ours to draw.

**When the target is not on Chatdom,** the road ends at an unclaimed region carrying that channel's name. That is
"settlers before kings" (docs/04 §3.1).

**The map uses real data** (`Atlas.md` §10): as much real Surveyor data as there is, labelled with its date:
live kingdoms blooming in vermilion wash on a day map, with their pennants, and real raid roads.
The Atlas has no night. Staged moments, such as a raid train, stay on private `/-/` benches with internal
`simulated` provenance and no visible simulation chip. They never enter the real map or its roads feed.

## 8. Chronicles: the director as a product

The director that frames the stream also keeps the night, in stills only (founder decision: Chatdom makes no video of
its own, so no recaps). After every stream, it produces:

- **The night's chapter**: the Ballad of Tonight and the night's beats, in words and stills.
- **Director stills** of each climax, hung in the Gallery. The kingdom never makes Twitch clips (founder decision).
- **A personal card for every citizen**, with a share link: "your night in lumi's kingdom", covering your forge, your
  fight, and your seat at the fire.

Small streamers get an illustrated record of every night, and share cards their viewers can post. Discovery is the growth problem they actually
have, and this is the Impact story.

## 9. Emotes everywhere, automatically

Channel emotes have already passed Twitch's emote rules as flat images at chat size. A 4 m statue is a new object, so
the streamer confirms each statue and the extruded version passes Luna before its unveiling (`chatdom/Safety.md` §6,
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
| Stained glass, weathervanes, door knockers, chimney smoke | Motifs in the Forge (§10) |
| Chat bubbles | Emotes drawn inline over the avatar |
| Emote weather | When chat spams an emote, it rains over the town as voxel confetti (crowd-scale social, social §3.12) |
| Fireworks | Cheers burst into the shape of an emote |
| Gigantify an Emote | The parade balloon over the castle |
| Gestures | A message that is only an emote pops that emote above your avatar's head |

Emotes from 7TV, BTTV and FFZ can come in through those services' public APIs as a streamer option. They need our own
check first, because Twitch has not reviewed them.

## 10. Forge items unique to your community

At Genesis, Codex writes each kingdom a **style kit**. It picks from fixed lists only:
- **a palette**, from the channel's colours
- **motifs**, from the channel's emotes
- **a native material**, from the biome: summit crystal for the Celeste mountain, bog iron for the horror fog
- **a shape language**: round and cosy, crystal and angular, gothic, or driftwood

The Forge draws on the kit, so the same prompt gives two different items in two kingdoms. A dragon chimney forged in
lumi's kingdom is lilac and blows heart-shaped smoke. In HexHeroes' kingdom the same prompt comes out hex-crystal blue.

This gives trading and raids their meaning. Items are recognisably from somewhere. The only way to get a lumi-heart
lantern into another kingdom is to be given one, or to swap for one, on a raid.

## 11. Show up, get rewarded

- **Presence pays.** Every minute in chat earns materials (Hearth, 1 a minute, through `presence.tick`; 09 §2.11).
- **Lurkers count.** Get Chatters (`moderator:read:chatters`) lists everyone with chat open, whether they type or
  not. A lurker's light burns and they earn like everyone else.
- **First light.** A small chest on your first minute of each stream.
- **Streaks.** A flame over your door grows with consecutive streams. Your best streak is kept forever (progression
  §3).
- **Tenure.** Follow milestones unlock house pieces, such as carved doorstep stones, that cannot be bought. Sub months
  add ribbons, never tenure pieces.
- **The rule.** Rewards for showing up never depend on money. This is the source-class ledger rule (09 §3).

## 12. Spectacles: Bits, trains and raid trains

**Cheers.** The streamer sets thresholds, the way alert boxes work. The Bits go to the streamer as they always do.

| Cheer | Spectacle |
|---|---|
| 100 | Fireworks bursting into the channel's emotes |
| 500 | A meteor shower; chat makes `!wish`es |
| 1,000 | The kingdom's great beast (the Hearthbeast, pets §3.11) flies low over the town |
| 5,000 | Skyfire: an aurora and a firework procession around the walls |

The dragon is earned only: the Hype Train or the Wyrm Bell wakes it, never a cheer (founder decision).

These are reactions to ordinary cheers. The Lantern Fair Bits menu is dropped; the panel's shelf offers chosen moments
and things that last one day (`chatdom/Twitch.md` §17).

**The Hype Train** is a steam train circling the town. Each level adds carriages, and level 3 brings the dragon.

**The raid train** is a Twitch tradition: a chain of streamers raiding each other in sequence. In Chatdom it becomes
a literal train on the Atlas:
- It stops at each kingdom on the route, and each stop adds a carriage under that kingdom's banner.
- When it ends, the route stays on the map as a named line: "the Autumn Raid Train, 7 kingdoms".

## 13. The race for the most epic kingdom

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

## 14. Make it yours: the wardrobe and build mode

**The wardrobe** (items §3.5–3.6):
- **Pieces, never full skins:** silhouettes, hair, garb and dyes. The defaults come from Twitch: name colour for the
  cloak, sub-badge colour for the trim.
- **Unlocks** come from showing up, tenure, events and games:
  - the Twelve-Moon Hood at 12 months subscribed
  - a scale cape from the Duskwyrm
  - a season crown

  Each piece's card says how it was earned. Nothing that glows can be bought: "light is earned, never bought".
- **The kingdom's style kit** (§10) adds local pieces, such as clasps and patterns drawn from the channel's emotes.

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

## Decided on 2026-11-02

- **2026-11-02 — Founder raid-show decisions 25 and 45.** Incoming caravans carry banners, lanterns and cloth; there is no raid tribute. Staged fixtures stay on private `/-/` benches, retain internal simulated provenance and never enter live feeds. No visible SIMULATED chip is required or shown.
