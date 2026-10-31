import { expect, it } from 'vitest';
import type { CollisionWorld, RealmSeat, SolidBox } from '@chatdom/shared/realm';
import { createInteractionRegistry, interactionTargetId } from '@chatdom/world/interactions';
import type { RealmWalkerPose } from '../realm/client';
import { presentWalkers } from './walker-presentation';
import { createObservedWalkerTrack, walkerSlots, walkerSubject } from './observed-walkers';
import { KingdomIdSchema } from '@chatdom/shared';
import type { CitizenMotionSample } from '@chatdom/world';

it('draws a witnessed sitter at the installed rotated rest, retains safe walking authority and returns on unseat', () => {
  const floor: SolidBox = { min: [-50, -1, -50], max: [50, 0, 50] };
  const world: CollisionWorld = { revision: 3, query: bounds => bounds.min[1] < 0 && bounds.max[1] > -1 ? [floor] : [] };
  const targetId = interactionTargetId.campfireSeat('turned', 'north');
  const registry = createInteractionRegistry({ layoutRevision: 'installed-3', world, placements: [
    { source: 'campfire:turned', origin: [10, 0, 10], turn: 1, cell: 1, anchors: [
      { id: targetId, kind: 'campfire-seat', zone: 'street', position: [0, .4, 1.4], approach: [0, 0, 2],
        rest: [0, 0, 1.4], facing: Math.PI, reach: 1.6 },
      { id: interactionTargetId.anvil('turned'), kind: 'anvil', zone: 'street', position: [2, .6, 0], approach: [2, 0, 1], reach: 2 },
    ] },
  ] });
  expect(registry.disabled).toEqual([]);
  const standing: RealmWalkerPose = { id: 'walker-actual', name: 'Juniper', look: 'dusk', homeSlot: 0,
    x: 12, y: 0, z: 10, yaw: 80, distance: 17, speed: 1, self: true };
  const peer: RealmWalkerPose = { ...standing, id: 'other-walker', homeSlot: 1, self: false };
  const seat: RealmSeat = { targetId, walkerId: standing.id, generation: 4, status: 'occupied' };
  const kingdomId = KingdomIdSchema.parse('129634568');
  const manifest = { kingdomId, origin: 'live' as const, layoutRevision: 'installed-3', collisionRevision: 3 };
  const track = createObservedWalkerTrack(manifest);
  track.receive({ version: 1, ...manifest, writerEpoch: 'writer-1', sampledAt: 1000,
    walkers: [{ ...standing, placement: 0 }, { ...peer, placement: 0 }], seats: [seat] }, 0);
  const presented = presentWalkers(track.sample(0), track.seats, registry);
  expect(presented[0]).toMatchObject({ id: standing.id, x: 11.4, y: 0, z: 10, yaw: 192,
    distance: 17, speed: 0, posture: 'seated' });
  expect(presented[1]).toMatchObject({ id: peer.id, x: 12, speed: 1 });
  expect(standing).toMatchObject({ x: 12, yaw: 80, speed: 1 }); // Prediction/collision feet are untouched.
  const motion: CitizenMotionSample = { slot: 0, publicName: 'Juniper', state: 'walking', position: [20, 0, 20],
    heading: 0, distance: 99, speed: 3, walkPhase: 0, homeLit: true, homeLitAtMs: 0, opacity: 1,
    goalNodeId: 'street:0', goalReached: false };
  expect(walkerSubject(motion, walkerSlots(presented))).toMatchObject({ position: [11.4, 0, 10], speed: 0 });
  // A reconnecting lease may retain the same real body; an absent walker never spawns one.
  expect(presentWalkers([standing], [{ ...seat, status: 'reconnecting' }], registry)[0]?.posture).toBe('seated');
  expect(presentWalkers([], [seat], registry)).toEqual([]);
  for (const invalid of ['fire:missing:seat:north', interactionTargetId.anvil('turned')]) {
    expect(presentWalkers([standing], [{ ...seat, targetId: invalid }], registry)[0]).toBe(standing);
  }
  track.receive({ version: 1, ...manifest, writerEpoch: 'writer-1', sampledAt: 1200,
    walkers: [{ ...standing, placement: 0 }] }, 200); // Rolling old server: absence means no seats.
  expect(presentWalkers(track.sample(200), track.seats, registry)[0]).not.toHaveProperty('posture');
  expect(presentWalkers([standing], [], registry)[0]).toBe(standing);
  track.sample(3000);
  expect(track.seats).toEqual([]);
});
