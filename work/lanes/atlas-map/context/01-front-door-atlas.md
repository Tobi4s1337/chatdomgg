# 1 Front door + Atlas: The front door is the map of Twitch

**End state:** chatdom.io opens on a short, nearly wordless, living story of a kingdom, then hands you the live Atlas: every Twitch channel findable by name, each one a door you can walk through, with your own homes and kingdom glowing on it once you sign in with Twitch.

**Today:** Today "/" is a parchment plate over one static picture, the Showcase is seven text cards, and the Atlas explains its algorithm in paragraphs. Search misses channels outside the survey (even tobi4s_), sign-in fails at Twitch, and the land is still a draft that "may still move".

## A01 Story front page with the live Atlas
- **Tobias note:** Home screen: Atlas as hero or a CTA that scrolls to it; more sections, beautiful polished screenshots, cozy 3D scenes; really ambitious immersive design, low text. Atlas: "overall atlas should be the page on index page".
- **Today (honest):** "/" is the front door (door.tsx): one plate, "Your chat has a home", sign in or look around. Only Willowmere is listed. /showcase is 7 text cards, most marked SIMULATED. 42 strong stills exist on stills.chatdom.io.
- **Decided:** Story first, then the live Atlas (Q17). Live 3D and real captures are best; generated art is fine for concept or ambience (Q21). No SIMULATED labels anywhere (Q25).
- **Ambitious end state:** New visitors get an immersive scroll of 5 to 7 sections, at most about 15 words each: a live in-page 3D kingdom at dusk as the hero (windows light as names appear), presence as light, the Forge turning words into a chimney, a hamlet growing into a city, Twitch both ways (sub, cheer, hype train, raid), then the live Atlas full-bleed with "Explore the map". Signed-in returning visitors land straight on the Atlas, centred on their homes. First paint under 1.5 s on a laptop; the 3D hero streams in after it; a painted still replaces it without WebGL; the phone layout is designed, not shrunk.
- **Done when:** Stills of every section at 1440x900 and 390x844, plus the no-WebGL still; Lighthouse performance 85+ on desktop; route and build tests green.
- **Depends on:** A02 kit, A13 edition (land stops moving), E01 for the hero scene
- **Phase:** 1 First
- **Size:** L
- **Source:** Tobias
- **Notes:** apps/web/src/kingdom-entry/door/door.tsx, apps/web/src/showcase/, apps/api/src/public/routes.ts (PAGES). Stills: /srv/chatdom-stills/site. Quality.md §4, §15. The three Genesis streamers on the Showcase need consent (L12).

## A02 A carved game UI for the Atlas: legend and top card
- **Tobias note:** Give the Legend, the top left card etc. more love, way less text, easier to understand. Feels slightly AI sloppy; unique polished UI with depth. Proper game UI.
- **Today (honest):** Top-left card: title, "Survey preview", "48,345 channels in 34 tongues", "Reading who is on air". The key has 6 paragraphs plus 2 survey disclaimers. DOM parchment cards. Phone folds it into "KEY".
- **Decided:** Quality rule 14: carved and crafted, wood and brass frames, parchment inlays, wax seals; no default controls.
- **Ambitious end state:** One carved brass-and-wood cartouche holds the wordmark and search. A pictorial key of about five glyphs (live, founded, waiting land, road, your home) with no sentences; hover or tap gives one line. Survey facts move into "How it works" (A08). One icon family and one type scale shared by door, Atlas, card and panel. Motion with weight: shutters open, a wax seal stamps within 100 ms. On phones the key is a bottom sheet.
- **Done when:** Desktop and phone stills; the default view shows 25 words or fewer; visible keyboard focus.
- **Phase:** 1 First
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/web/src/atlas/ui/Legend.tsx, ui/chrome.tsx.

## A03 Language continents, renamed and reviewed
- **Tobias note:** Russian area is confusing and can be bad to Ukrainian because of war (feels like we call Ukraine Russian, not the language); rethink.
- **Today (honest):** Continents are labelled by the browser's language names: "Русский / Russian" is the second-largest landmass, directly east of English. zh-hk reads "Chinese (Hong Kong SAR China)". Ukrainian is a 326-channel isle. Twitch gives a stream language, never a country.
- **Decided:** Keep language names, but review them: rename sensitive ones and drop the native-script headline (Q18).
- **Ambitious end state:** A reviewed name table for every language code in the survey replaces the runtime language lookup. Labels name the language of the streams ("Streams in Russian"), never a nation or a political region (zh-hk becomes a neutral "Cantonese"). Ukrainian streams are their own land, never shown as part of a larger continent. Tobias reviews the table before it ships.
- **Done when:** The reviewed table in the repo; stills of the 10 largest continents; a test that no label comes from the browser at runtime.
- **Phase:** 1 First
- **Size:** S
- **Source:** Tobias
- **Notes:** apps/surveyor/src/preview/build.ts:36 languageNames(). Atlas.md §4.1, §10.2.

## A04 Search finds every Twitch channel
- **Tobias note:** Search Twitch names; even if not in our system yet, fall back to an API call and quickly put it on the map (not obvious to the user), so we really cover 100%, even offline channels, in a suitable spot.
- **Today (honest):** Search scans the survey in memory: exact, prefix, word, contains, at most 8 results. Searching "tobi4s_" returns nothing: "No channel called ... is in the survey".
- **Decided:** Fallback is silent. The place is computed from the channel id and stored only when claimed (Q19).
- **Ambitious end state:** Search answers for any existing Twitch login, live or offline. Survey first; otherwise our server asks Twitch (channel search and user lookup), with a 24-hour cache, a negative cache, per-IP limits and a reserved share of the Twitch rate budget, so the Atlas can never starve the kingdoms. An unknown channel flies to a deterministic place in its language and game region, the same spot every time, and nothing is stored. It becomes a stored holding on a raid, a founding or the streamer signing in. To the visitor it looks exactly like any mapped channel.
- **Done when:** Tests: survey hit, fallback hit, nonexistent name, rate limit, cache. Stills of searching tobi4s_ and a random offline channel.
- **Phase:** 1 First
- **Size:** M
- **Source:** Tobias
- **Notes:** apps/surveyor/src/directory/directory.ts search(); apps/web/src/atlas Search.tsx:242. Atlas R17, §8.2. The browser never calls Twitch directly.

## A05 Every name is a door, even unclaimed land
- **Tobias note:** Clicking a kingdom/name should always allow visiting it even if not claimed yet; create it on first join, seeded from the user id.
- **Today (honest):** "Enter the land" opens a kingdom generated from the channel id (atlas-door, AD10), but it is scenery only: not walkable, no avatar. Walking needs a founded kingdom and sign-in.
- **Decided:** A private sketch plus a tent pledge, nudging visitors to tell the streamer to claim it (Q3). Live founding with the streamer stays.
- **Ambitious end state:** Clicking any channel opens its kingdom. Founded: the real kingdom. Unclaimed: a walkable sketch generated from the channel (its emotes, colours, game), each visitor in their own copy, no chat. Visitors can pledge a tent (does not count toward the 3 homes); the sketch shows pledges in bands. A "Tell <streamer> their kingdom is waiting" action gives a ready chat line and a share link. When the streamer founds live, pledges become real tents on the new land, and the sketch is redrawn with them.
- **Done when:** Stills of walking an unclaimed sketch, the pledge and the nudge; test that pledges convert to tents at founding.
- **Depends on:** D02 live founding, H01 look, A09 sign-in
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Tobias
- **Notes:** apps/web/src/genesis/index.tsx ("Potential land is scenery"). Atlas.md §7.3; ChatDom §3.1 "settlers before kings".

## A06 Streamer faces on the cards
- **Tobias note:** Integrate Twitch data better, like avatar pics of the streamers on their cards.
- **Today (honest):** The Surveyor export already carries avatarUrl (Twitch image CDN only, freshness-gated) and the CSP allows it, but the card reply drops it and a test forbids it.
- **Decided:** Atlas §7.2: mapped card shows channel name, avatar, shield.
- **Ambitious end state:** Every card shows the streamer's Twitch picture in a wax-seal frame (shield when stale), whether they are live, their current game, and a "Watch on Twitch" link.
- **Done when:** Card stills: live, offline, stale picture.
- **Phase:** 1 First
- **Size:** S
- **Source:** Tobias
- **Notes:** apps/surveyor/src/export/schema.ts:29,56; directory.test.ts:63.

## A07 The Twitch mark, done right
- **Tobias note:** Maybe a custom Twitch logo in the Atlas painting style; somewhere "not affiliated with Twitch".
- **Today (honest):** No Twitch mark and no disclaimer anywhere.
- **Decided:** The official, unaltered Glitch in a painted frame (Q20). Twitch brand rules forbid altering the logo.
- **Ambitious end state:** The official Glitch logo, unaltered, set in a painted brass seal on the map corner and on each card's Watch button. Every public page says "Live from Twitch. Chatdom is not affiliated with or endorsed by Twitch."
- **Done when:** Stills; a note recording which brand guideline version was checked.
- **Phase:** 1 First
- **Size:** S
- **Source:** Tobias
- **Notes:** brand.twitch.tv. Atlas.md §9.

## A08 "How it works", in pictures
- **Tobias note:** Small "how it works" at the bottom with a modal explaining the tech, easy to understand.
- **Today (honest):** None; the explanation is the legend paragraphs.
- **Decided:** Quality rule 15: every state is designed.
- **Ambitious end state:** A carved tab at the bottom opens four illustrated panels of at most 40 words each: we read public Twitch data; languages become continents and games become realms; live streams glow; every channel is a door. Plus "what we never collect" and a privacy link.
- **Done when:** Stills desktop and phone.
- **Depends on:** L03 privacy page
- **Phase:** 1 First
- **Size:** S
- **Source:** Tobias

## A09 Sign in with Twitch from anywhere
- **Tobias note:** Twitch login generally available; Atlas is the entry point; rethink the UI around that, the logged-out state.
- **Today (honest):** Sign-in uses Twitch openid only and fails at Twitch today because the redirect URI is not registered. The Atlas never reads the session.
- **Decided:** Atlas §3: the signed-out visitor sees the whole map; entering asks to sign in. Ask only for openid; request more scopes at the moment of use.
- **Ambitious end state:** A sign-in seal on the front page and the Atlas. Signed out, everything is browsable and designed. After sign-in you come back to the exact same view (position, zoom, open card), which then opens on your places.
- **Done when:** An end-to-end test: signed out, sign in, returned to the same view. Stills of both states.
- **Depends on:** L01 redirect URI
- **Phase:** 1 First
- **Size:** S
- **Source:** Tobias
- **Notes:** apps/api/src/realm-auth/README.md (returnTo already accepts /map).

## A10 Your places on the Atlas, with your passport
- **Tobias note:** Integrate the passport on the Atlas, highlight the kingdoms you live in (max 3), your own kingdom if you are a streamer.
- **Today (honest):** The passport exists with simulated data only. No real person-to-homes authority across kingdoms. No viewer overlay on the Atlas.
- **Decided:** Atlas §6.1/R18: crown ring for your realm, up to 3 brass home keys, a "Your homes" ribbon. The passport is public on your card with a hide switch.
- **Ambitious end state:** Signed in: your kingdom wears a crown ring, your homes show brass keys, and a "Your homes" ribbon lists them, live first. Your passport opens as a drawer from the ribbon, with stamps from real raids and visits. Your own roads are drawn in your colour, for your view only.
- **Done when:** Stills signed in as a citizen of 3 kingdoms and as a streamer; tests on the disclosure rules.
- **Depends on:** C03 real card and passport data
- **Phase:** 2 Launch
- **Size:** L
- **Source:** Tobias
- **Notes:** apps/web/src/passport/CardPassport.tsx; card-passport lane PARTIAL (register).

## A11 Your character on the Atlas
- **Tobias note:** Option to see your character (if you have one, from the avatar builder).
- **Today (honest):** The builder is a test page that saves to the browser only.
- **Decided:** Try it signed out, saved on sign-in (H01).
- **Ambitious end state:** Your saved look stands at your home key and in the ribbon. "Change your look" opens the builder.
- **Done when:** Stills.
- **Depends on:** H01 real look
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Tobias

## A12 Streamers can hide their channel themselves
- **Today (honest):** Only an operator-run withheld list exists.
- **Decided:** Show every channel, with a self-serve hide (Q39).
- **Ambitious end state:** A streamer signs in with Twitch, opens their card and presses "Hide my channel": gone from map, search and cards within a minute; unhide any time. The operator list stays for abuse.
- **Done when:** Test and stills.
- **Depends on:** A09
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** Atlas.md §9 promises it.

## A13 Found Atlas Edition I, so the land stops moving
- **Today (honest):** Only a survey preview is served, with "draft land may still move". Edition I can be founded from about 5 Nov.
- **Decided:** Principle 3 (nobody moves) and stable search places depend on frozen land.
- **Ambitious end state:** Edition I is founded: positions are stable, the draft wording disappears, new channels slot in without moving anyone.
- **Done when:** Edition id served; stills before and after.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
- **Notes:** atlas lane; atlas-refresh imports every 6 h.

## A14 The Atlas is fast enough to be the front page
- **Today (honest):** /map preloads realm and identity chunks; world.json is 860 KB raw.
- **Decided:** Atlas §8.6: first frame under 1.5 s on a laptop.
- **Ambitious end state:** First frame under 1.5 s on a mid laptop; tiles and data streamed and compressed; the hero never waits on the map renderer.
- **Done when:** Lighthouse and a real-GPU timing on Tobias's PC.
- **Phase:** 2 Launch
- **Size:** M
- **Source:** Added
