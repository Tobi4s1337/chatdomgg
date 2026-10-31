import {
  DisplayNameSchema, EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema, type EventCause, type KingdomId, type PersonId,
} from '@chatdom/shared';
import { MOMENT_CURRENT_LIMIT, type MomentResetInfo, type TwitchMomentFact, type TwitchMomentFeed } from '../../../web/src/twitch-moments/contracts';
import { z } from '../../../web/src/twitch-moments/zod';
import { applyBattle, battleRevisionId, BattleStateSchema } from './battle';
import { channelBitsUse } from './bits';
import { applyEntitlement } from './entitlement';
import { applyHype, hypeTrainBegin, hypeTrainEnd, hypeTrainProgress, parseHypeStatus } from './hype';
import { IGNORED, type ClaimedSummon, type MomentNormalizer, type NormalizeResult } from './normalizer';
import { channelChatNotification } from './notices';
import { planSubscriptions, sameCondition, type MomentCapability, type SubscriptionPlan, type SupportSource } from './plan';
import type {
  AuthorizedSubscriptionTransport, CitizenDirectory, DragonBattlePort, FactClocks, MomentClock, MomentRead, MomentReadPort, MomentRecordPort, TransportLoss,
} from './ports';
import { fromEventSubWebSocketFrame, ProviderNotificationSchema, type ProviderNotification } from './provider';
import { momentRepository, type ChangeClaimFamily, type MomentRepository } from './records';
import { channelSubscribe, channelSubscriptionEnd, channelSubscriptionGift, channelSubscriptionMessage } from './subscription';

export type {
  AuthorizedSubscriptionTransport, CitizenDirectory, CitizenDisclosure, DragonBattlePort, DragonForm, DragonSummonReply, DragonSummonRequest, MomentClock,
  MomentRead, MomentReadPort, MomentRecordPort, MomentRecordTransaction, TransportLoss,
} from './ports';
export { BATTLE_BEAT_WINDOW_MS, BattleStateSchema, type BattleState } from './battle';
export { BITS_BEAT_WINDOW_MS } from './bits';
export { DRAGON_LEVEL, dragonForm, HYPE_BEAT_WINDOW_MS } from './hype';
export {
  MOMENT_CAPABILITIES, MOMENT_SUBSCRIPTIONS, planSubscriptions, type MomentCapability, type PlannedSubscriptions, type SubscriptionPlan,
  type SubscriptionPlanEntry, type SupportSource,
} from './plan';
export { fromEventSubWebSocketFrame, fromEventSubWebhook, type ProviderNotification } from './provider';
export { SUB_BEAT_WINDOW_MS, subscriptionHomeKey } from './entitlement';
export { FORWARD_WINDOW_MS, GIFT_BEAT_WINDOW_MS } from './gifts';

/** Normalizers implemented so far, by exact `type@version`. Only these can ever enter a plan. */
const NORMALIZERS: ReadonlyMap<string, MomentNormalizer<unknown>> = new Map(
  ([channelSubscribe, channelSubscriptionEnd, channelSubscriptionMessage, channelSubscriptionGift, channelChatNotification, channelBitsUse,
    hypeTrainBegin, hypeTrainProgress, hypeTrainEnd] as MomentNormalizer<unknown>[])
    .map(n => [`${n.type}@${n.version}`, n]),
);
/** Bounded work: beyond this many undelivered notifications the source is unavailable, never silently lossy. */
export const INGEST_QUEUE_LIMIT = 512;
/** One reconciliation read never waits longer than this; a slower read is unknown coverage. */
export const RECONCILE_TIMEOUT_MS = 10_000;

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
  /** Redacted dragon requests sent after commit and the realm's replies. Acceptance is not a battle. */
  readonly summons: Readonly<Record<'requested' | 'accepted' | 'refused' | 'unavailable' | 'failed', number>>;
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

export type BattleObservationResult = 'accepted' | 'unavailable' | Extract<IngestRejection, 'malformed' | 'origin' | 'condition' | 'overflow'>;
/**
 * Coverage of one reconciliation, redacted. `current`: a running train was read (and published as recovered
 * state when it was newer than the records); `none`: Twitch reported no train, which changes nothing; `unknown`:
 * the read failed, timed out or was partial, which changes nothing; `unavailable`: no read could be made.
 */
export interface ReconcileReport { readonly hype: 'current' | 'none' | 'unknown' | 'unavailable' }
type CommitOutcome = 'applied' | 'duplicate' | 'stale' | 'unchanged' | 'failed' | 'skipped';

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
  /** Main's realm battle application for earned dragons; absent or null means no dragon can be requested. */
  readonly battle?: DragonBattlePort | null;
  /** Bounded reconciliation reads; absent or null means reconcile reports unavailable. */
  readonly reads?: MomentReadPort | null;
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
  const summonCounts = { requested: 0, accepted: 0, refused: 0, unavailable: 0, failed: 0 };
  const summoning = new Set<Promise<void>>();
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
        lapseFromBadges, summonable: Boolean(options.battle) }) }, mine);
  }

  /**
   * One unit of work for the shared record path. `delivery` claims first; a change family (`observation`,
   * `battle-revision`) claims only when something actually changed; null claims nothing and relies on the domain
   * record's own provider ordering (a reconciliation read). `origin` overrides the binding's origin only to mark
   * recovered, non-animating state.
   */
  interface Work {
    readonly claim: 'delivery' | ChangeClaimFamily | null;
    readonly id: string;
    readonly clocks: FactClocks;
    readonly cause: EventCause;
    readonly origin?: 'recovered';
    run(repository: MomentRepository): Promise<NormalizeResult & { readonly changed?: boolean }>;
  }

  function enqueue(work: Work, mine: number): Promise<CommitOutcome> | null {
    if (queued >= INGEST_QUEUE_LIMIT) { counts.overflow++; lose(); return null; }
    queued++;
    const done = chain.then(() => commit(work, mine)).finally(() => { queued--; });
    chain = done.then(() => undefined);
    return done;
  }

  /**
   * The one record path for every source: claim, domain transition, public facts, current state and watermark
   * commit together or not at all. Chat metadata is claimed only when it changes something, so idle chatter never
   * grows the claim set; replaying an unchanged observation is a no-op either way. Dragon requests claimed inside
   * the transaction are sent only once it has committed.
   */
  async function commit(work: Work, mine: number): Promise<CommitOutcome> {
    if (mine !== generation) return 'skipped';
    let committed: { facts: TwitchMomentFact[]; summons: readonly ClaimedSummon[] };
    try {
      const outcome = await options.records!.transact(options.kingdomId, async tx => {
        const repository = momentRepository(tx);
        const claim = work.claim;
        if (claim === 'delivery' ? !await repository.claimDelivery(work.id) : claim !== null && await repository.claimedIn(claim, work.id)) return null;
        const result = await work.run(repository);
        if (result.outcome === 'stale') return 'stale' as const;
        if (claim !== 'delivery' && claim !== null) {
          if (!result.changed && result.facts.length === 0) return 'unchanged' as const;
          await repository.claimIn(claim, work.id);
        }
        const facts: TwitchMomentFact[] = [];
        for (const { body, current, slot } of result.facts) {
          const fact = await tx.appendFact(body, { occurredAt: work.clocks.occurredAt, receivedAt: work.clocks.receivedAt }, work.cause,
            work.origin ?? options.origin);
          if (slot && !current) await repository.releaseSlot(slot.name, fact.body.key);
          else if (slot ? await repository.setSlotCurrent(slot.name, fact, slot.order) === 'full' : current && !await repository.setCurrent(fact)) {
            throw new Error('Current public state exceeds its budget');
          }
          facts.push(fact);
        }
        if (facts.length) await repository.putWatermark(facts.at(-1)!.seq);
        return { facts, summons: result.summons ?? [] };
      });
      if (outcome === null) { counts.duplicate++; return 'duplicate'; }
      if (outcome === 'stale') { counts.stale++; return 'stale'; }
      if (outcome === 'unchanged') { counts.unchanged++; return 'unchanged'; }
      counts.applied++; committed = outcome;
    } catch {
      // A failed transaction publishes nothing and is not acknowledged; the source must reconcile.
      counts.record++; lose(); return 'failed';
    }
    if (mine !== generation) return 'applied';
    summon(committed.summons);
    for (const fact of committed.facts) {
      counts.published++;
      for (const subscriber of subscribers) {
        if (!subscriber.ready) subscriber.buffer.push(fact);
        else if (fact.seq > subscriber.throughSeq) { subscriber.throughSeq = fact.seq; subscriber.receive(epoch!, fact); }
      }
    }
    return 'applied';
  }

  /**
   * Send committed dragon requests to the realm, outside any transaction. Each was claimed exactly once, so a
   * failure is counted and never resent; the realm alone decides whether a battle follows.
   */
  function summon(requests: readonly ClaimedSummon[]): void {
    const port = options.battle ?? null, signal = abort?.signal;
    for (const request of requests) {
      summonCounts.requested++;
      if (!port || !signal) { summonCounts.failed++; continue; }
      const sent = Promise.resolve().then(() => port.summon({ ...request, origin: options.origin }, signal)).then(reply => {
        const status: unknown = (reply as { status?: unknown } | null)?.status;
        if (status === 'accepted' || status === 'refused' || status === 'unavailable') summonCounts[status]++;
        else summonCounts.failed++;
      }, () => { summonCounts.failed++; });
      summoning.add(sent);
      void sent.finally(() => summoning.delete(sent));
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

  /**
   * Authoritative battle state from main's realm gameplay. Its revision orders reports (older is stale, and a
   * finished battle is never resurrected); its facts go through the same claim/record path, claimed per battle
   * revision. Strikes, health, victory and retreat are exactly what authority reported.
   */
  function observeBattle(input: unknown): BattleObservationResult {
    if (state !== 'running') return 'unavailable';
    const parsed = BattleStateSchema.safeParse(input);
    const receivedAt = options.clock.now();
    if (!parsed.success || parsed.data.observedAt > receivedAt + OBSERVATION_SKEW_MS) { counts.malformed++; return 'malformed'; }
    const battle = parsed.data;
    if (battle.origin !== options.origin) { counts.origin++; return 'origin'; }
    if (battle.kingdomId !== options.kingdomId) { counts.condition++; return 'condition'; }
    const id = battleRevisionId(battle);
    const accepted = enqueue({ claim: 'battle-revision', id, clocks: { occurredAt: battle.observedAt, receivedAt },
      cause: { kind: 'external', source: 'realm.battle', id }, run: repository => applyBattle(repository, battle) }, generation);
    return accepted ? 'accepted' : 'overflow';
  }

  /**
   * One bounded Hype Train status read. A current train the records do not know, or know at an older provider
   * state, is published as recovered state with the provider's own times (no beat). A failed, timed-out, partial
   * or non-200 read is unknown coverage and changes nothing: never an end and never an empty train list.
   */
  async function reconcile(signal: AbortSignal): Promise<ReconcileReport> {
    const reads = options.reads ?? null, life = abort;
    if (state !== 'running' || !reads || !life || !plan.some(e => e.capability === 'moments.hype')) return { hype: 'unavailable' };
    const mine = generation;
    const bounded = AbortSignal.any([signal, life.signal, AbortSignal.timeout(RECONCILE_TIMEOUT_MS)]);
    let read: MomentRead;
    try { read = await untilAborted(reads.hypeTrainStatus(options.kingdomId, bounded), bounded); } catch { return { hype: 'unknown' }; }
    if (mine !== generation || state !== 'running') return { hype: 'unavailable' };
    if (read.kind === 'unavailable') return { hype: 'unavailable' };
    if (read.kind !== 'response' || read.status !== 200) return { hype: 'unknown' };
    const status = parseHypeStatus(read.body, options.kingdomId);
    if (status === null) return { hype: 'unknown' };
    if (status.current === null) return { hype: 'none' };
    const update = status.current, receivedAt = options.clock.now();
    if (update.startedAt > receivedAt + OBSERVATION_SKEW_MS) return { hype: 'unknown' };
    const done = enqueue({ claim: null, id: update.trainKey, clocks: { occurredAt: update.startedAt, receivedAt }, origin: 'recovered',
      cause: { kind: 'external', source: 'twitch.helix', id: update.trainKey },
      run: repository => applyHype({ kingdomId: options.kingdomId, repository, directory: options.directory!, summonable: Boolean(options.battle) }, update,
        { occurredAt: update.startedAt, recovered: true }) }, mine);
    const outcome = done ? await done : 'failed';
    return { hype: outcome === 'failed' || outcome === 'skipped' ? 'unknown' : 'current' };
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
      unavailable: [...unavailableCapabilities], support, counts: { ...counts }, summons: { ...summonCounts } };
  }

  return {
    start,
    observeChatMetadata,
    observeBattle,
    reconcile,
    /** Stops consumers and tells every listener the source is unavailable. Known state stays in the records. */
    stop() { lose(); if (state === 'unavailable') state = 'stopped'; },
    feed,
    status,
    /** Resolves once every accepted delivery so far has been committed or refused, and its dragon requests answered. */
    async settled(): Promise<void> {
      await chain;
      await Promise.all([...summoning]);
    },
  };
}

/** Settles with `work`, or rejects as soon as `signal` aborts even if the port ignores it. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}
export type TwitchMomentIngest = ReturnType<typeof createTwitchMomentIngest>;
