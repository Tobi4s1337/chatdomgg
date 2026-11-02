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
| front-door | New public `/map-data` routes in the gateway allowlist (`apps/api/src/public/routes.ts`): roads, the gate finder, the edition pointer and files. Exact regexes go in a `needs:` line when each route settles | The routes work on the lane's own service and the dev proxy only |
| front-door (sign-in) and main | A session authority that calls the Atlas service's private endpoints for hide and unhide (`POST /v1/channels/<id>/hide`, `/unhide`) and for a sign-in claim, with the verified broadcaster ID | The card shows no hide button; AM13 waits on it |
| main | The founded-record producer, so a founding claims its land | Claims by raid only |
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

The separate private POST and `createAtlasRoadIngress` client described above
remain optional and are not implemented by this checkpoint. Public ledger routes
and the gate finder are also not yet exposed. Operator adoption and remaining work
are recorded in `AM11-durable-roads.md`.
