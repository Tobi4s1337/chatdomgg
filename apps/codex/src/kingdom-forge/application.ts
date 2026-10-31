import { createHash, randomUUID } from 'node:crypto';
import {
  ForgeRunRequestSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, type ForgeRunEvent,
} from '@chatdom/shared';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { z } from 'zod';
import { runForge } from '../run';
import type { ForgeProviders } from '../providers';
import type {
  CommittedForgeAttachment, ForgeActivity, ForgeAttachment, ForgeAttempt, ForgeReservation,
  KingdomForgeAudit, KingdomForgeAuthority, KingdomForgeCommand, KingdomForgeLease, KingdomForgeOutcome,
} from './ports';

const CommandSchema = z.strictObject({
  kingdomId: KingdomIdSchema, personId: PersonIdSchema, messageId: z.string().min(1).max(128),
  slot: z.number().int().min(0).max(65_534), words: z.string().trim().min(1).max(240),
  observedAt: z.number().int().nonnegative(),
});
const AttributionSchema = z.strictObject({
  makerName: z.string().min(1).max(64), kingdomName: z.string().min(1).max(64), approvalId: TokenSchema,
});
const MAX_RESERVATION_MS = 600_000;
const AUTHORITY_WAIT_MS = 5_000, AUDIT_WAIT_MS = 5_000, RELEASE_WAIT_MS = 5_000, RUN_WAIT_MS = 180_000;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Bound even an adapter that ignores cancellation; late authority work must still check the revoked lease. */
function bounded<T>(work: () => Promise<T>, milliseconds: number, timeout: () => void, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: T | Error, failed: boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', canceled);
      if (failed) reject(value); else resolve(value as T);
    };
    const canceled = () => finish(new Error('Forge work was interrupted.'), true);
    const timer = setTimeout(() => { timeout(); finish(new Error('Forge work exceeded its time budget.'), true); }, milliseconds);
    signal?.addEventListener('abort', canceled, { once: true });
    Promise.resolve().then(() => { signal?.throwIfAborted(); return work(); })
      .then(value => finish(value, false), () => finish(new Error('Forge dependency is unavailable.'), true));
  });
}

export interface KingdomForgeOptions {
  /** Omission is a real cold forge. There is deliberately no in-memory authorizing fallback. */
  readonly authority?: KingdomForgeAuthority;
  readonly providers: ForgeProviders;
  readonly record: (audit: KingdomForgeAudit) => Promise<void>;
  readonly publish: (event: ForgeActivity) => void;
  readonly now?: () => number;
}

/** Gates make a candidate; only the realm authority can turn that candidate into an owned attachment. */
export function createKingdomForgeApplication(options: KingdomForgeOptions) {
  const now = options.now ?? Date.now;
  const publish = (event: ForgeActivity): boolean => {
    try { options.publish(event); return true; } catch { return false; }
  };

  return async (input: KingdomForgeCommand, incoming: KingdomForgeLease): Promise<KingdomForgeOutcome> => {
    const parsed = CommandSchema.safeParse(input);
    if (!parsed.success) return { kind: 'held' };
    const command = parsed.data, authority = options.authority;
    if (!authority) return { kind: 'cold' };
    // Capture the authority's identity for this run. A wish, a real model call or a live channel cannot
    // turn a simulated room into a live attachment. Older bindings must supply their room's origin.
    const origin = authority.origin;
    if (origin !== 'live' && origin !== 'simulated') return { kind: 'cold' };
    if (incoming.signal.aborted || !incoming.current()) return { kind: 'canceled' };
    const attempt: ForgeAttempt = {
      key: `forge-chat-${digest([command.kingdomId, command.messageId])}`, attemptId: `attempt-${randomUUID()}`,
    };
    // The durable commit already carries this opaque run attempt. Keep one identity from first rune to landing.
    const activityId = attempt.attemptId;
    const abort = new AbortController();
    const signal = AbortSignal.any([incoming.signal, abort.signal]);
    let reservation: ForgeReservation | undefined;
    let committed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lease: KingdomForgeLease = {
      signal,
      current: () => !signal.aborted && incoming.current() && (!reservation || now() < reservation.expiresAt),
    };
    const checkCurrent = () => {
      if (!lease.current()) abort.abort();
      signal.throwIfAborted();
    };
    const execute = async (): Promise<KingdomForgeOutcome> => {
      try {
        const reserved = await bounded(() => authority.reserve({
          ...attempt, kingdomId: command.kingdomId, personId: command.personId, messageId: command.messageId,
          slot: command.slot, observedAt: command.observedAt,
        }, lease), AUTHORITY_WAIT_MS, () => abort.abort(), signal);
        checkCurrent();
        if (reserved.kind !== 'reserved') return reserved;
        // Detach the authority's snapshot; later mutation cannot silently change what the judges inspected.
        reservation = structuredClone(reserved.reservation);
        if (reservation.kingdomId !== command.kingdomId || reservation.personId !== command.personId
          || !Number.isInteger(reservation.slot) || reservation.slot < 0 || reservation.slot > 65_534
          || !TokenSchema.safeParse(reservation.reservationId).success || !TokenSchema.safeParse(reservation.revision).success
          || !/^[A-Za-z0-9_-]{16,128}$/.test(reservation.safetyIdentifier)
          || !Number.isSafeInteger(reservation.expiresAt) || reservation.expiresAt <= now()
          || reservation.expiresAt - now() > MAX_RESERVATION_MS) return { kind: 'held' };
        const attribution = AttributionSchema.parse(reservation.attribution);
        const request = ForgeRunRequestSchema.parse({ words: command.words, family: reservation.family, home: reservation.home, ...(reservation.hostProfile ? { hostProfile: reservation.hostProfile } : {}) });
        const fingerprint = homeFingerprint(request.home), homeDigest = digest(request.home);
        timer = setTimeout(() => abort.abort(), Math.max(1, reservation.expiresAt - now())); timer.unref?.();
        let approved: Extract<ForgeRunEvent, { type: 'approved' }> | undefined;
        let stopped: Extract<ForgeRunEvent, { type: 'stopped' }> | undefined;
        await bounded(() => runForge(request, options.providers, event => {
          checkCurrent();
          if (event.type === 'stage') publish({ type: 'stage', activityId, stage: event.stage });
          else if (event.type === 'approved') approved = event;
          else stopped = event;
        }, async entry => {
          checkCurrent();
          await bounded(() => options.record({
            key: attempt.key, runId: entry.id, at: entry.at, judgment: entry.outcome,
            verdicts: entry.verdicts.map(({ outcome, records }) => ({ outcome, records })),
          }), AUDIT_WAIT_MS, () => abort.abort(), signal);
          checkCurrent();
        }, signal, { safetyIdentifier: reservation!.safetyIdentifier }), RUN_WAIT_MS, () => abort.abort(), signal);
        checkCurrent();
        const approval = approved;
        if (!approval) return stopped?.outcome === 'refuse' ? {kind:'refused',message:stopped.message}
          : { kind: stopped?.outcome === 'hold' ? 'held' : 'cold' };
        if (approval.hostFingerprint !== fingerprint) return { kind: 'held' };

        const reservationId = reservation.reservationId;
        const renewed = await bounded(() => authority.revalidate(attempt, reservationId, lease), AUTHORITY_WAIT_MS, () => abort.abort(), signal);
        checkCurrent();
        if (renewed.kind !== 'current') return renewed;
        if (renewed.native.revision !== reservation.revision || renewed.native.slot !== reservation.slot
          || renewed.native.family !== request.family || (renewed.native.hostProfile ?? 'street-home') !== (request.hostProfile ?? 'street-home')
          || digest(renewed.native.home) !== homeDigest
          || homeFingerprint(renewed.native.home) !== fingerprint) return { kind: 'held' };
        const socket = findForgeSockets(request.home, request.hostProfile).find(candidate => candidate.kind === approval.draft.plan.kind);
        if (!socket) return { kind: 'held' };
        const assembled = assembleForge(approval.draft.plan, forgeStyleKit(request.family), socket);
        checkForge(assembled, request.home, request.hostProfile);
        const attachment: ForgeAttachment = {
          version: 1, id: approval.runId, runId: approval.runId, kingdomId: command.kingdomId, slot: reservation.slot,
          hostId: request.home.id, hostFingerprint: fingerprint, socketId: socket.id, origin: [...socket.origin],
          ...(request.hostProfile === 'castle-keep' ? { hostProfile: request.hostProfile } : {}),
          kitId: assembled.kit.id, kitRevision: assembled.kit.revision, family: request.family, draft: approval.draft,
          provenance: { source: origin, makerName: attribution.makerName, kingdomName: attribution.kingdomName,
            designId: `forge-design-${digest([command.kingdomId, approval.runId])}` },
        };
        checkCurrent();
        const expectedRevision = reservation.revision;
        const result = await bounded(() => authority.commit({ ...attempt, reservationId,
          expectedRevision, expectedHomeDigest: homeDigest, attachment: structuredClone(attachment), creation:{words:request.words} }, lease),
          AUTHORITY_WAIT_MS, () => abort.abort(), signal);
        if (result.kind !== 'committed') return result;
        // A cancellation after the transaction cannot undo a durable attachment. Its outbox/snapshot survives.
        committed = true;
        if (!Number.isSafeInteger(result.committedAt) || result.committedAt < 0) throw new Error('Invalid commit receipt');
        const publication: CommittedForgeAttachment = { ...attachment, committedAt: result.committedAt,
          provenance: { ...attachment.provenance, firstForgedAt: result.committedAt } };
        return { kind: 'committed', attachment: publication,
          published: lease.current() && publish({ type: 'committed', activityId, attachment: structuredClone(publication) }) };
      } catch {
        return { kind: incoming.signal.aborted || !incoming.current() ? 'canceled' : 'cold' };
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const outcome = await execute();
    if (!committed) {
      abort.abort();
      // Cleanup uses no canceled signal. Unknown reserve/commit outcomes are resolved by the same attempt.
      try { await bounded(() => authority.release(attempt), RELEASE_WAIT_MS, () => {}); }
      catch { return { kind: 'recovery-needed', ...attempt }; }
    }
    return outcome;
  };
}
