# Twitch

The Twitch layer of Chatdom, both ways. Internal. Started 29 October 2026 from `ChatDom.md`, `Tech.md`, the design
documents in `docs/` and a fresh check of Twitch's rules.

This file decides, for every Twitch surface:
- what it becomes in the kingdom: the spectacle everyone sees, and the trace that lasts
- who is credited
- how it holds at 5 viewers and at 50,000
- what happens on a channel where it is missing
- what the kingdom says back to Twitch, and when it may speak

It also designs the Chatdom panel, a Twitch Extension under the video, and what Bits may do there.

It is a design file, not a spec. Five other files hold what it leaves out:
- `Tech.md` §7 owns the plumbing: the apps, the Herald, the consent tiers, EventSub, the reconcilers, the actions
  service and compliance. The tier of each surface below is the one in `Tech.md` §7.2.
- `World-Tree.md` owns the grammar of things. When a Twitch moment grants a cape, a banner or a keepsake, this file
  names the kind of thing and its rules, and `World-Tree.md` defines it.
- `Atlas.md` owns the map. This file says what a raid, a shared chat or a raid train becomes inside a kingdom.
  `Atlas.md` says how its mark looks on the map.
- `Monarch.md` owns the streamer's side: the throne, Busy, Show and how each royal power is pressed. This file owns
  what those powers write to Twitch.
- `Safety.md` owns what people make, including the Forge's coals.

When this file disagrees with `ChatDom.md`, `ChatDom.md` wins. Either this file changes, or `ChatDom.md` changes on
purpose with a line in its change log.

Twitch facts carry a label:

| Label | Meaning |
|---|---|
| [V] | Verified on 29 October 2026 against the primary source listed under Sources, for this file or for `docs/research/tech/twitch-integration.md` the same day |
| [K] | Prior knowledge or an earlier report, not re-verified today |
| [?] | Could not be verified. Ask Twitch in writing, or test it |

## 1. What Twitch is to a kingdom

Twitch is where the community already lives. The kingdom is that same life made visible (principle 6). Three things
follow:

1. **Everything on Twitch lands twice:** once as a spectacle on stream, once as a trace the kingdom keeps.
2. **The kingdom answers through Twitch's own tools:** polls, predictions, shoutouts and raids. It speaks in chat
   rarely, because chat belongs to the community.
3. **The panel brings the kingdom to Twitch.** Under the video, a viewer sees the kingdom's night and their own light,
   and a quiet one can light theirs with one tap.

Words this file adds to `ChatDom.md` §12:

| Word | Meaning |
|---|---|
| Spectacle | What a Twitch moment looks like in the world and on stream. It plays once |
| Trace | What a Twitch moment leaves behind: a piece, a mark on a home, a trophy, a road, a line in the Chronicle |
| The panel | Chatdom's Twitch Extension, under the video and in the phone apps |
| Lighting up | A quiet viewer making their light their own, from the panel, without typing in chat |
| Kingdom reward | A channel-point reward that Chatdom creates in the monarch's channel |
| The pool | Channel points that viewers give toward a building's next level, shown on stream and in the panel |

Channel-point rewards are not called spells here, because `Tech.md` §11 uses "spell" for a Codex run.

## 2. Principles for the Twitch layer

Each principle has a why and a so, as in `ChatDom.md`.

**1. Every Twitch moment lands twice: as a spectacle and as a trace.**
- **Why:** principle 6 says Twitch is the physics, and principle 5 says nothing is lost. A firework nobody remembers
  is an alert box. A plaque nobody saw happen is a database row.
- **So:**
  - Every surface in §3 has both, or says why not.
  - The spectacle is on stream within a second (`Tech.md` §6.6) and plays once.
  - The trace is small, true and dated. It names the night it came from.
  - Presence leaves the deepest traces. Money leaves the brightest spectacles and the lightest traces.

**2. Showing up is the biggest thing Twitch tells us.**
- **Why:** principle 2. Chat and the chatters list tell us who is here, every minute. That is worth more than any
  payment.
- **So:**
  - Presence decides whether your light burns and how long your streak runs. Nothing paid touches either.
  - Your address comes from your history in the channel: follow year, nights present and months subscribed (§5).
  - The quiet ones count without being named, and can name themselves with one tap. A light lit from the panel is
    presence, under the same idle checks as chat (§16).
  - In any hour, at least half the named beats the director shows are free ones: a first word, a homecoming, a forge,
    a fighter. Paid moments never crowd out presence.

**3. Money moves the sky, never the clock.**
- **Why:** `ChatDom.md` §8. If paid moments sped up progress, the kingdom with the richest chat would climb fastest,
  and a hamlet of nine could never be crowned.
- **So:**
  - Bits buy moments, and things that last one day in the kingdom. Nothing bought with Bits is permanent.
  - Subs are support shown on Twitch. They dress you in sub pieces, tint your light and count toward your address
    (founder decisions, §5).
  - No money ever buys a vote, the light itself, rank, crowns, scores, odds or time.
  - The Hype Train, a collective act of support, may open a door: the festival and the dragon. What anyone earns
    inside it counts inside the same daily caps as free play, so a rich night is a bigger night, not a faster climb.
  - The dragon is earned only: by the train or the Wyrm Bell, never by one cheer and never on the monarch's demand.
  - Money never fills a bar that showing up fills: no wonder stage, Town Hall level, commission or charge. Channel
    points are earned by watching, so they may fill a building's communal pool (§8), never anything personal.
  - Money never draws the map. Raids, shared chats and visits draw roads. Gift subs and cheers do not.

**4. When one person pays, everyone gets the show.**
- **Why:** `ChatDom.md` §8, and it makes support feel like a gift to the room rather than a purchase.
- **So:**
  - The payer is named in the moment. Nothing bought with Bits lasts beyond a day.
  - Everyone present sees the same spectacle. Nobody gets less for not paying.
  - Generosity to others lasts in their homes, with the giver's name. Spending on yourself lasts as a memory.

**5. Credit is true, and kind.**
- **Why:** principle 15, and the Voice of the Realm speaks only facts the kingdom witnessed (`ChatDom.md` §5).
- **So:**
  - Only what Twitch tells us happened is credited, by the name Twitch shows.
  - Anonymous gifts and cheers stay anonymous: "a friend of the realm".
  - Nobody is ranked by money or points. The kingdom never mirrors a Bits leaderboard, a gift count, a total spent
    or a list of top givers.
  - Losses are silent. A lapsed sub, a timeout, a ban or a removed VIP is never announced.
  - `!chatdom quiet` keeps a name off the stream and out of chat.

**6. Every size gets the same magic, by merging, never by dropping.**
- **Why:** principle 9.
- **So:** at 5 viewers every event is its own beat, spoken by name. In bigger kingdoms, events of one kind merge into
  one beat with a ribbon of names, and the kingdom shows a tide instead of a queue (§11). Nobody is ever told their
  moment did not play.

**7. Every surface works without money, and without the panel.**
- **Why:** principle 1. Many channels will not have every feature switched on, and many streamers will never install
  an Extension.
- **So:** every paid or optional surface has a free fallback (§14). The kingdom never shows an empty slot.

**8. The kingdom speaks rarely, and through Twitch's own tools.**
- **Why:** chat belongs to the community. The Herald shares one budget across all of Twitch (`Tech.md` §7.4). Every
  royal act must be one gesture (principle 7).
- **So:**
  - The kingdom tells its story on stream, not in chat.
  - It writes to Twitch on a royal gesture or a raid, speaks a rare line at a climax, and otherwise keeps quiet
    (§13). It never makes clips.
  - It never repeats what Twitch already shows, such as sub and raid notices.
  - Anything posted for someone is previewed to them first.

**9. Twitch's authority travels into the world.**
- **Why:** principle 15. The channel's moderators and Twitch's rules decide behaviour.
- **So:** a delete, timeout, ban or AutoMod hold on Twitch acts in the world within a second (`Tech.md` §13). The world
  adds no punishment of its own.

**10. One person, many kingdoms.**
- **Why:** a streamer is the monarch of their own channel and may be a citizen in others. Twitch gives them one user
  ID everywhere (`Tech.md` §7.1). A person may live in at most 3 places (founder decision, `World-Tree.md`).
- **So:** a Twitch event belongs to the person, in the kingdom of the channel where it happened, in their role there.
  Acts between channels belong to the sending kingdom (§12).

## 3. Every surface at a glance

Tier is the consent tier from `Tech.md` §7.2: 1 is "Found your kingdom", 2 is "Every Twitch moment", 3 is a royal
power, P is the panel and 0 is public data. "Without it" is what a channel gets when the surface is missing (§14).

| Family | Twitch surface | Spectacle | Trace | Credited | Tier | Without it |
|---|---|---|---|---|---|---|
| Presence | Chat message | Your light is on; a bubble over you or your home; emotes rise as emote weather | Minutes, nights and streak | You | 1 | Always there |
| Presence | First message in this kingdom | A tent with your name at the edge of town, if you have a free place of your 3 | The tent, a hut on your third night | You | 1 | Always there |
| Presence | First-time chatter intro | The gate lamp lights with your name; the crier welcomes you | "Came through the gate" date on your card | You | 1 | The tent alone |
| Presence | Lurker in the chatters list | An unnamed light | Presence kept privately | Nobody | 1 | Walkers only |
| Presence | Lighting up in the panel | Your light takes your name, or stays unnamed but yours | As a chatter's presence | You | P | Chat or sign in |
| Presence | Follow | A sapling by your tent or door | "Following since"; your street | You | 1 | Always there |
| Presence | Watch streak shared | Your light's flame steps up | Best streak, kept forever | You | 1 | Our own streak count |
| Presence | Coming back after 14 days | The relight: "welcome back" | A homecoming line | You | 1 | Always there |
| Support | Sub, Prime, upgrade | Your banner unfurls in the tier's colour | Sub pieces, the tier 3 rainbow cape and a sub tint on your light | You | 1, 2 exact | Kingdom colours for all |
| Support | Resub months | A ribbon is tied on | Month ribbons; months count toward your address when you settle | You | 1 | Not shown |
| Support | Sub lapses | Nothing | Pieces dim and the tint fades to a trace; nothing vanishes | Nobody | 2, 1 inferred | Nothing |
| Support | Gift sub | A parcel lands on the recipient's door, sealed with the giver's name | The parcel in the recipient's home | Giver, in others' homes | 1 | Nothing |
| Support | Gift bomb | The gift cart, or parcels raining on a ward | Each parcel; tents for newcomers | Giver | 1 | Nothing |
| Support | Cheer | Fireworks and sky moments from your home, by amount | Only the night's chapter | You | 2, 1 from chat | Chat chant moments |
| Support | Power-ups | Giant emote floats, bubbles wearing effects, confetti storms | Only the night's chapter | You | 2, partly 1 | Chat chant moments |
| Support | Custom Power-up | The moment the monarch mapped it to | As that moment | You | 2 | Nothing |
| Support | Bits in the panel | The product's moment, on stream and in every panel | A thing that lasts one day, then nothing | You | P | Hidden shelf |
| Support | Charity | A coin into the wishing well | A stone on the well for the campaign | The kingdom | 1, 2 exact | Nothing |
| Shared | Going live | Dusk falls, the beacon catches, lights come on | A new night in the Chronicle | The monarch | 1 | Always there |
| Shared | Going offline | The kingdom rests; the Ballad is sung | The night's chapter | Everyone present | 1 | Always there |
| Shared | Title change | Tonight's proclamation on the gate banner | The night's title | The monarch | 1 | Always there |
| Shared | Category change | Weather and music follow the game | The night's weather | The monarch | 1 | Always there |
| Shared | Hype Train | The festival train circles the walls; at level 3 the dragon wakes | A trophy naming who fought; fighters' keepsakes | Fighters, not payers | 2 | The Wyrm Bell |
| Shared | Goal | A great banner woven in the plaza | A dated ribbon on the kingdom's banner | The kingdom | 2 | Nothing |
| Shared | Ad break | The kingdom holds its breath | Nothing | Nobody | 2 | The monarch's pause |
| Shared | A viewer's clip | A still in the Gallery that opens the clip on Twitch | The still | The clipper | 0 | Director stills only |
| Play | Kingdom rewards | The reward happens | Depends on the reward | You | 3 | Chat commands |
| Play | Points to the pool | The building's scaffold rises on stream and in the panel | The building's next level | The kingdom; givers in a ribbon | 3 | Presence and `!haul` fill the same bar |
| Play | Twitch's own rewards | Highlights ribbon your bubble; points-gigantify makes a float | Nothing | You | 2 | Nothing |
| Play | Poll | A decree board in the plaza | The decree, carried out if it is ours | The kingdom | 2, 3 | Chat vote |
| Play | Prediction | An odds board in the tavern | The result on the table's record | Nobody | 2, 3 | Free guesses |
| Play | `!` commands | The world answers | Per command | You | 1 | Always there |
| Travel | Raid in | A caravan under the raider's banner; a forged tribute | A road on the Atlas; the raider's pennant on the gate | The raiding kingdom | 1 | Always there |
| Travel | Raid out | The Raid Gate: the kingdom rides out | A road on the Atlas | The kingdom | 3 | Twitch's own raid |
| Travel | Raid train | A carriage under each earlier kingdom's banner | A named line on the Atlas | Every kingdom on it | 1 | Always there |
| Travel | Shared chat | A bridge opens; guests cross | A bridge on the Atlas | Both kingdoms | 1 | Always there |
| Travel | Shoutout | A signpost (given) or a pennant (received) | The signpost | The monarch | 3, or a new read scope | Nothing |
| Court | Emotes | Statues, banners, carved stone, emote weather | The statues | The channel | 0 | Always there |
| Court | Badges | Heraldry on nameplates | Nothing | You | 1 | Always there |
| Court | Mod or VIP added | A short ceremony: Knight of the Watch, or Noble | The office on your card | You | 1, 2 | Nothing |
| Court | Modiversary | A ribbon on the Watch sash | The ribbon | You | 1 | Nothing |
| Court | Delete, timeout, ban | Bubbles vanish; you go home; your home is hidden | Nothing | Nobody | 1 | Always there |
| Court | Announcement | The crier reads it; a scroll on the notice board | The scroll, for the night | The sender | 1 | Always there |
| Court | Shield Mode | The gate closes to newcomers and tourists | Nothing | Nobody | 1 | Nothing |

## 4. Presence: chat, the quiet ones, newcomers, follows and streaks

Presence is the largest thing Twitch tells the kingdom, so it leaves the deepest traces. Everything here is free.

**Chat messages.**
- Spectacle: your light is on. Your message rises as a bubble over your avatar if you are walking, or over your home
  if you are not (`docs/08-depth-social.md` §3.2). Emotes used in chat rise from the plaza as emote weather, in the
  kingdom's own voxel emotes, in proportion to their use.
- Trace: the minute counts through `presence.tick`: nights present, your streak, the date of your first words. Chat
  text is never kept (`Tech.md` §7.5).
- 5 and 50,000: at 5, every bubble is readable and the director can frame a conversation. At 50,000, bubbles show
  only near the camera and around walkers. The crowd reads as the density of light and emote weather, and the mood of
  the chat colours the music.
- Messages reach us only after AutoMod [V], and mods can still delete them (§10). No other text from chat is written
  into the world.

**The quiet ones.**
- The kingdom reads Get Chatters every minute. It lists the logged-in viewers connected to chat, typing or not, with a
  delay [V]. Logged-out viewers never appear [V].
- Spectacle: an unnamed light somewhere in town. No beat, no name (founder decision).
- Trace: presence accrues privately under their Twitch user ID (`Tech.md` §7.1). When they first chat, light up in
  the panel, or sign in, their home lights with their name and their history is already there.
- Viewers who watch with chat closed, or on a phone, never reach the chatters list. Lighting up in the panel counts
  them, under the same idle checks as chat (§16).
- At 50,000 the lights are a field. The stream view never shows a viewer count (`Monarch.md` §3, principle 5); the
  panel says how many lights burn tonight (§16).

**First words.**
- A first message in this kingdom pitches a tent with your name at the edge of town. If you are present on two more
  nights, it becomes a hut (`ChatDom.md` §4, the newcomer).
- A person may live in at most 3 places (founder decision). Someone who already lives in 3 kingdoms gets no tent. They
  burn as a guest's light and their presence still counts, so if they ever make this one of their places, their
  history is already there. `World-Tree.md` owns how a place is chosen or given up.
- Twitch's first-time chatter introduction arrives as `message_type: user_intro` [V]. The gate lamp lights with your
  name and the crier, Wren Tallow, welcomes you (`docs/09` §2.12). Your card says when you came through the gate.
- At 5, every first word is a named beat. At 50,000, tents rise along the outskirts road as a stream, and the director
  picks one every few minutes.

**Follows.**
- A follow is an act, like a message, so it names you. A sapling is planted by your tent or door with your name on a
  tag. A follower who has never chatted gets their tent with the sapling, if they have a free place.
- Trace: "following since" on your card. Your follow year sets your quarter, and nights present and months subscribed
  set your street within it (§5, `World-Tree.md`). Nobody moves once settled.
- Twitch sends no event for an unfollow [K]. When a lookup shows one, the card stops saying "following since". The
  home and its street stay.

**Watch streaks.**
- Twitch shares a viewer's watch streak in chat only when they choose to (`watch_streak` notice) [V]. We count our own
  streak from presence anyway, with Twitch's own rule [V]: streams of at least 10 minutes, at least 30 minutes apart.
  Twitch forgives a missed stream if you watch its clips or VOD within 24 hours [V]. Opening the kingdom on chatdom.gg
  within 24 hours does the same (`docs/08-depth-progression.md` §3.7).
- Spectacle when shared: your light's flame steps up one form, with a small beat at small sizes.
- Trace: the best streak is kept forever. A streak is presence, so it may brighten your light. Light is earned.

**Coming home.** Your first message after 14 or more days away plays the relight: your home's light comes back on and
the street's lights flicker in greeting. At 50,000 it merges: "41 citizens came home tonight" (`ChatDom.md` §10,
line 9).

## 5. Support: subs and gifts

Subs are Twitch's own way of showing support (`ChatDom.md` §8). They show in three places, all true about the
person: sub pieces, a tint on your light and your address (founder decisions). They dim when the sub lapses and never
vanish. They never add a vote, raise trust or a rank, or make a light brighter.

**What each tier grants.** All sub pieces are Bound and belong to the kingdom where you subscribe. `World-Tree.md`
defines them.

| Sub | Sub pieces | Light tint |
|---|---|---|
| Tier 1 and Prime | A banner on your home with the kingdom's sub mark, and a ribbon on your cloak | A warm gold edge |
| Tier 2 | Adds a cloak in the tier's colour | A rose edge |
| Tier 3 | Adds the rainbow cape, animated with an elegant colour shimmer like the star in Super Mario | A slow rainbow edge, matching the cape |
| Months | Ribbons at 1, 3, 6, 9, 12, 18, 24, 36, 48 and 60 months on the banner and cape | No change |
| Founder badge | A founder's pin | No change |

**The sub tint.**
- The tint colours the edge of your light. Its core stays the same warm white as everyone's, and its brightness, size
  and reach never change. From across the town, a lit window still means only that someone is here.
- Unnamed lights never carry a tint, even when Twitch tells us the viewer subscribes. A tint would mark a quiet one.
- On the stream view the tint reads in close shots. Wide shots of a big town show the shared warm core.
- The risk is that the night view now also shows who pays. Keeping the tint to hue, never brightness, is the guard.

**Months and your address.**
- Your follow year sets your quarter (`World-Tree.md`). Within it, your street is set when you settle, from months
  followed, nights present and months subscribed.
- Months subscribed count once, at settling. Nobody moves afterwards, and later months show as ribbons.
- The risk is that a long sub settles nearer a quarter's old heart than a longer follower who never subscribed.
  Counting months only within the follow-year quarter keeps it to a street, never a quarter.

Other rules:
- Sub pieces may shimmer like good cloth. They are never a light source, so paid pieces never outshine presence.
- One person, one vote: a sub never adds vote weight (founder decision). A sub never opens the Forge's free words
  either: only time and presence do (founder decision, §21).
- Prime counts as tier 1 [K]. Prime subs cannot be gifted and do not renew on their own [V], so a Prime sub that is not
  renewed dims like any other lapse.

**New subs and resubs.**
- Spectacle: your banner unfurls in the tier's colour, with a short horn. At 5, every sub is a named beat. At 50,000,
  banners unfurl street by street and a ribbon of names passes every 20 s.
- Months come from the sub badge on every chat message [V] and from shared resub notices [V]. A new month ribbon is
  tied on the first message we see with the new count. The beat plays only if the viewer shared the resub.
- Upgrades (gift to paid, Prime to paid) step the pieces up with a small beat.
- Twitch shows the current sub streak only when a resub is shared [V]. We never show a broken sub streak.

**Lapses.**
- At tier 2, `channel.subscription.end` tells us [V]. At tier 1 we infer it: a citizen who chats without the sub
  badge has lapsed.
- Spectacle: none. A lapse is never announced.
- Trace: the pieces dim. Colours stay, the sheen goes and the banner furls on its pole. The tint fades to a faint
  trace at the base of the light. Months already shown stay, and the address stays, because they were true. A new sub
  relights everything with a small beat: "the banner unfurls again".

**Gift subs.**
- A single gift: a parcel lands on the recipient's doorstep, sealed with the giver's name. Inside are the sub pieces
  of that tier, because the recipient is now subscribed.
- A gift bomb (one `community_gift_id` [V], 1 to 100 subs at once [V]): the gift cart rolls through town and parcels
  drop on each recipient's door. At 50,000, parcels rain over a whole ward in one shot.
- A recipient with no home yet gets a tent with the parcel at its door, if they have a free place. A gift bomb is a
  wave of welcomes.
- Anonymous gifts are sealed "from a friend of the realm".
- `pay_it_forward` notices put both names in the parcel's line.
- Trace: the parcel's wrapping stays in the recipient's home with the giver's name (principle 15: gifts with the
  giver's name). The giver carries no count, mark or rank of their own (decided, §21). Twitch's gifter badge already
  shows that in chat.
- Recipients who never chatted are named only as Twitch already named them in chat, and get no solo beat.

**On a channel without subs,** everyone wears the kingdom's colours, and nothing looks missing.

## 6. Support: Bits, Power-ups and charity

Cheers and Power-ups pay the streamer, not Chatdom: streamers get 100% of the Bits used [V], which is 1 US cent per
Bit [K]. Chatdom only listens, through `channel.bits.use` [V]. That event carries cheers, Power-ups and custom
Power-ups. It does not carry Bits used in Extensions, and it does not fire when streamers use Power-ups in their own
channel [V].

**Cheers.** The monarch picks a ladder of reactions from a fixed set, the way alert thresholds work. These are
reactions to ordinary cheers, not a shop. The default ladder:

| Cheer in one message | Spectacle |
|---|---|
| 1 to 99 | A spark rises from your home |
| 100 | Fireworks in your colours over your street |
| 500 | A volley over the castle that bursts into the channel's emotes |
| 1,000 | The Hearthbeast flies low over the town |
| 5,000 | Skyfire: an aurora and a firework procession around the walls, with your name in the sky |
| 10,000 | A sky of kites: a kite in the kingdom's colours rises from every home, and yours leads them |

- Trace: only the night's chapter in the Chronicle, like everything else that happened. No counter, total, statue, plaque, title or
  keepsake.
- Credit: the cheerer by name, or "a friend of the realm" for an anonymous cheer.
- Size: every beat plays in a hamlet. In a town they merge into volleys every 10 s. In a capital they merge every
  20 s with the names in a ribbon (`docs/08-depth-progression.md` §3.10).
- No cheer wakes the dragon. The dragon is earned only (§7).
- At tier 1, the cheer amount comes from the chat message [V]. Each kingdom uses exactly one source (`Tech.md` §7.3).

**Power-ups.**

| Power-up | Spectacle |
|---|---|
| Gigantify an emote | That emote, as a giant voxel float, drifts over the plaza for 20 s |
| Message effect | Your bubble wears the effect, drawn in the kingdom's style |
| On-screen celebration | A confetti storm over the castle |
| Custom Power-up | The moment the monarch mapped it to, from the cheer ladder or a fixed list |

- Custom Power-ups can be read by the API but not created by it [V]. The throne shows the monarch a checklist to
  create them in Twitch's dashboard, named in the kingdom's voice.
- Two Power-up types also show at tier 1, through the chat message's type [V].
- Trace: only the night's chapter.

**Charity.**
- A Twitch charity campaign, open to Affiliates and Partners only [V], becomes a wishing well in the plaza. It fills
  as the campaign fills. Each donation drops a coin with the donor's name, in the moment.
- Trace: when the campaign ends, a stone on the well's rim carries the charity, the date and the total. Donors are not
  engraved. The kindness is the kingdom's.
- The money goes to the charity through Twitch. Chatdom never touches it, and the panel never takes charity money
  (Extension guideline 5.4 [V]).

## 7. The kingdom's shared moments

**Going live.** The kingdom wakes. The sky turns to dusk, the beacon catches on the castle and the lights come on one
by one as chatters arrive (`docs/09` §1). Trace: a new night opens in the Chronicle.

**Going offline.** The kingdom rests but stays open. The Voice of the Realm sings the Ballad of Tonight from the
night's facts, and the monarch can veto it. Lights dim slowly over the next hour, and the tavern stays lit. Trace: the
night's chapter in the Chronicle, in words and stills.

**Title and category.**
- The title becomes tonight's proclamation on the gate banner. It is the streamer's own text, already public.
- The category sets the weather and music from a fixed set chosen at Genesis: fog for horror, snow for a Celeste run.
- Trace: the night's title and weather in the Chronicle.

**The Hype Train.** This is the night `ChatDom.md` §10 promises: "the train woke a dragon and the whole chat killed
it".

| Twitch | In the world |
|---|---|
| The train starts | The festival train appears on its track around the walls: carriages hung with lights. The streets dress in bunting and the music gains a layer |
| Each level | A carriage is added. Contributors' names ride in the carriages while the train runs |
| Level 3 | The dragon wakes in the hills. Everyone present fights: chat `!strike`s, walkers fight, the monarch rides the Hearthbeast |
| Level 5 and above | The dragon's elder form |
| Levels 10, 25, 50 and 100 | Twitch's bonus levels [V]: the dragon changes form again, and the fight is the kingdom's legend |
| A new all-time record [V] | The largest dragon the kingdom has seen, and the record is spoken |
| Golden Kappa train [V] | A golden dragon |
| Treasure train [V] | A treasure wagon joins the train. At level 2 Twitch discounts gift-sub bundles [V], so the wagon's chest opens and parcels stand ready to fly |
| Shared train [V] | One dragon over the bridge, fought by every kingdom in the shared chat, with all their banners on the trophy |
| Mythic or Community train | Twitch's events cannot tell these from a regular train [V], so they look like one |
| The train ends below level 3 | The festival closes with fireworks. The dragon stirs and sleeps |

- The fight takes 2 to 4 minutes and is won by the crowd's strikes. The dragon can retreat, and nothing is lost.
- The dragon is earned only: by the train or the Wyrm Bell. No cheer wakes it, and the monarch cannot call it on
  demand (founder decision).
- The fight never waits. It comes on Twitch's clock even when the streamer is Busy (founder decision). Busy keeps the
  window calm while chat and walkers fight. Otherwise the stage opens on Show, or by itself for moments the streamer
  chose, with 5 s to say "not now" (`Monarch.md` §6.4).
- Trace: a dated trophy in the Trophy Hall with the level and the names of everyone who fought, not who paid. Each
  fighter gets a numbered keepsake of the night. `World-Tree.md` defines both.
- Rewards follow principle 3. The train opens the door; what fighters earn counts inside the same daily caps as free
  play. The Wyrm Bell, rung by `!haul`ing for the King's Errand, brings the same dragon for free.
- Records are the kingdom's trophies. They never enter a league score (principle 14).
- Contributors: Hype Train v2 events carry only the top contributions [V]. The carriages also take names from Bits and
  sub events during the train, and merge into "and 340 others" at scale.
- At 5: trains are rare in small channels, so the Wyrm Bell is how a hamlet meets its dragon. At 50,000: the strikes
  are a crowd tally, and the dragon's strength scales with the fighters.
- Twitch's rules [V]: a train starts after 2 to 25 support events from different viewers within 5 minutes (the
  streamer sets the number), and each level gives 5 minutes. Subs, Prime subs, gifts, cheers, Power-ups and Bits used
  in Extensions all count, so Bits used in the panel feed the train too. Twitch's own Conductor badges stay on
  Twitch, and the kingdom does not mirror them.
- Twitch's help pages disagree on whether channels below Affiliate get Hype Trains [?]. The kingdom simply listens.

**Goals.** Twitch's creator goals become a great banner woven in the plaza, a stripe for each step. Follower goals are
open to every channel, and the other types to Affiliates and Partners [V]. When the goal
is met, the banner is raised over the castle and a short festival plays.
- Trace: a dated ribbon tied to the kingdom's banner.
- A goal never fills a wonder, a commission or a Town Hall level, even a follower goal. Goals are Twitch's, and the
  kingdom's bars are filled by showing up.

**Ad breaks.** The kingdom holds its breath.
- `channel.ad_break.begin` gives the length, 30 s to 3 minutes [V]. Every crowd window freezes, so nobody misses a
  vote. Spectacles keep Twitch's clock and never wait.
- During an ad, many viewers still see the stream small and muted above chat [V]. So the director holds a calm wide
  shot that needs no sound.
- Overlay and component Extensions hide during ads [V]. The panel sits under the player and says the kingdom is
  waiting. Walkers on chatdom.gg carry on.
- Nobody is paid for sitting through an ad. Presence counts as it always does.
- Twitch can snooze ads during a Hype Train [V], so the dragon rarely meets an ad.
- Ads are for Affiliates and Partners only [V].

**Clips.**
- The kingdom never makes clips or videos of its own, such as a founding video or a recap (founder decision). The
  Gallery hangs the director's own stills of the night.
- A clip any viewer makes hangs beside them as a still with the clipper's name, and opens the clip on twitch.tv.
  chatdom.gg carries no Twitch player (founder decision), and nothing is re-hosted [V].

## 8. Play: channel points, polls, predictions and commands

**Kingdom rewards.** Chatdom creates its own channel-point rewards, so it can fulfil or refund them [V]. A channel can
have at most 50 custom rewards [V]. The monarch switches on a starter pack in one gesture:

| Reward | What happens | Kind |
|---|---|---|
| Ring the Bell | Every avatar looks up; the director cuts to the bell tower | Shared moment |
| Change the Weather | Rain, fog, snow or aurora for 10 minutes | Shared moment |
| Call a Festival | 10 minutes of festival in the streets | Shared moment |
| Show My Home | The director visits your home for 20 s | Personal moment |
| Plant a Tree | A tree with your name on your plot | Small personal thing |
| Relight a Neighbour | Keeps a friend's streak when they missed a stream (`docs/09` §2.17) | Kindness |
| Seat Ticket | Doubles your weight once in tonight's seat lottery (`docs/08-depth-viewer-games.md` §3.6) | Small personal edge |
| Give to the {building} | Lays your points into the pool for the building being raised (below) | Communal |

Rules:
- Prices follow Twitch's own idea of smart costs: personal rewards cost the same at every size, and shared moments
  cost more in bigger kingdoms (`docs/08-depth-progression.md` §5.2).
- Rewards pause when the kingdom cannot act, for example when the stream view is not running. Anything unfulfilled is
  refunded.
- Channel points are earned by watching. So points may buy moments, small personal things and communal progress
  through the pool. They never buy personal progress: no Hearth, no rank, no personal charges (decided, §21).
- Each reward can have a cooldown of 1 minute to 7 days and caps per stream and per viewer [V]. Shared moments always
  have a cooldown, so the stream never becomes a queue of weather.
- Twitch's own rewards are mirrored lightly. A highlighted message carries a ribbon on its bubble. Message effects,
  gigantified emotes and celebrations paid with points [V] look exactly like the Bits ones. Rewards the streamer made
  themselves can arrive as a scroll at the castle, and nothing acts on them.

**The pool: points that raise the town.** This is the founder's own idea (decided, §21).
- The kingdom raises one building at a time with the pool: the Town Hall's next level by default, or the tavern's next
  room, the market or another civic place the monarch chose by decree.
- Viewers give with the reward "Give to the {building}", in three sizes, because a Twitch reward has a fixed price
  [V]. The sizes scale with the kingdom, like shared moments.
- Each gift lays stones on the building's scaffold. The stream view shows the scaffold rising, in the window or on the
  stage, with a ribbon of givers' names every 20 s. The panel shows the bar and what the next level brings. This uses
  the stream view and the panel, never a video overlay.
- It is communal, never personal. Givers get no Hearth, rank or mark, and no list of top givers exists (principle 5).
  When the level is complete, the building rises in a short cinematic, and the givers' names scroll on its stones in
  the order they gave, never by amount.
- A level counts only when enough different people gave: at least 20% of the kingdom's 28-day active citizens, and at
  least 3 (`docs/08-depth-progression.md` §3.6). Each viewer can give a few times per stream, through Twitch's
  per-viewer caps [V]. So a few hoarded balances cannot finish a building alone.
- The target is sized from who is actually there, so a hamlet and a capital raise a building at the same calendar
  pace. How much of a level the pool may fill, beside presence and `!haul`, is for `Economy.md`.
- Presence and `!haul` fill the same building, so a channel without channel points still builds.
- When the building is complete, or the kingdom cannot act, the reward pauses and unfulfilled gifts are refunded.
- In a shared chat, points stay in their own channel [V], so each kingdom's pool fills only from its own chat.
- The risk is that subs earn points faster [K], so the pool leans a little toward subscribers. The breadth rule and
  per-stream caps keep it communal.

**Polls.**
- A decree the monarch issues (§13) appears as a decree board in the plaza, and the kingdom carries out the winning
  option.
- A poll the streamer runs about anything else is posted on the notice board by the crier, with its result. Nothing
  acts on it.
- When a poll decides something in the world, each person counts once: one person, one vote (founder decision).
  Votes bought with channel points are taken off (`channel_points_votes` [V]).
- Twitch removed Bits voting from polls in August 2023 [V].

**Predictions.**
- Shown as an odds board in the tavern, under both sides' banners. The result lights up on the table's record.
- Predictions use channel points only [V]. Nothing of Chatdom's ever rides on an outcome: no item, Hearth or piece
  (`docs/08-depth-items-cosmetics.md` §3.9).

**Commands.**
- Crowd commands (`!strike`, `!haul`, `!join`, moves at a table) become crowd tallies (`docs/09` §3). The world
  answers. The Herald never replies in chat.
- `!chatdom` asks for the kingdom's link. The Herald answers at most once every 5 minutes, however many ask, and the
  panel always has the link.
- `!chatdom quiet` and `!chatdom forget` work in every channel (`Tech.md` §7.5).

## 9. Travel: raids, raid trains, shared chat and shoutouts

Travel is how kingdoms meet. Each act here leaves a mark on the Atlas, and `Atlas.md` decides how that mark looks.
This section is about what happens inside the kingdom.

**A raid arrives.**
- A caravan comes through the gate under the raiding kingdom's banner and colours, sized by the log of the viewer count.
  Codex forges a tribute themed on the raiding channel, and it stands in the plaza for the night
  (`docs/08-depth-items-cosmetics.md` §5).
- Raiders who chat become guests, their bubbles carrying the raider's crest. Twitch never says who rode with a raid,
  only how many [V].
- The Herald posts one line with the kingdom's link, so raiders can walk in with one-click sign-in.
- Trace: a road on the Atlas. The raider's pennant joins the banner wall by the gate, dated, one per visit.
- Passport stamps: Twitch never says who rode, so a stamp goes to those the kingdom saw ride: walkers who marched out
  of the raiding kingdom's gate, and signed-in citizens of that kingdom who chat here within 10 minutes. Passports are
  public on the citizen card, with a personal switch to hide your travels (founder decision; `Atlas.md`).
- Raid farming: raids of fewer than 3 viewers give no rewards, and at most two raids a day are rewarded
  (`docs/08-depth-progression.md` §5.1).
- If the raiding channel has no kingdom, the caravan comes from its waiting land, under its real name and emotes.
- At 5: a raid of 3 is a huge night, and the director treats it as one. At 50,000: a raid of 10,000 is a column that
  takes a minute to pass the gate.

**The kingdom rides out.** The Raid Gate is a royal power (§13). Walkers are asked to march with their monarch, and the
party rides out as the camera rises to the Atlas (`Tech.md` §6.7). Trace: the road, and a passport stamp for each
rider. Only the streamer opens the gate; there are no stewards (founder decision, `Monarch.md`).

**Raid trains.** When channels raid one another in a chain, the train arrives as a line of carriages, one under each
earlier kingdom's banner, and leaves with one more under ours (`Moments.md` §12). Trace: the carriage's banner on the
gate wall, and a named line on the Atlas.

**Shared chat.**
- A bridge opens to each kingdom in the session. Guests cross in their own colours, and their bubbles carry their
  crest. A session holds at most 6 channels [V].
- Twitch shares only the Hype Train across a shared chat. Power-up effects, shoutouts, polls and predictions stay in
  the channel where they happened [V], so the kingdom shows them only on its own side of the bridge.
- A shared Hype Train is one dragon over the bridge.
- Trace: a bridge on the Atlas, and a bridge keepsake for citizens of both kingdoms who were present.
- An unclaimed channel in the session appears as guests from its waiting land, never as citizens (`Tech.md` §7.1).

**Shoutouts.**
- Given: a signpost to the other kingdom goes up at the crossroads.
- Received: a herald from the other kingdom plants their pennant by the gate.
- Trace: the signpost stays. Whether shoutouts draw anything on the map is for `Atlas.md`.
- Seeing shoutouts given and received needs either the tier 3 signpost power or a read scope that `Tech.md` §7.2 does
  not list yet [V].

**Stream Together.** When the guests share chat, it is shared chat. Otherwise nothing happens at launch, because
Stream Together and its API are still in beta [V].

## 10. The court: emotes, badges, offices and moderation

**Emotes.** The channel's emotes found the kingdom: statues in the plaza, banners, carved stone (principle 10).
- Twitch has no event for emote changes, so the kingdom checks on going live and daily [K].
- A new emote is raised as a statue at the next going-live. A removed emote's statue is quietly taken down.
- Emote weather rises from chat as people use them (§4).

**Badges become heraldry on nameplates.**

| Badge | In the world |
|---|---|
| Broadcaster | The crown |
| Moderator | The Watch's sigil |
| Lead moderator (new in December 2025 [V]) | The Captain of the Watch |
| VIP | A noble's sigil |
| Subscriber | The tier's mark |
| Founder | The founder's pin |
| Artist | The Royal Artist's sigil |
| Bits badges, gifter badges | Not shown. Money is not heraldry |

**Offices.**
- A new mod is made a Knight of the Watch, and a new VIP a Noble, in a short ceremony at the next quiet moment. These
  are offices from Twitch, not royal acts; a royal knighting is always the monarch's own press (§13). At tier 1 a new
  badge on their next message starts it. With the optional scopes in tier 2, Twitch's events
  start it at once [V].
- A modiversary [V] ties a ribbon on the Watch sash.
- A removal is silent. The office leaves the nameplate, and the card's history keeps it.

**Moderation travels.**
- A deleted message's bubble pops wherever it was shown. A chat clear clears every bubble [V].
- A timeout sends the avatar home and shuts the door for its length. The stocks stay off by default (`Tech.md` §19).
- A ban hides the person's home from everyone else. Nothing is destroyed, and an unban brings it back.
- At tier 1, Twitch says only that someone's messages were cleared, not whether it was a timeout or a ban [V]. The
  kingdom treats it as a 10-minute timeout until the optional moderation scope in tier 2 tells the two apart [K].
- A warning shows nothing in the world.
- AutoMod-held messages never appear.
- Shield Mode closes the gate to newcomers and tourists until it ends. Its read scope is in tier 1 (`Tech.md` §7.2).

**Announcements and pins.** A Twitch announcement is read by the crier in the plaza and hangs on the notice board as a
scroll in the announcement's colour, for the night. A pinned message is the top scroll on the board.

## 11. Size and scale, in one place

| | Hamlet (under 50) | Town (50 to 5,000) | Capital (5,000 and over) |
|---|---|---|---|
| Named beats | Every event, spoken by name | Merged every 10 s, names in a ribbon | Merged every 20 s, names in a ribbon |
| Free beats in each hour | At least half | At least half | At least half |
| Bubbles | All | Near the camera and walkers | Near the camera and walkers |
| Hype Train | Rare; the Wyrm Bell brings the dragon | Some nights | Many nights; one dragon at a time |
| Raids in | Each is a festival | A caravan | A column |
| The pool | A few gifts raise a room | A steady scaffold | A ribbon of names every 20 s |
| Herald lines in chat | §13 ceiling | §13 ceiling | §13 ceiling, and fewer when Twitch's global budget is tight |

## 12. One person, many kingdoms

One Twitch user ID is one person everywhere. A streamer is the monarch of their own channel, and may be a citizen in
others. A person may live in at most 3 places (founder decision; `World-Tree.md` owns how they are chosen). A monarch's
castle is not one of their 3.

Rules:
1. Role comes from the channel. The broadcaster of a channel is its monarch. Everyone else is a citizen if it is one
   of their places, and otherwise a guest. A guest who chats has a light there, and their presence still counts.
2. A Twitch event belongs to the person, in the kingdom of the channel where it happened.
3. Acts between channels belong to the sending kingdom, led by its monarch.
4. In other kingdoms, a monarch's nameplate carries their kingdom's crest, as any citizen's does when they visit. It
   gives no power there.
5. Money a monarch spends in another kingdom does nothing for their own kingdom, and draws nothing on the map.
6. In their own kingdom the monarch has the castle, not a house, and the beacon is their light.

| When the monarch of A ... | It belongs to |
|---|---|
| chats in B | A light in B. If B is one of their 3 places, a citizen of B with tent, home and tenure like anyone, and A's crest. Otherwise a guest |
| subscribes to B | B's sub pieces, in B only |
| gifts subs in B | Parcels in B with their name. Nothing in A, and no road |
| cheers in B, or uses B's panel | The moment in B, credited to the person |
| contributes to B's Hype Train | A fighter's place on B's trophy if they fight, like anyone |
| is a mod or VIP in B | A Knight of the Watch or a Noble in B |
| raids B from A | A's party rides out of A's gate and arrives in B under A's banner, led by the monarch. The road runs from A to B. If they have a home in B, its light comes on too |
| shares chat with B | The bridge between A and B. They are monarch on A's side and a guest on B's |
| gives B a shoutout | A's signpost to B |
| visits B on the Atlas without chatting | A tourist in B, with a guest badge and trust 0 there (`Tech.md` §6.7) |
| gifts subs in their own channel | A royal gift: the parcels are sealed with the crown |
| uses Power-ups in their own channel | Nothing: Twitch sends no event for it [V] |

## 13. The kingdom speaks back

Writing back is what makes the integration deep rather than decorative (`Moments.md` §6). Every write starts from a
royal gesture or a standing permission, and the monarch sees anything public before it goes out (`Tech.md` §7.4). Only
the streamer presses royal acts; there are no stewards (founder decision, `Monarch.md`).

| In the world | On Twitch | Who decides | Twitch's limits |
|---|---|---|---|
| A royal decree | A poll | The monarch, one gesture, after a preview | 2 to 5 choices, 15 s to 30 minutes, one poll at a time [V] |
| Crown vs Crowd | A prediction | The monarch starts the match; the result resolves it, and an aborted match refunds it | Channel points only; 2 to 10 outcomes [V] |
| Opening the Raid Gate | A raid | The monarch | A 90 s countdown; 10 raids per 10 minutes [V] |
| A signpost to another kingdom | A shoutout | The monarch | One every 2 minutes, the same channel once an hour [V] |
| Knighting | VIP status | The monarch's explicit click, never automatic | VIP slots grow with the channel's unique chatters; a full channel refuses [V] |
| Kingdom rewards | Channel-point rewards | The monarch switches the pack on | Our own rewards only; 50 per channel [V] |
| The crier | An announcement | A royal act, such as a decree or the gate | The Herald must be a mod [V] |
| A raid welcome | One Herald line with the link | Automatic, for raids of 3 or more | One per raid |
| A chapter of the night | A stream marker | Automatic, if the monarch switches it on | Optional |
| A walker's words | A chat message from the walker's own account | The walker, after a preview | Their own limits [V] |

**When the Herald may speak in chat.** The Herald shares 20 messages per 30 s across all of Twitch, or 100 where it is
a mod [V]. At 1,000 live kingdoms that is one line per kingdom every 5 minutes. The streamer sets it to silent, rare
(the default) or herald (`Monarch.md` §6.9). In rare and herald mode:
1. It speaks only these lines: a raid welcome with the link, the Raid Gate's destination, a decree's opening and result
   when the monarch asks, at most two climax lines a stream, the `!chatdom` link, and confirmations of `quiet` and
   `forget`.
2. It never thanks subs or cheers, because Twitch already shows them. It never announces lapses, timeouts, totals or
   records of money. It never @-mentions a quiet citizen, and it never speaks as the streamer.
3. It says at most 6 lines an hour in one kingdom outside royal acts, and never 2 within a minute.
4. When the global budget is tight, the order is safety, the Raid Gate, decrees, raid welcomes, then climaxes
   (`Tech.md` §7.4).

**Clips.** The kingdom never makes clips on the streamer's account (founder decision). The Gallery uses the
director's own stills, and stream markers, if switched on, help a streamer who cuts VODs find the night's moments.

## 14. When a surface is missing

Since 13 May 2026, Bits, subs, emotes, badges and channel points are open to eligible streamers worldwide, not only
Affiliates and Partners [V]. Twitch's help centre adds polls, predictions and Hype Trains. It leaves out ads, charity,
goals other than follower goals, and Bits in Extensions, which stay Affiliate and Partner only [V]. The API reference
still lists a refusal for channel points on channels that are not Affiliates [?]. So features are tried, and a
refusal falls back (`Tech.md` §7.2).

| Missing | The kingdom does this instead |
|---|---|
| Tier 2 not granted | Uses tier 1 sources: sub badges, chat notices, cheers from chat messages |
| Bits and Power-ups | A chant: when 10 people chant `!fireworks` within 30 s, fireworks fly, once every 10 minutes |
| Subs | Everyone wears the kingdom's colours |
| Channel points | The same moments through chat commands with cooldowns; presence and `!haul` raise the pool's building |
| Polls or predictions | Chat votes and free guesses in the world |
| Hype Train | The Wyrm Bell |
| Goals beyond follower goals, charity (Affiliate and Partner only) | Nothing; no empty frame is shown |
| The Herald is not a mod | 20 lines per 30 s across Twitch, no announcements; the crier speaks on stream only |
| The panel is not installed | Nothing is missing. The panel is an extra window on the kingdom |
| Bits in Extensions (non-Affiliate) | The panel hides its shelf; cheers still work |

## 15. A night, all together

A mid-sized kingdom, lumi's, on a Thursday with 1,200 viewers. The same night in a hamlet of 9 follows the table.

| Time | On Twitch | In the kingdom and on stream | In the panel | What lasts |
|---|---|---|---|---|
| 19:00 | Goes live | Dusk falls, the beacon catches, lights come on one by one | The night painting wakes | A new night |
| 19:04 | 300 chatters, 600 in the chatters list | 900 lights; bubbles near the camera | "900 lights tonight"; your light | Presence minutes |
| 19:06 | A first-time chatter introduces herself | The gate lamp lights with her name; the crier welcomes her | | Her tent |
| 19:20 | A quiet viewer taps "Light your lantern" | Her light takes her name; merged into "6 lights came on" | Her home card appears | Her history, now hers |
| 19:35 | Raid from fernwood, 140 viewers | A caravan under fernwood's banner; the tribute is forged; one Herald line with the link | "Raiders: walk in" | A road on the Atlas; fernwood's pennant on the gate |
| 20:05 | 20 gift subs | Parcels rain on Lakeside, sealed with the giver's name | | Parcels in 20 homes |
| 20:20 | A 500-Bit cheer | A volley over the castle bursts into the channel's emotes | | Only the night's chapter |
| 20:40 | The monarch issues a decree | A poll: "Name the new bridge"; the decree board in the plaza | The decree shown | The bridge's name |
| 21:00 | A 90 s ad break | The kingdom holds its breath; vote windows freeze | "The kingdom waits" | Nothing |
| 21:15 | Hype Train, level 3 by 21:21 | The festival train circles; the dragon wakes; chat strikes; it falls at 21:25 | The fight's progress | A trophy naming 410 fighters; their keepsakes |
| 21:26 | | The director keeps a still of the dragon falling | | The still in the Gallery |
| 21:50 | Crown vs Crowd | A prediction opens; chat plays the monarch at chess | The board | The result on the table's record |
| 22:10 | 60 viewers give points to the tavern | The tavern's scaffold rises; the second room opens; names scroll on its stones | The pool's bar fills | A new room, raised by 212 citizens |
| 22:30 | A viewer redeems Change the Weather | Snow over the town | | Nothing |
| 22:50 | The monarch opens the Raid Gate | Walkers march out; the camera rises to the Atlas | "Riding to mira's" | A road from lumi to mira |
| 22:52 | Goes offline | The kingdom rests; the Ballad is sung | Last night's Ballad | The night's chapter |

The same night in a hamlet of 9: no Hype Train comes, but the chat has been `!haul`ing all week, and the Wyrm Bell rings
at 21:00. The raid that arrives is 3 people, and the director makes it the night's biggest moment. The quiet viewer
who lights up is a named beat of her own. The kingdom shows every bubble.

## 16. The Chatdom panel

The founder asked for an Extension panel. Earlier work shipped none (`docs/research/tech/twitch-integration.md`
scope, and `docs/09` §8). This section designs it inside Twitch's rules.

**What Twitch allows** [V]:
- Panels are 318 px wide and 100 to 500 px tall (default 300). They stay active when the channel is offline.
- A channel can run 3 panels, 1 video overlay and 2 components. Overlays switch off when the channel goes offline.
- In the iOS and Android apps, an Extension that supports phones opens from the chat area, with no slot of its own. Its
  first load must stay at or under 1 MB. Extensions do not run on console or TV apps. Phone browsers are unclear [?].
- Every logged-in viewer has a stable opaque ID that starts with U. It does not say who they are. Logged-out viewers get
  a short-lived ID that starts with A, which must never be tied to anything that lasts, and they cannot use Bits.
- The real Twitch user ID arrives only when the viewer shares it: the panel asks with `requestIdShare`, or the viewer
  confirms a Bits use, which shares it automatically.
- Extensions cannot read or spend channel points.
- Review takes 8 to 14 days on paper. In October 2026 the dashboard shows 3 to 15 working days, the queue is longer
  than usual, and some reviews took 6 weeks to 2 months. Only one version can be in review at a time.
- Anything in the zip needs a reviewed version. Data and images from our declared domains change any day without
  review.

**Which surfaces.** The panel, with a phone view, and nothing else in year one (decided, §21).
- The stream view already puts the kingdom on stream through OBS. An overlay would draw a second kingdom over the
  first, only on desktop, only while live.
- A panel works offline, so the kingdom is on the channel page between streams too, holding what happened.
- The panel is a living picture, not the game: a painting of the kingdom's night, refreshed every minute from the
  stream view's own renders, with your home and tonight's moments. It fits the 1 MB phone rule and never competes with
  chatdom.gg.

**What a viewer sees.**

| Viewer | Live | Offline |
|---|---|---|
| Logged out | The night painting and the count of lights. "Log in to Twitch to light your lantern" | The resting kingdom and last night's Ballad |
| Logged in, not yet shared | The painting, the count, tonight's moments, and Light your lantern | The resting kingdom, and "Light your lantern" to find your home |
| Shared, a citizen | Your light, lit or dim, with its sub tint; your home card; tonight's moments; the pool's bar; the crowd acts; the Bits shelf if the channel has one | Your home card, last night's Ballad and Chronicle, "Walk in" |

The words follow the kingdom's form of light, which is still open (`ChatDom.md` §11): "Light your lantern", "Light
your candle" or "Light your window".

**Lighting up, for the quiet ones.** This is the panel's heart, and it is free forever.
1. The quiet viewer taps "Light your lantern".
2. The panel asks Twitch to share their identity. They choose between "with my name" and "mine, but unnamed".
3. With their name: their home lights with their name, as if they had chatted, and their history from the chatters
   list is already there. Someone who already lives in 3 places lights as a guest. Unnamed: the light is theirs and
   counts for them, and the town still sees an unnamed light.
4. On stream, the light coming on is a small beat. At 5 viewers it is spoken by name. At 50,000 it merges: "41 lights
   came on".
5. While the panel stays open and the stream is live, the light stays lit and counts as presence, under the same
   idle checks as chat (decided, §21).

An unshared panel never adds a light, because we cannot tell whether that viewer is already one of the chatters, and
we never tie an opaque ID to a light without consent.

**Crowd acts.** During a crowd moment, the panel offers the same acts as chat commands: strike the dragon, vote in a
world vote, haul for the Errand. One tap is one command, with the same rate limits and one vote per person, so it needs
a shared identity. This makes watching playable on a phone with chat closed. The panel offers nothing chat cannot do,
so one message stays enough (principle 8).

**Nobody submits anything through the panel.** Twitch requires user content in an Extension to come from viewers who
shared their identity, to show their username and to be removable by the broadcaster (guidelines 7.1 to 7.4 [V]).
Homes and Forge pieces in the painting were made on chatdom.gg, carry their maker's name, and sit under the monarch's
veto and removal.

**Walking in.** "Walk in" opens chatdom.gg in a new tab, with a visible sign that it leaves Twitch (guideline 4.6
[V]). Sign-in there is still Twitch sign-in, one click for a viewer already logged in to Twitch (`Tech.md` §7.1).
Walking in is never the panel's main use (guideline 4.5 [V]).

**What the streamer sets up.**
- Connect the channel: the config page opens "Found your kingdom" (tier 1) in a new window. The panel can require it
  before it activates.
- Which parts show: the night, your home, crowd acts, the shelf.
- The Bits shelf: on or off, and which products, from the fixed menu.
- On the live dashboard: a Hide button that pauses all panel-driven moments, and the queue of viewer content to
  approve or remove.

## 17. Bits in the panel

**The verified rules** [V]:
- Split: the broadcaster gets 80% of 1 US cent per Bit and the Extension developer gets 20%, that is 0.8 and 0.2 cents.
  Twitch keeps none of the cent. Its income is, on our reading, the gap between the cent and what viewers pay for Bits
  (100 Bits cost $1.40 on the web). Twitch may change the programme, with 30 days' notice to developers.
- A cheer pays the streamer 100% of the Bit [V]. So a Bit used in the panel earns the streamer 20% less than a cheer.
- Bits used in the panel count toward the Hype Train, like cheers [V].
- Eligibility: only Affiliate and Partner channels with Bits switched on. Monetization for All did not open Bits in
  Extensions. The panel must check `isBitsEnabled` and hide the shelf when it is false.
- Chatdom must onboard as a developer (two tax interviews). An account that completed creator monetization onboarding
  before reaching Affiliate cannot also do developer onboarding, so Chatdom's developer account must be a separate
  account. Payment comes about 45 days after month end, once $100 is owed.
- Products: at most 250, priced 1 to 10,000 Bits, the same price worldwide. A product's SKU is permanent. Products can
  be added, changed or retired at any time without a version review. Bits support itself must be switched on in a
  reviewed version. Twitch may require price changes.
- Bits in Extensions work in the phone apps if the panel supports phones.

**What Bits may and may not unlock** [V]:
- May: "activate an experience for the broadcaster and/or the community" (6.1.1); "unlock a digital consumable
  experience on Twitch", such as "a special avatar within an Extension game" (6.1.2); avatars and character attributes
  in a free game (6.1.3); voting (6.1.4).
- May not: random rewards (6.2.4), contest entry (6.2.5), wagers (6.2.6), anything with voice (6.2.7), free-text items
  (6.2.8), music on request (6.2.2), charity (5.4).
- Words: say get, use, exchange, give or earn. Never say cost, spend, donate, support, sell, price, buy, purchase, or
  "cheering" (6.4, 6.5).
- The line that matters most is the Bits Acceptable Use Policy's ground rule 2: "Bits may not be used or exchanged for
  functionality or experiences outside Twitch". Twitch's Terms of Sale add that Twitch "may subsequently make digital
  goods ... usable on the Twitch Services only".

**The verdict on persistent cosmetics.** A Bits product may give a cosmetic that lives in the panel and on stream.
Whether it may also live on chatdom.gg is not settled by any rule. Some text supports it: an avatar in an Extension
game, a game skin, "persistent items exchanged for Bits". Some text argues against it: "outside Twitch", Digital
Content that "cannot be used outside the Twitch Services", and Twitch's right to restrict items to Twitch later.

**Decided (founder, 29 October 2026): moments, and things that last one day in the kingdom.** Nothing bought with Bits
is permanent. A day-long thing shows on stream and in the panel first, and lasts in the world until the same hour the
next day. We still ask Twitch in writing (developers@twitch.tv). The risk is that a day on chatdom.gg could still read
as an experience outside Twitch. If Twitch says so, day-long things shrink to the end of the stream.

**The shelf.** A small fixed menu of chosen moments that a cheer cannot give. Every product is seen by the whole
kingdom: on stream within 60 s, and at once in every panel through the broadcast flag. The shelf shows only while the
stream view is running, so nothing is offered that cannot be delivered. Using Bits shares the viewer's identity, so a
first-time user gets their tent at the same moment, if they have a free place.

| Product | Bits | On stream and in every panel | What stays |
|---|---|---|---|
| Fireworks for a friend | 100 | Fireworks over a citizen you pick from a list, in both your colours, with both names | Nothing after the moment |
| Dress my home | 300 | Bunting and festival banners in your colours on your home, shown as the director passes | One day |
| A song from the bard | 300 | Lark sings four lines about you, written by the Voice of the Realm from what the kingdom knows of you | The verse on your door for one day |
| Wear a look for a day | 500 | You step onto the pageant ring and put on one piece from this season's rack of 8 | Worn for one day, then back on the rack |
| Lead a parade | 1,000 | Your avatar leads a parade around the plaza, and the Hearthbeast follows | Nothing after the moment |
| The royal feast | 2,500 | Long tables fill the plaza and every avatar raises a cup in your name | The tables stand for one day |

The night's chapter may show any of these moments, as it shows everything else that happened. No product leaves a
keepsake, a counter or a place in the season's Chronicle.

Rules for every product, from `ChatDom.md` §8 and the Bits policy:
- No light, no glow, no rank, no place, no serial, no Glimmer, no Hearth, no charges, no seat or queue priority, no
  odds.
- No random contents, no free text, no music by request, nothing about an outcome.
- Nothing giftable or tradeable. Nothing better than an earned piece in the same slot. Nothing past one day.
- No countdowns, no "only 2 left", no nagging. The shelf never moves on its own.
- The shelf does not repeat the cheer ladder. It offers chosen moments that a cheer cannot, so streamers and viewers
  have a reason to use it despite the lower share.
- The same item is never also sold for money on chatdom.gg. Twitch treats that as an exchange of value (guideline
  5.3), and a panel that links to a shop fails review (guideline 4.6.3).

## 18. Money: what Twitch's rails make possible

| Twitch rail | Who is paid | What Chatdom gets | What it may do in the kingdom |
|---|---|---|---|
| Cheers and Power-ups | The streamer, 100% of the Bits [V] | Nothing | Spectacle (§6) |
| Subs and gift subs | The streamer and Twitch [K] | Nothing | Sub pieces and parcels (§5) |
| Hype Train | Made of cheers and subs | Nothing | The festival and the dragon (§7) |
| Bits in the panel | The streamer 0.8 cents and Chatdom 0.2 cents per Bit [V] | 20% of the cent, on Affiliate and Partner channels only | Moments and things that last a day (§17) |
| Channel points | Nobody | Nothing | Moments, small things and the communal pool (§8) |
| Ads | The streamer and Twitch | Nothing | The kingdom holds (§7) |
| Charity | The charity | Nothing | The wishing well (§6) |
| Paid Extension features for streamers | Allowed by guideline 5.1 [V] | A fee | Ruled out: no kingdom is better because someone paid (`ChatDom.md` §8) |

What follows:
- The panel is the only Twitch rail that pays Chatdom. At 0.2 cents per Bit, Chatdom earns $2 for every 1,000 Bits
  used in panels, and $100 (the payment threshold) for every 50,000.
- It pays only on Affiliate and Partner channels that install the panel and switch the shelf on.
- It sits inside `ChatDom.md` §8, because the shelf offers only moments and things that last a day.
- Two of `docs/09` §8's options are now harder:
  - A streamer subscription for tools such as the director or Forge quotas would make a kingdom better for money.
  - Selling cosmetics on chatdom.gg would stop the panel linking to chatdom.gg (guideline 4.6.3), and items sold there
    could never also be Bits products.
- Decided: the panel share comes first. Whether a shop or sponsors follow is decided after one season of data
  (§21).

## 19. What we never do with Twitch

- Read the chat of a channel that has not connected, or use bot pools or anonymous chat to do it.
- Rank people by money or points, or mirror a Bits leaderboard, a gift count, a total spent or top givers.
- Let Bits buy anything that lasts past a day, or let any money buy a vote, the light itself, rank, crowns, scores,
  odds or time.
- Let a cheer, a purchase or a royal press wake the dragon. It is earned only.
- Turn channel points into personal progress. Points raise the town together, through the pool.
- Make clips on the streamer's account.
- Let Bits, points or anything of ours ride on an outcome. Predictions are channel points only, and nothing of ours
  rides on them.
- Announce a lapse, a timeout, a ban or a removal.
- Speak as the streamer, or post for anyone without a preview.
- Create a poll, prediction, raid, VIP or reward without a royal gesture or a standing permission.
- Thank subs and cheers in chat, or repeat anything Twitch already shows.
- Pay anyone for sitting through ads.
- Say "buy", "spend", "purchase", "donate" or "support" about Bits.
- Put "Twitch" in any of our names.
- Keep chat text, or re-host clips and video.
- Let money draw the map.
- Show a simulated event without saying SIMULATED (`Tech.md` §14).

## 20. Retired and retiring Twitch features

Do not design for these:

| Feature | Status |
|---|---|
| Hype Chat | Retired in November 2023 [V] |
| Bits voting in polls | Removed in August 2023 [V] |
| Legacy follows and chatters endpoints, follow events v1 | Withdrawn in 2023 [V] |
| PubSub | Shut down on 14 April 2025; Extension PubSub is unaffected [V] |
| Hype Train v1 events, the old Hype Train events API, `last_contribution` | Gone; the API returns 410 since 22 January 2026 [V] |
| Combos | Switched off on 31 March 2026 and removed from events on 2 April 2026 [V] |
| Stories, Creator Badge Drops | No API, so nothing in the world [V] |
| Gift 'Em All, Community Train, Stream Together | Still experiments or in beta [V]. A Gift 'Em All of up to 1,000 subs plays as a gift bomb |

## 21. Decided on 2026-10-29, and still open

The founder answered the questions of the first version on 29 October 2026. The numbers stay as they were, because
other files point to them.

| # | Question | Decision |
|---|---|---|
| 1 | How should Chatdom earn money from Twitch? | The panel's Bits share first; shop or sponsors decided after one season of data |
| 2 | What may Bits in the panel leave behind? | Moments, and things that last one day in the kingdom; nothing permanent; still ask Twitch in writing |
| 3 | Does a light lit from the panel count as presence? | Yes, under the same idle checks as chat |
| 4 | Do sub months help decide where you live? | Yes: they count toward your street within your follow-year quarter (§5) |
| 5 | Should a sub raise a viewer's trust tier? | No. One person, one vote, and a sub never adds vote weight. A paid sub does not open the Forge's free words either: only time and presence do (founder decision, against the recommendation) |
| 6 | Should big gifters carry a mark of their own? | No: generosity lives in other people's homes |
| 7 | What does the dragon pay out after a Hype Train? | Rewards inside the same daily caps as the free Wyrm Bell |
| 8 | Are channel points showing up, or Twitch money? | Neither alone: points fill a communal pool that raises buildings, shown on stream and in the panel, never personal progress (§8) |
| 9 | May the kingdom make clips on its own? | Never, nor any video of its own; the Gallery uses the director's stills |
| 10 | Should the panel grow into a video overlay? | Panel only in year one |

Decided the same day in other files, and folded in here:
- Subscribers' lights carry a sub tint by tier: warm gold, rose, a rainbow edge (§5; `World-Tree.md`).
- The dragon is earned only: no cheer and no royal press wakes it (§7; `Monarch.md`).
- A big moment's climax never waits for Busy (§7; `Monarch.md` §6.4).
- Only the streamer presses royal acts; there are no stewards (§13; `Monarch.md`).
- A person may live in at most 3 places, and the passport is public on the card (§4, §9, §12; `World-Tree.md`,
  `Atlas.md`).
- chatdom.gg carries no Twitch player (§7).
- The Forge is limited by coals (`Safety.md` §3.2).
- A. A paid sub does not open the Forge's free words. Only time and presence do (founder decision).
- B. Trust tiers never weight a crowd vote. Trust may only decide who may vote, as a guard against brigading. The
  trust weights of 0.25, 1 and 2 in `docs/09` §3 are retired for votes.

**Still open.** Only Twitch's written answer on whether a day-long thing may show on chatdom.gg (§17).

## Sources

Checked on 29 October 2026 [V]:
- Bits Acceptable Use Policy, last modified 4 May 2026: https://legal.twitch.com/en/legal/bits-acceptable-use/
- Developer Services Agreement, last modified 4 December 2024: https://legal.twitch.com/en/legal/developer-agreement/
- Terms of Sale, last modified 12 August 2026: https://legal.twitch.com/en/legal/terms-of-sale/
- Earning revenue from Bits in Extensions: https://help.twitch.tv/s/article/earning-revenue-from-bits-in-extensions
- About monetization on Twitch: https://help.twitch.tv/s/article/streamer-benefits
- How to use Extensions: https://help.twitch.tv/s/article/how-to-use-extensions
- Monetization for All, 13 May 2026: https://blog.twitch.tv/en/2026/05/13/monetization-for-all/
- Extension guidelines and policies: https://dev.twitch.tv/docs/extensions/guidelines-and-policies/
- Extension monetization, life cycle, designing, reference and submission best practices:
  https://dev.twitch.tv/docs/extensions/monetization/, https://dev.twitch.tv/docs/extensions/life-cycle/,
  https://dev.twitch.tv/docs/extensions/designing/, https://dev.twitch.tv/docs/extensions/reference/,
  https://dev.twitch.tv/docs/extensions/submission-best-practices/
- Helix reference and EventSub types: https://dev.twitch.tv/docs/api/reference/,
  https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/
- Changelog: https://dev.twitch.tv/docs/change-log/
- Developer forum on review queues (October 2026) and developer onboarding (March 2026):
  https://discuss.dev.twitch.com/t/65107, https://discuss.dev.twitch.com/t/64649
- Twitch help centre, fetched the same day: Hype Train guide, shared Hype Trains, Power-ups, channel points, viewer
  channel points (watch streaks), predictions, polls, gift subscriptions, subscription streaks, shared chat, Stream
  Together, creator goals, charity, roles, shoutouts, clips, picture-by-picture ads, Ads Manager. Each lives at
  `https://help.twitch.tv/s/article/<name>`, for example https://help.twitch.tv/s/article/hype-train-guide
- Hype Train v1 withdrawal (updated 22 January 2026): https://discuss.dev.twitch.com/t/64299
- Custom Power-ups API (1 May 2026): https://discuss.dev.twitch.com/t/64708
- Bits voting removed from polls (7 November 2023): https://discuss.dev.twitch.com/t/50376
- Power-ups launch, 12 June 2024: https://blog.twitch.tv/en/2024/06/12/introducing-power-ups-unleash-special-effects-with-bits/
- TwitchCon announcements, 17 October 2025 (watch streaks for all):
  https://blog.twitch.tv/en/2025/10/17/ten-years-of-twitchcon-here-s-what-we-announced-in-san-diego/
- Everything marked [V] in `docs/research/tech/twitch-integration.md`, checked the same day

Earlier reports this file builds on: `docs/research/bits-and-ingame-effects.md`, `docs/research/twitch-surface.md`,
`docs/research/kingdoms/twitch-extension-constraints.md`, `docs/08-depth-*.md`, `docs/09-depth-synthesis.md`,
`docs/10`, `docs/11-atlas-map-of-twitch.md`, `docs/12-atlas-lean-spec.md`.

## Change log

- **29 October 2026: first version.**
  - Written from `ChatDom.md`, `Tech.md` §6 and §7, the depth documents and a fresh check of Twitch's rules.
  - The founder asked for an Extension panel, "light your lantern" and Bits in the panel. This file adds the panel,
    with lighting up free forever and a Bits shelf of moments only.
  - New rules: money moves the sky, never the clock; generosity lives in others' homes; money never draws the map; one
    person, many kingdoms.
- **29 October 2026: the founder's answers.**
  - Folded in: the panel share first; Bits leave moments and day-long things, nothing permanent; a panel light is
    presence; panel only in year one; no gifter mark; dragon rewards inside daily caps; no automatic clips.
  - Against the first version's advice, and designed to work: sub months count toward your street within your
    follow-year quarter; subscribers' lights carry a sub tint at the edge, never brighter.
  - The founder's own idea: channel points fill a communal pool that raises buildings, shown on the stream view and
    in the panel (§8).
  - From sibling files: the dragon is earned only; climaxes never wait for Busy; only the streamer presses royal acts;
    at most 3 places per person; public passports; no Twitch player on chatdom.gg; Forge coals (`Safety.md`).
  - §21 now lists the decisions, keeping the old numbers, and two open questions.
- **29 October 2026: consistency pass.** §21 A and B are decided: a paid sub never opens the Forge's free words, and
  trust never weights a vote, only who may vote. The last clip mention in §1 is gone. The stream never shows a viewer
  count (§4). Offices from Twitch are not royal knightings (§3, §10). The Herald's setting points to `Monarch.md` §6.9.
- **2026-10-29: consistency sweep after round 14.** Sub tints by tier (warm gold, rose, a rainbow edge) and an
  animated tier 3 cape (§5, §21). Subs never raise trust (§5). The kingdom makes no videos of its own; "the night's
  recap" is now the night's chapter in the Chronicle (§3, §6, §7, §15, §17, §21). Shield Mode's read is in tier 1, as
  in `Tech.md` §7.2 (§3, §10).
