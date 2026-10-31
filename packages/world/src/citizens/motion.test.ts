import { expect, it } from 'vitest';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { generateSettlementPlan } from '../settlement/generator';
import { homeFrame, rectangleDistance } from '../settlement/geometry';
import { terrainHeight } from '../layout';
import { createCitizenMotion } from './motion';
import { REALM_CASTLE_SLOT } from '@chatdom/shared/realm';

it('brings an observed monarch to the installed castle gate without creating a street plot', () => {
  const plan = generateSettlementPlan({ seed: 'SIMULATED-royal-homecoming', tier: 'hamlet', firstYear: 2026, year: 2026 });
  const homes = plan.homes, start = 1_800_000_000_000;
  const frame: KingdomPresenceFrame = { version: 1, kingdomId: KingdomIdSchema.parse('1'), epoch: 'SIMULATED-castle',
    origin: 'simulated', sequence: 1, asOf: start, streamLive: false, connection: 'offline',
    windows: [{ slot: REALM_CASTLE_SLOT, present: true, publicName: 'SIMULATED Monarch', since: start }] };
  const absent = createCitizenMotion(plan); absent.applyFrame(frame); expect(absent.sample(start)).toEqual([]);
  const motion = createCitizenMotion(plan, { castleHome: true, entryDistance: 18, speed: 1.2 });
  motion.applyFrame(frame);
  const route = motion.routeForSlot(REALM_CASTLE_SLOT)!;
  expect(route.streetIds).toContain('road:castle');
  expect(route.streetIds.every(id => plan.activeStreetIds.includes(id))).toBe(true);
  expect(motion.sample(start + 3_000)).toMatchObject([{ slot: REALM_CASTLE_SLOT, state: 'walking', homeLit: false }]);
  const arrived = motion.sample(start + 30_000)[0]!;
  expect(arrived).toMatchObject({ publicName: 'SIMULATED Monarch', state: 'home', homeLit: true });
  const gate = plan.nodes.find(node => node.id === plan.castle.gateNodeId)!;
  expect(Math.hypot(arrived.position[0] - gate.position[0], arrived.position[2] - gate.position[2])).toBeCloseTo(.55);
  expect(plan.homes).toBe(homes); expect(homes.some(home => home.slot === REALM_CASTLE_SLOT)).toBe(false);
  const destinations = motion.destinationsForSlot(REALM_CASTLE_SLOT);
  expect(destinations.filter(destination => destination.nodeId === gate.id)).toHaveLength(1);
  expect(motion.requestGoal({ slot: REALM_CASTLE_SLOT, nodeId: plan.market.nodeId, startAtMs: start + 31_000 })).toEqual({ accepted: true });
  motion.applyFrame({ ...frame, sequence: 2, asOf: start + 32_000, windows: [] });
  expect(motion.sample(start + 32_001)).toEqual([]); // Offline expiry hides immediately, not a fabricated departure.
});

it('walks the actual 240-home town, arrives at owned windows, and seeks or leaves without cutting plots', () => {
  const plan = generateSettlementPlan({ seed: 'lanternmere', tier: 'town', firstYear: 2022, year: 2026 });
  const motion = createCitizenMotion(plan), start = 1_800_000_000_000;
  const frame: KingdomPresenceFrame = { version: 1, kingdomId: KingdomIdSchema.parse('1'), epoch: 'simulated:citizens',
    sequence: 1, asOf: start, origin: 'simulated', streamLive: true, connection: 'fresh',
    windows: plan.homes.map((home, i) => ({ slot: home.slot, present: true, publicName: i ? null : 'SIMULATED Juniper', since: start })) };
  expect(motion.applyFrame(frame)).toBe(true);
  expect(motion.applyFrame(frame)).toBe(false);
  expect(motion.sample(start - 1)).toEqual([]);
  const halfway = motion.sample(start + 6_000);
  expect(halfway).toHaveLength(240);
  expect(halfway.every(person => person.state === 'walking' && person.speed > 0 && !person.homeLit)).toBe(true);
  expect(halfway.every(person => person.homeLitAtMs === null)).toBe(true);

  for (const home of plan.homes) {
    const route = motion.routeForSlot(home.slot)!;
    expect(route.streetIds.at(-1)).toBe(home.approachId);
    expect(route.streetIds.every(id => plan.activeStreetIds.includes(id))).toBe(true);
    const { front, outward } = homeFrame(home), destination = route.points.at(-1)!;
    expect(destination[0]).toBeCloseTo(front[0] + outward[0] * .55, 6);
    expect(destination[2]).toBeCloseTo(front[2] + outward[2] * .55, 6);
  }
  // Cross the winding lanes and graded slopes at arbitrary clock offsets. This
  // also checks interpolation between the precomputed terrain triangle splits.
  for (const seconds of [0, 2.137, 6.439, 11.193, 17.771, 26.331, 45]) {
    for (const person of motion.sample(start + seconds * 1000)) {
      const [x, y, z] = person.position;
      expect(y).toBeCloseTo(terrainHeight(plan, x, z), 6);
      expect(plan.reservations.every(plot => rectangleDistance(plot.lot, x, z) >= .279)).toBe(true);
      expect(person.walkPhase).toBeCloseTo((person.distance / .75) % 1, 10);
    }
  }
  expect(motion.sample(start + 6_000)).toEqual(halfway);
  const home = motion.sample(start + 45_000);
  expect(home.every(person => person.homeLit && person.state === 'home' && person.speed === 0)).toBe(true);
  expect(home.every(person => person.homeLitAtMs !== null && person.homeLitAtMs > start && person.homeLitAtMs <= start + 45_000)).toBe(true);

  const first = home[0]!, destinations = motion.destinationsForSlot(first.slot);
  expect(motion.sample(first.homeLitAtMs! - 1)[0]!.homeLitAtMs).toBeNull();
  expect(motion.sample(first.homeLitAtMs! + 1)[0]!.homeLitAtMs).toBe(first.homeLitAtMs);
  const ownDoor = destinations.find(destination => destination.kind === 'home')!;
  expect(destinations.some(destination => destination.nodeId === plan.market.nodeId && destination.kind === 'market')).toBe(true);
  expect(motion.requestGoal({ slot: first.slot, nodeId: `${plan.homes[1]!.id}:front`, startAtMs: start + 45_000 }))
    .toEqual({ accepted: false, reason: 'unknown-destination' });
  expect(motion.requestGoal({ slot: first.slot, nodeId: plan.market.nodeId, startAtMs: start + 45_000 })).toEqual({ accepted: true });
  const turning = motion.sample(start + 45_000)[0]!;
  expect(turning.position).toEqual(first.position);
  expect(turning.distance).toBe(first.distance);
  expect(turning.heading).toBeCloseTo(first.heading, 10);
  expect(turning.homeLit).toBe(true);
  expect(turning.homeLitAtMs).toBe(first.homeLitAtMs);
  for (const seconds of [48.137, 55.349, 70.839, 95.613, 140.331, 230.191]) {
    const person = motion.sample(start + seconds * 1000)[0]!, [x, y, z] = person.position;
    expect(plan.reservations.every(plot => rectangleDistance(plot.lot, x, z) >= .279)).toBe(true);
    expect(y).toBeCloseTo(terrainHeight(plan, x, z), 6);
    expect(person.homeLit).toBe(true);
    expect(person.homeLitAtMs).toBe(first.homeLitAtMs);
  }
  expect(motion.sample(start + 500_000)[0]).toMatchObject({ state: 'idle', goalReached: true, goalNodeId: plan.market.nodeId, homeLit: true });
  expect(motion.requestGoal({ slot: first.slot, nodeId: ownDoor.nodeId, startAtMs: start + 500_000 })).toEqual({ accepted: true });
  expect(motion.sample(start + 1_000_000)[0]).toMatchObject({ state: 'home', goalReached: true, goalNodeId: ownDoor.nodeId, homeLit: true });
  expect(motion.sample(start + 1_000_000)[0]!.position).toEqual(first.position);
  expect(motion.sample(start + 1_000_000)[0]!.homeLitAtMs).toBe(first.homeLitAtMs);
  expect(motion.requestGoal({ slot: first.slot, nodeId: ownDoor.nodeId, startAtMs: start + 499_999 }))
    .toEqual({ accepted: false, reason: 'out-of-order' });

  const second = halfway[1]!, secondDoor = motion.destinationsForSlot(second.slot).find(destination => destination.kind === 'home')!;
  expect(motion.requestGoal({ slot: second.slot, nodeId: plan.market.nodeId, startAtMs: start + 6_000 })).toEqual({ accepted: true });
  expect(motion.sample(start + 6_000)[1]!.position).toEqual(second.position);
  expect(motion.sample(start + 6_000)[1]!.homeLit).toBe(false);
  const redirectFrom = motion.sample(start + 8_000)[1]!;
  expect(motion.requestGoal({ slot: second.slot, nodeId: secondDoor.nodeId, startAtMs: start + 8_000 })).toEqual({ accepted: true });
  motion.sample(start + 8_000)[1]!.position.forEach((value, axis) => expect(value).toBeCloseTo(redirectFrom.position[axis]!, 10));
  expect(motion.sample(start + 500_000)[1]).toMatchObject({ state: 'home', homeLit: true });

  const departed = { ...frame, sequence: 2, asOf: start + 7_000,
    windows: frame.windows.map(window => ({ ...window, present: false, publicName: null })) };
  motion.applyFrame(departed);
  expect(motion.requestGoal({ slot: first.slot, nodeId: ownDoor.nodeId, startAtMs: start + 10_000 }))
    .toEqual({ accepted: false, reason: 'absent' });
  const leave = motion.sample(start + 7_500);
  expect(leave.every(person => person.state === 'leaving' && !person.homeLit && person.publicName === null)).toBe(true);
  expect(leave.every(person => person.homeLitAtMs === null)).toBe(true);
  expect(leave[0]!.distance).toBeGreaterThan(halfway[0]!.distance);
  expect(motion.sample(start + 45_000)).toEqual([]);
  motion.applyFrame({ ...frame, sequence: 3 }); // Backward replay reconstructs the same walk.
  expect(motion.sample(start + 6_000)).toEqual(halfway);
  motion.applyFrame({ ...departed, sequence: 4, streamLive: false, connection: 'stale' });
  expect(motion.sample(start + 7_000)).toEqual([]);
  motion.clear(); expect(motion.sample(start + 6_000)).toEqual([]);
}, 30_000);
