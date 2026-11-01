import { CHAT_COMMAND_MAX_AGE_MS, ChatCommandEnvelopeSchema, KingdomIdSchema, PersonIdSchema, PRESENCE_LEASE_MS,
  type KingdomId } from '@chatdom/shared';
import {
  AuthorizationRevokeEventSchema, ChatClearEventSchema, ChatClearUserMessagesEventSchema, ChatMessageDeleteEventSchema,
  ChatMessageEventSchema, type DeliveryFrame, matchesRequest, StreamOfflineEventSchema, StreamOnlineEventSchema,
} from '@chatdom/twitch';
import { RealmMomentObservationSchema, RealmSupportObservationSchema } from '@chatdom/shared/realm';
import { isStrike, spectacleNotice, streamNotice } from './spectacles';
import { channelChatNotification } from '../twitch-moments/notices';
import { IGNORED } from '../twitch-moments/normalizer';
import { toPresenceInput, type Observation } from '../source/observations';
import type { PresenceSource, SubmitResult } from '../source/source';
import type { HeraldEventType, SubscriptionPlan } from './subscriptions';
import { TtlMap } from './ttl';
import { extractForgeWords, ForgeCommandHandoff, type ForgeCommandApplication } from '../forge/commands';
import { speechParts, type RealmDeliverySink } from '../realm-delivery/sink';
import { raidObservation } from './raids';
import { chatCommand } from './commands';

/** Twitch redelivers within minutes; ten minutes of keys covers a reconnect handover and its resends. */
export const DEDUPE_TTL_MS = 600_000;
const DEDUPE_CAPACITY = 20_000;
const TOMBSTONE_CAPACITY = 20_000;
const AUTHOR_CLEAR_CAPACITY = 10_000;
/** Activity in the source queue at once. Beyond this, new chat is dropped and counted (cleanup never is). */
const PENDING_LIMIT = 2_048;
/** Recent chat timings kept for the latency summary on health. */
const TIMING_SAMPLES = 64;
/**
 * A message stamped up to this far after our own receipt is accepted at its receipt time (it certainly
 * existed by then); further ahead is a clock we cannot trust and is rejected as future.
 */
export const CLOCK_SKEW_MS = 5_000;

export interface IngestCounters {
  deliveries: number;
  duplicateDeliveries: number;
  duplicateMessages: number;
  malformed: number;
  /** Notifications for a subscription that is not one of ours (wrong conduit, condition, type or version). */
  unverified: number;
  /** Chat that arrived while required delivery or cleanup coverage was incomplete. */
  notCovered: number;
  future: number;
  expired: number;
  preStart: number;
  /** Chat that arrived after its own delete, its author's clear or a room clear. */
  tombstoned: number;
  /** Messages a shared chat brought in from another channel: guests, never this kingdom's citizens. */
  sharedChatGuests: number;
  /** Activity withdrawn while still waiting to apply. */
  canceled: number;
  pendingOverflow: number;
  chatSubmitted: number;
  deletes: number;
  userClears: number;
  roomClears: number;
  streamChanges: number;
  /** `stream.online` for a rerun, playlist or premiere: no broadcast, so the beacon stays as it was. */
  notLive: number;
  revocations: number;
  authorizationRevokes: number;
  /** Bits, Hype Train, raid, follow, reward, poll and night notifications handed to the realm's durable outbox. */
  spectacles: number;
  /** `!strike` messages relayed to the realm's battle. */
  strikes: number;
  raids: number;
  raidRefused: number;
  commands: number;
  commandCleanups: number;
  commandRefused: number;
  commandExpired: number;
}

/** One chat act's timing, numbers only: when Twitch stamped it, when it reached us and when its frame went out. */
export interface ChatTiming {
  /** Twitch's `message_timestamp`, or our receipt when that runs up to five seconds ahead. */
  readonly occurredAt: number;
  readonly receivedAt: number;
  /** When the act applied; the frame projected in that same step is the one reflecting it. */
  readonly appliedAt: number;
  /** That frame's sequence, or null when no frame existed yet. */
  readonly sequence: number | null;
}

/** Twitch-to-Herald and Herald-to-frame delay over the last 64 applied chat acts. */
export interface ChatLatency {
  readonly samples: number;
  readonly last: ChatTiming | null;
  readonly twitchMs: { readonly median: number; readonly max: number } | null;
  readonly heraldMs: { readonly median: number; readonly max: number } | null;
}

export interface IngestHealth {
  readonly counters: Readonly<IngestCounters>;
  readonly pending: number;
  readonly lastChatAt: number | null;
  readonly evictions: number;
  readonly latency: ChatLatency;
}

interface PendingActivity {
  readonly authorId: string;
  readonly occurredAt: number;
  readonly receivedAt: number;
  canceled: boolean;
}

export interface IngestOptions {
  readonly realm?: RealmDeliverySink;
  readonly source: PresenceSource;
  readonly conduitId: string;
  readonly clientId: string;
  readonly plans: readonly SubscriptionPlan[];
  /** Whether chat activity may be published now: shard attached, chat grants and every required subscription. */
  readonly covered: () => boolean;
  /** A `user.authorization.revoke` for a configured account. */
  readonly onAuthorizationRevoked: (userId: string) => void;
  /** Twitch disabled one of our subscriptions; `status` is its short code. */
  readonly onSubscriptionRevoked: (plan: SubscriptionPlan, status: string) => void;
  /**
   * Where pushed stream changes go. The live source passes its stream tracker, which also holds the polled
   * Get Streams state; without one they go straight to the source.
   */
  readonly stream?: (observation: Extract<Observation, { readonly kind: 'stream' }>) => void;
  /** Optional trusted creation application; ordinary presence never retains or exports message text. */
  readonly forge?: ForgeCommandApplication;
  readonly now?: () => number;
}

/**
 * Turns verified EventSub deliveries into presence observations. An explicitly installed Forge application
 * separately receives only bounded creation wishes after the presence binding applies. Ordinary chat bodies
 * are discarded. Delivery IDs and chat message IDs are deduplicated separately; deletes,
 * user clears and room clears cancel activity still waiting to apply and leave tombstones so late or
 * reordered delivery cannot bring it back. Only bounded IDs and times are kept, and only for ten minutes.
 */
export class ChatIngest {
  readonly kingdomId: KingdomId;
  readonly startedAt: number;
  readonly #options: IngestOptions;
  readonly #now: () => number;
  readonly #forge: ForgeCommandHandoff | null;
  readonly #deliveries = new TtlMap<string, true>(DEDUPE_TTL_MS, DEDUPE_CAPACITY);
  readonly #messages = new TtlMap<string, true>(DEDUPE_TTL_MS, DEDUPE_CAPACITY);
  readonly #deleted = new TtlMap<string, true>(DEDUPE_TTL_MS, TOMBSTONE_CAPACITY);
  readonly #authorClears = new TtlMap<string, number>(DEDUPE_TTL_MS, AUTHOR_CLEAR_CAPACITY);
  readonly #pending = new Map<string, PendingActivity>();
  readonly #pendingWrites = new Map<string, Promise<void>>();
  readonly #pendingCommands = new Map<string, Promise<void>>();
  readonly #counters: IngestCounters = {
    deliveries: 0, duplicateDeliveries: 0, duplicateMessages: 0, malformed: 0, unverified: 0, notCovered: 0, future: 0,
    expired: 0, preStart: 0, tombstoned: 0, sharedChatGuests: 0, canceled: 0, pendingOverflow: 0, chatSubmitted: 0,
    deletes: 0, userClears: 0, roomClears: 0, streamChanges: 0, notLive: 0, revocations: 0, authorizationRevokes: 0,
    spectacles: 0, strikes: 0, raids: 0, raidRefused: 0, commands: 0, commandCleanups: 0, commandRefused: 0, commandExpired: 0,
  };
  #roomClearedAt = -1;
  #lastChatAt: number | null = null;
  readonly #timings: ChatTiming[] = [];
  #timed = 0;

  constructor(options: IngestOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.kingdomId = KingdomIdSchema.parse(options.source.kingdomId);
    this.startedAt = this.#now();
    this.#forge = options.forge ? new ForgeCommandHandoff(options.source, options.forge, this.#now) : null;
  }

  /** Redacted counters and bounded cache sizes; never IDs or names. */
  health(): IngestHealth {
    return {
      counters: { ...this.#counters }, pending: this.#pending.size, lastChatAt: this.#lastChatAt,
      evictions: this.#deliveries.evicted + this.#messages.evicted + this.#deleted.evicted + this.#authorClears.evicted,
      latency: {
        samples: this.#timed,
        last: this.#timings.at(-1) ?? null,
        twitchMs: spread(this.#timings.map(timing => timing.receivedAt - timing.occurredAt)),
        heraldMs: spread(this.#timings.map(timing => timing.appliedAt - timing.receivedAt)),
      },
    };
  }

  /** Evidence promises resolve only after durable enqueue; webhook transports await before acknowledging. */
  handle(frame: DeliveryFrame): void | Promise<void> {
    const receivedAt = this.#now();
    this.#counters.deliveries++;
    const pendingWrite = this.#pendingWrites.get(frame.meta.messageId);
    if (pendingWrite || this.#deliveries.has(frame.meta.messageId, receivedAt)) {
      this.#counters.duplicateDeliveries++;
      return pendingWrite;
    }
    const plan = this.#verify(frame);
    if (!plan) {
      this.#counters.unverified++;
      return;
    }
    this.#deliveries.set(frame.meta.messageId, true, receivedAt);
    if (frame.kind === 'revocation') {
      this.#counters.revocations++;
      this.#options.onSubscriptionRevoked(plan, /^[a-z_]{1,64}$/.test(frame.subscription.status) ? frame.subscription.status : 'disabled');
      return;
    }
    const at = this.#observedAt(frame.meta.at, receivedAt);
    switch (plan.type) {
      case 'channel.chat.notification': return this.#support(frame.event, frame.meta.messageId, at, receivedAt);
      case 'channel.chat.message': return this.#chat(frame.event, frame.meta.messageId, at, receivedAt);
      case 'channel.chat.message_delete': return this.#delete(frame.event, frame.meta.messageId, at ?? receivedAt, receivedAt);
      case 'channel.chat.clear': return this.#roomClear(frame.event, frame.meta.messageId, at ?? receivedAt);
      case 'channel.chat.clear_user_messages': return this.#userClear(frame.event, frame.meta.messageId, at, receivedAt);
      case 'stream.online': return this.#online(frame.event, at, frame.meta.messageId, receivedAt);
      case 'stream.offline': return this.#offline(frame.event, at, frame.meta.messageId, receivedAt);
      case 'user.authorization.revoke': return this.#authorizationRevoke(frame.event);
      case 'channel.raid': return this.#raid(plan, frame.event, frame.meta.messageId, at === null ? null : frame.meta.at, receivedAt);
      case 'channel.bits.use': case 'channel.hype_train.begin': case 'channel.hype_train.progress': case 'channel.hype_train.end':
      case 'channel.follow': case 'channel.channel_points_custom_reward_redemption.add':
      case 'channel.poll.begin': case 'channel.poll.progress': case 'channel.poll.end':
        return this.#spectacle(plan.type, frame.event, frame.meta.messageId, at, receivedAt);
    }
  }

  /** Shutdown or revocation: cancel everything waiting and forget every transient key. */
  clear(): void {
    this.#options.realm?.clear(this.kingdomId);
    this.#forge?.clear();
    for (const pending of this.#pending.values()) pending.canceled = true;
    this.#pending.clear();
    this.#deliveries.clear();
    this.#messages.clear();
    this.#deleted.clear();
    this.#authorClears.clear();
    this.#roomClearedAt = Math.max(this.#roomClearedAt, this.#now());
  }

  dispose(): void { this.clear(); this.#forge?.dispose(); }

  /** The frame's subscription must be exactly one of ours: this conduit, a planned type/version/condition. */
  #verify(frame: DeliveryFrame): SubscriptionPlan | null {
    const subscription = frame.subscription;
    if (subscription.conduitId !== this.#options.conduitId) return null;
    const plan = this.#options.plans.find(candidate => matchesRequest(subscription, candidate));
    if (!plan) return null;
    if (frame.kind === 'notification' && subscription.status !== 'enabled') return null;
    return plan;
  }

  /** Event time as Herald may use it, or null when it is in the future beyond tolerable clock skew. */
  #observedAt(sentAt: number, receivedAt: number): number | null {
    if (sentAt - receivedAt > CLOCK_SKEW_MS) return null;
    return Math.min(sentAt, receivedAt);
  }

  #support(raw: unknown, id: string, at: number | null, receivedAt: number): void {
    if (at === null) { this.#counters.future++; return; }
    if (!this.#options.covered()) { this.#counters.notCovered++; return; }
    const notice = channelChatNotification.parse(raw, this.kingdomId);
    if (notice === IGNORED) return;
    if (notice === null) { this.#counters.malformed++; return; }
    // A subscriber's public name travels with their entitlement, so one with no home yet can be settled for the banner.
    const named = notice.kind === 'entitlement' ? { ...notice, name: chatterName(raw) } : notice;
    const result = RealmSupportObservationSchema.safeParse({ version: 1, id, kingdomId: this.kingdomId,
      origin: this.#options.source.origin, occurredAt: at, receivedAt, notice: named });
    if (!result.success) { this.#counters.malformed++; return; }
    void this.#options.realm?.support?.(result.data).catch(() => undefined);
  }

  #raid(plan: SubscriptionPlan, raw: unknown, id: string, at: number | null, receivedAt: number): void | Promise<void> {
    const sink = this.#options.realm;
    if (!sink?.raid) return this.#spectacle('channel.raid', raw, id, at, receivedAt);
    if (at === null) { this.#counters.future++; return; }
    const observation = raidObservation(raw, { plan, kingdomId: this.kingdomId, id,
      origin: this.#options.source.origin, occurredAt: at, receivedAt });
    if (observation === IGNORED) return;
    if (observation === null) { this.#counters.malformed++; return; }
    return this.#durable(id, () => sink.raid!(observation), 'raids', 'raidRefused');
  }

  #durable(id: string, write: () => Promise<void>, accepted: 'raids' | 'commands' | 'commandCleanups', refused: 'raidRefused' | 'commandRefused'): Promise<void> {
    if (this.#pendingWrites.size >= PENDING_LIMIT) {
      this.#deliveries.delete(id); this.#counters[refused]++;
      return Promise.reject(new Error('Herald evidence writes exceed pending capacity'));
    }
    const pending = Promise.resolve().then(write).then(() => {
      this.#counters[accepted]++;
    }, error => {
      this.#deliveries.delete(id); this.#counters[refused]++;
      throw error;
    }).finally(() => { this.#pendingWrites.delete(id); });
    this.#pendingWrites.set(id, pending);
    return pending;
  }

  #commandCleanup(messageId: string, at: number, twitchId: string | null, targetMessageId: string | null): void | Promise<void> {
    const sink = this.#options.realm;
    if (!sink?.command) return;
    const result = ChatCommandEnvelopeSchema.safeParse({ version: 1, kind: 'cleanup', origin: this.#options.source.origin,
      kingdomId: this.kingdomId, messageId, at, twitchId, targetMessageId, reason: targetMessageId === null ? 'clear' : 'delete' });
    if (!result.success) { this.#counters.malformed++; return; }
    return this.#durable(messageId, () => sink.command!(result.data), 'commandCleanups', 'commandRefused');
  }

  /**
   * Bits, the Hype Train and incoming raids. Verified frames from our own conduit; they do not wait for chat
   * coverage, because they light no window and name nobody beyond what Twitch made public.
   */
  #spectacle(type: HeraldEventType, raw: unknown, id: string, at: number | null, receivedAt: number): void {
    if (at === null) { this.#counters.future++; return; }
    const notice = spectacleNotice(type, raw, this.kingdomId);
    if (notice === IGNORED) return;
    if (notice === null) { this.#counters.malformed++; return; }
    const result = RealmMomentObservationSchema.safeParse({ version: 1, id, kingdomId: this.kingdomId,
      origin: this.#options.source.origin, occurredAt: at, receivedAt, notice });
    if (!result.success) { this.#counters.malformed++; return; }
    this.#counters.spectacles++;
    void this.#options.realm?.moment?.(result.data).catch(() => undefined);
  }

  #chat(raw: unknown, deliveryId: string, at: number | null, receivedAt: number): void | Promise<void> {
    const parsed = ChatMessageEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.broadcaster_user_id !== this.kingdomId) {
      this.#counters.malformed++;
      return;
    }
    const event = parsed.data;
    const pendingCommand = this.#pendingCommands.get(event.message_id);
    if (pendingCommand || this.#messages.has(event.message_id, receivedAt)) {
      this.#counters.duplicateMessages++;
      const pending = pendingCommand;
      if (!pending) return;
      if (this.#pendingWrites.size >= PENDING_LIMIT) {
        this.#deliveries.delete(deliveryId); this.#counters.commandRefused++;
        return Promise.reject(new Error('Herald evidence writes exceed pending capacity'));
      }
      const retryable = pending.catch(error => { this.#deliveries.delete(deliveryId); throw error; });
      this.#pendingWrites.set(deliveryId, retryable);
      return retryable.finally(() => { this.#pendingWrites.delete(deliveryId); });
    }
    this.#messages.set(event.message_id, true, receivedAt);
    if (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== this.kingdomId) {
      this.#counters.sharedChatGuests++;
      return;
    }
    if (at === null) {
      this.#counters.future++;
      return;
    }
    if (at < this.startedAt) {
      this.#counters.preStart++;
      return;
    }
    if (receivedAt - at >= PRESENCE_LEASE_MS) {
      this.#counters.expired++;
      return;
    }
    if (this.#deleted.has(event.message_id, receivedAt) || at <= this.#roomClearedAt || at <= (this.#authorClears.get(event.chatter_user_id, receivedAt) ?? -1)) {
      this.#counters.tombstoned++;
      return;
    }
    if (!this.#options.covered()) {
      this.#counters.notCovered++;
      return;
    }
    let commandWrite: Promise<void> | undefined;
    const sink = this.#options.realm;
    const command = sink?.command ? chatCommand(raw, this.kingdomId, this.#options.source.origin, at) : null;
    if (command) {
      if (receivedAt - at >= CHAT_COMMAND_MAX_AGE_MS) this.#counters.commandExpired++;
      else {
        commandWrite = this.#durable(deliveryId, () => sink!.command!(command), 'commands', 'commandRefused').catch(error => {
          this.#messages.delete(event.message_id); throw error;
        }).finally(() => { this.#pendingCommands.delete(event.message_id); });
        this.#pendingCommands.set(event.message_id, commandWrite);
      }
    }
    if (this.#pending.size >= PENDING_LIMIT) {
      this.#counters.pendingOverflow++;
      return commandWrite;
    }
    const observation: Observation = { kind: 'chat', messageId: event.message_id, at, author: { id: event.chatter_user_id, displayName: event.chatter_user_name } };
    const input = this.#input(observation);
    if (!input) return commandWrite;
    const pending: PendingActivity = { authorId: event.chatter_user_id, occurredAt: at, receivedAt, canceled: false };
    this.#pending.set(event.message_id, pending);
    this.#counters.chatSubmitted++;
    this.#lastChatAt = receivedAt;
    const words = this.#forge || this.#options.realm ? extractForgeWords(raw) : null;
    const strike = this.#options.realm ? isStrike(raw) : false;
    const parts = this.#options.realm ? speechParts(raw) : [];
    const valid = () => !pending.canceled && this.#options.covered();
    const broadcast = this.#options.forge?.broadcast, generation = broadcast?.generation, liveAtReceipt = broadcast?.live;
    const forgeValid = () => valid() && liveAtReceipt === true && broadcast?.generation === generation;
    void this.#options.source.submit(input, valid).then(result => {
      this.#settled(event.message_id, pending, result);
      if (result === 'applied' && strike && valid() && this.#options.realm?.strike) {
        this.#counters.strikes++;
        this.#options.realm.strike({ version: 1, kingdomId: this.kingdomId, personId: PersonIdSchema.parse(event.chatter_user_id),
          messageId: event.message_id, origin: this.#options.source.origin, observedAt: at }, valid);
      }
      if (result === 'applied' && valid()) this.#options.realm?.speech({ kingdomId: this.kingdomId,
        personId: PersonIdSchema.parse(event.chatter_user_id), messageId: event.message_id,
        observedAt: at, parts, words }, valid);
      if (result === 'applied' && words !== null && forgeValid()) this.#forge?.offer({
        personId: event.chatter_user_id, messageId: event.message_id, words, observedAt: at,
      }, forgeValid);
    }, () => this.#settled(event.message_id, pending, 'rejected'));
    return commandWrite;
  }

  #settled(messageId: string, pending: PendingActivity, result: SubmitResult): void {
    if (this.#pending.get(messageId) === pending) this.#pending.delete(messageId);
    if (result === 'canceled') this.#counters.canceled++;
    if (result !== 'applied') return;
    this.#timings.push({ occurredAt: pending.occurredAt, receivedAt: pending.receivedAt, appliedAt: this.#now(), sequence: this.#options.source.sequence });
    if (this.#timings.length > TIMING_SAMPLES) this.#timings.shift();
    this.#timed++;
  }

  #delete(raw: unknown, deliveryId: string, at: number, receivedAt: number): void | Promise<void> {
    const parsed = ChatMessageDeleteEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.broadcaster_user_id !== this.kingdomId) {
      this.#counters.malformed++;
      return;
    }
    this.#counters.deletes++;
    // Delete alone withdraws that one message's activity; it does not hide its author.
    this.#deleted.set(parsed.data.message_id, true, receivedAt);
    this.#options.realm?.remove(this.kingdomId, parsed.data.message_id);
    this.#forge?.cancel(parsed.data.message_id);
    const pending = this.#pending.get(parsed.data.message_id);
    if (pending) pending.canceled = true;
    return this.#commandCleanup(deliveryId, at, parsed.data.target_user_id, parsed.data.message_id);
  }

  #roomClear(raw: unknown, deliveryId: string, at: number): void | Promise<void> {
    const parsed = ChatClearEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.broadcaster_user_id !== this.kingdomId) {
      this.#counters.malformed++;
      return;
    }
    this.#counters.roomClears++;
    // A room clear withdraws waiting activity only. Nobody's identity is erased and no light goes out.
    this.#roomClearedAt = Math.max(this.#roomClearedAt, at);
    this.#options.realm?.clear(this.kingdomId);
    this.#forge?.clear();
    for (const pending of this.#pending.values()) pending.canceled = true;
    return this.#commandCleanup(deliveryId, at, null, null);
  }

  #userClear(raw: unknown, deliveryId: string, at: number | null, receivedAt: number): void | Promise<void> {
    const parsed = ChatClearUserMessagesEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.broadcaster_user_id !== this.kingdomId) {
      this.#counters.malformed++;
      return;
    }
    const target = parsed.data.target_user_id;
    this.#options.realm?.clear(this.kingdomId, PersonIdSchema.parse(target));
    this.#forge?.cancelAuthor(target);
    const clearedAt = at ?? receivedAt;
    this.#counters.userClears++;
    this.#authorClears.set(target, Math.max(clearedAt, this.#authorClears.get(target, receivedAt) ?? -1), receivedAt);
    for (const pending of this.#pending.values()) if (pending.authorId === target) pending.canceled = true;
    // Chatdom's finite protective hold: the window goes dark now and stays dark for ten minutes.
    this.#submit({ kind: 'user_clear', eventId: deliveryId, at: clearedAt, userId: target });
    return this.#commandCleanup(deliveryId, clearedAt, target, null);
  }

  /** The night's evidence for the realm: the gate opens when a broadcast starts and rests when it ends. */
  #night(live: boolean, id: string, streamId: string | null, startedAt: number | null, at: number, receivedAt: number): void {
    const notice = streamNotice(live, streamId, startedAt);
    if (!notice) return;
    const result = RealmMomentObservationSchema.safeParse({ version: 1, id, kingdomId: this.kingdomId,
      origin: this.#options.source.origin, occurredAt: at, receivedAt, notice });
    if (!result.success) return;
    this.#counters.spectacles++;
    void this.#options.realm?.moment?.(result.data).catch(() => undefined);
  }

  #online(raw: unknown, at: number | null, id: string, receivedAt: number): void {
    const parsed = StreamOnlineEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.broadcaster_user_id !== this.kingdomId) {
      this.#counters.malformed++;
      return;
    }
    if (parsed.data.type !== 'live') {
      this.#counters.notLive++;
      return;
    }
    if (at === null) {
      this.#counters.future++;
      return;
    }
    this.#counters.streamChanges++;
    this.#stream({ kind: 'stream', at, live: true, streamId: parsed.data.id });
    const startedAt = parsed.data.started_at ?? null;
    this.#night(true, id, parsed.data.id, startedAt, at, receivedAt);
  }

  #offline(raw: unknown, at: number | null, id: string, receivedAt: number): void {
    const parsed = StreamOfflineEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.broadcaster_user_id !== this.kingdomId) {
      this.#counters.malformed++;
      return;
    }
    if (at === null) {
      this.#counters.future++;
      return;
    }
    this.#counters.streamChanges++;
    this.#stream({ kind: 'stream', at, live: false });
    this.#night(false, id, null, null, at, receivedAt);
  }

  #authorizationRevoke(raw: unknown): void {
    const parsed = AuthorizationRevokeEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.client_id !== this.#options.clientId) {
      this.#counters.malformed++;
      return;
    }
    this.#counters.authorizationRevokes++;
    this.#options.onAuthorizationRevoked(parsed.data.user_id);
  }

  #stream(observation: Extract<Observation, { readonly kind: 'stream' }>): void {
    if (this.#options.stream) this.#options.stream(observation);
    else this.#submit(observation);
  }

  #submit(observation: Observation): void {
    const input = this.#input(observation);
    if (input) void this.#options.source.submit(input).catch(() => undefined);
  }

  #input(observation: Observation) {
    try {
      return toPresenceInput(observation, this.kingdomId, this.#options.source.origin);
    } catch {
      this.#counters.malformed++;
      return null;
    }
  }
}

function chatterName(raw: unknown): string | null {
  const name = (raw as { chatter_user_name?: unknown } | null)?.chatter_user_name;
  return typeof name === 'string' && name.length > 0 && name.length <= 128 ? name : null;
}

function spread(values: readonly number[]): { readonly median: number; readonly max: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor((sorted.length - 1) / 2)]!, max: sorted[sorted.length - 1]! };
}
