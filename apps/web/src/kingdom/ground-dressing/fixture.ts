import { generateSettlementPlan, type KingdomLand, type KingdomTier, type SettlementPlan, type WaterBody } from '@chatdom/world';

/**
 * SIMULATED land for the isolated bench and tests only. Kingdom-land (spec 27) has not delivered its generator, so
 * this wraps the real generated settlement plan in the frozen `KingdomLand` type with the one lake that plan already
 * has. It invents no woods, sites or trails: those zones stay empty, which plants no landscape trees. Production
 * never imports this module; the integrator supplies the actual land.
 */
export const SIMULATED_LAND = 'SIMULATED land · bench fixture · not the kingdom-land generator';

export function simulatedLand(options: { seed: string; tier: KingdomTier; firstYear?: number; year?: number }): KingdomLand {
  const plan: SettlementPlan = generateSettlementPlan({ seed: options.seed, tier: options.tier,
    firstYear: options.firstYear ?? (options.tier === 'hamlet' ? 2025 : 2022), year: options.year ?? 2026 });
  const lake = plan.lake;
  const water: WaterBody = { id: 'lake', x: lake.x, z: lake.z, radiusX: lake.radiusX, radiusZ: lake.radiusZ, level: lake.level, depth: 2.8 };
  const landform = { ...plan.landform, version: 2 as const, hills: [], waters: [water], streams: [] };
  const market = plan.nodes.find(node => node.id === plan.market.nodeId)!.position;
  return {
    version: 1, plan: { ...plan, landform }, sites: [],
    places: {
      court: { boundary: plan.castle.court.boundary, elevation: plan.castle.court.elevation, keepDoor: plan.castle.centre,
        gate: plan.nodes.find(node => node.id === plan.castle.gateNodeId)!.position, parapet: [] },
      lookout: { summit: [plan.landform.ridge.origin[0], 0, plan.landform.ridge.origin[1]], viewBearing: 0, trail: [] },
      forest: { oak: market, entryBearing: 0, path: [], clearing: { centre: market, radius: 9.6, gapBearing: 0 }, treeline: [] },
    },
    waters: [water], treeZones: [], landmarks: [], dressings: [], paths: [], views: [],
  };
}

/** Bench-only water query over the fixture's lake ellipse, the same shape the scene keeps trees out of. */
export function simulatedWaterKeepOut(land: KingdomLand): (x: number, z: number, margin: number) => boolean {
  return (x, z, margin) => land.waters.some(w => Math.hypot((x - w.x) / (w.radiusX + margin), (z - w.z) / (w.radiusZ + margin)) < 1.19);
}
