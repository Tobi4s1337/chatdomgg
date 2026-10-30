export * from './presence';
export * from './presence-slots';
export * from './layout';
export * from './citizens';
export * from './build';
export type { CastlePlan, CastleModulePlacement, CardinalTurn, SettlementPlan, SettlementHome } from './settlement/types';
export { transformCardinalPoint, homeFrame, homeOrigin, currentFootprint } from './settlement/geometry';
export { createCastlePlan } from './settlement/castle';

export { generateSettlementPlan } from './settlement/generator';
export { samplePublicGround, settlementTerrainHeight, settlementTerrainWorkspaceBytes, naturalTerrainHeight } from './settlement/terrain';
