import type { EventCause, KingdomId, PersonId } from '@chatdom/shared';
import type { MomentBodyOf, MomentOrigin, TwitchMomentBody, TwitchMomentFact } from '../../../web/src/twitch-moments/contracts';
import type { SubscriptionPlan } from './plan';

/**
 * Frozen local ports for the support-event ingest (Spec 20, TM01). Main binds each one to its existing verified
 * grant system, durable core and identity tables. Unbound ports are unavailable; nothing here falls back to fixtures.
 */

/**
 * Delivery wiring, not grants. Main's binding has already authenticated each delivery (HMAC/shard session) and
 * delivers only entries of the plan it has accepted; `receive` gets the raw frame text or a parsed notification
 * object from that wrapper. `unavailable` reports a lost or revoked capability, which stops its consumers.
 */
export interface AuthorizedSubscriptionTransport {
  subscribe(
    plan: SubscriptionPlan,
    receive: (notification: unknown) => void,
    unavailable: (reason: TransportLoss) => void,
    signal: AbortSignal,
  ): void;
}
export type TransportLoss = { readonly kind: 'revoked' | 'disconnected' | 'unauthorized'; readonly capability: string | null };

/** Clocks the fact envelope keeps: the provider's and Herald's own receipt. */
export interface FactClocks { readonly occurredAt: number; readonly receivedAt: number }

/**
 * One serializable, durable transaction under main's core adapter. Keys are namespaced by the repository in
 * `records.ts`; `claim` returns false when the key already exists. Everything inside commits atomically or not
 * at all. Core assigns the per-kingdom `seq` and committed envelope in `appendFact`.
 */
export interface MomentRecordTransaction {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  claim(key: string): Promise<boolean>;
  appendFact(body: TwitchMomentBody, clocks: FactClocks, cause: EventCause, origin: MomentOrigin): Promise<TwitchMomentFact>;
}
export interface MomentRecordPort {
  transact<T>(kingdomId: KingdomId, work: (tx: MomentRecordTransaction) => Promise<T>): Promise<T>;
}

/**
 * Main's canonical citizen/home/disclosure binding, keyed by the decimal Twitch person ID. Never by display name.
 * `null` means not a citizen of this kingdom. `anonymous` means a quiet citizen: never named, tinted or located.
 */
export type CitizenDisclosure =
  | { readonly disclosure: 'named'; readonly displayName: string; readonly homeSlot: number | null }
  | { readonly disclosure: 'anonymous' };
export interface CitizenDirectory {
  resolve(kingdomId: KingdomId, personId: PersonId): Promise<CitizenDisclosure | null>;
}

export interface MomentClock { now(): number }

/** The authored dragon forms, exactly the battle projection's own (`spectacle.ts` DragonForm). */
export type DragonForm = MomentBodyOf<'battle'>['form'];

/**
 * One request to main's realm gameplay for the earned dragon of a Hype Train. `requestKey` is unique per train and
 * form: the first request at level 3 and each later upgrade carry their own key, and each is sent at most once.
 * The realm decides whether a battle actually happens; acceptance is not a battle.
 */
export interface DragonSummonRequest {
  readonly kingdomId: KingdomId;
  readonly source: 'hype';
  readonly requestKey: string;
  readonly trainKey: string;
  readonly level: number;
  readonly form: DragonForm;
  readonly sharedSessionKey: string | null;
  /** The verified origin of the train evidence; a simulated train never asks for a live battle. */
  readonly origin: 'live' | 'simulated';
}
export type DragonSummonReply = { readonly status: 'accepted' | 'refused' | 'unavailable' };
/** Main's realm battle application. Null in the ingest options means no battle can be requested. */
export interface DragonBattlePort {
  summon(request: DragonSummonRequest, signal: AbortSignal): Promise<DragonSummonReply>;
}

/**
 * Bounded reconciliation reads through main's credential-bound Helix binding. `response` carries the provider
 * status and parsed JSON body; `unavailable` means the read was never made (unbound, unauthorized, no budget).
 */
export type MomentRead = { readonly kind: 'response'; readonly status: number; readonly body: unknown } | { readonly kind: 'unavailable' };
export interface MomentReadPort {
  /** `GET /helix/hypetrain/status?broadcaster_id=<kingdom>` with the broadcaster's own credential. */
  hypeTrainStatus(kingdomId: KingdomId, signal: AbortSignal): Promise<MomentRead>;
}
