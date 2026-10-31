// apps/api has no package manifest yet (main-owned); shared types are reached by path until it does.
import type { KingdomId, PersonId } from '../../../../packages/shared/src';
import type { ActionKind, TwitchMomentFact } from '../../../web/src/twitch-moments/contracts';

/**
 * Frozen local ports for the action application (Spec 20, TM01). Main binds root session/CSRF verification,
 * grants, credential-bound Helix requests, durable records and the shared provider budget. The application in
 * this folder never sees a token and never trusts a request body for authority.
 */

/** Resolved by main's root auth from the session and CSRF check; a request body never names its principal. */
export interface Principal {
  readonly personId: PersonId;
  readonly kingdomId: KingdomId;
  /** Monarch-only actions compare the real broadcaster identity: personId must equal kingdomId. */
  readonly role: 'monarch' | 'moderator' | 'walker';
  /** Opaque session binding for preview expiry and anti-replay records. */
  readonly sessionKey: string;
}
export type PrincipalResult =
  | { readonly ok: true; readonly principal: Principal }
  | { readonly ok: false; readonly reason: 'unauthenticated' | 'csrf' | 'expired' };
export interface PrincipalPort { principalFor(request: Request): Promise<PrincipalResult> }

/** Which credential context a Helix call is made in; the transport maps it to a real token it alone holds. */
export type HelixCredential =
  | { readonly kind: 'broadcaster'; readonly kingdomId: KingdomId }
  | { readonly kind: 'moderator'; readonly kingdomId: KingdomId; readonly moderatorId: PersonId }
  | { readonly kind: 'walker'; readonly personId: PersonId }
  | { readonly kind: 'herald-sender'; readonly kingdomId: KingdomId };

export type HelixPath = '/helix/polls' | '/helix/predictions' | '/helix/channels/vips' | '/helix/chat/announcements' | '/helix/chat/shoutouts'
  | '/helix/channel_points/custom_rewards' | '/helix/channel_points/custom_rewards/redemptions' | '/helix/streams/markers' | '/helix/chat/messages';

export interface HelixCall {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: HelixPath;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly body: unknown;
  readonly credential: HelixCredential;
}

/**
 * Dispatch certainty is the transport's to report. `not-dispatched` is safe to call unavailable; `ambiguous`
 * means the mutation may have reached Twitch and must become unknown, never be resent automatically.
 */
export type HelixOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown;
      readonly rateLimit: { readonly remaining: number | null; readonly resetAt: number | null } }
  | { readonly kind: 'not-dispatched'; readonly reason: 'unauthorized' | 'revoked' | 'unavailable' | 'rate-limit' }
  | { readonly kind: 'ambiguous'; readonly reason: 'timeout' | 'connection' | 'aborted' };
export interface AuthorizedHelixTransport {
  request(call: HelixCall, signal: AbortSignal): Promise<HelixOutcome>;
}

/** Main's persisted standing permissions; the application re-reads them on every use. */
export type StandingPermission = 'marker' | 'crier';
export type CrierSetting = 'silent' | 'rare' | 'herald';
export interface StandingPermissionPort {
  read(kingdomId: KingdomId, permission: StandingPermission): Promise<{ readonly enabled: boolean; readonly crier: CrierSetting | null } | null>;
}

/** The shared provider budget across Herald/API writers, with priority classes. */
export type BudgetPriority = 'safety' | 'gate' | 'decree' | 'raid-welcome' | 'climax' | 'royal' | 'walker';
export interface ProviderBudgetPort {
  permit(kingdomId: KingdomId, kind: ActionKind | 'crier', priority: BudgetPriority): Promise<{ readonly granted: boolean; readonly retryAt: number | null }>;
}

/** What the crier policy receives: an already witnessed public fact, never a browser request. */
export type WitnessedMoment = TwitchMomentFact;
