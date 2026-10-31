/**
 * Infrastructure the Raid Gate application needs from main. These are mechanical I/O adapters; every decision
 * about who may open the gate, which preview is current and who is marching stays in the application.
 */
import type { AtlasRaid } from '../../../../packages/shared/src/atlas-raids';
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

/**
 * One Twitch write the gate asks for. `key` is the outbox ID: the transport records it before calling Twitch, so a
 * later `reconcile` with the same key can say what became of that one write.
 */
export type RaidWrite = Readonly<{ key: string; requestId: string; from: KingdomId; to: KingdomId }>;

/**
 * Twitch's answer to one write. For a start, `accepted` means Twitch now holds a pending raid and its countdown runs
 * from `createdAt`; it never means the raid happened. For a cancel, `accepted` means Twitch confirmed the pending raid
 * was cancelled, and `rejected` that Twitch held nothing to cancel. `unknown` is any answer the transport cannot vouch
 * for: a timeout after the request may have left, a dropped connection, a 5xx.
 */
export type RaidWriteOutcome =
  | Readonly<{ kind: 'accepted'; createdAt: number }>
  | Readonly<{ kind: 'rejected'; code: string }>
  | Readonly<{ kind: 'unknown' }>;

/**
 * Main's authorized Twitch transport for the source broadcaster: Start a Raid and Cancel a Raid with the source's own
 * `channel:manage:raids` user grant. The gate calls `start` or `cancel` at most once per key. `reconcile` never
 * writes to Twitch: it answers from the transport's own record of that key (and anything else it can verify), and
 * says `unknown` rather than guess when it never saw the key or cannot tell.
 */
export interface AuthorizedRaidTransport {
  readonly origin: RecordOrigin;
  start(write: RaidWrite, signal: AbortSignal): Promise<RaidWriteOutcome>;
  cancel(write: RaidWrite, signal: AbortSignal): Promise<RaidWriteOutcome>;
  reconcile(write: RaidWrite, signal: AbortSignal): Promise<RaidWriteOutcome>;
}

/**
 * The Atlas's existing road ingestion (spec 23 R11). The gate hands it each witnessed gate raid exactly as observed;
 * the Atlas ledger owns dedupe by `raid.id`, thickness and fading, so a repeated handoff is harmless. Resolves once the
 * Atlas durably holds the observation; rejects otherwise, and the gate tries again later.
 */
export interface AtlasRoadIngress {
  readonly origin: RecordOrigin;
  observe(raid: AtlasRaid, signal: AbortSignal): Promise<void>;
}

/**
 * A `channel.raid` observation from main's verified ingress (EventSub signature checked, subscription owned by
 * Chatdom). `actionRequestId` is the gate request main's transport correlated it to, or null when it cannot tell;
 * `upstreamEventId` is the EventSub message ID, or null for a source that has none. Server-only: never a viewer command.
 */
export type TrustedRaidObservation = Readonly<{
  raid: AtlasRaid; upstreamEventId: string | null; actionRequestId: string | null; receivedAt: number;
}>;

export type RaidObservationReceipt =
  | Readonly<{ kind: 'landed' | 'duplicate'; requestId: string }>
  | Readonly<{ kind: 'ignored'; reason: 'invalid' | 'untrusted' | 'uncorrelated' | 'unknown-request' | 'mismatch' | 'out-of-window' | 'settled' | 'conflict' }>;

/** What one recovery pass did, for main's log. */
export type RaidGateRecovery = Readonly<{ reconciled: number; sent: number; lapsed: number; delivered: number; overdue: number }>;

export type RaidGateDeps = Readonly<{
  repository: RaidGateRepository;
  policy: GatePolicy;
  tokens: PreviewTokens;
  notifier?: GateNotifier;
  /** `simulated` whenever any bound transport is controlled rather than Twitch itself. */
  origin: RecordOrigin;
  /** Main's server clock, for work that outlives the request that began it. */
  clock: () => number;
  /** Null until main binds the source's Twitch raid authority: then the gate can preview and gather, never start. */
  raids?: AuthorizedRaidTransport | null;
  /** Null until the Atlas binds its road ingestion: witnessed raids wait in the outbox and are handed over later. */
  roads?: AtlasRoadIngress | null;
  /** How long one Twitch call may take before its answer counts as unknown. */
  dispatchTimeoutMs?: number;
}>;
