# AM15: a channel you find is always on the map, the key explains itself, and the map leads into the game (2 Nov)

Tobias searched `tobi4s_` on chatdom.io: it was found, the camera flew, and it landed on bare paper. The only mark
was a thin DOM outline of a flag (26 × 34 px, no name, no ring) laid over the canvas while the card was open. The
bottom-left key was a row of five unlabelled symbol buttons whose meaning only appeared on hover.

## 1. Found means shown

**What happens now.** When search, a road's end, a route or a saved view opens a channel the drawn world does not
hold, the page keeps it in a small registry (`map/found.ts`, `FoundRegistry`) with its register face and its pencil
place, and the moving map draws it in its own overlay (`map/overlay.ts`, `placeFound`):

- **A waiting channel** is a pencil flag 1.7 × the size of a live dab, graphite with the paper's colour under the
  hatching (the vermilion touch only while on air), and its name in graphite italic beside it.
- **A founded kingdom** (tobi4s_'s Willowmere) is drawn as what it is in Chatdom: a hamlet's stamp from the same
  sheet, its arms (`shieldDesign(channelId)`, the same arms as its card and crest), its kingdom's name in ink, a
  bare standard, and the smallest pennant while it is on air. Its card reads "A Chatdom kingdom", lists the kingdom
  by name, and its first action is "Walk into Willowmere" (`/?walk=1&kingdom=<id>`, the site's own walk page).

**Same rules as surveyed marks.** Found marks go down right after the language names and before every holding, the
way a selected holding does (forced): every surveyed name and stamp gives way to them, survey marks under them are
knocked out through the shared lettering list, the placer remembers the side each name took, they fade in like
anything newly placed, and the selection ring with ticks is the holding's own. Picking comes first for found marks
(`MapView.tap` → `events.selectFound`), so a tap on the mark opens its card where the map stands. The card anchors
to the mark exactly as before (`revealPoint` keeps it clear of the card or the phone sheet); while its card is open
a pencil flag's name moves outside the ring.

**Who decides what is drawn.** Only a named `waiting` channel at a finite pencil place from the register is ever
kept (`foundable`). At draw time `foundMarks` drops anything the names projection withholds and anything the world
now holds as a holding. The names projection only lists surveyed holdings, so a found channel withheld or hidden
later is known by its card: every names refresh (and the service's withheld-changed signal) asks the register again
about each found channel, and one it no longer answers for leaves the map and its open card closes. A streamer's own
"Hide my channel" drops it at once. Nothing is written to the survey and no land is granted; the browser only draws.

**Several at once, for the session.** Up to 24 found channels are drawn (the oldest gives way). Their IDs, never
names or places, are kept in session storage per map (`chatdom:atlas:found:v1`), so a reload in the same tab finds
them again, and `handle.view()` carries them as `found` (additive, see SEAMS), so a return from sign-in draws them
again. Every restore asks the register first, at most 12, three at a time. A new survey revision finds them again
on its own land. Found marks are drawn only in explore: the hero stays quiet and gate mode draws its own source.

**Founded kingdoms.** The Atlas reads the site's public door list once per page (`GET /api/public/door`,
front-door's route: `{ mode, kingdoms: [{ kingdomId, name, login }] }`), validated, `live` only, and matches a
kingdom to a found channel by ID and login (`data/kingdoms.ts`). Without a door (the bench, a host without the API)
nothing changes: the channel is drawn as a pencil flag.

**The still.** The Canvas2D still keeps its stand-in: the open waiting card's pencil flag as a DOM mark, now with its
name. The moving map never shows that stand-in any more. Drawing found marks into the still's own layout was left
out: the still covers only the first second on a GPU and the no-WebGL fallback, where there is no flight to land.

## 2. The key explains itself

The five glyph buttons are gone. The key is one worded button on the walnut bar, **"Map key"**, that opens a
parchment legend naming every mark the map draws beside the mark itself, drawn from the map's own stamps and arms
where they exist: Channel, Live now, Live glow, Pencilled in, Chatdom kingdom, Lands and realms, Road, each with one
plain line. Nothing needs a hover. On a phone it is the same button, and the legend opens as a bottom sheet. Escape
closes it and returns focus to the button. The old "Your home" glyph (a key icon people read as a control) is
replaced by a real control for the signed-in broadcaster alone: **"Your channel"**, which flies to their own channel
and opens its card (their own hidden card while hidden). The default view's word count stays within 25 ("Key" became
"Map key").

## 3. The map leads into the game

Many visitors land on the map first. Nobody may leave thinking the map is all there is.

- **The way in.** The title plate carries a third carved row under the search: a brass plate, **"Walk into a
  kingdom"**, with the kingdom's name in italic at its right end (`ui/WayIn.tsx`). It is a plain link to the site's
  walk page for the door's first founded kingdom (`/?walk=1&kingdom=129634568`, Willowmere today), so it works
  without script after the first paint, opens in a new tab on a middle click, and stays put while browsing, with a
  card open, on the phone and in the still. The search's findings hang below the whole plate. With more founded
  kingdoms it still leads to the door's first; the order is front-door's. Without a door that names a live kingdom
  it is not drawn at all, never as a dead link. The door names a kingdom only while its realm answers
  (`apps/api/src/public/main.ts`, `doorData`); during this work chatdom.io's door was empty for some minutes while the
  realm did not answer, so an empty door is asked again (30 s, 1, 2, 4 min, then every 5 min for about an hour) and
  the way in appears as soon as the kingdom can be walked into.
- **The opening caption.** A browser that has never opened the map reads one line on a parchment slip under the
  title plate: "Every Twitch channel is a kingdom on this map. Step into one." It is marked read the moment it is
  shown (`chatdom:atlas:opening:v1` in local storage, `ui/opening.ts`), so a return visit opens quietly. It gives
  way to its ×, to the first card the visitor opens after it, to the key, and to leaving explore. A card already open
  beside it (a shared link) leaves it standing. A return from sign-in (a saved view) is not a first visit.
- **"Enter <name>" first.** Every founded kingdom's card, a surveyed holding's or a pencilled one's, puts its way in
  directly under its name and above every fact: the biggest thing on the card, a walnut door with a gate, **"Enter
  Willowmere"**, and under it "Sign in with Twitch at its gate". Its "Enter the land" preview door gives way to it.
- **No dead ends.** A waiting channel's card leads on: **"Visit Willowmere"** is its first door. Its land preview, if
  the register has one, follows as a quiet "Enter the land". For the channel's own verified broadcaster the card
  says, calmly, "Not founded yet" above the visit. "Found your kingdom" takes its place when founding has a door of
  its own on the site; until then there is nothing to press.
- **Sign-in after entering.** Nothing on the map asks anyone to sign in. The walk page asks at the kingdom's gate.
- **Clicks.** From a cold load of `/map`: one click on the way in reaches Willowmere's gate, then Twitch sign-in.
  From a card: search (typing), one click on the result, one click on "Enter Willowmere".
- **Words.** The default view stays at 25 words for the map's own chrome; the way in adds at most five
  (`ui/edition.test.ts`), the one addition the founder asked for. The caption is read once.

## Decisions

- **The founded kingdom is lettered with its kingdom's name, not the channel's.** Founding is what gives a kingdom
  its name; the card under it still leads with the streamer's face and login. A kingdom with no land yet stands at
  its deterministic pencil place as a hamlet; land is granted only by the edition's claims (AM12).
- **Found marks are forced, like a selection.** The brief says the map should pretend it was always there; a found
  mark that could lose its place to a neighbour's name would land the flight on bare paper again.
- **Session storage holds IDs only** and every restore re-asks the register, so the operator's list and self-hide
  always win over anything a browser kept.
- **The key is closed by default** behind one two-word button, so the default view stays quiet; open, it names
  everything in words.
- **The way in is carved into the title plate, not floated over the map.** The plate is the one piece of chrome that
  stays in the same place at every size and with every card, so the way in never moves or hides; a brass plate on
  walnut reads as the map's own fitting rather than an advert. It walks straight in (one click) instead of flying to
  Willowmere first: the flight is one search away, and the brief counts clicks.
- **The caption is marked read when shown, not when dismissed,** so a visitor who ignores it is not told again on
  every visit.
- **The word budget is 25 plus the way in.** The AM10 bar stays for the map's own chrome; the way in is counted on
  its own and held to five words.

## Verification

- Unit: `map/found.test.ts` (drawn at its place as a flag or as its founded kingdom, kingdom only under the same login
  and never from a simulated door, same place every time, several at once, withheld/hidden never drawn and back when
  shown, gives way to its holding, only waiting channels at finite places, limit, session round trip, forged values),
  `data/kingdoms.test.ts`, `saved-view.test.ts` (found IDs), `ui/legend.test.ts`, `ui/edition.test.ts` (25 words with
  "Map key"), `map/overlay.test.ts`. Repo `tsc` clean, scoped eslint clean.
- Browser (`checks/found-shots.mjs`, SwiftShader, the lane's preview proxying chatdom.io's public map data and door):
  key closed and open; search tobi4s_ → flight → its mark drawn as Willowmere at its place, ringed, clear of the card,
  no DOM stand-in over the moving map; the mark stays when the card closes; a tap opens the card again; a second
  channel outside the survey (zliifer) drawn as a pencil flag; both kept at once; a reload in the same tab finds both
  again and draws them on the whole map. Report: `work/evidence/atlas-map/am15-local.json`.
- Stills: `work/evidence/atlas-map/am15-local-{key-closed,key-open,found-card,found-closed,found-second,found-world}-1440.png`
  and `am15-local-{key-closed,key-open,found-card,found-second}-390.png`.
- Part 3: `ui/opening.test.ts` (first visit only, quiet without storage), `ui/edition.test.ts` (25 + 5 words). Browser
  (`checks/way-in-shots.mjs`): caption on a first visit and not on a return; the way in on the plate, uncovered, with
  the door's first kingdom and its walk link, and still uncovered with a card open; tobi4s_'s card is a Chatdom
  kingdom whose first and biggest action is "Enter Willowmere"; zliifer's card leads with "Visit Willowmere"; one
  click from a cold `/map` lands on Willowmere's gate. Report `am15-local-way-in.json`, stills
  `am15-local-{opening,enter-card,visit-card}-{1440,390}.png`.

## On chatdom.io

This is browser code only: no service, route, gateway or env change. chatdom.io shows it once this lane's checkpoint
is merged and the site is rebuilt from the integration branch. Then run, from the repo root:
`ATLAS_CHECK_URL=https://chatdom.io ATLAS_CHECK_NAME=chatdomio node apps/web/src/atlas/checks/found-shots.mjs`
(one size at a time with `ATLAS_CHECK_WIDTHS=1440` and `=390`), which writes the chatdom.io stills and report, and
the same for `checks/way-in-shots.mjs` (the caption needs a browser that has never opened the map; each run starts
one). Real GPU: one look at `/map` 1440 and 390 with the caption, the way in and tobi4s_'s card, when the GPU is free.
