import type { Camera, Matrix4, Object3D, Scene } from 'three';
import type { KingdomAudio } from '@chatdom/audio';
import type { KingdomId, Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import type { PlaceOpener } from '../interactions/places/openers';

/**
 * The play HUD's typed slots (work/lanes/play/SEAMS.md, section B). Other lanes register providers here from their
 * own folders and add one import line to `providers.ts`. A page or piece with no provider is simply absent: the
 * ledger never draws a disabled stand-in.
 */

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
  /**
   * Keys and captured-mouse movement go to the lease holder (a seated game); the walk ignores them until release.
   * The mouse stays captured (decision 2). The newest lease hears input; releasing it hands input to the one before.
   */
  requestInput(reason: string): InputLease;
  /** Hide your own body from your own camera (the seated table view). Everyone else still sees you. */
  hideSelf(reason: string): { release(): void };
}

export interface CursorLease { release(): void; readonly active: boolean }

export interface InputLease {
  /** False once released, or while a newer lease holds input. */
  readonly active: boolean;
  /** Physical `KeyboardEvent.code`, pressed or let go. Escape is never delivered: it stands you up first. */
  onKey(listener: (code: string, down: boolean) => void): () => void;
  /** Captured-mouse movement in raw pixels, and the buttons held (`MouseEvent.buttons`) on press and release. */
  onPointer(listener: (dx: number, dy: number, buttons: number) => void): () => void;
  release(): void;
}

/** A place you walk into and sit in (the tavern, the campfire). */
export interface PlaceProvider {
  readonly id: string;
  /** Openers for accepted interactions; play passes them to the walk's interaction places next to bench and forge. */
  readonly openers: { readonly tavern?: PlaceOpener; readonly campfire?: PlaceOpener };
  /** Pure and cheap: the zone a standing body is in. The same function the realm's `zoneOf` uses. */
  zoneOf(feet: Vec3): string | null;
  /** While the local walker is in one of this place's zones: limits for the walk camera, or null for none. */
  camera(zone: string): PlaceCameraHint | null;
}
export interface PlaceCameraHint {
  readonly maxDistance: number;                          // metres behind the head
  readonly tilt: readonly [min: number, max: number];    // radians below the horizon
  /** Meshes the camera's collision ignores (the faded roof and near wall). The place fades them itself. */
  readonly seeThrough: readonly Object3D[];
}

export interface PlaySettingsReader {
  get<K extends keyof PlaySettings>(key: K): PlaySettings[K];
  subscribe(listener: (settings: Readonly<PlaySettings>) => void): () => void;
}
export interface PlaySettings {
  readonly view: 'third' | 'first';
  readonly sensitivity: number;      // 0.25 .. 4, 1 = default
  readonly invertY: boolean;
  /** Horizontal degrees on a landscape screen, 55 .. 90. Portrait screens keep their wider framing in proportion. */
  readonly fov: number;
  readonly volume: { readonly master: number; readonly world: number; readonly voice: number; readonly interface: number }; // 0 .. 1
  readonly labels: 'all' | 'nearby' | 'few';
  readonly bubbles: 'all' | 'nearby' | 'few';
  readonly reducedMotion: boolean;
  readonly keys: Readonly<Record<PlayAction, string>>; // KeyboardEvent.code
  /** The person's own keys for other lanes' bindings (`registerActionBinding`), by binding id. Unset: its default. */
  readonly actionKeys: Readonly<Record<string, string>>;
}
export type PlayAction = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'use' | 'view' | 'ledger' | 'fullscreen' | 'map';

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
export type HudRegion = 'top-left' | 'top-centre' | 'top-right' | 'bottom-left' | 'bottom-centre' | 'bottom-right';
export interface HudPieceProvider {
  readonly id: string;
  /** `bottom-centre` is the hotbar's: it sits above the phone's thumbs, never under them. */
  readonly region: HudRegion;
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

/** A key another lane adds (the bag, the hotbar). Listed and rebindable on the controls page; play's own keys win. */
export interface ActionBinding {
  readonly id: string;                 // 'bag', 'hotbar.1' .. 'hotbar.9'
  readonly label: string;              // 'Open your bag'
  readonly defaultCode: string;        // KeyboardEvent.code: 'KeyB', 'Digit1'
  onPress(ctx: PlayContext): void;
}

/** A tool held in the hand (the rod). Play routes the primary button (and a touch button) to the equipped one. */
export interface HeldToolProvider {
  readonly id: string;
  equip(ctx: ToolContext): HeldToolHandle;
}
export interface HeldToolHandle {
  /** Primary button or touch, down and up, with the room clock's time; play uses those presses for nothing else. */
  press(at: number): void;
  release(at: number): void;
  /** Secondary button: put the tool down or reel in. */
  cancel(): void;
  update(dt: number): void;
  dispose(): void;
}
export interface ToolContext extends PlayContext {
  /** The same retained walking room as movement: its typed message channel, never a second socket. */
  readonly room: { onMessage<T>(type: string, cb: (message: T) => void): () => void; send(type: string, payload: unknown): void };
  /** The walker's own pose, read each frame. `lookUp` is the camera's pitch above the horizon, in radians. */
  pose(): { readonly position: readonly [number, number, number]; readonly yaw: number; readonly lookUp: number; readonly grounded: boolean } | null;
  /** World matrix of the walker's right-hand grip, third or first person; null while not drawn. */
  hand(): Matrix4 | null;
  /** A short pose the body holds while the tool is used. */
  holdPose(pose: 'cast' | 'hold' | 'reel' | null): void;
  /** The scene and camera the tool draws in. */
  readonly scene: Scene;
  readonly camera: Camera;
}

/**
 * A feature that lives for the whole walk of a kingdom (pier's SEAMS 2a): mounted once the room has placed you, disposed
 * as you leave. It reads the room, the scene and the walkers whether or not a tool is in hand.
 */
export interface WalkFeatureContext extends Omit<ToolContext, 'holdPose'> {
  /** Your walker id in the room (its session id), or null before it has placed you. */
  selfWalkerId(): string | null;
  /** Everyone play draws, you included: feet in world metres, yaw in radians (0 faces +Z), approved name. */
  walkers(): readonly { readonly id: string; readonly position: Vec3; readonly yaw: number; readonly self: boolean; readonly name: string }[];
  /** The scene's hour, 0..24. */
  hour(): number;
  /** The kingdom's approved name; empty when it has none. */
  readonly kingdomName: string;
  /** The installed scene this walk stands on, and its collision world for the room's current revision (null while it changes). */
  readonly founded?: RealmFoundedScene;
  world?(): CollisionWorld | null;
  /** A full-window, pointer-transparent layer over the world, under the HUD pieces. */
  readonly overlay: HTMLElement;
  /** The kingdom's own audio, once a gesture has unlocked it and while it may sound; null otherwise. */
  audio(): KingdomAudio | null;
  /** Each drawn frame, before the render: seconds since the last frame, and `performance.now()`. */
  onFrame(listener: (dt: number, now: number) => void): () => void;
  /**
   * Your own home while the room says you are inside it: its plot, the zone's box, its street door and the inside
   * threshold, in world metres, and the collision world it stands in (read only). Null anywhere else, and on a walk that cannot say.
   */
  ownHome?(): OwnHomeInside | null;
  /**
   * Take the drawn camera for a moment (the wardrobe's mirror). While held, `set` places the camera for this frame
   * after the walk has placed it, and your own body is drawn whole even in first person. Walking stays held by
   * whoever holds input; release gives the camera straight back.
   */
  holdCamera?(reason: string): CameraHold;
}
export interface OwnHomeInside {
  readonly plotId: string;
  readonly interior: { readonly min: Vec3; readonly max: Vec3 };
  /** The doorway's look point on the front face. */
  readonly door: Vec3;
  /** Where you stand once through the door: the inside threshold, on the floor. */
  readonly inside: Vec3;
  readonly world: CollisionWorld;
}
export interface CameraHold {
  /** `fov` in degrees (vertical) for this frame only; the walk puts its own back on the next frame. */
  set(eye: Vec3, target: Vec3, fov?: number): void;
  release(): void;
}
export interface WalkFeatureProvider { readonly id: string; mount(ctx: WalkFeatureContext): () => void }

/** A prompt at a place that is not a realm interaction target ("Take a rod", "Read the Almanac"). */
export interface WorldPromptProvider {
  readonly id: string;
  /** Called a few times a second with the walker's pose; return the nearest prompt or null. */
  prompt(pose: { readonly position: readonly [number, number, number]; readonly yaw: number }): { readonly label: string; readonly at: readonly [number, number, number] } | null;
  /** On play's use action, while this prompt is the one shown. */
  use(ctx: PlayContext): void;
}

/** What the walk scene lends the slots about other walkers, while a kingdom is walked. */
export interface ObservedWalkerHands {
  hand(walkerId: string): Matrix4 | null;
  pose(walkerId: string, pose: 'cast' | 'hold' | 'reel' | null): void;
}

type Registry<T extends { readonly id: string; readonly order: number }> = Map<string, T>;
const pages: Registry<LedgerPageProvider> = new Map();
const pieces: Registry<HudPieceProvider> = new Map();
const steps: Registry<ArrivalStepProvider> = new Map();
let forge: ForgeEntry | null = null;
const places = new Map<string, PlaceProvider>();
const actions = new Map<string, ActionBinding>();
const tools = new Map<string, HeldToolProvider>();
const prompts = new Map<string, WorldPromptProvider>();
const features = new Map<string, WalkFeatureProvider>();
let equipped: string | null = null;
let hands: ObservedWalkerHands | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const listener of [...listeners]) listener(); };

function add<T extends { readonly id: string; readonly order: number }>(registry: Registry<T>, kind: string, provider: T): () => void {
  if (!provider || typeof provider.id !== 'string' || !provider.id) throw new Error(`A ${kind} needs an id.`);
  if (!Number.isFinite(provider.order)) throw new Error(`The ${kind} ${provider.id} needs a finite order.`);
  if (registry.has(provider.id)) throw new Error(`The ${kind} ${provider.id} is already registered.`);
  registry.set(provider.id, provider);
  changed();
  return () => { if (registry.get(provider.id) === provider) { registry.delete(provider.id); changed(); } };
}

export function registerLedgerPage(provider: LedgerPageProvider): () => void { return add(pages, 'ledger page', provider); }
export function registerHudPiece(provider: HudPieceProvider): () => void { return add(pieces, 'HUD piece', provider); }
export function registerArrivalStep(provider: ArrivalStepProvider): () => void { return add(steps, 'arrival step', provider); }
export function registerForgeEntry(entry: ForgeEntry): () => void {
  if (forge) throw new Error('The Forge entry is already registered.');
  forge = entry; changed();
  return () => { if (forge === entry) { forge = null; changed(); } };
}

const named = <T extends { readonly id: string }>(registry: Map<string, T>, kind: string, provider: T, check?: (provider: T) => void): () => void => {
  if (!provider || typeof provider.id !== 'string' || !provider.id) throw new Error(`A ${kind} needs an id.`);
  if (registry.has(provider.id)) throw new Error(`The ${kind} ${provider.id} is already registered.`);
  check?.(provider);
  registry.set(provider.id, provider); changed();
  return () => { if (registry.get(provider.id) === provider) { registry.delete(provider.id); changed(); } };
};
const byId = <T extends { readonly id: string }>(registry: Map<string, T>) => [...registry.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function registerActionBinding(binding: ActionBinding): () => void {
  return named(actions, 'key binding', binding, b => { if (typeof b.label !== 'string' || !b.label.trim()) throw new Error(`The key binding ${b.id} needs a label.`); });
}
/** Registered key bindings, by id. The controls page lists them; the session hears them. */
export function actionBindings(): readonly ActionBinding[] { return byId(actions); }

export function registerHeldTool(provider: HeldToolProvider): () => void {
  const unregister = named(tools, 'held tool', provider);
  return () => { if (equipped === provider.id) equipTool(null); unregister(); };
}
export function heldTool(id: string): HeldToolProvider | undefined { return tools.get(id); }
/** Put a tool in the walker's hand, or empty it. An unknown id empties the hand. */
export function equipTool(id: string | null): void {
  const next = id && tools.has(id) ? id : null;
  if (next === equipped) return;
  equipped = next; changed();
}
export function equippedTool(): string | null { return equipped; }

export function registerWorldPrompt(provider: WorldPromptProvider): () => void { return named(prompts, 'world prompt', provider); }
export function worldPrompts(): readonly WorldPromptProvider[] { return byId(prompts); }

/** A feature mounted for every walk while it is registered (one registered while you walk mounts on the next frame). */
export function registerWalkFeature(provider: WalkFeatureProvider): () => void {
  return named(features, 'walk feature', provider, f => { if (typeof f.mount !== 'function') throw new Error(`The walk feature ${f.id} needs a mount.`); });
}
export function walkFeatures(): readonly WalkFeatureProvider[] { return byId(features); }

/** Other walkers' right-hand grips, so their tools can be drawn. Null while no kingdom is walked or they are not drawn. */
export function observedWalkerHand(walkerId: string): Matrix4 | null { return hands?.hand(walkerId) ?? null; }
/** The pose another walker's body holds for their tool, as their tool's messages say. */
export function observedWalkerPose(walkerId: string, pose: 'cast' | 'hold' | 'reel' | null): void { hands?.pose(walkerId, pose); }
/** The walk scene lends its walkers' hands while it lives. */
export function provideObservedWalkerHands(source: ObservedWalkerHands): () => void {
  hands = source;
  return () => { if (hands === source) hands = null; };
}

/** A place's openers and camera limits. Play hands its openers to the walk and asks it for camera limits each frame. */
export function registerPlace(provider: PlaceProvider): () => void { return named(places, 'place', provider); }
/** Registered places, by id. */
export function registeredPlaces(): readonly PlaceProvider[] { return byId(places); }
/** The opener a registered place gives for one kind, or undefined. */
export function placeOpener(kind: 'tavern' | 'campfire'): PlaceOpener | undefined {
  for (const place of registeredPlaces()) { const opener = place.openers[kind]; if (opener) return opener; }
  return undefined;
}
/** The camera limits for feet standing here, or null. A provider that throws is left out. */
export function placeCameraAt(feet: Vec3): PlaceCameraHint | null {
  for (const place of registeredPlaces()) {
    try {
      const zone = place.zoneOf(feet);
      const hint = zone ? place.camera(zone) : null;
      if (hint && Number.isFinite(hint.maxDistance) && hint.maxDistance > 0 && hint.tilt.every(Number.isFinite)) return hint;
    } catch { /* a broken place never steers the camera */ }
  }
  return null;
}

const sorted = <T extends { readonly id: string; readonly order: number }>(registry: Registry<T>) =>
  [...registry.values()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const safely = (check: () => boolean) => { try { return check() === true; } catch { return false; } };

/** Ledger pages to show now, in order. A provider that throws in available() is left out, never half drawn. */
export function availableLedgerPages(ctx: PlayContext): readonly LedgerPageProvider[] {
  return sorted(pages).filter(page => safely(() => page.available(ctx)));
}
/** HUD pieces to show now. The stream view shows a piece only when it asks for `mode === 'stream'` itself. */
export function availableHudPieces(ctx: PlayContext, region?: HudRegion): readonly HudPieceProvider[] {
  return sorted(pieces).filter(piece => (!region || piece.region === region) && safely(() => piece.available(ctx)));
}
export function wantedArrivalSteps(ctx: PlayContext): readonly ArrivalStepProvider[] {
  return sorted(steps).filter(step => safely(() => step.wanted(ctx)));
}
export function forgeEntry(ctx: PlayContext): ForgeEntry | null {
  return forge && safely(() => forge!.available(ctx)) ? forge : null;
}
/**
 * The friend authority (PL12): which walkers drawn now are your mutual friends. A friend is mutual (you both walked
 * together, or both added each other), never made from a Twitch follow. One may be registered; without one the map
 * shows no one but you. `mutual` receives walker ids and names and returns the ids of mutual friends.
 */
export interface FriendSource {
  readonly id: string;
  mutual(walkers: readonly { readonly id: string; readonly name: string }[], ctx: PlayContext): ReadonlySet<string>;
}
let friendSource: FriendSource | null = null;
export function registerFriendSource(source: FriendSource): () => void {
  if (!source || typeof source.id !== 'string' || !source.id || typeof source.mutual !== 'function') throw new Error('A friend source needs an id and mutual().');
  if (friendSource) throw new Error('The friend source is already registered.');
  friendSource = source; changed();
  return () => { if (friendSource === source) { friendSource = null; changed(); } };
}
export function registeredFriendSource(): FriendSource | null { return friendSource; }

/** One thing you forged, as the Forge's own records say (PL12, the card's shelf). */
export interface ForgedThing {
  readonly id: string;
  readonly title: string;
  /** The plaque's words, as forged. */
  readonly plaque: string;
  readonly forgedAt: number;
  /** Paint the piece into a canvas the card gives (square, device pixels set); omitted: the card shows its plaque only. */
  paint?(canvas: HTMLCanvasElement): void;
}
/**
 * The Forge's records of what you forged in this kingdom. forge-wish registers it; the card shows its shelf only
 * while one is registered and it answers with real pieces. `mine` resolves to the signed-in person's own pieces.
 */
export interface ForgedSource {
  readonly id: string;
  mine(ctx: PlayContext, signal: AbortSignal): Promise<readonly ForgedThing[]>;
}
let forgedSource: ForgedSource | null = null;
export function registerForgedSource(source: ForgedSource): () => void {
  if (!source || typeof source.id !== 'string' || !source.id || typeof source.mine !== 'function') throw new Error('A forged source needs an id and mine().');
  if (forgedSource) throw new Error('The forged source is already registered.');
  forgedSource = source; changed();
  return () => { if (forgedSource === source) { forgedSource = null; changed(); } };
}
export function registeredForgedSource(): ForgedSource | null { return forgedSource; }

/** Called after any registration change, so an open ledger can add or drop a tab. */
export function onSlotsChanged(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
