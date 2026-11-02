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
   **Written out, ready to apply:** `work/lanes/play/patches/founded-anvil-solid.patch` (applies cleanly on HEAD,
   lane/grand-world and lane/integrator). It puts the solid in the compiler, not in the placements, because every
   placement is drawn as a prop (`kingdom/founded-content.ts`) and a placement would draw a second, plain anvil inside
   the hero. `compileFoundedScene` adds one collision-only asset and placement (`forge:anvil`) of two boxes on the hero's
   0.0625 m lattice (the stone block and the iron up to the 1.43 m face), so the realm and every walking client get the
   same solid. `FOUNDED_PHYSICS_VERSION` gains `/founded-anvil:1`, which changes the geometry digest and so gives a
   new collision revision. The position is restated as `[0, market.elevation, 8]` rather than imported: importing
   `interactions/founded` into the compiler pulled the interaction graph into every compiler user and roughly doubled
   the realm founded tests' time. It also drops the anvil from `ABSENT_PLACE_DEPENDENCIES` (the committed
   `simulated-town.evidence.json` keeps the old line until the artifact is next written) and turns play's
   `it.fails('stops a walker at the anvil')` into `it`. Checked with it applied: solids-old and solids-grand 20 of 20
   on both lands, the world package's founded-world, interactions, land-interface, grand and movement tests 191 of 191,
   realm founded, portals and kingdom-room green run one file at a time (the timeouts seen in parallel runs are the
   host's load: the original compiler times out the same tests at the same load), root tsc and eslint clean.
2. **No silent drops.** A civic or forge fixture that fails to place is a build error with its id and reason, never an
   unchanged town (`enrichNativeForgeHearth`, `enrichNativeForgeWorkshop` and the civic placements).
3. **A quality control.** A typed quality setting on the scene (`'high' | 'balanced' | 'low'`) that play's ledger can
   set. Until it exists the ledger shows no quality setting.

Play's fallbacks until A2 lands, all honest and read-only:
- Feet: a downward ray against the drawn ground meshes (it matches the drawn surface by construction), used only to
  draw the body, eased and clamped to the physics gap.
- Footsteps: paving gives cobble or stone, trails give an earth path, the home's installed floor wins, and other
  public and open ground gives grass.
- Solids: the PL10 collision test keeps the anvil as an expected fail until item 1 lands (the patch above). PL10 is
  ticked under the 13:55 pace rule, with a follow-up to turn the case into an ordinary `it` once the patch is in.

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
leave(), rejoin({ portal, anchor }) }`. Without it no door opens. The live kingdom entry's binding is written out as
`work/lanes/play/patches/kingdom-entry-door.patch` for front-door's scope (see "Asked of front-door" below); until it
lands no door opens in the live kingdom, and every play test of the door runs against its own source.

Coming back outside the door (landed in the realm, additive; PL10, 2026-11-02). The kingdom room decides where you
stand, never the client:
- `RealmJoinSchema` gains an optional `arrive: { portal }` (`packages/shared/src/realm/messages.ts`). The client names
  the door it came back through, nothing else.
- `apps/realm/src/portals/arrivals.ts`: `RealmPortalArrivals` keeps the doors by kind and who left which kingdom when.
  `door(kind, find)` registers a finder for the portal id's first segment (`tavern` for `tavern:<kingdomId>:door`);
  `find({ kingdomId, portal, world })` returns `{ feet, yaw }` (metres, yaw byte, facing out) or null.
  `departed(kingdomId, personId, feet?)` records a departure only with the walker's last server feet, which the room
  reports once it applies `patches/kingdom-room-door-departure.patch` (below): when a person's own walker leaves on
  purpose (Colyseus close 4000, which the client's `room.leave()` sends; not a dropped socket, a second tab replacing
  it or a seat the server ended). A leave reported without feet records nothing and clears any earlier one, so until
  the patch lands every arrival is at the gate. A departure lasts six hours, only the latest one counts, and it is spent by the next door arrival,
  found or not. It opens a door only if those feet stood within 3 m across and 1.6 m up of that door's outside
  (`PORTAL_DEPARTURE_REACH`; the client offers the door within 2.2 m of the same anchor), so walking out anywhere else
  and naming the tavern is the gate. A door of another kingdom, an unknown kind, a finder that throws or
  returns non-finite feet: the gate. `installPortalArrivals(services, arrivals)` / `portalArrivalsFor(services)`.
- `apps/realm/src/kingdom-room.ts` (on HEAD, reviewed): `onJoin` reads `arrive`; a walker not resuming a seat
  stands at the found feet, facing out, only if they are clear and supported in the room's current collision world,
  otherwise at `handle.spawn` as always. `onLeave` reports the person's own walker leaving, without feet.
- **Asked of the realm room's owner, not applied** (review, 2026-11-02: changing `onLeave` is beyond a small additive
  hook): `work/lanes/play/patches/kingdom-room-door-departure.patch` (`git apply --check` clean on HEAD, 4 lines).
  `onLeave` reports a departure only for a consented close (`CloseCode.CONSENTED`, imported from `@colyseus/core`) of
  the person's own current walker, with that walker's feet: `departed(kingdomId, personId, [x, y, z])`. Nothing else
  in the room changes. Without it the door return is inert (always the gate), never wrong.
- `apps/realm/src/main.ts`: `const doors = new RealmPortalArrivals(); installPortalArrivals(boot.services, doors);`.
- Gather's one line in `main.ts`, right after it: `doors.door('tavern', ({ kingdomId, world }) => { const scene =
  boot.loader.current(kingdomId)?.scene, door = scene ? tavernPortalFor(kingdomId, scene, world) : null; return door ?
  door.returnAnchor : null; });` (`tavernPortalFor` from `./games/portal`; `returnAnchor` is already `{ feet, yaw }`).
- Front-door's `rejoin` passes the door through: its `open()` takes an entry whose `ticket()` returns
  `{ ...join, arrive: { portal } }` for that one join (`connectRealm` parses `RealmJoinSchema` and joins with it as it is).
- Checked by `apps/realm/src/portals/arrivals.test.ts` through the real transport: a first walk, another kingdom's
  door, a walk out away from the door or a door whose outside is inside a wall all arrive at the gate. Back through the
  door you stand outside it facing out and others see you there: an expected fail until the room patch lands (checked
  with the patch applied: it passes, so `it.fails` reports it; then make it an ordinary `it`).

### B1c. Walk features (landed in `slots.ts` and `play/features.ts`, additive; PL10, 2026-11-02)

The shape pier's SEAMS §2a asked for, so the pier, the fishing and anything else that lives for the whole walk mounts
without play knowing it:

```ts
// apps/web/src/play/slots.ts
export interface WalkFeatureContext extends Omit<ToolContext, 'holdPose'> {
  selfWalkerId(): string | null;                // the room's id for you; null until the room has placed you
  walkers(): readonly { id; position: Vec3; yaw; self: boolean; name: string }[];  // everyone drawn now, you included
  hour(): number;                               // the kingdom's hour of day, 0–24
  readonly kingdomName: string;
  readonly overlay: HTMLElement;                // a layer of the feature's own, over the world and under the HUD
  audio(): KingdomAudio | null;                 // the kingdom's mixer, null while sound is off or not yet allowed
  onFrame(listener: (dt: number, now: number) => void): () => void;
  // Added by PL11 for the wardrobe at home (optional, additive):
  ownHome?(): OwnHomeInside | null;             // your own home while the room says you are in it, else null
  holdCamera?(reason: string): CameraHold;      // the drawn camera for a moment; your body shows whole while held
}
export interface OwnHomeInside { readonly plotId: string; readonly interior: { min: Vec3; max: Vec3 }; readonly door: Vec3; readonly inside: Vec3; readonly world: CollisionWorld }
export interface CameraHold { set(eye: Vec3, target: Vec3, fov?: number): void; release(): void }
export interface WalkFeatureProvider { readonly id: string; mount(ctx: WalkFeatureContext): () => void }
export function registerWalkFeature(provider: WalkFeatureProvider): () => void;
export function walkFeatures(): readonly WalkFeatureProvider[];
```

Decisions:
- A feature is mounted once the room has placed you (so it never reads an empty room), in id order, and disposed when
  the walk ends, in reverse order. One registered while you walk mounts on the next frame; one unregistered is
  disposed on the next frame. A walk into a door of its own (B1b) ends this walk, so features mount again outside.
- A `mount` that throws, or returns no dispose, is logged and left out; a listener that throws in a frame is logged.
  Neither ever stops the walk or another feature.
- `onFrame` runs once per drawn frame before the render, with seconds since the last frame and the page's
  `performance.now()`. A listener added after the feature's own dispose is ignored.
- `overlay` is one `.pl-features` layer per walk (z 19, under the HUD's z 20, `pointer-events: none`, `aria-hidden`):
  a feature that wants clicks sets `pointer-events: auto` on its own pieces, and its words go in the HUD (world
  prompts, HUD pieces) when they must be read by assistive technology.
- `audio()` follows the same rule as the soul's sound: the kingdom's mixer only while sound is on and the browser
  allows it. `hour()` is the kingdom's own clock; only a host that lends none gets dusk (19.5).
- No `holdPose` here: a held tool (B1a) shows a pose, a walk feature does not.
- `ownHome` (PL11): the walk scene derives it from the founded scene and the collision world it already holds
  (`foundedInstalledHomes` + `homeThreshold` for `connection.ownedPlotId`, once per collision revision); `interior` is
  the zone's box (the whole plot's volume, not the room), `inside` is the door's inside threshold. Null unless the
  room's self state is `interior` on your own plot.
- `holdCamera` (PL11): `set` writes the camera after the walk placed it for this frame (features run after the
  controller), and while any hold is live your own body is drawn at full opacity, even in first person. The holder
  takes an input lease of its own; release gives the camera back on the next frame.

Pier mounts with one line in `play/providers.ts`: `import '../fishing/play-slot';` (pier's own file).

### B1d. The map, the friend authority, the card's forged shelf and the lantern path (landed in `slots.ts` and `host.ts`, additive; PL12, 2026-11-02)

```ts
// apps/web/src/play/slots.ts
/** Which walkers drawn now are your MUTUAL friends (walked together, or both added each other; never a Twitch follow). One may be registered. */
export interface FriendSource { readonly id: string; mutual(walkers: readonly { id: string; name: string }[], ctx: PlayContext): ReadonlySet<string> }
export function registerFriendSource(source: FriendSource): () => void;
/** What the signed-in person forged in this kingdom, from the Forge's own records. One may be registered. */
export interface ForgedThing { readonly id: string; readonly title: string; readonly plaque: string; readonly forgedAt: number; paint?(canvas: HTMLCanvasElement): void }
export interface ForgedSource { readonly id: string; mine(ctx: PlayContext, signal: AbortSignal): Promise<readonly ForgedThing[]> }
export function registerForgedSource(source: ForgedSource): () => void;
// PlayAction gains 'map' (default KeyM): opens the ledger at its map page, only where the walk lends a map.
```

Decisions:
- The map's only people are you and the walkers a registered `FriendSource` names. `play/map/people.ts` (`mapPeople`) is the one door from
  the walkers to the map: the minimap, the big map page and the painter take only what it returns. No source: you alone. A source that
  throws or answers anything but a `Set` shows no one. Names never identify (a stranger who shares your name stays a stranger).
- No realm authority for friendship exists this round, so no one registers a source and no friend positions are shown (a `question:`
  line asks Tobias where mutual friendship lives). When it exists, its lane registers a source with one line in `providers.ts`.
- The card's "Forged by you" shelf shows only while a `ForgedSource` is registered and answers with real pieces. forge-wish's own
  kingdom-wide page (`FORGE_LEDGER_PAGE`, id `forged`, "The forge remembers") is unchanged and registers as any page does.
- The card's facts come from the look module: `GET /api/realm/looks/me?kingdom=<id>` now carries an optional `citizen`
  (`RealmCitizenFactsSchema` in `packages/shared/src/look-store.ts`: the Twitch picture, citizen since = the deed's allocation, homes).
- The walk lends the map through `PlayHost.map()` and the lantern path through `PlayHost.lights` (`host.ts`), built by
  `play/way-home-runtime.ts` from the founded plan (both lands), your plot (`home.owned`) and your feet. The trail is lights and decals
  only (`play/lantern/trail.ts`): no solid, nothing in the collision world.
- The kingdom's Chronicle button (`kingdom.css`, fixed at the top right) steps down under the minimap while the minimap is
  shown: one `body:has(.pl-map-mini)` rule in play's `map/map.css`, so no kingdom file changes. A lane that adds a fixed
  top-right piece outside the HUD regions should do the same or use `registerHudPiece`.
- Mount recipe for the merged build: nothing to mount. The minimap and the map page appear wherever the walk scene runs; the card
  appears for a signed-in walker. The route follows the plan's open streets (`activeStreetIds`), so on the grand land it follows the
  streets grand-world's plan opens.

### Changes play made outside its folder (no round lane owns them; main takes no patches this round)

- `packages/audio` (`types.ts`, `families.ts`): `patches/audio-step-grounds.patch` applied as written. A cue's
  `material` may now be a step ground, and `step:<ground>` families exist for every ground; a ground is accepted only
  for `step`. Backward compatible: every old cue plays as before.
- `apps/web/src/kingdom/sound.ts`: one additive accessor, `audio()`, the kingdom's mixer while it may sound (for
  `WalkFeatureContext.audio`). Nothing else in the file changed.
- `apps/web/src/kingdom/index.tsx`: the walk binding now lends the kingdom's `hour` and `kingdomName` to play.
- `packages/shared/src/realm/messages.ts`, `apps/realm/src/kingdom-room.ts`, `apps/realm/src/main.ts`: the door
  arrival above (an optional join field, the reviewed hunks on HEAD, one composition line). Every join without
  `arrive` behaves exactly as before. The `onLeave` change that binds a return to a leave at the door is asked of the
  room's owner (`patches/kingdom-room-door-departure.patch`), not applied.
- `apps/web/src/citizens/index.ts`: `patches/citizens-gait-ground.patch` applied (play owns `citizens/`; PL11 had not
  started). A sample may carry the drawn `ground` and `floor`, and the standing pose rises by the gait's `lift`.
- **Asked of front-door, not applied** (review, 2026-11-02: `kingdom-entry/**` is front-door's scope, and a finished
  lane does not move it into play's). `work/lanes/play/patches/kingdom-entry-door.patch` (`git apply --check` clean on
  HEAD) touches `kingdom-entry/types.ts`, `live.ts`, `index.tsx`, a new `door-entry.test.ts` (2 cases) and two
  expressions in `apps/web/src/main.tsx`, and makes the kingdom walk a door's source:
  `KingdomEntrySource` takes an optional second argument `arrival: { portal }`, which the first fresh join's ticket
  carries as `arrive` (any later fresh join after a drop is plain). `KingdomEntryConnection` gains optional `entry` and
  `endpoint`; that `entry` reads the session afresh for each ticket, because the session's own entry asks under the
  connection's abort signal, which ends as you go through the door. `KingdomEntry` passes the walk
  `portal: { entry, endpoint, title, leave, rejoin }`: `leave` releases the connection and resolves once the room's
  `onLeave` fires (or its socket is already closed), rejecting after 8 s while it may still be connected; `rejoin`
  opens the kingdom with the door named and rejects with the gate's own words if it does not open. `open()` now
  resolves whether it holds the kingdom; every existing caller ignores that. Sources without doors (simulated,
  spectator) ignore the argument and lend no `entry`, so no door opens there.
- **Composing with gather's own tavern return** (gather's `apps/realm/src/games/return.ts`, on lane/gather): gather
  records a person's tavern session ending and stands their next fresh arrival at the door with no join field; play's
  door arrivals need `arrive` and a consented leave from the kingdom taken at that door. Both give `{ feet, yaw }`
  checked clear and supported. Where both land in `onJoin`, the integration is one expression:
  `const door = resume ? undefined : this.doorArrival(auth, options) ?? tavernReturnsFor(services)?.arrival(auth.kingdomId, auth.personId, this.world, Date.now()) ?? undefined;`
  with `door` used for position and yaw as play's hunk already does. Either alone stands you outside the tavern door.

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
- **Resolving a token on any page.** `sharedCitizenLooks().load(token)` (`apps/web/src/citizens/look-library.ts`)
  answers the recipe for a starter id or a saved token through `GET /api/realm/looks/:token`; pass the recipe, not the
  string, to `paintPortraits`/`createPortraitRenderer`. (citizen-card's `paintPortraits` still maps a string through
  `defaultCitizenRecipe`, which knows only the six starters: a card showing a saved look passes the loaded recipe.)
- **Mount recipe (what the look needs in a merged build).** Realm: migration `0013_realm_citizen_looks.sql`;
  `apps/realm/src/main.ts` creates `createRealmLooks({ pool, origin, verifier, names, scene, publicOrigin, log })`,
  attaches `looks.attach(kingdom)` in the boot's `attach`, and calls `looks.mount(transport.app)`; the authenticator
  reads `realm_citizen_looks` at entry. Gateway: the one `/api/realm/looks/(me|lk.<40 hex>|<starter>)` line in
  `apps/api/src/public/routes.ts`; the web dev and preview proxy: `/api/realm/looks` in `apps/web/vite.config.ts`.
  Web: `import '../avatar-builder/play-slot';` in `play/providers.ts` (the "Your look" ledger page, the mirror on a
  first walk, the wardrobe at home). `/-/avatar-builder` opens the real wardrobe page (signed in: your saved look).
  No land mount: the wardrobe finds its own wall in your own home on any land.

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

## from launch

- needs (2 Nov, LA10 walk): the launch walk lists "walking, the HUD, minimap and lantern path" as a visitor step on
  chatdom.io; the minimap and the lantern path do not exist in the walk yet. That is PL12; the walk marks it handed over.
