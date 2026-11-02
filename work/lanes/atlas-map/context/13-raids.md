# 13 Raids: Raids: ride out together, leave a road

**End state:** Raids are the moment kingdoms meet. When a channel raids in, a caravan rolls through the gate under the raider's banner, the raiders who walk in arrive as guests and earn a passport stamp, and a road inks onto the Atlas. At the end of a night the streamer opens the Raid Gate: walkers gather with torches, Twitch confirms, the camera rises to the map of Twitch and the column rides the road to a friend. It works for real on tobi4s_.

**Today:** Raids are the best-specified part of the design (spec 23 with 14 rules, spec 45, Twitch.md §9, Moments §7) and much of the server side is built and tested: preview, consent, departure only on a witnessed raid, safe transfer and return, visitor gifts on Postgres. But no real raid has gone through the whole chain. The departure is still a flat paper tableau over the 3D town, Atlas roads are not durable, passports show no real stamps, and I found only the incoming raid subscription, not the outgoing one.

## R01 A real incoming raid lands as a show
- **Tobias note:** We really need to nail the raids.
- **Today (honest):** Herald subscribes to raids into tobi4s_; the realm has a raid spectacle and the twitch-moments caravan art exists. Never proven with a real raid on tobi4s_ (TM11 and RG11 open).
- **Decided:** Real incoming raid for the first release (Q43). No tribute (Q45).
- **Ambitious end state:** When a real channel raids, within seconds a caravan comes through the gate under the raider's banner and colours, sized by the log of the viewer count, and the stream camera frames it. The crier posts one welcome line with the link. The raider's dated pennant joins the banner wall by the gate. A road appears on the Atlas (R06). At 5 viewers a raid of 3 is the night's biggest moment; at 50,000 a raid of 10,000 is a column. No tribute.
- **Done when:** A real raid into tobi4s_ from a friend's channel, recorded; tests for duplicate, late and restarted delivery.
- **Depends on:** R06
- **Phase:** 1 First
- **Size:** L
- **Source:** Tobias
- **Notes:** apps/herald/src/ingest/spectacles.ts:52; apps/realm/src/moments/spectacles.ts:45; apps/web/src/twitch-moments/raid-art.ts; Twitch.md §9.

## R02 Raiders who play become characters
- **Today (honest):** Raiders who chat get crest bubbles in the docs; nothing walks.
- **Decided:** People actually playing right now join the world as characters and earn a passport entry; make it awesome (Q44).
- **Ambitious end state:** Raiders who open the kingdom from the welcome link (one-click sign-in) arrive at the gate as walking guests in their home kingdom's colours and crest, are greeted by name, and can walk, wave and visit. Raiders who only chat light lanterns along the caravan, with crest bubbles. Every raider who walks in, or chats here within 10 minutes, earns a verified passport stamp. A visit never creates a home or any standing here.
- **Done when:** A recording with two real walkers arriving with a raid; stamp tests.
- **Depends on:** R01, R08
- **Phase:** 1 First
- **Size:** L
- **Source:** Tobias
- **Notes:** spec 23 R6, R8.

## R03 The Raid Gate: ride out, for real
- **Today (honest):** Server side built and tested: preview, consent, departure only on Twitch's confirmation, reserve, prepare, commit, return (RG07 to RG10). The Atlas finder and march (A13) are deferred. The dock has a raid-welcome button.
- **Decided:** Real Raid Gate out for the first release (Q43).
- **Ambitious end state:** At the end of a stream the streamer presses Raid Gate in the dock. The Atlas opens in gate mode: friends with roads first, then smaller live channels, never paid ordering. The preview shows the destination and the real number of walkers who chose to march. One press starts Twitch's countdown. Walkers gather at the gate with torches; on Twitch's confirmation the kingdom recedes into ink, the camera rises to the Atlas and the torch column rides the road. Marchers arrive at the destination's gate (founded) or its waiting land, and can come home whenever they like.
- **Done when:** A real raid from tobi4s_ to a friend, recorded at each stage; the spec 23 integration test.
- **Depends on:** R04, R05, R06, D04
- **Phase:** 1 First
- **Size:** XL
- **Source:** Added
- **Notes:** apps/api/src/raid-gate, apps/realm/src/raid-gate, apps/web/src/raid-gate; spec 23; Atlas PRD A13.

## R04 Outgoing raid plumbing
- **Today (honest):** Herald's raid subscription is for raids into the channel only. Start a Raid needs the channel:manage:raids grant; I did not confirm it is among the 8 scopes granted.
- **Decided:** Spec 23 R3: depart only on Twitch's witnessed raid.
- **Ambitious end state:** Each kingdom also listens for raids it sends, the raid permission is asked when the streamer first opens the gate, and Start and Cancel go through the authorized Twitch transport exactly once per press.
- **Done when:** Tests; a real start and cancel on tobi4s_.
- **Depends on:** D05
- **Phase:** 1 First
- **Size:** S
- **Source:** Added
- **Notes:** apps/herald/src/ingest/subscriptions.ts:68 (to_broadcaster only).

## R05 Departure in the world, not on paper
- **Today (honest):** The raid-road checkpoint draws the departing party as flat figures over the 3D town (work/evidence/raid-road/after-gate-1920.png).
- **Ambitious end state:** The real walkers, in their own looks, gather at the kingdom's actual gate, lit by its torches, with banners; the streamer leads. It reads at stream distance.
- **Done when:** Stills at 1920x1080 and phone.
- **Depends on:** R03
- **Phase:** 1 First
- **Size:** M
- **Source:** Added
- **Notes:** apps/web/src/raid-gate/road/; raid-road lane next step.

## R06 Roads that last
- **Today (honest):** Roads are drawn, but witnessed raids are not yet stored as durable roads (Atlas A16, A07 open).
- **Decided:** Spec 23 R11: roads ink on the first raid, thicken with more, fade to dotted after an unused season, never disappear.
- **Ambitious end state:** Every witnessed raid becomes a road between two kingdoms on the Atlas, robust to duplicates, gaps and restarts. Roads thicken with use, cross languages as sea lanes, and following a road takes you there.
- **Done when:** Tests; stills of a road before and after a reload.
- **Phase:** 1 First
- **Size:** M
- **Source:** Added
- **Notes:** work/lanes/atlas/PRD.md A16, A07.

## R07 Arriving somewhere
- **Today (honest):** The destination welcome uses the kingdom's own in-world moment feed (RR10); the waiting-land path exists in the spec.
- **Decided:** Nothing is posted in the destination's chat (Q46).
- **Ambitious end state:** At a founded kingdom the party arrives at its gate under the source banner, and anyone with a home there sees their own light come on. At waiting land, marchers see the land with "Watch on Twitch" and a tent pledge. Nothing is posted in the destination's chat.
- **Done when:** Stills of both arrivals.
- **Depends on:** R03, A05
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** Monarch.md §220.

## R08 Passport stamps from real raids
- **Today (honest):** The passport shows simulated stamps; production travel lists are hard-coded empty.
- **Decided:** Spec 23 R8, R10: stamps only from witnessed history; no rewards for raids under 3 viewers; at most 2 rewarded raids a day.
- **Ambitious end state:** Each verified raid ridden or joined earns a dated stamp on the citizen card, with a working hide switch. The Atlas never shows anyone's travels.
- **Done when:** Tests; card stills.
- **Depends on:** C03
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** spec 45; apps/api/src/passport.

## R09 Gifts between kingdoms
- **Today (honest):** RG10 gift policy and Postgres store are built; not connected to an item authority or a visible surface.
- **Decided:** Spec 23 R9: kindness, never damage.
- **Ambitious end state:** Visitors and hosts offer each other things that are really theirs; the gift keeps its maker's story home.
- **Done when:** Recording; concurrency tests on real Postgres.
- **Depends on:** G01
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** apps/api/src/raid-gate/gifts.ts.

## R10 No raid tribute
- **Today (honest):** Twitch.md §9 and Moments.md plan a Codex-forged tribute per raid.
- **Decided:** No tribute (Q45).
- **Ambitious end state:** The tribute is removed from the raid moment and the vision files.
- **Done when:** Docs and code updated.
- **Depends on:** L13
- **Phase:** 1 First
- **Size:** S
- **Source:** Tobias

## R11 Raid trains
- **Today (honest):** Detection is deferred (Atlas A08).
- **Decided:** Moments §12: carriages under each earlier kingdom's banner; a named line on the Atlas.
- **Ambitious end state:** A raid train arrives as a line of carriages, one per earlier kingdom, and stays on the map as a named line ("the Autumn Raid Train, 7 kingdoms").
- **Done when:** Tests with a chain of raids; stills.
- **Depends on:** R06
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Added

## R12 When a raid turns ugly
- **Today (honest):** No shutter key; Shield Mode not handled.
- **Decided:** Monarch.md: the shutter; Safety case 8.
- **Ambitious end state:** One press of the shutter cuts the stream view to a calm wide shot; Shield Mode closes the gate; raiders' makings pass the same visitors.
- **Done when:** Tests.
- **Depends on:** D04, D07
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added

## R13 Raid shots for the showcase video
- **Today (honest):** Three raid-road stills exist, with SIMULATED chips.
- **Decided:** Staged and cinematic, no labels, made so a first-time viewer gets it at once (Q43, Q25).
- **Ambitious end state:** A raid sequence for the showcase video: the gate wakes and torches gather; the march; the camera rises from the kingdom to the map of Twitch as the road inks across it; arrival under the banner at a friend's kingdom; a huge raid as a column pouring through the gate.
- **Done when:** Tobias approves the sequence.
- **Depends on:** K01, K03, R05
- **Phase:** 1 First
- **Size:** M
- **Source:** Tobias
- **Notes:** Ties into K02.
