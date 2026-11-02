# atlas-map seams

Frozen for this round (seam 4 of the round brief). To change one, write the change into this file and into the other
lane's `SEAMS.md`, and add a `seam:` line to both lanes' progress. Names below are the contract; internals are free.

## 1. The embed: `mountAtlas` (atlas-map exports, front-door and the `/map` page consume)

File: `apps/web/src/atlas/embed.ts`. It is a small entry: importing it loads no PixiJS, no map code and no data. The
map loads when `mountAtlas` or `preloadAtlas` is called.

```ts
import type { AtlasGateHost } from '../raid-gate/ports'; // type only; raid-show owns the interface

export type AtlasMode = 'hero' | 'explore' | 'gate';
export type AtlasTarget = { login: string } | { channelId: string };

export interface AtlasMountOptions {
  mode: AtlasMode;
  /** Where to look first. Default: hero = a composed view of live land; explore = the whole map (or the URL's target). */
  focus?: AtlasTarget | null;
  /**
   * Start exactly at a view this map gave earlier (`handle.view()`): position, zoom and open card. Wins over `focus`.
   * A view from another survey revision (`mapId`), or a malformed one, falls back to the usual start. (Added 2 Nov.)
   */
  view?: AtlasView | null;
  /**
   * explore only. 'url' owns the /map routes and history (the /map page uses this); 'memory' keeps every state inside
   * the element and never touches history. Default 'memory'. hero and gate always use 'memory'.
   */
  routing?: 'url' | 'memory';
  /** hero: a click, tap or Enter on the map calls this with the current view; the page decides where to go (usually /map). */
  onExplore?: (view: AtlasView) => void;
  /** Data base path. Default '/map-data'. */
  base?: string;
  /** Aborting it is the same as dispose(). */
  signal?: AbortSignal;
}

export interface AtlasView { x: number; y: number; scale: number; selected: string | null; mapId: string }

export type AtlasReadyState = 'map' | 'still' | 'failed';

export interface AtlasHandle {
  readonly mode: AtlasMode;
  /** Resolves once the first coherent frame is on screen: the live map, or the dated still without WebGL, or the designed failure state. */
  readonly ready: Promise<AtlasReadyState>;
  /** gate mode only; null otherwise. See section 2. */
  readonly gate: AtlasGateHost | null;
  view(): AtlasView;
  /** Flies there (van Wijk, under 3 s); resolves false if the channel cannot be shown. */
  flyTo(target: AtlasTarget, options?: { openCard?: boolean; signal?: AbortSignal }): Promise<boolean>;
  /**
   * Puts the map exactly at a view it gave earlier, without a flight, and opens its card (explore; a hero takes only
   * the position). Resolves true once it stands there; false for another survey revision, a malformed view, a card that
   * cannot be shown, or a disposed map. A view without a selection closes an open card. (Added 2 Nov.)
   */
  restore(view: AtlasView, options?: { signal?: AbortSignal }): Promise<boolean>;
  /** hero to explore in place, without remounting (the front page's "Explore the map" can open the map where it is). */
  setMode(mode: 'hero' | 'explore'): void;
  /** Removes the canvas, workers, listeners, timers, audio and transports. Safe to call twice. */
  dispose(): void;
}

export function mountAtlas(el: HTMLElement, options: AtlasMountOptions): AtlasHandle;
/** Warms the map chunks and the world head without drawing anything. */
export function preloadAtlas(options?: { base?: string }): Promise<void>;
```

Guarantees:
- **hero:** full-bleed in `el`, no chrome of its own (the page draws "Explore the map"), a slow composed drift over live
  land, the live wash and fresh caravans. It never captures page scroll: wheel and one-finger touch pass through to the
  page. It never writes history, never moves focus on mount and never sets the page-wide `window.__chatdomReady`
  (front-door owns that). It pauses when offscreen or the tab is hidden, caps device pixel ratio, and with
  `prefers-reduced-motion` holds one composed still view. A dated still of the same map is shown at once and cross-fades
  to the live map when ready; without WebGL the still stays.
- **explore:** the full Atlas (cartouche, search, key, cards, roads). With `routing: 'memory'` inside a page, wheel zoom
  starts only after the visitor clicks or taps into the map, so the page keeps scrolling.
- One `[data-chatdom-atlas]` root per mounted map, with `data-atlas-mode` and `data-atlas-ready` attributes.
- Works under the public CSP (`script-src 'self' 'wasm-unsafe-eval'`): the `pixi.js/unsafe-eval` shim stays inside the
  map chunk. Card pictures come from `static-cdn.jtvnw.net`, which the CSP already allows.
- The `/map` page keeps its default export from `apps/web/src/atlas/index.tsx` and is built on the same code
  (`mode: 'explore', routing: 'url'`).
- Bench: `/-/atlas-embed?mode=hero|explore|gate`, real data, for front-door to look at.

## 2. Gate mode: the Raid Gate's target finder (atlas-map implements, raid-show calls)

raid-show owns the interface `AtlasGateHost` in `apps/web/src/raid-gate/ports.ts`; atlas-map implements it without
changing that file.

```ts
const handle = mountAtlas(el, { mode: 'gate' });
const host: AtlasGateHost = handle.gate!;   // origin is always 'live' on product surfaces

host.open(fromKingdomId, signal);   // centres on the source kingdom and shows the finder; no side effects
host.subscribe(listener, signal);   // { kind: 'target', channel, land: 'founded' | 'waiting' | 'edge' } when the monarch picks; { kind: 'closed' }
host.resolve(kingdomId, signal);    // { channel, land } under the Atlas's visibility rules, or null (gone, withheld, hidden, gambling)
host.follow(raid, signal);          // attach the map to that witnessed raid's public caravan, once per raid ID
host.travel?.(stage, signal);       // rise | road | drawing | arrived | back, at the pace of raid-show's authority
host.close();
```

The finder, in this order, live channels only:
1. channels the source already has roads with;
2. channels in the same realm, then neighbouring realms;
3. search: any live Twitch channel, through the Atlas service's Twitch fallback with a live check.

Inside each group smaller channels come first. Nothing paid, sponsored or bought ever changes the order. Its data comes
from a public read, `GET /map-data/v1/gate/<mapId>/finder?from=<channelId>[&q=<text>]` (exact path settled in AM11 and
written to progress). The finder only proposes; raid-show's authority decides who may raid and calls Twitch. A pick
that is not live by the time of the press is refused by raid-show's authority, not by the map.

`land`: `founded` when the channel has a founded kingdom, `waiting` when it has a holding or a deterministic place on
the map, `edge` only for a live channel the Atlas cannot place (no language, no region).

## 3. The roads feed (raid-show publishes, atlas-map stores and draws)

raid-show owns the port `AtlasRoadIngress` in `apps/api/src/raid-gate/ports.ts`. atlas-map provides the endpoint and a
client that implements that port.

Endpoint (private: bound to 127.0.0.1 on its own listener, `ATLAS_INGEST_PORT`, never proxied by the public gateway):

```
POST /v1/roads/observe
Content-Type: application/json
Authorization: Bearer <ATLAS_INGEST_TOKEN>      only when the service is configured with a token
Body: one AtlasRaid (packages/shared/src/atlas-raids.ts), version 1

200 { "kind": "stored",    "raidId": "...", "road": "<fromId>~<toId>", "raids": <count on this road> }
200 { "kind": "duplicate", "raidId": "...", "road": "...", "raids": <count> }   same raid ID, or the same raid already seen by the survey's own feed
422 { "kind": "invalid",   "reason": "..." }                                      schema or rule failure; do not retry
503 { "kind": "unavailable" }                                                     retry later
```

- What raid-show sends: only raids Twitch witnessed (EventSub `channel.raid`, signature checked by main's ingress), as
  `source: 'herald'`, `evidence.kind: 'observed'`, `delivery: 'resumable'`, `occurredAt` = the event time, and a stable
  `id` (the EventSub message ID or one derived from it). Incoming raids to tobi4s_ and raids out through the Gate both
  qualify. Never a request, preview, countdown or timer.
- `200` is sent only after the raid is durably in the road ledger. Posting the same raid again is always safe.
- Client: `createAtlasRoadIngress({ url, token?, fetch? }): AtlasRoadIngress` from `apps/surveyor/src/roads/client.ts`,
  free of Node-only imports. `observe()` resolves on `stored` or `duplicate`, rejects otherwise. raid-show binds it where
  its outbox delivers (it already retries every 30 s).
- The Atlas also takes raids from the survey's own raid feed; both sources meet in one ledger and are deduplicated.
- Public reads of roads (paths settled in AM11): the existing `/map-data/v1/preview/<id>/road/...`, plus the busiest
  roads for a view and all roads of one channel.

## 4. What atlas-map needs from others

| From | What | Until it exists |
|---|---|---|
| front-door | The carved kit and type scale in `packages/ui` (cartouche frame, wax seal, buttons, focus ring, icon family) | Build it in `apps/web/src/atlas/ui`, then `needs:` to move it into the kit |
| front-door | The official Twitch mark in its painted frame, as a component in `packages/ui` | The Watch button shows its words only |
| front-door | "How it works" panels to hang from the Atlas's bottom slot (`slots.footer` in explore mode) | The survey seal's one line, nothing more |
| front-door | New public `/map-data` routes in the gateway allowlist (`apps/api/src/public/routes.ts`): roads and the gate finder. The edition needs none: it is served through the existing preview routes (see "Edition I and claims" below) | The routes work on the lane's own service and the dev proxy only |
| front-door (sign-in) and main | A session authority that calls the Atlas service's private endpoints for hide and unhide (`POST /v1/channels/<id>/hide`, `/unhide`) and for a sign-in claim (`POST /v1/claims`, cause `signed-in`), with the verified broadcaster ID | The card shows no hide button; AM13 waits on it. Sign-in claims: land by raid only |
| main (Genesis) | A founding claim (`POST /v1/claims`, cause `founded`) when a kingdom is founded in Chatdom | Land by raid and sign-in only |
| operator | After the merge: rebuild and restart the live Atlas service with the Twitch env file and the ingest listener, re-import for the new names, adopt the founded edition. Runbook in this folder | The live map keeps the old code |

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

## Road-feed consumption checkpoint — 2 Nov, AM11

The round's existing pull seam is now consumed by `apps/surveyor/src/roads/pull.ts`.
Configure `ATLAS_RAID_FEED_URL` as the full raid-show `/realm/raid-roads` endpoint.
Its `{version:1, items:AtlasRaid[], next:string|null}` reply and opaque cursor
semantics are unchanged from raid-show's seam. The Atlas commits each page's tail
cursor with its final observation in its own durable ledger; empty/short pages
never reset history. Unconfigured or failed reads make no “no raids” assertion.
This is adoption of the frozen pull contract, with no new route or shared type.

Operator adoption and recovery are recorded in `AM11-durable-roads.md`.

## Roads, caravans and the gate settled — 2 Nov, AM11

Nothing in §2 or §3 is renamed; this fills in what AM11 left open. Details and evidence: `AM11-roads-and-gate.md`.

- **Gate mode works.** `mountAtlas(el, { mode: 'gate' }).gate` is the `AtlasGateHost` of
  `apps/web/src/raid-gate/ports.ts`, unchanged (a type test fails if either side drifts). Calls made before the map is
  drawn wait for it: the latest `open` wins, `follow` and `travel` keep their order, `close` clears what is held.
  `closed` is emitted only when the board closes itself; `close()` from the host is silent. A pick emits
  `{kind:'target', channel, land}` with `founded: false`, `kingdomName: null`, `contentClassification: 'unknown'` (the
  Atlas has no founded-kingdom or classification record yet) and `land` `waiting` (placed) or `edge` (no place).
  `follow` waits up to 120 s for the raid's caravan to appear on the public stream, matched by raid ID or by the same
  pair within 30 s. Bench: `/-/atlas-embed?mode=gate&from=<channelId>` (default tobi4s_, 129634568).
- **Public reads** (GET/HEAD, ids are Twitch IDs, `pv-…` is the map ID):
  - `/map-data/v1/roads/<pv>/channel/<id>`: every road of one channel, strongest first (64 at most, `total` counts all).
  - `/map-data/v1/roads/<pv>/road/<idA>/<idB>` and `/road/login/<loginA>/<loginB>`: one road's story. When a road
    exists both ways are objects (an unridden way reads zero); `null` both ways with `basis: 'none'` means no raid
    between them has been seen since `since`.
  - `/map-data/v1/roads/<pv>/busiest`: the 400 strongest roads with both ends placed, no names.
  - `/map-data/v1/gate/<pv>/finder?from=<id>[&q=<text>][&portraits=1]`: groups `roads`, `realm`, `neighbours`, then
    `search` when `q` is given. Proposals are live only and each channel appears once; search keeps offline matches
    (shown, not selectable).
- **Caravans** ride as `event: raid` on the existing `/map-data/v1/live/<pv>/events` stream, only to streams open at
  that moment, never buffered or replayed. A raid from raid-show (ingest or pull) rides only within 60 s of its event.
- **Private ingest** is built: `POST /v1/roads/observe` on its own listener (`ATLAS_INGEST_PORT`, `ATLAS_INGEST_HOST`
  default 127.0.0.1, optional `ATLAS_INGEST_TOKEN`), as in §3; the public server answers 405 to it. Further replies:
  413 `too-large`, 422 reasons `content-type | json | schema | simulation | source | conflict`.
  `createAtlasRoadIngress({ url, token?, fetch?, timeoutMs? })` in `apps/surveyor/src/roads/client.ts` implements
  `AtlasRoadIngress`; it rejects with `AtlasRoadIngressError` and checks the echoed `raidId`.
- **Gateway allowlist, applied here.** No round lane owns `apps/api/src/public/routes.ts`, so this lane made the
  smallest additive change itself, as its own change for the reviewer: one `MAP_ROADS` pattern routes
  `/map-data/v1/roads/<pv>/channel/<id>`, `/roads/<pv>/road/<idA>/<idB>`, `/roads/<pv>/road/login/<a>/<b>`,
  `/roads/<pv>/busiest` and `/map-data/v1/gate/<pv>/finder` to the optional map service. Every existing route is
  unchanged, and `routes.test.ts` checks the new paths and their near misses. The private ingest is never routed.

## Return to the same view — 2 Nov, AM10 (asked by front-door for FD12)

Additive, nothing renamed: `AtlasMountOptions.view` and `AtlasHandle.restore(view)` above. `view().selected` is the
open card's Twitch channel ID: a holding, a channel waiting for land, or the channel a pencil flag's register named
(earlier it was null for a pencil flag). Only digits are accepted back as a selection; anything else keeps the camera
and opens no card. The camera is clamped to the land and zoom range like any other move. Without WebGL the dated
still has one fixed view, so a restore there opens the card only. With `routing: 'url'` a restored card puts its
`/map/<login>` in the address bar like any opened card; memory routing never writes history. A route in the URL
(`/map/<login>`) still opens its own card after a `view` start.

The sign-in seal and `takeReturnView()` recipe on `/map` waits for front-door's `@chatdom/ui/site` exports to reach
this branch through main; the embed half is ready for the front page now.

Newest request wins (2 Nov, AM10 follow-up): each `restore` or `flyTo` cancels the one before it. A superseded call
resolves `false` and never opens its card or finishes its flight later, and a card the person opens or closes while a
call is still fetching stays as they left it. The front page needs no guard of its own.

## Edition I and claims — 2 Nov, AM12

**The edition is served through the existing preview routes.** `GET /map-data/v1/preview` keeps its shape. Once an
edition is published, it points at the edition's night (an edition publication, `status: 'edition'`) and adds
`edition: { id: 'ed-1', label: 'Edition I', foundedAt, worldHash, address }`. World, region, names, search, card,
road and live routes are unchanged, and the gateway needs no new pattern. The browser validates both shapes strictly.
An embed host that wants to say "Edition I" can read `edition.label` from the pointer; the map's own seal already says
it. Wire details are in `AM12-edition.md`.

**Claims (private, on the ingest listener).** `POST http://127.0.0.1:$ATLAS_INGEST_PORT/v1/claims` takes
`Authorization: Bearer $ATLAS_INGEST_TOKEN` and
`{"version":1,"kingdomId":"<twitch user id>","cause":"signed-in"|"founded","claimedAt":<ms>}`. The reply is
`202 recorded` or `200 duplicate` (safe to retry; concurrent posts record once). Refusals are `401`, or `422` with
`json`, `schema` or `unknown-channel`. `503 facts-unavailable` comes with `retry-after: 300`. The claim is durable
before the reply, and land follows at the next survey night, at the channel's own pencil place (where the map already
shows it). A producer sends only the verified ID and the cause, never a place, tier or realm.

- front-door's session authority posts `signed-in` after a verified Twitch sign-in of the broadcaster, once per
  sign-in or once per channel. Duplicates are free.
- main's Genesis posts `founded` when a kingdom is founded.

Neither producer exists yet; `needs:` lines are in progress.

**Realm words outside the land (2 Nov, AM12).** Realm labels now come from
`apps/surveyor/src/cartography/realm-names-1.json` (proposed), keyed by family id and land kind, applied when the
browser reads a world (`labelWorld`, `geographyOf`, `realmWord`). It repeats today's labels exactly, so no host sees a
change; a later rename never touches an edition. `DoorHolding.realm.name` reads from it too.

## Site build needs the Solid plugin — 2 Nov (front-door finished; file not on this branch)

chatdom.io's site build (`apps/web/src/site/vite.config.mjs`, front-door's) fails once the front page mounts the
Atlas embed, because the site config compiles `src/atlas/scene.tsx` without Solid's JSX transform ("Unexpected JSX
expression"). The fix is two lines, in `work/lanes/atlas-map/site-solid-plugin.patch`: `import solid from
'vite-plugin-solid'` and `plugins: [partials, solid()]`. The file exists only on `lane/front-door` and
`lane/integrator`, never on `lane/atlas-map`, so it cannot be committed from this branch without an add/add
conflict. Checked on an export of `lane/integrator` (`ed7ac60e`): without the patch the site build fails with that
error, with it the site build exits 0 and writes all six pages. Apply it with `git apply` on the integrator (or on
this branch after it takes front-door).

## from launch

- 2 Nov (LA10): `/kingdom/<id>` now asks the realm for adopted land before reading the survey
  (`apps/web/src/genesis/index.tsx`): a founded kingdom the survey never observed (tobi4s_, under the 5-viewer floor)
  stopped at "The Atlas could not be read just now". The survey is read only for an unfounded holding. The "Compare
  the three kingdoms ↗" link to the retired `/showcase` is gone.
- 2 Nov (LA10): until the first edition is founded, a name the register does not know is checked against the front
  door's kingdoms (`/api/public/door`, new `apps/web/src/atlas/data/open-kingdoms.ts`): the search's empty state offers
  "Enter <kingdom>" (`.atlas-search-door`), and `/map/<login>` gives the same notice with an Enter action. Once claims
  draw founded kingdoms, this simply never fires for them.
- 2 Nov (LA10): phone `.atlas-notice` is pinned left 10px / right 64px (beside the zoom column); centred on half the
  width it wrapped one word per line.
- 2 Nov (LA10), deploy: the live data service on 5193 is the old `lane/atlas` build without roads or lookup; exact
  steps in `work/lanes/launch/SEAMS.md` under `deploy:`.
## Self-serve hide — 2 Nov, AM13 (atlas-map built the session authority itself)

§4 asked front-door and main for a session authority that calls the Atlas's private hide routes. Neither round lane
owns that code now (front-door is finished, main takes no patches), so atlas-map wrote it as the smallest additive
change, modelled exactly on the dock's handler. The lane review ruled `apps/api` outside this lane's scope, so the
change is not in this branch: it is the patch `work/lanes/atlas-map/atlas-owner-api.patch` (applies cleanly on this
branch's base; `git apply` it as its own commit, `feat(api): the Atlas owner's hide and show`, then run
`apps/api/src/atlas-owner/index.test.ts` and `public/routes.test.ts`). Until it lands, `/api/atlas/me` is a gateway
404, the map reads that as anonymous and no card offers hiding; everything on the Atlas side is in this branch.

**On the integrator (2 Nov, 18:45):** the integrator's gateway moved (raid-gate handlers after the dock, more routes),
so `atlas-owner-api.patch` no longer applies there. `work/lanes/atlas-map/atlas-owner-api.integrator.patch` is the same
change rebased on `lane/integrator` `ce219fd5` (`git apply --check` passes there and on `worktrees/public-next`; the
patched `public/routes.test.ts` passes 23/23 on the integrator's route table; `dock/auth.ts`, `realm-auth/secrets.ts`
and `realm-auth/config.ts`, which the new handler imports, are byte-identical on both branches).

*Rebased again (2 Nov, 19:20 local):* the integrator's pending launch merge passes `config.trustedProxies` to every
`proxyHttp` call in `public/main.ts`, which moved the patch's one context line there. The patch file now applies on
top of that merge (`git apply --check --cached` passes on the integrator's staged index); the only change is that
context line, the `atlas-owner` case is unchanged and still sits between `dock` and `realm`. For `lane/integrator`
`2949613a` without the launch merge, the previous version is `git show
f803a214:work/lanes/atlas-map/atlas-owner-api.integrator.patch`.

*Checked (2 Nov, 19:17 local):* the launch merge is committed (`0f3173f8`) and `lane/integrator` `da04caad` has
merged this lane; the current patch file applies there as it is (`git apply --check` on the clean integrator
worktree). The deployed Atlas service (`worktrees/atlas-live`, `fcfe6d47`) already carries the owner log and the
private hide endpoints, so steps 2 and 3 below are env lines only, with no rebuild of the Atlas service.

To make the hide flow real on chatdom.io, in this order:

1. Integrator: `git apply work/lanes/atlas-map/atlas-owner-api.integrator.patch`, its own commit
   (`feat(api): the Atlas owner's hide and show`); run `apps/api/src/atlas-owner/index.test.ts` and
   `public/routes.test.ts`; rebuild the public gateway (`node scripts/public/build.mjs`).
2. Atlas service (`atlas-live.sh serve`): `ATLAS_INGEST_PORT=5201` and `ATLAS_INGEST_TOKEN=<openssl rand -hex 32>`
   in its env file (the deploy table's optional row).
3. Public gateway (`ops/bin/public`): `ATLAS_PRIVATE_URL=http://127.0.0.1:5201` and the same
   `ATLAS_INGEST_TOKEN`.
4. Check: signed out, `curl https://chatdom.io/api/atlas/me` answers `{"version":1,"status":"anonymous"}` (not 404).
   Then Tobias signs in with Twitch as tobi4s_ on chatdom.io/map, opens his card (search `tobi4s_`) and the line
   "Your channel · Hide my channel" is under its actions; atlas-map takes the hide-flow stills from there.

- **`apps/api/src/atlas-owner/index.ts`** (new): `GET /api/atlas/me[?preview=<map id>]`, `POST /api/atlas/me/hide`,
  `POST /api/atlas/me/show`. The channel is always the session's own person (`dockPrincipal`: a signed-in Twitch user
  is the broadcaster of exactly one channel), never anything the browser sends. Mutations need the page's exact
  `Origin` and the session's CSRF token (`dockMutationAllowed`). Replies are `no-store`, `Vary: Cookie`. A SIMULATED
  sign-in never reaches the Atlas. Replies: `{version:1,status:'anonymous'}`, `{version:1,status:'unavailable',channelId}`
  (Atlas not configured or unreachable: the map shows no button), or `{version:1,status:'broadcaster',channelId,hidden,
  onMap,card,csrfToken}` (`card` only while hidden: the card as the map would draw it without the owner's hide).
- **Wiring, one line each:** `apps/api/src/main.ts` (after the dock), `apps/api/src/public/main.ts` (a `case 'atlas-owner'`
  beside `'dock'`), `apps/api/src/public/routes.ts` (the three paths, exactly; `routes.test.ts` checks them and their
  near misses).
- **Configuration (operator):** `ATLAS_PRIVATE_URL=http://127.0.0.1:$ATLAS_INGEST_PORT` and `ATLAS_INGEST_TOKEN` on the
  public gateway / API process, the same token the Atlas service's private listener has. The hide routes refuse to
  exist (`503 not-configured`) on an Atlas service without a token.
- **The Atlas service's private routes** (on the ingest listener, bearer token): `POST /v1/channels/<id>/hide` and
  `/unhide` with `{"version":1,"at":<ms>}` → `200 {kind:'hidden'|'shown', kingdomId, changed, hidden, onMap}`; `GET
  /v1/channels/<id>/visibility[?preview=]` → `{version:1, kind:'owner-visibility', kingdomId, preview, hidden, onMap, card}`.
  The act is fsynced to `moderation/owner-visibility.ndjson` before the reply; every reader folds owner hides into the
  withheld set (names, search, cards, roads, finder, live paint, settlement), and the operator's `withheld.json` always
  wins. Open maps hear `event: names` on their live stream within ~2 s and read their names again.
- **On the map:** only in explore mode and only after the first frame, the Atlas reads `/api/atlas/me` once. The signed-in
  broadcaster's own card gets one quiet line, "Your channel · Hide my channel"; while hidden, their own card ("Hidden by
  you", "Show my channel") opens from search and from `/map/<login>`, for them only. Hero and gate never ask.
- **Still owed:** the stills through the real Twitch sign-in as tobi4s_ (needs Tobias at a browser on chatdom.io once
  adopted). The bench stills in `work/evidence/atlas-map/am13-hide-*.png` were taken with the check playing this
  session authority against the lane's own Atlas service.

## The first frame comes first — 2 Nov, AM13 (additive; nothing to change on the host)

- **Faces:** `mountAtlas` adds `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the Atlas's seven faces
  (the same files `atlas.css` declares) to `document.head`, once per document, the moment a map is mounted. A strict-CSP
  host needs no new source: the faces were already same-origin fonts.
- **Ready:** unchanged in shape. `handle.ready` resolves with the first coherent frame, `'still'` with WebGL too; the
  moving map (its renderer is now its own chunk, `engine`) is built only after the still is up and takes the still's
  baked land, so `data-atlas-ready` turns `map` later than before on slow machines. Hosts that already wait for the first
  state need nothing.
- **Names:** the map first reads `/map-data/v1/preview/<id>/names?part=head` (the capitals' and cities' names and every
  withheld id, ~40 KB brotli instead of ~1 MB), and the whole projection only after the first frame. The gateway's
  `MAP_READ` already passes the query; an Atlas service without the part answers the whole, which the map also reads.
- **Compression:** the Atlas service now answers brotli where the reader takes it (world, regions, names, live files)
  and gzips its larger JSON replies (`roads/busiest` 71 → 15 KB). Proxies must pass `content-encoding` and
  `vary: accept-encoding` through, as `apps/api/src/public/proxy.ts` does.
- **Suggested to main / front-door (outside this lane, not done):** `apps/web/src/main.tsx` statically imports
  `@chatdom/shared` and the realm contracts, so `identity` + `realm` (61 KB gzip, ~100 ms of evaluation here) load and
  run on every route, `/map` and the front page included, before the Atlas is asked for; importing them inside the
  `walk=1` branch takes them off the Atlas's first frame. The static asset server could also send brotli for JS and CSS
  (about 10 % fewer bytes than gzip).

## deploy: the Atlas service chatdom.io reads — 2 Nov, AM14 (for the operator to run)

chatdom.io's `/map-data` today goes to the old service on 127.0.0.1:5193 (the `atlas` worktree's build, data from 31 Oct
code). It has no directory fallback, so `tobi4s_` and every other channel the survey never saw reads "not found". These
steps start this lane's build as a second service beside it, on its own data, and switch the gateway to it. The old
service, its data and its `atlas-refresh` loop stay exactly as they are, as the rollback. Nothing here writes to the
collector or to Twitch. Every step was run on this lane's copy (127.0.0.2:5199, `apps/surveyor/shots/am14-data`) on
2 Nov; the timings are from there.

**What it needs.** Code: the reviewed tip of `lane/atlas-map` that carries AM14 (or any later `lane/integrator` commit
that contains it). Ports: `127.0.0.1:5200` for public reads (outside every range the lanes and capture tools use), and
optionally `127.0.0.1:5201` for the private listener. Memory: about 0.9 GB resident (two survey registers during an
import swap: about 1.5 GB), idle CPU 0 %. Disk: about 300 MB per kept revision, 100 MB of road ledger.

**Environment (names only; the values are in the env files the operator already has).**

| Name | Value / source |
|---|---|
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | from `/root/.config/chatdom/atlas.env` via `node --env-file` (the app token for public reads; nothing else in that file is read) |
| `ATLAS_DATA_DIR` | `/srv/chatdom/data/atlas` (outside any worktree, so code upgrades never touch it) |
| `ATLAS_HOST`, `ATLAS_PORT` | `127.0.0.1`, `5200` |
| `ATLAS_TRUST_LOOPBACK_PROXY` | `1` (the gateway on the same host names the caller in `X-Forwarded-For`) |
| `ATLAS_LOOKUPS_PER_CLIENT_MINUTE` | `60`: the gateway names every visitor with Traefik's one address (see `needs:` below), so the per-client allowance is raised to the shared Twitch budget (60 a minute, never below 200 points left), which still bounds the whole service |
| `SURVEYOR_BASE_URL` | `http://172.17.0.1:3541/atlas/api/` (the collector's status and live raid stream, read-only) |
| `SURVEYOR_DB_PATH` | `/srv/chatdom-atlas/data/surveyor.db` (opened read-only) |
| `ATLAS_LIVE_INTERVAL_MS` | `60000` for the live producer (sweeps come every 3 minutes) |
| optional `ATLAS_RAID_FEED_URL` | raid-show's `/realm/raid-roads` on the live realm, once it serves it |
| optional `ATLAS_INGEST_PORT`, `ATLAS_INGEST_TOKEN` | `5201` and a fresh secret (`openssl rand -hex 32`, kept in an env file outside the repo) for the private listener: road observations, claims, owner hide/show. Not needed for search |

**1. Build (about 2 minutes).**

```sh
cd /srv/chatdom/chatdomgg
git worktree add --detach /srv/chatdom/atlas-live lane/atlas-map
cd /srv/chatdom/atlas-live
taskset -c 0-8 nice -n 10 pnpm install --frozen-lockfile --ignore-scripts
taskset -c 0-8 nice -n 10 pnpm --filter @chatdom/surveyor build          # writes apps/surveyor/dist/atlas.mjs
```

**2–4 run through one script**, `apps/surveyor/scripts/atlas-live.sh` in the built checkout. Its defaults are the
table above (each can be overridden from the environment; `ATLAS_SEED_FROM` names the old data, which it only reads;
`ATLAS_LOG_DIR` defaults to `ops/state`). It refuses to run without a build or before the data is seeded. All three
loops and the health gate were rehearsed on this lane's copy on 2 Nov (127.0.0.2:5199): seed 2 min 22 s, the service
restarted 10 s after it was ended and shut down cleanly on SIGTERM, health green.

**2. Seed (about 2.5 minutes; safe to run again, it then copies nothing, and an interrupted seed resumes without copying a finished revision twice).** Copies the old service's current revision,
its import ledger and the operator's withheld list read-only (the pointer last, so it never names a missing revision),
draws this build's own preview from that revision (language names, codes-only artifacts; the old preview is not
copied), runs `check` (fails the seed unless it ends "verified: …") and publishes the first live wash frame.

```sh
L=/srv/chatdom/atlas-live/apps/surveyor/scripts/atlas-live.sh
$L seed
```

**3. Run it: three loops, each in its own window, like `bin/public` and `bin/atlas-refresh`.** Logs:
`ops/state/atlas-live.log`, `atlas-live-wash.log`, `atlas-live-refresh.log`.

```sh
tmux new-window -d -t chatdom -n atlas-live         "$L serve"     # the service on 127.0.0.1:5200, restarted 10 s after an exit
tmux new-window -d -t chatdom -n atlas-live-wash    "$L wash"      # the live producer: wash, live cards, the finder's live check
tmux new-window -d -t chatdom -n atlas-live-refresh "$L refresh"   # the 6-hourly import, same source and cadence as atlas-refresh
```

`serve` and `refresh` read the Twitch app credentials from `/root/.config/chatdom/atlas.env` with `node --env-file`
(nothing else in that file is used); without the file the service still answers from the survey and says plainly that a
name is not on the map yet. The old setup runs no live producer, which is why chatdom.io's wash dates from 30 Oct.

An import takes its own lock and never the service's road ledger, so it runs beside the service; the service notices the
new `current.json` and reads the new register within 30 s, before anyone has to wait for it. Two import loops read the
collector: once the new service has served a day, stopping `atlas-refresh` halves that load (the old service then keeps
its last data as a frozen rollback).

**4. Health check, before switching.** The service listens 10–20 s after start (it first recovers the road ledger from
the recorder, about 100 MB on the first start) and reads the search register in about 15–20 s. The gate waits through
that (up to `ATLAS_HEALTH_WAIT_S`, 120 s) and exits 0 only when health and preview answer, `tobi4s_` (a channel outside
the survey) is found and pencilled, its card stands at the same place and holds no land, and a random made-up login is
never invented:

```sh
$L health                     # "healthy in …"; exit 1 with the failing line otherwise
#   ok   tobi4s_ waiting at {"x":-11.2,"y":355.6}
#   ok   card 200 in 5 ms at {"x":-11.2,"y":355.6}
```

**5. Switch.** In `ops/bin/public`, set `export PUBLIC_MAP_TARGET=http://127.0.0.1:5200` and restart the window
(`tmux kill-window -t chatdom:public; tmux new-window -d -t chatdom -n public ops/bin/public`). The gateway needs no
code change: its allowlist already admits every route the search and the card read (tested in
`apps/surveyor/src/directory/public-gateway.test.ts`). Then:

```sh
$L health https://chatdom.io   # the same gate through the public gateway: exit 0 (today it fails "tobi4s_ not found")
cd /srv/chatdom/atlas-map
ATLAS_CHECK_URL=https://chatdom.io ATLAS_CHECK_NAME=chatdomio node apps/web/src/atlas/checks/deploy-shots.mjs
#   stills work/evidence/atlas-map/am14-chatdomio-card-{1440,390}.png, timings in am14-chatdomio.json (exit 0 = found and placed)
```

The map ID changes with the switch (this build draws its own preview), so a visitor's saved view from the old map falls
back to the usual start, by design.

**Rollback.** Set `PUBLIC_MAP_TARGET=http://127.0.0.1:5193` back in `ops/bin/public` and restart the window. The old
service never stopped. Then stop the three `atlas-live*` windows if wanted; `/srv/chatdom/data/atlas` can stay
for a later retry.

**Upgrade later.** `git -C /srv/chatdom/atlas-live checkout --detach <newer commit>`, `pnpm install
--frozen-lockfile --ignore-scripts`, `pnpm --filter @chatdom/surveyor build`, then end the `atlas.mjs serve` and `live`
processes (their loops restart them on the new build within 10–30 s). The data directory carries over.

**Still owed by others (written as `needs:` in progress).** The public gateway (`apps/api/src/public/proxy.ts`,
`upstreamHeaders`) replaces `X-Forwarded-For` with its own peer, which on chatdom.io is always Traefik's one docker
address, so every visitor shares one client allowance (hence the 60 above). The fix is ready as a patch, since the
gateway is not this lane's: `work/lanes/atlas-map/gateway-visitor-address.integrator.patch` (applies to `lane/integrator`
and to chatdom.io's `public-next` as they stand; `gateway-visitor-address.patch` is the same change on `main`). It adds
`PUBLIC_TRUSTED_PROXIES` (IPv4 ranges or single addresses, comma separated; unset keeps today's rule exactly). When the
peer is a trusted proxy, the gateway forwards the right-most `X-Forwarded-For` entry that is not itself a trusted proxy,
so a browser's own claim to the left is never believed; a malformed or missing entry falls back to the peer. It covers
HTTP and the realm's WebSocket upgrades alike. Tests in `proxy.test.ts` and `config.test.ts` (26 pass on the integrator
files). To adopt it:

```sh
git apply work/lanes/atlas-map/gateway-visitor-address.integrator.patch   # own commit: fix(api): name each visitor behind the TLS proxy
# ops/bin/public: export PUBLIC_TRUSTED_PROXIES=172.17.0.0/16   (Traefik's docker bridge; the gateway listens on 172.17.0.1)
# restart the public window, then the serve loop as ATLAS_LOOKUPS_PER_CLIENT_MINUTE=6 atlas-live.sh serve (6 per visitor)
```

## from launch

- 2 Nov (LA10): `needs: integrator/atlas-map: land the Atlas owner API.` On chatdom.io every Atlas load in explore mode
  logs a console error (`404 /api/atlas/me?preview=…`): nothing serves the route, because
  `work/lanes/atlas-map/atlas-owner-api.patch` was never applied, and it no longer applies to `lane/integrator`
  (`git apply --check`: `apps/api/src/main.ts:44` and `apps/api/src/public/routes.ts:8` drifted). Rebase the patch
  and land it, with its operator settings (`ATLAS_PRIVATE_URL`, `ATLAS_INGEST_TOKEN`), so a signed-out visitor
  gets `{version:1,status:'anonymous'}` instead of a 404.
- 2 Nov (LA10): a waiting card whose login is one of the kingdoms the front door opens (`/api/public/door`) now says
  "Founded · <name>", offers **Enter <name>** (`/kingdom/<id>`) and replaces the pencil note with "<name> is founded
  and open to visit. The map draws its land with the Atlas's next edition." Before, tobi4s_'s card (found by the
  public lookup since the Atlas service was rebuilt) said "Waiting · no land of its own" with no way in.
  (`apps/web/src/atlas/ui/Register.tsx`, `WaitingCard`.)
- 2 Nov (LA10): `gateway-visitor-address.integrator.patch` is applied on `lane/launch` (tests pass) and goes to
  `lane/integrator` with the launch merge. On this host Traefik reaches the gateway from `172.18.0.4` (bridge
  `172.18.0.0/16`), not from docker0, so the setting is `PUBLIC_TRUSTED_PROXIES=172.18.0.0/16` (launch `SEAMS.md`,
  `deploy: 3`).
