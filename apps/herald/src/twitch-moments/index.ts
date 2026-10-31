import {
  DisplayNameSchema, EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema, type EventCause, type KingdomId, type PersonId,
} from '@chatdom/shared';
import { MOMENT_CURRENT_LIMIT, type MomentResetInfo, type TwitchMomentFact, type TwitchMomentFeed } from '../../../web/src/twitch-moments/contracts';
import { z } from '../../../web/src/twitch-moments/zod';
import { applyEntitlement } from './entitlement';
import { IGNORED, type MomentNormalizer, type NormalizeResult } from './normalizer';
import { channelChatNotification } from './notices';
import { planSubscriptions, sameCondition, type MomentCapability, type SubscriptionPlan, type SupportSource } from './plan';
import type { AuthorizedSubscriptionTransport, CitizenDirectory, FactClocks, MomentClock, MomentRecordPort, TransportLoss } from './ports';
import { fromEventSubWebSocketFrame, ProviderNotificationSchema, type ProviderNotification } from './provider';
import { momentRepository, type MomentRepository } from './records';
import { channelSubscribe, channelSubscriptionEnd, channelSubscriptionGift, channelSubscriptionMessage } from './subscription';

export type { AuthorizedSubscriptionTransport, CitizenDirectory, CitizenDisclosure, MomentClock, MomentRecordPort, MomentRecordTransaction, TransportLoss } from './ports';
export {
  MOMENT_CAPABILITIES, MOMENT_SUBSCRIPTIONS, planSubscriptions, type MomentCapability, type PlannedSubscriptions, type SubscriptionPlan,
  type SubscriptionPlanEntry, type SupportSource,
} from './plan';
export { fromEventSubWebSocketFrame, fromEventSubWebhook, type ProviderNotification } from './provider';
export { SUB_BEAT_WINDOW_MS, subscriptionHomeKey } from './entitlement';
export { FORWARD_WINDOW_MS, GIFT_BEAT_WINDOW_MS } from './gifts';

/** Normalizers implemented so far, by exact `type@version`. Only these can ever enter a plan. */
const NORMALIZERS: ReadonlyMap<string, MomentNormalizer<unknown>> = new Map(
  ([channelSubscribe, channelSubscriptionEnd, channelSubscriptionMessage, channelSubscriptionGift, channelChatNotification] as MomentNormalizer<unknown>[])
    .map(n => [`${n.type}@${n.version}`, n]),
);
/** Bounded work: beyond this many undelivered notifications the source is unavailable, never silently lossy. */
export const INGEST_QUEUE_LIMIT = 512;

export type IngestRejection = 'malformed' | 'oversize' | 'origin' | 'unplanned' | 'condition' | 'unsupported' | 'overflow' | 'record';
export interface IngestStatus {
  readonly state: 'stopped' | 'running' | 'unavailable';
  readonly epoch: string | null;
  readonly plan: readonly { capability: MomentCapability; type: string; version: string }[];
  readonly unavailable: readonly MomentCapability[];
  /** The one source that celebrates support acts this epoch. */
  readonly support: SupportSource;
  /**
   * Redacted counters only: no IDs, names or payloads. `ignored` counts well-formed notices another family owns;
   * `unchanged` counts chat metadata that changed nothing (and so was never claimed).
   */
  readonly counts: Readonly<{ applied: number; published: number; duplicate: number; stale: number; ignored: number; unchanged: number }
    & Record<IngestRejection, number>>;
}

/**
 * Server-side metadata for one chat message, teed from the chat consumer Herald already owns. Never message
 * text. Badge months and tier are null when the chatter shows no subscriber badge. `displayName` is accepted for
 * the tee's own shape only: identity is always the person ID through the citizen directory.
 */
export const ChatMetadataSchema = z.strictObject({
  deliveryId: TokenSchema,
  kingdomId: KingdomIdSchema,
  personId: PersonIdSchema,
  displayName: DisplayNameSchema,
  observedAt: EpochMsSchema,
  subscriberBadgeMonths: UIntSchema.max(1200).nullable(),
  subscriberTier: z.enum(['1', '2', '3']).nullable(),
  origin: z.enum(['live', 'simulated']),
});
export type ChatMetadata = z.infer<typeof ChatMetadataSchema>;
export type ChatMetadataResult = 'accepted' | 'unavailable' | Extract<IngestRejection, 'malformed' | 'origin' | 'condition' | 'overflow'>;
/** Chat metadata observed later than this beyond Herald's own clock is refused, not trusted. */
const OBSERVATION_SKEW_MS = 60_000;

export interface TwitchMomentIngestOptions {
  readonly kingdomId: KingdomId;
  /** The verified origin of every delivery this transport binding carries. */
  readonly origin: 'live' | 'simulated';
  /** Prefix for source epochs; each start (and each source change) begins a fresh epoch. */
  readonly epochPrefix: string;
  readonly moderatorId: PersonId | null;
  readonly readerId: PersonId | null;
  readonly authorized: ReadonlySet<MomentCapability>;
  readonly transport: AuthorizedSubscriptionTransport | null;
  readonly records: MomentRecordPort | null;
  readonly directory: CitizenDirectory | null;
  readonly clock: MomentClock;
}

/**
 * The support-event ingest: authorized plan, provider parser, private identity mapping, transactional records
 * and the public current/feed adapter. Raw provider input never leaves this module.
 */
export function createTwitchMomentIngest(options: TwitchMomentIngestOptions) {
  TokenSchema.parse(options.epochPrefix);
  const counts = { applied: 0, published: 0, duplicate: 0, stale: 0, ignored: 0, unchanged: 0, malformed: 0, oversize: 0, origin: 0,
    unplanned: 0, condition: 0, unsupported: 0, overflow: 0, record: 0 };
  let state: IngestStatus['state'] = 'stopped', epoch: string | null = null, generation = 0, plan: SubscriptionPlan = [];
  let support: SupportSource = null, lapseFromBadges = true;
  let unavailableCapabilities: MomentCapability[] = [], abort: AbortController | null = null;
  let chain: Promise<void> = Promise.resolve(), queued = 0;
  type Subscriber = { reset: (info: MomentResetInfo) => void; receive: (epoch: string, fact: TwitchMomentFact) => void; unavailable: () => void;
    ready: boolean; buffer: TwitchMomentFact[]; throughSeq: number };
  const subscribers = new Set<Subscriber>();

  function lose(): void {
    if (state !== 'running') return;
    state = 'unavailable'; abort?.abort(); abort = null; generation++;
    for (const subscriber of subscribers) subscriber.unavailable();
  }

  function start(): IngestStatus {
    if (state === 'running') return status();
    const { transport, records, directory } = options;
    const planned = planSubscriptions({ kingdomId: options.kingdomId, moderatorId: options.moderatorId, readerId: options.readerId },
      options.authorized, new Set(NORMALIZERS.keys()));
    plan = planned.plan; unavailableCapabilities = [...planned.unavailable];
    support = planned.support; lapseFromBadges = planned.lapseFromBadges;
    if (!transport || !records || !directory || plan.length === 0) { state = 'unavailable'; return status(); }
    generation++;
    const mine = generation;
    epoch = `${options.epochPrefix}.${mine}`;
    state = 'running'; abort = new AbortController();
    transport.subscribe(plan, notification => receive(notification, mine), loss => handleLoss(loss, mine), abort.signal);
    // A source change is a non-animating reset for everyone already listening.
    for (const subscriber of subscribers) void open(subscriber);
    return status();
  }

  function handleLoss(loss: TransportLoss, mine: number): void {
    if (mine !== generation) return;
    if (loss.capability) unavailableCapabilities = [...new Set([...unavailableCapabilities, loss.capability as MomentCapability])];
    lose();
  }

  function receive(input: unknown, mine: number): void {
    if (mine !== generation || state !== 'running') return;
    let notification: ProviderNotification;
    if (typeof input === 'string') {
      const parsed = fromEventSubWebSocketFrame(input, options.clock.now(), options.origin);
      if (!parsed.ok) { counts[parsed.reason]++; return; }
      notification = parsed.notification;
    } else {
      const parsed = ProviderNotificationSchema.safeParse(input);
      if (!parsed.success) { counts.malformed++; return; }
      notification = parsed.data;
    }
    if (notification.origin !== options.origin) { counts.origin++; return; }
    const { type, version, condition } = notification.subscription;
    const entry = plan.find(e => e.type === type && e.version === version);
    if (!entry) { counts.unplanned++; return; }
    if (!sameCondition(entry.condition, condition)) { counts.condition++; return; }
    const normalizer = NORMALIZERS.get(`${type}@${version}`);
    if (!normalizer) { counts.unsupported++; return; }
    const parsed = normalizer.parse(notification.event, options.kingdomId);
    if (parsed === null) { counts.malformed++; return; }
    if (parsed === IGNORED) { counts.ignored++; return; }
    enqueue({ claim: 'delivery', id: notification.deliveryId, clocks: notification,
      cause: { kind: 'external', source: 'twitch.eventsub', id: notification.deliveryId },
      run: repository => normalizer.apply(parsed, { kingdomId: options.kingdomId, notification, repository, directory: options.directory!, support,
        lapseFromBadges }) }, mine);
  }

  /** One unit of work for the shared record path. `observation` claims only when something actually changed. */
  interface Work {
    readonly claim: 'delivery' | 'observation';
    readonly id: string;
    readonly clocks: FactClocks;
    readonly cause: EventCause;
    run(repository: MomentRepository): Promise<NormalizeResult & { readonly changed?: boolean }>;
  }

  function enqueue(work: Work, mine: number): boolean {
    if (queued >= INGEST_QUEUE_LIMIT) { counts.overflow++; lose(); return false; }
    queued++;
    chain = chain.then(() => commit(work, mine)).finally(() => { queued--; });
    return true;
  }

  /**
   * The one record path for every source: claim, domain transition, public facts, current state and watermark
   * commit together or not at all. Chat metadata is claimed only when it changes something, so idle chatter never
   * grows the claim set; replaying an unchanged observation is a no-op either way.
   */
  async function commit(work: Work, mine: number): Promise<void> {
    if (mine !== generation) return;
    let committed: TwitchMomentFact[];
    try {
      committed = await options.records!.transact(options.kingdomId, async tx => {
        const repository = momentRepository(tx);
        if (work.claim === 'delivery' ? !await repository.claimDelivery(work.id) : await repository.observationClaimed(work.id)) return null;
        const result = await work.run(repository);
        if (result.outcome === 'stale') return 'stale' as const;
        if (work.claim === 'observation') {
          if (!result.changed && result.facts.length === 0) return 'unchanged' as const;
          await repository.claimObservation(work.id);
        }
        const facts: TwitchMomentFact[] = [];
        for (const { body, current } of result.facts) {
          const fact = await tx.appendFact(body, { occurredAt: work.clocks.occurredAt, receivedAt: work.clocks.receivedAt }, work.cause, options.origin);
          if (current && !await repository.setCurrent(fact)) throw new Error('Current public state exceeds its budget');
          facts.push(fact);
        }
        if (facts.length) await repository.putWatermark(facts.at(-1)!.seq);
        return facts;
      }).then(result => {
        if (result === null) { counts.duplicate++; return []; }
        if (result === 'stale') { counts.stale++; return []; }
        if (result === 'unchanged') { counts.unchanged++; return []; }
        counts.applied++; return result;
      });
    } catch {
      // A failed transaction publishes nothing and is not acknowledged; the source must reconcile.
      counts.record++; lose(); return;
    }
    if (mine !== generation) return;
    for (const fact of committed) {
      counts.published++;
      for (const subscriber of subscribers) {
        if (!subscriber.ready) subscriber.buffer.push(fact);
        else if (fact.seq > subscriber.throughSeq) { subscriber.throughSeq = fact.seq; subscriber.receive(epoch!, fact); }
      }
    }
  }

  /**
   * Chat metadata teed from Herald's own chat consumer: badge months raise earned months, a badge tier sets the
   * tier, a badge with no record starts an active one, and no badge is a quiet lapse only when no
   * `channel.subscription.end` is planned. Always state: a badge never stages a shared resub or any beat.
   */
  function observeChatMetadata(input: unknown): ChatMetadataResult {
    if (state !== 'running') return 'unavailable';
    const parsed = ChatMetadataSchema.safeParse(input);
    const receivedAt = options.clock.now();
    if (!parsed.success || parsed.data.observedAt > receivedAt + OBSERVATION_SKEW_MS) { counts.malformed++; return 'malformed'; }
    const metadata = parsed.data;
    if (metadata.origin !== options.origin) { counts.origin++; return 'origin'; }
    if (metadata.kingdomId !== options.kingdomId) { counts.condition++; return 'condition'; }
    const act = { kind: 'badge', months: metadata.subscriberBadgeMonths, tier: metadata.subscriberTier, lapse: lapseFromBadges } as const;
    const accepted = enqueue({ claim: 'observation', id: metadata.deliveryId, clocks: { occurredAt: metadata.observedAt, receivedAt },
      cause: { kind: 'external', source: 'twitch.chat', id: metadata.deliveryId },
      run: async repository => {
        const result = await applyEntitlement({ kingdomId: options.kingdomId, repository, directory: options.directory! }, metadata.personId,
          metadata.observedAt, act);
        return result.outcome === 'stale' ? result : { outcome: 'applied', facts: result.facts, changed: result.changed };
      } }, generation);
    return accepted ? 'accepted' : 'overflow';
  }

  async function open(subscriber: Subscriber): Promise<void> {
    subscriber.ready = false; subscriber.buffer = [];
    const mine = generation, at = options.clock.now();
    if (state !== 'running') { queueMicrotask(() => { if (subscribers.has(subscriber)) subscriber.unavailable(); }); return; }
    let snapshot: { facts: TwitchMomentFact[]; throughSeq: number };
    try {
      snapshot = await options.records!.transact(options.kingdomId, async tx => {
        const repository = momentRepository(tx);
        return { facts: await repository.currentFacts(), throughSeq: await repository.watermark() };
      });
    } catch { counts.record++; lose(); return; }
    if (!subscribers.has(subscriber) || mine !== generation || state !== 'running') return;
    if (snapshot.facts.length > MOMENT_CURRENT_LIMIT) { subscriber.unavailable(); return; }
    subscriber.throughSeq = snapshot.throughSeq;
    subscriber.reset({ epoch: epoch!, asOf: at, throughSeq: snapshot.throughSeq, current: snapshot.facts });
    subscriber.ready = true;
    for (const fact of subscriber.buffer.splice(0)) if (fact.seq > subscriber.throughSeq) { subscriber.throughSeq = fact.seq; subscriber.receive(epoch!, fact); }
  }

  /** Public current/feed adapter: every subscriber starts from a bounded current reset, then receives new facts. */
  const feed: TwitchMomentFeed = {
    origin: options.origin,
    subscribe(reset, receiveFact, unavailable) {
      const subscriber: Subscriber = { reset, receive: receiveFact, unavailable, ready: false, buffer: [], throughSeq: 0 };
      subscribers.add(subscriber);
      void open(subscriber);
      return () => { subscribers.delete(subscriber); };
    },
  };

  function status(): IngestStatus {
    return { state, epoch, plan: plan.map(({ capability, type, version }) => ({ capability, type, version })),
      unavailable: [...unavailableCapabilities], support, counts: { ...counts } };
  }

  return {
    start,
    observeChatMetadata,
    /** Stops consumers and tells every listener the source is unavailable. Known state stays in the records. */
    stop() { lose(); if (state === 'unavailable') state = 'stopped'; },
    feed,
    status,
    /** Resolves once every accepted delivery so far has been committed or refused. */
    settled: () => chain,
  };
}
export type TwitchMomentIngest = ReturnType<typeof createTwitchMomentIngest>;
