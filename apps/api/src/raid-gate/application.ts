/**
 * The Raid Gate application (spec 23 R1, R2, R4). Main's adapter authenticates the request and supplies the
 * principal; this module decides everything else: who may preview, which preview is current, who is marching.
 *
 * - Only the verified source broadcaster previews. A role, a crown or a URL grants nothing (R1).
 * - One open gate per source. A new request supersedes an older preview that was never started; a started
 *   request is never superseded (R2, R3).
 * - Joining is one person's explicit choice, scoped to one request, and ends when that request closes (R4).
 *
 * Commands that later tasks own (start, travel, passport, gifts) answer `unavailable`: honest, never success.
 */
import { kingdomForBroadcaster } from '../../../../packages/shared/src/identity';
import {
  GATE_LIMITS, readGateCommand,
  type GateActionView, type GateAuthority, type GateCommand, type GateContext, type GateDenial, type GatePreview, type GatePrincipal,
  type GateReply, type GateStatusView, type OpenGateView, type PartyView,
} from './contracts';
import { fields, kingdom, oneOf, person, token } from './guard';
import type { GateNotifier, RaidGateDeps, SourceStanding } from './ports';
import type { GatePointerRecord, PartyMemberRecord, RaidActionRecord, RaidGateTransaction, Stored } from './repository';

export interface RaidGateApplication {
  handle(context: GateContext, command: unknown): Promise<GateReply>;
}

const CONFLICT_RETRIES = 3;
const LIVE_STATES = new Set(['dispatching', 'pending', 'unknown']);

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

/** An action still gathering people: a live preview, or a request Twitch has not settled. */
function isOpen(action: RaidActionRecord, gate: GatePointerRecord | null, now: number): boolean {
  if (gate?.requestId !== action.requestId) return false;
  return action.state === 'prepared' ? now < action.previewExpiresAt : LIVE_STATES.has(action.state);
}

function partyExpiry(action: RaidActionRecord): number {
  return action.state === 'prepared' ? action.previewExpiresAt : action.observedAt + GATE_LIMITS.twitchCountdownMs;
}

function actionView(action: RaidActionRecord): GateActionView {
  return { requestId: action.requestId, revision: action.revision, from: action.from, to: action.to, state: action.state, observedAt: action.observedAt, raid: action.raid };
}

function partyView(action: RaidActionRecord, member: PartyMemberRecord | null, open: boolean): PartyView {
  return { requestId: action.requestId, joined: open && member?.joined === true, optedIn: open ? action.optedIn : 0, expiresAt: partyExpiry(action) };
}

function openView(action: RaidActionRecord, member: PartyMemberRecord | null): OpenGateView {
  return {
    requestId: action.requestId, revision: action.revision, to: action.to, target: action.target, state: action.state,
    optedIn: action.optedIn, expiresAt: partyExpiry(action), joined: member?.joined === true,
  };
}

export function createRaidGateApplication(deps: RaidGateDeps): RaidGateApplication {
  const { repository, policy, tokens } = deps;
  const notifier: GateNotifier | undefined = deps.notifier;

  /** Runs `work` atomically, retrying a lost compare-and-set race a few times before calling the view stale. */
  async function atomically<T>(context: GateContext, work: (tx: RaidGateTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await repository.transaction(work, context.signal);
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        if (attempt + 1 >= CONFLICT_RETRIES) throw new Denied('stale');
      }
    }
  }

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

  async function status(context: GateContext): Promise<GateReply> {
    const { principal, now } = context;
    const standing = await standingOf(context);
    const monarch = isMonarch(principal, standing);
    const open = await atomically(context, async tx => {
      const gate = await tx.getGate(principal.sourceKingdomId);
      const action = gate?.requestId ? await tx.getAction(gate.requestId) : null;
      if (!action || !isOpen(action, gate, now)) return null;
      return openView(action, await tx.getMember(action.requestId, principal.personId));
    });
    const value: GateStatusView = { kingdomId: principal.sourceKingdomId, viewer: monarch ? 'monarch' : 'walker', authority: monarch ? authorityOf(standing) : null, open };
    return { kind: 'gate', value };
  }

  async function preview(context: GateContext, command: Extract<GateCommand, { op: 'preview' }>): Promise<GateReply> {
    const { principal, now, signal } = context;
    const from = principal.sourceKingdomId;
    // Refuse a non-broadcaster before asking anyone anything.
    if (kingdomForBroadcaster(principal.personId) !== from) return denied('unauthorized');
    if (command.target === from) return denied('invalid');
    const standing = await standingOf(context);
    if (!isMonarch(principal, standing)) return denied('unauthorized');
    const authority = authorityOf(standing);
    if (authority === 'offline' || authority === 'unavailable') return denied('unavailable');
    if (authority !== 'ready') return denied('unauthorized');

    let verdict;
    try {
      verdict = await policy.readTarget(from, command.target, now, signal);
    } catch {
      signal.throwIfAborted();
      return denied('unavailable');
    }
    if (!verdict || verdict.target.kingdomId !== command.target) return denied('invalid');
    if (!verdict.target.live) return denied('unavailable');
    if (!verdict.permitted || verdict.target.classification === 'excluded') return denied('unauthorized');

    const secret = tokens.issue();
    const hash = await tokens.hash(secret);
    const expiresAt = now + GATE_LIMITS.previewMs;
    const action = await atomically(context, async tx => {
      const gate = await tx.getGate(from);
      const existing = await tx.getAction(command.requestId);
      if (existing) {
        // A request ID is one monarch's one decision, never a shared handle.
        if (existing.from !== from || existing.actorId !== principal.personId) throw new Denied('unauthorized');
        if (existing.to !== command.target) throw new Denied('invalid');
        if (!isOpen(existing, gate, now) || existing.state !== 'prepared') throw new Denied('stale');
        // Same decision, fresh window: a new token replaces the old one and the gathered party stays.
        return stored(await tx.putAction({
          ...existing, revision: existing.revision + 1, sessionId: principal.sessionId, target: verdict.target,
          previewTokenHash: hash, previewExpiresAt: expiresAt, updatedAt: now, observedAt: now,
        }, existing.revision));
      }
      const current = gate?.requestId ? await tx.getAction(gate.requestId) : null;
      if (current && current.state === 'prepared' && current.endReason === null) {
        // An unstarted preview for another destination closes; its party's choice ended with it.
        stored(await tx.putAction({
          ...current, revision: current.revision + 1, state: 'cancelled', updatedAt: now, observedAt: now,
          endReason: now < current.previewExpiresAt ? 'superseded' : 'expired',
        }, current.revision));
      } else if (current && LIVE_STATES.has(current.state)) {
        throw new Denied('stale');
      }
      const created = stored(await tx.putAction({
        requestId: command.requestId, revision: 1, actorId: principal.personId, sessionId: principal.sessionId, from, to: command.target,
        target: verdict.target, state: 'prepared', previewTokenHash: hash, previewExpiresAt: expiresAt, optedIn: 0,
        createdAt: now, updatedAt: now, observedAt: now, raid: null, endReason: null, origin: deps.origin,
      }, 0));
      stored(await tx.putGate({ kingdomId: from, revision: (gate?.revision ?? 0) + 1, requestId: created.requestId, updatedAt: now }, gate?.revision ?? 0));
      return created;
    });
    announce(action);
    const value: GatePreview = { token: secret, requestId: action.requestId, from, to: action.to, expiresAt, optedIn: action.optedIn, target: action.target };
    return { kind: 'preview', value };
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
      if (!isOpen(action, gate, now)) {
        // Leaving a closed request is already true; joining one is not possible.
        if (join) throw new Denied('stale');
        return partyView(action, member, false);
      }
      if ((member?.joined === true) === join) return partyView(action, member, true);
      const nextMember = stored(await tx.putMember({
        requestId, personId: principal.personId, kingdomId: action.from, sessionId: principal.sessionId, joined: join,
        revision: (member?.revision ?? 0) + 1, joinedAt: join ? now : null, updatedAt: now,
      }, member?.revision ?? 0));
      const nextAction = stored(await tx.putAction({ ...action, revision: action.revision + 1, optedIn: action.optedIn + (join ? 1 : -1), updatedAt: now }, action.revision));
      changed.push(nextAction);
      return partyView(nextAction, nextMember, true);
    });
    for (const action of changed) announce(action);
    return { kind: 'party', value: party };
  }

  async function readAction(context: GateContext, requestId: string): Promise<GateReply> {
    await standingOf(context);
    const action = await atomically(context, tx => tx.getAction(requestId));
    if (!action) return denied('stale');
    if (action.from !== context.principal.sourceKingdomId) return denied('unauthorized');
    return { kind: 'action', value: actionView(action) };
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
          case 'join': return await choose(scoped, command.requestId, true);
          case 'leave': return await choose(scoped, command.requestId, false);
          case 'read-action': return await readAction(scoped, command.requestId);
          default: return denied('unavailable');
        }
      } catch (error) {
        if (error instanceof Denied) return denied(error.code);
        throw error;
      }
    },
  };
}
