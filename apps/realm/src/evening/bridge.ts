import { createHash } from 'node:crypto';
import { CitizenChatCueSchema, PRESENCE_LEASE_MS, type CitizenChatCue, type ForgeChatObservation, type ForgeChatObserver, type KingdomId, type PresenceInput } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, RealmHeraldEnvelopeSchema, RealmHeraldForgeCommandSchema, type KingdomForgeCommand, type KingdomForgeLease, type KingdomForgeOutcome, type RealmHeraldChat, type RealmPrivateMessage } from '@chatdom/shared/realm';
import { createKingdomForgeApplication, type KingdomForgeFault, type KingdomForgeResult } from '../../../codex/src/kingdom-forge/application';
import { createForgeProviders, type ForgeProviders } from '../../../codex/src/providers';
import { createWarmCodexRunner, type WarmCodexRunner } from '../../../codex/src/providers/warm';
import { decodeIngressCheckpoint, presenceEpoch, presencePerson, type IngressReply, type RealmIngress } from '../ingress';
import type { DurableKingdom, DurableRealmServices } from '../persistence';
import { createForgeAuthority, forgeMessageKey, type FileForgeApprovals, type ForgeWriteGate, type RealmWiringLog } from '../wiring';
import { forgeDeliveryMessage } from '../../../codex/src/wish-decision';
import { createQueuedKingdomForgeApplication } from '../../../codex/src/kingdom-forge/recovery';
import { FileForgeWishQueue, ForgeWishQueueError, type ForgeWishClaim, type ForgeWishReceipt, type ForgeWishWithdrawal } from '../../../codex/src/wish-queue';
import { ForgeWishWorker, type ForgeWishExecutionControl } from '../../../codex/src/wish-worker';
import { forgeHostForPerson } from '@chatdom/shared/realm';
import { ForgeRitualPresenter } from '../forge-queue/presenter';
import type { ForgeQueueSource } from '../forge-queue/http';

const MAX_PENDING = 32;
const RUN_LEASE_MS = 600_000;
/**
 * How long a wish waits for its own chat message to be committed as presence. The writer may be busy landing another
 * piece (its scene rebuild takes seconds on a loaded host); nothing is reserved or spent while the wish waits.
 */
const EVIDENCE_WAIT_MS = 30_000;
const UNHEARD = 'The forge could not hear your wish in chat just now. Nothing was spent; your coal stays yours. Please say it again.';
/** The kingdom's records could not be read or written before the wish began. */
const UNREACHABLE = 'The forge could not reach the kingdom\'s records just now, so your wish did not begin. Nothing was spent; your coal stays yours. Please send it again in a moment.';
const LATE = 'The forge heard your wish too late to begin it. Nothing was spent; your coal stays yours. Please say it again.';
/** The witness is re-read at this pace: often enough to start promptly, rarely enough not to crowd a busy database. */
const EVIDENCE_POLL_MS = 250;
/** Herald and the database keep separate clocks; a chat observation this far ahead of the database still counts. */
const CLOCK_SKEW_MS = 2_000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export interface RealmEveningOptions {
  readonly origin: 'live' | 'simulated';
  readonly ingress: Pick<RealmIngress, 'accept' | 'gate'>;
  /** The SAME gate installed in this registry's repository options. */
  readonly gate: ForgeWriteGate;
  /** The SAME private approval sink the authority reads before committing. */
  readonly approvals: FileForgeApprovals;
  /** Defaults to the existing Codex CLI providers; there is no API-key provider path. */
  readonly providers?: ForgeProviders;
  /** Authenticated normalized Herald evidence only. A failed prerequisite leaves it for the sender to retry. */
  readonly beforeObservation?: (input: PresenceInput) => Promise<void>;
  /** Owner-only chat progress. Failure cannot undo, refuse or repeat an authoritative Forge run. */
  readonly forgeChatObserver?: ForgeChatObserver;
  /** Private operational codes from the authority and the run (never words, people or drafts). */
  /** How long a wish waits for its chat witness to commit; defaults to EVIDENCE_WAIT_MS. Tests shorten it. */
  readonly evidenceWaitMs?: number;
  readonly forgeLog?: (event: RealmWiringLog | (KingdomForgeFault & { readonly kind: 'forge-fault'; readonly kingdomId: KingdomId })) => void;
  /**
   * The durable wish line. When set, a wish is written to this private directory before Herald hears 202, survives
   * a restart at any stage, forges alongside a few others, and reaches the room one ritual at a time in order.
   */
  readonly forgeQueue?: {
    readonly directory: string;
    /** Wishes forged at once across the realm (each kingdom is still bounded by its anvils). */
    readonly maxConcurrent?: number;
    readonly retryMs?: number;
    /** Presentation pacing; tests shorten these. */
    readonly ritualMs?: number;
    readonly revealMs?: number;
  };
  /** Chat commands a feature claims once the chatter has a lit window (pier's `!fish`). True means no speech bubble. */
  readonly chatCommands?: {
    chat(input: RealmHeraldChat, kingdom: DurableKingdom, slot: number): boolean;
    cleanup(kingdomId: KingdomId, filter: { readonly messageIds?: readonly string[]; readonly personId?: string }): void;
  };
}

type Application = ReturnType<typeof createKingdomForgeApplication>;
type Authority = ReturnType<typeof createForgeAuthority>;
type QueuedApplication = ReturnType<typeof createQueuedKingdomForgeApplication>;
interface Context { readonly kingdom: DurableKingdom; readonly run: Application; readonly authority: Authority; queued?: QueuedApplication; readonly stop: () => void }
type WishRef = Pick<KingdomForgeCommand, 'kingdomId' | 'personId' | 'messageId'>;
const OFFLINE = 'The forge fire rests while the stream is offline. Bring your wish when the kingdom wakes; your coal stays yours.';
const INTAKE_CHECKPOINT = 'realm-intake';
const terminalKinds = new Set(['committed', 'held', 'cold', 'canceled', 'refused']);
interface Pending { readonly command: KingdomForgeCommand; readonly abort: AbortController; readonly promise: Promise<KingdomForgeOutcome> }
type ForgeChatProgress<T = ForgeChatObservation> = T extends ForgeChatObservation
  ? Omit<T, 'origin' | 'kingdomId' | 'personId' | 'messageId' | 'at'> : never;

/**
 * Herald's evening consumer. The registry remains the only owner of a writer; this module takes counted
 * holds, runs the existing coordinator and authority, and sends only transient activity/owner messages.
 * An approved attachment is published exclusively by the authority's durable transaction/outbox.
 */
export class RealmEveningBridge {
  private services: DurableRealmServices | null = null;
  private readonly contexts = new Map<KingdomId, Context>();
  private readonly pending = new Map<string, Pending>();
  private readonly providers: ForgeProviders;
  private readonly withdrawn = new Map<string, number>();
  /** Active speech metadata only: never retain text, fragments or an ordinary chat archive. */
  private readonly speechActive = new Map<string, { readonly kingdomId: KingdomId; readonly personId: string; readonly cueId: string; readonly expiresAt: number }>();
  private readonly speechWithdrawn = new Map<string, number>();
  private readonly speechCleared = new Map<string, { readonly through: number; readonly until: number }>();
  private speechWaiting = 0;
  private stopped = false;
  private queue: FileForgeWishQueue | null = null;
  private worker: ForgeWishWorker | null = null;
  private starting: Promise<void> | undefined;
  readonly presenter: ForgeRitualPresenter;
  /** The Forge's own long-lived model process; calls fall back to cold runs on their own when it is down. */
  private readonly warm: WarmCodexRunner | null = null;
  /** The latest offline cut per kingdom, so a wish it stopped says why. Memory only; a restart says the plain stop. */
  private readonly offlineThrough = new Map<KingdomId, number>();

  constructor(readonly options: RealmEveningOptions) {
    if (!options.providers && process.env.FORGE_WARM !== '0') this.warm = createWarmCodexRunner();
    this.providers = options.providers ?? createForgeProviders(this.warm ? { runCodex: this.warm } : {});
    this.presenter = new ForgeRitualPresenter({
      publish: (kingdomId, event) => { const kingdom = this.services?.kingdoms.get(kingdomId); if (kingdom?.current) kingdom.transient({ type: 'forge', event }); },
      ...(options.forgeQueue?.ritualMs !== undefined ? { minimumMs: options.forgeQueue.ritualMs } : {}),
      ...(options.forgeQueue?.revealMs !== undefined ? { revealMs: options.forgeQueue.revealMs } : {}),
    });
  }

  /** Open the durable wish line and resume every wish a previous process left unfinished. */
  start(): Promise<void> {
    const config = this.options.forgeQueue;
    if (!config) return Promise.resolve();
    this.starting ??= (async () => {
      const maxConcurrent = config.maxConcurrent ?? 3;
      const queue = await FileForgeWishQueue.open({ directory: config.directory, origin: this.options.origin, maxConcurrent, maxPending: 256 });
      const worker = new ForgeWishWorker({ queue, maxConcurrent, retryMs: config.retryMs ?? 1_000,
        execute: (claim, control) => this.execute(claim, control),
        completed: receipt => this.completed(receipt) });
      // A week of finished, heard wishes is plenty to recognise a late duplicate from Herald.
      await queue.prune(Date.now() - 7 * 24 * 60 * 60_000).catch(() => 0);
      for (const receipt of await queue.list()) if (receipt.state !== 'finished') this.presenter.track(receipt);
      this.queue = queue; this.worker = worker;
      try { await worker.start(); } catch (error) { this.queue = null; this.worker = null; await queue.close().catch(() => {}); throw error; }
    })();
    return this.starting;
  }

  /** The anvil's public line for the queue route. */
  readonly line: ForgeQueueSource = {
    line: kingdomId => this.presenter.line(kingdomId),
    name: (kingdomId, personId) => {
      const kingdom = this.services?.kingdoms.get(kingdomId);
      return kingdom ? forgeHostForPerson(kingdom.privateState, personId as never)?.attribution.makerName ?? null : null;
    },
  };

  use(services: DurableRealmServices): void {
    if (this.services && this.services !== services) throw new Error('The evening bridge already belongs to a realm registry');
    this.services = services;
  }

  /** Compose with ingress.attach in the registry's existing attach hook. Never opens another writer. */
  attach(kingdom: DurableKingdom): () => void {
    if (kingdom.origin !== this.options.origin) throw new Error('The evening bridge cannot attach a kingdom of another origin');
    const previous = this.contexts.get(kingdom.kingdomId);
    if (previous?.kingdom === kingdom) return () => {};
    previous?.stop();
    const authority = createForgeAuthority({ kingdomId: kingdom.kingdomId, origin: kingdom.origin,
      retain: async () => {
        const hold = await this.services?.retain(kingdom.kingdomId);
        if (!hold) return null;
        if (hold.kingdom !== kingdom || !kingdom.current) { await hold.release(); return null; }
        return hold;
      },
    }, { gate: this.options.gate, approvals: this.options.approvals }, event => this.options.forgeLog?.(event));
    const run = createKingdomForgeApplication({ authority, providers: this.providers,
      now: () => kingdom.databaseNow(), record: audit => this.options.approvals.record(audit),
      fault: fault => this.options.forgeLog?.({ kind: 'forge-fault', kingdomId: kingdom.kingdomId, ...fault }),
      publish: event => {
        // The committed event has already been persisted and queued by the authority. Re-emitting it
        // here would race the delivery cursor and repeat the reveal after reconnect.
        if (event.type !== 'committed') kingdom.transient({ type: 'forge', event });
      },
    });
    const off = kingdom.onClosed(() => stop());
    const stop = () => {
      off();
      if (this.contexts.get(kingdom.kingdomId)?.kingdom !== kingdom) return;
      this.contexts.delete(kingdom.kingdomId);
      // A durable wish only pauses when its kingdom closes; it resumes when the kingdom opens again.
      if (!this.worker) this.cancel(kingdom.kingdomId);
    };
    this.contexts.set(kingdom.kingdomId, { kingdom, run, authority, stop });
    return stop;
  }

  /** In-process adapter for Herald's existing ForgeCommandSink. */
  readonly sink = async (command: KingdomForgeCommand, lease: KingdomForgeLease): Promise<void> => {
    if (this.worker) { await this.admit(command); return; }
    await this.run(command, lease);
  };

  async run(command: KingdomForgeCommand, incoming?: KingdomForgeLease): Promise<KingdomForgeOutcome> {
    if (this.stopped || !this.services) return { kind: 'cold' };
    const parsed = RealmHeraldForgeCommandSchema.safeParse(command);
    if (!parsed.success) return { kind: 'held' };
    command = parsed.data;
    const key = this.key(command.kingdomId, command.messageId);
    this.sweepWithdrawn();
    if (this.withdrawn.has(key)) {
      await this.observe(command, { status: 'canceled', message: 'The wish has stopped. Your coal stays yours.' });
      return { kind: 'canceled' };
    }
    const active = this.pending.get(key);
    if (active) return active.promise;
    if (this.pending.size >= MAX_PENDING) {
      await this.observe(command, { status: 'held', message: 'Every anvil is busy just now. Your wish has not started; your coal stays yours.' });
      return { kind: 'held' };
    }
    const abort = new AbortController();
    const signal = incoming ? AbortSignal.any([abort.signal, incoming.signal]) : abort.signal;
    // Reserve the bounded handoff slot BEFORE awaiting the registry, including a cold/slow opening.
    // Keep the opened kingdom so a later failure still answers its owner privately.
    let opened: DurableKingdom | undefined;
    const promise = Promise.resolve().then(async (): Promise<KingdomForgeOutcome> => {
      const hold = await this.services!.retain(command.kingdomId);
      const kingdom = hold.kingdom;
      opened = kingdom;
      try {
        if (!this.contexts.has(command.kingdomId)) this.attach(kingdom);
        const context = this.contexts.get(command.kingdomId);
        if (!context || context.kingdom !== kingdom) {
          this.fault(command.kingdomId, 'dependency');
          const unreachable: KingdomForgeResult = { kind: 'cold', privateMessage: UNREACHABLE };
          this.privateOutcome(kingdom, command, unreachable);
          return unreachable;
        }
        const started = kingdom.databaseNow();
        if (command.observedAt > started + CLOCK_SKEW_MS || started - command.observedAt >= PRESENCE_LEASE_MS) {
          this.fault(command.kingdomId, 'time-budget');
          const late: KingdomForgeResult = { kind: 'cold', privateMessage: LATE };
          this.privateOutcome(kingdom, command, late);
          return late;
        }
        const baseCurrent = () => !this.stopped && !signal.aborted && kingdom.current && (incoming?.current() ?? true);
        if (!baseCurrent()) return { kind: 'canceled' };
        // Ingress acknowledges durable acceptance before the writer drains its inbox. Wait for actual
        // committed chat evidence, rather than racing a stream/home decision against queued Herald input.
        const witness = await this.witnessed(kingdom, command, baseCurrent);
        if (witness !== 'heard') {
          if (!baseCurrent()) return { kind: 'canceled' };
          if (witness === 'unreachable') this.fault(command.kingdomId, 'dependency');
          const unheard: KingdomForgeResult = { kind: 'cold', privateMessage: witness === 'unreachable' ? UNREACHABLE : UNHEARD };
          this.privateOutcome(kingdom, command, unheard);
          return unheard;
        }
        if (!baseCurrent()) return { kind: 'canceled' };
        if (kingdom.privateState.stream.sessionId === null || kingdom.privateState.stream.liveUntil <= kingdom.databaseNow()) {
          const offline: KingdomForgeResult = { kind: 'cold', privateMessage: 'The forge fire rests while the stream is offline. Bring your wish when the kingdom wakes; your coal stays yours.' };
          this.privateOutcome(kingdom, command, offline);
          return offline;
        }
        await this.observe(command, { status: 'working' });
        const sessionId = kingdom.privateState.stream.sessionId;
        const current = () => {
          const at = kingdom.databaseNow(), state = kingdom.privateState;
          return baseCurrent() && sessionId !== null && state.stream.sessionId === sessionId
            && state.stream.liveUntil > at && at < started + RUN_LEASE_MS;
        };
        const timer = setTimeout(() => abort.abort(), RUN_LEASE_MS); timer.unref?.();
        try {
          const outcome = this.landed(kingdom, command, await context.run(command, { signal, current }));
          this.privateOutcome(kingdom, command, outcome);
          return outcome;
        } finally { clearTimeout(timer); }
      } finally { await hold.release(); }
    }).catch((): KingdomForgeOutcome => {
      if (signal.aborted) return { kind: 'canceled' };
      // A failure before or around the run (opening the kingdom, its records): the maker hears the cause, never a bare cold.
      this.fault(command.kingdomId, 'dependency');
      const unreachable: KingdomForgeResult = { kind: 'cold', privateMessage: UNREACHABLE };
      // Before the kingdom opened there is no owner channel; the chat observer below still carries the cause.
      if (opened) try { this.privateOutcome(opened, command, unreachable); } catch { /* the owner left; the observer still answers */ }
      return unreachable;
    })
      .then(async outcome => { await this.observeOutcome(command, outcome); return outcome; })
      .finally(() => { if (this.pending.get(key)?.abort === abort) this.pending.delete(key); });
    this.pending.set(key, { command, abort, promise });
    return promise;
  }

  /** Deletion, cleanup coverage loss and offline edges revoke work before its transactional write gate. */
  cancel(kingdomId: KingdomId, filter: { readonly messageId?: string; readonly personId?: string } = {}): void {
    if (filter.messageId) {
      this.sweepWithdrawn();
      // Ten-minute, bounded tombstones ensure delete-before-wish delivery cannot restart the private run.
      if (this.withdrawn.size >= 4_096) this.withdrawn.delete(this.withdrawn.keys().next().value!);
      this.withdrawn.set(this.key(kingdomId, filter.messageId), Date.now() + RUN_LEASE_MS);
    }
    for (const pending of this.pending.values()) if (pending.command.kingdomId === kingdomId
      && (filter.messageId === undefined || pending.command.messageId === filter.messageId)
      && (filter.personId === undefined || pending.command.personId === filter.personId)) {
      pending.abort.abort();
      if (this.withdrawn.size >= 4_096) this.withdrawn.delete(this.withdrawn.keys().next().value!);
      this.withdrawn.set(this.key(kingdomId, pending.command.messageId), Date.now() + RUN_LEASE_MS);
    }
  }

  /** Dedicated authenticated private Herald service route; a 202 wish is queued, never a made-item claim. */
  async accept(authorization: string | undefined, raw: unknown): Promise<IngressReply> {
    if (this.options.ingress.gate.authenticate(authorization) !== 'herald') return { http: 401,
      body: { version: 1, status: 'unauthenticated', message: 'Only Herald may report this private work.' } };
    const parsed = RealmHeraldEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return { http: 400, body: { version: 1, status: 'refused', message: 'The Herald message is malformed.' } };
    const input = parsed.data;
    const origin = 'chat' in input ? input.chat.origin : 'chatCleanup' in input ? input.chatCleanup.origin : input.forge.origin;
    if (origin !== this.options.origin) return { http: 403,
      body: { version: 1, status: 'refused', message: 'This Herald message belongs to another realm origin.' } };
    if (this.stopped || !this.services) return { http: 503,
      body: { version: 1, status: 'unavailable', message: 'The realm is not taking private work.' } };
    if ('chat' in input) {
      const relayed = await this.waitForChat(input.chat);
      return { http: 202, body: { version: 1, status: relayed ? 'relayed' : 'absent' } };
    }
    if ('chatCleanup' in input) {
      const cleanup = input.chatCleanup;
      this.options.chatCommands?.cleanup(cleanup.kingdomId, cleanup.type === 'remove' ? { messageIds: cleanup.messageIds }
        : cleanup.personId === undefined ? {} : { personId: cleanup.personId });
      this.sweepSpeech();
      if (cleanup.type === 'remove') {
        const ids = cleanup.messageIds.map(id => this.speechId(cleanup.kingdomId, id));
        for (const id of ids) {
          this.speechActive.delete(id);
          if (this.speechWithdrawn.size >= 4_096) this.speechWithdrawn.delete(this.speechWithdrawn.keys().next().value!);
          this.speechWithdrawn.set(id, Date.now() + 10_000);
        }
        this.removeSpeech(cleanup.kingdomId, ids);
      } else if (cleanup.personId !== undefined) {
        this.speechClear(cleanup.kingdomId, cleanup.personId);
        const ids: string[] = [];
        for (const [id, active] of this.speechActive) if (active.kingdomId === cleanup.kingdomId && active.personId === cleanup.personId) {
          ids.push(active.cueId); this.speechActive.delete(id);
        }
        if (ids.length) this.removeSpeech(cleanup.kingdomId, ids);
      } else {
        this.speechClear(cleanup.kingdomId);
        for (const [id, active] of this.speechActive) if (active.kingdomId === cleanup.kingdomId) this.speechActive.delete(id);
        this.removeSpeech(cleanup.kingdomId);
      }
      return { http: 202, body: { version: 1, status: 'accepted' } };
    }
    const forge = input.forge;
    if (this.worker) {
      // Herald hears 202 only once the wish (or its withdrawal) is synced to the private line.
      try {
        if (forge.type === 'wish') await this.admit(forge.command);
        else if (forge.type === 'cancel') await this.withdraw(forge.kingdomId, 'deleted', { messageId: forge.messageId });
        else await this.withdraw(forge.kingdomId, 'moderated', forge.personId === undefined ? {} : { personId: forge.personId });
      } catch { return { http: 503, body: { version: 1, status: 'unavailable', message: 'The Forge is taking its present wishes. Try again shortly.' } }; }
      return { http: 202, body: { version: 1, status: 'accepted' } };
    }
    if (forge.type === 'wish') {
      if (this.pending.size >= MAX_PENDING) return { http: 503, body: { version: 1, status: 'unavailable', message: 'The Forge is taking its present wishes. Try again shortly.' } };
      void this.run(forge.command);
    } else if (forge.type === 'cancel') this.cancel(forge.kingdomId, { messageId: forge.messageId });
    else this.cancel(forge.kingdomId, forge.personId === undefined ? {} : { personId: forge.personId });
    return { http: 202, body: { version: 1, status: 'accepted' } };
  }

  chat(input: RealmHeraldChat): boolean {
    if (this.stopped) return false;
    const { personId, ...chat } = input;
    this.sweepSpeech();
    const id = this.speechId(chat.kingdomId, chat.id);
    const roomClear = this.speechCleared.get(this.key(chat.kingdomId, 'room'));
    const authorClear = this.speechCleared.get(this.key(chat.kingdomId, `person:${personId}`));
    if (this.speechActive.has(id) || this.speechWithdrawn.has(id)
      || (roomClear && chat.asOf <= roomClear.through) || (authorClear && chat.asOf <= authorClear.through)) return false;
    const relayed = this.speech(personId, { ...chat, id, epoch: presenceEpoch(chat.kingdomId), slot: 0 });
    if (relayed) {
      if (this.speechActive.size >= 4_096) this.speechActive.delete(this.speechActive.keys().next().value!);
      this.speechActive.set(id, { kingdomId: chat.kingdomId, personId, cueId: id, expiresAt: chat.expiresAt });
    }
    return relayed;
  }

  /** Private person identity selects the owned home or keep. Herald's presentation slot never becomes a deed. */
  speech(personId: string, cue: CitizenChatCue): boolean {
    const host = this.speechHost(personId, cue);
    if (!host) return false;
    const mapped = CitizenChatCueSchema.safeParse({ ...cue, slot: host.slot, epoch: presenceEpoch(cue.kingdomId) });
    return mapped.success && host.kingdom.transient({ type: 'chat', cue: mapped.data });
  }

  private speechHost(personId: string, cue: Pick<CitizenChatCue, 'kingdomId' | 'origin' | 'asOf' | 'expiresAt'>): { readonly kingdom: DurableKingdom; readonly slot: number } | null {
    if (this.stopped) return null;
    const kingdom = this.services?.kingdoms.get(cue.kingdomId);
    if (!kingdom?.current || kingdom.origin !== cue.origin || kingdom.origin !== this.options.origin) return null;
    const now = kingdom.databaseNow();
    if (cue.asOf > now || cue.expiresAt <= now) return null;
    const state = kingdom.privateState;
    const slot = state.castle?.ownerId === personId ? REALM_CASTLE_SLOT
      : Object.values(state.homes).find(home => home.ownerId === personId)?.slot;
    if (slot === undefined) return null;
    const frame = kingdom.publicCheckpoint().current.find(message => message.type === 'presence')?.frame;
    if (!frame || now - frame.asOf >= PRESENCE_LEASE_MS
      || !frame.windows.some(window => window.slot === slot && window.present && window.since <= cue.asOf)) return null;
    return { kingdom, slot };
  }

  private async waitForChat(input: RealmHeraldChat): Promise<boolean> {
    if (this.speechWaiting >= 128) return false;
    const clock = () => this.services?.kingdoms.get(input.kingdomId)?.databaseNow() ?? Date.now();
    const until = performance.now() + Math.min(EVIDENCE_WAIT_MS, Math.max(0, input.expiresAt - clock()));
    this.speechWaiting++;
    try {
      while (!this.stopped && performance.now() < until && input.expiresAt > clock()) {
        const host = this.speechHost(input.personId, input);
        if (host) return this.options.chatCommands?.chat(input, host.kingdom, host.slot) || this.chat(input);
        await new Promise<void>(resolve => setTimeout(resolve, 25));
      }
      return false;
    } finally { this.speechWaiting--; }
  }

  removeSpeech(kingdomId: KingdomId, cueIds?: readonly string[]): boolean {
    const kingdom = this.services?.kingdoms.get(kingdomId);
    return !!kingdom?.current && kingdom.transient(cueIds ? { type: 'chat.remove', cueIds } : { type: 'chat.clear' });
  }

  /** Existing authenticated durable presence ingress, with synchronous revocation before its inbox write. */
  async observation(authorization: string | undefined, body: unknown): Promise<IngressReply> {
    const admitted = this.options.ingress.gate.admit(authorization, body);
    if (admitted.ok && admitted.admitted.kind === 'observation' && admitted.admitted.service === 'herald') {
      this.revoke(admitted.admitted.observation);
      try { await this.options.beforeObservation?.(admitted.admitted.observation); }
      catch { return { http: 503, body: { version: 1, status: 'unavailable', message: 'The realm could not prepare this observation. Send it again.' } }; }
    }
    return this.options.ingress.accept(authorization, body);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // Suspend, never withdraw: every unfinished wish keeps its words, stage and spent calls for the next process.
    await this.starting?.catch(() => {});
    if (this.worker) { await this.worker.stop(); await this.queue?.close().catch(() => {}); this.worker = null; this.queue = null; }
    this.presenter.clear();
    await this.warm?.close().catch(() => {});
    this.withdrawn.clear();
    this.speechActive.clear();
    this.speechWithdrawn.clear(); this.speechCleared.clear();
    for (const pending of this.pending.values()) pending.abort.abort();
    for (const context of [...this.contexts.values()]) context.stop();
    await Promise.allSettled([...this.pending.values()].map(pending => pending.promise));
  }

  private revoke(input: PresenceInput): void {
    if (this.worker) {
      // The withdrawal fences running work synchronously; its durable write completes in the background.
      if (input.kind === 'stream' && !input.live) {
        this.offlineThrough.set(input.kingdomId, Date.now());
        void this.withdraw(input.kingdomId, 'offline', {}).catch(() => {});
      }
      else if (input.kind === 'source-lost') void this.withdraw(input.kingdomId, 'coverage', {}).catch(() => {});
      else if (input.kind === 'remove') void this.withdraw(input.kingdomId, 'coverage', { personId: input.personId }).catch(() => {});
      return;
    }
    if ((input.kind === 'stream' && !input.live) || input.kind === 'source-lost') this.cancel(input.kingdomId);
    else if (input.kind === 'remove') this.cancel(input.kingdomId, { personId: input.personId });
  }

  /** Durable admission: the exact command is synced before this resolves. A duplicate is the same wish. */
  private async admit(command: KingdomForgeCommand): Promise<void> {
    const parsed = RealmHeraldForgeCommandSchema.safeParse(command);
    if (!parsed.success || !this.worker) throw new ForgeWishQueueError('invalid');
    const { receipt } = await this.worker.admit(parsed.data);
    if (receipt.state !== 'finished') this.presenter.track(receipt);
  }

  private withdraw(kingdomId: KingdomId, reason: ForgeWishWithdrawal['reason'], filter: { readonly messageId?: string; readonly personId?: string }): Promise<void> {
    if (!this.worker) return Promise.reject(new ForgeWishQueueError('closed'));
    // Herald gives no original time for a clear; everything observed up to now is covered, never later wishes.
    const through = Date.now();
    const scope: ForgeWishWithdrawal['scope'] = filter.messageId !== undefined ? { kind: 'message', messageId: filter.messageId }
      : filter.personId !== undefined ? { kind: 'person', personId: filter.personId as never, through } : { kind: 'kingdom', through };
    return this.worker.withdraw({ kingdomId, reason, scope });
  }

  /**
   * One claimed wish, resumed from wherever it stopped. The intake (the wish's own chat message heard live) runs once
   * and is saved; everything after it is the durable coordinator. Losing the kingdom, the process or the stream
   * session pauses or quietly stops the wish; nothing is spent twice and the reveal plays once, from the outbox.
   */
  private async execute(claim: ForgeWishClaim, control: ForgeWishExecutionControl): Promise<KingdomForgeResult> {
    const command = claim.command, suspended: KingdomForgeResult = { kind: 'recovery-needed', ...claim.attempt };
    const services = this.services, queue = this.queue;
    if (!services || !queue || this.stopped) return suspended;
    const hold = await services.retain(command.kingdomId);
    try {
      const kingdom = hold.kingdom;
      if (this.contexts.get(command.kingdomId)?.kingdom !== kingdom) this.attach(kingdom);
      const context = this.contexts.get(command.kingdomId);
      if (!context || context.kingdom !== kingdom || !kingdom.current) return suspended;
      const base = () => !this.stopped && control.lease.current() && kingdom.current;
      let intake = this.intake(claim);
      if (!intake) {
        if (claim.withdrawal.aborted) return { kind: 'canceled' };
        const started = kingdom.databaseNow();
        if (command.observedAt > started + CLOCK_SKEW_MS || started - command.observedAt >= PRESENCE_LEASE_MS) {
          this.fault(command.kingdomId, 'time-budget');
          return { kind: 'cold', privateMessage: LATE };
        }
        const witness = await this.witnessed(kingdom, command, () => base() && !claim.withdrawal.aborted);
        if (!base()) return suspended;
        if (claim.withdrawal.aborted) return { kind: 'canceled' };
        if (witness !== 'heard') {
          if (witness === 'unreachable') this.fault(command.kingdomId, 'dependency');
          return { kind: 'cold', privateMessage: witness === 'unreachable' ? UNREACHABLE : UNHEARD };
        }
        const sessionId = kingdom.privateState.stream.sessionId;
        if (sessionId === null || kingdom.privateState.stream.liveUntil <= kingdom.databaseNow()) return { kind: 'cold', privateMessage: OFFLINE };
        await queue.checkpoint(claim, { id: INTAKE_CHECKPOINT, stage: 'words', data: { version: 1, sessionId } });
        intake = { sessionId };
        await this.observe(command, { status: 'working' });
      }
      const sessionId = intake.sessionId;
      const live = () => { const state = kingdom.privateState; return state.stream.sessionId === sessionId && state.stream.liveUntil > kingdom.databaseNow(); };
      // The stream this wish was made in has ended: stop it for good (releasing any reservation), never wait forever.
      if (!live() && !claim.withdrawal.aborted) await queue.withdraw({ kingdomId: command.kingdomId, reason: 'offline', scope: { kind: 'message', messageId: command.messageId } });
      context.queued ??= createQueuedKingdomForgeApplication({ queue, authority: context.authority, providers: this.providers,
        now: () => kingdom.databaseNow(), record: audit => this.options.approvals.record(audit),
        fault: fault => this.options.forgeLog?.({ kind: 'forge-fault', kingdomId: kingdom.kingdomId, ...fault }),
        publish: event => { if (event.type !== 'committed') this.presenter.offer(kingdom.kingdomId, event); } });
      const result = await context.queued(claim, { withdrawal: control.withdrawal, canReserve: control.canReserve, canPresent: () => true,
        lease: { signal: control.lease.signal, current: () => base() && live() },
        canCommit: () => control.canCommit() && this.presenter.ready(command.kingdomId, claim.attempt.attemptId) });
      const outcome: KingdomForgeResult = result.kind === 'canceled' && (!live() || (this.offlineThrough.get(command.kingdomId) ?? -1) >= command.observedAt) ? { kind: 'canceled', privateMessage: OFFLINE } : result;
      if (terminalKinds.has(outcome.kind)) this.presenter.finish(command.kingdomId, claim.receipt.key, outcome.kind === 'committed');
      return outcome;
    } finally { await hold.release(); }
  }

  private intake(claim: ForgeWishClaim): { readonly sessionId: string } | undefined {
    const data = claim.checkpoints.find(checkpoint => checkpoint.id === INTAKE_CHECKPOINT)?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
    const sessionId = (data as { readonly sessionId?: unknown }).sessionId;
    return typeof sessionId === 'string' ? { sessionId } : undefined;
  }

  /**
   * The maker hears the finished wish: privately in the room and in the wish box's own record. Only when that record
   * has it is the reply acknowledged; otherwise the worker tries again later and the room receipt repeats its ID.
   */
  private async completed(receipt: ForgeWishReceipt): Promise<void> {
    const outcome = receipt.outcome, delivery = receipt.delivery;
    this.presenter.finish(receipt.kingdomId, receipt.key, outcome?.kind === 'committed');
    if (!outcome || !delivery || delivery.acknowledged || !this.queue) return;
    const ref: WishRef = { kingdomId: receipt.kingdomId, personId: receipt.personId, messageId: receipt.messageId };
    const kingdom = this.services?.kingdoms.get(receipt.kingdomId);
    const result: KingdomForgeResult = outcome.kind === 'committed'
      ? { kind: 'committed', published: false, privateMessage: delivery.message, attachment: { id: outcome.runId, committedAt: outcome.committedAt } as never }
      : outcome.kind === 'refused' ? { kind: 'refused', message: delivery.message } : { kind: outcome.kind, privateMessage: delivery.message };
    if (kingdom?.current) try { this.privateOutcome(kingdom, ref, result); } catch { /* the room may be closing; the record below still answers */ }
    if (!await this.observeOutcome(ref, result)) throw new Error('The wish box record is not reachable yet.');
    await this.queue.acknowledgeOwner(receipt.kingdomId, receipt.personId, { key: receipt.key, attemptId: receipt.attemptId, replyId: delivery.replyId });
  }

  /**
   * Waits for the wish's own chat message to be committed as presence. A read that fails (a busy or briefly unreachable
   * database) is tried again until the wait ends; only a wait in which no read succeeded is reported as unreachable.
   */
  private async witnessed(kingdom: DurableKingdom, command: KingdomForgeCommand, current: () => boolean): Promise<'heard' | 'unheard' | 'unreachable'> {
    const until = performance.now() + (this.options.evidenceWaitMs ?? EVIDENCE_WAIT_MS);
    let read = false, first = true;
    while (current() && (first || performance.now() < until)) {
      first = false;
      try {
        const checkpoint = await kingdom.loadIngress();
        read = true;
        if (checkpoint) {
          const { presence } = decodeIngressCheckpoint(checkpoint, command.kingdomId, kingdom.origin);
          const person = presencePerson(presence, command.personId);
          const observed = person?.leases.chat?.observedAt;
          if (observed !== undefined && observed >= command.observedAt && observed + PRESENCE_LEASE_MS > kingdom.databaseNow()) return 'heard';
        }
      } catch { /* a transient read failure: read again until the wait ends */ }
      await new Promise<void>(resolve => setTimeout(resolve, EVIDENCE_POLL_MS));
    }
    return read ? 'unheard' : 'unreachable';
  }

  /** A word-free operational code for a wish that went cold before its run began. */
  private fault(kingdomId: KingdomId, cause: KingdomForgeFault['cause']): void {
    this.options.forgeLog?.({ kind: 'forge-fault', kingdomId, step: 'intake', cause });
  }

  /**
   * The maker hears the authoritative truth, never a lost reply: when a commit landed but its answer did not arrive in
   * time, the kingdom's durable state already holds the piece, and the wish is delivered, not cold.
   */
  private landed(kingdom: DurableKingdom, command: KingdomForgeCommand, outcome: KingdomForgeResult): KingdomForgeResult {
    if (outcome.kind === 'committed' || outcome.kind === 'already-committed' || outcome.kind === 'refused') return outcome;
    const key = forgeMessageKey(command.kingdomId, command.messageId);
    const made = Object.values(kingdom.privateState.attachments).find(item => item.forgeKey === key && item.ownerId === command.personId);
    if (!made) return outcome;
    return { kind: 'committed', attachment: structuredClone(made.attachment), published: false,
      privateMessage: forgeDeliveryMessage(made.attachment.draft) };
  }

  private privateOutcome(kingdom: DurableKingdom, command: WishRef, outcome: KingdomForgeResult): void {
    if (outcome.kind === 'committed') {
      if (outcome.privateMessage) kingdom.toOwner(command.personId, { type: 'receipt', receipt: { version: 1,
        id: `forge:${digest(command.messageId).slice(0, 48)}`, status: 'committed', writerEpoch: kingdom.writerEpoch,
        sequence: kingdom.sequence, message: outcome.privateMessage } });
      return;
    }
    if (outcome.kind === 'already-committed' || outcome.kind === 'canceled') return;
    const status = outcome.kind === 'refused' ? 'refused' : outcome.kind === 'held' ? 'held' : 'unavailable';
    const message = outcome.privateMessage ?? (outcome.kind === 'refused' ? outcome.message : outcome.kind === 'held'
      ? 'Your wish waits privately at the Forge.' : 'The forge is cold tonight. Your home is unchanged.');
    const reply: RealmPrivateMessage = { type: 'receipt', receipt: { version: 1, id: `forge:${digest(command.messageId).slice(0, 48)}`, status, message } };
    kingdom.toOwner(command.personId, reply);
  }

  private async observe(command: WishRef, outcome: ForgeChatProgress): Promise<boolean> {
    // No wish words or provider evidence cross this private seam. A failed projection is recoverable
    // from the durable committed piece, and must never become a retry of the authority or chat write.
    try { await this.options.forgeChatObserver?.({ origin: this.options.origin, kingdomId: command.kingdomId,
      personId: command.personId, messageId: command.messageId, at: Date.now(), ...outcome } as ForgeChatObservation); return true; }
    catch { return false; /* owner projection unavailable; the authoritative outcome remains unchanged */ }
  }

  private async observeOutcome(command: WishRef, outcome: KingdomForgeResult): Promise<boolean> {
    if (outcome.kind === 'committed') {
      return this.observe(command, { status: 'delivered', attachmentId: outcome.attachment.id,
        committedAt: outcome.attachment.committedAt, ...(outcome.privateMessage ? { message: outcome.privateMessage } : {}) });
    } else if (outcome.kind !== 'already-committed') {
      const status = outcome.kind === 'recovery-needed' ? 'cold' : outcome.kind;
      return this.observe(command, { status, message: outcome.privateMessage ?? (outcome.kind === 'refused'
        ? outcome.message : outcome.kind === 'held' ? 'Your wish waits privately at the Forge.'
          : outcome.kind === 'canceled' ? 'The wish has stopped. Your coal stays yours.'
            : 'The forge is cold tonight. Your home is unchanged.') });
    }
    return true;
  }

  private key(kingdomId: KingdomId, messageId: string): string { return digest(JSON.stringify([kingdomId, messageId])); }
  private speechId(kingdomId: KingdomId, messageId: string): string { return `speech:${this.key(kingdomId, messageId)}`; }
  private speechClear(kingdomId: KingdomId, personId?: string): void {
    if (this.speechCleared.size >= 4_096) this.speechCleared.delete(this.speechCleared.keys().next().value!);
    const through = Date.now();
    this.speechCleared.set(this.key(kingdomId, personId === undefined ? 'room' : `person:${personId}`), { through, until: through + 10_000 });
  }
  private sweepWithdrawn(): void { const now = Date.now(); for (const [key, until] of this.withdrawn) if (until <= now) this.withdrawn.delete(key); }
  private sweepSpeech(): void {
    const now = Date.now();
    for (const [key, active] of this.speechActive) if (active.expiresAt <= now) this.speechActive.delete(key);
    for (const [key, until] of this.speechWithdrawn) if (until <= now) this.speechWithdrawn.delete(key);
    for (const [key, cleared] of this.speechCleared) if (cleared.until <= now) this.speechCleared.delete(key);
  }
}
