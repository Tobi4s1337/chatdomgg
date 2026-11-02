import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmPrincipal } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import { castleGateAnchors, castleGateFacing, withMonarchArrival } from './arrival';

const plan = generateSettlementPlan({ seed: 'monarch-gate-arrival', tier: 'hamlet', firstYear: 2025, year: 2026 });
const gate = plan.nodes.find(node => node.id === plan.castle.gateNodeId)!.position;
const kingdomId = KingdomIdSchema.parse('990800001');
/** The actual half-metre ground around the castle gate (the whole kingdom is unrelated to this rule). */
const world = (() => {
  const x = Math.floor(gate[0] * 2) / 2 - 8, z = Math.floor(gate[2] * 2) / 2 - 8;
  const heights = Float32Array.from({ length: 32 * 32 }, (_, i) => foundedGroundAt(plan, x + (i % 32 + .5) * .5, z + (Math.floor(i / 32) + .5) * .5)[1]);
  return compileCollisionWorld({ revision: 1, materials: { materials: [{ id: 0, solid: false }] }, assets: [], placements: [],
    terrain: { origin: [x, -16, z], columns: 32, rows: 32, heights, ceilingY: 496 } });
})();
const context = { world, layoutRevision: plan.revision, writerEpoch: 'epoch-1' };
const snapshot = { ...context, plan };
const principal = (personId: string, origin: 'live' | 'simulated' = 'live'): RealmPrincipal => ({ personId: PersonIdSchema.parse(personId), kingdomId,
  sessionId: `session-${personId}`, expiresAt: Date.now() + 60_000, origin, publicName: 'court_streamer', look: 'reference' });

describe('the monarch arrives at the castle gate', () => {
  it('offers only supported, clear points within 6 m of the gate, facing down into the town', () => {
    const anchors = castleGateAnchors(plan, world);
    expect(anchors.length).toBeGreaterThan(4);
    for (const point of anchors) {
      const body = { x: point[0], y: point[1], z: point[2] };
      expect(embeddedSolids(body, world)).toHaveLength(0);
      expect(supported(body, world)).toBe(true);
      expect(Math.hypot(point[0] - gate[0], point[2] - gate[2])).toBeLessThanOrEqual(6.01);
    }
    const toward = castleGateFacing(plan)!, market = plan.nodes.find(node => node.id === plan.market.nodeId)!.position;
    // The facing point lies between the gate and the market.
    expect(Math.hypot(toward[0] - market[0], toward[1] - market[2])).toBeLessThan(Math.hypot(gate[0] - market[0], gate[2] - market[2]));
  });

  it('places the verified broadcaster at the gate and leaves everyone else to the ordinary entry', async () => {
    const calls: string[] = [];
    const inner = async (who: RealmPrincipal) => { calls.push(who.personId); return null; };
    const prepare = withMonarchArrival(inner, () => snapshot);
    const monarch = await prepare(principal(kingdomId), context);
    expect(monarch?.positions[0]).toEqual(castleGateAnchors(plan, world)[0]);
    expect(monarch?.faceToward).toEqual(castleGateFacing(plan));
    expect(monarch?.current()).toBe(true);
    expect(calls).toEqual([]);
    // A citizen, and a staged sign-in that claims the channel's id, are not the monarch.
    expect(await prepare(principal('990800002'), context)).toBeNull();
    expect(await prepare(principal(kingdomId, 'simulated'), context)).toBeNull();
    expect(calls).toEqual(['990800002', kingdomId]);
  });

  it('never refuses the monarch: a changed geometry falls back to the ordinary entry', async () => {
    const calls: string[] = [];
    const prepare = withMonarchArrival(async who => { calls.push(who.personId); return null; }, () => ({ ...snapshot, writerEpoch: 'epoch-2' }));
    expect(await prepare(principal(kingdomId), context)).toBeNull();
    expect(calls).toEqual([kingdomId]);
  });
});
