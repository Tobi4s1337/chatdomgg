/**
 * The_AGGman's coastal hamlet: the authored pieces of its harbour precinct and the Genesis adapters its
 * composition reads. Every piece is deterministic, palette-locked and placed by the host on sampled ground.
 */
export { AGGMAN_LIVERY, type AggmanPiece, type Livery } from './piece';
export { createQuaySegment, type QuaySegment, type QuaySegmentSite } from './quay/quay';
export { composeGenesisHeraldry, type GenesisHeraldry } from '../../genesis-heraldry/index';
export { composeGenesisEmoteArt, type GenesisEmoteArt } from '../../genesis-emotes/index';
export { proposeGenesisKeepers, type KeeperProposal } from '../../genesis-keepers/adapter';
export { planKeeperRound, type KeeperFixture, type KeeperPlaceSite, type KeeperRound } from '../../genesis-keepers/routine';
export { keeperRole } from '../../genesis-keepers/roles/index';
export { createRowingBoat, createUpturnedBoat, HULL } from '../../places/water/boats/index';
export { createGaggle, createGoose, createGooseFamily, type GoosePose, type GooseVariant } from './geese/index';
