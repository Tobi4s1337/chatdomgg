// Pure interaction law shared by the room (authority) and the browser (hints only). No DOM, render, clock,
// transport, random source or authority lookup: explicit snapshots in, typed decisions out.
export { ACTION_FOR_KIND, INTERACTION_KINDS, PLOT_KINDS, SEAT_KINDS, interactionTargetId, kindOfTargetId, plotOfTargetId, type InteractionKind, type InteractionUse } from './ids';
export { INTERACTION_EYE, SUPPORT_GAP, bodyBox, bodyClear, eyeOf, finiteVec3, horizontalDistance, segmentClear, standingClear, supported, withinReach } from './geometry';
export { CELL_METRES, MAX_REACH, STREET_ZONE, createInteractionRegistry, homeZone, placeAnchorPoint, placeHeading, type DisabledReason, type InteractionAnchor, type InteractionPlacement, type InteractionRecord, type InteractionRegistry } from './registry';
export { STANDING, interactionLegality, legalInteractionActions, refusalFor, type InteractionActor, type InteractionBlock, type InteractionLegality } from './legal';
export { createFoundedInteractionRegistry, foundedAnvilPosition } from './founded';
export { CONNECTED, claimSeat, createSeatBook, dropSession, endSeat, expireSeats, publicSeats, reconnectSession, releasePerson, releaseSession, releaseTargets, resumeSeat, seatAt, seatOfPerson, seatOfSession, standSeat, type SeatBook, type SeatClaim, type SeatClaimResult } from './seats';
export type { InteractionLawRecord } from './legal';
export { foundedInstalledHomes, homeDoorway, homeThreshold, insideHome, interactionZone, passageClear, settleOnFloor, type HomeBlock, type HomeThreshold, type InstalledHome } from './homes';

export { createFoundedInteractionRegistry, foundedAnvilPosition } from './founded';
