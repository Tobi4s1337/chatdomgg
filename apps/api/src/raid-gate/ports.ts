/**
 * Infrastructure the Raid Gate application needs from main. These are mechanical I/O adapters; every decision
 * about who may open the gate, which preview is current and who is marching stays in the application.
 */
import type { KingdomId } from '../../../../packages/shared/src/identity';
import type { GatePrincipal, GateTarget } from './contracts';
import type { RaidGateRepository, RecordOrigin } from './repository';

/**
 * The source as the authority sees it at this moment. `broadcaster` is verified against Twitch identity, not read
 * from a role or a crown in the client. `raids` is the source's own channel:manage:raids grant; `actions` is the
 * monarch's consent for Chatdom to write to Twitch at all.
 */
export type SourceStanding = Readonly<{
  session: 'current' | 'ended';
  broadcaster: boolean;
  live: boolean;
  raids: 'granted' | 'missing' | 'revoked' | 'unknown';
  actions: 'enabled' | 'disabled';
}>;

/** A destination's current live state and classification, plus whether this source may raid it. */
export type TargetVerdict = Readonly<{ target: GateTarget; permitted: boolean }>;

export interface GatePolicy {
  readStanding(principal: GatePrincipal, now: number, signal: AbortSignal): Promise<SourceStanding>;
  /** Null when the channel is unknown to the authority. */
  readTarget(from: KingdomId, target: KingdomId, now: number, signal: AbortSignal): Promise<TargetVerdict | null>;
}

/** Preview tokens are random and opaque; only their SHA-256 hex is stored. */
export interface PreviewTokens {
  issue(): string;
  hash(token: string): Promise<string>;
}

/**
 * Fired after a committed change. Main's event adapter re-reads the gate for each subscriber with that
 * subscriber's own principal; the change itself carries nothing private.
 */
export interface GateNotifier {
  changed(change: Readonly<{ kingdomId: KingdomId; requestId: string; revision: number }>): void;
}

export type RaidGateDeps = Readonly<{
  repository: RaidGateRepository;
  policy: GatePolicy;
  tokens: PreviewTokens;
  notifier?: GateNotifier;
  /** `simulated` whenever any bound transport is controlled rather than Twitch itself. */
  origin: RecordOrigin;
}>;
