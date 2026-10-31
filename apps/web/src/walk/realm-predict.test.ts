// The realm client's movement boundary against the real Colyseus kingdom room, uWS transport and SDK Predict:
// fixed-step staging on slow frames, one jump per press, every PLAYER_FIELDS field agreeing with the room,
// a published collision revision and a room placement. The court and its walkers are the SIMULATED reference.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createNetServer } from 'node:net';
import * as THREE from 'three';
import { PLAYER_FIELDS, RealmJoinSchema, WALK_BODY, type CollisionWorld, type PlayerState, type RealmWalkInput, type SolidBox, type WalkInput } from '@chatdom/shared/realm';
import { REFERENCE_BLOCKS, REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { connectRealm, type RealmClient, type RealmCollision, type RealmWalkerPose } from '../realm/client';
import { createRealmServer } from '../../../realm/src/server';
import { REFERENCE_KINGDOM, referenceServices } from '../../../realm/src/reference';
import type { RealmRoomEffects, RealmRoomServices } from '../../../realm/src/ports';
import { createShoulderRig } from './camera/shoulder';

const worldOf = (revision: number, blocks: readonly SolidBox[]): CollisionWorld => ({
  revision,
  query: bounds => blocks.filter(b => b.min.every((n, axis) => n <= bounds.max[axis]! && b.max[axis]! >= bounds.min[axis]!)),
});
/** Revision 2 publishes a 20 cm wall across the court at x = 4.5, from the floor to 3 m, every z. */
const WALL_X = 4.5;
const REVISION_2 = worldOf(2, [...REFERENCE_BLOCKS, { min: [WALL_X, 0, -18], max: [WALL_X + .2, 3, 18] }]);
const IDLE: WalkInput = { moveX: 0, moveZ: 0, buttons: 0, yaw: 64, collisionRevision: 0 };
const EAST: WalkInput = { moveX: 127, moveZ: 0, buttons: 1, yaw: 64, collisionRevision: 0 };

let effects: RealmRoomEffects | undefined;
let shutdown: (() => Promise<void>) | undefined;
let endpoint = '';
const clients: RealmClient[] = [];
let issue: () => ReturnType<ReturnType<typeof referenceServices>['issue']>;

beforeAll(async () => {
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const base = referenceServices(); issue = () => base.issue();
  // The reference services, with the room's own effects kept so the test can publish and place like an authority.
  const services: RealmRoomServices = { auth: base.auth, open: async id => {
    const handle = await base.open(id);
    return { ...handle, bindRoom: bound => { effects = bound; return handle.bindRoom(bound); } };
  } };
  const { server } = createRealmServer(services);
  shutdown = () => server.gracefullyShutdown(false);
  await server.listen(address.port, '127.0.0.1');
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { for (const client of clients) client.dispose(); await shutdown?.(); });

const entry = (scope: string) => ({ kingdomId: REFERENCE_KINGDOM, resumeScope: scope, ticket: async () => RealmJoinSchema.parse(issue()) });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const authority = (client: RealmClient) => client.room.state.walkers.get(client.selfId)!;
/** What the room itself holds for a walker, read through its bound effects. */
const roomTruth = (client: RealmClient) => effects!.readWalker(client.selfId)!;

/** Every input the client sends, as sent: wraps the room's one input handle. */
function recordSends(client: RealmClient) {
  const handle = client.room.input<RealmWalkInput>({ mode: 'reliable' });
  const sent: RealmWalkInput[] = [];
  const send = handle.send.bind(handle);
  // The input data is a schema instance: its fields are accessors, so copy them by name.
  handle.send = () => { const { moveX, moveZ, buttons, yaw, collisionRevision, placement } = handle.data; sent.push({ moveX, moveZ, buttons, yaw, collisionRevision, placement }); return send(); };
  return { handle, sent };
}

/** Real-time frames `frameMs` apart, as a slow renderer would draw them. */
async function drive(client: RealmClient, ms: number, sample: WalkInput, frameMs: number, each?: (now: number, poses: readonly RealmWalkerPose[]) => void) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const now = performance.now();
    each?.(now, client.tick(now, sample));
    await pause(frameMs);
  }
}
/** Idle frames until the room has acknowledged everything sent and the state has arrived. */
async function settle(client: RealmClient, handle: { lastProcessed: number; sentCount: number }) {
  const end = Date.now() + 8000;
  await drive(client, 400, IDLE, 16);
  while (handle.lastProcessed < handle.sentCount) {
    if (Date.now() > end) throw new Error('The room never acknowledged the inputs');
    client.tick(performance.now(), IDLE); await pause(16);
  }
  // One more patch so the state carrying that acknowledgement is here too.
  await drive(client, 450, IDLE, 16);
}
function expectSameFields(client: RealmClient) {
  const truth = roomTruth(client), local = authority(client);
  for (const field of PLAYER_FIELDS) {
    expect(client.predicted[field], `predicted ${field}`).toBe(truth[field]);
    expect(local[field], `decoded ${field}`).toBe(truth[field]);
  }
}

describe('the realm client predicts with the room', () => {
  let a: RealmClient, b: RealmClient;
  const published = new Set<number>([1]);
  // Until revision 2 is "fetched", this source answers revision 2 with the old world, the bug a careless producer
  // would make; the client must refuse it rather than predict through the new wall.
  const source: RealmCollision = { world: revision => published.has(revision) ? [REFERENCE_WORLD, REVISION_2][revision - 1] ?? null : REFERENCE_WORLD };

  it('cancels a jump sampled before an input takeover when no fixed input was due yet', async () => {
    const client = await connectRealm(endpoint, entry('walk-predict-takeover'), source); clients.push(client);
    const { sent } = recordSends(client);
    const now = performance.now();
    client.tick(now, IDLE);
    client.tick(now + 1, { ...IDLE, buttons: 2 });
    expect(sent).toHaveLength(0);
    client.clearInput();
    await pause(40);
    client.tick(performance.now(), IDLE);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(input => (input.buttons & 2) === 0)).toBe(true);
    client.dispose();
  });

  it('interpolates all twelve rendered samples per 30 Hz fixed step at 360 Hz', async () => {
    const client = await connectRealm(endpoint, entry('walk-predict-high-refresh'), source); clients.push(client);
    const { sent } = recordSends(client);
    const start = performance.now(), frames: number[] = [];
    // Sample the real SDK on an exact high-refresh render clock, with no wall-clock sleeps or competing driver.
    // The reference spawn is on the clear z=7 street. Server transport remains real, but this short synchronous
    // recording isolates fixed-step interpolation from scheduler and patch-arrival timing.
    // End one render sample beyond the eighth exact step boundary: floating-point accumulation may put
    // the boundary infinitesimally before its due send without affecting any rendered increment.
    for (let frame = 0; frame <= 97; frame++) {
      frames.push(client.tick(start + frame * 1000 / 360, { ...EAST, buttons: 0 }).find(p => p.self)!.x);
    }
    expect(sent).toHaveLength(8);
    // After the three acceleration ticks and one interpolation tick, every rendered frame advances by 4/360m,
    // including frames straddling a fixed send. Raw exact prediction would hold eleven frames then jump .133m.
    for (let frame = 50; frame < frames.length; frame++) expect(frames[frame]! - frames[frame - 1]!).toBeCloseTo(4 / 360, 9);
    client.dispose();
  });

  it('keeps the moving camera on SDK render feet through a real acknowledged correction above the fixed-step rate', async () => {
    const client = await connectRealm(endpoint, entry('walk-predict-camera-correction'), source); clients.push(client);
    const { handle } = recordSends(client);
    const rig = createShoulderRig(Math.PI / 2);
    const camera = new THREE.PerspectiveCamera(50, 1440 / 900, .15, 2200);
    const east = { ...EAST, buttons: 0 };
    await drive(client, 350, east, 3);
    // Deliberately perturb only test-local prediction. Subsequent real reliable inputs carry no extra position,
    // so the room's acknowledged state must correct this drift through the production SDK reconciler.
    (client.predicted as PlayerState).x += .24;
    let prior: { now: number; x: number; exact: number; cameraX: number } | undefined;
    let corrected = false, framesBetweenSteps = 0, maxRenderDelta = 0;
    await drive(client, 850, east, 3, (now, poses) => {
      const self = poses.find(p => p.self)!;
      const dt = prior ? (now - prior.now) / 1000 : 0;
      rig.update(dt, Math.PI / 2, self.speed, true);
      rig.apply(camera, [self.x, self.y, self.z], 1440 / 900, null, self.y);
      if (prior) {
        const dx = self.x - prior.x;
        maxRenderDelta = Math.max(maxRenderDelta, Math.abs(dx));
        // Following the same rendered anchor must add neither a 30 Hz hold/jump nor an extra camera spring.
        expect(camera.position.x - prior.cameraX).toBeCloseTo(dx, 10);
        if (client.predicted.x < prior.exact - .08) corrected = true;
        if (client.predicted.x === prior.exact && dt < .02 && dx > 1e-6) framesBetweenSteps++;
        // Frame time accounts for CI scheduler pauses; a .24 m correction must not appear as a one-frame pop.
        expect(Math.abs(dx)).toBeLessThan(4 * dt + .04);
      }
      prior = { now, x: self.x, exact: client.predicted.x, cameraX: camera.position.x };
    });
    expect(corrected).toBe(true);
    expect(framesBetweenSteps).toBeGreaterThan(20);
    expect(maxRenderDelta).toBeLessThan(.24);
    await settle(client, handle);
    expectSameFields(client);
    client.dispose();
  }, 15_000);

  it('stages exactly the due fixed inputs on slow frames, one jump per press, and agrees with the room in every field', async () => {
    a = await connectRealm(endpoint, entry('walk-predict-scope-a'), source); clients.push(a);
    b = await connectRealm(endpoint, entry('walk-predict-scope-b'), REFERENCE_WORLD); clients.push(b);
    const { handle, sent } = recordSends(a);
    const stepMs = handle.stepMs!;
    expect(stepMs).toBeCloseTo(1000 / 30, 6);
    // Predict's own pacing, mirrored: the frame's elapsed time into whole fixed steps, at most five on a hitch.
    let acc = 0, last = -1, expected = 0, slow = 0;
    const counted = (now: number) => {
      acc += last < 0 ? 0 : now - last; last = now;
      let steps = Math.floor(acc / stepMs);
      if (steps > 5) { acc = 0; steps = 5; } else acc -= steps * stepMs;
      expected += steps; if (steps > 1) slow++;
    };
    const start = authority(a).x;
    // Ten-frames-a-second rendering while sprinting east.
    await drive(a, 1200, EAST, 100, counted);
    expect(sent.length).toBe(expected);
    expect(slow).toBeGreaterThan(5);
    expect(sent.every(input => input.collisionRevision === 1)).toBe(true);
    // Space held through a second of slow frames: one jump bit, on the first due input.
    const before = sent.length;
    let takeOffs = 0, wasRising = false;
    await drive(a, 1000, { ...IDLE, buttons: 2 }, 100, now => {
      counted(now);
      const rising = a.predicted.vy > 0; if (rising && !wasRising) takeOffs++; wasRising = rising;
    });
    expect(sent.length).toBe(expected);
    expect(sent.slice(before).filter(input => input.buttons & 2)).toHaveLength(1);
    expect(sent[before]!.buttons & 2).toBe(2);
    expect(takeOffs).toBe(1);
    await settle(a, handle);
    expect(roomTruth(a).x - start).toBeGreaterThan(3);
    expect(roomTruth(a).grounded).toBe(true);
    expectSameFields(a);
    // The other browser's room state holds the same walker where the room put it.
    expect(b.room.state.walkers.get(a.selfId)!.x).toBe(roomTruth(a).x);
  }, 30_000);

  it('holds prediction across a published wall until its own revision arrives, then predicts with it', async () => {
    const { handle } = recordSends(a);
    // Put the walker 3 m short of where the wall will stand, then publish revision 2 with everyone where they are.
    expect(effects!.placeWalker(a.selfId, [WALL_X - 3, 0, 7], 1)).toBe(true);
    await settle(a, handle);
    // The publication also moves this walker back a metre, as a changed solid would: under the placement snap,
    // so only the revision reset keeps it from being glided there.
    const positions = new Map([...a.room.state.walkers].map(([id, p]) => [id, id === a.selfId ? [WALL_X - 4, 0, 7] as const : [p.x, p.y, p.z] as const]));
    effects!.adoptWorld(REVISION_2, 'reference-court-v2', positions);
    const moved: number[] = [];
    await drive(a, 700, IDLE, 16, (_now, poses) => { moved.push(poses.find(p => p.self)!.x); });
    expect(moved.every(x => Math.abs(x - (WALL_X - 3)) < .01 || Math.abs(x - (WALL_X - 4)) < .01)).toBe(true);
    expect(moved.at(-1)).toBeCloseTo(WALL_X - 4, 6);
    const face = WALL_X - WALK_BODY.radius;
    let furthest = -Infinity, held = 0, frames = 0;
    // Sprint at the wall while this client has no revision-2 world: the room alone moves the walker.
    await drive(a, 1500, EAST, 33, () => {
      frames++; if (!a.predicting) held++;
      furthest = Math.max(furthest, a.predicted.x, authority(a).x);
    });
    expect(a.room.state.collisionRevision).toBe(2);
    expect(held).toBeGreaterThan(frames * .8);
    expect(authority(a).collisionRevision).toBe(2);
    expect(furthest).toBeLessThanOrEqual(face + 1e-9);
    expect(authority(a).x).toBeCloseTo(face, 6);
    // The other client never predicted revision 2 either (it only has the court) and still sees the room's walker.
    expect(b.predicting).toBe(false);
    // Now the producer delivers revision 2: prediction resumes on it, against the wall, in step with the room.
    published.add(2);
    let resumed = 0;
    await drive(a, 1200, { ...EAST, moveZ: 60 }, 33, () => {
      if (a.predicting) resumed++;
      furthest = Math.max(furthest, a.predicted.x);
    });
    expect(resumed).toBeGreaterThan(20);
    expect(furthest).toBeLessThanOrEqual(face + 1e-9);
    await settle(a, handle);
    expect(roomTruth(a).z).toBeGreaterThan(9);
    expectSameFields(a);
  }, 30_000);

  it('snaps a short room placement for self and neighbours and fences late pre-placement inputs', async () => {
    const { handle } = recordSends(a);
    const before = WALL_X - .4, after = WALL_X + .6;
    // One metre crosses this thin wall: explicit placement resets cut even below the neighbour threshold.
    expect(effects!.placeWalker(a.selfId, [before, 0, 7], 2)).toBe(true);
    await settle(a, handle);
    await drive(a, 600, IDLE, 16, now => { b.tick(now, IDLE); });
    let from = 0;
    await drive(a, 100, IDLE, 16, (_now, poses) => { from = poses.find(p => p.self)!.x; });
    expect(from).toBeCloseTo(before, 6);
    const oldPlacement = authority(a).placement;
    expect(effects!.placeWalker(a.selfId, [after, 0, 7], 2)).toBe(true);
    const drawn: number[] = [], neighbour: number[] = [];
    await drive(a, 900, IDLE, 16, (now, poses) => {
      drawn.push(poses.find(p => p.self)!.x);
      neighbour.push(b.tick(now, IDLE).find(p => p.id === a.selfId)!.x);
    });
    // Every frame is at the old place or the new one: nothing in between, nothing inside the wall.
    for (const frames of [drawn, neighbour]) {
      expect(frames.every(x => Math.abs(x - from) < .01 || Math.abs(x - after) < .01), JSON.stringify({ observer: frames === drawn ? 'self' : 'neighbour', from, after, frames })).toBe(true);
      expect(frames.at(-1)).toBeCloseTo(after, 6);
    }
    // This packet arrives after the room cleared its queue. A clear alone cannot stop the stale jump/move;
    // waiting for the decoded placement also proves the client won't replay it in the new context.
    Object.assign(handle.data, EAST, { buttons: 2, collisionRevision: 2, placement: oldPlacement }); handle.send();
    await drive(a, 250, IDLE, 16);
    expect(roomTruth(a)).toMatchObject({ x: after, y: 0, grounded: true });
    expect(authority(a).placement).not.toBe(oldPlacement);
    // Turning 64 → 250 → 4 crosses the yaw byte's wrap: each frame is drawn at one heading or the next, never
    // spun the long way round through the bytes between.
    const yaws = new Set<number>(), seen = (_now: number, poses: readonly RealmWalkerPose[]) => { yaws.add(poses.find(p => p.self)!.yaw); };
    await drive(a, 400, { ...IDLE, yaw: 250 }, 16, seen);
    await drive(a, 400, { ...IDLE, yaw: 4 }, 16, seen);
    expect([...yaws].every(yaw => yaw === 64 || yaw === 250 || yaw === 4)).toBe(true);
    expect(yaws.has(250) && yaws.has(4)).toBe(true);
    await settle(a, handle);
    expectSameFields(a);
  }, 30_000);
});
