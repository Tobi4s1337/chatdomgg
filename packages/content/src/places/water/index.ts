import type { VoxelBlueprint } from '@chatdom/shared';
import { BRIDGE_BLUEPRINTS } from './bridge/index';
import { FINGERPOST_BLUEPRINTS } from './fingerpost/index';
import { MILL_BLUEPRINTS } from './mill/index';
import { MILLRACE_BLUEPRINTS } from './millrace/index';
import { PIER_BLUEPRINTS } from './pier/index';
import { SHORE_BLUEPRINTS } from './shore/index';

/**
 * The places-water collection: the lake pier, boathouse and boats; the mill, its wheel, wheel pit and weir; the
 * humpback bridge and fingerpost; and the shore's reeds, lilies, pebbles, stones and fishing rock. Every factory
 * takes its site from the caller (the land's sampled heights) and returns a `WaterPiece`: the blueprint and the honest
 * metadata a host mounts it with. `BLUEPRINTS` holds each piece built on its review site, so the validator and
 * renders see every form in every kit. The water's wild creatures are avatar-lattice assets (`createCritter`) and are
 * meshed by the host, so they are exported but are not collection blueprints.
 */
export * from './place-piece';
export * from './pier/index';
export * from './mill/index';
export * from './millrace/index';
export * from './bridge/index';
export * from './fingerpost/index';
export * from './shore/index';
export * from './critters/index';

export const BLUEPRINTS: readonly VoxelBlueprint[] = [
  ...PIER_BLUEPRINTS,
  ...MILL_BLUEPRINTS,
  ...MILLRACE_BLUEPRINTS,
  ...BRIDGE_BLUEPRINTS,
  ...FINGERPOST_BLUEPRINTS,
  ...SHORE_BLUEPRINTS,
];
