# Chatdom

The blueprint. Internal, not for sharing. Started 2026-10-29 from the founder's answers and everything in `docs/`.

This file defines what Chatdom is:
- its heart
- its principles
- the people it is for
- the world
- how deep it goes over time
- how far it reaches

It says nothing about technology. Every design, spec, script and decision is derived from it. When a design disagrees
with this file, either the design changes, or this file changes on purpose with a line in the change log at the
bottom.

The files derived from it sit beside it in `chatdom/`. Each owns one part:
- `Quality.md`: the quality bar, the slop list and the device targets
- `Artstyle-Soul-Feel.md`: how Chatdom looks and feels
- `World-Tree.md`: the grammar of a kingdom: its beings, things, places, acts, moments, growth and memory
- `Twitch.md`: what each Twitch surface becomes in the kingdom, what the kingdom says back, the panel and Bits
- `Atlas.md`: the map of Twitch, how kingdoms are drawn on it and how you enter them
- `Monarch.md`: the streamer's side: founding, how the kingdom sits in a stream, the throne and the Watch
- `Safety.md`: the rules for what people make, the judges, refusals and holds
- `Tech.md`: the architecture

The name is written Chatdom: one word, lower-case d. The domain is chatdom.gg. The folder is `chatdom/`.

## 1. What Chatdom is

**Chatdom gives every Twitch community a kingdom of its own.**

It is a persistent fantasy world, one for each channel. The streamer rules it, and every viewer is a citizen with a
home. Everything that happens on Twitch happens in the world as something you can see, from a single message to a raid
of thousands. And the world speaks back to Twitch.

The kingdom is there when the stream starts and fills up while people are in chat. It is still there when the stream
ends, holding what the community did.

Together, the kingdoms form a map: the map of Twitch itself, where communities find each other, visit, trade and leave
roads behind.

Chatdom is three things at once, and it must be all three:

- **A place** a community lives in: homes, streets, a tavern, a fire to sit around.
- **A show** the stream is better for: the kingdom tells its own story on camera, and every Twitch moment lands in it
  as a spectacle.
- **A world** that connects communities: raids become roads, visits become friendships, and the Atlas becomes the way
  people discover each other.

## 2. The heart: belonging

Live chat is the most alive community space on the internet, and the most forgetful.

Thousands of people show up night after night. Their messages scroll away in seconds, and when the stream ends nothing
they did remains. The quiet ones are invisible, and they are most of any chat. Someone can watch a channel for four
years and leave no trace.

Chatdom gives that community a place. Not a profile, not a leaderboard: a place, with a door that has your name on it,
on a street that remembers how long you have been here.

Glory, creation and play are all part of Chatdom, and all of them serve belonging:
- People build because it is their home.
- Communities compete because it is their kingdom.
- People play because the people they care about are at the table.

When two good ideas conflict, the one that makes more people feel at home wins.

**The test for everything:** does this make someone feel more at home here than they did before?

## 3. Principles

Each principle comes with **why**, and with **so**, meaning what follows from it. Derive designs from the "so" lines.
Where a "so" line is missing, derive it from the "why" line.

### Belonging

**1. Every chat deserves a kingdom.**
- **Why:** a community is a people, and a people needs a place.
- **So:**
  - Every Twitch channel gets a kingdom, from its first viewer. Kingdoms are granted, never sold, and there is no
    paid tier for the kingdom itself.
  - A channel whose streamer has not arrived yet already has land waiting on the map, so its chat can settle it
    before its ruler comes: settlers before kings.

**2. Showing up is the most valuable thing anyone can give.**
- **Why:** presence is what a live community is made of. Everything else is built on people being there.
- **So:**
  - Every minute in chat counts, and it counts the same in every kingdom.
  - The quiet ones count: a lurker's light burns like everyone else's.
  - A quiet one can light their light from the panel under the video, with one tap and without typing. It counts as
    presence, just as chatting does.
  - Rewards for showing up are the backbone of progress, and no amount of money substitutes for them.

**3. Your history becomes your place.**
- **Why:** loyalty is the most meaningful thing a viewer has, and today it is invisible.
- **So:**
  - How long you have followed, how long you have subscribed and how many nights you have been there all become where
    you live and what your home carries.
  - The oldest citizens live on the oldest streets, so a community's history can be read by walking it.
  - The town grows in tenure quarters, one for each year of following, oldest by the castle. Your follow year picks
    your quarter. Months subscribed help pick your street within it, once, when you settle. Nobody ever moves.
  - Your citizen card says it plainly: following since, subscribed for, citizen number, your homes, what you made, where
    you have been.
  - Where you have been is your passport: a stamp for every raid ridden and every kingdom visited. It is public on your
    card, with a switch to hide it.

**4. Loyalty cannot be bought. It can only be shown.**
- **Why:** the moment status can be bought it stops meaning anything, and the people who showed up are betrayed.
- **So:**
  - Money buys expression, never standing.
  - Anything that signals loyalty, effort or glory is earned only: the light itself, tenure from showing up, tenure
    pieces, ranks, crowns, scores and places on the map.
  - One person, one vote. No money, sub, rank or trust ever makes a vote count more.
  - Subscribing is Twitch's own way of showing support, so subs show in three places: sub pieces (capes, banners,
    colours), a tint at the edge of your light that never makes it brighter, and sub months that help pick your street.
    These show something true.
  - Bits buy moments the whole kingdom sees, and things that last a day. Nothing bought with Bits is permanent for the
    buyer.
  - When a sub lapses, its pieces dim and its tint fades. They never vanish.

**5. Nothing is lost.**
- **Why:** people come and go, and life happens. A home must not punish someone for having a life.
- **So:**
  - Absence never destroys anything. Homes wait, pets wait, and lights dim and relight.
  - What you earned stays earned.
  - Coming back is a moment to celebrate, not a debt to pay off.

### The world

**6. Twitch is the physics.**
- **Why:** the community already lives on Twitch. The kingdom should feel like the same life made visible, not a
  second place to keep up with.
- **So:**
  - Every meaningful thing on Twitch has a visible consequence in the world: going live, a message, a follow, a sub, a
    gift, a cheer, a hype train, a poll, a raid, a shared chat, even a timeout.
  - The world answers back to Twitch: a decree becomes a poll, a contest becomes a prediction, a signpost becomes a
    shoutout, a march out of the gate becomes a raid. The kingdom never makes clips or videos of its own; its
    Chronicle keeps stills.
  - Nothing in Chatdom asks a viewer to leave Twitch to take part.

**7. The kingdom tells its own story.**
- **Why:** the streamer has a stream to run. A kingdom that needs tending is a chore.
- **So:**
  - The kingdom narrates itself on stream: it finds the moment, frames it and says what happened.
  - The streamer rules with one hand free. Every royal act is a single gesture, pressed only by the streamer, and
    ignoring the kingdom never breaks it.
  - When it is dull, the kingdom makes something happen. When something big happens, it makes sure everyone sees it.

**8. Watching is playing.**
- **Why:** most of a community watches. If the fun needs a second screen, most people miss it.
- **So:** there are three ways in, and each is complete on its own:
  - **Watch:** the kingdom on stream is worth watching by itself.
  - **Chat:** one message is enough to take part.
  - **Walk:** opening the kingdom and moving in is the deepest layer, and never a requirement.

**9. Every size is welcome.**
- **Why:** most streams are small. A world that only shines with thousands of viewers fails most of Twitch.
- **So:**
  - Five viewers and fifty thousand get the same magic.
  - A hamlet feels as alive as a capital: never empty, never crushed. A big kingdom never feels like a queue.
  - Every design is checked at both ends: does this work for the nine people in a hamlet, and for the crowd in a
    capital?

**10. No two kingdoms are alike.**
- **Why:** a community has its own jokes, emotes, colours and history. A copy-paste world says none of that.
- **So:**
  - Each kingdom is founded from its channel: its emotes stand in the plaza and fly on its banners, its colours, its
    landmarks.
  - Each kingdom has its own style, so what is forged there exists nowhere else.
  - Culture travels only by people: by gifts, raids and visits.

**11. Make it yours.**
- **Why:** belonging includes being seen as yourself.
- **So:**
  - Everyone can shape how they look, build their home voxel by voxel, and fill it with things they earned or forged.
  - Freedom comes with taste: the citizen owns the big shapes and the kingdom owns the small ones, so a street of very
    different homes still looks like one beautiful place.

**12. Games are places.**
- **Why:** a menu of minigames is a lobby. A table in a tavern is a memory.
- **So:**
  - Every game lives somewhere in the kingdom: a tavern table, the campfire, the arena, the plaza.
  - The tavern is a real place you walk into and share with other players. Its tables are games: walk up to watch,
    sit down to play.
  - Anyone can ask for a new game at a table in their own words, and it is set up there and then. The streamer can
    crown the good ones for the whole kingdom.
  - Sit down and the game opens in its own art style.
  - The streamer and the chat play together: chat as one player, as many, in teams or in seats.

### Between kingdoms

**13. Kingdoms connect. They never conquer.**
- **Why:** the best thing on Twitch is communities meeting each other: raids, shared chats, friends of friends.
  Destruction would turn that into fear.
- **So:**
  - Raids are visits that bring gifts and leave a road behind.
  - Kingdoms compete openly in leagues and in contests they opt into: build-offs, tournaments, games between kingdoms.
  - No one can ever damage, take or lose anything because of another kingdom.

**14. Glory is earned by being lovely.**
- **Why:** "Who will build the most epic kingdom?" is the question that drives every season. Epic must mean what a
  community made together, not how big or rich it is.
- **So:**
  - Leagues are by size.
  - A kingdom is judged by how lovely most of its homes are, not by its biggest one.
  - What counts is how many citizens took part, what visitors thought of it, and what it built, played and gave.
  - Money never touches the score, so a hamlet of nine can be crowned.

### Character

**15. Kindness leaves a trace. Unkindness leaves nothing.**
- **Why:** a home has to be safe to be a home, and Twitch audiences start at thirteen.
- **So:**
  - Generous acts become visible and lasting: tended lights, flowers on a doorstep, gifts with the giver's name.
  - Nothing a person can do harms another person's home or standing.
  - The channel's own moderators and Twitch's rules are the authority on behaviour.
  - Voices are heard only where the streamer invites them.
  - Refusals, holds and hides are private to the maker, the Watch and the monarch. A refusal may air only as a
    nameless comic beat that never shows or hints at the words.

**16. Magic, under rules.**
- **Why:** AI can grant wishes no game could before. But Chatdom is a world, not an AI product, and magic without rules
  ruins worlds.
- **So:**
  - Codex is the quiet magic inside the kingdom. It founds the kingdom from the channel, forges what chat imagines and
    gives the realm its voice.
  - It answers people's words. It never replaces their creativity, and it never acts on its own.
  - Everything it makes fits shapes the kingdom already allows, so nothing it makes can break the world.
  - It is never the headline. The community is.

**17. Real, never a tech demo.**
- **Why:** a community gives Chatdom its nights and its loyalty. That deserves something that works, on a real stream,
  for months.
- **So:**
  - Every feature is judged by a real community on a real stream.
  - Show what is real, and say plainly when something is simulated.
  - Depth must hold for months, not minutes.

**18. Made with love.**
- **Why:** people can tell when something was made for them.
- **So:**
  - Every detail should show care: the names, the sounds, the moment a light comes on, the words on a plaque.
  - No placeholders.
  - If something is in the kingdom, someone cared about how it feels.

## 4. The people

| Who | What they feel | What Chatdom gives them | Their way in |
|---|---|---|---|
| **The monarch** (the streamer) | Proud: "look what my community built" | A kingdom granted on day one. A stream that tells stories by itself. Moments worth clipping every night. A flex to show other streamers. A way to be found on the map. | Rules with one hand free: decrees, knighting, opening the gate |
| **The citizen** (the viewer who chats) | At home; seen | A home on a street, a look of their own, things they made that exist nowhere else, a seat at the table | One message in chat, or walking in |
| **The quiet one** (the lurker) | Counted, without being pushed | A light that burns while they are there, rewards for showing up, a home that waits | Just being there, or one tap on the panel |
| **The newcomer** (first night) | Welcome | Their name on a tent at the edge of town that becomes a home if they come back | A first message |
| **The visitor** (raider, tourist) | A guest of honour | A road in, a welcome, gifts to carry home, a stamp in their passport | Arriving with a raid, or travelling the map |
| **The watcher** (anyone seeing the stream) | Curious: "what is that?" | A world worth watching, telling its own story on stream | Watching |

One person is one Twitch identity in every kingdom. They may hold homes in up to three kingdoms, and are a guest with
a light wherever else they chat. A streamer's own castle does not count toward the three: a monarch rules at home and
may be a citizen elsewhere, never crowned there.

## 5. The world

**A fantasy kingdom, flavoured by its channel.**
- Always a kingdom: castles, taverns, forges, dragons, roads.
- Never generic: the channel decides its colours, its landscape, its landmarks, the emotes carved in its stone and the
  style of everything forged there.

**The places, and what each is for:**

| Place | What it is for |
|---|---|
| The castle | The monarch's seat, and the beacon that lights when the stream goes live |
| The homes and streets | Belonging made visible. Old streets for the oldest citizens, the edge of town for the newest |
| The plaza | The kingdom's heart: the channel's emotes as statues, festivals, gatherings |
| The forge | Where words become things that exist nowhere else |
| The tavern | A real room full of people, where chat and streamer play at tables, and anyone can ask for a new game |
| The campfire | Where the brave sit together at night, play, talk and suspect each other |
| The wilds | What lies beyond the walls, to explore and gather from |
| The gate | Where raids arrive and where the kingdom rides out |
| The road and the Atlas | Where kingdoms meet, and how the map of Twitch is drawn |

**The look.**
- The world outside is built of voxels. It is a material everyone can shape equally: the citizen, the streamer and
  the magic.
- Inside, the light turns to paint: candlelit rooms you share with everyone there, where each game opens in its own
  art style.
- Dusk and night are the signature hours, because that is when the lights show who is here.

**Presence is light.** While you are in chat, or lit from the panel, your light is on. A kingdom at night is its live
audience made visible. A sub may tint a light's edge by tier (warm gold, rose, then a rainbow edge), and nothing paid
makes it bigger or brighter. The citizen’s own window is their light: warm when they are present, with their name floating above it up close. The castle beacon is the whole kingdom’s light.

**Time.**
- The kingdom is founded live on stream, with its chat watching and naming it.
- When the stream goes live, the kingdom wakes.
- When it ends, the kingdom rests but stays open, and keeps what happened.
- Seasons give the year a shape: a beginning, festivals, a crowning.

**The Voice of the Realm.** The kingdom has a voice. It names what happened, sings the night's ballad and crowns the
season. It speaks only facts the kingdom actually witnessed.

## 6. Depth: what it is like over time

- **A night.**
  - The stream goes live, the sky turns to dusk and the lights come on one by one.
  - Newcomers pitch tents and old citizens come home.
  - Someone forges something that has never existed. Chat cheers and the sky answers.
  - The Hype Train rolls in and wakes the dragon, and the whole town fights.
  - The tavern fills, and a few brave ones sit at the fire.
  - At the end the monarch opens the gate and the kingdom rides out to visit a friend.
  - The Voice of the Realm sings what happened tonight.
- **A week.** Homes grow a little every time their owners show up. A wonder rises stone by stone. The kingdom has
  stories people retell: the night chat beat the streamer at chess, the dragon that fell on the third train.
- **A season.**
  - The kingdom changes with the time of year.
  - The question hangs over every kingdom: who will build the most epic one?
  - Contests between friends, festivals, a league table that small kingdoms can top.
  - At the end, a crowning on the map.
- **A year.**
  - The hamlet has become a town.
  - Its oldest street is lined with the homes of people who were there from the start.
  - The roads it left on the map lead to a dozen friends.
  - It has things no other kingdom has, and a chronicle of everything it lived through.
- **Always.** Everything made carries its story: who made it, where and when. Nothing important is forgotten.

## 7. The ambition: the map of Twitch

The horizon is bigger than homes. **Chatdom becomes Twitch's world map: the place where communities are discovered,
connect and travel.**

- Every Twitch channel has land on the map, claimed or waiting.
- The map draws itself from what communities actually do:
  - Raids leave roads, and shared chats build bridges.
  - Raid trains become named lines across the map.
  - Gifts and trade leave routes.
- A viewer finds new communities by travelling: following a road, visiting a neighbour, arriving with a raid and
  liking it there.
- Small streams get found by being lovely, not by being big. Being beautiful, kind and alive is the way onto the map's
  front page.
- Twitch gains a social layer it never had: a living picture of how its communities are connected.

Every decision should leave room for this. A feature that works for one kingdom but ignores the map is half a feature.

## 8. Money

**Kingdoms are granted, never sold.** No streamer pays for a kingdom, and no kingdom is better because someone paid.

**What Bits buy:** moments the whole kingdom sees, and things that last a day in the kingdom. When a viewer pays,
everyone gets the show. Nothing bought with Bits is permanent for the buyer. A shared moment that Bits started may
leave the same keepsake to everyone who took part, the buyer included, and nothing extra for the buyer.

**What money never buys:** loyalty, effort or glory. That means votes (one person, one vote), the light itself, tenure
from showing up, ranks, crowns, scores and places on the map. It also means progress that showing up should earn.

**Subs are support shown on Twitch,** so they may grant sub pieces such as capes, banners and colours. They may tint
the edge of a light, never making it brighter. Sub months may count toward your street: once, when you settle, and only
within your follow-year quarter. These show something true. They dim when the sub lapses, and never vanish. Subs never
raise trust.

**The panel's share of Bits comes first.** It is the one Twitch rail that pays Chatdom. Whether a shop or sponsors
follow is decided after one season (§11). Whatever the answer, it may never break the four lines above.

## 9. What Chatdom will never be

- A kingdom for sale, or a better kingdom for money.
- A place where status can be bought.
- A place where anyone can damage, take or lose what someone else built.
- A world that punishes absence.
- A chore for the streamer.
- A second screen you must open to take part.
- A menu of minigames.
- An AI showcase.
- A fake crowd passed off as a real one.
- Generic: the same kingdom with a different name.
- Finished. A community keeps growing, and so does its kingdom.

## 10. The things people will tell a friend

If these are not true, Chatdom is not finished. They are what to protect when everything else is cut.

1. "My light comes on when I'm in chat, and at night you can see everyone who's here."
2. "I've been watching for four years and I live on the oldest street, two doors from the castle."
3. "I typed a sentence and it became a chimney on my house. It only exists in our kingdom."
4. "I built my house myself, block by block, and nobody has one like it."
5. "Every sub, cheer and hype train does something. Last night the train woke a dragon and the whole chat killed it."
6. "We sat around the campfire with the streamer and I got accused of being the wolf."
7. "When the stream ended we rode out together to raid a friend. You can see the road on the map."
8. "Our tiny kingdom won its league this season."
9. "My home was still there when I came back, and everyone said welcome back."

## 11. Open at the vision level

- **How Chatdom sustains itself.** The panel's share of Bits comes first. Whether a shop or sponsors follow is decided
  after one season of data. Kingdoms are granted and money never buys standing, so any model must fit inside §8.
- **Voice.** Today voice is only for the campfire and the throne room, by invitation. Whether more of the world should
  ever be spoken in is open, and safety (principle 15) decides.
- **Beyond Twitch.** The horizon is Twitch's world map. Other platforms are not part of the vision as it stands.

## 12. How to use this file

When designing, cutting or choosing, run the idea through these questions in order:

1. Does it make someone feel more at home? (principles 1–5)
2. Does it come from Twitch, or speak back to it? (6)
3. Does it work at five viewers and at fifty thousand? (9)
4. Can it be enjoyed by watching, and joined with one chat message? (8)
5. Does it make this kingdom more itself? (10, 11)
6. Can money touch loyalty, effort or glory through it? The answer must be no. (4, 14)
7. Can it harm anyone's home or standing? The answer must be no. (13, 15)
8. Does it leave something on the map? (7 and section 7)
9. Is the magic under rules, and the community the headline? (16)
10. Would someone tell a friend about it? (section 10)
11. Is it real, and made with love? (17, 18)

**Words we use.** Keep the vocabulary small.

| Word | Meaning |
|---|---|
| Chatdom | The product |
| Kingdom | One community's world |
| Monarch | The streamer, as ruler |
| Throne | The monarch's console, where every royal act is one press |
| Citizen | A viewer who lives in the kingdom |
| Warden | A trusted citizen the monarch appoints to decide on made things held for review, and nothing else |
| The quiet ones | Lurkers |
| Visitor | A raider or tourist from another kingdom |
| Light | Your presence |
| The panel | Chatdom's Twitch Extension under the video, where a quiet one can light up |
| Home | Your place |
| Citizen card | Who you are here |
| Passport | The stamps of every raid you rode and every kingdom you visited |
| Keepsake | A record of a moment you were part of: the only scarce thing |
| The forge | Where words become things |
| Coal | What the forge takes: one for each stream night you are here, and no other way |
| The tavern | Where games are played at tables |
| The campfire | Where the brave sit together at night |
| The gate | Where raids arrive and the kingdom rides out |
| The Atlas | The map of Twitch |
| The Voice of the Realm | The kingdom's voice |
| Season, league, crown | How glory is shaped |

Anything else needs a reason to exist.

## Change log

- **2026-10-29: first version.**
  - Founder answers: belonging at the heart; always a fantasy kingdom, flavoured by its channel; AI as quiet magic;
    written as principles for internal use; the name is Chatdom.
  - The horizon is Twitch's world map.
  - Kingdoms are granted, never sold. Bits buy cosmetics and spectacle, never loyalty. Subs may grant capes and similar
    pieces.
  - Rivalry is contests with no harm.
  - Sources: `docs/00`–`docs/10`, the six prototypes, and the founder's notes of 2026-10-29.
- **2026-10-29: the tavern is a place.** It is a real room shared with other players, with tables where you watch,
  join, or prompt a new game. Prompted games are instant at your table, and the streamer can crown them (principle 12,
  §5).
- **2026-10-29: the planning files' decisions folded in.** From the founder's answers on `World-Tree.md`, `Twitch.md`,
  `Atlas.md`, `Monarch.md` and `Safety.md`:
  - Money (§8, principle 4): Bits buy moments and things that last a day, nothing permanent for the buyer; a shared
    moment may leave everyone who took part the same keepsake. Subs show as sub pieces, an edge tint on the light that
    is never brighter, and sub months that help pick a street within the follow-year quarter. Money never buys votes,
    the light itself, tenure from showing up, crowns, scores or places on the map. One person, one vote: trust may
    decide who votes, never how much a vote counts.
  - The panel's Bits share comes first; shop or sponsors are decided after a season (§8, §11).
  - A light lit from the panel counts as presence (principle 2, §5).
  - Tenure quarters by follow year, and a public passport with a hide switch (principle 3).
  - Up to three homes per person; a streamer's castle does not count, and a monarch may be a citizen elsewhere (§4).
  - Only the streamer presses royal acts (principle 7). The kingdom never makes clips by itself (principle 6).
  - Refusals are private, and may air only as a nameless comic beat (principle 15).
  - The kingdom is founded live on stream (§5).
  - The forms of light are now tied to the Atlas liveness study (§11).
  - New words: Throne, Warden, the panel, Passport, Keepsake, Coal (§12).
  - The intro names the files derived from this one and what each owns.
- **2026-10-29: consistency sweep after round 14.** The kingdom makes no clips or videos of its own; the Chronicle
  keeps stills (principle 6). The sub tint goes by tier (§5). Subs never raise trust (§8). The Atlas is a day map with
  no lights, so the form of light is an inside question (§11). Coal comes only from showing up (§12).

- **2026-10-30: build decisions from the founder.** Presence is the citizen’s own warm window, lit while in chat (panel presence follows the same rule), named up close; the castle beacon is the whole kingdom’s light. Sound uses CC0/permissive libraries and procedural audio, every source credited in THIRD_PARTY.md, no silent actions. Freeze small tested contract groups only when their first consumer starts; world/voxel contracts follow the Atlas handoff.
