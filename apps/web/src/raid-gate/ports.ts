/**
 * What the gate needs from its hosts (spec 23, "Browser and Atlas composition"). Main supplies the authenticated
 * API transport; the Atlas lane implements `AtlasGateHost`; the kingdom host supplies the source's public face.
 * Nothing here carries a token, a role or a person ID the browser could set.
 */
import type { AtlasChannel } from '@chatdom/shared';
import type { GateCommand, GateReply, KingdomId } from '../../../api/src/raid-gate/contracts';

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
}

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
}>;
