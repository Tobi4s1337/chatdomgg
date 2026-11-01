import { describe, expect, it } from 'vitest';
import { createHearthHome, createStreetProp, MATERIALS } from '@chatdom/content';
import { KingdomIdSchema, PersonIdSchema, type PersonId, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { CollisionWorld, PlayerState, RealmPrincipal, RealmPrivateMessage, RealmReceipt } from '@chatdom/shared/realm';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import type { RealmIntentContext } from '../ports';
import {
  createInteractionRegistry, homeDoorway, homeThreshold, insideHome, interactionTargetId, standingClear, type InteractionRegistry,
} from '../../../../packages/world/src/interactions';
import { homeFrame, homeOrigin } from '@chatdom/world';
import type { RealmOwnedHome } from '@chatdom/shared/realm';
import { createInteractionAuthority, foundedHomeThresholds, ownedHomes } from '.';

/*
 * Two real Hearth cottages side by side on a flat street, compiled by the actual founded collision compiler. The
 * doorway, the inside threshold and the street route all come from the installed shell; the room around the
 * authority (walkers, deeds, home revisions, recovery) is this file's, because that is what the room injects.
 */
const COTTAGE = createHearthHome('cottage', 0);
const DOORWAY = homeDoorway(COTTAGE)!;
const SOLID = COTTAGE.boxes.find(b => b.material !== 0)!.material;
const KINGDOM = KingdomIdSchema.parse('5101');
const PLOTS = { mine: 'plot:hearth:3', next: 'plot:hearth:4' } as const;
const AT = { [PLOTS.mine]: [0, 0, 0], [PLOTS.next]: [10, 0, 0] } as const satisfies Record<string, Vec3>;
const FLAT = { origin: [-40, -16, -40] as const, columns: 200, rows: 200, heights: new Array(200 * 200).fill(0), ceilingY: 80 };
/** Where the movement owner's recovery puts a body in this town: the square, away from both homes. */
const SQUARE: Vec3 = [-12, 0, 20];

/** The shell as an edit leaves it: extra solids in build voxels, written after the shell's own boxes. */
function edited(extra: readonly { from: [number, number, number]; to: [number, number, number] }[]): VoxelBlueprint {
  return { ...COTTAGE, boxes: [...COTTAGE.boxes, ...extra.map(b => ({ ...b, material: SOLID }))] };
}
/** A cupboard pushed against the inside of the door, filling the floor just behind it. */
const CUPBOARD = edited([{ from: [DOORWAY.from[0], DOORWAY.from[1], DOORWAY.from[2] - 12], to: [DOORWAY.to[0], DOORWAY.from[1] + 10, DOORWAY.from[2]] }]);
/** A screen standing in the doorway itself, leaving a gap a body cannot pass. */
const SCREEN = edited([{ from: [DOORWAY.from[0], DOORWAY.from[1], DOORWAY.from[2]], to: [DOORWAY.to[0] - 3, DOORWAY.to[1], DOORWAY.to[2]] }]);
/** A garden wall someone built across the street in front of the home, closing its whole route. */
const STREET_WALL: VoxelBlueprint = { ...COTTAGE, id: 'street-wall', size: [64, 24, 16], boxes: [{ from: [0, 0, 0], to: [64, 24, 16], material: SOLID }] };

function town(options: { readonly recovery?: boolean } = {}) {
  const now = 1_000;
  let revision = 1;
  const shells = new Map<string, VoxelBlueprint>([[PLOTS.mine, COTTAGE], [PLOTS.next, COTTAGE]]);
  const revisions = new Map<string, string>([[PLOTS.mine, 'home-r1'], [PLOTS.next, 'next-r1']]);
  const deeds = new Map<PersonId, string>();
  let walled = false;
  const compile = (): CollisionWorld => compileCollisionWorld({ revision, materials: MATERIALS,
    assets: [...[...shells].map(([plot, blueprint]) => ({ assetHash: `shell:${plot}`, blueprint })), { assetHash: 'street-wall', blueprint: STREET_WALL }],
    placements: [...[...shells.keys()].map(plot => ({ id: plot, assetHash: `shell:${plot}`, position: AT[plot as keyof typeof AT], rotation: 0 })),
      ...(walled ? [{ id: 'wall', assetHash: 'street-wall', position: [0, 0, COTTAGE.size[2] * .125] as Vec3, rotation: 0 }] : [])], terrain: FLAT });
  const build = (world: CollisionWorld): InteractionRegistry => createInteractionRegistry({ layoutRevision: 'founded-1', world, placements: [],
    homes: [...shells].map(([plotId, blueprint]) => homeThreshold({ plotId, revision: revisions.get(plotId)!, blueprint, position: AT[plotId as keyof typeof AT], rotation: 0 }, world)) });
  let world = compile(), registry = build(world);
  const walkers = new Map<string, PlayerState>();
  const walking = new Map<string, boolean>();
  const privates: { personId: string; message: RealmPrivateMessage }[] = [];
  const recovered: string[] = [];
  let crowded = false;
  const authority = createInteractionAuthority({
    writerEpoch: 'epoch-1', clock: () => now, reconnectGraceMs: 20_000, world: () => world, registry: () => registry,
    rights: { current: async () => true, permitted: () => true },
    homes: { ownedPlotId: person => deeds.get(person) ?? null, revisionOf: plot => revisions.get(plot) ?? null },
    recovery: (walkerId, at) => {
      recovered.push(walkerId);
      const walker = walkers.get(walkerId);
      if (options.recovery === false || !walker || at !== world.revision) return false;
      [walker.x, walker.y, walker.z] = SQUARE; return true;
    },
  });
  authority.bindRoom({
    readWalker: id => walkers.get(id) ?? null,
    placeWalker: (id, position, at) => {
      const walker = walkers.get(id);
      if (!walker || crowded || at !== world.revision || !standingClear(world, position)) return false;
      [walker.x, walker.y, walker.z] = position; return true;
    },
    allowWalking: (id, allowed) => { walking.set(id, allowed); },
  });
  authority.bindDelivery({ transient: () => {}, owner: (personId, message) => { privates.push({ personId, message }); } });

  let entries = 0;
  function person(twitch: string, at: Vec3, plot: string | null) {
    const personId = PersonIdSchema.parse(twitch);
    if (plot) deeds.set(personId, plot);
    let principal!: RealmPrincipal, walkerId = '', ids = 0;
    const join = (feet: Vec3) => {
      principal = { personId, kingdomId: KINGDOM, sessionId: `entry-${++entries}`, expiresAt: now + 3_600_000, origin: 'simulated', publicName: `SIMULATED ${twitch}`, look: 'default' };
      walkerId = principal.sessionId; ids = 0;
      walkers.set(walkerId, { x: feet[0], y: feet[1], z: feet[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: world.revision });
      authority.lifecycle('join', principal, walkerId, now);
    };
    join(at);
    const body = () => walkers.get(walkerId)!;
    const feet = (): Vec3 => [body().x, body().y, body().z];
    const context = (): RealmIntentContext => ({ principal, walkerId, position: feet(), collisionRevision: body().collisionRevision, current: () => walkers.get(walkerId) ?? null });
    return {
      personId, feet, get walkerId() { return walkerId; }, get sessionId() { return principal.sessionId; },
      act: (targetId: string, action: 'enter-home' | 'exit-home'): Promise<RealmReceipt> =>
        authority.intent(context(), { version: 1, type: 'interact', id: `r${++ids}`, targetId, action }),
      walk(to: Vec3) { const b = body(); [b.x, b.y, b.z] = to; },
      self: () => authority.selfState(principal.sessionId),
      reload: (to: Vec3) => { authority.lifecycle('drop', principal, walkerId, now); join(to); },
    };
  }
  return {
    authority, person, walking, privates, recovered, deeds, revisions,
    get world() { return world; }, get registry() { return registry; },
    /** An approved edit or furnishing: the room adopts the new geometry, re-places walkers, rebuilds targets. */
    revise(plot: string, shell: VoxelBlueprint, homeRevision: string, street: { readonly walled?: boolean } = {}) {
      shells.set(plot, shell); revisions.set(plot, homeRevision); revision++; walled = !!street.walled;
      world = compile(); registry = build(world);
      for (const walker of walkers.values()) walker.collisionRevision = world.revision;
      authority.adoptRegistry();
    },
    /** The deed's revision moved on before the room adopted the new geometry. */
    stamp(plot: string, homeRevision: string) { revisions.set(plot, homeRevision); },
    /** The room refuses every placement for now (other bodies stand on the threshold). */
    crowd(value: boolean) { crowded = value; },
  };
}

const DOOR = interactionTargetId.homeDoor(PLOTS.mine), EXIT = interactionTargetId.homeExit(PLOTS.mine);
const NEXT_DOOR = interactionTargetId.homeDoor(PLOTS.next);

describe('your doorway leads into your home and back', () => {
  it('lets only the deed’s owner in at the installed revision, keeps walking, and returns them along this home’s route', async () => {
    const t = town();
    const door = t.registry.get(DOOR)!, exit = t.registry.get(EXIT)!, home = t.registry.home(PLOTS.mine)!;
    // Both sides are the shell's own: supported, full-body clear, and connected through the doorway.
    expect(home.blocked).toBeNull();
    expect(door.revision).toBe('home-r1');
    expect(standingClear(t.world, door.rest!)).toBe(true);
    expect(standingClear(t.world, exit.rest!)).toBe(true);
    expect(insideHome(home.interior, door.rest!)).toBe(true);
    expect(insideHome(home.interior, exit.rest!)).toBe(false);

    const you = t.person('5111', door.target.approach, PLOTS.mine);
    const neighbour = t.person('5112', [door.target.approach[0] + .7, door.target.approach[1], door.target.approach[2]], PLOTS.next);
    const stranger = t.person('5113', [door.target.approach[0] - .7, door.target.approach[1], door.target.approach[2]], null);

    // Someone else's door, and a door with no deed behind you, are not doors for you; nothing moves.
    for (const other of [neighbour, stranger]) {
      const before = other.feet();
      expect(await other.act(DOOR, 'enter-home')).toMatchObject({ status: 'refused', message: 'Only the owner of this home can open its door.' });
      expect(other.feet()).toEqual(before);
      expect(other.self().mode).toBe('standing');
    }
    // An exit is only for the person inside: from the street it is not even in your zone.
    expect(await you.act(EXIT, 'exit-home')).toMatchObject({ status: 'refused', message: 'That is not in here with you.' });

    // The deed moved to a new revision the room has not adopted yet: the old door is another room.
    t.stamp(PLOTS.mine, 'home-r2');
    const waiting = you.feet();
    expect(await you.act(DOOR, 'enter-home')).toMatchObject({ status: 'unavailable', message: 'Your home has just changed. Try the door again in a moment.' });
    expect(you.feet()).toEqual(waiting);
    t.revise(PLOTS.mine, COTTAGE, 'home-r2');

    const entered = await you.act(DOOR, 'enter-home');
    expect(entered).toMatchObject({ status: 'applied', state: { mode: 'interior', targetId: DOOR, plotId: PLOTS.mine } });
    expect(you.feet()).toEqual(t.registry.get(DOOR)!.rest);
    // Interior keeps walking; only a seat holds the legs.
    expect(t.walking.get(you.walkerId)).not.toBe(false);
    // The neighbour's door is theirs; from inside your own home it is not even in your zone.
    expect(await you.act(NEXT_DOOR, 'enter-home')).toMatchObject({ status: 'refused' });

    const left = await you.act(EXIT, 'exit-home');
    expect(left).toMatchObject({ status: 'applied', state: { mode: 'standing', targetId: null, plotId: null } });
    // Back on this home's own street threshold: supported, clear, outside, and nearer this door than the next one.
    const out = you.feet(), next = t.registry.get(NEXT_DOOR)!.target.position;
    expect(out).toEqual(t.registry.home(PLOTS.mine)!.route[0]);
    expect(standingClear(t.world, out)).toBe(true);
    expect(insideHome(t.registry.home(PLOTS.mine)!.interior, out) || insideHome(t.registry.home(PLOTS.next)!.interior, out)).toBe(false);
    expect(Math.abs(out[0] - door.target.position[0])).toBeLessThan(Math.abs(out[0] - next[0]));
    expect(t.walking.get(you.walkerId)).not.toBe(false);
  });

  it('blocks an unfit edited room honestly at its door, without moving anyone or cutting the shell', async () => {
    const t = town();
    const you = t.person('5121', t.registry.get(DOOR)!.target.approach, PLOTS.mine);
    for (const [shell, words, blocked] of [
      [CUPBOARD, 'Something stands just inside your door, so there is no room to step in.', 'inside-blocked'],
      [SCREEN, 'Your doorway is blocked, so there is no way in just now.', 'passage-blocked'],
    ] as const) {
      t.revise(PLOTS.mine, shell, `edit-${blocked}`);
      const door = t.registry.get(DOOR)!;
      // The door stays, says why to its owner, and offers no exit into a room nobody can stand in.
      expect(door).toMatchObject({ blocked, rest: null });
      expect(t.registry.get(EXIT)).toBeUndefined();
      const before = you.feet();
      expect(await you.act(DOOR, 'enter-home')).toMatchObject({ status: 'unavailable', message: words });
      expect(you.feet()).toEqual(before);
      expect(you.self().mode).toBe('standing');
    }
    // The shell the registry read is the edited one, never a cut copy: the screen's boxes are all still there.
    expect(SCREEN.boxes.slice(0, COTTAGE.boxes.length)).toEqual(COTTAGE.boxes);
    // A neighbour at that door still learns nothing about the inside.
    const neighbour = t.person('5122', t.registry.get(DOOR)!.target.approach, PLOTS.next);
    expect(await neighbour.act(DOOR, 'enter-home')).toMatchObject({ status: 'refused', message: 'Only the owner of this home can open its door.' });
  });

  it('keeps someone at home through a fitting revision, and puts them out on their own route when an edit closes the way', async () => {
    const t = town();
    const you = t.person('5131', t.registry.get(DOOR)!.target.approach, PLOTS.mine);
    await you.act(DOOR, 'enter-home');
    // A new furnishing elsewhere in the room: still at home, and the exit at the new revision is still safe.
    t.revise(PLOTS.mine, edited([{ from: [6, 2, 20], to: [14, 10, 28] }]), 'home-r2');
    expect(you.self()).toMatchObject({ mode: 'interior', plotId: PLOTS.mine });
    const exitAfter = t.registry.get(EXIT)!;
    expect(exitAfter.revision).toBe('home-r2');
    expect(standingClear(t.world, exitAfter.rest!)).toBe(true);

    // The cupboard goes in behind the door while they stand inside: the room walks them out on this home's route.
    t.privates.length = 0;
    you.walk([4.625, .25, 10]);
    t.revise(PLOTS.mine, CUPBOARD, 'home-r3');
    expect(you.self().mode).toBe('standing');
    expect(you.feet()).toEqual(t.registry.home(PLOTS.mine)!.route[0]);
    expect(t.privates).toContainEqual({ personId: you.personId, message: expect.objectContaining({ type: 'interaction', requestId: null, state: expect.objectContaining({ mode: 'standing' }) }) });
    expect(t.recovered).toEqual([]);

    // With the street side walled off too, only the movement owner's verified recovery can bring them out.
    t.revise(PLOTS.mine, COTTAGE, 'home-r4');
    await you.act(DOOR, 'enter-home');
    expect(you.self().mode).toBe('interior');
    t.revise(PLOTS.mine, CUPBOARD, 'home-r5', { walled: true });
    expect(t.registry.home(PLOTS.mine)).toMatchObject({ blocked: 'street-blocked', route: [], placement: null });
    expect(t.recovered).toEqual([you.walkerId]);
    expect(you.feet()).toEqual(SQUARE);
    expect(you.self().mode).toBe('standing');
  });

  it('never says yes to an exit nobody can stand at', async () => {
    const t = town({ recovery: false });
    const you = t.person('5141', t.registry.get(DOOR)!.target.approach, PLOTS.mine);
    await you.act(DOOR, 'enter-home');
    const inside = you.feet();
    // The room cannot put a body anywhere on the route just now (the threshold is crowded), and recovery has nothing.
    t.crowd(true);
    expect(await you.act(EXIT, 'exit-home')).toMatchObject({ status: 'unavailable', message: 'There is not room to do that safely just now. Nothing has changed.' });
    expect(you.self().mode).toBe('interior');
    expect(you.feet()).toEqual(inside);
    t.crowd(false);
    // A wall across the street side with no recovery: no exit is registered and no landing invented. Still at home,
    // still on a real floor, and the room's own adoption recovery (realm-server) is what is asked next.
    t.revise(PLOTS.mine, COTTAGE, 'home-r2', { walled: true });
    expect(t.registry.home(PLOTS.mine)).toMatchObject({ blocked: 'street-blocked', route: [] });
    expect(t.registry.get(EXIT)).toBeUndefined();
    expect(t.recovered).toEqual([you.walkerId, you.walkerId]);
    expect(you.self().mode).toBe('interior');
    expect(you.feet()).toEqual(inside);
    expect(standingClear(t.world, you.feet())).toBe(true);
  });

  it('treats walking out by the open doorway as the street, and a reload inside as still at home', async () => {
    const t = town();
    const door = t.registry.get(DOOR)!;
    const you = t.person('5151', door.target.approach, PLOTS.mine);
    await you.act(DOOR, 'enter-home');
    // A reload while inside: the room put the new body back in the same home, so it is at home again.
    you.reload(door.rest!);
    expect(you.self()).toMatchObject({ mode: 'interior', plotId: PLOTS.mine });
    // Walking out through the doorway on foot and asking for anything: the room says you are in the street again.
    t.privates.length = 0;
    you.walk(t.registry.home(PLOTS.mine)!.route[1]!);
    expect(await you.act(EXIT, 'exit-home')).toMatchObject({ status: 'refused', message: 'That is not in here with you.' });
    expect(you.self().mode).toBe('standing');
    expect(t.privates[0]).toMatchObject({ message: { type: 'interaction', requestId: null, state: { mode: 'standing' } } });
    // And a reload that lands in the street is in the street.
    await you.act(DOOR, 'enter-home');
    you.reload(t.registry.home(PLOTS.mine)!.route[2]!);
    expect(you.self().mode).toBe('standing');
  });
  it('binds doors to the committed deed and the founded scene: a turned plot, its owner only, its current revision', async () => {
    // A plot facing north (turn 2), its home placed exactly as `assembleFoundedScene` places it, furnished, with a
    // Forge part on the same plot; a native neighbour with no deed; and a deed whose home is not in this scene.
    const plot = { position: [30, 0, 40] as Vec3, rotation: 2 as const }, plotId = 'plot:hearth:7';
    const origin = homeOrigin(plot, COTTAGE.size[2] * .125), { front, outward } = homeFrame(plot);
    const furnished = edited([{ from: [6, 2, 20], to: [14, 10, 28] }]), part = createStreetProp('flower-pot', 'hearth');
    const scene = {
      collisionRevision: 7,
      assets: [{ assetHash: 'home', blueprint: furnished }, { assetHash: 'part', blueprint: part }],
      placements: [
        { id: 'home-7', assetHash: 'home', position: origin, rotation: 2 as const, plotId },
        { id: 'forge:part-1', assetHash: 'part', position: [origin[0] - 2, 0, origin[2] - 1] as Vec3, rotation: 2 as const, plotId },
      ],
    };
    const world = compileCollisionWorld({ revision: 7, materials: MATERIALS, assets: scene.assets, placements: scene.placements, terrain: FLAT });
    const homes = [{ plotId, source: 'owned' as const, revision: 'deed-r9', digest: 'd', attachments: ['part-1'] },
      { plotId: 'plot:hearth:8', source: 'native' as const, attachments: [] }, { plotId: 'plot:hearth:9', source: 'owned' as const, revision: 'r1', attachments: [] }];
    const found = foundedHomeThresholds({ scene, homes }, world);
    expect(found.missing).toEqual(['plot:hearth:9']);
    expect(found.homes.map(h => [h.plotId, h.revision, h.blocked])).toEqual([[plotId, 'deed-r9', null]]);
    expect(() => foundedHomeThresholds({ scene: { ...scene, collisionRevision: 6 }, homes }, world)).toThrow(/collision revision 6/);

    const registry = createInteractionRegistry({ layoutRevision: 'founded-7', world, placements: [], homes: found.homes });
    const door = registry.get(interactionTargetId.homeDoor(plotId))!, exit = registry.get(interactionTargetId.homeExit(plotId))!;
    const out = (p: Vec3) => (p[0] - front[0]) * outward[0] + (p[2] - front[2]) * outward[2];
    // The turned shell's street side is the plot's outward side: you stand in front of the façade and step in behind it.
    expect(out(door.target.approach)).toBeGreaterThan(0);
    expect(out(door.rest!)).toBeLessThan(0);
    expect(exit.rest).toEqual(door.target.approach);
    expect(insideHome(found.homes[0]!.interior, door.rest!)).toBe(true);
    expect(door.revision).toBe('deed-r9');

    // The deed port reads the committed private state: owner by `ownerId`, revision by the plot's home.
    const owner = PersonIdSchema.parse('5161'), stranger = PersonIdSchema.parse('5162');
    let state: { homes: Record<string, RealmOwnedHome> } = { homes: { [plotId]: { id: plotId, ownerId: owner, revision: 'deed-r9' } as RealmOwnedHome } };
    const deeds = ownedHomes(() => state);
    expect([deeds.ownedPlotId(owner), deeds.ownedPlotId(stranger), deeds.revisionOf?.(plotId), deeds.revisionOf?.('plot:hearth:8')]).toEqual([plotId, null, 'deed-r9', null]);

    const walkers = new Map<string, PlayerState>();
    const authority = createInteractionAuthority({ writerEpoch: 'epoch-7', clock: () => 1_000, reconnectGraceMs: 20_000, world: () => world, registry: () => registry,
      rights: { current: async () => true, permitted: () => true }, homes: deeds });
    authority.bindRoom({ readWalker: id => walkers.get(id) ?? null, allowWalking: () => {},
      placeWalker: (id, p, at) => { const w = walkers.get(id); if (!w || at !== world.revision || !standingClear(world, p)) return false; [w.x, w.y, w.z] = p; return true; } });
    const join = (personId: PersonId, sessionId: string): RealmIntentContext => {
      const principal: RealmPrincipal = { personId, kingdomId: KINGDOM, sessionId, expiresAt: 3_600_000, origin: 'simulated', publicName: `SIMULATED ${personId}`, look: 'default' };
      const [x, y, z] = door.target.approach;
      walkers.set(sessionId, { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: world.revision });
      authority.lifecycle('join', principal, sessionId, 1_000);
      const body = () => walkers.get(sessionId)!;
      return { principal, walkerId: sessionId, get position(): Vec3 { return [body().x, body().y, body().z]; }, collisionRevision: world.revision, current: () => body() };
    };
    const yours = join(owner, 'entry-a'), theirs = join(stranger, 'entry-b');
    const ask = (context: RealmIntentContext, id: string) => authority.intent(context, { version: 1, type: 'interact', id, targetId: door.target.id, action: 'enter-home' });
    expect(await ask(theirs, 's1')).toMatchObject({ status: 'refused', message: 'Only the owner of this home can open its door.' });
    // A replaceApproved edit committed after this scene was assembled: the door belongs to the old revision.
    state = { homes: { [plotId]: { ...state.homes[plotId]!, revision: 'deed-r10' } } };
    expect(await ask(yours, 'y1')).toMatchObject({ status: 'unavailable', message: 'Your home has just changed. Try the door again in a moment.' });
    state = { homes: { [plotId]: { ...state.homes[plotId]!, revision: 'deed-r9' } } };
    expect(await ask(yours, 'y2')).toMatchObject({ status: 'applied', state: { mode: 'interior', plotId } });
    expect(walkers.get('entry-a')).toMatchObject({ x: door.rest![0], y: door.rest![1], z: door.rest![2] });
  });
});
