# Play seams

Frozen on Sun 1 Nov 2026 for this round. A seam changes only by writing the change into both lanes' `SEAMS.md` through
the integrator (a `needs:` line in progress), never silently. Section A is what play consumes, section B is what play
provides, and section C is between play's own two goals.

## A. Consumed: ground, surface and solids (grand-world provides; play reads)

Owner: grand-world. Play never edits land generation, terrain, `apps/web/src/kingdom/scene.ts`, `build-scene.ts`, the
land modules or the founded-scene assembly in `apps/realm/src/founded/**`.

### A1. What exists today and play uses as it is

| What | Module | Function / field |
|---|---|---|
| The land seam for one installed scene, on either land | `packages/world/src/land-interface.ts` (exported by `@chatdom/world`) | `KingdomLandInterface` from `createKingdomLandInterface({ scene, ground, collision? })` |
| Physical ground top at a point (`null` = unknown, never stand there) | same | `KingdomLandInterface.groundAt(x, z): Vec3 \| null` |
| Loaded-region solids, structures included (unknown space is solid) | same | `KingdomLandInterface.collision: CollisionWorld \| undefined` |
| The anvil and the supported approach | same | `KingdomLandInterface.forge.anvil: Vec3`, `.forge.approach: Vec3 \| null` |
| The street graph (for the lantern path and the minimap) | same | `KingdomLandInterface.paths` (`nodes`, `streets`, `activeStreetIds`) |
| Old land ground source | `packages/world/src/founded-world/collision.ts` | `foundedGroundAt(plan, x, z)`, `compileFoundedScene(scene)` |
| Grand land ground source | `packages/world/src/grand/kingdom/ground.ts` | `grandGroundSource(scene, region?)`, `grandKingdomLand(scene, collision?)` |
| Movement physics (realm and client prediction, unchanged) | `packages/shared/src/realm/movement.ts` | `CollisionWorld.query(bounds: SolidBox): readonly SolidBox[]`, `revision` |
| Public ground kind and paving distance (today's only surface hint) | `packages/world/src/settlement/terrain.ts` | `samplePublicGround(plan, x, z): PublicGroundSample \| undefined` |

Today's honest limits:
- `groundAt` and the collision terrain are half-metre cells with heights rounded to 0.5 m. The drawn terrain is a
  smoothed metre mesh. They differ by up to about 0.25 m on slopes, which is why feet sink or float (F07).
- There is no surface-material query. Play can only tell paving, trails and public ground apart, so off-road steps
  play "earth" (F06).
- The anvil is not a solid in any collision world, and civic and forge fixtures that do not fit are dropped silently
  (`apps/realm/src/founded/artifact.ts` `ABSENT_PLACE_DEPENDENCIES`; `forge-hearth-furnishings.ts`
  `enrichNativeForgeHearth` returns the town unchanged). That is F08.

### A2. What play asks grand-world to add (needs:, additive to `KingdomLandInterface`)

```ts
// packages/world/src/land-interface.ts (grand-world), additive
export type GroundSurface =
  | 'grass' | 'meadow' | 'earth' | 'gravel' | 'cobble' | 'stone' | 'plank'
  | 'sand' | 'snow' | 'shallows' | 'rock';

export interface LandSurfaceSample {
  /** Height of the DRAWN surface at (x, z), in world metres: the triangle the player sees. */
  readonly drawnY: number;
  /** What the drawn surface is made of at this point, as painted. */
  readonly surface: GroundSurface;
  /** Water depth above drawnY in metres; 0 on dry ground. */
  readonly waterDepth: number;
}

export interface KingdomLandInterface {
  // ...everything above, unchanged...
  /** Null where unknown. Must match the rendered terrain on the old land and the grand land. Cheap enough for
   *  about 70 calls per frame (self plus the 64 nearest walkers' footfalls). */
  readonly surfaceAt?: (x: number, z: number) => LandSurfaceSample | null;
}
```

Also asked of grand-world:
1. **The anvil is a solid.** Add the anvil-hero's solid box at `foundedAnvilPosition(scene)` to the founded scene's
   placements, so `compileFoundedScene` (realm and client) stops a walker. Use the drawn anvil's footprint (main's
   brief in `work/lanes/kingdom-look-owners.md`: the anvil stays with `anvil-hero`). Copy forge-wish, which owns the
   forge realm modules.
2. **No silent drops.** A civic or forge fixture that fails to place is a build error with its id and reason, never an
   unchanged town (`enrichNativeForgeHearth`, `enrichNativeForgeWorkshop` and the civic placements).
3. **A quality control.** A typed quality setting on the scene (`'high' | 'balanced' | 'low'`) that play's ledger can
   set. Until it exists the ledger shows no quality setting.

Play's fallbacks until A2 lands, all honest and read-only:
- Feet: a downward ray against the drawn ground meshes (it matches the drawn surface by construction), used only to
  draw the body, eased and clamped to the physics gap.
- Footsteps: paving gives cobble or stone, trails give an earth path, the home's installed floor wins, and other
  public and open ground gives grass.
- Solids: the PL10 collision test stays red for the anvil, and the goal is not ticked, until item 1 lands.

## B. Provided: the HUD shell, the Esc ledger, the cursor and the look

Owner: play. The module is `apps/web/src/play/slots.ts`. PL10 lands it in its first checkpoint, exactly as below.

```ts
// apps/web/src/play/slots.ts
import type { KingdomId } from '@chatdom/shared';

/** What every slot is given. Read only; never cache it across mounts. */
export interface PlayContext {
  readonly kingdomId: KingdomId;
  /** The signed-in walker, or null when watching. publicName is the approved name. */
  readonly self: { readonly personId: string; readonly publicName: string; readonly lookToken: string } | null;
  /** The stream is live right now (Forge, moments and coal wait for it). */
  readonly live: boolean;
  /** 'walking' | 'watching' | 'stream' (the stream view never shows the ledger). */
  readonly mode: 'walking' | 'watching' | 'stream';
  readonly settings: PlaySettingsReader;
  /** Take the cursor out of pointer lock for a panel. Release it to hand control back on the next click. */
  requestCursor(reason: string): CursorLease;
  /** Close the ledger. The next click into the world captures the mouse again. */
  closeLedger(): void;
}

export interface CursorLease { release(): void; readonly active: boolean }

export interface PlaySettingsReader {
  get<K extends keyof PlaySettings>(key: K): PlaySettings[K];
  subscribe(listener: (settings: Readonly<PlaySettings>) => void): () => void;
}
export interface PlaySettings {
  readonly view: 'third' | 'first';
  readonly sensitivity: number;      // 0.25 .. 4, 1 = default
  readonly invertY: boolean;
  readonly fov: number;              // degrees, 55 .. 90
  readonly volume: { readonly master: number; readonly world: number; readonly voice: number; readonly interface: number }; // 0 .. 1
  readonly labels: 'all' | 'nearby' | 'few';
  readonly bubbles: 'all' | 'nearby' | 'few';
  readonly reducedMotion: boolean;
  readonly keys: Readonly<Record<PlayAction, string>>; // KeyboardEvent.code
}
export type PlayAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'use' | 'view' | 'ledger' | 'fullscreen';

/** A page in the Esc ledger. Shown only while available(ctx) is true; never a disabled stand-in. */
export interface LedgerPageProvider {
  readonly id: string;               // unique: 'look', 'forge', 'raid-gate', 'forged', ...
  readonly title: string;            // the tab's words, sentence case
  readonly order: number;            // play's own pages use 10, 20, ...; others pick values in between
  available(ctx: PlayContext): boolean;
  /** Mount into host, drawn with the @chatdom/ui kit. Return a dispose function. */
  mount(host: HTMLElement, ctx: PlayContext): () => void;
}

/** A small piece on the in-world HUD. Keep the overlay small and quiet (Quality rule 14). */
export interface HudPieceProvider {
  readonly id: string;
  readonly region: 'top-left' | 'top-centre' | 'top-right' | 'bottom-left' | 'bottom-right';
  readonly order: number;
  available(ctx: PlayContext): boolean;
  mount(host: HTMLElement, ctx: PlayContext): () => void;
}

/** A step that runs once on arrival, before the walker takes control (the mirror is the first). */
export interface ArrivalStepProvider {
  readonly id: string;
  readonly order: number;
  wanted(ctx: PlayContext): boolean;
  /** Resolve when done or skipped. The step holds the cursor lease while it runs. */
  run(host: HTMLElement, ctx: PlayContext): Promise<void>;
}

/** forge-wish registers this. The ledger's "The Forge" entry and the anvil both call it. */
export interface ForgeEntry {
  available(ctx: PlayContext): boolean;
  openForge(options: { readonly from: 'ledger' | 'anvil' | 'hud'; readonly ctx: PlayContext }): void;
}

export function registerLedgerPage(provider: LedgerPageProvider): () => void;
export function registerHudPiece(provider: HudPieceProvider): () => void;
export function registerArrivalStep(provider: ArrivalStepProvider): () => void;
export function registerForgeEntry(entry: ForgeEntry): () => void;
```

How another lane mounts its piece:
- Write its provider in its own folder (forge-wish: `apps/web/src/forge/play-slot.ts`; raid-show:
  `apps/web/src/raid-gate/play-slot.ts`), calling the `register*` functions at import.
- Add exactly one line to `apps/web/src/play/providers.ts`: `import '../forge/play-slot';`. That file holds import
  lines only; it is a shared registration file like `main.tsx`.
- The Forge panel takes the cursor with `ctx.requestCursor('forge')` and releases it on close. Esc inside a panel
  closes the panel first.
- Raid pieces use `registerHudPiece` (for example a `top-centre` raid banner) and, for the monarch, a ledger page
  `raid-gate`. Raiders who really walk in arrive as realm walkers and get bodies; play's lights-only rule never hides
  them, and raid-show's own arrival show draws its own figures.

What play guarantees: the ledger opens on Esc, or on the unlock that Esc causes, when walking; it holds pages in
`order`; Esc closes the top panel first, then the ledger; keyboard, mouse and touch all work; the stream view never
shows the ledger or HUD pieces unless a piece asks for `mode === 'stream'`.

### B1a. Additions for gather and pier (landed in `slots.ts`, additive; PL10, 2026-11-01)

Shapes as gather's SEAMS §1 and pier's SEAMS §2 asked, with these decisions:
- `PlayContext.requestInput(reason)`: the newest lease hears keys (physical `code`, down and up, no repeats) and
  captured-mouse movement; the walk is held while any lease lives. Escape is never delivered and, while a lease is
  active, the unlock Escape causes does not open the ledger (the interaction owner stands you up first). Presses of the
  captured mouse arrive through `onPointer(0, 0, buttons)`.
- `PlayContext.hideSelf(reason)`: your body is drawn at opacity 0 for your own camera while any hide lives.
- `registerPlace`: play answers `tavern` and `campfire-seat` interactions with the registered openers (before the
  page's own places) and, while your feet are in one of the place's zones, limits the walk camera (`maxDistance`,
  `tilt` as pitch below the horizon, eased in). `seeThrough` meshes become world boxes: a solid wholly inside one
  never pulls the boom in.
- `HudRegion` gains `bottom-centre`, kept above the phone's thumb band.
- `registerActionBinding`: listed on the controls page; the person's code is stored in `settings.actionKeys[id]`;
  `actionCode(settings, binding)` is the effective code, and play's own keys always win (a clash leaves it unbound).
- `registerHeldTool` / `equipTool(id | null)` / `equippedTool()`: while captured, the primary button goes to the tool
  in hand (`press` / `release`), the secondary to `cancel`; `update(dt)` runs each frame; the tool is paused (and
  `cancel`led) while the ledger, an arrival step or a seated game holds the walk. `ToolContext.room` is the walking
  room's own channel. `ToolContext.hand()` and `observedWalkerHand(id)` are the citizen renderer's right-hand grip
  (`gripRight`). The clock passed to `press` / `release` is the page's `performance.now()`: the realm client has no
  shared room clock today. `holdPose` shows as the extended-arm (pointing) gesture until the body has cast, hold and
  reel poses (an ask of PL11).
- `registerWorldPrompt`: asked five times a second with your pose; the nearest prompt is shown by the HUD with your
  use key, and the use key (or a click with nothing in hand) uses it, unless a realm interaction target is highlighted.

### B1b. Doors into rooms of their own (landed in `play/portal.ts` and `play/portals.ts`, additive; PL10, 2026-11-02)

The tavern is a separate room (gather SEAMS §1). Play confirms gather's descriptor as proposed, with one optional field:

```ts
// apps/web/src/play/portal.ts (types and the state machine) · apps/web/src/play/portals.ts (the page's one transfer)
export interface PortalAnchor { readonly feet: Vec3; readonly yaw: number }
export interface PortalDescriptor { id; kingdomId; sourceRoom: 'kingdom'; destinationRoom: string;   // e.g. 'tavern'
  entryAnchor: PortalAnchor; returnAnchor: PortalAnchor; title?: string }                          // title: curtain words
export interface PortalDestination { room: string; title: string;                                   // gather: 'tavern', 'The tavern'
  mount(host: HTMLElement, visit: PortalVisit): { ready: Promise<void>; dispose(): void | Promise<void> } }
export interface PortalVisit { portal; entry: RealmEntry; endpoint: string; self; readonly active: boolean;
  leave(): void;              // walk back out through the door
  fail(reason: string): void } // the destination cannot go on: play takes you back outside
export function registerPortalDestination(destination: PortalDestination): () => void;
export function registerPortalDoor(portal: PortalDescriptor, options?: { label?: string; reach?: number }): () => void;
export function portalAvailable(portal): boolean; enterPortal(portal); leavePortal(); portalPhase(); onPortalPhase(listener);
```

How gather mounts the tavern (in its own `apps/web/src/tavern/play-slot.ts`, plus one line in `play/providers.ts`):
- `registerPortalDestination({ room: 'tavern', title: 'The tavern', mount(host, visit) { ... } })`. `mount` renders
  `TavernRoomSurface` into `host` (a full-window layer under the curtain) with `open: () => connectTavern(visit.endpoint,
  visit.entry)`. `ready` resolves once the room has placed you (the same barrier `connectTavern` already waits for);
  `dispose` leaves the tavern room: resolve once the room has really let you go (a connection already gone counts),
  reject only while you may still be in it; play awaits it before the kingdom is joined again and, if it fails or stays
  silent past 12 s, strands the curtain and calls `dispose` again on the person's retry. A terminal leave or revoked session calls `visit.fail(reason)`; the surface's exit
  door calls `visit.leave()`. The destination composes play's HUD in its own walk with `createPlaySession` as the
  kingdom walk does.
- `registerPortalDoor(descriptor)` puts "Go into the tavern" by the outside anchor, shown only while the door really
  opens; the use key or a click goes through. Gather builds the descriptor from grand-world's exterior door anchor.

What play guarantees:
- One walker in exactly one room: the source is left (any seat stood up first, pointer lock let go) before the
  destination is mounted, and the destination is disposed before the source is joined again. One journey at a time.
  Each leave is awaited to the end, never raced against the curtain, and the source's `leave` and a destination's
  `dispose` share one rule: resolve once the room has really let you go, reject only while you may still be in it. A
  source leave that fails or stays silent sends you back outside without the tavern, and the way back sees that
  leave through first (it joins one still going, runs a refused one once more at once, then on the person's retry),
  so the kingdom is never joined on top of a connection it may still hold. A leave that went through is never
  repeated. A destination that will not let go strands the curtain with a retry, and a late success goes on by
  itself. A `visit.fail` from inside `mount` is heard at once.
- Entry is reported only after `ready`. A refusal, a 20 s silence or a `fail` puts you back outside the door with one
  calm line on parchment. If the way back is not open, the curtain says so and waits for the person's "Try the door
  again"; it never pretends.
- The session travels, never the ticket: the visit carries the source's `RealmEntry`, so the destination asks for a
  fresh ticket. A visit that has ended can no longer steer the transfer.
- The curtain (`play/hud/portal-curtain.ts`): the street darkens and an arched oak door swings open onto lamplight with
  the room's name in the story face; coming out you step through the light. Wood on the door, two steps over the
  threshold boards, brass on the latch, at the ledger's interface volume. Reduced motion only fades.

What the source must give (the kingdom entry; `KingdomWalkBinding.portal`, optional): `{ entry, endpoint, title,
leave(), rejoin({ portal, anchor }) }`. Without it no door opens. Asked of front-door and of the realm room's owner in
play's progress (`needs:`), because spawning at the return anchor is the room's decision.

### B2. The look (play provides to panel-window, front-door, atlas-map, raid-show, forge-wish)

```ts
// packages/shared/src/look-store.ts (new, additive)
export const LOOK_TOKEN = /^lk\.[a-f0-9]{40}$/;     // also valid: the six starter ids
export const REALM_LOOK_ROUTES = {
  recipe: '/looks/:token',     // GET, public, immutable: { version: 1, token, look: CitizenLook }
  mine: '/looks/me',           // GET and PUT with the signed-in session: { token, look } / { look } -> { ok, token } | { ok: false, reason }
} as const;
```
- The walker's `look` field in the room (`RealmWalkerPresentation.look`, `CitizenLookIdSchema`) carries the token. Its
  shape is unchanged.
- Recipes are parsed with `parseLook` and drawn with `citizenObject` and `createPortraitRenderer` from
  `apps/web/src/avatar-builder` (the same recipe on every surface).
- **The worn twin from the Forge (decision 24).** forge-wish calls the realm look module server-side:
  `grantWardrobePiece({ personId, pieceId, slot: 'hat' | 'held' | 'back' | 'neck' | 'badge', recipe, source: 'forge' })`
  from `apps/realm/src/look/index.ts`. The builder shows granted pieces in a "Yours" tab. Play draws a granted piece
  only once its recipe fits the avatar's sockets; until then it is listed with its forge card and not worn.

## C. Between play's own goals

- **Look library (PL11 provides first, PL10 binds).**
  ```ts
  // apps/web/src/citizens/look-library.ts
  export interface CitizenLookLibrary {
    has(token: string): boolean;                  // ready to draw now
    request(token: string): void;                 // fetch and mesh; never throws for a valid token
    onReady(listener: (token: string) => void): () => void;
  }
  export function sharedCitizenLooks(): CitizenLookLibrary;
  // createCitizenRenderer(scene, { ..., library?: CitizenLookLibrary }) draws any ready token and skips the rest.
  ```
  PL11 lands this in its first checkpoint, serving the six starter looks. PL10 then replaces the
  `looks.some(look => look.id === pose.look)` filters in `walk-scene.ts`, `observed-walkers.ts` and
  `citizen-scene.ts` with `library.has(token)`, plus `library.request(token)` when it is not ready.
- **"Your look" page and the mirror step (PL11 provides, PL10 hosts).** PL11 registers a `LedgerPageProvider` with
  id `look` and an `ArrivalStepProvider` with id `mirror` from `apps/web/src/avatar-builder/play-slot.ts`, and adds
  one line to `play/providers.ts`.
- **Build rack owner name.** PL10 changes the one `ownerName="Juniper"` line in `kingdom/index.tsx` to the walker's
  real approved name. PL11 owns everything inside `build/` and `build-tools/`.
