# Atlas

The map of Twitch: what it is for, what you see, what is alive on it, how you move through it and into a kingdom,
and how it is made. Internal. Started 2026-10-29.

Unlike `ChatDom.md`, this file combines vision, look, interaction, data and tech. It is derived from `ChatDom.md`
(above all §7), `Artstyle-Soul-Feel.md`, `Quality.md` and `Tech.md`. When it disagrees with `ChatDom.md`, the
blueprint wins. It is the Atlas's source of truth, and supersedes the Atlas parts of `docs/11`, `docs/12`, `Tech.md`
§6.8 and §8.5, and `Artstyle-Soul-Feel.md` §12. Section 11 says what it keeps from each and what it changes.
`World-Tree.md` and `Twitch.md` say what happens inside a kingdom; this file says what shows on the map.

The evidence:
- `docs/11-atlas-map-of-twitch.md`, `docs/12-atlas-lean-spec.md` and the three Atlas reports in `docs/research/`
- the `e-atlas` prototype (`prototyping/kingdoms/e-atlas`)
- the Surveyor (`prototyping/kingdoms/g-atlas-live/surveyor`), collecting real Twitch data since 2026-10-29 15:44 UTC

Numbers marked "measured" come from a read-only copy of the Surveyor's database at 16:35 UTC on Thursday 29 October:
its first 51 minutes, in the European evening and the American midday. Every other number is an estimate.

## 1. What the Atlas is

**The Atlas is a drawn map of every Twitch community, and the front door to every kingdom.**

It looks like an old explorer's map: ink coasts, watercolour washes, stamped mountains, heraldic shields, a sea
monster in the corner. Every channel with an audience has land. Continents are languages, and realms are the games
people play. A live kingdom blooms in vermilion wash and hoists its pennant. Raids set out as caravans and leave roads.
Click a kingdom and its drawing comes alive as the voxel kingdom itself.

| Job | What it means | Blueprint |
|---|---|---|
| Discovery | Find communities by travelling: follow a road, visit a neighbour, arrive with a raid and like it there | §7 |
| Travel | Go from one kingdom to another; raids ride out along roads | Principle 13; §10 item 7 |
| Pride | See your kingdom on the map of Twitch: its size, its life, its roads, its crowns | §4; §6 (a year) |
| The map of Twitch | A living picture of how communities connect, drawn from what they actually do | §7 |

**What changed on 2026-10-29: the Atlas is not a minimap.** The `e-atlas` prototype zoomed from the continent to a
town plan, to painted street vignettes, down to your own plot. The founder has ruled that out. The Atlas now stops at
a drawing of each kingdom: its emblem, its size, its life, its character. Below that is the real voxel kingdom.

What the founder loved in `e-atlas` stays: the explorer's map look, the heraldry and the smooth zoom. The night map
designed in `docs/11` and `docs/12` is dropped: the Atlas is a day map, and time of day lives inside the kingdoms
(§4.5, decided 2026-10-29 after the study in `docs/research/atlas-liveness/`).

## 2. Principles

**1. A drawing of each kingdom, never a minimap.**
- **Why:** the kingdom is where you live; the map is how you find it. A flat copy of every street would compete with
  the world, need a tile pyramid for every kingdom, and show homes to people who never visit.
- **So:**
  - The deepest zoom shows a kingdom as a picture: emblem, size, life and character.
  - Plots, streets, citizens' names and anyone's position never appear on the Atlas.

**2. Every live mark is real.**
- **Why:** a fake crowd is on the never list (`ChatDom.md` §9), and principle 17 says to show what is real and say
  plainly when something is simulated.
- **So:**
  - Every wash, pennant, caravan, road, bridge and firework is a real state or event.
  - Decoration (clouds, sea shimmer, ships, the sea monster) never travels between kingdoms, so it can never be
    mistaken for a raid. Ships stay in open water.
  - When data is late, the map says so ("Live as of 21:14") and holds still. It never fills a gap.
  - Replays carry their date. Anything simulated carries SIMULATED.

**3. The land never moves.**
- **Why:** a kingdom's place is part of its identity. Borders that shift teach people the map means nothing.
- **So:** the land is founded once per edition and frozen; a channel settles once and keeps its holding; a new
  edition is rare and announced (`docs/12` §3).

**4. Found by being lovely, not by being big.**
- **Why:** `ChatDom.md` §7 and principles 9 and 14. A map ranked by audience is a leaderboard with coastlines.
- **So:**
  - Audience sets how large a kingdom is drawn and from which zoom its name shows. It never decides what the Atlas
    recommends.
  - Recommendations (the front page, the raid finder, roads to follow) rank by loveliness and life, with size evened
    out.
  - Live marks come in five size classes (§5.1), so a hamlet's mark reads and a capital never blows out.
  - Money never touches placement, size, live marks, labels, rank or crowns. Money never draws the map (`Twitch.md`
    principle 3).

**5. Channels in public; a person on their own card.**
- **Why:** Twitch closed every open audience list on purpose (`docs/11` §1), and a map of who goes where can be used
  to follow people across communities. A home has to be safe to be a home (principle 15). The founder made homes and
  the passport a public, creative part of Chatdom (2026-10-29), so the line runs through the citizen card.
- **So:**
  - Anything about a channel is public: land, live state, roads, bridges, raid trains, crowns.
  - A person's homes (at most 3) and passport show on their citizen card, and nowhere else. The passport has a
    "hide my travels" switch.
  - The Atlas never lists or searches people, and never draws anyone's homes or travels for others to browse.
  - Where someone is right now shows only to friends who both opted in. Twitch follows are never public.
  - Any public figure derived from people needs at least 20 distinct people behind it, shown as a band.

**6. A zoom costs Twitch and the game servers nothing.**
- **Why:** the app shares one Helix bucket (800 points a minute) and one EventSub budget (10,000), and the game
  servers belong to the players (`Tech.md` §6.8).
- **So:** the map is static files plus one live feed from our own service. Kingdoms send a pulse. The Atlas never
  joins a room and never calls Twitch from the browser.

**7. The map remembers.**
- **Why:** nothing is lost (principle 5), and a year on "the roads it left on the map lead to a dozen friends".
- **So:** an unused road fades to a faint dotted line and never disappears; crowns and named lines are permanent; a
  kingdom that goes quiet keeps its land.

## 3. Who uses it

One person can be monarch of one kingdom, citizen of up to 3 others and a visitor anywhere else. The Atlas shows each
role at its own kingdom and never merges them. Royal powers act only in your own kingdom (`World-Tree.md` rule 9,
`Twitch.md` §12).

| Who | Why they open it | What they see first | What they can do |
|---|---|---|---|
| The curious visitor, signed out | "What is this?", from a share card or the front page | The whole map, live kingdoms washed in vermilion, with the legend and the front-page notices | Search, zoom, open cards, watch on Twitch. Entering asks them to sign in |
| The citizen | Go home, see who is live, follow a road | Their home kingdom, centred, with its mark | Enter home in one click, travel roads, open their passport |
| The citizen of several kingdoms | Choose where to go tonight | Each of their homes (at most 3) marked; a "Your homes" ribbon, live ones first | One click to any home |
| The monarch, perhaps a citizen elsewhere | Pride; choose a raid; see the roads their kingdom left | Their realm with a crown ring; their homes elsewhere marked as homes | Enter as monarch at home, as a citizen elsewhere; open the throne; the Raid Gate while live; set the card's notice; hide from the Atlas |
| The raider arriving | Arrive with their community | The road from their kingdom to this one, as their loading moment (§7.5) | Arrive at the gate as a guest |
| The tourist | Wander | Roads from where they are, the front page | Visit any founded kingdom as a guest |
| The moderator | Look after their kingdom's public face | Their kingdom's card | Report names and labels to Chatdom's team. Royal acts, the card's notice and hiding from the Atlas stay with the streamer (`Monarch.md`) |

The watcher on stream never opens the Atlas, but sees it in the director's shots (§7.8).

## 4. What you see

### 4.1 The land

The shape comes from `docs/12` §3, unchanged:
- **Continents are languages,** from each stream's `language`. A language with 600 or more kingdoms gets a
  continent; smaller ones share the Isles of Many Tongues, one island each.
- **Realms are families of games,** about 14 (shooters, roleplay, Just Chatting and IRL, creative and music, and so
  on), from a hand-checked `families.json`.
- **The Crossroads** at each continent's heart holds variety channels. **The Wilds** hold families too small for a
  realm. **The Outer Isles** take overflow. Named seas lie between continents.

What the data says (measured):
- 9,789 channels already count as kingdoms (25 or more average viewers), in 32 languages.
- English holds 40%, Russian 16%, German 9%, French and Japanese 6% each, Portuguese 5%, Spanish and Chinese about 4%
  each, then Italian and Polish at 1.5%. So the first edition has about 8 continents and about 20 islands.
- English will be a supercontinent, 40 to 50% of the land once the American evening counts, with realms as big as
  other continents. That is true to Twitch, and the map should show it.
- Kingdoms' main categories span 1,012 games, and the top 150 cover 83% of kingdoms. Any unmapped game goes to its
  continent's Wilds.

### 4.2 Holdings, tiers and zoom

A kingdom stands on a holding: a fixed plot of land sized by its tier when it settles.

| Tier | Average viewers | Kingdoms so far (measured) | Name shows from |
|---|---|---|---|
| Capital | 5,000 and over | 50 | World zoom |
| City | 500 to 4,999 | 769 | Continent zoom |
| Town | 50 to 499 | 5,030 | Realm zoom |
| Village | 25 to 49 | 3,940 | Kingdom zoom |
| Hamlet (new) | Under 25 | Founded kingdoms only, for now | Kingdom zoom |

The hamlet tier is new. Most Chatdom kingdoms will be small, and `docs/12` gave them no land. A hamlet takes a slot
in its realm's waiting land, near its raid ties. Slots are a fine, deterministic grid designed into each edition, so
there is room for hundreds of thousands without moving a border (§8.2). Founded, active kingdoms show their name one
zoom level earlier than their tier, and in colour ("life lifts labels", decided 2026-10-29). A kingdom that outgrows
its holding grows in place: its drawing and label may grow up to one tier past the holding, and the holding never
changes (decided 2026-10-29).

| Zoom | What you see |
|---|---|
| World | Continents and seas, capitals' shields, the vermilion wash wherever Twitch is live |
| Continent | Realm names, cities, the busiest roads and sea lanes |
| Realm | Towns, roads with 3 or more raids, raid trains; pennants appear and the wash softens |
| Kingdom | Villages and hamlets, every road in view, founded kingdoms drawn in full |

Zoom stops at kingdom level, where a founded town's drawing is about 400 pixels wide on a laptop.

### 4.3 Pencil, ink and colour

How a place is drawn says how much of it has joined Chatdom. This replaces `docs/11`'s three grades of knowledge,
which were about how well a channel was placed. On frozen land placement no longer improves; joining still changes
everything.

| Drawn in | What | How |
|---|---|---|
| Pencil | Waiting land: empty holdings and hamlet slots, and live channels below the threshold (5 to 24 viewers) | Graphite hatching and quiet fields; a small live channel is an unnamed dab of wash from afar and a pencil flag up close |
| Ink | Mapped channels: settled from public data, not founded | A town stamp by tier, a shield of two tinctures seeded from the channel ID, the channel's name |
| Colour | Founded kingdoms | Drawn from life (§4.4): full arms, a banner with the channel's emote, a wash in its colours |

Founding shows from across the map: the ink stamp on the hill becomes a coloured drawing of the real kingdom.

### 4.4 How a founded kingdom is drawn

Old maps drew a city as a small bird's-eye picture, never a plan. So does the Atlas. A founded kingdom is a town
view: the real kingdom drawn from its hero angle (`Artstyle-Soul-Feel.md` §13) in ink and wash.

| On the drawing | From the real kingdom |
|---|---|
| Silhouette: castle, walls, roofs, towers, the lake | The voxel kingdom, rendered from its hero angle through an ink pass (§8.5) |
| Size | Its real wards and homes, drawn into its holding |
| Colours | Its colours as the wash on roofs and banners; its biome tints the land around it |
| Emblem | Its arms on a shield above the town; its emote on the banner |
| Wonders and landmarks | What really stands there: the cathedral the chat built, the crooked bell tower |
| Live | Its pennant hoisted on the standard above its shield, the vermilion wash beneath (§5.1) |
| Glory | Season crowns on the shield; the Kingdom of the Week ribbon |
| Life | Ink smoke from the chimneys baked with the drawing while people are home; one spectacle mark at a time (§5.5) |

Never on the drawing: plots, citizens' names, who is where, interiors.

The drawing is remade when the skyline changes (a wonder finished, a ward opened, a new season), at most once a day.
So "does it leave something on the map?" (`ChatDom.md` §12) is literal: the tower the chat finished tonight is on the
map tomorrow. Drawn from life was decided on 2026-10-29. Until a kingdom's first drawing passes the beauty check, it
uses one composed from stamps.

### 4.5 One hour, seasons and crowns

- **The Atlas has no night** (decided 2026-10-29). The parchment never darkens. Time of day lives inside the
  kingdoms, where dusk and night are the signature hours.
  - Ink and watercolour can only darken paper, so a glowing light has no place in the medium. A darkened map also
    leaves labels in pale halos and turns washes muddy (the study in `docs/research/atlas-liveness/`).
  - "Warm light is people" (`Artstyle-Soul-Feel.md` §2) becomes warm pigment on the map: the vermilion wash.
- **Seasons:** the paper follows Chatdom's season, subtly. Washes warm in autumn; frost edges the coasts in winter.
- **Crowns:** at a season's end each league bracket's winner gets a small gold crown on its shield, forever. Crowns
  settle one by one across the map while the Voice of the Realm reads the citations.
- **The season board:** a scroll on the map. Choosing a bracket fades all but its kingdoms, which stand out across every
  continent: a hamlet in the Isles beside a capital in the Marches.

The map at realm zoom, signed in, with a card open (`~` is the vermilion wash, `^` a pennant, `o` a small live
channel):

```
┌─ THE ATLAS OF KINGDOMS ─────────── [ Find a kingdom or channel ] ────────────────────┐
│ Edition I · 24,800 kingdoms · 9,100 live            Your homes: Lanternmere (live)   │
│                                                                Pugmire · Oakfell     │
│  ~ ~ the Quiet Sea ~ ~           THE HEARTHLANDS                                     │
│        o          ^     [arms] Lanternmere (key)        o                            │
│   o     ~~~~             ~~~~\                                                       │
│      THE SHOOTER              \=== HexHeroes' raid · 412 ===>  ^[arms] Pugmire       │
│      MARCHES           o       \                               ~~~~                  │
│          o   ,,,,, waiting ,,,,,         ┌──────────────────────────────────────┐    │
│                                          │ [seal] Lanternmere                   │    │
│  (compass)                               │ lumi · The Hearthlands · Town        │    │
│                                          │ Live: Stardew Valley · 212 lights    │    │
│                                          │ Roads: HexHeroes 7 · Pugmire 3       │    │
│  Vermilion wash: live now.               │ You live here, on Old Row            │    │
│  Roads are real raids.                   │ [ Enter the kingdom ] [ Watch ]      │    │
│  Live from Twitch, 21:14.                └──────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## 5. What is alive

### 5.1 The live signals

**How live shows: paint and pennants** (decided 2026-10-29). Every live mark comes in five size classes, the way
old map legends and star charts grade size, so nothing grows without limit:

| Class | Average viewers | From afar (world, continent) | Up close (realm, kingdom) |
|---|---|---|---|
| 1 | 5,000 and over | The largest vermilion bloom | A long pennant and a second one below it |
| 2 | 500 to 4,999 | A large bloom | A long pennant |
| 3 | 50 to 499 | A medium bloom | A medium pennant |
| 4 | 25 to 49 | A small bloom | A short pennant |
| 5 | 5 to 24 (small live channels) | A dab of wash, unnamed | A pencil flag on waiting land, named on hover |

- The wash blooms in when a stream starts and dries away when it ends. At world zoom it is one painted density
  layer, not thousands of stamps. Paint multiplies, so overlaps deepen towards the pigment and stop there.
- Up close the wash softens and the pennant is hoisted on the kingdom's standard, above its shield. Offline, the
  standard stands bare.
- Mockups: `docs/research/atlas-liveness/`.

| Signal | Source | For whom | Delay | On the map |
|---|---|---|---|---|
| Live or offline | Get Streams every 3 minutes; `stream.online` and `.offline` for founded kingdoms | Every mapped and founded channel | Up to 3 minutes; seconds when founded | Wash and pennant, by size class |
| Small live channels (5 to 24 viewers) | The same sweep | Every channel the sweep sees | Up to 3 minutes | A dab from afar, a pencil flag up close |
| Lights lit, walkers | The KingdomRoom pulse, every 10 s | Founded | 10 to 30 s | The number on the card; ink smoke from the drawing's chimneys while people are home |
| A raid | EventSub `channel.raid` | Raids out of live kingdoms; any raid into a founded kingdom | Under 10 s | A caravan, then a road |
| A raid train | Derived from raids (§5.3) | The same | At the third raid | A named line |
| A shared chat | `channel.shared_chat.begin` and `.end` | Founded kingdoms (§5.4) | Seconds | A bridge |
| A shoutout | Tier 3 signposts (`Twitch.md` §9) | Founded | Seconds | A small signpost on the road, at kingdom zoom. It never draws a road by itself |
| Hype Train, dragon, festival, crowning | The pulse | Founded | 10 s | One mark at a time (§5.5) |
| An embassy | Two founded kingdoms after 3 raids or a shared chat (`docs/08` social) | Founded | Daily | Each kingdom's flag at the other end of the road |
| A footpath | Visits by at least 20 distinct citizens of one kingdom to another in a season | Founded | Weekly | A thin dotted path |
| A trade route | Swaps, which happen only between kingdoms (decided 2026-10-29); at least 20 people | Founded | Weekly | A thin dashed route |

Raids, shared chats and shoutouts are acts of a channel, decided by its streamer and seen on stream, so they show in
full. Footpaths and trade routes come from people, so they follow the 20-person floor.

### 5.2 Raids, caravans and roads

- **The caravan** sets out from the raider's land under its banner, labelled "HexHeroes' raid · 412 travellers",
  and travels 12 to 30 s by distance. A soft horn sounds if it is on screen. The raid is instant on Twitch; the
  journey presents a real event, it does not invent one.
- **The road** inks itself behind the caravan. The first raid between two kingdoms draws a new road; later raids
  thicken it. A raid across languages is a sea lane with a ship.
- **Level of detail:** world zoom shows only the busiest roads, realm zoom roads with 3 or more raids, kingdom zoom
  every road in view. Selecting a kingdom brings out all its roads.
- **Old roads:** a road with no raid for a season fades to a faint dotted line. It never disappears.
- **Channels with no land** (decided 2026-10-29: show small channels now, land by raid from Edition I).
  - A small live channel already has a provisional place: its pencil flag in its realm's waiting land (§8.2).
  - A raid into it, or from it into a founded kingdom (`Twitch.md` §9), travels to or from that place.
  - Until Edition I the caravan rides but the road is not kept. From Edition I the raided channel gets a pencilled
    hamlet slot and the road stays.
  - A target the sweep does not see (under 5 viewers) is reached at the edge of the known map.

### 5.3 Raid trains

- **Detection:** 3 or more raids in a chain, each target making the next raid within 12 hours.
- **The line:** drawn like a railway, with each stop's shield. While it runs, a train rolls along it and gains a
  carriage under each stop's banner (`Moments.md` §12).
- **The name:** the Voice of the Realm names it from what it witnessed ("the Ember Line, 7 kingdoms, 2 November").
  The first kingdom's monarch may rename it. The line is permanent.
- They happen on their own: the Surveyor caught 4 chains of three in its first 51 minutes (measured).

### 5.4 Bridges

A shared chat draws a bridge while the session lasts, a ring when up to 6 kingdoms join. After it, a small bridge mark
stays on their road. Bridges are watched only for founded kingdoms, which costs nothing. The raid watch already uses
89% of the EventSub budget, so bridges for channels that have not joined wait until Twitch raises our cap (§9).

### 5.5 Spectacle, rationed

Founded kingdoms' pulses carry one spectacle code. The Atlas shows the highest:
1. a crowning
2. the dragon
3. the Hype Train, with its level (fireworks from level 3)
4. a festival
5. a raid party gathering at the gate

The pennant is not spectacle: it is simply what live looks like.

Rules:
- One mark per kingdom at a time, at realm zoom and closer.
- A mark never raises a kingdom's rank, never enters recommendations, and never makes a kingdom draw larger. Money
  never draws the map, and the dragon is earned only: no cheer can summon it on demand (decided 2026-10-29).
- Calm by default (`Artstyle-Soul-Feel.md` §2). The busiest thing on screen is a caravan.

### 5.6 How alive the map really is: the map blushes as Twitch goes live

| Measure (Surveyor, first 51 minutes) | Value |
|---|---|
| Live channels with 5 or more viewers, per sweep | 27,400 to 30,400, watched by about 2.6 million viewers |
| Channels counted as kingdoms | 9,789, of which 8,473 live |
| Raid watch | 8,886 kingdoms; EventSub cost 8,883 of 10,000 |
| Raids between kingdoms with 5 or more viewers | 233 in 43 minutes; 6 to 7 a minute once the watch was full |
| Raids from watched kingdoms that landed outside the kingdoms | 44% (183 of 416) |
| Travellers per raid | Median 78; middle half 39 to 184; 21 over 500; largest 6,869 |
| Raids within one language | 93%; 1 in 14 crosses a sea |
| Raids within the same game at that moment | 56% |
| Kingdoms ending a stream | About 33 a minute |

What that means on an ordinary night:
- **At world zoom** a caravan sets out every 8 to 10 seconds, so 2 or 3 are always moving, and about one wash blooms
  in or dries away every second. This is the hero view, "the map blushes as Twitch goes live", and it is real.
- **On the English continent,** which sends about half of all raids, a caravan leaves every 20 s or so.
- **In one realm** a caravan passes every few minutes. **In one kingdom** a raid goes out about once a stream, at
  its end.

So close up, life comes from pennants, smoke and the kingdom's own moments, not raids. The default and replay views
sit at world or continent zoom. Roads build fast: at this rate about 60,000 raids a week, 2 to 3 out per kingdom, so the
map is well roaded within its first week. Most roads stay inside one continent, which makes continents read as
communities. These numbers come before the evening peaks in Europe and America; measure again after 7 days.

## 6. You on the map

### 6.1 Your places

Signed out, the map is the same for everyone. Signed in, it opens on your places: your home at continent zoom, the
whole world if your homes span continents, your realm if you are a monarch, or a "you are here" pin if you opened it
from inside a kingdom.

| You are | The mark at that kingdom |
|---|---|
| Its monarch | A crown ring around its shield, "Your realm" on the card. The castle does not count as one of your 3 homes |
| A citizen with a home | A small brass key under its shield, in your Twitch name colour |
| A newcomer with a tent | A small tent |
| A settler on waiting land | A pencilled tent |

**The "Your homes" ribbon** lists your homes, live ones first, each with tonight's lights lit. A person lives in at
most 3 places (decided 2026-10-29); a monarch's own castle comes on top of those.

**Entering, by role:** in your own realm you enter as monarch, at the castle. Where you have a home you enter as a
citizen at your door, with no royal powers even if you rule elsewhere. Anywhere else you are a visitor at the gate,
with a guest badge and a passport stamp (`Tech.md` §6.7).

### 6.2 Passport, friends and your Twitch

- **Passport** (decided 2026-10-29: public, a creative part of Chatdom):
  - Each kingdom you visit and each raid you ride with adds a stamp. Each road you ride is drawn in your colour.
  - It is public on your citizen card, with your homes, in every kingdom.
  - A "hide my travels" switch hides it, for anyone who needs to.
- **Friends** (bonds, `docs/08` social) can choose to show each other which kingdom they are in. Both must opt in; it
  shows the kingdom only, never a position inside it, and only while they are there. "Join" puts you in their layer if
  it has room (`Tech.md` §6.2).
- **My Twitch on the map:** a signed-in viewer can underline the channels they follow, in their colour, for their own
  view only. It asks for `user:read:follows` at that moment (`Tech.md` principle 9), uses the list for that view, and
  does not keep it. It never feeds the shared map.

### 6.3 What is public and what is private

| Data | Who sees it |
|---|---|
| A channel's land, live state, viewers, game, title, roads, trains, bridges, crowns | Everyone |
| A founded kingdom's lights lit, citizens (as a band), embassies, season results | Everyone |
| Figures from people: footpaths, trade, shared citizens | Everyone, only with 20 or more people behind them, as bands |
| Your homes (at most 3) and realm | Everyone, on your citizen card, once you have signed in. Before that, each card shows only its own kingdom's home |
| Your passport and the roads you rode | Everyone, on your citizen card, unless you switch on "hide my travels" |
| Where your friends are | Friends who both opted in; kingdom only; only while there |
| Your Twitch follows | You, for that view; never kept |

Every card shows every home, and the passport is public (decided 2026-10-29). The Atlas itself still never lists or
searches people, and never draws anyone's homes or travels for others to browse: you meet a person's card by meeting
them in a kingdom. Cross-kingdom homes appear only after sign-in, because citizens exist before they sign in
(`Tech.md` §7.1), and someone who has never signed in has not chosen to show where they chat.

## 7. Moving and entering

### 7.1 Finding a kingdom

- **Search:** one carved field finds kingdoms by kingdom name, channel name or login, in any script. The camera flies
  there along the van Wijk path in under 3 s.
- **Pan and zoom:** smooth, anchored at the pointer, with inertia, as in `e-atlas`. Mouse: drag, wheel, double-click,
  hover for a label, click for the card. Touch: one finger pans, pinch zooms, tap opens the card. `M` opens the map
  from anywhere in a kingdom.
- **Follow a road:** from any kingdom, flies to a live neighbour along a real road, favouring small ones. This is
  `ChatDom.md` §7's "a viewer finds new communities by travelling".
- **The front page:** a notice board in the corner, never a list ranked by size: the Kingdom of the Week, kingdoms
  founded tonight, the night's longest road, a crowned hamlet.

### 7.2 The kingdom card

A parchment card with a wax seal, from the carved kit (`Quality.md` rule 14).

| Founded kingdom | Mapped channel | Waiting land |
|---|---|---|
| Kingdom and channel name, arms on the seal; realm, tier, founded on | Channel name, avatar, shield; realm, tier | The channel's name, if any |
| Live: game, title, viewers, lights lit | Live: game, title, viewers | Live state |
| Crowns, embassies, its three strongest roads, the kingdoms sharing most of its citizens (from 20, in bands) | Its three strongest roads | |
| Your relation: "Your realm", "You live on Old Row" | "Found your kingdom", shown only to its streamer | |
| **Enter the kingdom** · Watch on Twitch | Watch on Twitch · Tell them about Chatdom · Pitch a tent (settlers shown in bands from 20) | Watch on Twitch |

Every card links to the channel on twitch.tv, as Twitch's agreement requires.

### 7.3 Entering: the hand-off

You click **Enter the kingdom**, or double-click the drawing.
1. **Within 100 ms** the wax seal stamps, with its sound (`Quality.md` rule 2).
2. **If signed out,** one click signs in with Twitch. The Atlas keeps its place and resumes at step 3.
3. **0 to 0.6 s:** the camera glides into the drawing, which grows to fill the screen. The map around it fades to
   plain parchment.
4. **While the world loads,** the drawing is the loading scene. Smoke rises and the pennant flies in it. The crest
   and name sit in a cartouche, and the real steps are written in ink in the margin ("The gate is opened", "212 lights
   lit"). If a step overruns, a raven lands; there is never a bar or a spinner.
5. **When the near world is ready, about 1.5 s:** the 3D world appears beneath the drawing at the same angle, under
   the same ink pass, and the drawing fades. Colour floods outward from the castle, the lights come on, and the camera
   eases from the hero angle down to your door, the castle or the gate.

```
 the Atlas           the drawing             the drawing wakes        the kingdom
 ┌───────────┐       ┌───────────┐           ┌───────────┐            ┌───────────┐
 │ ~  ^   ~  │ 0.6 s │   /\  /\  │  ready    │  colour   │   1.5 s    │ voxel     │
 │ [Lantern] │ ────▶ │  |##||##| │ ────────▶ │  floods,  │  ────────▶ │ world, at │
 │  o   ~    │       │ crest,name│ (loading) │ lights on │            │ your door │
 └───────────┘       └───────────┘           └───────────┘            └───────────┘
```

**What loads while.** Opening a card starts fetching the engine chunk, the snapshot and the drawing's angle.
Hovering Enter, when signed in, opens the room connection. The targets are `Tech.md` §8.8's: explorable within 3.5 s
of the click on a laptop, 8 s on a phone, about 2 s on a repeat visit.

**Re-judging `Tech.md` §8.5.** It said: PixiJS 8 and three.js share one WebGL context, the kingdom's map tile is
baked by the same renderer so the hand-off frame matches, and the terrain rises over about 2.5 s.
- **The frame still matches, from the hero angle.** There is no top-down plan any more. The drawing is made from the
  hero angle, so the 3D camera starts there under the same ink pass. The match comes from content, not a shared context.
- **Two stacked canvases, not one context.** With matching frames, a cross-fade between a PixiJS canvas and a
  three.js canvas cannot be seen. It keeps three.js out of the public Atlas bundle, needs no state resets, and keeps
  the path to WebGPU open (`docs/research/tech/rendering-devices.md` §5.13 names it as the fallback).
- **The rise cannot start before the world has loaded.** Loading takes 3 to 3.5 s on a laptop and up to 8 s on a phone,
  so a 2.5 s rise played on the click would show an empty world. The drawing covers the loading instead, and the reveal
  is short and plays only when the world is ready.
- **The full rise stays for Genesis:** flat inked parchment rising into voxel terrain over 15 s is a once-in-a-kingdom
  ceremony. Genesis happens live on stream only, with no private draft, and Chatdom keeps no video of it, only
  Chronicle stills (decided 2026-10-29). Everyday entry must be quick.
- **Kept:** only the target kingdom is ever 3D.

**Land that is not founded** has no kingdom to load. Its card offers Watch on Twitch, a way to tell the streamer, and
a tent to pitch. Settlers show on the land as pencilled tents and on the card in bands from 20; the streamer sees the
exact number when they found (decided 2026-10-29). Founding itself happens live on stream: the ink stamp becomes the
coloured drawing as Genesis runs.

### 7.4 Going back

Press `M`, the brass map button or Back. Over 0.8 s the camera rises to the hero angle, the colour drains into ink,
the drawing takes over and the map unfolds to where you left it. The world stays in memory for 60 s, so a quick
return is instant. On the map you are not walking, but your light stays on while you are in chat.

### 7.5 Travelling between kingdoms

The Atlas is also the road. Every journey uses one moment, which covers the swap from one kingdom's rooms to the
next (`Tech.md` §6.7 step 5): rise out of A (0.8 s), travel the road on the map (1.5 to 3 s), and B's drawing wakes.
- **Riding a road** you choose: you travel alone, and the road joins your passport.
- **Marching with a raid:** your caravan is the same public caravan everyone sees, and the party arrives together.
- **A raider arriving** from the Herald's link in chat (`Twitch.md` §9) starts on the raiding kingdom's land and rides
  in, so even someone new to Chatdom first sees where their community came from.

### 7.6 The Raid Gate on the Atlas

- The monarch opens the Raid Gate in the kingdom, and the camera rises into the Atlas in gate mode, centred on their
  kingdom. Only live channels can be chosen, and any live Twitch channel can be raided.
- **The raid finder** lists live kingdoms the monarch already has roads with, then live kingdoms in the same and
  neighbouring realms, then search. Within each group smaller channels come first: a raid of 200 means more to a stream
  of 20 than to one of 2,000. Nothing on it can be paid for.
- A preview ("38 citizens will march. Twitch counts down for up to 90 s.") comes before Start a Raid is called.
- The caravan forms at the gate. When Twitch confirms the raid, the procession rides and the camera follows it along
  the road. If the monarch cancels on Twitch, the caravan turns back.
- A small live target rides to its pencil flag; from Edition I it gets a pencilled hamlet slot and the road stays
  (§5.2). A target the sweep does not see is reached at the edge of the known map.

### 7.7 Links and share cards

| Link | Opens |
|---|---|
| `chatdom.gg/map` | The Atlas (public). Not `/atlas`, because `atlas` is a valid Twitch login |
| `chatdom.gg/map/<login>` | The Atlas, flown to that kingdom with its card open |
| `chatdom.gg/map/road/<login>/<login>` | A road and its story: "lumi to HexHeroes: 7 raids since 30 October" |
| `chatdom.gg/map/line/<id>` | A named raid train |
| `chatdom.gg/map/season/<n>` | A season's board and crowns |
| `chatdom.gg/<login>` | Enter the kingdom (sign-in required) |

Each link has a share image rendered on the server: the kingdom's drawing on parchment with its seal, name, realm and
live state. Twitch data in it (avatars, titles) follows the 24-hour cache rule.

### 7.8 The phone and the stream

- **Phone:** built for thumbs. The card is a sheet from the bottom, search sits at the top, and "Your homes" is one
  button with a count. At world zoom the wash is one painted density layer; closer, at most 2,000 washes and pennants.
  Entering follows the same hand-off with the phone's 8 s target and the lighter ink pass.
- **Stream:** the director's "rise to the map" shot (`Tech.md` §14) uses the Atlas for a raid out (the procession), a
  raid in (the caravan arriving), going offline (a pull-back to the Atlas: "tonight's roads") and the season
  crowning. The Atlas draws in 1 to 8 draw calls (measured in `e-atlas`), within the stream view's 4 ms GPU budget.

## 8. How it is made

### 8.1 The pieces

```
 Twitch ── Get Streams every 3 min, channel facts daily ─────▶ Surveyor ◀── pulse every 10 s ── KingdomRooms
        ── EventSub: channel.raid, shared chat ──────────────▶    │                             (founded only)
                                                                  │ nightly
                                                                  ▼
                                                            Cartographer ── settles, append-only
 Baker ── kingdom drawings, when the skyline changes ─────────────┤
                                                                  ▼
          Static (CDN): world (frozen) · land tiles (baked once) · settlers · roads · drawings
          Live: live.bin every 30 s · one event stream (raids, trains, bridges, spectacle, go-live)
                                                                  │
                                                                  ▼
                              chatdom.gg/map (PixiJS 8) ── Enter ──▶ the kingdom (three.js)
```

Only the Surveyor's data half exists. The Cartographer, the baker's drawings, the Atlas client and the pulse are
specified, not built.

### 8.2 The land: editions and settling

`docs/12` §3 and §4 stand, with four changes:
1. **Editions.** The first map is Edition 0, a preview, founded from at least 2 days of data, and Edition I follows
   after at least 7 days with hamlet slots and reviewed families. From then on the land never moves. Use as much real
   data as there is; simulate only a moment the data lacks, labelled SIMULATED. When Edition I is founded is not yet
   decided.
2. **Hamlet slots** (decided 2026-10-29). Each realm's waiting land carries a fine, deterministic grid of slots,
   computed from the frozen world and stored only when used.
   - **Pencil places for small live channels.** A channel the sweep sees with 5 to 24 viewers is drawn at a
     provisional slot: in the realm of its language and main game, at the free slot nearest a hash of its channel ID.
     Nothing is stored. Its dab and flag can wander between nights until it is granted land.
   - **Land by raid, from Edition I.** A channel a kingdom raids, or that raids a founded kingdom, is granted the slot
     nearest its provisional place, pencilled and kept, so its road can stay.
3. **Founded kingdoms settle at once,** whatever their size. One under 25 viewers takes the free slot nearest the
   weighted centre of its raid ties in its realm, or nearest the realm's heart.
4. **Two records per settler:** the holding and tier (append-only, as before), and a founded record (kingdom name,
   drawing version) that changes without touching land.

The invariant check stays: the world file's hash never changes, no settler's holding ever changes, and no holding has
two owners.

### 8.3 Tiles and the overlay

- **Land tiles:** the land never changes within an edition, so every level is baked once. In Edition 0, z0 to z6 are
  pre-baked (about 5,500 tiles) and deeper levels bake in the browser, as `e-atlas` does. From Edition I every level is
  baked on a server and served from the CDN.
- **Zoom stops at about z9,** not z14: no town-plan or plot pyramid.
- **The overlay** carries everything crisp or alive: stamps, shields, labels, drawings, pennants, dabs, roads,
  caravans. The wash is a separate painted layer between the land and the overlay. It
  uses tier and rank for detail, a spatial grid for culling, greedy label collision, and at most about 300 shields on
  screen (`docs/12` §6).
- **Settlers load by continent and tier.** Capitals and cities load at start; the rest load per continent as you zoom.
  All 25,000 at once would cost a phone several hundred KB.

### 8.4 The live layer

- **`live.bin` version 2:** two bytes per settler, in settler order. The first is the size class (0 offline, 1 to 5,
  §5.1); the second is the spectacle code for founded kingdoms. 25,000 kingdoms is 50 KB, a few KB compressed. It is
  rewritten every 30 s, from the sweep for mapped channels and from pulses for founded ones. Exact viewer counts stay
  on the card, from the API.
- **`dabs.bin`:** the small live channels, one entry each: realm, a hash of the channel ID, and a start time. The
  client turns the hash into the pencil place (§8.2). No names: hovering asks the card API.
- **No night layer.** There is no time-of-day state on the Atlas.
- **One event stream** (server-sent events): raids, train stops, bridges, spectacle changes, founded kingdoms going
  live. The client loads `live.bin` at start, applies the stream, and refetches `live.bin` every 60 s.
- **Real start times:** `started_at` from Get Streams tells the client when each stream really began, so washes
  bloom in order, not in a batch every 3 minutes.
- **At scale:** past about 10,000 people on the map at once, the event stream becomes small files cached at the edge
  for 10 s.

### 8.5 Drawing the kingdoms

- **Mapped channels** are composed in code from the open-licensed stamps: a town by tier and a shield seeded from the
  channel ID, never the login.
- **Founded kingdoms** are drawn by the baker: a render from the hero angle at about 1,024 pixels through an ink pass
  (outlines from depth and normals, hatching for shade, paper grain, a wash from the kingdom's palette), plus a list of
  chimney positions for the ink smoke. The pass builds on the painterly interior pass (`Tech.md` §8.5).
- It runs at Genesis, when a wonder is finished or a ward opens, at a new season, and at most daily. It runs in the
  baker's headless browser, or the stream view captures it the way it captures postcards
  (`docs/research/tech/ui-audio-shell.md` §4.2).
- Every drawing passes the beauty check (`Quality.md` rule 17) before it replaces the last. Stamps are the fallback.
- The same ink pass runs live in the kingdom at the hand-off, so the first 3D frame matches the drawing.

### 8.6 The renderer and performance

- **The Atlas stays on PixiJS 8 with WebGL2,** as in `e-atlas`: 30 to 60 sprites in 1 to 8 draw calls at any zoom.
  Pixi's WebGPU path failed in the prototype, and a 2D map gains nothing from it.
- **The kingdom is three.js** (`Tech.md` §8.1), on its own canvas. The two cross-fade at the hand-off.
- **One app.** The Atlas and the kingdoms are routes of `apps/web`, so moving between them never reloads the page. The
  Atlas is a lazy chunk, and the engine is fetched on intent.
- **Labels** are drawn from a canvas atlas in the kit's face, so every script works. Japanese, Chinese, Russian, Thai
  and Arabic names are on the map today.

| Device | First frame | Pan and zoom |
|---|---|---|
| Gaming PC and laptop | Under 1.5 s on broadband (`docs/12` §7) | 60 fps |
| Phone | Under 3 s | 30 fps, 60 where it holds |
| Stream view | Preloaded before the director cuts | 60 fps at 1080p, within 4 ms of GPU time |

Every state is designed (`Quality.md` rule 15): loading is "Inking the map…"; late data is "Live as of 21:14"; no
results is "No kingdom by that name. Its land may still be waiting."; a channel with no avatar gets a blank shield in
its realm's colours; no WebGL gets a still of tonight's map, with search.

### 8.7 Twitch budget and costs

| Item (measured) | Value | Share of the limit |
|---|---|---|
| Live sweep | 274 to 306 calls every 3 minutes, about 55 s each | About 100 calls a minute: 12 to 13% of the Helix bucket |
| Raid watch | 8,886 subscriptions | 89% of the EventSub budget |
| Starting the watch | About 880 new subscriptions a sweep while ramping; then about 2 calls per kingdom per stream | Kept behind the sweep by a reserve |
| Channel facts | 1 call per 100 kingdoms a day | Under 1% |

- **Helix:** the Atlas uses about 15 to 20% of the bucket it shares with the kingdoms (`Tech.md` §7.6). The browser
  never calls Twitch.
- **EventSub is the binding limit.** At the American evening peak more than 9,500 kingdoms may be live, and the
  smallest wait for a watch. Founded kingdoms cost nothing, because they authorised the app, so every founding frees a
  place.
- **Costs:** nothing beyond the existing server at first; at launch about $11 a month of CDN at 100,000 sessions
  (`docs/11`, an estimate); drawings an estimated 10 to 30 s of CPU each, a few times a month per kingdom.

### 8.8 What changes in `e-atlas`

| Keep | Change | Drop |
|---|---|---|
| Parchment, ink coasts, ripple lines, hillshade, stamps | The generated continent becomes a loader for the frozen world and settlers | The town plan and the metropolis generator |
| The heraldry generator | Seeded from the channel ID, not the login | Street vignettes, the plot editor, the live plot layer |
| The tile pyramid with cross-fades, ancestor fallback and fade-in | Realms become game families on language continents; size by tier | King mode and the extension panel |
| The float64 camera and the van Wijk flight | Zoom capped at about z9; overlay detail by tier and rank; settlers by continent | The fake feed, the communal bar, the district dots |
| The caravan | Fed by the event stream; roads from `roads.json` | The HUD styling, replaced by the carved kit |
| Clouds, ships, sea monster, compass, scale bar, sounds, "Inking the map…" | New: the wash and pennants, dabs and pencil flags, carved card and search, hamlet slots, founded drawings, the hand-off | |

### 8.9 What the Surveyor should add

All data-only, so they fit "build only the data for now":
1. **A night recorder:** one live frame per sweep and a log of every raid the webhook receives, kept 7 days. It feeds
   raid-train detection and lets the Atlas replay or time-lapse a real night. Approved by the founder and running since
   2026-10-29 16:52 UTC; the format, size (about 13 to 19 MB a day) and retention note are in the Surveyor's README.
2. **Intake counts per hour by outcome** (kept, target not a kingdom, under 5 viewers). Today they live in memory and
   reset on restart. Not yet approved.
3. **Content labels** in the daily facts (Get Channel Information), for the mature and gambling rules. Not yet
   approved.
4. **Later, for founded kingdoms:** inbound raids and shared chat, both free once a channel has authorised the app.

## 9. Rules

**Privacy** (`docs/11` §8, binding):
- Never read the chat of channels that have not joined us.
- Never keep per-viewer, cross-channel histories of people who did not consent, hashed or not.
- Never offer a search or list by person on the Atlas. A person's homes and passport show only on their own citizen
  card (§6.3); what they watch or follow on Twitch never shows at all.
- Publish no edge or figure derived from people without at least 20 distinct people behind it, shown as bands.

**Twitch's terms:**
- Raw data about channels that have not joined (names, titles, avatars) is refreshed at least daily, and titles are
  cleared a day after a channel was last live, as the Surveyor does today.
- Every kingdom links to its twitch.tv channel. No data API, no export, no selling the graph.
- The product is not named after Twitch. "Live from Twitch" in the legend names the source.
- **Ask Twitch in writing** (`docs/11` §8; no answer is on record yet):
  - may derived data (positions, raid counts, named lines) be kept beyond 24 hours
  - is watching raids only while a channel is live acceptable
  - would Twitch raise our EventSub cap
  - may the night recorder keep raid events and live frames for 7 days

**Fairness:** money never touches placement, size, live marks, labels, rank, recommendations or crowns; spectacle never
raises attention (§5.5); recommendations even out size.

**Safety:**
- Kingdom, realm and line names on the public map pass the same checks as other public words (`Tech.md` §11.3).
- Channels whose content labels are mostly mature show from kingdom zoom only, never on the front page. Gambling
  categories are left out: 84 kingdoms in the first hour streamed mainly Slots.
- Any streamer, founded or not, can hide their channel. The label hides at once, and the land returns to waiting at
  the next nightly run. A deleted or banned channel's label hides at once, and its land returns after 30 days.

## 10. Building it

### 10.1 The data

1. Keep the Surveyor running untouched (`https://twitch-demo.saartech.de/atlas/api/`, `/status` describes it).
   Founding needs at least 2 days of data, which exist from 31 October, 15:44 UTC.
2. The night recorder runs since 2026-10-29 16:52 UTC (§8.9). Intake counts and content labels wait for approval.
3. Ask Twitch the four questions in §9, through developer relations.

### 10.2 The Atlas, in full

No phases: this is the whole thing, and the order of work is decided as we build.

- `families.json` and continent and realm names (a Codex draft, reviewed by the founder).
- The client (§8.8): loader, zoom cap, overlay detail, wash and pennants, dabs, roads, caravans, card, search.
- Edition 0, founded with hamlet slots, with our own kingdoms settled as founded. Then Edition I from 7 or more days
  of data, with every land level baked and served from `chatdom.gg/map` on a CDN.
- Founded kingdoms on the map: pulses, the baker's drawings, the hand-off with its 1.5 s reveal, your places.
- The rise from a kingdom to the Atlas road, and back down into a kingdom.
- Travel: road rides, the raid march on the Atlas, the Raid Gate with the raid finder.
- Raid trains, bridges, embassies, footpaths.
- A real night replayed or time-lapsed from the night recorder: washes blooming across the continents as time zones
  go live, labelled with its date and speed.
- Seasons: the board, crowns, the crowning, the Kingdom of the Week.
- People: the public passport with its hide switch, friends, My Twitch on the map.
- The long tail: land by raid from Edition I, then land for every channel that streams, and a history scrubber.

Never fake what can be real: real data, the live wash and real raid caravans come first. A moment the real data lacks
may be simulated on the real map, labelled SIMULATED.

## 11. What this file keeps and changes

| Source | Kept | Changed |
|---|---|---|
| `docs/11` | Draw the map ahead of time; a zoom costs no Twitch calls; data sources and red lines; privacy rules and the 20-person floor; ask Twitch in writing; prior-art lessons | The night map is dropped: live shows as wash and pennant on a day map. The three grades become pencil, ink and colour, set by claim state. Clustering, layout, weekly redraws and town-plan zoom levels are dropped. Twitch follows feed nothing shared. Its §11: decisions 1 and 5 are done, 3 is still to do, 4 is answered by the overlap decision (§12), 6 is replaced by the threshold and hamlet slots, 7 is adopted, 8 is proposed for `ChatDom.md` |
| `docs/12` | Frozen land; language continents, family realms, Crossroads, Wilds, Isles; four tiers; append-only settling and the invariant check; the Surveyor and Cartographer; `live.bin`; caravans; card; legend; rules; its §11 decisions 1, 2 and 4 | Its decision 3 (night after 18:00) is dropped: no night. Adds editions, hamlet slots, pencil places for small channels and founded kingdoms settling at once. Zoom stops at the drawing. `live.bin` carries size classes and a spectacle byte, refreshed every 30 s, plus `dabs.bin`. Settlers load by continent. The Surveyor gains a recorder (§8.9) |
| `Tech.md` §6.8 | The Atlas never connects to a game server; a pulse every 10 s; static files; `live.bin`; a raid stream | The pulse carries a spectacle code. `live.bin` carries five size classes, not a glow. The stream also carries trains, bridges, spectacle and founded go-live. No night layer |
| `Tech.md` §8.5, Atlas zoom | Only the target kingdom is 3D; the hand-off frame matches | Two stacked canvases, not a shared context; matched from the hero angle; the drawing covers loading; a 1.5 s reveal once the world is ready; the full rise stays for Genesis, live only |
| `Tech.md` §6.7 | The raid rises to the Atlas road; seats reserved in one call | The march is the same public caravan everyone sees. A small live target rides to its pencil place; from Edition I it gets a slot |
| `Artstyle-Soul-Feel.md` §12 and §5 | The explorer's map look; heraldry; roads, trains, bridges, crowns | "Live kingdoms glow" becomes the vermilion wash and the pennant, and the Atlas has no night. "The ink rises into the world" becomes "the drawing comes alive". Founded kingdoms are drawn from life. Pencil, ink and colour |

## 12. Decided on 2026-10-29

The founder answered every Atlas question on 2026-10-29 (the decision log of that day, rounds 5 to 9, 13 and 14).
The study behind the last one, with mockups, is in `docs/research/atlas-liveness/`.

| Question | Decision | Where it lands |
|---|---|---|
| How live shows on the map | Paint and pennants. A day map only; the parchment never darkens and the Atlas has no night. A vermilion wash from afar and the pennant up close, in five size classes; small live channels as dabs and pencil flags; raids as ink roads and caravans | §4.5, §5.1, §5.5, §5.6, §8.4 |
| Map reach | Show small live channels now, as dabs and pencil flags. Land by raid from Edition I | §4.3, §5.2, §8.2 |
| Real or simulated | Use as much real data as we can get, and simulate only a moment the data lacks, labelled. When Edition I is founded is not yet decided; Edition 0 as a preview stays the working plan | §8.2, §10.2 |
| Small kingdoms' land | Hamlet slots in their realm, by language and games, near their raid ties | §4.2, §8.2 |
| A kingdom that outgrows its land | Grows in place: drawing and label up to one tier past the holding; the holding never changes | §4.2 |
| How a founded kingdom is drawn | Drawn from life: the baker renders the real kingdom in ink. Stamps until the first drawing passes the check | §4.4, §8.5 |
| What shows first | Life lifts labels: founded, active kingdoms are named one zoom level earlier, in colour | §4.2 |
| Settlers before kings | Tents on waiting land; a public count in bands from 20; the streamer sees the exact number on founding | §6.1, §7.2, §7.3 |
| Homes across kingdoms | Every citizen card shows every home. A person lives in at most 3 places; a monarch's castle does not count | §6.1, §6.3 |
| The passport | Public on the citizen card, a creative part of Chatdom built from visits and raids, with a "hide my travels" switch | §6.2, §6.3 |
| Shared citizens between kingdoms | Shown from 20 people, in bands, signed-in citizens only, with an opt-out | §5.1, §6.3 |
| Founding | Genesis is live only, on stream, with no private draft | §7.3 |
| Clips and recordings | No auto-clips. Chatdom makes no video recordings of its own, only Chronicle stills | §7.3, §10.2 |
| Money and the map | Money never draws the map. The dragon is earned only; no cheer can summon it on demand | §2, §5.5, §9 |

Still open, and not for the founder alone: Twitch's written answers on keeping derived data, the EventSub cap and the
night recorder's 7 days (§9). Until the cap rises, bridges are drawn only between founded kingdoms (§5.4).

One rule this file adds to keep the homes decision safe: a card shows homes in other kingdoms only after its owner
has signed in to Chatdom at least once, because citizens exist from their first chat message, before they have
chosen anything (§6.3).

## Change log

- **2026-10-29: first version.**
  - From the founder's request: one file for the Atlas's look, tech, Twitch data and research. The Atlas is a drawing
    of each kingdom that you enter, not a minimap, showing what is alive and where you live, for people with several
    homes and monarchs who are citizens elsewhere.
  - The zoom stops at the drawing, and entering wakes it into the voxel kingdom. This re-judges `Tech.md` §8.5.
  - Pencil, ink and colour replace the three grades. Editions, hamlet slots and founded kingdoms settling at once are
    added to `docs/12`.
  - Grounded in the Surveyor's first 51 minutes: 9,789 kingdoms in 32 languages, 6 to 7 raids a minute between
    kingdoms, 44% of raids landing outside them, 89% of the EventSub budget in use.
  - Reconciled with `World-Tree.md` and `Twitch.md`, written the same day.
- **2026-10-29: the night recorder runs.** The founder approved it. The Surveyor now keeps a frame per sweep and every
  raid it receives, for 7 days (§8.9, §10.1).
- **2026-10-29: the founder's decisions folded in.** Paint and pennants: a day map with no night, a vermilion wash from
  afar and the pennant up close in five size classes, small live channels as dabs and pencil flags (study in
  `docs/research/atlas-liveness/`). Every other question decided (§12): hamlet slots, grow in place, drawn from life,
  life lifts labels, settlers' tents counted from 20, every card shows every home with at most 3 homes, a public
  passport with a hide switch, overlap from 20, live-only Genesis, no auto-clips or video recordings, money never
  draws the map and the dragon is earned only.
