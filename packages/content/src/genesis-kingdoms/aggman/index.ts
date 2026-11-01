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
export { createLastLantern, type LastLantern } from './light/light';
export { createHarbourInn, HARBOUR_INN_FRONT, INN_SIZE } from './inn/inn';
export { createDrawnUpBoat, createFishCrates, createHarbourCoble, createHarbourLantern, createMooringBollard, createNetRack, createPotStack, createShingleStrand, createSlipwayCapstan } from './harbour/index';
export { createBuntingRun, createFishStall, createHarbourPennant, createQuayBanner } from './colours/index';
export { aggmanApprovedEmotes, loadAggmanEmoteDerivatives, AGGMAN_BROADCASTER, AGGMAN_EMOTE_CHECKS } from './emotes/index';
