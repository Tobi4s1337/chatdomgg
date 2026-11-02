import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, TavernPortalSchema, type TavernPortal } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { createKingdomAudio } from '@chatdom/audio';
import { TAVERN_INTERIOR_ENTRY, TAVERN_INTERIOR_EXIT } from '../../../../packages/content/src/tavern/portal';
import { followPlayVolume, joinPlayDoors, mountTavernDoor, TAVERN_DOOR_FEATURE, tavernVolume, type PlayDoorKeeper, type TavernDoorWalk } from './play-door';
import type { TavernPortalDescriptor, TavernPortalDestination } from './portal';

const kingdomId = KingdomIdSchema.parse('900000004');
const portalAt = (revision: number): TavernPortal => TavernPortalSchema.parse({ version: 1, id: `tavern:${kingdomId}:door`, kingdomId, sourceRoom: 'kingdom', destinationRoom: 'tavern',
  source: { placement: 'civic:growth:v1:tavern', collisionRevision: revision },
  door: { min: [-4.5, .875, -3.05], max: [-3.5, 2.375, -2.25], through: [0, 1] },
  returnAnchor: { feet: [-4, .875, -3.625], yaw: 128 }, entry: TAVERN_INTERIOR_ENTRY, exit: TAVERN_INTERIOR_EXIT });
const outside: [number, number, number] = [-4, .875, -3.625], onDoor: [number, number, number] = [-4, .875, -2.8], beside: [number, number, number] = [-2.5, .875, -2.8];

function keeper() {
  const doors: TavernPortalDescriptor[] = [], entered: TavernPortalDescriptor[] = [], destinations: TavernPortalDestination[] = [];
  let release: (() => void) | undefined;
  const keeper: PlayDoorKeeper & { doors: typeof doors; entered: typeof entered; destinations: typeof destinations; finish(): void } = {
    doors, entered, destinations,
    registerPortalDestination(destination) { destinations.push(destination); return () => { destinations.splice(destinations.indexOf(destination), 1); }; },
    registerPortalDoor(portal) { doors.push(portal); return () => { doors.splice(doors.indexOf(portal), 1); }; },
    enterPortal(portal) { entered.push(portal); return new Promise<void>(resolve => { release = resolve; }); },
    finish() { release?.(); },
  };
  return keeper;
}

function walk(over: Partial<TavernDoorWalk> = {}) {
  let feet: [number, number, number] | null = outside, revision: number | null = 3;
  const frames = new Set<() => void>();
  const w = {
    kingdomId, self: { personId: 'p' }, mode: 'walking' as const,
    founded: { kingdomId, collisionRevision: 3 } as unknown as RealmFoundedScene,
    world: () => revision === null ? null : { revision } as unknown as CollisionWorld,
    pose: () => feet ? { position: feet } : null,
    onFrame(listener: () => void) { frames.add(listener); return () => { frames.delete(listener); }; },
    ...over,
  };
  return { walk: w as TavernDoorWalk, frames,
    step(at: [number, number, number] | null) { feet = at; for (const frame of [...frames]) frame(); },
    revise(next: number | null) { revision = next; } };
}
const derived = (_k: unknown, scene: RealmFoundedScene, world: CollisionWorld) => portalAt(world.revision);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const destination: TavernPortalDestination = { room: 'tavern', title: 'The tavern', mount: () => ({ ready: Promise.resolve(), dispose: async () => {} }) };

describe('the tavern door joins play by itself', () => {
  it('registers the destination and the door feature, and takes both back', () => {
    const doors = keeper(), features: { id: string }[] = [];
    const off = joinPlayDoors(doors, { registerWalkFeature(provider) { features.push(provider); return () => { features.splice(features.indexOf(provider), 1); }; } },
      { destination });
    expect(doors.destinations.map(d => [d.room, d.title])).toEqual([['tavern', 'The tavern']]);
    expect(features.map(f => f.id)).toEqual([TAVERN_DOOR_FEATURE]);
    off();
    expect(doors.destinations).toEqual([]);
    expect(features).toEqual([]);
  });

  it('offers the door of the walked kingdom and goes in once per crossing', async () => {
    const doors = keeper(), w = walk(), stop = mountTavernDoor(w.walk, doors, derived);
    expect(doors.doors.map(d => [d.id, d.destinationRoom, d.returnAnchor.feet])).toEqual([[`tavern:${kingdomId}:door`, 'tavern', outside]]);
    expect(doors.doors[0]!.returnAnchor.yaw).toBeCloseTo(Math.PI);
    w.step(outside);
    w.step(beside);
    expect(doors.entered).toHaveLength(0);
    w.step(outside);
    w.step(onDoor);
    // Never inside the walk's frame: the journey starts once the frame that saw the crossing has finished.
    expect(doors.entered).toHaveLength(0);
    await settle();
    w.step(onDoor);
    expect(doors.entered).toHaveLength(1);
    // A second crossing while play is still taking you through is not a second journey.
    w.step(outside); w.step(onDoor); await settle();
    expect(doors.entered).toHaveLength(1);
    doors.finish(); await settle();
    w.step(outside); w.step(onDoor); await settle();
    expect(doors.entered).toHaveLength(2);
    stop();
    expect(doors.doors).toEqual([]);
    doors.finish(); await settle();
    w.step(outside); w.step(onDoor); await settle();
    expect(doors.entered).toHaveLength(2);
    expect(w.frames.size).toBe(0);
  });

  it('goes in after the frame that saw the crossing, and not at all once the walk has ended in that frame', async () => {
    const doors = keeper(), w = walk(), stop = mountTavernDoor(w.walk, doors, derived);
    let during = -1;
    w.frames.add(() => { during = doors.entered.length; });
    w.step(outside); w.step(onDoor);
    expect(during).toBe(0);
    await settle();
    expect(doors.entered).toHaveLength(1);
    doors.finish(); await settle();
    // The walk is taken away in the same frame as the crossing: nothing goes in afterwards.
    w.step(outside); w.step(onDoor); stop();
    await settle();
    expect(doors.entered).toHaveLength(1);
  });

  it('never goes in on arriving back outside, or walking in backwards from the room side', () => {
    const doors = keeper(), w = walk(), stop = mountTavernDoor(w.walk, doors, derived);
    w.step(onDoor);
    w.step([-4, .875, -2]);
    w.step(onDoor);
    w.step(outside);
    expect(doors.entered).toHaveLength(0);
    stop();
  });

  it('derives the door again for each collision revision and offers none while the world is not ready', () => {
    const doors = keeper(), w = walk(), seen: number[] = [];
    const stop = mountTavernDoor(w.walk, doors, (k, scene, world) => { seen.push(world.revision); return derived(k, scene, world); });
    w.step(outside); w.step(outside);
    expect(seen).toEqual([3]);
    w.revise(null); w.step(outside);
    expect(doors.doors).toEqual([]);
    w.revise(3); w.step(outside);
    expect(doors.doors).toHaveLength(1);
    expect(seen).toEqual([3, 3]);
    // The walk's founded scene is for revision 3; a newer world without its scene offers no door.
    w.revise(4); w.step(outside); w.step(onDoor);
    expect(doors.doors).toEqual([]);
    expect(doors.entered).toEqual([]);
    expect(seen).toEqual([3, 3]);
    stop();
  });

  it('offers nothing without a walker, a scene, a world, the same kingdom or a derivable door', () => {
    const cases: Partial<TavernDoorWalk>[] = [
      { mode: 'watching' }, { mode: 'stream' }, { self: null }, { founded: undefined as never }, { world: undefined as never },
      { founded: { kingdomId: KingdomIdSchema.parse('900000005'), collisionRevision: 3 } as unknown as RealmFoundedScene },
    ];
    for (const over of cases) {
      const doors = keeper(), w = walk(over);
      const stop = mountTavernDoor(w.walk, doors, derived);
      w.step(outside); w.step(onDoor);
      expect(doors.doors).toEqual([]);
      expect(doors.entered).toEqual([]);
      stop();
    }
    for (const derive of [() => null, () => { throw new Error('stale collision'); }]) {
      const doors = keeper(), w = walk(), stop = mountTavernDoor(w.walk, doors, derive);
      w.step(outside); w.step(onDoor);
      expect(doors.doors).toEqual([]);
      expect(doors.entered).toEqual([]);
      stop();
    }
  });

  it('a refused journey frees the door for the next crossing', async () => {
    const doors = keeper();
    doors.enterPortal = portal => { doors.entered.push(portal); return Promise.reject(new Error('refused')); };
    const w = walk(), stop = mountTavernDoor(w.walk, doors, derived);
    w.step(outside); w.step(onDoor); await settle();
    w.step(outside); w.step(onDoor); await settle();
    expect(doors.entered).toHaveLength(2);
    stop();
  });

  it('keeps its mixer at play\'s world volume', () => {
    expect(tavernVolume({ master: .9, world: .8 })).toBeCloseTo(.72);
    expect(tavernVolume({ master: 2, world: 1 })).toBe(1);
    expect(tavernVolume({ master: Number.NaN, world: 1 })).toBe(0);
    const audio = createKingdomAudio(), listeners = new Set<(s: { volume: { master: number; world: number } }) => void>();
    const stop = followPlayVolume(audio, { current: { volume: { master: 1, world: .5 } }, subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; } });
    expect(audio.getState().settings.volume).toBeCloseTo(.5);
    for (const l of listeners) l({ volume: { master: .5, world: .5 } });
    expect(audio.getState().settings.volume).toBeCloseTo(.25);
    stop();
    expect(listeners.size).toBe(0);
  });
});

/** Play's own door keeper and walk features, where they are part of the build (they are not on the tavern's own branch). */
type RealPortals = PlayDoorKeeper & { portalAvailable(portal: TavernPortalDescriptor): boolean;
  bindPortalSource(source: { kingdomId: typeof kingdomId; entry: never; endpoint: string; self: null; title: string; leave(): Promise<void>; rejoin(): Promise<void> }): () => void };
type RealSlots = { registerWalkFeature(provider: { id: string; mount(walk: TavernDoorWalk): () => void }): () => void;
  walkFeatures(): readonly { id: string; mount(walk: TavernDoorWalk): () => void }[];
  worldPrompts(): readonly { id: string; prompt(pose: { position: readonly [number, number, number]; yaw: number }): { label: string } | null }[] };
// Found on disk at run time, not through a build-time glob: a cached transform must never hide play's files once they land.
const onDisk = <T>(relative: string) => {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return existsSync(path) ? () => import(/* @vite-ignore */ path) as Promise<T> : undefined;
};
const realPortals = onDisk<RealPortals>('../play/portals.ts');
const realSlots = onDisk<RealSlots>('../play/slots.ts');

describe.skipIf(!realPortals || !realSlots)('the tavern door in play\'s own keeper', () => {
  it('registers as a walk feature whose door is play\'s prompt', async () => {
    const portals = await realPortals!(), slots = await realSlots!();
    const off = joinPlayDoors(portals, slots, { destination, derive: derived });
    try {
      const feature = slots.walkFeatures().find(f => f.id === TAVERN_DOOR_FEATURE);
      expect(feature).toBeDefined();
      const w = walk(), stop = feature!.mount({ ...w.walk });
      // Without a bound kingdom source the door does not really open, so play shows no prompt (no dead doors).
      const prompt = slots.worldPrompts().find(p => p.id === `portal:tavern:${kingdomId}:door`);
      expect(prompt).toBeDefined();
      expect(prompt!.prompt({ position: outside, yaw: 0 })).toBeNull();
      // With the kingdom walk bound as the source, the door opens: play's own words by the outside anchor.
      const unbind = portals.bindPortalSource({ kingdomId, entry: undefined as never, endpoint: 'ws://realm', self: null, title: 'The kingdom',
        leave: async () => {}, rejoin: async () => {} });
      expect(prompt!.prompt({ position: outside, yaw: 0 })?.label).toBe('Go into the tavern');
      expect(prompt!.prompt({ position: [outside[0] + 5, outside[1], outside[2]], yaw: 0 })).toBeNull();
      unbind();
      stop();
      expect(slots.worldPrompts().some(p => p.id === `portal:tavern:${kingdomId}:door`)).toBe(false);
    } finally { off(); }
  });
});
