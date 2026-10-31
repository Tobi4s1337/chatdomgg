import { KingdomPresenceFrameSchema, PresenceInputSchema, type KingdomId, type KingdomPresenceFrame, type PersonId, type PresenceInput } from '@chatdom/shared';
import {
  advancePresence, applyPresence, assignPresenceSlot, createPresenceState, projectPresence,
  type PresenceBinding, type PresenceState,
} from '@chatdom/world';
import { randomBytes } from 'node:crypto';
import { BindingStoreError, type BindingStore, type BindingStoreFault } from './bindings';
import type { RealmDeliverySink } from '../realm-delivery/sink';

/**
 * Herald's source conditions (Spec 03 R14). `connection` in the public frame says what the kingdom may
 * claim; this says why, for operators only.
 */
export type SourceCondition = 'configured' | 'connecting' | 'healthy' | 'partial' | 'stale' | 'unauthorized' | 'stopped';

/** Why the source is not publishing. Codes only: never a provider body, ID or name. */
export type UnavailableReason =
  | 'starting' | 'unauthorized' | 'conduit_unconfigured' | 'chat_delivery_down' | 'storage' | 'stopped' | 'simulated_outage';

export interface SourceFrame {
  readonly frame: KingdomPresenceFrame;
  /** The validated frame as sent on the wire, serialized once for every subscriber. */
  readonly data: string;
}

export interface SourceListener {
  frame(frame: SourceFrame): void;
  /** The source can no longer stand behind its frames; subscribers must stop showing them as current. */
  unavailable(): void;
}

export interface SourceHealth {
  readonly origin: 'live' | 'simulated';
  readonly condition: SourceCondition;
  readonly available: boolean;
  readonly reason: UnavailableReason | null;
  readonly frame: null | {
    readonly epoch: string; readonly sequence: number; readonly asOf: number;
    readonly connection: KingdomPresenceFrame['connection']; readonly streamLive: boolean;
    readonly windows: number; readonly present: number; readonly named: number;
  };
  readonly capacity: { readonly slots: number; readonly bound: number; readonly free: number; readonly unplaced: number; readonly outsideLayout: number };
  readonly storage: { readonly kind: BindingStore['kind']; readonly fault: BindingStoreFault | null };
  readonly counters: Readonly<SourceCounters>;
}

export interface SourceCounters {
  applied: number;
  rejected: number;
  /** Activity dropped because the input queue was full. Removals and stream changes are never dropped. */
  overflowed: number;
  bindingsSaved: number;
  framesPublished: number;
  capacityHits: number;
  /** Activity withdrawn (deleted, cleared) while it still waited in the queue. */
  canceled: number;
}

export interface PresenceSourceOptions {
  readonly realm?: RealmDeliverySink;
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  /** The presentation's home slots (`presentKingdom(config).slots`). */
  readonly slots: readonly number[];
  readonly store: BindingStore;
  /** Authoritative epoch-millisecond clock. Wrapped so it can never run backwards. */
  readonly now?: () => number;
  readonly epoch?: string;
  /** Expiry tick; 0 disables the timer (tests and checks call `tick()` themselves). */
  readonly tickMs?: number;
  /** Bound on queued inputs waiting behind a binding write. */
  readonly queueLimit?: number;
}

const DEFAULT_TICK_MS = 1_000;
/**
 * A frame unchanged for this long is projected again with a new sequence and `asOf`. Subscribers expire a
 * frame one presence lease after its `asOf` (main's adapter then shows the connection lost), so a steady
 * kingdom (quiet people, a resting beacon) must keep proving it is current well inside that lease.
 */
export const FRESHNESS_REFRESH_MS = 30_000;
const DEFAULT_QUEUE_LIMIT = 2_048;
/** The private set used only to count people with no free slot; bounded like the reducer's own maps. */
const UNPLACED_LIMIT = 100_000;

export type SubmitResult = 'applied' | 'rejected' | 'overflowed' | 'unavailable' | 'canceled';

/** Asked just before an input applies; false withdraws it (a deleted message, a cleared author). */
export type SubmitGuard = () => boolean;

/**
 * The one presence producer. Trusted inputs pass through the shared reducer; people get a durable slot
 * before any frame shows it; the public projection is validated, serialized once and fanned out. Live and
 * SIMULATED sources are the same class with a different origin and binding store.
 */
export class PresenceSource {
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  readonly epoch: string;
  readonly #slots: readonly number[];
  readonly #slotSet: ReadonlySet<number>;
  readonly #store: BindingStore;
  readonly #realm: RealmDeliverySink | undefined;
  #lastLoss: UnavailableReason | null = null;
  #lossSerial = 0;
  readonly #clock: () => number;
  readonly #tickMs: number;
  readonly #queueLimit: number;
  readonly #listeners = new Set<SourceListener>();
  readonly #counters: SourceCounters = { applied: 0, rejected: 0, overflowed: 0, bindingsSaved: 0, framesPublished: 0, capacityHits: 0, canceled: 0 };
  readonly #unplaced = new Set<PersonId>();
  #state: PresenceState;
  #bindings: readonly PresenceBinding[] = [];
  #bound = new Map<PersonId, number>();
  #sequence = 0;
  #current: SourceFrame | null = null;
  #signature = '';
  #available = false;
  #reason: UnavailableReason | null = 'starting';
  #condition: SourceCondition = 'configured';
  #storageFault: BindingStoreFault | null = null;
  #opened = false;
  #closed = false;
  #queue: Promise<void> = Promise.resolve();
  /** Inputs submitted and not yet applied, in order, so one binding write can cover newcomers already waiting. */
  readonly #waiting: Array<{ readonly event: PresenceInput; readonly guard: SubmitGuard | undefined }> = [];
  #queued = 0;
  #timer: ReturnType<typeof setInterval> | null = null;
  #last = 0;

  constructor(options: PresenceSourceOptions) {
    this.kingdomId = options.kingdomId;
    this.origin = options.origin;
    this.#slots = [...new Set(options.slots)].sort((a, b) => a - b);
    this.#slotSet = new Set(this.#slots);
    this.#store = options.store;
    this.#realm = options.realm;
    const now = options.now ?? Date.now;
    this.#clock = () => {
      this.#last = Math.max(this.#last, now());
      return this.#last;
    };
    this.epoch = options.epoch ?? `herald-${this.#clock().toString(36)}-${randomBytes(6).toString('hex')}`;
    this.#tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.#queueLimit = options.queueLimit ?? DEFAULT_QUEUE_LIMIT;
    this.#state = createPresenceState(options.kingdomId, options.origin);
  }

  get available(): boolean {
    return this.#available;
  }

  get current(): SourceFrame | null {
    return this.#available ? this.#current : null;
  }

  /** Server-only presentation lookup after a binding has been durably saved; never a home deed. */
  boundSlot(personId: PersonId): number | null {
    const slot = this.#bound.get(personId);
    return slot !== undefined && this.#slotSet.has(slot) ? slot : null;
  }

  /** Loads the durable bindings and projects the first frame. The source stays unavailable until told otherwise. */
  async open(): Promise<void> {
    if (this.#opened) return;
    this.#opened = true;
    this.#condition = 'connecting';
    try {
      this.#setBindings(await this.#store.load());
    } catch (error) {
      this.#fail(error);
      throw error;
    }
    this.#publish();
    if (this.#tickMs > 0) {
      this.#timer = setInterval(() => this.tick(), this.#tickMs);
      this.#timer.unref?.();
    }
  }

  /**
   * Whether the source's required delivery is in place. Going unavailable tells every subscriber at once;
   * coming back publishes a fresh current projection, never a replay.
   */
  setAvailable(available: boolean, reason: UnavailableReason | null = null): void {
    if (this.#closed || this.#storageFault) return;
    if (!available) {
      if (this.#available || this.#lastLoss !== (reason ?? 'chat_delivery_down')) this.#lost(reason ?? 'chat_delivery_down');
      this.#reason = reason ?? 'chat_delivery_down';
      this.#condition = this.#reason === 'unauthorized' ? 'unauthorized' : this.#reason === 'stopped' ? 'stopped'
        : this.#reason === 'conduit_unconfigured' ? 'configured' : 'connecting';
      if (this.#available) {
        this.#available = false;
        this.#notifyUnavailable();
      }
      return;
    }
    this.#reason = null;
    this.#lastLoss = null;
    const was = this.#available;
    this.#available = true;
    this.#refreshCondition();
    if (!was && this.#current) for (const listener of [...this.#listeners]) this.#deliver(listener, this.#current);
  }

  /**
   * Queues one trusted input. Inputs apply strictly in order; one that introduces people waits until their
   * bindings are durable. When the queue is full, new activity observations are dropped and counted;
   * removals and stream changes are always kept so cleanup is never trapped behind activity. A guard is
   * asked again right before the input applies, including after its binding write, so cleanup that arrives
   * while activity waits cancels it.
   */
  submit(input: PresenceInput, guard?: SubmitGuard): Promise<SubmitResult> {
    if (this.#closed || this.#storageFault) return Promise.resolve('unavailable');
    const parsed = PresenceInputSchema.safeParse(input);
    if (!parsed.success || parsed.data.kingdomId !== this.kingdomId) {
      this.#counters.rejected++;
      return Promise.resolve('rejected');
    }
    const event = parsed.data;
    if (this.#queued >= this.#queueLimit && event.kind === 'observe') {
      this.#counters.overflowed++;
      return Promise.resolve('overflowed');
    }
    this.#queued++;
    const entry = { event, guard };
    this.#waiting.push(entry);
    const result = this.#queue.then(() => {
      if (this.#waiting[0] === entry) this.#waiting.shift();
      return this.#apply(event, guard);
    }).finally(() => {
      this.#queued--;
    });
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Expires evidence by the reducer's leases; republishes if anything public changed or the frame needs refreshing. */
  tick(): void {
    if (this.#closed || !this.#opened || this.#storageFault) return;
    this.#state = advancePresence(this.#state, this.#clock());
    this.#publish();
  }

  /**
   * Broadcaster revocation: forget this kingdom's Twitch-derived bindings and current projection. Homes are
   * not this source's to touch; only the private slot table and transient presence go.
   */
  async erase(): Promise<void> {
    this.#lost('unauthorized', true);
    await this.#queue;
    this.#state = createPresenceState(this.kingdomId, this.origin);
    this.#setBindings([]);
    this.#unplaced.clear();
    try {
      await this.#store.erase();
    } catch (error) {
      this.#fail(error);
      throw error;
    }
    this.#publish();
  }

  /** The current frame's sequence, or null before the first projection. */
  get sequence(): number | null {
    return this.#current?.frame.sequence ?? null;
  }

  subscribe(listener: SourceListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  health(): SourceHealth {
    const frame = this.#current?.frame ?? null;
    const outsideLayout = this.#bindings.filter(binding => !this.#slotSet.has(binding.slot)).length;
    const boundInLayout = this.#bindings.length - outsideLayout;
    return {
      origin: this.origin,
      condition: this.#condition,
      available: this.#available,
      reason: this.#available ? null : this.#reason,
      frame: frame && {
        epoch: frame.epoch, sequence: frame.sequence, asOf: frame.asOf, connection: frame.connection, streamLive: frame.streamLive,
        windows: frame.windows.length, present: frame.windows.filter(window => window.present).length,
        named: frame.windows.filter(window => window.publicName !== null).length,
      },
      capacity: { slots: this.#slots.length, bound: boundInLayout, free: this.#slots.length - boundInLayout, unplaced: this.#unplaced.size, outsideLayout },
      storage: { kind: this.#store.kind, fault: this.#storageFault },
      counters: { ...this.#counters },
    };
  }

  /** Stops timers, tells subscribers, and drops all transient presence. Durable bindings stay on disk. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#lost('stopped');
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const wasAvailable = this.#available;
    this.#available = false;
    this.#reason = 'stopped';
    this.#condition = 'stopped';
    if (wasAvailable) this.#notifyUnavailable();
    this.#listeners.clear();
    await this.#queue;
    this.#state = createPresenceState(this.kingdomId, this.origin);
    this.#unplaced.clear();
    this.#current = null;
    await this.#store.close();
  }

  async #apply(event: PresenceInput, guard: SubmitGuard | undefined): Promise<SubmitResult> {
    if (this.#closed || this.#storageFault) return 'unavailable';
    if (guard && !guard()) {
      this.#counters.canceled++;
      return 'canceled';
    }
    if (event.kind === 'observe' && event.origin !== 'recovered') {
      let placed = this.#place(event.people.map(person => person.personId));
      // Group commit: newcomers already waiting behind this input are bound in the same durable write, in
      // queue order, so a burst of first-time chatters costs one fsync instead of one each and cleanup
      // queued behind them is not held up. Slots come out exactly as if each input had been placed alone.
      if (placed !== this.#bindings) placed = this.#place(this.#waitingPeople(), placed);
      if (placed !== this.#bindings) {
        try {
          await this.#store.save(placed);
        } catch (error) {
          this.#fail(error);
          return 'unavailable';
        }
        this.#counters.bindingsSaved++;
        this.#setBindings(placed);
      }
    }
    if (guard && !guard()) {
      this.#counters.canceled++;
      return 'canceled';
    }
    try {
      this.#state = applyPresence(this.#state, event, this.#clock());
    } catch {
      this.#counters.rejected++;
      return 'rejected';
    }
    this.#counters.applied++;
    if (event.kind === 'stream' && !event.live) this.#realm?.clear(this.kingdomId);
    // Only normalized accepted evidence crosses this private port, before any public slot projection.
    if (this.#realm) await this.#realm.observation(event).catch(() => undefined);
    this.#publish();
    return 'applied';
  }

  /** People in waiting observations that still pass their guard, in queue order. */
  *#waitingPeople(): Iterable<PersonId> {
    for (const { event, guard } of this.#waiting) {
      if (event.kind !== 'observe' || event.origin === 'recovered' || event.kingdomId !== this.kingdomId) continue;
      if (guard && !guard()) continue;
      for (const person of event.people) yield person.personId;
    }
  }

  /**
   * New bindings for unplaced people, or the current array unchanged. Capacity exhaustion is counted, never
   * merged. With `ahead` (bindings already extended for this write) people are placed only while slots
   * remain, and nobody is counted unplaced: their own input does that when it applies.
   */
  #place(people: Iterable<PersonId>, ahead?: readonly PresenceBinding[]): readonly PresenceBinding[] {
    if (ahead) return this.#placeAhead(people, ahead);
    let bindings = this.#bindings;
    let free = this.#slots.length - bindings.filter(binding => this.#slotSet.has(binding.slot)).length;
    const available = free > 0 ? this.#slots : [];
    for (const personId of people) {
      if (this.#bound.has(personId)) continue;
      if (free <= 0) {
        this.#counters.capacityHits++;
        if (this.#unplaced.size < UNPLACED_LIMIT) this.#unplaced.add(personId);
        continue;
      }
      const result = assignPresenceSlot(bindings, personId, available);
      if (result.slot === null) {
        free = 0;
        this.#counters.capacityHits++;
        if (this.#unplaced.size < UNPLACED_LIMIT) this.#unplaced.add(personId);
        continue;
      }
      bindings = result.bindings;
      free--;
      this.#unplaced.delete(personId);
    }
    return bindings;
  }

  #placeAhead(people: Iterable<PersonId>, ahead: readonly PresenceBinding[]): readonly PresenceBinding[] {
    let bindings = ahead;
    const taken = new Set(ahead.map(binding => binding.personId));
    let free = this.#slots.length - bindings.filter(binding => this.#slotSet.has(binding.slot)).length;
    for (const personId of people) {
      if (free <= 0) break;
      if (taken.has(personId)) continue;
      const result = assignPresenceSlot(bindings, personId, this.#slots);
      if (result.slot === null) break;
      bindings = result.bindings;
      taken.add(personId);
      free--;
      this.#unplaced.delete(personId);
    }
    return bindings;
  }

  #setBindings(bindings: readonly PresenceBinding[]): void {
    this.#bindings = bindings;
    this.#bound = new Map(bindings.map(binding => [binding.personId, binding.slot]));
  }

  #publish(): void {
    const now = this.#clock();
    const draft = projectPresence(this.#state, this.#bindings, now, this.#sequence + 1, this.epoch);
    const signature = JSON.stringify([draft.streamLive, draft.connection, draft.windows]);
    if (signature === this.#signature && this.#current && now - this.#current.frame.asOf < FRESHNESS_REFRESH_MS) return;
    let frame: KingdomPresenceFrame;
    try {
      frame = KingdomPresenceFrameSchema.parse(draft);
    } catch {
      this.#counters.rejected++;
      return;
    }
    this.#sequence = frame.sequence;
    this.#signature = signature;
    this.#current = { frame, data: JSON.stringify(frame) };
    this.#counters.framesPublished++;
    this.#refreshCondition();
    if (!this.#available) return;
    for (const listener of [...this.#listeners]) this.#deliver(listener, this.#current);
  }

  #refreshCondition(): void {
    if (!this.#available) return;
    const connection = this.#current?.frame.connection ?? 'stale';
    this.#condition = connection === 'stale' ? 'stale' : this.#unplaced.size > 0 ? 'partial' : 'healthy';
  }

  #deliver(listener: SourceListener, frame: SourceFrame): void {
    try {
      listener.frame(frame);
    } catch {
      this.#listeners.delete(listener);
    }
  }

  #notifyUnavailable(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener.unavailable();
      } catch {
        // One subscriber's failure cannot keep the others showing stale frames as current.
      }
    }
  }

  #fail(error: unknown): void {
    this.#lost('storage');
    this.#storageFault = error instanceof BindingStoreError ? error.fault : 'unwritable';
    this.#reason = 'storage';
    this.#condition = 'stopped';
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const wasAvailable = this.#available;
    this.#available = false;
    if (wasAvailable) this.#notifyUnavailable();
  }

  #lost(reason: UnavailableReason, revoked = false): void {
    this.#lastLoss = reason;
    this.#realm?.clear(this.kingdomId);
    void this.#realm?.observation({ version: 1, id: `loss:${this.epoch}:${++this.#lossSerial}`,
      kingdomId: this.kingdomId, observedAt: this.#clock(), origin: this.origin, kind: 'source-lost',
      sources: revoked ? ['chat', 'chatters', 'stream'] : ['chat'], reason: revoked ? 'revoked' : 'unavailable',
    }).catch(() => undefined);
  }
}
