# front-door seams

Frozen on Sun 1 Nov 2026 for this round. Change a seam only by writing the change here and in the other lane's
SEAMS.md. Each side builds so that it works with or without the other side's part; nobody edits the other lane's
files to make a seam work.

## 1. The Atlas embed (atlas-map gives, front-door mounts)

**What front-door calls.** The story page's last section mounts the live Atlas:

```ts
const { mountAtlas } = await import('<atlas-map's export under apps/web/src/atlas/>');
const handle = mountAtlas(element, { mode: 'hero' });
```

`mode` is `'hero' | 'explore' | 'gate'` (raid-show uses `'gate'`). The exact file and handle shape are atlas-map's to
choose; write them here when they exist. front-door needs:

- **Lazy and light.** Importable on its own from the front page's small build, without pulling in the kingdom engine,
  the realm client or the identity chunks. front-door imports it only when the section nears the viewport.
- **Contained.** It draws inside the element it is given, sized by the host (full-bleed on desktop, a designed
  height on a phone). No global body styles, no scroll capture that traps the page on a phone, and in hero mode it
  never rewrites the URL or takes over the route.
- **A handle.** `destroy()` to unmount cleanly, and a ready-or-failed signal (a promise or callbacks). On failure, or
  without WebGL, front-door shows its own real capture of the Atlas with "Explore the map" linking to `/map`.
- **Hero mode.** The live map with its glow and search, quiet chrome, and "Explore the map" taking you to `/map` at
  the same view. Reduced motion is honoured.
- **The view, for sign-in.** A way to read and set the current view (position, zoom, open card), so the sign-in
  round trip returns to the same view (A09). front-door's kit stores and restores it with the return-view helper
  (section 3).
- **Same origin only.** Data from `/map-data/...` on our origin (the CSP allows nothing else, except Twitch's image
  CDN `static-cdn.jtvnw.net` for pictures).

**How front-door finds it.** Through `import.meta.glob`, so the front page builds and works before the export
exists. Until then the section shows a real capture of `/map` and the link.

**Kit pieces for the Atlas** (section 3): atlas-map mounts the sign-in seal, the Twitch mark on each card's
"Watch on Twitch" button, the footer with the legal links and the line "Live from Twitch. Chatdom is not affiliated
with or endorsed by Twitch.", and links to `/how-it-works` (or mounts the How it works sheet). These are atlas-map's
edits in its own files; front-door supplies the pieces and the recipe.

## 2. The hero (grand-world gives, front-door shoots and later mounts)

The grand land is every kingdom's land and the end version (decision 47), so the front page's hero is the grand
land: tobi4s_'s, at dusk.

**Now (FD10): captures.** front-door shoots its own stills on Tobias's GPU through `pc-lease` from the existing
orbit view on main:

```
/-/grand?channel=tobi4s_&capture=1&still=1&hour=<dusk>&view=<view>&yaw=<..>&pitch=<..>&dist=<..>&t=<time>
```

(`apps/web/src/grand/index.tsx` reads `channel`, `still`, `stats`, `view`, `hour`, `tier`, `t`, `capture`, `yaw`,
`pitch`, `dist`, and sets `window.__chatdomReady`.) front-door asks grand-world to keep these parameters, or their
replacements written here, working on the final land, deterministic for a given `t`, so a sequence of stills taken
across several leases lines up into one motion.

**Later (FD13): a live hero.** front-door asks grand-world for a small, lazily importable mount, for example
`mountLandHero(element, { channel: 'tobi4s_', hour, orbit: true, tier: 'auto' })`, returning `destroy()` and a
ready-or-failed signal, drawing only into the given element, choosing its own quality tier, stepping down without
WebGL, and honouring reduced motion. Windows lighting as names appear is the ambition; it uses whatever presence the
land already shows. Until the mount exists, the hero stays on captures and front-door re-shoots them after Monday's
merge.

front-door never edits `apps/web/src/grand/**`, `packages/world/src/grand/**`, `packages/voxel/**`,
`packages/render/**` or the kingdom scene.

**FD13 (2 Nov): the live hero, landed on front-door's side.** The story page draws the land itself, after first paint
and only on devices that can (`apps/web/src/site/hero/`): a desktop or laptop with WebGL2 on a real GPU, motion
allowed, not saving data, four or more cores and 4 GB where the browser says; phones keep their composed capture. It
finds a land in this order, both with `import.meta.glob`, so the page builds and works with either or neither:

1. grand-world's `mountLandHero(canvas, options)` from `apps/web/src/grand/hero.ts` (or `hero/index.ts`), when it
   exists: `options = { channel, hour, time, yaw, tier: 'high' | 'medium' | 'low' | 'software', onFailure(message) }`,
   resolving to `{ settled(): Promise<void>, setYaw(yaw), resize(), dispose() }` (types in
   `apps/web/src/site/hero/land.ts`). It draws only into the canvas it is given and never takes input.
2. Until then, the grand land's own engine, read-only: `GrandEngine` from `apps/web/src/grand/engine.ts` (constructor
   `(canvas, seed, { tier, capture, hour, view, time })`, `controls.enabled`, `onReady`, `onFailure`, `start()`,
   `orbit(yaw, pitch, distance)`, `resize()`, `dispose()`) and `grandChannel('tobi4s_')` from
   `apps/web/src/grand/channels.ts`. front-door asks grand-world to keep those names and their meaning, or to ship (1)
   first; a rename only sends the hero back to its pictures, never breaks the build.

The hero holds the land's clock (`time` set) so it draws only while its camera moves, and rests out of view. Its
camera is the orbit view at yaw 120 / 90 / 150 (`hero/frame.ts`), the same three cameras the pictures are shot from
(`scripts/public/hero-gpu.mjs` re-shoots them from `/-/grand?channel=tobi4s_&view=orbit&hour=&t=&yaw=&tier=high`, or
from `--poster-path` if that view moves), so the live land fades in over its own picture without a pop.

What front-door still asks of grand-world for the live hero (one `mountLandHero`, above): a pause and resume, so the
clock can run while the hero is on screen (moving water and clouds) and nothing is drawn when it is not; the town and
its lit windows once the grand land carries the kingdom, with windows lighting as names appear (the hero uses whatever
presence the land shows, and never stages any); and the same first frame for a given camera, hour and time, so the
pictures still match.

**FD13 (2 Nov, later): what grand-world's branch now has, and the ask made concrete.** On `lane/grand-world` (not yet
on main), `/-/grand` is the live kingdom view (`grand/live.tsx` over `createGrandLiveController` in
`grand/live-controller.ts`: the native kingdom host with an overview lens, the verified spectator watch, its presence
feed lighting windows), and the land-only engine view moves to `/-/grand-bench` with the same query. front-door follows
the move: `scripts/public/hero-gpu.mjs` reads the built router and shoots its pictures from `/-/grand-bench` when it
exists (else `/-/grand`); `GrandEngine` and `grandChannel` are unchanged there, so the hero keeps drawing the land.

That live view is exactly the hero we want (the town of tobi4s_ with windows lit by real chat), but its controller
reads `location.search`, sets `window.__chatdomReady` and `window.__chatdomGrand`, and owns the whole page, so the
front page cannot mount it as it is. The ask, replacing the `mountLandHero` sketch above with the same handle:

```ts
// apps/web/src/grand/hero.ts (lazily imported by apps/web/src/site/hero/land.ts)
export function mountLandHero(canvas: HTMLCanvasElement, options: {
  channel: string;            // 'tobi4s_' → its adopted kingdom; unknown names reject
  hour: number;               // 18.2 today; the hero holds it
  time: number;               // held clock in seconds; same first frame for the same camera, hour and time
  yaw: number;                // the overview lens's orbit yaw in degrees; pitch and distance are the lens's own
  tier: 'high' | 'medium' | 'low' | 'software';
  onFailure(message: string): void;
}): Promise<{ settled(): Promise<void>; setYaw(yaw: number): void; resize(): void; dispose(): void }>;
```

built on the live controller with an explicit kingdom and hour instead of the URL, no window globals, no input, the
watch read-only, drawing into the given canvas (or a host element the hero gives it), and with a `pause()`/`resume()`
so the clock can run while the hero is on screen. When it lands, front-door re-shoots the three pictures from
`/-/grand?channel=tobi4s_&still=1&hour=18.2&yaw=<120|90|150>` (the live view, the town in it) so the live kingdom
fades in over pictures of itself.

## 3. The carved kit `packages/ui` (front-door owns, everyone reads)

**Rules.** Every existing export of `@chatdom/ui` (`.`, `./kit.css`, `./passport`, `./growth-card`) keeps its name and
API. New pieces are additive. Other lanes never edit `packages/ui`; they ask with a `needs:` line in their own progress
and a note here, and front-door answers in its next session.

**Who reads it today:** `apps/web/src/kingdom` (ProvenanceSeal), `apps/web/src/growth`, `apps/web/src/avatar-builder`,
`apps/web/src/forge`, `apps/web/src/build-tools`, `apps/web/src/citizen-card`, `apps/web/src/passport` (raid-show),
`apps/panel/src` with `card/` and `passport/` (panel-window), `apps/dock/src` (raid-show), and the front door.

**What front-door adds this round** (names may be refined; the final names are written here when they land):

| Piece | For | Notes |
|---|---|---|
| `@chatdom/ui/fonts.css`, `--cd-face-name` | everyone who shows a Twitch name | Self-hosted faces for every script, split by `unicode-range`. Latin pages download no CJK. |
| a canvas font helper | the Atlas map, the world's nameplates | Loads the faces a string needs before it is drawn on a canvas. |
| sign-in seal | front page, legal pages, the Atlas, the walk-in gate | Official Twitch Glitch, unaltered, in a brass frame; signed-in and signed-out states; sign-out with CSRF; designed sign-in outcomes. |
| return-view helper | anyone who sends people to sign in | Stores a view in `sessionStorage` under one key just before leaving, and returns it once on the way back (the sign-in service accepts only plain paths). |
| Twitch mark | "Watch on Twitch" buttons on Atlas cards | The official mark in its brass frame, unaltered. |
| site footer | every public page | "Imprint · Impressum", "Privacy", "Terms", "How it works", and "Live from Twitch. Chatdom is not affiliated with or endorsed by Twitch." |
| How it works sheet | the Atlas's carved tab | The same four pictures as `/how-it-works`. |

**Landed in FD10** (on chatdom.io's own pages; FD11 moves them into `packages/ui` without changing these
contracts):

- **The return-view key.** `sessionStorage['chatdom:return-view:v1']` holds
  `{ path, at, section?, scrollY?, view? }`: `path` is a plain path on our origin, `at` the time it was written (ms),
  `section` the id of the section in view, `scrollY` a scroll position, and `view` an object a view handle gives
  (the Atlas's position, zoom and open card), stored as given and handed back untouched. It is written just before
  the browser leaves for `/api/realm/auth/start` and read once on the way back; a view older than 15 minutes is
  ignored. The sign-in service returns only to the paths its rule accepts (`/`, `/map`, `/map/<login>`, one-word
  paths); a page it refuses (`/how-it-works`) comes back to `/`, and the front page carries the visitor on to the
  stored path. Code: `packages/ui/src/site/return-view.ts` (exported from `@chatdom/ui/site`).
- **The sign-in seal and the Twitch mark** are for chatdom.io pages only. **No Glitch inside the Twitch panel
  extension** (Extensions Guidelines 4.3: no Twitch name, branding, logo or Glitch in extension content).
  panel-window: the panel's footer links to `/privacy`, `/terms` and `/imprint` without the mark or the Twitch line.
  Details in `twitch-brand.md`.
- **The session name.** The seal shows the Twitch name once the session reply carries one (an optional `name`, asked
  of main); until then it says "Signed in with Twitch".

**Landed in FD11** (the final names; every earlier export keeps its name and API):

| Piece | Import | Notes |
|---|---|---|
| Fonts for every script | `import '@chatdom/ui/fonts.css'` | Self-hosted, OFL, split by `unicode-range`: Latin (IM Fell English, Alegreya with its Latin-ext, Cyrillic, Greek and Vietnamese cuts) plus `Chatdom Arabic`, `Hebrew`, `Devanagari`, `Thai`, `JP`, `KR`, `TC`, `SC` (Noto). A Latin page fetches only Latin files. `--cd-face-name` is the name stack; `:lang(ja\|ko\|zh-Hant\|zh-Hans)` reorders the CJK faces. `kit.css`'s three faces now fall back to the same world faces when `fonts.css` is loaded. The sheet is ~400 KB (114 KB gzipped) and fetches no face until a character needs it; where first paint matters and the page's own words are Latin, load it after paint (`void import('@chatdom/ui/fonts.css')`, as the site does). |
| Name helpers | `@chatdom/ui/names` (also from `@chatdom/ui`) | `applyName(el, text, hint?)` (text, `dir="auto"`, `lang`, `.cd-name`), `nameAttributes`, `nameLang(text, hint?)` (hint: the channel's broadcast language), `nameDirection`, and for canvases `nameFont(px, { text, lang })` plus `await loadNameFaces(texts)` before drawing. CSS: `.cd-name` (wraps anywhere, isolated), `.cd-name-line` (one line, ellipsis, marks never clipped). |
| Sign-in seal | `mountSignInSeal(el, opts)` / `startSignInSeals()` from `@chatdom/ui/site`; Solid `<SignInSeal />` from `@chatdom/ui` | Options: `size` (`header` compact, `large`), `returnPath`, `view: () => ReturnView` (read just before leaving), `signInHref`, `way(kingdom)`. One shared session reading per page; signing out anywhere turns every seal back. |
| Twitch mark | `createTwitchMark(label?)`, `twitchMark()`; Solid `<TwitchMark />` | The official Glitch on its clear-space plate in the brass bezel. |
| Watch on Twitch | `createWatchOnTwitch(login)`, `watchOnTwitch()`; Solid `<WatchOnTwitch login="…" />` | Opens `https://www.twitch.tv/<login>` in a new tab; refuses anything that is not a login. Sizes `small` (cards) and `large`. |
| Site footer | `createSiteFooter(opts)`, `siteFooter()`; Solid `<SiteFooter />` | Imprint · Impressum, Privacy, Terms, How it works, The Atlas, the Twitch line, the operator, and a quiet "Signed in with Twitch as … · Sign out" line on chatdom.io. Options: `current`, `base` (absolute links), `external`, `twitch: false`, `compact`. |
| How it works sheet | `createHowItWorks(opts)`, `howItWorksSheet()`; Solid `<HowItWorksSheet />` | The same four pictures and words as `/how-it-works`, what we never collect, the privacy link. Stacks in a container under 640 px wide when the host sets `container-type: inline-size`. |
| Return-view helper | `rememberReturnView`, `takeReturnView`, `RETURN_VIEW_KEY` from `@chatdom/ui/site` | Unchanged contract (above); moved from the site into the kit. |
| Type scale, icons | `--cd-size-label`, `-note`, `-small`, `-body`, `-lead`, `-title`, `-heading`, `-display` in `kit.css`; `iconSvg(name)` / Solid `<Icon name />` | Icons: door, atlas, card, panel, home, search, watch, chat, live, crown, sign-out, external, arrow-right, arrow-down, close; 20 px grid, 1.8 px round stroke, `currentColor`. |

Styles: `import '@chatdom/ui/kit.css'; import '@chatdom/ui/fonts.css'; import '@chatdom/ui/site.css';`.

**Recipe for atlas-map** (in its own files):
- Seal: in the Atlas chrome, `<SignInSeal size="header" returnPath={location.pathname} view={() => ({ path: location.pathname, view: atlasView() })} way={() => null} />`, where `atlasView()` is the view handle's state (position, zoom, open card). On the way back, `takeReturnView()` once at start and hand `.view` to the handle. `announceSignInOutcome()` shows the `?signin=` notice and takes only that word out of the address.
- Cards: `<WatchOnTwitch login={channel.login} size="small" />` for "Watch on Twitch"; never the Glitch anywhere else.
- Footer: `<SiteFooter current="map" />` where the Atlas has a foot (or under its ledger), so the legal links and the Twitch line are one tap away.
- How it works: link to `/how-it-works`, or mount `<HowItWorksSheet title="A map of all of Twitch" heading={3} />` in a carved tab with `container-type: inline-size` on its host.
- Names on the map: `await loadNameFaces(visibleNames)` before a label pass, then `ctx.font = nameFont(px, { text, lang: nameLang(text, channel.language) })`, `ctx.direction = nameDirection(text)`.

**Recipe for panel-window** (in its own files):
- Fonts: `import '@chatdom/ui/fonts.css'` (it bundles every face as a file, so the panel's zip carries them; a panel that shows only Latin names fetches only Latin ones). Mind the zip: the faces are ~13 MB in ~440 files, almost all CJK slices, so check the bundle against Twitch's upload limit before Hosted Test. Use `var(--cd-face-name)` or `applyName()` for every Twitch name.
- Footer links: `<SiteFooter base="https://chatdom.io" external twitch={false} compact />`: the legal links only, absolute, opening in a new tab, with no Twitch mark or Twitch line (Extensions Guidelines 4.3).

**Heads-up: the kit stopped printing SIMULATED** (decision 25), in FD11. `ProvenanceSeal`, `provenanceLines` and
`PROVENANCE_WORDS` keep their names and types. A staged state (`'simulated'`) presses no line and the seal element
stays in place `hidden` (same role, `data-provenance` and `data-practice`); with the owner's own `detail` it presses
those words instead. Practice content under a real feed adds no line (a `detail` becomes the feed line's note).
`provenanceFromSource('SIMULATED')` still reads the renderer's staged source word. The passport and citizen share
pictures and alt text, and the growth card, no longer carry the chip or sentence. Readers that will now differ, each
for its owner to update in its own lane:

- `packages/testing/kingdom-live.mjs:69`, `kingdom-wave.mjs:31`, `kingdom-checks.mjs:67`, `kingdom-integration.mjs:44,55`, `shots.mjs:73`, `kingdom-walk.mjs:124,132` (shared captures): expect SIMULATED in `.source-ribbon`; the staged seal is now hidden and empty.
- `apps/web/src/kingdom/lights/capture.mjs:109`, `apps/web/src/walk/capture-town.mjs:153`, `apps/web/src/build-tools/capture.mjs:354-356` (kingdom, walk, build tools): read or append to the ribbon; the build-tools clearance check now passes trivially.
- `apps/herald/scripts/shots.mjs:224,286` (herald): expects SIMULATED in the ribbon.
- `apps/panel/scripts/capture-fixture.mjs:71` (panel-window): expects SIMULATED.
- `apps/web/src/growth/capture.mjs:101` (growth): the seal now reads the owner's words only.
- `apps/web/src/avatar-builder` `.ab-seal` (avatar): hidden in panel mode; the owner's words show on the page.
- `apps/api/src/passport/share.test.ts:242`, `apps/web/src/citizen-card/share.test.ts:43,77` (raid-show, citizen card): expect `<b>SIMULATED</b>` or SIMULATED in the alt text.
- `apps/web/src/passport/card-capture.mjs:99`, `apps/web/src/citizen-card/capture.mjs:98`: share pictures lose the corner chip.
- `apps/web/src/growth-card/render-check.mjs:12,36`, `capture.mjs:37,64` (growth card): expect the SIMULATED chip.
- Not the kit's: `apps/panel/src/passport/PanelPassport.tsx:71`, `apps/web/src/passport/CardPassport.tsx:111` and `apps/web/src/stream/index.tsx` print their own labels; their owners remove them under decision 25.

**Landed in FD12** (additive; every earlier export keeps its name and API):

- **The walk-in gate's return.** The gate's address (`/?walk=1&kingdom=<id>`) has a query, which the sign-in service
  refuses as `returnTo` (HTTP 400), so the gate's seal returns to `/` and keeps `walkReturnView(id)` =
  `{ path: '/', view: { walk: '<id>' } }` under the same return-view key. The front page reads it once and carries the
  visitor on with `location.replace(walkHref(id, outcome))`, so a `?signin=` outcome is said at the gate, not on the
  story. `returnDestination(view, here, outcome)` (from `@chatdom/ui/site`) gives that rule to anyone who needs it.
  Anyone else linking to a kingdom's gate (the Atlas's "Walk in", the panel) can link to `walkHref(id)`; the gate
  signs the visitor in and comes back by itself.
- **Several ways on the seal.** `SealOptions.ways(kingdom)` returns ways in order (the first in brass, the rest quiet;
  the header seal shows only the first). `atlasFirstWays` offers "Open the Atlas", then "Walk into <kingdom>"; the
  front page uses it for returning visitors. Opening the map on their own homes waits for A10 (atlas-map, launch
  phase): the way goes to `/map` until the Atlas knows whose homes are where.
- **`SESSION_EVENT`** (`'chatdom:session'`), fired on `window` with the new `Session` when the page's shared reading
  changes (a sign-out from any seal or footer, `refreshSeals()`). The walk-in gate listens for it.

**Asked of atlas-map for FD12** (the Atlas half of "come back to the same view"): the embed's handle on
`lane/atlas-map` (`apps/web/src/atlas/embed.ts`) can read a view (`view(): AtlasView`) but not set one (`flyTo` takes
a channel only). front-door needs one of: `handle.restore(view: AtlasView)`, or `mountAtlas(el, { mode, view })`, that
puts the map at exactly that position, zoom and open card (a view whose `mapId` is from an older survey may fall back
to the composed start). Then, in the Atlas's own files, the recipe above: the seal with
`view={() => ({ path: location.pathname, view: handle.view() })}`, and `takeReturnView()` once at start, handing
`.view` to `restore`. `/map` and `/map/<login>` are paths sign-in returns to directly. front-door's story page already
handles the embed's real handle (`dispose`, `ready` settling on `'map' | 'still' | 'failed'`; it keeps its own Atlas
capture for `'still'` and `'failed'`).

**Heads-up: the walk-in gate's markup changed** (FD12). It no longer wears the kingdom's `.kingdom-gate` class (its
styles are the kingdom's own and would break the gate). The gate's root is `.ke-gate[data-gate="opening|waiting|
lost|refused|closed"]`; the failure's own words are in `.ke-said`; the retry is `.ke-ways button`. Readers that used
`.kingdom-gate button` as the gate's failure signal now wait for their timeout instead of failing fast; each owner
can add `[data-gate="closed"], [data-gate="refused"]` to that check in its own file:
`apps/web/src/walk/capture.mjs:38,40` (walk). `packages/testing/kingdom-walk.mjs` opens the same gate through
`/?walk=1&source=simulated`, which still opens on loopback (the staged rehearsal now refuses any other host).
`kingdom-integration.mjs`, `kingdom-wave.mjs` and `kingdom-live.mjs` read the kingdom's own `.kingdom-gate`, which is
unchanged. The staged rehearsal (`kingdom-entry/simulated.ts`) and `live.ts` no longer require the word SIMULATED
in a notice; a realm notice, when sent, still shows over the kingdom.

## 4. The public origin (front-door owns the gate)

- The page list in `apps/api/src/public/routes.ts` decides what chatdom.io serves. A lane that needs a new public page
  writes `needs: public page <path>` and front-door adds it.
- Public page URLs that ask for staged data (`source=simulated`, `fixture=`) get the 404 page. The fixture-only
  `/-/citizen-card` leaves the public list. `/showcase` redirects to `/`.
- The legal pages have stable URLs for panel-window's panel footer and for Tobias's extension listing on
  dev.twitch.tv: `https://chatdom.io/privacy`, `https://chatdom.io/terms`, `https://chatdom.io/imprint`.
- One setting, `PUBLIC_INDEXING=closed|open` (default `closed`), controls `X-Robots-Tag`, `robots.txt` and the
  sitemap. Traefik's own noindex middleware is removed by Tobias once this is deployed.
- The live gateway is restarted only by Tobias or main.

## Atlas footer slot clarification — 2 Nov, AM10 carved UI

The existing `slots.footer` reference now has an additive, framework-free type in
`apps/web/src/atlas/embed.ts`:

```ts
export type AtlasFooterSlot = (element: HTMLElement) => void | (() => void);
// AtlasMountOptions gains:
slots?: { footer?: AtlasFooterSlot };
```

Atlas calls it once when explore chrome mounts. The returned cleanup runs before
switching to hero or disposing, and the host content is removed. Switching back
to explore mounts a fresh slot. Hero never mounts a footer. The callback owns its
content, listeners and How it works presentation; it must return their cleanup.
Without a supplied footer, Atlas shows only its dated survey seal and its one-line
explanation. No legal, auth or content API is changed. Existing embed callers keep
working unchanged.

Atlas currently reads the material/type tokens from `@chatdom/ui/kit.css`. Its
local cartouche, five-symbol key, survey seal and icon control fittings can move
into the shared kit once front-door reviews them. The newer Twitch mark, Watch,
site footer and How it works exports exist on front-door's branch but are not yet
in the Atlas checkout's shared package; the Atlas keeps words-only Watch links
until main adopts those exports. No official mark is copied or redrawn here.

## Strict-CSP host prerequisite — 2 Nov, AM10 final local checks

The web entry imports `@chatdom/shared` schemas before the lazy Atlas. Zod's
object-JIT capability probe calls `Function` and emits a caught `script-src`
violation under the public CSP. The traced probe occurs before the Atlas chunk
loads; the map can still render, but the zero-violation acceptance gate fails.

needs: main/front-door must evaluate a bootstrap module containing
`import { config } from 'zod'; config({ jitless: true });` before any shared-schema
module evaluates. Import that side-effect module first in `apps/web/src/main.tsx`,
or configure Zod before dynamically importing the app entry. Calling config in
the body below static schema imports is too late. Keep the public CSP unchanged.
Atlas does not modify the page bootstrap or shared package from this lane.

The default `checks/phone-performance-checks.mjs` retains the real zero-CSP-
violation gate. Its explicit `ATLAS_TEST_CSP_JITLESS=1` mode supplies this missing
host prerequisite in the test only and names its evidence `with-bootstrap`;
that evidence proves the consumer under the required host configuration, never
production bootstrap completion. Provenance is in
`work/evidence/atlas-map/am10-phone-final-provenance.json`.

## Atlas return view landed — 2 Nov, atlas-map AM10 (answers "Asked of atlas-map for FD12")

Both forms, additive in `apps/web/src/atlas/embed.ts` on `lane/atlas-map`: `mountAtlas(el, { mode, view })` starts
exactly at a saved `AtlasView` (position, zoom, open card; wins over `focus`), and `handle.restore(view, { signal? })`
puts a mounted map there without a flight and resolves `true` once it stands there. A view whose `mapId` is another
survey revision, or a malformed one, resolves `false` (the mount option falls back to the usual start). A view with
`selected: null` closes an open card; a hero takes only the position. `view().selected` is now also set for a pencil
flag's card (its channel ID). Prefer the mount option on the front page (no first frame at the composed start). The
`/map` side of the recipe (the seal's `view` and `takeReturnView()` at start) is atlas-map's and lands once
`@chatdom/ui/site` reaches lane/atlas-map through main. Details in atlas-map's `SEAMS.md`.

Newest request wins (2 Nov, AM10 follow-up): each `restore` or `flyTo` cancels the one before it. A superseded call
resolves `false` and never opens its card or finishes its flight later, and a card the person opens or closes while a
call is still fetching stays as they left it. The front page needs no guard of its own.

## from launch

- 2 Nov (LA10, extension zip): the kit's staged ("practice") branches are now guarded by `STAGED_ALLOWED` from
  `packages/ui/src/staged.ts`. The panel build defines `__CHATDOM_STAGED__` as `false` (`apps/panel/vite.config.ts`),
  so the staged source word, its seal glyph, `data-practice` and the passport's staged cover and page seals fold
  away and the Twitch zip carries no staging code. Every other build leaves the constant undefined and behaves as
  before. New staged-only branches in anything the panel imports (`ProvenanceSeal`, `provenance.ts`,
  `passport/Book.tsx`, `passport/Reading.tsx`) should sit behind `STAGED_ALLOWED`, or
  `node scripts/public/extension.mjs` will refuse the zip again.
- 2 Nov (LA10, gateway): `/` with a query is the app only for the walk (`?walk=1`); every other query (`?forge=1`,
  `?hour=…`, `?forgeChat=expired`, `?signin=ok&kingdom=…`) gets the front page. Before, they rendered the staged
  Willowmere town, whose staged seal prints nothing, so a visitor saw staged data unlabelled.
  (`apps/api/src/public/routes.ts`, tests updated.)
- 2 Nov (LA10, gateway): `/-/avatar-builder` is no longer a public page (staged personas, saves that go nowhere,
  unlinked since FD10). `/-/grand` stays (it draws the real grand land).
- needs (front-door): a signed-out stranger has no way from the front page into a kingdom; only the signed-in seal
  offers "Walk into Willowmere". The front door's open kingdom (`/api/public/door`) deserves a visible way in for
  everyone (the hero caption already names "The land of tobi4s_ at dusk").
- 2 Nov (LA10, chatdom.io down): `apps/api`'s own `build` script now builds both bundles (`dist/api.mjs`, then
  `dist/public.mjs` from `src/public/vite.config.mjs`), and `scripts/public/build.mjs` calls that script. Before, any
  `pnpm build` after the public build emptied `apps/api/dist/` (vite's default `emptyOutDir`) and deleted
  `public.mjs`, and `scripts/public/start.mjs` then refused to start: that is why chatdom.io answered 502 after the
  17:55 redeploy (the deploy checkout held `api.mjs` only).
- 2 Nov (LA10, harness request): atlas-map's `gateway-visitor-address.integrator.patch` is applied in
  `apps/api/src/public` (`proxy.ts`: `parseTrustedProxies`, `clientAddress`; `config.ts`: `trustedProxies`;
  `main.ts` passes it to `proxyHttp`/`proxyUpgrade`). With `PUBLIC_TRUSTED_PROXIES` unset nothing changes; on chatdom.io
  it is `172.18.0.0/16` (launch `SEAMS.md`, `deploy: 3`).
