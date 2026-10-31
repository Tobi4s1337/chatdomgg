/**
 * The Raid Gate server application (spec 23). Main mounts `handle` behind its authenticated router and binds the
 * ports in `ports.ts`; the browser imports `contracts.ts` only.
 */
export { createRaidGateApplication, createRaidMarchCheck, MARCH_WINDOW_MS, type RaidGateApplication } from './application';
export * from './contracts';
export type { GateNotifier, GatePolicy, PreviewTokens, RaidGateDeps, RaidMarchCheck, RaidMarchVerdict, RaidTravel, SourceStanding, TargetVerdict, TravelReply } from './ports';
export {
  readActionRecord, readGatePointer, readMemberRecord,
  type ActionEndReason, type GatePointerRecord, type PartyMemberRecord, type RaidActionRecord, type RaidGateRepository,
  type RaidGateTransaction, type RecordOrigin, type Stored,
} from './repository';
