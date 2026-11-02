import type { KingdomAudio } from '@chatdom/audio';
import type { KingdomId, TavernPortal } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { tavernPortalDescriptor, tavernPortalFor, watchTavernDoor, type TavernPortalDescriptor, type TavernPortalDestination } from './portal';

/**
 * The tavern joins play's door keeper by itself (SEAMS.md §1): play's `providers.ts` imports `./register` once, and
 * this registers the destination and a walk feature that finds the door of the kingdom being walked. The shapes are
 * the structural part of play's `play/portals.ts` and `play/slots.ts` (B1b, B1c), so either branch builds alone.
 */
export interface PlayDoorKeeper {
  registerPortalDestination(destination: TavernPortalDestination): () => void;
  registerPortalDoor(portal: TavernPortalDescriptor, options?: { readonly label?: string; readonly reach?: number }): () => void;
  enterPortal(portal: TavernPortalDescriptor): Promise<unknown>;
}

/** What the door needs of a walk (play's `WalkFeatureContext`). */
export interface TavernDoorWalk {
  readonly kingdomId: KingdomId;
  readonly self: unknown;
  readonly mode: 'walking' | 'watching' | 'stream';
  /** The walker's predicted feet each frame, or null while not placed. */
  pose(): { readonly position: readonly [number, number, number] } | null;
  onFrame(listener: (dt: number, now: number) => void): () => void;
  /**
   * The installed scene and the collision world the walk stands on. Asked of play (SEAMS.md §1): without them no
   * door is offered, never a guessed one.
   */
  readonly founded?: RealmFoundedScene;
  world?(): CollisionWorld | null;
}

export interface PlayWalkFeatures {
  registerWalkFeature(provider: { readonly id: string; mount(walk: TavernDoorWalk): () => void }): () => void;
}

export interface PlayDoorOptions {
  /** The room behind the door: `createTavernDestination(...)` from `./play-slot`. */
  readonly destination: TavernPortalDestination;
  /** The derivation; the installed blueprint's own carve and exact collision by default. */
  readonly derive?: (kingdomId: KingdomId, scene: RealmFoundedScene, world: CollisionWorld) => TavernPortal | null;
}

export const TAVERN_DOOR_FEATURE = 'tavern-door';

/**
 * One kingdom walk's tavern door. The door is derived once per collision revision; a revision with no door (no
 * tavern yet, a blocked forecourt, a stale scene) offers nothing. Play's prompt is the way in by click or use key;
 * walking through the doorway goes in as well, once per crossing, never on arriving back outside.
 */
export function mountTavernDoor(walk: TavernDoorWalk, doors: PlayDoorKeeper, derive: NonNullable<PlayDoorOptions['derive']> = tavernPortalFor): () => void {
  const { founded } = walk;
  if (walk.mode !== 'walking' || !walk.self || !founded || !walk.world || founded.kingdomId !== walk.kingdomId) return () => {};
  const currentWorld = walk.world.bind(walk);
  let revision: number | null = null, closeDoor: (() => void) | undefined, watch: ((feet: readonly [number, number, number]) => void) | undefined;
  let going = false, ended = false;
  const close = () => { closeDoor?.(); closeDoor = undefined; watch = undefined; };
  const find = () => {
    const world = currentWorld();
    if (!world) { close(); revision = null; return; }
    if (world.revision === revision) return;
    close();
    revision = world.revision;
    let portal: TavernPortal | null;
    try { portal = founded.collisionRevision === world.revision ? derive(walk.kingdomId, founded, world) : null; }
    catch { portal = null; }
    if (!portal) return;
    const descriptor = tavernPortalDescriptor(portal);
    closeDoor = doors.registerPortalDoor(descriptor);
    watch = watchTavernDoor(portal, () => {
      if (going || ended) return;
      going = true;
      void doors.enterPortal(descriptor).catch(() => undefined).finally(() => { going = false; });
    });
  };
  find();
  const stopFrames = walk.onFrame(() => {
    if (ended) return;
    find();
    const feet = watch && walk.pose()?.position;
    if (feet) watch!(feet);
  });
  return () => { ended = true; stopFrames(); close(); };
}

/** Registers the tavern with play's door keeper and walk features. Returns the unregister. */
export function joinPlayDoors(doors: PlayDoorKeeper, features: PlayWalkFeatures, options: PlayDoorOptions): () => void {
  const offDestination = doors.registerPortalDestination(options.destination);
  const offFeature = features.registerWalkFeature({ id: TAVERN_DOOR_FEATURE, mount: walk => mountTavernDoor(walk, doors, options.derive) });
  return () => { offFeature(); offDestination(); };
}

/** Play's per-device volumes, as far as the tavern hears them: its sounds are world sounds. */
export interface PlayVolumes { readonly master: number; readonly world: number }
export function tavernVolume(volume: PlayVolumes): number {
  const level = volume.master * volume.world;
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

/** Keeps a retained mixer at play's world volume for as long as the page lives. */
export function followPlayVolume(audio: KingdomAudio, settings: { readonly current: { readonly volume: PlayVolumes }; subscribe(listener: (settings: { readonly volume: PlayVolumes }) => void): () => void }): () => void {
  audio.setSettings({ volume: tavernVolume(settings.current.volume) });
  return settings.subscribe(next => audio.setSettings({ volume: tavernVolume(next.volume) }));
}
