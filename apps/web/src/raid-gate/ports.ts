/**
 * What the gate needs from its hosts (spec 23, "Browser and Atlas composition"). Main supplies the authenticated
 * API transport; the Atlas lane implements `AtlasGateHost`; the kingdom host supplies the source's public face.
 * Nothing here carries a token, a role or a person ID the browser could set.
 */
import type { AtlasChannel } from '@chatdom/shared';
import type { AtlasRaid, GateCommand, GateReply, KingdomId, TravelState } from '../../../api/src/raid-gate/contracts';

export interface RaidGateApi {
  /**
   * `live` when every transport behind this API is Twitch and real rooms; `simulated` for controlled transports.
   * A simulated API puts SIMULATED on every surface the gate draws.
   */
  readonly origin: 'live' | 'simulated';
  /** One authenticated command. Rejects only for transport failure or abort; refusals come back as `denied`. */
  request(command: GateCommand, signal: AbortSignal): Promise<GateReply>;
  /**
   * Fresh replies whenever this kingdom's gate (`null`) or one request changes, each computed by the authority for
   * this viewer. Stops when the signal aborts.
   */
  subscribe(requestId: string | null, onReply: (reply: GateReply) => void, signal: AbortSignal): void;
}

/** How a destination appears on the map: a founded kingdom, a holding waiting for its monarch, or the known edge. */
export type GateLand = 'founded' | 'waiting' | 'edge';
export type AtlasGateEvent =
  | Readonly<{ kind: 'target'; channel: AtlasChannel; land: GateLand }>
  | Readonly<{ kind: 'closed' }>;

/**
 * Atlas gate mode. Opening it has no side effects: it shows the finder at the source and reports the monarch's
 * pick. The Atlas owns the finder, its ordering and its visibility rules.
 */
export interface AtlasGateHost {
  /** Labels the finder SIMULATED when it is fed by a bench rather than the Surveyor. */
  readonly origin: 'live' | 'simulated';
  open(from: KingdomId, signal: AbortSignal): void;
  close(): void;
  /** How a destination the authority named appears on the map, under the Atlas's own visibility rules. */
  resolve(kingdomId: KingdomId, signal: AbortSignal): Promise<Readonly<{ channel: AtlasChannel; land: GateLand }> | null>;
  subscribe(listener: (event: AtlasGateEvent) => void, signal: AbortSignal): void;
  /**
   * The party set out on this witnessed raid: attach the map to its public caravan by the raid's ID, the one the
   * Atlas draws for everyone. Presentation only. The road itself reaches the Atlas ledger from the server, and a
   * viewer's map never creates a second caravan or road.
   */
  follow(raid: AtlasRaid, signal: AbortSignal): void;
  /**
   * One person's journey, stage by stage, so the map can rise from the source, draw the road and reveal the
   * destination at the pace of the authority's answers (spec 23 R6). Optional until the Atlas implements it; the
   * gate board tells the same stages either way. Presentation only: nothing here moves anyone.
   */
  travel?(stage: AtlasTravelStage, signal: AbortSignal): void;
}

/**
 * `rise`: a reservation is being made at `to`; `road`: the destination is readying its world; `drawing`: stepping
 * through; `arrived`: the destination acknowledged the arrival; `back`: the journey ended and the walker never left.
 * `state` is the authority's own ticket state at that moment.
 */
export type AtlasTravelStage = Readonly<{
  kind: 'rise' | 'road' | 'drawing' | 'arrived' | 'back'; ticket: string; from: KingdomId; to: KingdomId; state: TravelState;
}>;

/** The source kingdom's public face, from the kingdom host. */
export type GateKingdom = Readonly<{ kingdomId: KingdomId; name: string; login: string }>;

/** Where the monarch renews a Twitch connection. Absent when the host has no account surface to send them to. */
export type GateAccount = Readonly<{ reconnect: () => void }>;

export type RaidGatePorts = Readonly<{
  /** Null when no authenticated authority is bound: the gate says so and offers nothing it cannot do. */
  api: RaidGateApi | null;
  atlas: AtlasGateHost | null;
  source: GateKingdom;
  account?: GateAccount;
  clock: () => number;
  /** Fresh request IDs; defaults to `crypto.randomUUID`. */
  ids?: () => string;
  /** Pauses between journey steps; defaults to a timer. Tests inject an instant one. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}>;
