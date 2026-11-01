// The room's interaction authority. Bound by the integrator to the actual RealmRoomHandle seams (see README).
export { INTERACTION_DEDUPE, REFUSAL_WORDS, createInteractionAuthority } from './authority';
export { buildInteractionContext } from './context';
export { foundedHomeThresholds, ownedHomes, type FoundedThresholds } from './homes';
export { composeInteractionHosts, type CampfireSeatHost, type HostedSeat, type TableSeatHost } from './hosts';
export type {
  CurrentWorld, InteractIntent, InteractionAdmission, InteractionAuthority, InteractionAuthorityOptions, InteractionChange, InteractionDelivery,
  InteractionHomes, InteractionHosts, InteractionMessage, InteractionRecovery, InteractionReleaseCause, InteractionRights, InteractionRoomEffects,
  InteractionSeats, InteractionSelfChange, InteractionZones, SeatsMessage,
} from './ports';
