/**
 * The realm side of the Raid Gate (spec 23 R5, R6, R12): the travel coordinator that moves one person between
 * kingdoms once, or leaves them where they were. Main binds a `RealmTravelTransport` over its rooms and passes the
 * coordinator to `createRaidGateApplication({ ..., travel })`; the coordinator asks the gate's own
 * `createRaidMarchCheck(repository)` who marched.
 */
export { createRaidTravelCoordinator, TRAVEL_LIMITS, type RaidTravelCoordinator } from './coordinator';
export { createMemoryTravelRepository, type MemoryTravelRepository } from './memory-repository';
export type {
  AdmissionOutcome, CommitOutcome, HoldOutcome, PrepareOutcome, RaidTravelDeps, RealmTravelTransport, ReleaseOutcome, TicketStatus, TravelRecovery,
  TravelTicketRef,
} from './ports';
export {
  arrivalIdFor, readArrivalRecord, readTravelRecord, readWhereaboutsRecord,
  type ArrivalRecord, type TravelListing, type TravelRecord, type TravelRelease, type TravelRepository, type TravelRole, type TravelTransaction,
  type WhereaboutsRecord,
} from './records';
