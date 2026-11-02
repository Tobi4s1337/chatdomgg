import { createHash } from 'node:crypto';
import { CitizenChatCueSchema, PRESENCE_LEASE_MS, type CitizenChatCue, type KingdomId, type PresenceInput } from '@chatdom/shared';
import { REALM_CASTLE_SLOT, RealmHeraldEnvelopeSchema, RealmHeraldForgeCommandSchema, type KingdomForgeCommand, type KingdomForgeLease, type KingdomForgeOutcome, type RealmHeraldChat, type RealmPrivateMessage } from '@chatdom/shared/realm';
import { createKingdomForgeApplication } from '../../../codex/src/kingdom-forge/application';
import { createForgeProviders, type ForgeProviders } from '../../../codex/src/providers';
import { decodeIngressCheckpoint, presenceEpoch, presencePerson, type IngressReply, type RealmIngress } from '../ingress';
import type { DurableKingdom, DurableRealmServices } from '../persistence';
import { createForgeAuthority, type FileForgeApprovals, type ForgeWriteGate } from '../wiring';

const MAX_PENDING = 32;
const RUN_LEASE_MS = 600_000;
const EVIDENCE_WAIT_MS = 5_000;
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
  /** Chat commands a feature claims once the chatter has a lit window (pier's `!fish`). True means no speech bubble. */
  readonly chatCommands?: {
    chat(input: RealmHeraldChat, kingdom: DurableKingdom, slot: number): boolean;
    cleanup(kingdomId: KingdomId, filter: { readonly messageIds?: readonly string[]; readonly personId?: string }): void;
  };
}

type Application = ReturnType<typeof createKingdomForgeApplication>;
interface Context { readonly kingdom: DurableKingdom; readonly run: Application; readonly stop: () => void }
interface Pending { readonly command: KingdomForgeCommand; readonly abort: AbortController; readonly promise: Promise<KingdomForgeOutcome> }

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

  constructor(readonly options: RealmEveningOptions) {
    this.providers = options.providers ?? createForgeProviders();
  }

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
    }, { gate: this.options.gate, approvals: this.options.approvals });
    const run = createKingdomForgeApplication({ authority, providers: this.providers,
      now: () => kingdom.databaseNow(), record: audit => this.options.approvals.record(audit),
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
      this.cancel(kingdom.kingdomId);
    };
    this.contexts.set(kingdom.kingdomId, { kingdom, run, stop });
    return stop;
  }

  /** In-process adapter for Herald's existing ForgeCommandSink. */
  readonly sink = async (command: KingdomForgeCommand, lease: KingdomForgeLease): Promise<void> => { await this.run(command, lease); };

  async run(command: KingdomForgeCommand, incoming?: KingdomForgeLease): Promise<KingdomForgeOutcome> {
    if (this.stopped || !this.services) return { kind: 'cold' };
    const parsed = RealmHeraldForgeCommandSchema.safeParse(command);
    if (!parsed.success) return { kind: 'held' };
    command = parsed.data;
    const key = this.key(command.kingdomId, command.messageId);
    this.sweepWithdrawn();
    if (this.withdrawn.has(key)) return { kind: 'canceled' };
    const active = this.pending.get(key);
    if (active) return active.promise;
    if (this.pending.size >= MAX_PENDING) return { kind: 'held' };
    const abort = new AbortController();
    const signal = incoming ? AbortSignal.any([abort.signal, incoming.signal]) : abort.signal;
    // Reserve the bounded handoff slot BEFORE awaiting the registry, including a cold/slow opening.
    const promise = Promise.resolve().then(async (): Promise<KingdomForgeOutcome> => {
      const hold = await this.services!.retain(command.kingdomId);
      const kingdom = hold.kingdom;
      try {
        if (!this.contexts.has(command.kingdomId)) this.attach(kingdom);
        const context = this.contexts.get(command.kingdomId);
        if (!context || context.kingdom !== kingdom) return { kind: 'cold' };
        const started = kingdom.databaseNow();
        if (command.observedAt > started || started - command.observedAt >= PRESENCE_LEASE_MS) return { kind: 'cold' };
        const baseCurrent = () => !this.stopped && !signal.aborted && kingdom.current && (incoming?.current() ?? true);
        // Ingress acknowledges durable acceptance before the writer drains its inbox. Wait for actual
        // committed chat evidence, rather than racing a stream/home decision against queued Herald input.
        if (!await this.witnessed(kingdom, command, baseCurrent)) return { kind: 'cold' };
        const sessionId = kingdom.privateState.stream.sessionId;
        const current = () => {
          const at = kingdom.databaseNow(), state = kingdom.privateState;
          return baseCurrent() && sessionId !== null && state.stream.sessionId === sessionId
            && state.stream.liveUntil > at && at < started + RUN_LEASE_MS;
        };
        const timer = setTimeout(() => abort.abort(), RUN_LEASE_MS); timer.unref?.();
        try {
          const outcome = await context.run(command, { signal, current });
          this.privateOutcome(kingdom, command, outcome);
          return outcome;
        } finally { clearTimeout(timer); }
      } finally { await hold.release(); }
    }).catch((): KingdomForgeOutcome => ({ kind: signal.aborted ? 'canceled' : 'cold' }))
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
    this.withdrawn.clear();
    this.speechActive.clear();
    this.speechWithdrawn.clear(); this.speechCleared.clear();
    for (const pending of this.pending.values()) pending.abort.abort();
    for (const context of [...this.contexts.values()]) context.stop();
    await Promise.allSettled([...this.pending.values()].map(pending => pending.promise));
  }

  private revoke(input: PresenceInput): void {
    if ((input.kind === 'stream' && !input.live) || input.kind === 'source-lost') this.cancel(input.kingdomId);
    else if (input.kind === 'remove') this.cancel(input.kingdomId, { personId: input.personId });
  }

  private async witnessed(kingdom: DurableKingdom, command: KingdomForgeCommand, current: () => boolean): Promise<boolean> {
    const until = performance.now() + EVIDENCE_WAIT_MS;
    while (current() && performance.now() < until) {
      const checkpoint = await kingdom.loadIngress();
      if (checkpoint) {
        const { presence } = decodeIngressCheckpoint(checkpoint, command.kingdomId, kingdom.origin);
        const person = presencePerson(presence, command.personId);
        const observed = person?.leases.chat?.observedAt;
        if (observed !== undefined && observed >= command.observedAt && observed + PRESENCE_LEASE_MS > kingdom.databaseNow()) return true;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 25));
    }
    return false;
  }

  private privateOutcome(kingdom: DurableKingdom, command: KingdomForgeCommand, outcome: KingdomForgeOutcome): void {
    if (outcome.kind === 'committed' || outcome.kind === 'already-committed' || outcome.kind === 'canceled') return;
    const status = outcome.kind === 'refused' ? 'refused' : outcome.kind === 'held' ? 'held' : 'unavailable';
    const message = outcome.kind === 'refused' ? outcome.message : outcome.kind === 'held'
      ? 'Your wish waits privately at the Forge.' : 'The forge is cold tonight. Your home is unchanged.';
    const reply: RealmPrivateMessage = { type: 'receipt', receipt: { version: 1, id: `forge:${digest(command.messageId).slice(0, 48)}`, status, message } };
    kingdom.toOwner(command.personId, reply);
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
