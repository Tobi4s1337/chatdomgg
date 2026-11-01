export * from './presence';
export * from './presence-slots';
export * from './layout';
export * from './citizens';
export * from './build';
export type * from './kingdom-land';
export { naturalLandHeight, sampleLandWater, waterSurfaceAt, waterKeepOut, foundKingdomGeography, createKingdomCastle,
  reservedByGeography, geographyBounds, LAND_FRAME, KEEP_DOOR_LOCAL_METRES, COURT_ELEVATION, BRIDGE_SPAN, WHEEL_HEAD_METRES,
  type KingdomGeography } from './kingdom-land';
export { foundPlantingZones, CROWN_REACH, TRUNK_CLEARANCE, CLEARING_CROWN_MARGIN, CAMPFIRE_ENVELOPE, CLEARING_GAP,
  LANDMARK_CROWN, type PlantingPlan, type PlantingTown, type PlantingSightline } from './kingdom-land';
export { foundKingdomRoutes, EXPLORE_PACE_MPS, BEAT_SPACING, TRAIL_WIDTH, CROWN_ROAD, PIER_DECK_HEIGHT, OAK_ROOT_CLEARANCE, CLEARING_ROUND, DRESSING_FOOTPRINT, type RouteTown, type KingdomRoutes } from './kingdom-land';
export { foundKingdomTown, TownCapacityError, TOWN_STREETS, LOTS_PER_QUARTER, MARKET_HEART_RADIUS, MARKET_SITE_SIZE, type KingdomTown } from './kingdom-land';
export type { LandformPlan, LegacyLandformPlan, LandformBase, XZ, StreetEdge, PublicGroundSample } from './settlement/types';
export type { CastlePlan, CastleModulePlacement, CardinalTurn, SettlementPlan, SettlementHome } from './settlement/types';
export { transformCardinalPoint, homeFrame, homeOrigin, currentFootprint } from './settlement/geometry';
export { createCastlePlan } from './settlement/castle';

export { generateSettlementPlan } from './settlement/generator';
export { samplePublicGround, settlementTerrainHeight, settlementTerrainWorkspaceBytes, naturalTerrainHeight } from './settlement/terrain';

export * from './citizen-behaviours';
export { homeLifeAnchors, type HomeLifeAnchors } from './home-life';
export type { RealmFoundedBlueprint, RealmFoundedPlacement, RealmFoundedScene } from './founded-world/types';

export { createKingdomLandInterface, type KingdomLandInterface, type LandGroundSource, type LandGroundAt } from './land-interface';

export * from './grand-adoption';
