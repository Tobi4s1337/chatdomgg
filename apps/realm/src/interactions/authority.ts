import type { PersonId, Vec3 } from '@chatdom/shared';
import type { RealmInteractionAction, RealmInteractionContext, RealmInteractionLease, RealmInteractionResult, RealmInteractionState, RealmPrincipal, RealmReceipt } from '@chatdom/shared/realm';
import type { RealmIntentContext } from '../ports';
import {
  ACTION_FOR_KIND, SEAT_KINDS, STANDING, STREET_ZONE, claimSeat, createSeatBook, dropSession, endSeat as endLease, expireSeats, homeZone,
  interactionLegality, publicSeats, reconnectSession, releasePerson, releaseSession, releaseTargets, resumeSeat, seatAt, seatOfSession, standSeat,
  type InteractionBlock, type InteractionRecord, type SeatBook,
} from '../../../../packages/world/src/interactions';
import { buildInteractionContext } from './context';
import type {
  InteractIntent, InteractionAuthority, InteractionAuthorityOptions, InteractionChange, InteractionDelivery, InteractionReleaseCause,
  InteractionRoomEffects, InteractionSelfChange, SeatsMessage,
} from './ports';

/** Request IDs remembered per room for duplicate delivery; older ones fall out first. */
export const INTERACTION_DEDUPE = 512;

/** What a person reads when the room says no. One plain sentence, never an ID or lease vocabulary. */
export const REFUSAL_WORDS = {
  occupied: 'Someone is already sitting there.',
  unreachable: 'Come a little closer, with nothing in the way.',
  seated: 'Stand up first.',
  'wrong-zone': 'That is not in here with you.',
  'not-yours': 'Only the owner of this home can open its door.',
  'not-inside': 'You are not inside this home.',
  'wrong-action': 'That is not something to do here.',
  rights: 'You cannot do that in this kingdom right now.',
  placement: 'There is not room to do that safely just now. Nothing has changed.',
  'no-host': 'The table is not open right now. Nothing has changed.',
  'host-refused': 'The table did not take a new guest just now.',
  'no-room': 'The kingdom is not ready for that yet. Nothing has changed.',
  epoch: 'The kingdom moved on. Reconnect to try again.',
  limited: 'One moment, that was quick.',
} as const;
type Why = keyof typeof REFUSAL_WORDS;
const REASON_FOR: Readonly<Record<Why, Extract<RealmInteractionResult, { kind: 'refused' }>['reason']>> = {
  occupied: 'occupied', unreachable: 'unreachable', seated: 'forbidden', 'wrong-zone': 'unreachable', 'not-yours': 'forbidden', 'not-inside': 'unreachable',
  'wrong-action': 'forbidden', rights: 'forbidden', placement: 'unavailable', 'no-host': 'unavailable', 'host-refused': 'unavailable',
  'no-room': 'unavailable', epoch: 'unavailable', limited: 'unavailable',
};
function whyOf(block: InteractionBlock): Why { return block; }

interface Self {
  readonly personId: PersonId; readonly sessionId: string;
  walkerId: string; state: RealmInteractionState; connected: boolean;
}
/** Why the room stopped waiting for a request's rights check or host admission. */
type Abandoned = 'revoked' | 'left' | 'closed';
interface InFlight { readonly personId: PersonId; readonly controller: AbortController }
type Decision =
  | { readonly kind: 'accepted'; readonly result: Extract<RealmInteractionResult, { kind: 'accepted' }> }
  | { readonly kind: 'refused'; readonly result: Extract<RealmInteractionResult, { kind: 'refused' }>; readonly why: Why };

/**
 * The room-owned interaction authority. Everything is serialized through the room's single thread: awaits happen
 * first (rights, existing host admission), then the trusted context is rebuilt from current authority and one
 * synchronous `act` decides and mutates. No durable fact, balance or reward is ever written here.
 */
export function createInteractionAuthority(options: InteractionAuthorityOptions): InteractionAuthority {
  const { writerEpoch } = options;
  let book: SeatBook = createSeatBook(writerEpoch);
  let effects: InteractionRoomEffects | null = null;
  let delivery: InteractionDelivery | null = null;
  let disposed = false;
  const selves = new Map<string, Self>();
  /** The session each person's private messages reach: the room's own `control` (newest window wins). */
  const control = new Map<PersonId, string>();
  /** One counter for every self state, so revisions only ever rise for a person across windows and reloads. */
  let stateRevision = 0;
  const requests = new Map<string, Promise<RealmReceipt>>();
  /** Requests still awaiting rights or host admission, per session. Aborting one means it can never act. */
  const inflight = new Map<string, Set<InFlight>>();
  const listeners = new Set<(change: InteractionChange) => void>();
  /** Sessions holding an accepted host admission for this exact target, consumed by the next synchronous act. */
  const admissions = new Map<string, { readonly targetId: string; readonly cancel: () => void }>();
  /** Admissions granted to a seat that is still held: cancelled when that lease ends. */
  const hosted = new Map<number, () => void>();

  const seatsMessage = (): SeatsMessage => ({ type: 'seats', writerEpoch, revision: book.revision, seats: publicSeats(book) });
  const self = (sessionId: string, personId: PersonId, walkerId: string): Self => {
    let entry = selves.get(sessionId);
    if (!entry) { entry = { personId, sessionId, walkerId, state: STANDING, connected: true }; selves.set(sessionId, entry); }
    return entry;
  };
  const setState = (entry: Self, next: Omit<RealmInteractionState, 'revision'>): RealmInteractionState => {
    entry.state = Object.freeze({ revision: ++stateRevision, ...next });
    return entry.state;
  };
  const zoneFor = (entry: Self | undefined, walkerId: string, feet: Vec3): string => entry?.state.mode === 'interior' && entry.state.plotId
    ? homeZone(entry.state.plotId) : options.zones?.zoneOf(walkerId, feet) ?? STREET_ZONE;

  /** Publish what changed: the seat envelope to the room, each changed self only to its owner. */
  function publish(before: SeatBook, selvesChanged: readonly Self[], released: readonly { lease: RealmInteractionLease; cause: InteractionReleaseCause }[], requestId: string | null = null): void {
    for (const { lease, cause } of released) {
      hosted.get(lease.seat.generation)?.(); hosted.delete(lease.seat.generation);
      options.hosts?.released?.(lease, cause);
    }
    if (disposed) return;
    const seats = book !== before ? seatsMessage() : null;
    const changes: InteractionSelfChange[] = selvesChanged.map(entry => ({ personId: entry.personId, sessionId: entry.sessionId, walkerId: entry.walkerId, state: entry.state }));
    if (seats) delivery?.transient(seats);
    for (const change of changes) if (reachable(change.sessionId)) delivery?.owner(change.personId, { type: 'interaction', requestId, writerEpoch, state: change.state });
    if (seats || changes.length || released.length) for (const listener of listeners) listener({ seats, selves: changes, released });
  }
  /** Owner delivery is per person, so only the session that person is controlling now may be told anything. */
  function reachable(sessionId: string): boolean {
    const entry = selves.get(sessionId);
    return !!entry?.connected && control.get(entry.personId) === sessionId;
  }
  function track(personId: PersonId, sessionId: string): InFlight {
    const flight: InFlight = { personId, controller: new AbortController() };
    let set = inflight.get(sessionId);
    if (!set) { set = new Set(); inflight.set(sessionId, set); }
    set.add(flight);
    return flight;
  }
  function untrack(sessionId: string, flight: InFlight): void {
    const set = inflight.get(sessionId);
    set?.delete(flight);
    if (set && !set.size) inflight.delete(sessionId);
  }
  function abandon(match: (sessionId: string, flight: InFlight) => boolean, why: Abandoned): void {
    for (const [sessionId, set] of inflight) for (const flight of set) if (match(sessionId, flight)) flight.controller.abort(why);
  }
  /** A lease ended without its holder standing: the body is free to walk again and its self state says so. */
  function unseat(lease: RealmInteractionLease): Self | null {
    const entry = selves.get(lease.sessionId);
    if (!entry || entry.state.mode !== 'seated' || entry.state.targetId !== lease.seat.targetId) return null;
    setState(entry, { mode: 'standing', targetId: null, plotId: null });
    effects?.allowWalking(entry.walkerId, true);
    return entry;
  }

  function refuse(why: Why): Decision {
    return { kind: 'refused', result: { kind: 'refused', reason: REASON_FOR[why] }, why };
  }
  function accept(state: RealmInteractionState, position: Vec3 | null): Decision {
    return { kind: 'accepted', result: { kind: 'accepted', state, position, seats: publicSeats(book) } };
  }

  /**
   * The one synchronous decision. `context` is trusted (built by the room from authority, never a payload); the
   * family law, occupancy and placement are checked here against the current book, then the change is made.
   */
  function decide(context: RealmInteractionContext, action: RealmInteractionAction, requestId: string | null): Decision {
    if (disposed || context.writerEpoch !== writerEpoch) return refuse('epoch');
    if (!context.permitted) return refuse('rights');
    const registry = options.registry();
    if (!registry || registry.collisionRevision !== context.collisionRevision) return refuse('no-room');
    const entry = self(context.sessionId, context.personId, context.walkerId);
    const before = book;

    if (action === 'stand') {
      const mine = seatOfSession(book, context.sessionId);
      if (!mine) {
        // Idempotent: standing when already standing changes nothing and says so truthfully.
        if (entry.state.mode === 'seated') { setState(entry, { mode: 'standing', targetId: null, plotId: null }); effects?.allowWalking(entry.walkerId, true); publish(before, [entry], [], requestId); }
        return accept(entry.state, null);
      }
      // Standing always succeeds: the owner can always get up. If an edit has made the approach unsafe since they
      // sat, the movement owner's recovery finds the nearest supported place; this lane never scans for air.
      if (!context.unobstructed) options.recovery?.(entry.walkerId, context.collisionRevision);
      book = standSeat(book, { sessionId: context.sessionId, writerEpoch, generation: mine.seat.generation }).book;
      setState(entry, { mode: 'standing', targetId: null, plotId: null });
      effects?.allowWalking(entry.walkerId, true);
      publish(before, [entry], [{ lease: mine, cause: 'stand' }], requestId);
      return accept(entry.state, null);
    }

    const target = context.target;
    const record = target ? registry.get(target.id) : undefined;
    if (!target || !record) return refuse('unreachable');
    if (ACTION_FOR_KIND[target.kind] !== action) return refuse('wrong-action');
    const legality = interactionLegality(
      { walkerId: context.walkerId, zone: zoneFor(entry, context.walkerId, context.position), state: entry.state, ownedPlotId: context.ownedPlotId },
      record, seatAt(book, target.id)?.seat ?? null);
    if (!legality.legal) return refuse(whyOf(legality.reason));
    // Asking for your own seat again while on it: nothing to change.
    if (legality.action === 'stand') return accept(entry.state, null);
    if (!context.unobstructed) return refuse('unreachable');

    switch (target.kind) {
      case 'bench-seat': case 'campfire-seat': case 'tavern-seat': return seat(context, entry, record, requestId);
      case 'anvil':
        // The Forge opens where you stand; the room only confirms that this anvil is in reach. No lease, no fact.
        return accept(entry.state, null);
      case 'home-door': case 'home-exit': return threshold(context, entry, record, requestId);
    }
  }

  function seat(context: RealmInteractionContext, entry: Self, record: InteractionRecord, requestId: string | null): Decision {
    const targetId = record.target.id;
    const admission = admissions.get(context.sessionId);
    if (record.target.kind === 'tavern-seat' && admission?.targetId !== targetId) return refuse(options.hosts?.admit ? 'host-refused' : 'no-host');
    const before = book;
    const claim = claimSeat(book, { targetId, walkerId: context.walkerId, sessionId: context.sessionId, personId: context.personId, writerEpoch });
    if (claim.kind === 'occupied') return refuse('occupied');
    if (claim.kind === 'elsewhere') return refuse('seated');
    if (claim.kind === 'stale') return refuse('epoch');
    if (claim.kind !== 'seated') return accept(entry.state, null);
    // The body stays on the authored approach, which the registry and context proved supported and clear; the
    // seated pose on the log/chair is presentation from the same authored anchor, never an overlapping body.
    if (!effects || !effects.placeWalker(entry.walkerId, record.target.approach, context.collisionRevision)) return refuse('placement');
    effects.allowWalking(entry.walkerId, false);
    book = claim.book;
    if (admission) { admissions.delete(context.sessionId); hosted.set(claim.lease.seat.generation, admission.cancel); }
    const released: { lease: RealmInteractionLease; cause: InteractionReleaseCause }[] = [];
    const changed: Self[] = [entry];
    if (claim.replaced) {
      released.push({ lease: claim.replaced, cause: 'replaced' });
      const old = unseat(claim.replaced);
      if (old) changed.push(old);
    }
    setState(entry, { mode: 'seated', targetId, plotId: null });
    publish(before, changed, released, requestId);
    return accept(entry.state, record.target.approach);
  }

  function threshold(context: RealmInteractionContext, entry: Self, record: InteractionRecord, requestId: string | null): Decision {
    if (!record.rest || !effects) return refuse('placement');
    if (!effects.placeWalker(entry.walkerId, record.rest, context.collisionRevision)) return refuse('placement');
    const plotId = record.target.plotId ?? null;
    const state = record.target.kind === 'home-door'
      ? setState(entry, { mode: 'interior', targetId: record.target.id, plotId })
      : setState(entry, { mode: 'standing', targetId: null, plotId: null });
    publish(book, [entry], [], requestId);
    return accept(state, record.rest);
  }

  function receipt(id: string, decision: Decision): RealmReceipt {
    return decision.kind === 'accepted'
      ? { version: 1, id, status: 'applied', writerEpoch, state: decision.result.state }
      : { version: 1, id, status: decision.result.reason === 'unavailable' ? 'unavailable' : 'refused', message: REFUSAL_WORDS[decision.why] };
  }

  /** Rebuild the trusted context from the room's current authority, right now. */
  function contextFor(request: RealmIntentContext, intent: InteractIntent, now: number): RealmInteractionContext | null {
    const walker = request.current(), registry = options.registry();
    if (!walker || !registry) return null;
    const { principal } = request;
    return buildInteractionContext({
      personId: principal.personId, sessionId: principal.sessionId, walkerId: request.walkerId, writerEpoch, now, walker,
      world: options.world(), registry, ownedPlotId: options.homes.ownedPlotId(principal.personId),
      permitted: options.rights.permitted(principal.personId), targetId: intent.targetId, action: intent.action,
      leasedTargetId: seatOfSession(book, principal.sessionId)?.seat.targetId ?? null,
    });
  }

  async function run(request: RealmIntentContext, intent: InteractIntent): Promise<RealmReceipt> {
    const { principal } = request;
    if (disposed) return unavailableReceipt(intent.id, 'epoch');
    if (options.limiter && !options.limiter(principal.personId, options.clock())) return unavailableReceipt(intent.id, 'limited');
    const flight = track(principal.personId, principal.sessionId);
    try { return await awaited(request, intent, flight.controller.signal); } finally { untrack(principal.sessionId, flight); }
  }
  function unavailableReceipt(id: string, why: Why): RealmReceipt { return { version: 1, id, status: 'unavailable', message: REFUSAL_WORDS[why] }; }
  /** The receipt for a request the room stopped waiting for: moderation wins, a closed authority says so. */
  function abandoned(id: string, signal: AbortSignal): RealmReceipt {
    const why = signal.reason as Abandoned;
    return why === 'revoked' ? receipt(id, refuse('rights')) : unavailableReceipt(id, why === 'closed' ? 'epoch' : 'no-room');
  }
  async function awaited(request: RealmIntentContext, intent: InteractIntent, signal: AbortSignal): Promise<RealmReceipt> {
    const { principal } = request;
    const unavailable = (why: Why) => unavailableReceipt(intent.id, why);
    const current = await options.rights.current(principal, options.clock());
    if (signal.aborted) return abandoned(intent.id, signal);
    if (!current) return receipt(intent.id, refuse('rights'));
    let admission: { readonly targetId: string; readonly cancel: () => void } | null = null;
    if (intent.action === 'tavern') {
      // Ask the existing table host only for a chair this person could take right now; then decide again after.
      const early = contextFor(request, intent, options.clock());
      if (!early) return unavailable('no-room');
      const preview = previewSeat(early);
      if (preview) return receipt(intent.id, preview);
      if (!options.hosts?.admit) return unavailable('no-host');
      const answer = await options.hosts.admit({ targetId: intent.targetId, personId: principal.personId, walkerId: request.walkerId, signal });
      if (!answer.admitted) return signal.aborted ? abandoned(intent.id, signal) : answer.reason === 'unavailable' ? unavailable('no-host') : receipt(intent.id, refuse('host-refused'));
      admission = { targetId: intent.targetId, cancel: answer.cancel };
      // Moderation, leave or writer loss while the host was answering: the admission is returned, nobody sits.
      if (signal.aborted || disposed) { admission.cancel(); return abandoned(intent.id, signal); }
    }
    // Everything awaited is behind us: current pose, rights, deed and occupancy are read again, then one act.
    const context = contextFor(request, intent, options.clock());
    if (!context) { admission?.cancel(); return unavailable('no-room'); }
    if (admission) admissions.set(principal.sessionId, admission);
    const decision = decide(context, intent.action, intent.id);
    if (admission && admissions.get(principal.sessionId) === admission) { admissions.delete(principal.sessionId); admission.cancel(); }
    return receipt(intent.id, decision);
  }
  /** The refusal a seat claim would get right now, without mutating anything. */
  function previewSeat(context: RealmInteractionContext): Decision | null {
    if (!context.permitted) return refuse('rights');
    const record = context.target ? options.registry()?.get(context.target.id) : undefined;
    if (!record || record.target.kind !== 'tavern-seat') return context.target ? refuse('wrong-action') : refuse('unreachable');
    const entry = selves.get(context.sessionId);
    const legality = interactionLegality(
      { walkerId: context.walkerId, zone: zoneFor(entry, context.walkerId, context.position), state: entry?.state ?? STANDING, ownedPlotId: context.ownedPlotId },
      record, seatAt(book, record.target.id)?.seat ?? null);
    if (!legality.legal) return refuse(whyOf(legality.reason));
    return context.unobstructed ? null : refuse('unreachable');
  }

  function lifecycleRelease(released: readonly RealmInteractionLease[], cause: InteractionReleaseCause, before: SeatBook): void {
    const changed = released.map(unseat).filter((entry): entry is Self => !!entry);
    publish(before, changed, released.map(lease => ({ lease, cause })));
  }

  const authority: InteractionAuthority = {
    act: (context, action) => decide(context, action, null).result,

    intent(request, intent) {
      const key = `${request.principal.sessionId}\u0000${intent.id}`;
      const known = requests.get(key);
      if (known) return known;
      const pending = run(request, intent).catch((): RealmReceipt => ({ version: 1, id: intent.id, status: 'unavailable', message: REFUSAL_WORDS['no-room'] }));
      requests.set(key, pending);
      if (requests.size > INTERACTION_DEDUPE) requests.delete(requests.keys().next().value!);
      return pending;
    },

    lifecycle(event, principal: RealmPrincipal, walkerId, now) {
      if (disposed) return;
      if (event === 'drop') { authority.drop(principal.sessionId, now); return; }
      if (event === 'leave') {
        authority.release(principal.sessionId);
        selves.delete(principal.sessionId);
        if (control.get(principal.personId) === principal.sessionId) control.delete(principal.personId);
        return;
      }
      // join (a fresh entry: reload or a newer window) and reconnect resume this person's one lease and generation.
      const before = book;
      const entry = self(principal.sessionId, principal.personId, walkerId);
      entry.connected = true; entry.walkerId = walkerId;
      control.set(principal.personId, principal.sessionId);
      const resumed = resumeSeat(book, { personId: principal.personId, sessionId: principal.sessionId, walkerId, now });
      book = resumed.book;
      const ended: { lease: RealmInteractionLease; cause: InteractionReleaseCause }[] = [];
      const changed: Self[] = [];
      if (resumed.ended) { ended.push({ lease: resumed.ended, cause: 'expired' }); const gone = unseat(resumed.ended); if (gone && gone !== entry) changed.push(gone); }
      if (resumed.from && resumed.from.sessionId !== principal.sessionId) {
        // The replaced window's self ends quietly: it is no longer delivered to and holds nothing.
        const old = selves.get(resumed.from.sessionId);
        if (old) { old.connected = false; setState(old, { mode: 'standing', targetId: null, plotId: null }); }
      }
      const lease = resumed.resumed;
      if (lease) {
        // The resumed body is put back on its seat's approach; if that is no longer possible the seat ends.
        const record = options.registry()?.get(lease.seat.targetId);
        if (record && effects?.placeWalker(walkerId, record.target.approach, options.world().revision)) {
          effects.allowWalking(walkerId, false);
          if (entry.state.mode !== 'seated' || entry.state.targetId !== lease.seat.targetId) setState(entry, { mode: 'seated', targetId: lease.seat.targetId, plotId: null });
        } else {
          book = releaseSession(book, principal.sessionId).book;
          ended.push({ lease, cause: 'target-removed' });
          unseat(lease);
          if (entry.state.mode === 'seated') { setState(entry, { mode: 'standing', targetId: null, plotId: null }); effects?.allowWalking(walkerId, true); }
        }
      } else if (entry.state.mode === 'seated') {
        // Nothing is held for this person any more (grace ran out while away): stand, honestly.
        setState(entry, { mode: 'standing', targetId: null, plotId: null });
        effects?.allowWalking(walkerId, true);
      }
      publish(before, changed, ended);
      delivery?.owner(entry.personId, { type: 'interaction', requestId: null, writerEpoch, state: entry.state });
    },

    drop(sessionId, now) {
      const before = book;
      book = dropSession(book, sessionId, now + options.reconnectGraceMs);
      const entry = selves.get(sessionId);
      if (entry) entry.connected = false;
      publish(before, [], []);
    },
    reconnect(sessionId, now) {
      const before = book;
      const held = seatOfSession(book, sessionId);
      book = reconnectSession(book, sessionId, now);
      if (held && !seatOfSession(book, sessionId)) lifecycleRelease([held], 'expired', before);
      else publish(before, [], []);
    },
    release(sessionId) {
      abandon(id => id === sessionId, 'left');
      const before = book;
      const { book: next, released } = releaseSession(book, sessionId);
      book = next;
      lifecycleRelease(released ? [released] : [], 'leave', before);
    },
    expire(now) {
      const before = book;
      const { book: next, released } = expireSeats(book, now);
      book = next;
      lifecycleRelease(released, 'expired', before);
    },

    bindRoom(next) { effects = next; return () => { if (effects === next) effects = null; }; },
    bindDelivery(next) { delivery = next; return () => { if (delivery === next) delivery = null; }; },

    revoke(personId) {
      abandon((_, flight) => flight.personId === personId, 'revoked');
      const before = book;
      const { book: next, released } = releasePerson(book, personId);
      book = next;
      lifecycleRelease(released, 'revoked', before);
    },
    endSeat(seat) {
      const before = book;
      const { book: next, released } = endLease(book, seat);
      if (!released) return false;
      book = next;
      lifecycleRelease([released], 'host-ended', before);
      return true;
    },
    adoptRegistry() {
      const registry = options.registry();
      const before = book;
      const { book: next, released } = releaseTargets(book, id => !!registry?.get(id) && SEAT_KINDS.has(registry.get(id)!.target.kind));
      book = next;
      lifecycleRelease(released, 'target-removed', before);
    },
    nextExpiry() {
      const finite = book.leases.map(lease => lease.expiresAt).filter(Number.isFinite);
      return finite.length ? Math.min(...finite) : null;
    },
    seats: seatsMessage,
    selfState: sessionId => selves.get(sessionId)?.state ?? STANDING,
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    dispose() {
      if (disposed) return;
      const before = book;
      const ended = book.leases;
      book = createSeatBook(writerEpoch);
      abandon(() => true, 'closed');
      for (const admission of admissions.values()) admission.cancel();
      admissions.clear();
      // Hosts hear that every lease ended; nothing is delivered to people from an authority that no longer writes.
      disposed = true;
      lifecycleRelease(ended, 'closed', before);
      listeners.clear(); requests.clear(); selves.clear(); control.clear(); inflight.clear();
      effects = null; delivery = null;
    },
  };
  return authority;
}
