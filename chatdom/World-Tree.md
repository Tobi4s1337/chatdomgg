# World tree

The grammar of everything that exists and happens in a kingdom. Internal. Started 2026-10-29.

This file sits between two others:
- `ChatDom.md` says why Chatdom exists, what it must never be, and the words we use.
- Future PRDs will say exactly how one part works: its numbers, screens and data.

This file says what a kingdom is made of. It sorts every being, thing, place, act, moment, kind of growth and record
into one tree, and sets the rules each branch inherits. Someone inventing a new item, pet, creature, place, verb or
festival next year should be able to find its branch, read the rules it inherits, and know what it must and must not
be.

It says almost nothing about technology. Where a fact in `Tech.md` limits the vision, it is said in one line with a
pointer. Two files are written alongside this one:
- `Twitch.md` owns what each Twitch event does. Here, Twitch moments appear only as sources.
- `Atlas.md` owns the map of Twitch, how kingdoms are drawn on it and how you enter them. Here, the road and the Atlas
  are a short branch that points there.
- `Monarch.md` owns the streamer's side, and `Safety.md` owns the rules for what people make. This file names the
  beings, things and acts they act on.

`Artstyle-Soul-Feel.md` and `Quality.md` set how every leaf looks and feels.

When this file disagrees with `ChatDom.md`, `ChatDom.md` wins. Either this file changes, or `ChatDom.md` changes on
purpose with a line in its change log.

**Adding to the tree.** Most new ideas are leaves: find the branch, fill in a leaf card and run the test (§12). A new
branch changes this file on purpose, with a line in the change log. The top branches should change rarely; the leaves
should never stop growing.

## 1. The tree

**Everything in a kingdom fits one sentence.** Someone (a being) does something (an act) with something (a thing)
somewhere (a place) while something happens (a moment). It grows (time), and the kingdom remembers it (memory).

```
THE KINGDOM
│
├── 1 BEINGS ............... who is here (§3)
│   ├── People ............... the citizen, the quiet one, the newcomer, the visitor, the monarch
│   ├── Companions ........... pets and mounts, each belonging to one person
│   ├── The kingdom's own .... its great beast, raised by chat; its dragon, woken by Twitch
│   ├── Wild creatures ....... fish, birds, bugs and beasts of the land
│   └── Townsfolk ............ a few keepers of places, plainly not people
│
├── 2 THINGS ............... what a person can own, sorted by where it lives (§4)
│   ├── Worn ................. garb, capes, hats, wings: on the body
│   ├── Held ................. tools and toys: in the hand
│   ├── Placed ............... materials, placed pieces, kits, blueprints: on the lot
│   ├── Kept ................. keepsakes: on the shelf
│   ├── Gathered ............. fish, ore, wood, seeds, flowers: in the bag
│   └── Used up .............. fireworks, treats, sky lanterns: gone after use
│
├── 3 PLACES ............... where it happens, sorted by who keeps it (§5)
│   ├── The land ............. terrain, water, sky, weather
│   ├── Homes ................ the lot, the home, its garden and doorstep
│   ├── Streets .............. rows of neighbours in tenure quarters, oldest by the castle
│   ├── Civic places ......... castle, plaza, forge, tavern, campfire, gate, market, wonders
│   ├── Rooms ................ inside the tavern, the throne room, your home
│   ├── The wilds ............ beyond the walls
│   └── Between kingdoms ..... the gate and the road; the map itself is Atlas.md
│
├── 4 ACTS ................. what people do, alone, together or as a crowd (§6)
│   └── being here · showing · together · giving · swapping · making · playing ·
│       exploring · tending · acting as a crowd · ruling · travelling
│
├── 5 MOMENTS .............. what happens to everyone at once (§7)
│   └── Twitch moments · the calendar · royal moments · world moments ·
│       personal milestones · between kingdoms
│
├── 6 TIME ................. how everything grows (§8)
│   └── the minute · the night · the stream day · the season · the year · tenure
│
└── 7 MEMORY ............... how everything is remembered (§9)
    └── stories · honours · the citizen card · plaques · the Almanac ·
        the Voice of the Realm · the Chronicle · roads on the map

ROOTS: the twelve rules every branch inherits (§2)
```

**How to read it:**
- Ask what the idea is: a being, a thing, a place, an act or a moment. Time and memory are branches too, because
  every other leaf grows and is remembered.
- Beings sort by who they belong to, places by who keeps them, and things by where they live, never by how they were
  made. A forged chimney is a placed thing: the Forge is a source, not a branch, so everything forged inherits the
  rules of the branch it lands in. Trove works the same way: each kind of community creation is a style of an
  existing item type, with its own template and size guide.
- A person is spread across branches on purpose. Their light and body are beings (§3), their home is a place (§5),
  their card and honours are memory (§9).
- A person is also spread across kingdoms. They are one person with one Twitch identity and one look everywhere, a
  citizen with a home in up to three kingdoms, and a guest whose light burns wherever else they chat (rule 9).

## 2. Rules every branch inherits

These are the roots. A leaf may add rules of its own. It may never break one of these. Each rule has a **why** and a
**so**, as in `ChatDom.md`.

**1. Only people are people.**
- **Why:** a kingdom at night is its live audience made visible. If anything else looks like a person, the picture
  lies, and "a fake crowd passed off as a real one" is on the never list (`ChatDom.md` §9).
- **So:**
  - A light, a nameplate and a face that shows chat's emotes belong only to a real person who is really here.
  - A person appears in four honest forms: an unnamed light (watching), a named light at home (chatting, or lit from
    the Chatdom panel), a body idling near home (chatting, not walking: `Tech.md` §8.4) and a body they steer
    (walking).
  - Everything else that moves is plainly something else: a creature, a townsperson with no light, the dragon.
  - A simulated crowd is labelled on screen and never writes to real Twitch.

**2. Light means someone is here.**
- **Why:** presence is light (`ChatDom.md` §5). It is the one signal that makes the night view true, so nothing may
  imitate it or water it down.
- **So:**
  - A person's light is part of them, not a thing. It cannot be bought, given, swapped, stored or left burning for
    someone who is away.
  - It burns in each kingdom whose chat the person is in, so one person can be lit in two kingdoms at once, and both
    are true.
  - Its form and strength change only with time (tenure, streaks) and honours. A sub tints its edge in the tier's
    colour: warm gold at tier 1, rose at tier 2, a rainbow edge at tier 3 (founder decision; `Twitch.md` §5). Never on
    an unnamed light. The tint never makes a light bigger or brighter, stays a thin edge on the same warm core so the
    night still reads as people, and fades to a thread of colour at the flame's foot when the sub lapses. The risk is
    that the night view now also shows who subscribes; keeping the tint quiet is what protects "light is people".
  - Anything else that glows must read as something else: fire, magic, a lamp, a sub piece's shimmer, or the ember a
    friend keeps for someone away. Glow on things is earned or shown by a sub, never bought with Bits.

**3. Everything carries its story.**
- **Why:** "Everything made carries its story: who made it, where and when" (`ChatDom.md` §6). The story is what
  makes one copy worth more than its shape.
- **So:**
  - Every copy of a thing, every creature and every place records who, where, when and how it came to be, written
    from the kingdom's facts by templates, never typed (`Tech.md` §5). Stacks of a material carry no story each, but
    the first of each kind a person finds gets one.
  - Stories only grow. A gift, a journey or a swap adds a line. Nothing rewrites one.
  - A person can withdraw their name. The story then says "a citizen".

**4. Magic fills shapes. Hands make the shapes.**
- **Why:** Codex makes only what "fits shapes the kingdom already allows" (principle 16), and what it makes must meet
  the same bar as handmade work (`Quality.md` rule 17).
- **So:**
  - Every branch the magic may touch publishes its shapes first (table below). Artists make shapes and parts, Codex
    chooses among them in the kingdom's style kit, our own code assembles, and gates check.
  - A branch opens to the Forge only when its shapes exist (founder decision: branch by branch). Today only house
    slots exist (`Tech.md` §11.2); worn pieces on sockets come next; creatures never.
  - Living bodies are always made by hand. The magic may name a creature, write its personality and choose its
    colours from its species' ramps. It never invents a body.
  - Minecraft moved all item data into declared components in Java Edition 1.20.5, breaking content built on
    free-form tags. Chatdom declares its shapes from the start and never needs that break.

| Shape | What it is | Example |
|---|---|---|
| **Slot** | A place on a home where a made thing attaches, with a size box, clearances and the kinds allowed | chimney, door, weathervane: 18 house slots today |
| **Socket** | A place on a body where something worn or held attaches | hat, face, back, both hands; a companion's head and neck |
| **Family** | A hand-made pattern with settings the magic may choose | a dice game, a fox species, a festival |
| **Style kit** | The kingdom's palette ramps, motifs from its emotes, native material and shape language, written at its founding | a lilac chimney that blows heart-shaped smoke |
| **Budget** | The size classes and voxel caps for anything built or forged | small, standard, grand |

**5. Rare is a story, never a power.**
- **Why:** loyalty cannot be bought (principle 4) and glory is earned by being lovely (principle 14). Once a thing
  makes one person stronger than another, rarity becomes rank, and money finds a way to it.
- **So:**
  - Nothing a person owns makes them stronger than another person. A tool, a companion or a mount may make your own
    work easier. It never makes someone else's harder and never decides a contest.
  - Mounts differ by what they can do, never by speed. Guild Wars 2 built its mounts this way, and its random paid
    mount licence caused an outcry.
  - Something can be unique in four honest ways: it comes from this kingdom's style, from a moment, from a maker, or
    from a numbered keepsake of a night.
  - Only moments are scarce (founder decision). Keepsakes are numbered and never return. Anything you wear or place
    can return in a later season, and later copies carry their year, so missing a night never locks anyone out of a
    look.

**6. Here, away and back.**
- **Why:** nothing is lost (principle 5). Ultima Online let unpaid houses collapse after about 90 days, and other
  players looted what was inside. That is the opposite of a home.
- **So:**
  - Every leaf that belongs to someone defines three states. Away is always dim or resting. It is never gone, smaller,
    hungrier, sicker or taken.
  - Nothing decays, withers, starves, runs away, folds up or is reclaimed while its owner is away.
  - Back is a moment for the person and their neighbours, never a bill.
  - A home folds only when its owner chooses to leave it (rule 9), or when its kingdom is deleted (`Monarch.md` §10).
    It folds whole into the owner's keepsakes and can be unfolded again.

| Leaf | Here | Away | Back |
|---|---|---|---|
| **Light** | lit | dark, or an ember if a friend keeps it | relights, and the street sees it |
| **Home** | windows lit, smoke from the chimney | resting on its lot; nothing moves | lights come on; "welcome back" |
| **Body** | walks, or idles near home | not shown | comes through the gate |
| **Companion** | at your side, or out on your street | waits at your door | runs to meet you |
| **Sub piece** | bright | dim while the sub has lapsed, still worn | bright again on the resub |
| **Garden** | grows on days you are here | paused, never withered | the harvest is waiting |
| **Friendship** | grows with shared moments | quiet, never broken | "long time no see" |
| **The kingdom** | awake while the stream is live | resting, still open | wakes with the beacon |

**7. Others can only add, and only kindly.**
- **Why:** nothing anyone does can damage, take or lose what someone else built (`ChatDom.md` §9). Kindness leaves a
  trace; unkindness leaves nothing (principle 15).
- **So:**
  - No act lets one person remove, move, change or cost another person anything. A visit is to look, sit and sign the
    guestbook.
  - What others may add is small and kind: a flower, a signature, a gift, an ember for an absent friend. The owner can
    clear any of it. Mischief is cosmetic, short and easy to opt out of.
  - Nothing negative lasts: no dislikes, no low ratings, no marks of shame. Moderation hides and reverts with a reason,
    and never deletes in silence (`Tech.md` §13).
  - The monarch grants and never takes. No moment, foe or contest takes anything from a kingdom: a failed defence
    leaves a memorial, not a loss.
  - A refusal at the forge may air as a nameless comic beat, never with the words or the maker (`Safety.md` §5.3).

**8. Money buys expression and spectacle, never standing.**
- **Why:** this is `ChatDom.md` §8 applied to every branch. A rule that holds in the shop but leaks through a pet or a
  plaque does not hold.
- **So:**
  - Every leaf states its money line, using the table below.
  - Bits buy moments, and things that last a day in the kingdom. Nothing bought with Bits is permanent for the buyer
    (founder decision; `Twitch.md` §6 and §17). A shared moment that Bits started may leave the same keepsake to
    everyone who took part, the buyer included, and nothing extra for the buyer.
  - Anything bought is bound to its buyer, is never random, and never counts toward any score.
  - When a viewer pays, everyone present gets the show. What a moment gives is the same for everyone present, inside
    the daily caps, never in proportion to spending.
  - Subs show in three places only: sub pieces, the light's tint and the address (sub months help pick your street
    within your quarter). Never in a vote: one person, one vote (founder decision). Trust never weights a vote either;
    it may only decide who may vote.
  - Givers carry no mark of their giving. A gift's giver is named on the gift, in the home of the person who received
    it.

| Branch | Bits may | Subs may | Money never touches |
|---|---|---|---|
| **Beings** | start a moment with a creature, such as the great beast flying low over town | tint your light, in your kingdom of the sub | the size or strength of a light, any creature, a creature's growth, ranks, crowns |
| **Things** | lend you a piece for the night, such as tonight's look from the pageant rack | grant sub pieces, which dim when the sub lapses and never vanish | glow, tools, materials, placed pieces, anything that lasts past a day, anything random, anything that can change hands |
| **Places** | light up a place for the night | colour your home's banner; sub months count toward your address | plot size, a quarter of its own, the shape of shared places |
| **Acts** | add flourish, such as fireworks rising from your home | nothing | votes, seats, outcomes, coals at the forge, any count of effort |
| **Moments** | start a spectacle everyone sees | nothing beyond their pieces | what each person present receives |
| **Time** | nothing | nothing | skips of any kind |
| **Memory** | show the moment in the night's Chronicle; leave everyone who took part in a shared moment the same keepsake | sub months on your card | a keepsake or record for the buyer alone, names on shared stones, titles, any mark for giving |

**9. One person, up to three homes. People travel; places stay.**
- **Why:** founder decisions, 2026-10-29: a person has one Twitch identity across every kingdom and may live in up to
  three of them, and a streamer can be monarch of their own kingdom and a citizen in others. Kingdoms connect
  (principle 13), and culture travels only by people (principle 10).
- **So:**
  - A person lives in at most three kingdoms (founder decision). A monarch's own castle does not count toward the
    three, so a streamer may hold three homes elsewhere (founder decision). In their own kingdom the castle still
    acts as their home for coals: they earn and spend coals there like any citizen.
  - What is part of the person travels with them; what is part of a kingdom stays in it (table below). Standing earned
    or shown in one kingdom (sub pieces, tenure pieces, rank marks) is worn only there.
  - Everywhere else a person is a guest. Their light still burns while they are in that chat, their history still
    gathers, and a first word still pitches a traveller's tent at the edge of town. The tent becomes a home only when
    they have a free place, so a guest who later settles finds their history waiting.
  - To settle somewhere new with three homes already, a person leaves one. That home folds whole into their keepsakes,
    and its lot rests as a tended garden with their name, so the street keeps its shape. If they come back with a free
    place, the home unfolds on the same lot.
  - Every citizen card shows every home a person has, and their passport: the stamps of every raid and visit, a
    creative part of the card. A "hide my travels" switch hides the passport, never the homes (founder decision). The
    risk is that one community sees where else its members belong; the cap of three keeps that list short.
  - Things a person made or found stay in the kingdom where that happened. Your homes in different kingdoms do not
    share a cellar, so "it only exists in our kingdom" stays true. A thing crosses into another kingdom only from one
    person's hands to another's, by gift or swap, and its story says where it was made and who brought it.
  - A companion lives at one home. It may walk with its person on a visit, as a guest, and goes home with them.
  - Standing never travels: rank marks and honours stay in their kingdom, and a guest has no powers (`Tech.md` §6.7).
  - There is one crown in each kingdom. Abroad, a monarch is a citizen or a guest of honour, marked by their own
    kingdom's banner, never crowned.

| Travels with the person | Belongs to one kingdom |
|---|---|
| Twitch identity and name; body and look; worn things won or made, each showing its home crest; the passport | The home and lot; the light there, and its tint; tenure, rank, sub and tenure pieces, and purse there; companions; placed pieces, forged pieces and keepsakes |

**10. Given freely, swapped fairly, never sold.**
- **Why:** giving is how kindness leaves a trace. A price starts a market, and a market turns every account into a
  target. Habbo removed player trading in 2020 and had to restore it in 2021: a trading rule is written once and kept.
- **So:**
  - A gift is one-way and adds a line to the thing's story.
  - A swap is one thing for one thing, by consent, with no currency and no price shown. Swaps happen only between
    kingdoms, on visits and raids, and they draw trade routes on the Atlas. At home, things are only given (founder
    decision).
  - No currency is ever given, swapped or sold.

| Never changes hands | Given once, then it stays | Given and swapped |
|---|---|---|
| Light; tenure, rank and sub pieces; anything bought with Bits; keepsakes; companions; homes and lots; purses | Things won in a moment that you wear or place, such as a cape of dragon scales: "I won this and want you to have it" | Forged pieces, crafted things, decorations, spare duplicates, small bundles of gathered materials |

**11. One tree at every size, and three ways in.**
- **Why:** every size is welcome (principle 9), and watching is playing (principle 8).
- **So:**
  - Every leaf works for the nine people in a hamlet and for the crowd in a capital. Personal rates are the same
    everywhere. Shared goals are sized from who is actually there.
  - Every leaf says how it reads on stream, what one chat message does, and what walking adds. A leaf only for walkers
    must still show on stream.
  - No leaf needs a crowd to exist, and none breaks under one.

**12. Your shape, the kingdom's hand.**
- **Why:** "the citizen owns the big shapes and the kingdom owns the small ones" (principle 11), well beyond
  building.
- **So:**
  - In every branch, the person chooses the big things: what, where and which colours. The kingdom adds the finish:
    trims, moss, its palette and its style kit. So very different homes and looks still read as one place.
  - Everything uses one master palette and the kingdom's colours, at one of three scales (`Quality.md` rule 10).
  - Everything that looks usable is usable, and every act has its own animation and sound (`Quality.md` rules 6, 12
    and 16).

## 3. Beings

**A being has a will or a face. Every being belongs to someone, and its owner decides its rules.**

| Kind | Belongs to | For | Made of | Grows by | Comes from |
|---|---|---|---|---|---|
| **People** | themselves | being seen as yourself, and being at home | one Twitch identity, one body and one look everywhere; a light and a card in each kingdom; a home in up to three | tenure, honours, what they make and wear | a first message, lighting up in the panel, or signing in with Twitch |
| **The monarch** | the kingdom | pride: "look what my community built" | a person, with the crown, the throne and the beacon | the kingdom's growth | founding |
| **Companions** | one person | the part of you that stays when you leave | a hand-made species, its stage, its calling, a personality, a bond with you, sockets for small cosmetics | days together, and what you do together | moments and care |
| **The kingdom's own** | everyone | lore the whole chat writes together | the great beast: a line, a name, a temperament from what chat feeds it. The dragon: a hand-made hero | full streams, chat's feeding, fights | founding; Twitch moments |
| **Wild creatures** | the land | a living world to watch, catch and befriend | hand-made species with habitats, hours and weather; one native variant per kingdom | seasons | the land and its calendar |
| **Townsfolk** | a place | hosts for places when few people are around | a hand-made character with a personality, a routine and a memory of witnessed facts | they do not grow | founding |

**People:**
- One person, many kingdoms. A viewer of five channels is one person with one look. They live in up to three of those
  kingdoms and are a guest in the others (rule 9). A streamer is monarch of their own kingdom and may be a citizen in
  a friend's.
- One body for everyone, polished, at the level of Trove or Minecraft: rigid voxel parts on one skeleton of about 14
  bones, chibi proportions, a face plate where chat's emotes show, and sockets for a hat, the face, the back and both
  hands (`Tech.md` §8.3).
- A look is parts and dyes, never a whole-body skin, so 50,000 citizens look like 50,000 people. Defaults come from
  Twitch, such as the chat colour for the cloak. Roblox fits every garment to every body with inner and outer
  "cages"; Chatdom's simpler version is one skeleton and fixed sockets, so every worn piece fits every citizen.
- A quiet one is an unnamed light until they chat, light up in the Chatdom panel or sign in. Their history gathers
  under their name meanwhile, and their home lights with it the first time they act (`Tech.md` §7.1, `Twitch.md`
  §16). Signing in with Twitch is needed to walk in.
- The roles are the ones in `ChatDom.md` §4, held per kingdom: the same person can be a citizen in one, a visitor in
  another and the monarch of a third. Twitch roles such as moderator and VIP become offices in the world, and
  `Twitch.md` owns them.
- Citizens are always people (founder decision), with fey touches such as ears, skin tones and face styles. Animal
  charm lives in companions.

**The monarch** holds the crown, which nobody else in that kingdom can hold. They live in the castle, not a house,
and the beacon is their light. Only the streamer presses royal acts, each a single gesture (principle 7), and they
have no private favourites. Their avatar sits on the throne and appears only at acts they press, or when they walk it
themselves (`Monarch.md` §7.6). Abroad, the crown stays home (rule 9).

**Companions** are pets and mounts:
- They never die, decay, breed, fight or change hands, and are never bought, by anyone, for anyone. Webkinz tied
  full membership to buying a new pet each year, and Club Penguin's neglected puffles ran away. Chatdom refuses both.
- A pet comes from a moment or from care: a stray that picks your doorstep on your first night, a creature befriended
  in the wilds, an honour, a creature born on a night the community remembers. Its birth certificate says which.
- It grows in stages by days together and takes a lasting calling from what you do together. It reacts to your chat
  messages wherever it is: the cheapest love in the design (`docs/08-depth-pets.md`).
- One companion walks with you, and a small household waits at home, sized by your home. Each companion lives at one
  home, in one kingdom, and may walk with you as a guest when you visit another. Mounts differ by what they do. Only
  the monarch flies.

**The kingdom's own creatures** belong to everyone and are never owned:
- The great beast (working name: the Hearthbeast) hatches on the first stream, and chat names it, feeds it and shapes
  it. It grows by full streams, so a big chat cannot outgrow a small one in a night. Once grown, the monarch can ride
  it.
- The dragon is the great foe, made by hand as the game's centrepiece (`Artstyle-Soul-Feel.md` §7). It is earned,
  never called on demand: Twitch's Hype Train wakes it, and chat can ring the Wyrm Bell for it for free
  (`Twitch.md` §7). No cheer and no royal press wakes it. It never takes anything. When it is not beaten, it retreats
  with a scar and returns.

**Wild creatures** follow the hour, the weather, the season and the real moon. Some can be befriended. Each kingdom
has a native variant of a hand-made species: the magic chooses its colours, name and habitat, so it lives nowhere
else.

**Townsfolk** are a few keepers of places (founder decision), under strict rules:
- They are few, and each keeps a place: an innkeeper, a lamplighter, a ferryman. They have no light, are never
  counted, never post in Twitch chat, and step indoors as real people fill the streets.
- They speak only facts the kingdom witnessed, in lines written by hand and voiced by the magic.
- Animal Crossing gives hundreds of villagers their character from eight shared personality types. A small family of
  personalities lets townsfolk and companions grow in number without each being written from scratch.

**Examples:**
- A grey kitten watches Mara claim her plot, hops down from a barrel and sits by her door. Its certificate reads
  "adopted the night of the Fernwood raid".
- Chat feeds the great beast pepper for a week as a running joke. At its moult it grows spines, and the next time the
  dragon wakes, the monarch rides it into the fight.
- A wild otter wanders into the plaza on stream. One chatter befriends it with one message, without ever opening the
  kingdom.

**To extend.** A new species is a hand-made body on an existing creature rig family, plus a data card: habitat,
hours, personality and callings. A new kind of being, such as a guardian that lives in a wonder, needs a new row in
the table above and a stated owner.

**Tech limit.** Each walker sees its nearest 64 people in full, and a big kingdom runs several copies of the town of
about 300 walkers each (`Tech.md` §6.2). That is why one companion walks with you and the rest wait at home.

## 4. Things

**A thing is something a person can own. It lives in one place: on the body, in the hand, on the lot, on the shelf or
in the bag, or it is used up. Where it lives decides its branch.**

Every thing has a hand-made shape (model, size class, dye channels, and the slot or socket it uses), a use and a
sound, a story, a run (always available, or seasonal with later copies dated), and a rule for changing hands. A thing
has one definition and many copies. If two copies could ever be told apart by a person, each has its own story.

| Branch | Lives | For | Made of |
|---|---|---|---|
| **Worn** | on the body | being seen as yourself; your history readable from your hat | parts that replace the body's shell (top, legs, feet) and pieces on sockets (hat, face, back, hands), with three dye channels and an optional glow |
| **Held** | in the hand | the verbs of the world | tools (rod, pick, axe, net, watering can, bell) and toys. A tool gets better by doing, never by paying |
| **Placed** | on the lot | making a home yours | materials you sculpt; placed pieces with identity (doors, lamps, beds, forged parts); kits that stamp into your walls and leave no identity; blueprints, which are recipes |
| **Kept** | on the shelf, or in a display piece at home | proof you were there | certificates, scales, ribbons, postcards, stamps, letters |
| **Gathered** | in the bag, as stacks | a reason to go out, and the supply of making | fish, ore, wood, flowers, seeds, feathers. Every material ends somewhere you can see |
| **Used up** | gone after use | small delight and small spectacle | fireworks, sky lanterns, confetti, treats, a charm that lasts one stream |

**Rules for things:**
- **The Forge is a source, not a branch.** Today it makes placed pieces for house slots only, in the kingdom's style
  kit, so each is unique to that kingdom (`Tech.md` §11). It opens branch by branch: worn pieces next, creatures never.
  It burns only while the stream is live, and each forge takes a coal a citizen earns by being there (`Safety.md`
  §3.2).
- **Pieces, never skins.** No worn thing replaces a whole person.
- **Tenure pieces are earned only,** such as a carved doorstep stone at 12, 24 and 36 months of following.
- **Sub pieces show something true** (`Twitch.md` §5 sets the list). Tier 3 adds the rainbow cape. It is animated:
  an elegant colour shimmer, like the star in Super Mario, cycling through the palette's own ramps (founder decision). Sub pieces belong to the kingdom of the sub. When a sub lapses they dim but are
  still worn, and they brighten on the resub.
- **Only moments are scarce.** Keepsakes are numbered. Worn and placed things return in later seasons, dated.
- **Flags are curated banner pieces:** hand-made identity and national flags, never slogans, parties or movements
  (`Safety.md`).
- **Nothing with a story is destroyed.** It can be put away, never thrown away. Only spare stacks can be dropped.
- **Used-up things never become a chore:** no hunger, no wear, no fuel you must keep buying.
- **Tech limit.** Everything built sits on one 0.125 m lattice with a 0.5 m default brush, and worn things are finer,
  at 0.0625 m (`Tech.md` §9.1). Every thing belongs to exactly one scale.

**Examples:**
- cozy_otter types a sentence and a dragon chimney cools on her roof: lilac, blowing heart-shaped smoke, "forged by
  cozy_otter during the Hype Train of 28 Oct". The same words make a hex-crystal chimney in another kingdom.
- A carved doorstep stone at 24 months of following, worn smooth by time, which nobody can buy.
- A rainbow cape, dim but still worn after a sub lapsed, brightening on the night of the resub.
- A dragon scale on the shelf: "fell on the night of the 14th train".

**To extend.** First ask where the new thing lives. If it lives somewhere that already exists, it is a leaf: fill in
the card. If it needs a new place to live, such as something that hangs from a companion, that is a new socket. A new
socket is an art decision before it is a design.

## 5. Places

**A place is where people belong or gather. Every place has a keeper who may shape it, a purpose, and a way of
showing who is there.**

| Place | Keeper | For | Grows by |
|---|---|---|---|
| **The land** | the kingdom, from its channel, founded live on stream (`Monarch.md` §5) | a landscape that is this community's own | the wilds step back as the kingdom grows; seasons change it |
| **Homes** | the citizen, in up to three kingdoms | belonging made visible: a door with your name on it | the lot deepens as you show up and make things |
| **Streets** | the residents together, within the street's kit | neighbours, and history you can read by walking | each tenure quarter grows at its own edge |
| **Civic places** | the monarch keeps the castle and plaza; everyone builds the wonders, to a design the monarch picks | gathering: the castle, plaza, forge, tavern, campfire, gate, market and wonders | new civic places as everyone shows up, including channel points given to the kingdom's pool |
| **Rooms** | the keeper of the building | warmth: candlelit rooms shared with everyone inside | more tables as the kingdom grows |
| **The wilds** | the land | exploring, gathering, befriending | new ground beyond each new street |
| **Between kingdoms** | `Atlas.md` | meeting: the gate, the road and the map | what communities do together (`Atlas.md`) |

**Rules for places:**
- **Your address is your history.** The town is laid out at founding in tenure quarters, one for each year, oldest by
  the castle, each growing at its own edge (founder decision). Your follow year picks your quarter. Within it, your
  street is set once, when you settle, from months followed, nights present and months subscribed, as principle 3 asks
  ("how long you have subscribed"). Sub months move you a street, never a quarter (`Twitch.md` §5). So a four-year
  follower who arrives late still lands among their own year, and nobody moves. A
  newcomer's tent stands at the edge of the newest quarter and becomes a home if they come back (`ChatDom.md` §4).
- **A lot is yours whole, from the day you claim it.** It is reserved at 8 m of frontage, 16 m deep and 20 m tall. As
  you grow, the back fence moves from 8 m to 16 m. The part not yet open is a tended meadow, never bare ground. Nothing
  ever moves, so neighbours stay neighbours (`Tech.md` §9.3).
- **Homes rest; they never fold.** A home whose owner is away keeps its lot and its street (rule 6).
- **Build in private, publish to the street.** You build in a draft. Neighbours see a scaffold with you working on it,
  then the finished home. Free voxel building opens when you come back (a return visit, or 30 days of following); a
  newcomer starts with a starter home and placed pieces (`Safety.md`).
- **A home's sign carries its name, icons and one free sentence,** checked like every made thing (`Safety.md`).
- **Each in their place** (founder decision). Residents shape their own street within its kit. Everyone builds the
  wonders, to a design the monarch picks. The castle and the plaza are the monarch's.
- **Every door opens.** Rooms are real rooms you walk into, and inside, the light turns to paint
  (`Artstyle-Soul-Feel.md` §10).
- **Games are places.** Every game lives at a table, the campfire, the arena or the plaza (principle 12).
- **Age is beauty.** Patina grows with tenure, and paths wear where people really walk (`Artstyle-Soul-Feel.md`
  §6.6).
- **Between kingdoms is a short branch here.** `Atlas.md` owns the map, how kingdoms are drawn on it and how you
  enter them. Every other branch needs only two facts from it: things cross only from one person's hands to another's
  (rule 9), and whatever communities leave on the map is a trace that stays.

**Examples:**
- Old Row by the castle, lined with the homes of people who were there in the first month, their stone doorsteps worn
  smooth.
- The tavern at night. As you cross the threshold the light turns to paint, and at an empty table someone asks for
  "liar's dice, but pirates".
- A garden of crooked bell towers that chat built in five minutes each, every one with a date and a plaque.

**To extend.** A new place answers two questions: who keeps it, and what is it for, in the words of `ChatDom.md` §5.
If it needs a new keeper, it changes the table above.

## 6. Acts

**An act is something a person, a pair or a crowd does. Every act can be done with one chat message, a walker's hand
or the monarch's single gesture, and leaves either a kind trace or nothing.**

Every act declares who does it, how (chat, walking or a royal gesture), its consent (alone, aimed, paired or as a
crowd), what it leaves, how it reads on stream, and its limits.

| Family | Examples | One chat message | Leaves |
|---|---|---|---|
| **Being here** | lighting your light, arriving, coming back | any message, a tap in the panel, or just watching | light, streaks, tenure |
| **Showing** | an emote on your face, a wave, a bow, a cheer, raising your light | `!wave` or an emote | nothing lasting |
| **Together** | high five, hug, sitting together, dancing in pairs | no | a moment in a friendship |
| **Giving** | gifts, a flower on a doorstep, a guestbook line, keeping a friend's ember, channel points to the kingdom's pool | some | a kind trace with your name, on the gift |
| **Swapping** | one thing for one thing, by consent, only between kingdoms | no | a line in both stories, and a trade route |
| **Making** | building, forging, crafting, planting, naming | `!forge` and your words | a thing with your name on it |
| **Playing** | sitting at a table, asking for a new game, the campfire, chat against the monarch | one move or one vote | ribbons, ratings, keepsakes |
| **Exploring** | fishing, digging, foraging, befriending, finding a view | `!fish` from the pier | stacks, keepsakes, Almanac entries |
| **Tending** | caring for a companion or a garden, feeding the great beast | `!feed` | growth |
| **Acting as a crowd** | voting, hauling stone, striking the dragon, chanting, a wave of raised lights | yes | a shared result with every name |
| **Ruling** | knighting, decrees, blessings, crowning a game, naming, opening the gate | the monarch's keys | an honour, a plaque, a road |
| **Travelling** | visiting, marching out on a raid, crossing a bridge | following the raid in chat | passport stamps, roads |

**Rules for acts:**
- **Twitch chat is the only live text.** What a walker types in the world is sent as their real chat message, so the
  channel's own rules and moderators apply. Voice exists only at the campfire and in the throne room, while live,
  with the streamer seated, for people aged 16 or over (`Tech.md` §10.6).
- **Closeness is earned with each person.** Paired acts need consent and open up as a friendship grows. Sky: Children
  of the Light opens hand-holding, high fives and hugs one by one inside each friendship; Chatdom does the same
  without Sky's candle price, because connection is never paid for.
- **Strangers start with gestures.** Words come with trust and friendship. Toontown let strangers talk through a menu
  of set phrases, which keeps a kingdom safe for a 13-year-old.
- **Chat's great power is acting as a crowd.** Votes, hauls and strikes are counted in windows long enough for stream
  delay. One person, one vote: no vote counts more for a sub, a rank, trust or money (founder decision). Trust may
  only decide who may vote.
- **Only the streamer presses royal acts** (founder decision). Each is a single gesture, always public and always
  adding.

**Examples:**
- 87 chatters fed the great beast tonight. It is full and asleep, and one line in chat thanks them.
- At the monarch's call, chat types `!light`, and the director shoots every lit window in the kingdom lifting its
  light.
- Someone leaves a flower on the step of a person they have never been online with. A week later the vase is full.

**To extend.** A new act names its family, its three ways in, its consent, its trace and its limits. A new family is
rare: most new verbs join one of the twelve above.

## 7. Moments

**A moment is something that happens to everyone at once. It has a cause, a sign, a gathering, a peak and a trace,
and everyone present receives the same.**

| Part | Meaning | The dragon, as an example |
|---|---|---|
| **Cause** | what starts it | Twitch's Hype Train reaches its third level |
| **Sign** | how the world announces it | the sun dims and the beacon flares red |
| **Gathering** | how anyone takes part with one message | `!strike` in chat, or swing whatever you hold |
| **Peak** | the spectacle, sized to the crowd that is there | the dragon lands in the plaza and the whole town fights |
| **Outcome** | the same for everyone present, never in proportion to spending | a scale for every fighter |
| **Trace** | what stays | a scar on the dragon, a verse in the Ballad, a line in the Chronicle |

| Family | Caused by | Examples |
|---|---|---|
| **Twitch moments** | Twitch (`Twitch.md` owns each one) | going live, a raid arriving, a cart of gift subs, the dragon |
| **The calendar** | the kingdom's clocks | dusk and rest each night; a season's opening, festivals, crowning and quiet last week; founding day |
| **Royal moments** | the monarch's single gestures | a knighting, an audience, a decree, crowning a game |
| **World moments** | the land | a storm, a migration, a meteor shower, a rare sighting |
| **Personal milestones** | one person's history | a first night, a housewarming, coming home, a sub anniversary, a hatching |
| **Between kingdoms** | two communities | a raid out, a bridge in shared chat, a crowning on the map |

**Rules for moments:**
- **Calm by default, spectacular on cue.** Spectacle is rationed, so it always feels earned. A small act gets a small
  delight; a community moment gets the sky (`Artstyle-Soul-Feel.md` §2 and §8).
- **Cause and effect are visible.** The spark starts at its cause and travels to its result.
- **Rules 7, 8 and 11 apply in full.** No moment takes anything, money changes nobody's share, rewards count inside
  the daily caps, and every moment is sized from who is there, so 5 viewers and 50,000 finish in the same time.
- **Big spectacles are earned.** They come from Twitch moments and chat's effort, never on the monarch's demand
  (founder decision).
- **A moment keeps Twitch's clock.** Its climax never waits, even when the streamer is busy (`Monarch.md` §6.4).

**Examples:**
- Going live: the sky spins to dusk, the beacon catches and the lights come on one by one.
- The season's last week: nothing to earn. The wonder freezes into a monument, and every light in the kingdom dims
  for ten seconds and relights at once.
- A housewarming: the director circles a new home for six seconds with its owner's name over the door.

**To extend.** A new festival, event or ritual fills in the six parts above, names its family and passes the leaf
test. If its cause is a Twitch event, `Twitch.md` defines the event; this file defines only its shape.

## 8. Time and growth

**Everything grows forward, at the pace of days. Nothing grows faster for money, and nothing shrinks for absence.**

| Clock | Counts | Drives |
|---|---|---|
| **The minute** | presence | light, and rewards for showing up |
| **The night** | one stream | the kingdom wakes and rests; the night's Ballad |
| **The stream day** | a day you were there | companions, gardens, friendships and ranks |
| **The season** | about 13 weeks, from a solstice or equinox to the next | festivals, the race for the most epic kingdom, the crowning |
| **The year** | the kingdom's age and your anniversaries | founding day, tenure pieces |
| **Tenure** | Twitch time you bring to each kingdom: following since, subscribed for, in that channel | your address, your tenure pieces, your card there |

| What grows | Grows by | Never by | Shows as |
|---|---|---|---|
| **The person** | in each kingdom, its own tenure, streaks, deeds and honours | money, or a single binge | pieces on the body and home, the card, patina |
| **The home** | showing up and making | money | the back fence moves; new materials, heights and pieces open |
| **Companions** | days together, and what you do together | money | stages and a calling |
| **Friendships** | shared moments over many days | gifts that were bought | new paired acts |
| **The kingdom** | everyone showing up together, including channel points citizens give to its pool | money, including any share of subs | new streets, civic places, the great beast's stages |
| **The wilds** | the kingdom's growth | anything else | new ground and new creatures |
| **The map** | raids, bridges, gifts and swaps | anything else | roads and routes |

**Rules for growth:**
- **Only forward.** Nothing shrinks, regresses or resets. Seasons add; they never wipe.
- **Days, not hours.** Ranks need days present as well as deeds; the great beast grows by full streams; friendships
  need days. Neither a binge nor a bot can rush anything.
- **History counts from day one.** A four-year follower arrives with four years.
- **Time is the fairness of the kingdom,** which is why money can never skip it (rule 8). Channel points are earned
  by watching, so giving them to the kingdom's pool counts as showing up (founder decision; `Twitch.md` §8).
- **Growth shows in the world,** never only as a number: a deeper lot, a worn step, a grown companion.

**Examples:**
- A quiet one who never types brings their companion to its closest bond in about ten months, just by being there.
- The flame over your door grows with your streak. If the streak breaks, your best streak is kept forever.
- The great beast moults after 15 full streams, and the food chat fed it most decides its form for good.

**To extend.** A new growth path names its clock, what makes it grow, what never does, and how it shows in the world.

## 9. Memory

**The kingdom remembers what truly happened, and says it with love. It forgets unkindness.**

| Record | Holds | Where it shows |
|---|---|---|
| **Stories** | who, where, when, how, and for whom | on every thing's card |
| **Honours** | ranks, titles, knighthoods and crowns: the kingdom's memory of what you did | on your nameplate and card |
| **The citizen card** | one per kingdom: following since, subscribed for, citizen number, home, what you made. Every card lists all your homes, and your passport unless you hide your travels (rule 9) | a carved plaque in the world, `!card` on stream, a share link |
| **The passport** | a stamp for every raid ridden and every kingdom visited, drawn with care as part of the card | on the card, public by default |
| **Plaques** | names in the world: a street's name, the great beast's namer, a wonder's builders, a crowned game's author | stones, signs, benches |
| **The Almanac** | what you have seen and owned, and your firsts | your book |
| **The Voice of the Realm** | the night's Ballad, the crier's words, the season's crowning | spoken in the world and on stream |
| **The Chronicle** | the season and the year | read at the crowning and on founding day |
| **The Gallery** | clips viewers made, and the director's stills of great moments; the kingdom makes no clips or videos of its own (founder decision) | the castle gallery |
| **Roads on the map** | where communities met | the Atlas (`Atlas.md`) |
| **Keepsakes** | that you were there | your shelf (§4) |

**Rules for memory:**
- **Every fact spoken was witnessed.** The Voice, and any townsfolk, say only what is in the kingdom's record
  (`ChatDom.md` §5).
- **Memory names the kind and forgets the unkind.** A deleted message vanishes from every replay, and a timeout leaves
  no lasting mark.
- **The big records can be vetoed.** The monarch may strike a Ballad line before it is pinned.
- **Memory can be shared.** Every card has a link.

**Examples:**
- "Professor Mothball waited 22 days for saoirse_k."
- The night's Ballad: eight lines about the night chat beat the streamer at chess.
- A game someone asked for at a tavern table, crowned by the monarch, carrying its author's name into forty kingdoms.

**To extend.** A new record says which facts it reads, where it shows, and who may veto it.

## 10. Where things come from

Every leaf names its sources from this table. "Twitch" means Twitch moments other than support, and `Twitch.md` says
what each one does. Subs and Bits are support, limited by rule 8.

| | Showing up | Making | Playing | Exploring | Giving | Twitch | Monarch | Calendar | Subs | Bits |
|---|---|---|---|---|---|---|---|---|---|---|
| **Light** | yes | no | no | no | no | streaks | honours | no | a tint | no |
| **Worn** | yes | next, once sockets have shapes | yes | some | yes | yes | yes | yes | sub pieces | for the night only |
| **Held** | yes | yes | some | yes | yes | some | no | some | no | no |
| **Placed** | yes | yes | some | yes | yes | yes | yes | yes | banner colour | no |
| **Kept** | yes | yes | yes | yes | no | yes | yes | yes | no | only a shared moment's keepsake, the same for all |
| **Gathered** | yes | no | no | yes | small bundles | some | no | yes | no | no |
| **Used up** | some | yes | yes | yes | yes | yes | no | yes | no | no |
| **Companions** | yes | no | some | yes | no | by being there | yes | yes | no | no |
| **Home growth** | yes | yes | some | some | no | no | no | no | no | no |
| **Address** | follow time, nights | no | no | no | no | no | no | no | sub months | no |
| **Kingdom growth** | yes | wonders | some | materials | channel points to the pool | no | picks designs | festivals | no | no |
| **Honours** | yes | yes | yes | some | for kindness | some | yes | yes | no | no |

## 11. The depth round, read against this tree

The eight depth designs (`docs/08-depth-*.md`) and their synthesis (`docs/09-depth-synthesis.md`) already agree on
most of this tree: a story on everything, presence counted once, crowd inputs counted in windows, a ledger that
refuses money aimed at standing, pets that never die, and no market. Keep those.

Some ideas were written before the founder's decisions of 2026-10-29, or break a rule above. They do not fit as
written:

| Idea, and where | Breaks | What fits instead |
|---|---|---|
| Absent homes dim at 30 days and fold into storage at 90 (`docs/07`; the building, items, pets and progression designs) | rule 6; principle 5, "homes wait" | Homes rest on their lot for as long as it takes |
| The Waiting Green, where pets of folded homes are moved (pets) | rule 6 | Pets wait at their own door. A green may be a place pets like to visit, never where they are sent |
| The Royal Treasury: subs fund up to 25% of each Town Hall level (progression; `docs/09` §2.21) | rule 8; `ChatDom.md` §8 | The kingdom grows only from showing up |
| The Elder rank's light that burns while its owner is away (progression) | rule 2 | Elders get a seat and a plaque; their light burns only when they are here |
| Sub tiers that make the flame bigger, brighter or a different form (`docs/05`; progression) | rule 2 | A quiet tint in the tier's colour only |
| Bits that buy light or anything lasting: a statue of you, Beacon Night with a season title, a gilded finish on your lantern, a glowing home, a pageant piece you keep (items; progression) | rules 2 and 8 | Bits start a moment everyone sees, or lend something for a day; the night's Chronicle may show it |
| A creature for each gift-sub recipient (pets) | rule 8: creatures are never bought, even for someone else. Rule 6: a sub piece dims, and a pet cannot | Gift recipients get a parcel and their sub pieces; the parcel names the giver |
| A sub quarter with deeded plots for subscribers (an earlier proposal) | rule 8; principle 3 | Tenure quarters, where sub months count as time |
| A gate whose stones carry the names of everyone who gifted subs (building) | rule 8 | The giver's name lives on the gift |
| The lowest Renown rank named "Visitor" (`docs/05`; progression) | `ChatDom.md` §12: a visitor is a guest from another kingdom | Another name for the first rank |
| Lanterns as a giftable item family with numbered runs (items) | rules 2 and 10 | The light is part of the person |
| Limited runs that never return, serial numbers on worn things, and a 1 in 400 chance shimmer (items) | rule 5: only moments are scarce | Numbered keepsakes; worn and placed things return, dated |
| Votes weighted by trust tier (0.25, 1, 2) (`docs/09` §3; building, pets) | rule 8: one person, one vote | Each person counts once |
| A home in every kingdom where a person chats (`Twitch.md` §12 and `Atlas.md` §6.1 as first written) | rule 9: at most three homes | A traveller's tent and a guest's light elsewhere |
| A Bits feast that counts as feeding the great beast (pets) | rule 8: money may start the moment, never the growth | The feast is spectacle only |
| Forged creatures, the "Curios" (pets) | rule 4: living bodies are made by hand | Forged things stay things |

Some depth ideas were simply overtaken by later founder decisions: free voxel building on your own lot replaces the
shell-and-props model, avatars soft-push rather than pass through each other, and voice exists at the campfire. Those
need no new ruling here.

## 12. How to extend the tree

The tree grows in four directions:
- **Down a branch:** more leaves of a kind, such as a new hat, species or festival. This is the cheapest growth, mostly
  data, and each season is the natural moment for a new page of leaves.
- **Into the magic:** a new shape opens a branch to the Forge, such as a socket for forged hats. Art comes first.
- **Across kingdoms:** a leaf learns to travel, by gift, swap or visit, as rule 9 allows.
- **A new branch:** a new kind of being, thing, place, act or moment. This is rare, and it changes this file.

**The recipe:**
1. Start with a person. Write one sentence about who feels more at home because of the idea, and when.
2. Ask what it is: a being, a thing, a place, an act or a moment. Then find its sub-branch by who owns it or where it
   lives.
3. Read the twelve rules (§2) and the rules of its branch.
4. Fill in the leaf card below.
5. Run the leaf test, then the eleven questions in `ChatDom.md` §12.
6. If it fits no branch, write down why. A new branch, or a new shape such as a socket, changes this file on purpose,
   with a line in the change log.

**The leaf card:**

| Field | In one or two lines |
|---|---|
| **Name** | in plain words and the kingdom's voice |
| **Branch** | for example, Things: held |
| **For** | who feels more at home, and how |
| **Made of** | its parts, and the shapes the magic may fill, or "hand-made only" |
| **Comes from** | its sources (§10) |
| **Grows** | its clock, what makes it grow, and what never does |
| **Here, away, back** | its three states (rule 6) |
| **Story** | its story line, as a template |
| **Money** | what Bits and subs may do, and what they never do |
| **Hands** | never, given once, or given and swapped (rule 10) |
| **Travels** | stays in its kingdom, or travels with its person (rule 9) |
| **Three ways in** | on stream, by one chat message, by walking |
| **Five and 50,000** | what it is at both ends |
| **Feel** | what happens when you touch it, its animation and its sound |

**The leaf test.** The answers must be yes, yes, no, no, no, yes, yes, yes.
1. Does a real person feel more at home because of it?
2. Is every light, nameplate and face in it a real person?
3. Could money buy anything in it that signals loyalty, effort or glory?
4. Could anyone use it to take, damage or remove what someone else has?
5. Does anything in it decay, shrink or leave while its owner is away?
6. Does it carry its story?
7. If the magic touches it, does it only fill shapes that already exist?
8. Does it work at 5 and at 50,000 viewers, and with one chat message?

**A worked example: kites in spring** (some fields left out).

| Field | Kites |
|---|---|
| **Branch** | Things: held (a toy) |
| **For** | a quiet, shared spring evening: everyone's kites over the meadow, which reads on stream as colour in the sky |
| **Made of** | a hand-made kite family with a sail and a tail. Later, once a sail shape exists, the Forge could fill the sail with a motif from the kingdom's emotes |
| **Comes from** | the calendar (the spring festival) and making (crafting) |
| **Here, away, back** | flown while you are here; put away when you go |
| **Story** | "Made by {maker}, spring {year}" |
| **Money** | Bits may fill the sky with kites for everyone for the night; nobody keeps a kite that Bits paid for |
| **Hands** | given and swapped |
| **Three ways in** | the stream sees the sky; `!kite` flies an unnamed kite from the hill; walkers fly their own |
| **Five and 50,000** | at 5, every kite carries a name; at 50,000, the sky is colour and only friends' kites are named |

## 13. Words

`ChatDom.md` keeps the vocabulary small. These words earn a place because the tree cannot be described without them.

| Word | Meaning | Why it earns its place |
|---|---|---|
| **Shape** | A form the magic may fill: a slot on a home, a socket on a body, a family, a style kit or a budget (rule 4) | Principle 16 already speaks of "shapes the kingdom already allows"; this names them |
| **Style kit** | A kingdom's own palette, motifs from its emotes, native material and shape language, written at its founding | It is how "what is forged there exists nowhere else" works (principle 10) |
| **Piece** | Any one owned thing with a story. A placed piece is one on the lot (`Tech.md` §9.2) | `ChatDom.md` says "sub pieces" and "tenure pieces", and `Tech.md` uses "piece" for placed things: one word, two scopes |
| **Story** | What a thing carries: who, where, when and how | The plain word for provenance, used on cards |
| **Keepsake** | A record of a moment you were part of. It never changes hands | It separates "I was there" from things you use |
| **Companion** | A pet or a mount that belongs to one person | One word for the branch |
| **Dim** | The away state: resting, never gone | One word for absence everywhere |
| **Bound** | Cannot change hands | The giving and swapping rules need it |
| **Townsfolk** | The few characters who keep places, plainly not people | The founder kept them; they need a name apart from citizens |
| **Tenure quarter** | The part of town laid out for one year of tenure, growing at its own edge | It is how addresses stay true when people arrive in any order |

**Sources for the lessons from other games:**
[Ultima Online house decay (Engadget, 2013)](https://www.engadget.com/2013-03-01-the-daily-grind-should-player-homes-decay.html),
[Webkinz membership help](https://webkinznewz.ganzworld.com/announcements/help/),
[Roblox layered clothing documentation](https://create.roblox.com/docs/avatar/accessories/layered-clothing),
[Trove creation guidelines (Trovesaurus)](https://trovesaurus.com/page=5624),
[Minecraft 1.20.5 item components (PaperMC converter)](https://docs.papermc.io/misc/tools/item-command-converter),
[Sky friendship actions (Sky wiki)](https://sky-children-of-the-light.fandom.com/wiki/High_Five_Action),
[Animal Crossing personality types (Thonky)](https://www.thonky.com/animal-crossing-new-horizons/list-of-villager-personalities),
[Toontown Online (Wikipedia)](https://en.wikipedia.org/wiki/Toontown_Online). Habbo, Club Penguin and Guild Wars 2
are cited with their sources in `docs/08-depth-items-cosmetics.md` and `docs/08-depth-pets.md`.

## 14. Decided on 2026-10-29

The founder answered this file's questions, and others that touch it, on 2026-10-29. Each answer is folded into the
rules and branches above.

| Question | Answer |
|---|---|
| Do townsfolk live in the kingdom? | A few keepers of places, plainly not people (§3) |
| Are avatars always people? | Yes, with fey touches only (§3) |
| Should the Forge reach beyond house parts? | Branch by branch: worn pieces next, creatures never (rule 4) |
| May worn or placed things be scarce for good? | No. Only moments are scarce (rule 5) |
| What may change how a light looks? | Time and honours, and a quiet sub tint by tier: warm gold, rose, a rainbow edge (rule 2) |
| How many homes may one person have? | At most three; a monarch's own castle does not count (rule 9) |
| What does a citizen card show of other homes? | Every card shows every home (rule 9) |
| Is the passport public? | Yes, on the card, with a personal "hide my travels" switch (rule 9) |
| Where may people swap things? | Only between kingdoms; at home things are only given (rule 10) |
| Where does a late long-time follower live? | In tenure quarters by follow year; sub months help pick the street within the quarter (§5) |
| Who shapes the shared ground? | Each in their place: residents their street, everyone the wonders, the monarch the castle and plaza (§5) |
| Do subs add vote weight? | No. One person, one vote, and trust never weights a vote (rule 8, §6) |
| Do gifters carry a mark? | No. The giver's name lives on the gift (rule 8) |
| What may Bits buy? | Moments, and things that last a day; nothing permanent for the buyer, though a shared moment may leave everyone who took part the same keepsake (rule 8) |
| May channel points grow the kingdom? | Yes, given to a shared pool and shown on stream (§8) |
| May the monarch call the dragon on demand? | No. Big spectacles are earned (§7) |
| Does a climax wait for a busy streamer? | No. It keeps Twitch's clock (§7) |
| Who presses royal acts? | Only the streamer (§6) |
| May the kingdom move the monarch's avatar? | Only at acts the monarch presses (§3) |
| What happens to homes when a kingdom is deleted? | They fold whole into their owners' keepsakes; a kingdom laid down otherwise sleeps, homes standing (rule 6) |
| Who may free-build with voxels? | Returning citizens; newcomers start with a starter home and pieces (§5) |
| May a home's sign carry free words? | One free sentence, checked (§5) |
| When does the forge burn? | Only while the stream is live, one coal a forge; coals come only from showing up (§4) |
| May a refusal air on stream? | As a nameless comic beat, never with the words (rule 7) |
| Which flags may fly? | Curated banner pieces only (§4) |
| May the Atlas count citizens shared between kingdoms? | Yes, from 20 people, in bands, with an opt-out (`Atlas.md`) |

**Still open:**
- **The form of light** (lanterns, candles or windows) stays open in `ChatDom.md` §11. Rule 2 holds for any form.
- **Whether a Bits piece lent for the day may also show on chatdom.gg** waits for Twitch's written answer
  (`Twitch.md` §17).

## Change log

- **2026-10-29: first version.** Written from `ChatDom.md`, `Artstyle-Soul-Feel.md`, `Quality.md`, `Tech.md`, the
  depth round (`docs/08`, `docs/09`), `docs/05`, `docs/10`, the Lanternmere autopsy, the founder's decisions of
  2026-10-29, and lessons from other games. Seven branches, twelve inherited rules, the leaf card and test, the depth
  ideas that do not fit, and nine questions for the founder.
- **2026-10-29: one person, many homes.** Founder note: one person has one Twitch identity across kingdoms and may hold
  a home in each; a streamer can be monarch of their own kingdom and a citizen in others. Rule 9 now says what travels
  with the person and what belongs to one kingdom, and Q2 asks what a card shows of other homes. The map moves to
  `Atlas.md`, and "between kingdoms" becomes a short branch that points there.
- **2026-10-29: founder answers folded in.** Townsfolk kept as a few keepers of places; avatars always people; the Forge
  opens branch by branch; only moments are scarce; a quiet sub tint on the light; at most three homes, every card
  showing every home and a public passport with a "hide my travels" switch; swaps only between kingdoms; tenure
  quarters where sub months count; each in their place for shared ground; one person, one vote; no gifter mark; Bits
  buy moments and day-long things only; channel points feed a shared pool; and the `Twitch.md`, `Atlas.md`,
  `Monarch.md` and `Safety.md` decisions that touch the tree. The questions section became a decision list.
- **2026-10-29: consistency pass.** A monarch's castle does not count toward the three homes (rule 9, §14). Bits leave
  nothing permanent for the buyer, and a shared moment may leave everyone who took part the same keepsake (rule 8,
  §10, §11). No cheer wakes the dragon (§3). Sub months pick a street within the follow-year quarter, never the quarter
  (§5). The sub tint sits at the light's edge, never on an unnamed light (rule 2). Trust never weights a vote (rule 8).
  The refusal beat points to `Safety.md` §5.3.
- **2026-10-29: consistency sweep after round 14.** The sub tint goes by tier, and the tier 3 cape is animated (rule 2,
  §4, §14). The castle acts as the monarch's home for coals, not for the three-home cap (rule 9). The kingdom makes no
  videos of its own; "the night's recap" is now the night's Chronicle (rule 8, §9, §11).
