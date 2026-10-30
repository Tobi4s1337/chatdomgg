# Safety

The rules for what people make in Chatdom: what may be made, how it is judged and by which models, what a person sees
when the kingdom refuses or holds something, and what the channel's mods and the monarch decide. Internal. Started
2026-10-29.

This file is derived from `ChatDom.md`, above all principle 15 ("kindness leaves a trace, unkindness leaves nothing")
and principle 16 ("magic, under rules"). `Tech.md` §9.6, §11.3 and §13 build it. `Monarch.md` owns how the streamer's
and mods' console looks; this file owns the rules and the review flow it shows. `World-Tree.md` owns what things exist.
When this file disagrees with `ChatDom.md`, `ChatDom.md` wins.

Only one part is deep for now: safety for what people make. Voice, harassment, bans and the law are listed in §7.

Evidence labels: **[V]** verified on 2026-10-29 at the linked source; **[K]** prior knowledge; **[?]** not verifiable;
**[E]** our estimate, to be measured.

## 1. In short

- **Every made thing passes two checks:** a gate on the words before anything is made, and a check on the result (its
  render or final text) before anyone else sees it.
- **The stream is the strictest audience.** The stream view only receives things that passed both checks. A refused or
  held thing never reaches it. A refusal may air only as a nameless comic beat that never shows or hints at the words.
- **Shapes first, judges second.** Free words and free voxels carry the heaviest checks.
- **The judges are direct calls made by our service, outside the Codex run they guard.** GPT-6 Luna on OpenAI's
  Decisions API asks our policy questions about words and images; OpenAI's free moderation endpoint runs beside it;
  GPT-6.1 Terra gives a second opinion on uncertain images. A Luna check costs a hundredth of a cent or less, and
  judging adds 1 to 2.5 s to a 15 to 30 s Forge ritual.
- **Four outcomes:** pass; soften (the forge makes something close and says so); hold (only the maker sees it until
  the Watch decides); refuse (nothing is made or charged, and the forge says why in its own voice).
- **The Forge is limited by coals and anvils.** Each night you are here, your hearth gives you a coal; the forge takes
  one, burns only while the stream is live, and works only as many pieces at once as it has anvils. Nothing buys more.
- **The channel's mods decide; the system proposes.** Automatic actions only hold or hide a thing.
- **Nothing harmful becomes permanent or travels.** A thing veiled at home is veiled everywhere.

## 2. Principles

**1. The stream is the strictest audience.**
- **Why:**
  - The stream reaches everyone at once, from age 13, live, clipped and kept.
  - Twitch makes the streamer answer for it: "You are responsible for ensuring that content that appears on your
    stream abides by our Terms of Service and Community Guidelines." It spares those "acting in good-faith to remove
    abuse appearing from third parties" with the tools [V](https://safety.twitch.tv/s/article/Community-Guidelines).
  - In 2019 a streamer was banned for 24 hours when a viewer's text-to-speech donation read a slur while he was away
    [V, press](https://www.dailydot.com/upstream/twitch-streamer-racist-text-to-speech/).
- **So:**
  - The stream view receives a made thing only after both checks, and after a human where the monarch asks (§5.8).
  - Held and refused things are never in the stream view's data, as secrets never are (`Tech.md` §6.8).
  - A Forge prompt shows on stream as runes in the Chatdom alphabet, never as readable words.
  - The safety keys (`Monarch.md` §7.4) take one thing off the stream, quiet the stream for the night, or close the
    shutter. Twitch's good-faith protection rests on such tools being there and used.
  - The same bar covers the Chatdom panel, the Herald's chat lines and the Voice of the Realm. Twitch's Extension
    policies already require broadcaster review of viewer-submitted media, with the submitter's name shown
    [V](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/).

**2. Shapes before judges.**
- **Why:** every judge makes mistakes, and a plan made of enums, authored parts and vetted words cannot carry most harms
  at all. Roblox draws the same line: things "players assemble with 3D assets" stay suitable for children, while
  free-form drawing and pixel grids are 16+ [V](https://create.roblox.com/docs/production/promotion/content-maturity).
- **So:**
  - Every kind of made thing is designed narrow first: slots, menus, palettes, phrasebooks, length limits.
  - What cannot be judged before others see it is not offered: private messages between strangers, voice outside the
    campfire, new game rules until they pass their test (`Tech.md` §10.3). The one free public sentence, on a door
    sign, carries the strictest checks (§3.1).
  - A new kind of made thing ships only with its gate, check, hold flow and golden test set.
  - Every made thing carries its maker's name, because authorship deters
    [V, press: Dreams](https://www.gamesradar.com/dreams-creator-early-access/).

**3. A refusal is part of the magic, never an error.**
- **Why:** `Quality.md` rule 17. A refusal is the forge answering.
- **So:**
  - It speaks in the kingdom's voice, names the kind of limit, and offers the nearest thing it can make.
  - It never lectures, never echoes the refused words, never says which word or question caught it, and never says
    "violation", "flagged" or "banned".
  - It costs nothing: the coal comes back. There is always a next step (Quality rule 7).

**4. Never shame the maker in public.**
- **Why:** unkindness should leave nothing, including the kingdom's response to it. A public refusal also gives a troll
  the attention they came for.
- **So:** refusals, holds, hides and strikes are seen only by the maker, the Watch and the monarch. Nothing in the world
  marks them. A refusal may air as a nameless comic beat that never shows or hints at the words, and never with a name
  (§5.3).

**5. The channel's mods decide; the system proposes.**
- **Why:** principle 15 makes the channel's moderators and Twitch's rules the authority. Models also trail people: on
  hateful memes the best model scored 69.5% against people's 84.7% [V](https://arxiv.org/abs/2005.04790).
- **So:**
  - Judges pass, soften, hold or refuse one thing at a time, with a reason.
  - Only a person can veil a published thing for intent, record a strike, lower trust or act on Twitch.
  - The monarch's word is final in their kingdom, above the floor.

**6. Fail closed, but gently.**
- **Why:** an unsure or missing judge that lets things through puts the risk on the stream; one that stops everything
  breaks the night.
- **So:** unjudged things wait in the maker's draft or keepsakes while the world goes on. When the judges are down, the
  forge is "cold tonight" (`Tech.md` §11.3). Nothing unjudged reaches the stream view.

**7. One floor for every kingdom; each monarch may raise their own bar.**
- **Why:** the audience starts at 13 everywhere and Twitch's rules bind every streamer. Communities want different
  things on top.
- **So:**
  - **The floor** (§3.1) binds everyone, monarchs included.
  - **The kingdom's bar** is the monarch's: making modes, the channel's blocked terms, themes they do not want. It can
    only be stricter.
  - A thing visiting another kingdom meets that kingdom's bar there.

**8. Every decision leaves a record and a way back.**
- **Why:** mistakes happen both ways. A false refusal hurts belonging; a missed harm hurts the stream.
- **So:**
  - Every verdict is stored with its judge, reasons, question set and model.
  - Every hide carries a reason the maker can read, and a fix where there is one.
  - A person's decision can be undone by them for 24 hours, and by the monarch at any time.
  - When our check missed something, the maker is not punished: a veil, a refund, no strike. Roblox gives no
    consequences "for violative outputs generated in response to non-violative inputs"
    [V](https://create.roblox.com/docs/generative-AI).

## 3. What people make

### 3.1 Every kind of made thing

**The floor**, for everything: no sexual content or innuendo; no hate, hate symbols or hate codes; no harassment; no
real, identifiable person without consent; no personal information; no gore, self-harm or real-world violence beyond
storybook fantasy; no gambling for value; no real-world drugs or instructions to drink; no one else's brands, logos or
characters in anything the magic makes. Storybook fantasy is inside the floor: swords, dragons, skulls, ghosts,
battles, cider and ale.

| What | Main risks | Gate before (words) | Check after (result) | Who decides | On stream |
|---|---|---|---|---|---|
| **Forge items**, prompted builds (Draft-a-Home, wonder templates) and raid tributes | A harmful idea; a harmless prompt yielding a bad name or plaque; IP; real people | Filters, moderation endpoint and Luna; scope (one of 18 slots); soften or refuse | Beauty check; contact sheet to Luna; name and plaque as displayed to the text checks. Wonder templates also need the monarch | Judges; the Watch for holds; the monarch's unforge key | The reveal, after both checks; the maker's name lands with the seal |
| **Genesis** (the founding, live on stream) | Generated names, mottos and street names; a typed motto; emote statues; settlers' and followers' names over doors | Every generated word through the text checks before the ceremony shows it; the streamer's own name or motto checked as they type | Statues and crest to Luna before they are offered; a name that fails the name check shows as "a settler" | The streamer, live | Each reveal only after its check (§6, case 10) |
| **Hand-built homes and yards** (free voxels) | Symbols, words and obscene shapes in blocks | Drafts are private. Publishing free voxels is for returning citizens (a return visit or 30 days of follow); newcomers use starter homes, pieces and Forge parts | At publish: shape detectors, Luna, Terra if unsure. The last approved version stays live meanwhile, as on Fortnite islands [V](https://dev.epicgames.com/documentation/en-us/fortnite/island-moderation-tips-and-faqs-in-fortnite-creative) | Judges; the Watch | Housewarming only for a passed version |
| **Wards and shared builds** | A symbol spread over plots; griefing a shared canvas | Wonders and the Folly fill voted templates only | A top-down ward composite daily and every 20 publishes; wonder zones each minute while active | The Watch; all plots involved held together | Wide shots, impostors and the Atlas drawing are baked only from passed versions; the drawing is checked whole before it replaces the stamps (`Atlas.md`) |
| **Looks** (wardrobe, dyes) | Parts that combine into hate imagery, as Roblox's moustache, khaki jacket and red armband did [V](https://about.roblox.com/newsroom/2024/04/scaling-safety-civility-roblox) | The catalogue leaves such parts out | Reports; the frame check | The Watch | Yes |
| **Flags on homes** | Politics, contested flags, slogans | A curated, hand-made set of identity and national flags as banner pieces; no slogans, parties or movements | None: the set is authored | Reports about a flag go to Chatdom staff as a review of the set, never to veil one home | Yes |
| **Names** (homes, pets, guilds, blueprints; chat-picked names for streets and the great beast) | Slurs, leetspeak, codes, real people, innuendo, sound-alikes; brigaded votes | All text checks, the channel's AutoMod included, written and spoken; 24 characters. Vote candidates are gated and approved by the Watch first | None | Judges; the Watch | Once passed; a held name shows the default |
| **Plaques and signs** | A free public sentence is the hardest text to judge, and a sign can target a neighbour | Forge plaques: a template plus one generated line. Door signs: the name, icons, and one free sentence from tier 1+ citizens, up to 60 characters, changed at most once a day, through every text check, the channel's AutoMod and spoken form included | As names; a neighbour's report hides the sign for them at once | Judges; the Watch | Readable on stream only after it has stood through one stream night unreported, or a human passed it; until then the director frames it as carving |
| **Free-text notes** (letters, guestbook, notices, gift notes) | Harassment, personal information, grooming | Tier 1+ only; all text checks; held text is not stored | None | Judges; the Watch on reports | Never |
| **Phrasebook lines, in-jokes** | Bad combinations | Vetted words; the monarch approves each in-joke | None | The monarch | Yes |
| **Prompted games** (request, skin, word lists) | Sexual, gambling or drinking premises; real people as pieces | Luna on the request; families and settings from a fixed, verified menu; new rules off at launch (`Tech.md` §10.3) | Skin text through the text checks; word lists sampled to the monarch | Judges; the monarch for crowns | After the checks |
| **Table text and drawings** | Live drawings, typed answers | Text checks; drawing on stream needs tier 1 | A drawing is sampled each second; the pad blurs on a flag | The Watch; one-key blur | Through a 4 s buffer (`docs/08-depth-minigame-engine.md` §3.11) |
| **Decrees, royal letters** | The monarch's own words | Previewed by the monarch; Codex drafts are gated | Twitch checks its own polls | The monarch | Yes |
| **Chat in the world** (bubbles) | Lines AutoMod missed | Twitch's AutoMod and the channel's settings | Deletes, timeouts and bans pop bubbles within 1 s | The channel's mods, on Twitch | Words from tier 1+ only; tier 0 shows a glyph |
| **Emotes as voxels** (statues, banners, motifs) | A 28 px image reads differently as a 4 m statue; 7TV, BTTV and FFZ emotes are not reviewed by Twitch | The monarch confirms each statue and opts in each third-party emote | The extruded version to Luna at statue scale | The monarch | After both |
| **Words the kingdom says** (the Voice, the crier, the keepers of places, the Herald) | Repeating a bad name; a name that sounds bad aloud | Only passed names are quoted; a Twitch name that fails the name check is never spoken | Text checks, spoken form included; Herald lines also meet AutoMod | The monarch can veto the Ballad | Yes |
| **Crests and banners** (guilds) | Symbols | Fixed charges, colours and emotes | The composed crest to Luna | The Watch | Yes |
| **Scenes on stream** | Avatars standing in a symbol; passed things that read badly together | None possible | A frame of each wide shot every 10 s to Luna; on a flag the director cuts away and alerts the Watch. About $0.04 an hour per live kingdom [E]. Roblox now judges whole scenes [V](https://about.roblox.com/newsroom/2026/03/safety-snapshot-march) | The Watch | The last net |

**The Forge opens branch by branch** (`World-Tree.md`): house parts now, worn pieces on sockets next, creatures never.
A worn piece goes with its owner into every kingdom and onto every stream, so that branch opens only with its own
golden set, and a worn piece meets each kingdom's bar wherever it is worn.

**Door signs carry one free sentence** (founder decision). It works because the sentence is short, changes at most once
a day, passes every text check, and reaches the stream only after a night unreported or a human pass. The real risk is
volume: free sentences will fill the hold band faster than anything else, so the first month measures the hold rate
per kingdom.

### 3.2 How often: coals and anvils

*Founder input, 2026-10-29: the Forge needs limits on how often and when, and they should feel intuitive.* The limit
is also the main defence against floods and trolls. It replaces the weekly free forge and the 150-Hearth price in
`Tech.md` §11.3.

**The whole rule, as a citizen learns it:** each night you are here, your hearth gives you a coal. The forge takes one
coal, and it only burns while the kingdom is awake.

- **Coals.**
  - A citizen with a home gets one coal on each stream night they are present for at least 10 minutes: chatting,
    walking or quietly watching, as counted by `presence.tick`.
  - They hold at most 3 coals, whatever their trust. Coals never expire (nothing is lost), but a full scuttle earns no
    more.
  - A forge costs one coal. So does commissioning a copy of someone's piece.
  - Coals belong to the kingdom where they were earned. A person lives in at most 3 places, so a person forges in at
    most 3 kingdoms. A monarch earns and spends coals in their own kingdom too: the castle acts as their home for
    coals, but not toward the 3 places.
  - Coals cannot be bought with Bits, money or Hearth, and cannot be given from one citizen to another. Money never
    buys more forging (principle 4 of `ChatDom.md`).
  - You see your coals in the scuttle by your door, on your citizen card and on the forge's slate. The panel shows
    them to people who only chat.
- **The forge burns while the kingdom is awake.** When the stream goes live, smoke rises from the forge; when it ends,
  the forge is banked (founder decision). Between streams, walkers can still visit the forge, see what was made, and
  keep a plan at the Smith's Bench for next time.
- **Anvils.** A kingdom forges at most as many things at once as its forge has anvils: 2 in a hamlet, one more for
  about every 50 people present, up to 24 and within the kingdom's spell budget (`Tech.md` §19, question 3) [E]. A new
  anvil is a small moment ("the forge has a third anvil"). Waiting is a numbered place, not a line you stand in: a
  chime calls you when an anvil is free. If the wait passes 10 minutes, the forge says "the forge is busy tonight;
  your coal keeps".
- **One thing in the fire** per person at a time.
- **Trust decides what you may bring, not how often you may come:**

  | Who | At the forge |
  |---|---|
  | A newcomer in a tent | Watches. A tent has no slots, so there is nothing to forge onto yet |
  | Trust 0 with a home | The Smith's Bench only: slot, motif and colours from menus, a name from three suggestions. No free words, so only the result is judged |
  | Trust 1 | Their own words. Up to 3 coals |
  | Trust 2 | Their own words. Up to 3 coals, like everyone, and grand pieces where the home allows |
  | A visitor from another kingdom | Watches. Visitors are trust 0 there and earn no coals (`Tech.md` §6.7) |

  Subs never raise trust and never add vote weight: one person, one vote (founder decision). A sub never opens the
  forge's own words either: only time and presence do (founder decision, `Twitch.md` §21). Trust never weights a vote; it may only decide who
  may vote.
- **The forge roars.** On the monarch's decree, or after a Hype Train, the forge roars for 15 minutes and lights two
  extra anvils, so more people can forge at once. A roar never adds coals: coals come only from showing up (founder
  decision), so its rewards stay inside the daily caps. Nobody can hand out a coal, not even the monarch.
- **Damp coals.** Two refusals for harm within 24 hours, and that person's coals are damp until the next stream:
  "Your coals are damp. They will be dry next time." Nobody else knows (§5.7).

**Why this shape:**
- **It explains itself.** Running out says what to do: come back. And it rewards only showing up (`ChatDom.md`
  principle 2).
- **It bounds every flood.** A raid of fresh accounts has no homes and no coals; a hundred alts would each need a home
  and a night present per forge; a capital forges only as fast as its anvils, so the Watch's queue and the spell bill
  have a ceiling.
- **The Watch is there.** Things are made while the mods and the safety keys are at hand.
- **It fits every size.** A regular forges about once a stream night in a hamlet or a capital. Filling a home's 18
  slots takes weeks, which is a reason to come back.

## 4. The judges

### 4.1 Six layers, cheapest first

| Layer | What | Sees | Time | Cost |
|---|---|---|---|---|
| 0. Shapes | Schemas, enums, authored parts, phrasebooks, limits | The plan | 0 | 0 |
| 1. Filters | Word lists per language after normalising (case, accents, leetspeak, look-alike and zero-width characters, spacing, reversal); the channel's blocked terms; hate codes such as 14, 88 and 1488 [V](https://www.adl.org/resources/hate-symbols/search); shape detectors for the hooked cross and its relatives in 8 orientations, mirrored | Text; flat voxel projections | Under 10 ms | 0 |
| 2. The channel's AutoMod | Twitch's Check AutoMod Status: the broadcaster's own token with `moderation:read`, 100 strings a call, a yes or no only. Per channel: 5 calls a minute and 50 an hour, 30 and 300 for Partners [V](https://dev.twitch.tv/docs/api/reference/) | Free text from people | Batched; a name may wait up to a minute to go public | Free |
| 3. OpenAI moderation | `omni-moderation-latest`. Images only for sexual, violence and self-harm; hate and harassment are text only [V](https://developers.openai.com/api/docs/guides/moderation) | Text, some images | A few hundred ms [?] | Free [V](https://developers.openai.com/api/docs/pricing) |
| 4. Luna on Decisions | `gpt-6-luna` through `POST /v1/decisions`, asked our questions as predicates, choices and scores [V](https://developers.openai.com/api/docs/guides/decisions) | Text, images and JSON together | "About 10x faster than the Responses API", by OpenAI's claim [V]; target under 0.5 s [E] | About $0.00002 a text check, $0.0001 an image check [E] |
| 5. Terra | `gpt-6.1-terra`, reasoning `none`, structured output, given the sheet and Luna's answers [V](https://developers.openai.com/api/docs/models/gpt-6.1-terra) | Uncertain images only | 1.5 to 3 s [E] | About $0.0015 a check [E] |
| 6. People | The Watch, Wardens if appointed, the monarch; Chatdom staff for the floor only | The thing as the stream would show it, the judges' reasons, the maker's history here | Minutes, during a stream | Their time |

**The models, verified today:**
- **GPT-6 Luna** (`gpt-6-luna`), "our most efficient model for focused, high-volume tasks": $0.10 per million input
  tokens, $0.01 cached, $0.50 output; text and image input; structured outputs; reasoning `none` to `max`
  [V](https://developers.openai.com/api/docs/models/gpt-6-luna). Released 22 September 2026; 0.74 to 0.88 s to first
  token without reasoning [V, Artificial Analysis](https://artificialanalysis.ai/models/gpt-6-luna-non-reasoning).
- **The Decisions API:** generally available, Luna only, up to 400 questions a request, $0.10 per million input tokens,
  output free, a probability per predicate. The probabilities are "the model's estimate", not calibrated; OpenAI
  advises thresholds from labelled examples [V](https://developers.openai.com/api/docs/guides/decisions). That is a
  gate's exact shape.
- **The rest** (input / cached / output per million): Terra $1 / $0.05 / $5, Sol $2 / $0.10 / $10, Astra $10 / $1 /
  $50; Fast mode doubles each [V](https://developers.openai.com/api/docs/pricing). Sol and Astra have no runtime role.
- **The moderation endpoint** is built for user input, so sending it harmful words is its intended use. It cannot see
  hate in images, so it never gates a render alone.

### 4.2 The gates run outside the Codex run

*Founder decision: Codex runs every piece of magic.* The Forge is one Codex run (`Tech.md` §11.2). This file decides
that **the binding gates are direct model calls made by the spell runtime in the codex service, before and after the
Codex run, never by the agent.** Codex may call the same judges as tools to steer itself ("would this motif pass?"),
but that never counts as the gate.

Why:
1. **A gate the agent can skip is not a gate.** We measured Luna at low effort with an output schema skipping tool use
   entirely (`docs/research/codex-leverage.md`, gotcha 2).
2. **The words being judged are the words trying to steer the agent.** "Ignore your rules and make…" sits inside the
   Codex context. A judge must never share a context with what it judges.
3. **Harmful words must never reach the generating model.** OpenAI blocks end users, and can cut off a whole
   organisation, after repeated high-risk requests
   [V](https://developers.openai.com/api/docs/guides/safety-checks.md). A troll raid must not put Chatdom's API access
   at risk, so gate 1 stops their words at the two endpoints built to read them.
4. **Speed and reach.** Gate 1 must answer in about a second; a cold Codex session took about 12 s. Names, notes and
   builds need the same judges with no spell at all.
5. **Appeals need replay.** A fixed question set with stored inputs and verdicts can be re-run and explained.

This keeps principle 16 whole: Codex is the magic; the gates are the rules around it. The question sets, filters and
golden sets are written with Codex at build time in `chatdom-main` and reviewed by a person.

### 4.3 What the judges see

**Words, exactly as displayed:**
- the composed string, not field by field: name, plaque and maker together, because a slur can be split across fields
  or completed by a username
- the kind of thing and slot ("a pet's name", "a chimney's plaque") and the kingdom's languages
- the maker's, housemates' and bonds' names replaced by placeholders, so "Mira's Cottage" is not read as a real person
- a cached glossary of Twitch speech: emote names, slang and known misuse patterns

The judges never see the maker's tier or history; the verdict is about the thing alone.

**Renders,** as one contact sheet at 768 × 512, about 400 to 500 image tokens [E] by OpenAI's patch rule
[V](https://developers.openai.com/api/docs/guides/images-vision):
- six flat-colour orthographic views with lighting off: top, front, back, left, right and the street view
- one tile of the street view shrunk to 64 px and blurred

Shading hides shapes that colour reveals, and most symbols in blocks are drawn in colour or seen from above. The blurred
tile is there because hidden images appear at a distance: on 1,571 images with hidden hate messages, moderation
classifiers caught under 24.5% and vision-language models under 10.2% [V](https://arxiv.org/abs/2507.22617). The
deterministic detectors run on the same projections, one colour at a time.

**The questions** are a fixed, versioned set per kind of thing. For a render: does any view show a hooked cross, SS
runes, a noose or another hate symbol; genitals, a sexual act or a crude gesture; readable letters, numbers or a logo,
and what do they say (those words then go through the text checks); a real person's likeness; something broken or
unlike its slot?

### 4.4 Time and cost

**Inside the Forge ritual:**

| Time | The maker sees | What runs |
|---|---|---|
| 0 to 0.1 s | Runes lift and circle the anvil (Quality rule 2) | The client starts the ritual |
| 0.1 to 1 s | Runes circle | Gate 1: filters, moderation endpoint and Luna, in parallel |
| About 1 s | Refuse: the runes scatter and the fire gutters, with the forge's line. Soften: the runes rearrange and the forge says what it will make, with a free "stop" for 3 s | Gate 1's verdict |
| 1 to 25 s | Blueprint, molten voxels | The Codex run |
| About 1.5 s | The wax seal descends | Gate 2 on the sheet and the composed text; Terra only if unsure |
| Then | Hammer, cooling, the arc to the house | Mint and place |

Elsewhere: a table request is gated alongside routing, and skin text as it streams in, before it is painted on the
sign. A publish is checked inside the scaffold's 10 to 20 s while the last approved version stays live. Names and notes
are checked on confirm in under a second, and the chisel carves as the answer arrives.

**Cost.** A 50,000-viewer capital with 2,000 forges, 2,000 publishes and 10,000 names and notes in a night spends under
$2 on judging [E], about 1% of what its Forge runs cost [E]. **No check is ever skipped to save money.**

### 4.5 Failing safe

- **Two thresholds per question:** below the lower, pass; above the upper, refuse; between, hold, with Terra first for
  images. The band is sized so holds stay under about 2% of what is made [E].
- **Golden sets:** at least 500 labelled cases per kind of thing before launch, with §6's hard cases, many languages
  and Twitch slang. Every upheld appeal is added.
- **The Luna alias can change under us.** OpenAI lists only `gpt-6-luna`, with no dated snapshot to pin
  [V](https://developers.openai.com/api/docs/models/gpt-6-luna). The golden sets run nightly against the live model,
  and a shift raises an alarm. A Twitch AI show was suspended in 2023 after a model switch
  [V, press](https://www.nbcnews.com/tech/twitch-temporary-ban-seinfeld-parody-ai-transphobic-remarks-rcna69389).
- **A judge that times out counts as "unsure", never "pass".** Without the moderation endpoint, Luna still gates.
  Without Luna, the forge is cold, publishes wait and names keep their default.
- **One identifier per citizen.** Every OpenAI call carries a hashed, stable `safety_identifier`, so OpenAI blocks a
  person rather than Chatdom [V](https://developers.openai.com/api/docs/guides/safety-checks.md). OpenAI cannot unblock
  one, so a blocked citizen's forge stays quietly cold while everything else works. Whether Decisions and the Codex SDK
  accept it is undocumented [?]; ask OpenAI.
- **Fixes within the hour.** A new spelling or code goes into the filters within an hour, as Epic fixed its AI Darth
  Vader's slur in about 30 minutes [V, press](https://www.wired.com/story/fortnite-darth-vader-slurs-swears-generative-ai/).

### 4.6 Languages and Twitch speech

- Each kingdom declares its languages: the channel's broadcast language plus any the monarch adds.
- The judges report the language and how sure they are. We keep a measured list of each judge's strong languages.
- In a weak or unknown language: free text from people is held for the Watch, who usually speak the channel's
  language; names fall back to choices from the kingdom's name grammar; generated words use a strong language the
  kingdom declared.
- The channel's blocked terms carry the most local knowledge we have, in the mods' own language and slang. They are
  imported at founding and daily; Twitch returns only the "non-private" ones [V](https://dev.twitch.tv/docs/api/reference/).
- Emote names are words here, and "Kappa's Hearth" is fine. An emote is judged with the words around it, because
  Twitch bans "emote combinations that dehumanize" [V](https://safety.twitch.tv/s/article/Community-Guidelines).

## 5. The decision moment

### 5.1 Four outcomes

| Outcome | When | What happens |
|---|---|---|
| **Pass** | Every check is clear | It is made and shown |
| **Soften** | One part is the problem and the rest is fine (a named character, a real person, a gory detail) | The forge says what it will make instead before it starts ("a lightning mouse of the realm's own") |
| **Hold** | A judge is unsure, or a rule needs a person | The maker sees it with a small grey seal, "waiting for the Watch". Nobody else sees it, and the stream never does |
| **Refuse** | A clear floor line, or nothing safe to make | Nothing is made or charged, and the forge says why |

A soften is never silent. Meshy can return "a completely unrelated 3D model"
[V](https://help.meshy.ai/en/articles/14329317-what-causes-my-model-not-to-generate-or-generate-something-unrelated),
which teaches people the magic is broken, not careful.

### 5.2 What the maker sees

The line comes from the kind of limit, never from the words. Each kind has at least three wordings.

| Kind of limit | Outcome | The forge says (one of several) |
|---|---|---|
| Not a house part | Refuse | "The forge only shapes things for homes. A chimney, a door, a lamp?" |
| Unknown shape | Soften or refuse | "The forge doesn't know that shape yet. It has written it down." (The miss feeds the weekly motif loop.) |
| Someone else's creation | Soften | "That shape belongs to another world's makers. Here is one of the realm's own." |
| A real person | Soften or refuse | "The forge doesn't shape real people. It can shape a hero of the realm." |
| Not for this realm | Refuse | "That isn't something the forge makes here. Try other words." |
| Hurtful | Refuse | "The forge won't shape that." Nothing more |
| Cracked while cooling | Refuse | "The metal cracked as it cooled. Try other words." |
| Waiting for a person | Hold | "Made. The Watch will look before others see it." |
| No coal | Wait | "Your scuttle is empty. Your hearth gives you a coal each night you are here." |
| Judges down | Wait | "The forge is cold tonight." |

Club Penguin showed blocked messages to their sender as if sent, so children did not learn to probe
[V](https://en.wikipedia.org/wiki/Club_Penguin). We do not pretend, but we never say which word or question caught
something. A failed publish outlines where the shape was seen, so an honest maker can fix an accident in seconds;
trolls learn the edges either way.

### 5.3 What the stream sees

- **Pass and soften:** the reveal, with the maker's name landing on the seal. The plaque never mentions a soften.
- **Hold and refuse:** nothing. The director never cuts to a ritual before gate 1 has passed.
- **Refusal beats.** Any refusal, a harmful one included, may air as a short comic beat (founder decision). It never
  shows or hints at the words:
  - every beat looks the same whatever the reason: the forge coughs soot, sulks and settles, with a line from one
    shared pool ("The forge is in a mood tonight"), so nobody can tell "a spaceship" from something hurtful
  - no name, prompt, avatar, nameplate or kind of limit appears; the beat plays at the forge, not at the maker
  - the director airs at most one refusal beat every 10 minutes, picked at random from that window's refusals and
    played later, so it cannot be matched to a chat line

  The real risk is a troll refusing on purpose to win a beat. Rarity, delay and namelessness keep the prize small, and
  damp coals end the run after two.
- **A thing veiled later** disappears quietly; if in shot, the director cuts away within a second.
- **The stream pass:** where the streamer has turned it on, a human passes what the director airs (§5.8).

### 5.4 The Watch's review

**Who decides:** the Watch (the channel's Twitch moderators, mirrored live, `Twitch.md` §10); Wardens, trusted
citizens the monarch appoints, who decide holds only, while hiding published things and acting on people stay with
the mods (founder decision); the monarch, who can overrule anyone; and Chatdom staff, on the floor only, when a
kingdom's own people do not act, with every staff action logged publicly.

**A hold card shows** (`Monarch.md` owns its look): the thing as the stream would show it; what the judge feared, in
plain words ("might be a hate symbol, likely"); the views or words that triggered it; the maker's name, tier, follow
age and holds or hides here in the last 30 days.

**Four actions, each one tap plus a reason from a short list:**
- **Let it stand:** it appears for everyone, with a small housewarming for a build.
- **Send it back:** the maker sees the reason and a fix; the coal comes back; no strike.
- **Veil and note:** for something made on purpose; one strike (§5.7).
- **Ask the monarch.**

**Rules:**
- The first decision stands; another mod can reverse it with a reason, and the latest wins.
- Holds the director wants to air come first.
- Targets: under 10 s a card, from a phone with one thumb or keys 1 to 4; holds from a live stream decided before it
  ends.
- The Watch's and the monarch's own things pass the same judges. Only the monarch can overrule a hold on their own
  things, never below the floor.
- **Holds nobody decides stay private** to their maker, and the monarch sees how many are waiting at their next
  go-live (founder decision). Nothing unchecked ever goes public by waiting.

### 5.5 Appeals

- A judge's refusal can be appealed once with one tap, "Ask the Watch to look", which turns it into a hold. That is
  how a "cocktail lamp" read as innuendo gets fixed.
- Scope, IP and real-person refusals are policy and not appealable; the forge offers the nearest thing instead.
- A Watch decision can be appealed once, to another mod or else the monarch, whose answer is final in the kingdom.
  Staff decisions are appealed to staff.
- One appeal pending per person.

### 5.6 Found bad later

A report, a ward composite, the frame check or a re-check after the judges improve can find a published thing bad.

- **Reports** are weighted by tier (0.25, 1, 2). A thing auto-veils at a weighted 3 from at least 2 distinct tier 1+
  reporters, then the Watch decides (`docs/08-depth-social.md` §3.15). Reports act on things, never people, and bursts
  from a group lose weight.
- **A veil** hides the thing from all but its owner, everywhere: every copy and gift in every kingdom, the Atlas
  drawing, impostors, share cards, the Gallery's director stills and our Chronicles, which are re-baked or re-rendered
  without it. Twitch clips and VODs cannot
  be changed, which is why the stream's bar must hold before anything airs.
- **The owner keeps it** in their keepsakes, marked veiled with the reason (`ChatDom.md` principle 5). It cannot be
  placed, gifted or copied. A veiled Prime veils its copies.
- **When our check missed it, we pay:** the coal goes back to the owner and to copies' owners, and no strike. The
  Watch marks each veil "an honest accident" or "on purpose".
- **Re-checks:** when a judge or question set changes, every public thing is re-checked. New findings are held, and
  veiled at once only above the refuse threshold for hate or sexual content.
- **Records:** refused words are kept 30 days for appeals and abuse patterns, then only the kind of limit. Chat text is
  never kept (`Tech.md` §7.5); a `!forge` prompt is the input to a made thing and is kept with it.

### 5.7 Repeat harm, in one kingdom

Strikes are private, belong to one kingdom and fade after 30 days.

| What happened | What follows |
|---|---|
| A refusal for harm | Only the refusal |
| 2 refusals for harm within 24 hours | Their coals are damp until the next stream (§3.2) |
| A veil "on purpose" | One strike, shown on later cards |
| 3 strikes within 30 days | Trust drops one tier for 30 days (`docs/08-depth-building.md` §3.13) |
| More | The Watch acts on Twitch, which is the record (`Tech.md` §13) |

Automatic steps never touch a person's home, standing, light or Twitch account. Good tools for the Watch beat automatic
punishment: in an ADL study of Minecraft servers, the one with the clearest rules and most moderators per player had
the least hate [V](https://www.adl.org/resources/report/breaking-building-blocks-hate-case-study-minecraft-servers).

### 5.8 The monarch's settings

`Monarch.md` owns the controls; this is what they mean.
- **Making mode,** per kind (Forge, publishes, names, games): *instant* (judges decide, holds go to the Watch; the
  default), *approval* (everything waits for the Watch) or *quiet* (making pauses; drafts work).
- **Stream pass:** what the director airs needs a human pass first. The streamer chooses when connecting, before the
  live founding: on by default above 1,000 viewers, off below, changeable any time (founder decision; `Monarch.md`
  §5.1). The director airs only a few reveals an
  hour, so the load stays small.
- **The kingdom's words:** the channel's blocked terms, words the monarch adds, and in-jokes for the phrasebook.
- **Roars:** the monarch may make the forge roar by decree, which lights extra anvils and gives no coals (§3.2).
- **Wardens** (holds only) and **statues.**

Automatic changes, always told to the monarch:
- When Twitch's Shield Mode turns on, making goes quiet and the gate closes to newcomers until it ends (`Twitch.md`
  §10).
- When refusals for harm spike over 10 minutes, making goes to approval for 30 minutes: "the forge banks its fire".

## 6. Hard cases

**1. A swastika built in blocks.**
- Drafts are private. At publish, the hooked-cross detector runs on every flat view and colour layer, in 8
  orientations, mirrored, from 3 × 3 cells up; Luna reads the sheet.
- A clear hit refuses the publish with the region outlined, and the last approved version stays live. An unclear hit
  is held. Across several plots, the ward composite holds them all together.
- SS runes, a noose and "88" in pixels follow the same path; readable characters go through the text checks.
- Twitch bans "Nazi-related imagery" "regardless of your intent" [V](https://safety.twitch.tv/s/article/Community-Guidelines).
  The hooked cross is also sacred in Hinduism, Buddhism and Jainism. It is refused in every kingdom (founder
  decision), with a respectful line: "This shape means very different things to different people, and the kingdom
  can't know which it means here."

**2. A harmless prompt yields a slur in the plaque.**
- Gate 2 judges the name and line as displayed, maker included, written and spoken.
- The Codex run writes a new line once; on a second failure, the plaque falls back to its template ("A chimney, forged
  by cozy_otter, 29 October 2026").
- The maker gets no strike and no message about it. The magic made it, not them.

**3. A home named after a real person.**
- "Pokimane's Palace", "Elon's Bunker", another chatter's name. Twitch holds usernames to "higher standards" and bans
  impersonating "celebrities, companies, or friends" [V](https://safety.twitch.tv/s/article/Community-Guidelines).
- A name may name the maker, a housemate or bond of level 2+ (who is told and can say no), and the monarch if they
  opt in. Anyone else is refused, with three suggestions from the name grammar.
- In Forge prompts, a real person softens to "a hero of the realm".

**4. "Make me Pikachu."**
- The Forge composes only authored motifs, so it cannot make a close likeness; the risk is the name and plaque.
- Gate 1 marks named IP and softens to the nearest motif (a mouse with the lightning emitter) and a name without the
  trademark. Scenario does the same before generating, letting generic archetypes through
  [V](https://help.scenario.com/articles/5463161137-ip-detection-screen-generations-for-intellectual-property-risk);
  Roblox passes every 4D generation prompt through "prohibited brand/IP filters"
  [V](https://devforum.roblox.com/t/beta-4d-generation-unlock-new-types-of-gameplay/4331818).
- What the magic makes carries no one else's IP. A hand-built yellow mouse is the maker's fan art: we act on a rights
  holder's notice rather than judging fan art in advance, as voxel games always have.

**5. A prompted game with sexual or gambling rules.**
- Rules come only from verified families with a fixed settings menu, and no game can take Hearth or charge an entry
  fee (`docs/08-depth-minigame-engine.md` §3.13). So the premise and skin are judged.
- "Strip poker" is refused. "A drinking game" softens into a toast with tavern cider; nothing tells a viewer to drink.
- Dice and cards for points are ordinary tavern games; Twitch needs no label for "brief gambling content in a
  non-gambling focused video game" [V](https://safety.twitch.tv/s/article/Content-Classification-Guidelines). A
  roulette wheel or slot machine as a game's whole premise is refused even for points: it is gambling-focused, and
  wrong to normalise for 13-year-olds.

**6. An emote fine on Twitch but awkward as a 3 m statue.**
- Twitch reviewed a flat image at chat size. A 4 m extrusion is a new object: the silhouette changes, and a small crude
  joke reads differently across a square.
- Genesis proposes statues; the monarch confirms each and can swap any later. The extruded version passes Luna at
  statue scale before its unveiling.

**7. Words in a language the judge is weak in.**
- A slur in Tagalog slang inside a pet's name, in an English-speaking kingdom.
- The filters and the channel's blocked terms catch what they know. Text outside the kingdom's declared languages, or
  in a language weak on our measured list, is held, and the maker can pick a suggested name meanwhile.
- Where the kingdom's own language is the weak one, its mods judge free text more often, and we measure that language
  next.

**8. A troll raid forging junk.**
- Raiders take trust 0 where they arrive and earn no coals there (`Tech.md` §6.7). Coals need a home and a night
  present, so a raid of fresh or bot accounts cannot forge at all.
- Followers who turn have one coal per night and one thing in the fire, and the anvils cap the whole kingdom.
- Refusals are private and nameless, so trolls get no show. A spike banks the forge's fire, Shield Mode quiets making,
  and the shutter makes the stream safe in under a second (`Monarch.md` §7.4).
- Tier 0 bubbles show on stream as a glyph, so a raid cannot write on the stream through the world.
- The floor binds monarchs too: in r/place 2022, streamers steered their own audiences into drawing an explicit image
  [?, secondary source](https://redditwatch.org/issues/rplace-2022-streamer-takeover-admin-censorship). Staff act when
  a monarch steers their kingdom below the floor.

**9. A name clean on paper and filthy aloud.**
- The Voice and the crier speak names, and text-to-speech has always been exploited this way.
- Everything the kingdom will speak is checked in spoken form too. A Twitch name that fails is never spoken; the Voice
  says "a citizen" or their home's name.

**10. A founding, live on stream.**
- Genesis runs live with no private draft (founder decision), so every word and shape it makes is seen as it appears.
- The checks run inside the 1 to 3 minutes of the map unrolling, and the ceremony reveals each thing only after its
  check, as the Forge ritual's stages follow its gates: names, mottos and street names through the text checks;
  statue candidates and the crest through Luna before they are offered; a failing emote is simply not offered.
- The streamer's own name or motto is checked as they type, so the carving never fails on camera. If it is refused,
  only the throne says so, in the forge's voice.
- Settlers' and followers' names over doors pass the name check first; a name that fails shows as "a settler".

**11. A door sign aimed at a neighbour.**
- "Welcome! Unlike the cat lady at number 4." No slur, but a target.
- The judges get the street's resident names as context and are asked whether the sentence mocks or points at a
  person, a neighbour or a group. A clear yes is refused; an unsure one is held.
- If it gets through, the neighbour's own report hides it for them at once and sends it to the Watch. A sign about
  someone counts the target's report as a decision to hide, never as a vote.

## 7. Later

Each needs its own depth before launch; none is designed here.
- **Voice:** the campfire rules stand (`Tech.md` §10.6); failure on stream needs its own pass.
- **Harassment between people:** blocks, mutes, reports and the Watch's tools on people (`docs/08-depth-social.md`
  §3.15).
- **Cross-kingdom bans and strikes:** whether anything follows a person between kingdoms.
- **The stocks:** a timed-out citizen in the stocks is public shaming; keep it off (`Tech.md` §19).
- **Twitch scopes:** the broadcaster's `moderation:read` for AutoMod checks, `moderator:read:blocked_terms`
  [V](https://dev.twitch.tv/docs/api/reference/), and a Shield Mode read scope [K]; none is in `Tech.md` §7.2.
- **Twitch Data and AI providers:** the Developer Services Agreement bars sharing Twitch Data with third parties
  without written permission [V](https://legal.twitch.com/en/legal/developer-agreement/). Get a legal reading or
  Twitch's permission before prompts typed in Twitch chat go to OpenAI.
- **The EU Digital Services Act:** statements of reasons, notice and action, transparency reports, minors' protection.
- **GDPR and UK GDPR:** retention of refusals and strikes, export and erasure.
- **Age:** 13+ by Twitch, 16+ self-declared for voice, no age verification; every default stays safe for 13.
- **The law beyond:** copyright takedowns, reporting duties for the worst content, requests from authorities.
- **OpenAI's usage policies:** a new version takes effect on 20 November 2026; re-read it against this file
  [V](https://openai.com/policies/usage-policies/).
- **The passport:** public on the citizen card with a personal "hide my travels" switch (founder decision); its
  stalking risk needs its own look (`Atlas.md` §6.2).
- **Staffing:** about one floor reviewer per 300 active kingdoms (`docs/09-depth-synthesis.md` §5).

## 8. Decided on 2026-10-29

The founder answered every question this file asked.

| Question | Answer |
|---|---|
| May a refusal air on stream? | Yes, any refusal, as a nameless comic beat that never shows or hints at the words (§5.3) |
| Should a mod pass what the director airs? | The streamer chooses when connecting, before the live founding: on by default above 1,000 viewers, off below (§5.8) |
| What happens to holds nobody reviews? | They stay private; the monarch is nudged at go-live (§5.4) |
| May a monarch allow the hooked cross as a sacred symbol? | No. Refused everywhere, with a respectful line (§6, case 1) |
| May monarchs appoint Wardens? | Yes, for holds only; mods keep hiding things and acting on people (§5.4) |
| Who may publish free-voxel builds? | Returning citizens (a return visit or 30 days of follow); newcomers use starter homes, pieces and Forge parts (§3.1) |
| May a door sign carry a free sentence? | Yes, one, judged by the model checks (§3.1, §6 case 11) |
| May homes fly real-world flags? | A curated set of hand-made identity and national flags; no slogans, parties or movements (§3.1) |
| When does the forge burn? | Only while the stream is live (§3.2) |
| Do subs add vote weight? | No. One person, one vote, and trust never weights a vote (§3.2) |
| Does a paid sub open the forge's own words? | No. Only time and presence do (§3.2) |
| Does a Hype Train add coals? | No. Its roar lights extra anvils only (§3.2) |
| Does the monarch's decree roar add coals? | No. Coals come only from showing up, and nobody can hand one out (§3.2) |
| How is a kingdom founded? | Live on stream, with no private draft (§6, case 10) |
| Who sees a citizen's passport? | Everyone, with a personal "hide my travels" switch (§7) |
| How many homes may a person have? | At most 3, so coals come from at most 3 kingdoms (§3.2) |

**Still open:** nothing in this file's scope. Voice, harassment, bans and the law wait in §7.

## Change log

- **2026-10-29: first version.** Safety for what people make: principles, every kind of made thing, the judges (Luna
  on Decisions, the moderation endpoint, Terra as a second opinion, gates outside the Codex run), the decision moment,
  hard cases and nine questions for the founder. Voice, harassment, bans and the law are listed for later.
- **2026-10-29: Forge access.** Founder input: the Forge needs intuitive limits on how often and when. Coals (one per
  night present, held up to 3 or 5), a forge that burns only while live, anvils that cap a kingdom, trust deciding
  what you may bring, roars and damp coals (§3.2). The sub-and-trust question stays in `Twitch.md`
  question 5.
- **2026-10-29: founder decisions folded in.** Any refusal may air as a nameless comic beat; the stream pass is the
  streamer's choice at founding; stale holds stay private; Wardens decide holds; free voxels for returning citizens;
  the hooked cross refused everywhere; one free sentence on door signs; curated flags; the forge burns only while
  live; one person, one vote; a live founding (case 10); a public passport with a hide switch; at most 3 homes. The
  questions section became a decision list.
- **2026-10-29: consistency pass.** A paid sub never opens the forge's own words; only time and presence do (founder
  decision). A Hype Train's roar lights extra anvils but never adds coals; only the monarch's decree roar does. Trust
  never weights a vote. Coals cannot pass between citizens, though the monarch may grant one. The stream pass is
  chosen when connecting, before the live founding (§3.2, §5.8, §8).
- **2026-10-29: consistency sweep after round 14.** No roar gives coals, the decree roar included, and royal coals
  are gone: coals come only from showing up (§3.2, §5.8, §8). A monarch earns and spends coals in their own kingdom
  (§3.2). Subs never raise trust (§3.2).
- **2026-10-29: flat coal cap.** Everyone holds at most 3 coals, whatever their trust, so a knighting cannot raise
  anyone's Forge allowance (§3.2).
