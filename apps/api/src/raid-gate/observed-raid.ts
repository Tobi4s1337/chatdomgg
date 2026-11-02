/**
 * Server-only authority for landing a gate request on a witnessed raid. The caller supplies the transaction so
 * realm ingress can record the observation, road and departure together. Notifications belong after commit.
 */
import { AtlasRaidSchema, type AtlasRaid } from '../../../../packages/shared/src/atlas-raids';
import { GATE_LIMITS, type GateActionState } from './contracts';
import { epoch, fields, token } from './guard';
import type { RaidObservationReceipt, TrustedRaidObservation } from './ports';
import { outboxId, type RaidActionRecord, type RaidGateTransaction, type RaidOutboxRecord, type RecordOrigin, type Stored } from './repository';

const TWITCH_HOLDS: ReadonlySet<GateActionState> = new Set(['dispatching', 'pending', 'unknown']);

/** A lost compare-and-set race. The owner must roll back and retry the entire transaction. */
export class RaidObservationConflict extends Error {}

function stored<T>(result: Stored<T>): T {
  if (result.kind === 'conflict') throw new RaidObservationConflict();
  return result.record;
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

/**
 * Finds the source's current, actually attempted request. Call only when first persisting an observation and retain
 * that answer for retries: a later gate must never adopt an older raid. Landing still checks state and event times.
 */
export async function correlateObservedRaid(tx: RaidGateTransaction, raid: AtlasRaid, origin: RecordOrigin): Promise<string | null> {
  const gate = await tx.getGate(raid.fromKingdomId);
  if (!gate?.requestId) return null;
  const action = await tx.getAction(gate.requestId);
  if (!action || action.origin !== origin || action.from !== raid.fromKingdomId || action.to !== raid.toKingdomId) return null;
  if (action.dispatchedAt === null) return null;
  const start = await tx.getOutbox(outboxId(action.requestId, 'start'));
  return start && start.attempts > 0 ? action.requestId : null;
}

export async function recordObservedRaid(
  tx: RaidGateTransaction,
  input: TrustedRaidObservation,
  options: { origin: RecordOrigin; now: number; roadRecorded?: boolean },
): Promise<{ receipt: RaidObservationReceipt; landed: RaidActionRecord | null }> {
  const ignored = (reason: Extract<RaidObservationReceipt, { kind: 'ignored' }>['reason']) => ({ receipt: { kind: 'ignored', reason } as const, landed: null });
  const observation = readObservation(input);
  if (!observation) return ignored('invalid');
  const { raid, upstreamEventId, actionRequestId } = observation;
  // Replays and legacy feeds are history, never a departure.
  const trusted = options.origin === 'live' ? raid.source === 'herald' && raid.evidence.kind === 'observed' : raid.source === 'simulation';
  if (!trusted) return ignored('untrusted');
  if (actionRequestId === null || upstreamEventId === null) return ignored('uncorrelated');
  const action = await tx.getAction(actionRequestId);
  if (!action) return ignored('unknown-request');
  if (action.origin !== options.origin) return ignored('untrusted');
  if (action.from !== raid.fromKingdomId || action.to !== raid.toKingdomId) return ignored('mismatch');
  if (action.state === 'landed') {
    const same = action.raidEventId === upstreamEventId || action.raid?.id === raid.id;
    return same ? { receipt: { kind: 'duplicate', requestId: action.requestId }, landed: null } : ignored('conflict');
  }
  // A confirmed cancel or a refusal already settled this request.
  if (!TWITCH_HOLDS.has(action.state) || action.dispatchedAt === null) return ignored('settled');
  const startItem = await tx.getOutbox(outboxId(action.requestId, 'start'));
  // Twitch cannot have acted on a write that never left.
  if (!startItem || startItem.attempts === 0) return ignored('uncorrelated');
  const at = raid.occurredAt ?? raid.observedAt;
  const base = Math.max(action.acceptedAt ?? 0, action.dispatchedAt);
  const latest = base + GATE_LIMITS.twitchCountdownMs + (raid.occurredAt === null ? GATE_LIMITS.observationGraceMs : GATE_LIMITS.clockSkewMs);
  if (at < action.dispatchedAt - GATE_LIMITS.clockSkewMs || at > latest) return ignored('out-of-window');

  const { now } = options;
  const landed = stored(await tx.putAction({
    ...action, revision: action.revision + 1, state: 'landed', raid, raidEventId: upstreamEventId,
    observedAt: now, updatedAt: Math.max(now, action.updatedAt), endReason: null,
  }, action.revision));
  const settle = async (item: RaidOutboxRecord, outcome: RaidOutboxRecord['outcome']) => stored(await tx.putOutbox({
    ...item, revision: item.revision + 1, state: 'settled', settledAt: now, outcome,
  }, item.revision));
  if (startItem.state === 'claimed') await settle(startItem, 'accepted');
  const cancelItem = await tx.getOutbox(outboxId(action.requestId, 'cancel'));
  // The raid left before any cancel could hold it: there was nothing left to cancel.
  if (cancelItem?.state === 'claimed') await settle(cancelItem, 'rejected');
  else if (cancelItem?.state === 'queued') await settle(cancelItem, 'lapsed');
  // A road inserted by this same transaction is already delivered; recovery must not hand it off a second time.
  const recorded = options.roadRecorded === true;
  stored(await tx.putOutbox({
    id: outboxId(action.requestId, 'road'), revision: 1, requestId: action.requestId, kind: 'road',
    state: recorded ? 'settled' : 'queued', createdAt: now, claimedAt: recorded ? now : null,
    settledAt: recorded ? now : null, outcome: recorded ? 'delivered' : null, attempts: recorded ? 1 : 0, origin: options.origin,
  }, 0));
  return { receipt: { kind: 'landed', requestId: action.requestId }, landed };
}
