/**
 * Generated landmark pieces for kingdoms of arbitrary channels: the open-air stage, the standing stones and the bell
 * garden, as pure deterministic factories of `PieceOptions`. Nothing here places, grounds or lights a piece.
 */
export type { GeneratedPiece, PieceColours, PieceOptions } from './types';
export { createOpenAirStage, stageLayout, type StageCanopy, type StageLayout } from './stage/stage';
export { PIECE_KITS, type PieceKit } from './kit';
export { createStandingStones, stonesLayout, type StoneSlot, type StonesLayout } from './stones/stones';
export { createBellGarden, gardenLayout, type GardenLayout } from './bell-garden/garden';
