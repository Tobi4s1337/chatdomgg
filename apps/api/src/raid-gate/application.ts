/**
 * The Raid Gate application (spec 23 R1, R2, R4). Main's adapter authenticates the request and supplies the
 * principal; this module decides everything else: who may preview, which preview is current, who is marching.
 *
 * - Only the verified source broadcaster previews. A role, a crown or a URL grants nothing (R1).
 * - One open gate per source. A new request supersedes an older preview that was never started; a started
 *   request is never superseded (R2, R3).
 * - Joining is one person's explicit choice, scoped to one request, and ends when that request closes (R4).
 *
 * - The monarch may close an unstarted preview; its party ends and nobody moves (R3, R4).
 * - Start re-checks everything at the press, then writes Twitch through an outbox: the intent is stored first, claimed
 *   once, and a claimed write that lost its answer is only ever reconciled, never sent again (R3).
 * - Twitch's acceptance is a countdown, not a departure. The party leaves only on a verified `channel.raid` that main's
 *   ingress correlated to this request, for this pair, inside this request's window. That raid goes on to the Atlas's
 *   road ingestion through the same outbox (R3, R11).
 *
 * - Travel commands go to the realm's travel coordinator (`deps.travel`) once the viewer's session is current. A raid
 *   journey is open only to someone who chose to march on that witnessed raid, which `createRaidMarchCheck` answers
 *   from this application's own records (R4, R5).
 *
 * - The destination's welcome and visitor gifts go to `deps.gifts` (`gifts.ts`): offers, answers and the one recorded
 *   ownership transfer, all inside the item authority's own transaction (R9).
 *
 * Commands that later tasks own (passport) answer `unavailable`: honest, never success.
 */
import { AtlasRaidSchema } from '../../../../packages/shared/src/atlas-raids';
import { kingdomForBroadcaster } from '../../../../packages/shared/src/identity';
import {
  GATE_LIMITS, readGateCommand,
  type GateActionState, type GateActionView, type GateAuthority, type GateCommand, type GateContext, type GateDenial, type GatePreview,
  type GatePrincipal, type GateReply, type GateStatusView, type OpenGateView, type PartyView,
} from './contracts';
import type { GiftCommand, VisitorGiftApplication } from './gifts';
import { epoch, fields, kingdom, oneOf, person, token } from './guard';
import type {
  GateNotifier, RaidGateDeps, RaidGateRecovery, RaidMarchCheck, RaidMarchVerdict, RaidObservationReceipt, RaidTravel, RaidWrite, RaidWriteOutcome,
  SourceStanding, TrustedRaidObservation,
} from './ports';
import {
  outboxId,
  type RaidGateRepository,
  type GatePointerRecord, type OutboxKind, type PartyMemberRecord, type RaidActionRecord, type RaidGateTransaction, type RaidOutboxRecord, type Stored,
} from './repository';

export interface RaidGateApplication {
  handle(context: GateContext, command: unknown): Promise<GateReply>;
  /**
   * A verified `channel.raid` from main's ingress. Lands the correlated request once, then hands the raid to the
   * Atlas's road ingestion. Server-only; never reachable from a viewer command.
   */
  ingestRaid(observation: TrustedRaidObservation): Promise<RaidObservationReceipt>;
  /**
   * One recovery pass, for main to run on a timer and at start-up: reconcile possibly-sent Twitch writes without
   * sending them again, send or abandon provably unsent ones, retry road handoffs, and mark overdue countdowns.
   */
  recover(now: number, limit: number): Promise<RaidGateRecovery>;
}

const CONFLICT_RETRIES = 3;
const DISPATCH_TIMEOUT_MS = 15_000;
/** A claimed Twitch write that nobody can explain after this long stops being asked about; only a raid can settle it now. */
const RECONCILE_GIVE_UP_MS = 6 * 60 * 60_000;
/** A road handoff that has not been confirmed is retried no sooner than this. */
const ROAD_RETRY_MS = 30_000;
/** States in which Twitch holds, or may hold, this request. */
const TWITCH_HOLDS: ReadonlySet<GateActionState> = new Set(['dispatching', 'pending', 'unknown']);
const OWN = new AbortController().signal;

class Denied extends Error {
  constructor(readonly code: GateDenial) { super(code); }
}
class Conflict extends Error {}

const denied = (code: GateDenial): GateReply => ({ kind: 'denied', code });

function stored<T>(result: Stored<T>): T {
  if (result.kind === 'conflict') throw new Conflict();
  return result.record;
}

function readPrincipal(value: unknown): GatePrincipal | undefined {
  const f = fields(value, ['personId', 'sessionId', 'sourceKingdomId', 'sourceRole']);
  if (!f) return undefined;
  const principal = { personId: person(f.personId), sessionId: token(f.sessionId), sourceKingdomId: kingdom(f.sourceKingdomId), sourceRole: oneOf(f.sourceRole, ['monarch', 'citizen', 'guest'] as const) };
  return principal.personId && principal.sessionId && principal.sourceKingdomId && principal.sourceRole ? principal as GatePrincipal : undefined;
}

/** The person is this channel's broadcaster by Twitch identity, and the authority agrees. */
function isMonarch(principal: GatePrincipal, standing: SourceStanding): boolean {
  return standing.broadcaster && kingdomForBroadcaster(principal.personId) === principal.sourceKingdomId;
}

function authorityOf(standing: SourceStanding): GateAuthority {
  if (standing.actions === 'disabled') return 'disabled';
  if (standing.raids === 'revoked') return 'revoked';
  if (standing.raids === 'missing') return 'not-connected';
  if (standing.raids === 'unknown') return 'unavailable';
  return standing.live ? 'ready' : 'offline';
}

/** Twitch's countdown end plus the time a verified raid may take to reach us. Past this, a pending raid is unexplained. */
function overdueAt(action: RaidActionRecord): number {
  return (action.acceptedAt ?? action.dispatchedAt ?? action.observedAt) + GATE_LIMITS.twitchCountdownMs + GATE_LIMITS.observationGraceMs;
}

/** The state a viewer is told: a countdown that ran out without a witnessed raid is "checking", never still "pending". */
function viewState(action: RaidActionRecord, now: number): GateActionState {
  return action.state === 'pending' && now >= overdueAt(action) ? 'unknown' : action.state;
}

/** Until when this action is the gate's news. Zero for a gate that closed before it started. */
function shownUntil(action: RaidActionRecord): number {
  switch (action.state) {
    case 'prepared': return action.endReason === null ? action.previewExpiresAt : 0;
    case 'dispatching': return action.observedAt + GATE_LIMITS.unknownHoldMs;
    case 'pending': return overdueAt(action) + GATE_LIMITS.unknownHoldMs;
    case 'unknown': return action.observedAt + GATE_LIMITS.unknownHoldMs;
    case 'landed': case 'rejected': return action.observedAt + GATE_LIMITS.settledShowMs;
    case 'cancelled': return action.endReason === 'withdrawn' ? action.observedAt + GATE_LIMITS.settledShowMs : 0;
  }
}

/** The gate's current news: a live preview, a raid Twitch holds or may hold, or one that settled minutes ago. */
function isShown(action: RaidActionRecord, gate: GatePointerRecord | null, now: number): boolean {
  return gate?.requestId === action.requestId && now < shownUntil(action);
}

/** People may still choose to march: a live preview, or a raid that has not left or been called off. */
function isGathering(action: RaidActionRecord, gate: GatePointerRecord | null, now: number): boolean {
  return isShown(action, gate, now) && (action.state === 'prepared' || TWITCH_HOLDS.has(action.state));
}

function actionView(action: RaidActionRecord, now: number): GateActionView {
  return { requestId: action.requestId, revision: action.revision, from: action.from, to: action.to, state: viewState(action, now), observedAt: action.observedAt, raid: action.raid };
}

function partyView(action: RaidActionRecord, member: PartyMemberRecord | null, shown: boolean): PartyView {
  return { requestId: action.requestId, joined: shown && member?.joined === true, optedIn: shown ? action.optedIn : 0, expiresAt: Math.max(1, shownUntil(action)) };
}

function openView(action: RaidActionRecord, member: PartyMemberRecord | null, now: number): OpenGateView {
  const state = viewState(action, now);
  return {
    requestId: action.requestId, revision: action.revision, to: action.to, target: action.target, state,
    optedIn: action.optedIn, expiresAt: shownUntil(action), joined: member?.joined === true,
    countdownEndsAt: state === 'pending' ? action.acceptedAt! + GATE_LIMITS.twitchCountdownMs : null, raid: action.raid,
  };
}

/** A transport's answer, re-read: anything outside the contract is an answer nobody can vouch for. */
function readOutcome(value: unknown): RaidWriteOutcome {
  const kind = typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
  if (kind === 'accepted') {
    const f = fields(value, ['kind', 'createdAt']);
    const createdAt = f && epoch(f.createdAt);
    return createdAt ? { kind, createdAt } : { kind: 'unknown' };
  }
  if (kind === 'rejected') {
    const f = fields(value, ['kind', 'code']);
    if (!f) return { kind: 'unknown' };
    return { kind, code: token(f.code) ?? 'refused' };
  }
  return { kind: 'unknown' };
}

function readObservation(value: unknown): TrustedRaidObservation | undefined {
  const f = fields(value, ['raid', 'upstreamEventId', 'actionRequestId', 'receivedAt']);
  if (!f) return undefined;
  const raid = AtlasRaidSchema.safeParse(f.raid);
  const upstreamEventId = f.upstreamEventId === null ? null : token(f.upstreamEventId);
  const actionRequestId = f.actionRequestId === null ? null : token(f.actionRequestId);
  const receivedAt = epoch(f.receivedAt);
  if (!raid.success || upstreamEventId === undefined || actionRequestId === undefined || receivedAt === undefined) return undefined;
  return { raid: raid.data, upstreamEventId, actionRequestId, receivedAt };
}

/** How long after the party set out a marcher may still follow it through the gate. */
export const MARCH_WINDOW_MS = GATE_LIMITS.settledShowMs;

/**
 * The gate's answer to the realm's travel coordinator: did this person choose to march on this witnessed raid, and
 * may they still follow it? Read from the gate's own durable records, never from the viewer.
 */
export function createRaidMarchCheck(repository: RaidGateRepository): RaidMarchCheck {
  return {
    async check(personId, requestId, raidId, now, signal): Promise<RaidMarchVerdict> {
      const found = await repository.transaction(async tx => {
        const action = await tx.getAction(requestId);
        return action ? { action, member: await tx.getMember(requestId, personId) } : null;
      }, signal);
      if (!found) return { kind: 'refused', code: 'stale' };
      const { action, member } = found;
      // Only a raid Twitch actually carried out moves anyone, and only the one this person chose.
      if (action.state !== 'landed' || action.raid?.id !== raidId) return { kind: 'refused', code: 'stale' };
      if (member?.joined !== true || member.kingdomId !== action.from) return { kind: 'refused', code: 'unauthorized' };
      if (now >= action.observedAt + MARCH_WINDOW_MS) return { kind: 'refused', code: 'stale' };
      return { kind: 'marching', from: action.from, to: action.to, founded: action.target.founded, origin: action.origin };
    },
  };
}

export function createRaidGateApplication(deps: RaidGateDeps): RaidGateApplication {
  const { repository, policy, tokens, clock } = deps;
  const raids = deps.raids ?? null, roads = deps.roads ?? null;
  const journeys: RaidTravel | null = deps.travel ?? null;
  const gifts: VisitorGiftApplication | null = deps.gifts ?? null;
  const notifier: GateNotifier | undefined = deps.notifier;
  const dispatchTimeoutMs = deps.dispatchTimeoutMs ?? DISPATCH_TIMEOUT_MS;
  if (typeof clock !== 'function') throw new Error('The Raid Gate needs main\'s server clock.');
  // A live gate never talks to a controlled transport, and a simulated one never reaches Twitch or the real Atlas.
  for (const [name, port] of [['raid transport', raids], ['road ingestion', roads], ['travel coordinator', journeys], ['visitor gifts', gifts]] as const) {
    if (port && port.origin !== deps.origin) throw new Error(`The Raid Gate is ${deps.origin}, but its ${name} is ${port.origin}.`);
  }

  async function transact<T>(work: (tx: RaidGateTransaction) => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await repository.transaction(work, signal);
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        if (attempt + 1 >= CONFLICT_RETRIES) throw new Denied('stale');
      }
    }
  }

  /** Runs `work` atomically for a viewer's request, retrying a lost compare-and-set race before calling the view stale. */
  const atomically = <T>(context: GateContext, work: (tx: RaidGateTransaction) => Promise<T>) => transact(work, context.signal);

  async function standingOf(context: GateContext): Promise<SourceStanding> {
    let standing: SourceStanding;
    try {
      standing = await policy.readStanding(context.principal, context.now, context.signal);
    } catch {
      context.signal.throwIfAborted();
      throw new Denied('unavailable');
    }
    if (standing.session !== 'current') throw new Denied('unauthorized');
    return standing;
  }

  function announce(action: RaidActionRecord): void {
    notifier?.changed({ kingdomId: action.from, requestId: action.requestId, revision: action.revision });
  }

  /** Writes the next revision of an action. */
  async function advance(tx: RaidGateTransaction, action: RaidActionRecord, change: Partial<RaidActionRecord>, now: number): Promise<RaidActionRecord> {
    return stored(await tx.putAction({ ...action, ...change, revision: action.revision + 1, updatedAt: Math.max(now, action.updatedAt) }, action.revision));
  }

  async function advanceOutbox(tx: RaidGateTransaction, item: RaidOutboxRecord, change: Partial<RaidOutboxRecord>): Promise<RaidOutboxRecord> {
    return stored(await tx.putOutbox({ ...item, ...change, revision: item.revision + 1 }, item.revision));
  }

  function queue(tx: RaidGateTransaction, requestId: string, kind: OutboxKind, now: number): Promise<RaidOutboxRecord> {
    return tx.putOutbox({
      id: outboxId(requestId, kind), revision: 1, requestId, kind, state: 'queued', createdAt: now,
      claimedAt: null, settledAt: null, outcome: null, attempts: 0, origin: deps.origin,
    }, 0).then(stored);
  }

  // ---- Twitch writes through the outbox ----------------------------------------------------------------------------

  const writeFor = (item: RaidOutboxRecord, action: RaidActionRecord): RaidWrite => ({ key: item.id, requestId: action.requestId, from: action.from, to: action.to });

  /**
   * Applies Twitch's answer to a claimed write. `unknown` changes nothing durable but the action's honesty: a start
   * whose answer was lost is `unknown`, and the write stays claimed for reconciliation.
   */
  async function settle(id: string, outcome: RaidWriteOutcome): Promise<void> {
    const changed = await transact(async tx => {
      const item = await tx.getOutbox(id);
      if (!item || item.state !== 'claimed') return null;
      const action = await tx.getAction(item.requestId);
      if (!action) throw new Error('A Raid Gate outbox record has no action.');
      const now = clock();
      if (outcome.kind === 'unknown') {
        return item.kind === 'start' && action.state === 'dispatching' ? advance(tx, action, { state: 'unknown', observedAt: now }, now) : null;
      }
      await advanceOutbox(tx, item, { state: 'settled', settledAt: now, outcome: outcome.kind });
      if (!TWITCH_HOLDS.has(action.state)) return null;
      if (item.kind === 'start') {
        if (action.state === 'pending') return null;
        return advance(tx, action, outcome.kind === 'accepted'
          ? { state: 'pending', acceptedAt: outcome.createdAt, observedAt: now }
          : { state: 'rejected', rejection: outcome.code, observedAt: now }, now);
      }
      // Twitch confirmed the cancel: the party turns back. Twitch held nothing to cancel: the raid may already have
      // left, so only a witnessed raid (or its absence, reconciled) can say what happened.
      return advance(tx, action, outcome.kind === 'accepted'
        ? { state: 'cancelled', endReason: 'withdrawn', observedAt: now }
        : { state: 'unknown', observedAt: now }, now);
    }, OWN);
    if (changed) announce(changed);
  }

  /** Claims a provably unsent write and hands it to Twitch once. Whatever happens next, it is never sent again. */
  async function send(id: string): Promise<boolean> {
    if (!raids) return false;
    const claim = await transact(async tx => {
      const item = await tx.getOutbox(id);
      if (!item || item.state !== 'queued' || item.kind === 'road') return null;
      const action = await tx.getAction(item.requestId);
      if (!action) throw new Error('A Raid Gate outbox record has no action.');
      const claimed = await advanceOutbox(tx, item, { state: 'claimed', claimedAt: clock(), attempts: 1 });
      return { item: claimed, action };
    }, OWN);
    if (!claim) return false;
    const call = claim.item.kind === 'start' ? raids.start : raids.cancel;
    let outcome: RaidWriteOutcome;
    try {
      outcome = readOutcome(await call.call(raids, writeFor(claim.item, claim.action), AbortSignal.timeout(dispatchTimeoutMs)));
    } catch {
      outcome = { kind: 'unknown' };
    }
    await settle(id, outcome);
    return true;
  }

  /** Asks the transport what became of a claimed write. Never writes to Twitch. */
  async function reconcileWrite(id: string, now: number): Promise<boolean> {
    if (!raids) return false;
    const found = await transact(async tx => {
      const item = await tx.getOutbox(id);
      if (!item || item.state !== 'claimed' || item.kind === 'road') return null;
      const action = await tx.getAction(item.requestId);
      if (!action) throw new Error('A Raid Gate outbox record has no action.');
      if (now - item.claimedAt! >= RECONCILE_GIVE_UP_MS) {
        // Nobody can explain this write any more. It stays unexplained; a verified raid can still land the request.
        await advanceOutbox(tx, item, { state: 'settled', settledAt: now, outcome: 'unknown' });
        return null;
      }
      return { item, action };
    }, OWN);
    if (!found) return false;
    let outcome: RaidWriteOutcome;
    try {
      outcome = readOutcome(await raids.reconcile(writeFor(found.item, found.action), AbortSignal.timeout(dispatchTimeoutMs)));
    } catch {
      outcome = { kind: 'unknown' };
    }
    if (outcome.kind !== 'unknown') await settle(id, outcome);
    return outcome.kind !== 'unknown';
  }

  /** A start that never reached Twitch and whose preview has run out: nothing was sent, and the party is released. */
  async function lapse(id: string, now: number): Promise<boolean> {
    const changed = await transact(async tx => {
      const item = await tx.getOutbox(id);
      if (!item || item.state !== 'queued' || item.kind !== 'start') return null;
      const action = await tx.getAction(item.requestId);
      if (!action) throw new Error('A Raid Gate outbox record has no action.');
      await advanceOutbox(tx, item, { state: 'settled', settledAt: now, outcome: 'lapsed' });
      if (action.state !== 'dispatching') return null;
      const ended = await advance(tx, action, { state: 'cancelled', endReason: 'expired', observedAt: now }, now);
      const gate = await tx.getGate(action.from);
      if (gate?.requestId === action.requestId) stored(await tx.putGate({ ...gate, revision: gate.revision + 1, requestId: null, updatedAt: now }, gate.revision));
      return ended;
    }, OWN);
    if (changed) announce(changed);
    return changed !== null;
  }

  /** Hands a witnessed raid to the Atlas's road ingestion. Idempotent there, so a retry is safe. */
  async function deliver(id: string, now: number): Promise<boolean> {
    if (!roads) return false;
    const claim = await transact(async tx => {
      const item = await tx.getOutbox(id);
      if (!item || item.kind !== 'road' || item.state === 'settled') return null;
      if (item.state === 'claimed' && now - item.claimedAt! < ROAD_RETRY_MS) return null;
      const action = await tx.getAction(item.requestId);
      if (!action?.raid) throw new Error('A Raid Gate road handoff has no witnessed raid.');
      await advanceOutbox(tx, item, { state: 'claimed', claimedAt: now, attempts: item.attempts + 1 });
      return action.raid;
    }, OWN);
    if (!claim) return false;
    try {
      await roads.observe(claim, AbortSignal.timeout(dispatchTimeoutMs));
    } catch {
      return false;
    }
    return transact(async tx => {
      const item = await tx.getOutbox(id);
      if (!item || item.state !== 'claimed') return false;
      await advanceOutbox(tx, item, { state: 'settled', settledAt: clock(), outcome: 'delivered' });
      return true;
    }, OWN);
  }

  /** A countdown that ran out with no witnessed raid becomes `unknown` on record, as viewers were already told. */
  async function markOverdue(requestId: string, now: number): Promise<boolean> {
    const changed = await transact(async tx => {
      const action = await tx.getAction(requestId);
      if (!action || action.state !== 'pending' || now < overdueAt(action)) return null;
      return advance(tx, action, { state: 'unknown', observedAt: overdueAt(action) }, now);
    }, OWN);
    if (changed) announce(changed);
    return changed !== null;
  }

  // ---- Viewer commands ---------------------------------------------------------------------------------------------

  async function status(context: GateContext): Promise<GateReply> {
    const { principal, now } = context;
    const standing = await standingOf(context);
    const monarch = isMonarch(principal, standing);
    const open = await atomically(context, async tx => {
      const gate = await tx.getGate(principal.sourceKingdomId);
      const action = gate?.requestId ? await tx.getAction(gate.requestId) : null;
      if (!action || !isShown(action, gate, now)) return null;
      return openView(action, await tx.getMember(action.requestId, principal.personId), now);
    });
    const value: GateStatusView = { kingdomId: principal.sourceKingdomId, viewer: monarch ? 'monarch' : 'walker', authority: monarch ? authorityOf(standing) : null, open };
    return { kind: 'gate', value };
  }

  /** The broadcaster check before any policy call, then the authority's own verdict. */
  async function monarchStanding(context: GateContext): Promise<SourceStanding | null> {
    const { principal } = context;
    if (kingdomForBroadcaster(principal.personId) !== principal.sourceKingdomId) return null;
    const standing = await standingOf(context);
    return isMonarch(principal, standing) ? standing : null;
  }

  /** The destination's verdict right now, or the denial that stops the preview or start. */
  async function verdictFor(context: GateContext, target: RaidActionRecord['to']) {
    let verdict;
    try {
      verdict = await policy.readTarget(context.principal.sourceKingdomId, target, context.now, context.signal);
    } catch {
      context.signal.throwIfAborted();
      throw new Denied('unavailable');
    }
    if (!verdict || verdict.target.kingdomId !== target) throw new Denied('invalid');
    if (!verdict.target.live) throw new Denied('unavailable');
    if (!verdict.permitted || verdict.target.classification === 'excluded') throw new Denied('unauthorized');
    return verdict;
  }

  function requireReady(standing: SourceStanding): void {
    const authority = authorityOf(standing);
    if (authority === 'offline' || authority === 'unavailable') throw new Denied('unavailable');
    if (authority !== 'ready') throw new Denied('unauthorized');
  }

  async function preview(context: GateContext, command: Extract<GateCommand, { op: 'preview' }>): Promise<GateReply> {
    const { principal, now } = context;
    const from = principal.sourceKingdomId;
    // Refuse a non-broadcaster before asking anyone anything.
    if (kingdomForBroadcaster(principal.personId) !== from) return denied('unauthorized');
    if (command.target === from) return denied('invalid');
    const standing = await monarchStanding(context);
    if (!standing) return denied('unauthorized');
    requireReady(standing);
    const verdict = await verdictFor(context, command.target);

    const secret = tokens.issue();
    const hash = await tokens.hash(secret);
    const expiresAt = now + GATE_LIMITS.previewMs;
    const changed: RaidActionRecord[] = [];
    const action = await atomically(context, async tx => {
      changed.length = 0;
      const gate = await tx.getGate(from);
      const existing = await tx.getAction(command.requestId);
      if (existing) {
        // A request ID is one monarch's one decision, never a shared handle.
        if (existing.from !== from || existing.actorId !== principal.personId) throw new Denied('unauthorized');
        if (existing.to !== command.target) throw new Denied('invalid');
        if (existing.state !== 'prepared' || !isGathering(existing, gate, now)) throw new Denied('stale');
        // Same decision, fresh window: a new token replaces the old one and the gathered party stays.
        return advance(tx, existing, {
          sessionId: principal.sessionId, target: verdict.target, previewTokenHash: hash, previewExpiresAt: expiresAt, observedAt: now,
        }, now);
      }
      const current = gate?.requestId ? await tx.getAction(gate.requestId) : null;
      if (current && current.state === 'prepared' && current.endReason === null) {
        // An unstarted preview for another destination closes; its party's choice ended with it.
        changed.push(await advance(tx, current, {
          state: 'cancelled', observedAt: now, endReason: now < current.previewExpiresAt ? 'superseded' : 'expired',
        }, now));
      } else if (current && TWITCH_HOLDS.has(current.state) && isGathering(current, gate, now)) {
        // A raid Twitch holds, or may hold, is settled through Twitch, never replaced by a new idea.
        throw new Denied('stale');
      }
      const created = stored(await tx.putAction({
        requestId: command.requestId, revision: 1, actorId: principal.personId, sessionId: principal.sessionId, from, to: command.target,
        target: verdict.target, state: 'prepared', previewTokenHash: hash, previewExpiresAt: expiresAt, optedIn: 0,
        createdAt: now, updatedAt: now, observedAt: now, raid: null, endReason: null, origin: deps.origin,
        dispatchedAt: null, acceptedAt: null, rejection: null, raidEventId: null,
      }, 0));
      stored(await tx.putGate({ kingdomId: from, revision: (gate?.revision ?? 0) + 1, requestId: created.requestId, updatedAt: now }, gate?.revision ?? 0));
      return created;
    });
    for (const each of changed) announce(each);
    announce(action);
    const value: GatePreview = { token: secret, requestId: action.requestId, from, to: action.to, expiresAt, optedIn: action.optedIn, target: action.target };
    return { kind: 'preview', value };
  }

  /**
   * The monarch opens the gate. Everything is checked again at the press: session, broadcaster, live, grant, consent,
   * the preview's own token and window, and the destination's current verdict. The intent is stored before Twitch is
   * asked; a repeated press, a reload or a lost reply finds that intent and never asks Twitch twice.
   */
  async function start(context: GateContext, command: Extract<GateCommand, { op: 'start' }>): Promise<GateReply> {
    const { principal, now } = context;
    const standing = await monarchStanding(context);
    if (!standing) return denied('unauthorized');
    const hash = await tokens.hash(command.previewToken);
    const check = (action: RaidActionRecord | null): RaidActionRecord => {
      if (!action) throw new Denied('stale');
      if (action.from !== principal.sourceKingdomId || action.actorId !== principal.personId) throw new Denied('unauthorized');
      // The token is the proof of this one preview; a rotated or foreign one opens nothing.
      if (action.previewTokenHash !== hash) throw new Denied('stale');
      return action;
    };
    const seen = check(await atomically(context, tx => tx.getAction(command.requestId)));
    if (seen.state !== 'prepared') return { kind: 'action', value: actionView(seen, now) };
    if (!raids) return denied('unavailable');
    requireReady(standing);
    const verdict = await verdictFor(context, seen.to);

    const id = outboxId(command.requestId, 'start');
    const queued = await atomically(context, async tx => {
      const action = check(await tx.getAction(command.requestId));
      if (action.state !== 'prepared') return { action, fresh: false };
      if (!isGathering(action, await tx.getGate(action.from), now)) throw new Denied('stale');
      const next = await advance(tx, action, { state: 'dispatching', target: verdict.target, dispatchedAt: now, observedAt: now }, now);
      await queue(tx, action.requestId, 'start', now);
      return { action: next, fresh: true };
    });
    if (!queued.fresh) return { kind: 'action', value: actionView(queued.action, now) };
    announce(queued.action);
    // The viewer's request may end now; the write and its answer belong to the server from here.
    await send(id);
    const after = await transact(tx => tx.getAction(command.requestId), OWN);
    return { kind: 'action', value: actionView(after ?? queued.action, clock()) };
  }

  async function choose(context: GateContext, requestId: string, join: boolean): Promise<GateReply> {
    const { principal, now } = context;
    await standingOf(context);
    const changed: RaidActionRecord[] = [];
    const party = await atomically(context, async tx => {
      changed.length = 0;
      const action = await tx.getAction(requestId);
      if (!action) throw new Denied('stale');
      if (action.from !== principal.sourceKingdomId) throw new Denied('unauthorized');
      const gate = await tx.getGate(action.from);
      const member = await tx.getMember(requestId, principal.personId);
      const shown = isShown(action, gate, now);
      // Joining needs a gate still gathering; staying home is always possible, even after the party set out.
      if (join ? !isGathering(action, gate, now) : !shown) {
        if (join) throw new Denied('stale');
        return partyView(action, member, false);
      }
      if ((member?.joined === true) === join) return partyView(action, member, true);
      const nextMember = stored(await tx.putMember({
        requestId, personId: principal.personId, kingdomId: action.from, sessionId: principal.sessionId, joined: join,
        revision: (member?.revision ?? 0) + 1, joinedAt: join ? now : null, updatedAt: now,
      }, member?.revision ?? 0));
      const nextAction = await advance(tx, action, { optedIn: action.optedIn + (join ? 1 : -1) }, now);
      changed.push(nextAction);
      return partyView(nextAction, nextMember, true);
    });
    for (const action of changed) announce(action);
    return { kind: 'party', value: party };
  }

  /**
   * The monarch closes the gate. Before starting, nothing was sent: the request ends here, the gate pointer clears
   * and every walker's choice ends with it. Once Twitch holds the raid, the cancel goes to Twitch through the outbox,
   * once; the party turns back only when Twitch confirms it.
   */
  async function close(context: GateContext, requestId: string): Promise<GateReply> {
    const { principal, now } = context;
    // Closing an unstarted preview sends nothing to Twitch, so a missing or withdrawn raid grant never traps it open.
    if (!await monarchStanding(context)) return denied('unauthorized');
    const changed: RaidActionRecord[] = [];
    const result = await atomically(context, async tx => {
      changed.length = 0;
      const action = await tx.getAction(requestId);
      if (!action) throw new Denied('stale');
      if (action.from !== principal.sourceKingdomId || action.actorId !== principal.personId) throw new Denied('unauthorized');
      if (action.state === 'pending' || action.state === 'unknown') {
        if (!raids) throw new Denied('unavailable');
        // One cancel per request. A second press finds the first.
        if (await tx.getOutbox(outboxId(requestId, 'cancel'))) return { action, cancel: false };
        await queue(tx, requestId, 'cancel', now);
        return { action, cancel: true };
      }
      // Twitch is being asked to start right now; the monarch can call it off once it answers.
      if (action.state !== 'prepared' || action.endReason !== null) return { action, cancel: false };
      const ended = await advance(tx, action, {
        state: 'cancelled', observedAt: now, endReason: now < action.previewExpiresAt ? 'closed' : 'expired',
      }, now);
      const gate = await tx.getGate(action.from);
      if (gate?.requestId === requestId) stored(await tx.putGate({ ...gate, revision: gate.revision + 1, requestId: null, updatedAt: now }, gate.revision));
      changed.push(ended);
      return { action: ended, cancel: false };
    });
    for (const each of changed) announce(each);
    if (!result.cancel) return { kind: 'action', value: actionView(result.action, now) };
    await send(outboxId(requestId, 'cancel'));
    const after = await transact(tx => tx.getAction(requestId), OWN);
    return { kind: 'action', value: actionView(after ?? result.action, clock()) };
  }

  /**
   * Resumes a request after a lost reply or a reload. The monarch's reconcile asks the transport what became of each
   * claimed write (never sending it again) and sends a write that provably never left. A walker only reads.
   */
  async function reconcile(context: GateContext, requestId: string): Promise<GateReply> {
    const { principal, now } = context;
    const monarch = kingdomForBroadcaster(principal.personId) === principal.sourceKingdomId && await monarchStanding(context) !== null;
    if (!monarch) await standingOf(context);
    const action = await atomically(context, tx => tx.getAction(requestId));
    if (!action) return denied('stale');
    if (action.from !== principal.sourceKingdomId) return denied('unauthorized');
    if (monarch && action.actorId === principal.personId) {
      for (const kind of ['start', 'cancel'] as const) {
        const id = outboxId(requestId, kind);
        const item = await atomically(context, tx => tx.getOutbox(id));
        if (item?.state === 'claimed') await reconcileWrite(id, now);
        else if (item?.state === 'queued' && kind === 'start') await (now < action.previewExpiresAt ? send(id) : lapse(id, now));
        else if (item?.state === 'queued') await send(id);
      }
      await markOverdue(requestId, now);
    }
    const after = await transact(tx => tx.getAction(requestId), OWN);
    return { kind: 'action', value: actionView(after ?? action, now) };
  }

  async function readAction(context: GateContext, requestId: string): Promise<GateReply> {
    await standingOf(context);
    const action = await atomically(context, tx => tx.getAction(requestId));
    if (!action) return denied('stale');
    if (action.from !== context.principal.sourceKingdomId) return denied('unauthorized');
    return { kind: 'action', value: actionView(action, context.now) };
  }

  /** A travel command, for a viewer whose session is current. The coordinator checks every ticket is theirs. */
  async function journey(context: GateContext, command: Extract<GateCommand, { op: 'reserve' | 'prepare' | 'commit' | 'cancel-travel' | 'reconcile-travel' | 'whereabouts' }>): Promise<GateReply> {
    if (!journeys) return denied('unavailable');
    await standingOf(context);
    switch (command.op) {
      case 'reserve': return journeys.reserve(context, command.requestId, command.target, command.reason);
      case 'prepare': return journeys.prepare(context, command.ticket);
      case 'commit': return journeys.commit(context, command.ticket);
      case 'cancel-travel': return journeys.cancel(context, command.ticket);
      case 'reconcile-travel': return journeys.reconcile(context, command.ticket);
      case 'whereabouts': return journeys.whereabouts(context);
    }
  }

  /** A welcome or gift command, for a viewer whose session is current. The gift application checks the rest. */
  async function gift(context: GateContext, command: GiftCommand): Promise<GateReply> {
    if (!gifts) return denied('unavailable');
    await standingOf(context);
    return gifts.handle(context, command);
  }

  // ---- Server-only ingress and recovery ----------------------------------------------------------------------------

  const ignored = (reason: Extract<RaidObservationReceipt, { kind: 'ignored' }>['reason']): RaidObservationReceipt => ({ kind: 'ignored', reason });

  async function ingestRaid(input: TrustedRaidObservation): Promise<RaidObservationReceipt> {
    const observation = readObservation(input);
    if (!observation) return ignored('invalid');
    const { raid, upstreamEventId, actionRequestId } = observation;
    // A live gate lands only on Chatdom's own verified EventSub; a simulated one only on a labelled simulation.
    // Replays and legacy feeds are history, never a departure.
    const trusted = deps.origin === 'live' ? raid.source === 'herald' && raid.evidence.kind === 'observed' : raid.source === 'simulation';
    if (!trusted) return ignored('untrusted');
    if (actionRequestId === null || upstreamEventId === null) return ignored('uncorrelated');
    const now = clock();
    const outcome = await transact(async (tx): Promise<Readonly<{ receipt: RaidObservationReceipt; landed: RaidActionRecord | null }>> => {
      const action = await tx.getAction(actionRequestId);
      if (!action) return { receipt: ignored('unknown-request'), landed: null };
      if (action.from !== raid.fromKingdomId || action.to !== raid.toKingdomId) return { receipt: ignored('mismatch'), landed: null };
      if (action.state === 'landed') {
        const same = action.raidEventId === upstreamEventId || action.raid?.id === raid.id;
        return { receipt: same ? { kind: 'duplicate', requestId: action.requestId } : ignored('conflict'), landed: null };
      }
      // A confirmed cancel or a refusal already settled this request; a raid seen now is not the one it asked for.
      if (!TWITCH_HOLDS.has(action.state) || action.dispatchedAt === null) return { receipt: ignored('settled'), landed: null };
      const startItem = await tx.getOutbox(outboxId(action.requestId, 'start'));
      // Twitch cannot have acted on a write that never left.
      if (!startItem || startItem.attempts === 0) return { receipt: ignored('uncorrelated'), landed: null };
      // The raid happened after this press and no later than this request's countdown allows.
      const at = raid.occurredAt ?? raid.observedAt;
      const base = Math.max(action.acceptedAt ?? 0, action.dispatchedAt);
      const latest = base + GATE_LIMITS.twitchCountdownMs + (raid.occurredAt === null ? GATE_LIMITS.observationGraceMs : GATE_LIMITS.clockSkewMs);
      if (at < action.dispatchedAt - GATE_LIMITS.clockSkewMs || at > latest) return { receipt: ignored('out-of-window'), landed: null };

      const landed = await advance(tx, action, { state: 'landed', raid, raidEventId: upstreamEventId, observedAt: now, endReason: null }, now);
      if (startItem.state === 'claimed') await advanceOutbox(tx, startItem, { state: 'settled', settledAt: now, outcome: 'accepted' });
      const cancelItem = await tx.getOutbox(outboxId(action.requestId, 'cancel'));
      // The raid left before any cancel could hold it: there was nothing left to cancel.
      if (cancelItem?.state === 'claimed') await advanceOutbox(tx, cancelItem, { state: 'settled', settledAt: now, outcome: 'rejected' });
      else if (cancelItem?.state === 'queued') await advanceOutbox(tx, cancelItem, { state: 'settled', settledAt: now, outcome: 'lapsed' });
      await queue(tx, action.requestId, 'road', now);
      return { receipt: { kind: 'landed', requestId: action.requestId }, landed };
    }, OWN);
    if (outcome.landed) {
      announce(outcome.landed);
      await deliver(outboxId(outcome.landed.requestId, 'road'), now);
    }
    return outcome.receipt;
  }

  async function recover(now: number, limit: number): Promise<RaidGateRecovery> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('A Raid Gate recovery pass takes 1–100 records per kind.');
    const report = { reconciled: 0, sent: 0, lapsed: 0, delivered: 0, overdue: 0 };
    // First what may already have happened: ask about it, never repeat it.
    for (const item of await transact(tx => tx.listOutbox('claimed', null, limit), OWN)) {
      if (item.kind === 'road') { if (await deliver(item.id, now)) report.delivered++; }
      else if (await reconcileWrite(item.id, now)) report.reconciled++;
    }
    // Then what provably never left.
    for (const item of await transact(tx => tx.listOutbox('queued', null, limit), OWN)) {
      if (item.kind === 'road') { if (await deliver(item.id, now)) report.delivered++; continue; }
      const action = await transact(tx => tx.getAction(item.requestId), OWN);
      if (item.kind === 'start' && (!action || now >= action.previewExpiresAt)) { if (await lapse(item.id, now)) report.lapsed++; }
      else if (await send(item.id)) report.sent++;
    }
    for (const action of await transact(tx => tx.listActions('pending', null, limit), OWN)) {
      if (await markOverdue(action.requestId, now)) report.overdue++;
    }
    return report;
  }

  return {
    async handle(context: GateContext, raw: unknown): Promise<GateReply> {
      context.signal.throwIfAborted();
      const principal = readPrincipal(context.principal);
      if (!principal) return denied('unauthorized');
      const command = readGateCommand(raw);
      if (!command) return denied('invalid');
      const scoped: GateContext = { principal, now: context.now, signal: context.signal };
      try {
        switch (command.op) {
          case 'gate': return await status(scoped);
          case 'preview': return await preview(scoped, command);
          case 'start': return await start(scoped, command);
          case 'join': return await choose(scoped, command.requestId, true);
          case 'leave': return await choose(scoped, command.requestId, false);
          case 'read-action': return await readAction(scoped, command.requestId);
          case 'reconcile': return await reconcile(scoped, command.requestId);
          case 'cancel': return await close(scoped, command.requestId);
          case 'reserve': case 'prepare': case 'commit': case 'cancel-travel': case 'reconcile-travel': case 'whereabouts':
            return await journey(scoped, command);
          case 'welcome': case 'offer-gift': case 'accept-gift': case 'refuse-gift':
            return await gift(scoped, command);
          default: return denied('unavailable');
        }
      } catch (error) {
        if (error instanceof Denied) return denied(error.code);
        throw error;
      }
    },
    ingestRaid,
    recover,
  };
}
