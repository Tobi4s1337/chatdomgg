import { createHash, randomUUID } from 'node:crypto';
import {
  FORGE_WISH_WORDS_MAX, ForgeRunRequestSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, type ForgeRunEvent,
} from '@chatdom/shared';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { z } from 'zod';
import { runForge } from '../run';
import type { ForgeProviders } from '../providers';
import { forgeDeliveryMessage } from '../wish-decision';
import { bindForgeCandidate } from './candidate';
import { forgeAuthorityDeferReason } from './defer';
import type { KingdomForgeExecution } from './execution';
import type {
  CommittedForgeAttachment, ForgeActivity, ForgeAttachment, ForgeAttempt, ForgeReservation,
  KingdomForgeAudit, KingdomForgeAuthority, KingdomForgeCommand, KingdomForgeLease, KingdomForgeOutcome,
} from './ports';

const CommandSchema = z.strictObject({
  kingdomId: KingdomIdSchema, personId: PersonIdSchema, messageId: z.string().min(1).max(128),
  slot: z.number().int().min(0).max(65_534), words: z.string().trim().min(1).max(FORGE_WISH_WORDS_MAX),
  observedAt: z.number().int().nonnegative(),
});
const AttributionSchema = z.strictObject({
  makerName: z.string().min(1).max(64), kingdomName: z.string().min(1).max(64), approvalId: TokenSchema,
});
const MAX_RESERVATION_MS = 600_000;
const AUTHORITY_WAIT_MS = 5_000, AUDIT_WAIT_MS = 5_000, RELEASE_WAIT_MS = 5_000, RUN_WAIT_MS = 180_000;
/**
 * The commit is one durable transaction whose reply decides what the maker is told. A real database under load can take
 * longer than the quick authority calls; giving up early leaves a landed piece reported as unchanged.
 */
const COMMIT_WAIT_MS = 30_000;
/**
 * A reservation goes through the same writer queue as a commit. While the writer lands another maker's piece, the
 * realm may turn a queued step away unstarted after its own queue wait (10 s); the window must outlast that wait.
 */
const RESERVE_WAIT_MS = 20_000;
/** First pause before asking a busy writer again; it doubles up to `WRITER_RETRY_MAX_MS`. */
const WRITER_RETRY_MS = 250, WRITER_RETRY_MAX_MS = 2_000;
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

/** A short wait that a cancelled run cuts off at once. */
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Forge work was interrupted.')); return; }
    const stop = () => { clearTimeout(timer); reject(new Error('Forge work was interrupted.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, milliseconds);
    signal.addEventListener('abort', stop, { once: true });
  });
}

export interface KingdomForgeOptions {
  /** Omission is a real cold forge. There is deliberately no in-memory authorizing fallback. */
  readonly authority?: KingdomForgeAuthority;
  readonly providers: ForgeProviders;
  readonly record: (audit: KingdomForgeAudit) => Promise<void>;
  readonly publish: (event: ForgeActivity) => void;
  readonly now?: () => number;
  /**
   * Private operational note when a run stops on an exception: which step and whether its time budget ran out.
   * Codes only, never words, people, drafts or provider output. A failing observer cannot change the outcome.
   */
  readonly fault?: (fault: KingdomForgeFault) => void;
}

/** `intake` is the realm's own step before a run begins (opening the kingdom, the chat witness). */
export type KingdomForgeStep = 'intake' | 'reserve' | 'bind' | 'gates' | 'revalidate' | 'assemble' | 'prepare' | 'commit';
export interface KingdomForgeFault {
  readonly step: KingdomForgeStep;
  readonly cause: 'time-budget' | 'interrupted' | 'dependency' | 'invalid';
}
const faultCause = (error: unknown): KingdomForgeFault['cause'] => {
  const message = error instanceof Error ? error.message : '';
  return message === 'Forge work exceeded its time budget.' ? 'time-budget' : message === 'Forge work was interrupted.'
    || (error instanceof Error && error.name === 'AbortError') ? 'interrupted' : message === 'Forge dependency is unavailable.' ? 'dependency' : 'invalid';
};

/** Internal private reply extension; never added to an attachment or public activity. */
export type KingdomForgeResult = KingdomForgeOutcome & { readonly privateMessage?: string };
function privateAuthorityResult<T extends { readonly kind: string }>(result: T): T & { readonly privateMessage?: string } {
  if ('privateMessage' in result && typeof result.privateMessage === 'string' && result.privateMessage.length <= 240)
    return { ...result, privateMessage: result.privateMessage };
  return result;
}

/** Gates make a candidate; only the realm authority can turn that candidate into an owned attachment. */
export function createKingdomForgeApplication(options: KingdomForgeOptions) {
  const now = options.now ?? Date.now;
  const publish = (event: ForgeActivity): boolean => {
    try { options.publish(event); return true; } catch { return false; }
  };

  return async (input: KingdomForgeCommand, incoming: KingdomForgeLease, execution?: KingdomForgeExecution): Promise<KingdomForgeResult> => {
    const parsed = CommandSchema.safeParse(input);
    if (!parsed.success) return { kind: 'held' };
    const command = parsed.data, authority = options.authority;
    if (!authority) return { kind: 'cold' };
    // Capture the authority's identity for this run. A wish, a real model call or a live channel cannot
    // turn a simulated room into a live attachment. Older bindings must supply their room's origin.
    const origin = authority.origin;
    if (origin !== 'live' && origin !== 'simulated') return { kind: 'cold' };
    const key = `forge-chat-${digest([command.kingdomId, command.messageId])}`;
    if (execution && (execution.attempt.key !== key || !TokenSchema.safeParse(execution.attempt.attemptId).success)) return { kind: 'held' };
    if (incoming.signal.aborted || !incoming.current()) return execution
      ? { kind: 'recovery-needed', ...execution.attempt } : { kind: 'canceled' };
    const attempt: ForgeAttempt = {
      key, attemptId: execution?.attempt.attemptId ?? `attempt-${randomUUID()}`,
    };
    // The durable commit already carries this opaque run attempt. Keep one identity from first rune to landing.
    const activityId = attempt.attemptId;
    const abort = new AbortController();
    const signal = AbortSignal.any([incoming.signal, abort.signal]);
    let reservation: ForgeReservation | undefined;
    let committed = false;
    let staged = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let step: KingdomForgeStep = 'reserve';
    const lease: KingdomForgeLease = {
      signal,
      current: () => !signal.aborted && incoming.current() && (!reservation || now() < reservation.expiresAt),
    };
    const checkCurrent = () => {
      if (!lease.current()) abort.abort();
      signal.throwIfAborted();
    };
    /**
     * One writer step, asked again while the kingdom answers `unavailable`: its writer turned the step away unstarted
     * (busy landing another piece) or is not held here for a moment, and nothing was written. The same attempt is
     * idempotent in the realm, so asking again can never reserve or attach twice. Any other answer is final.
     */
    const writerStep = async <T extends object>(call: () => Promise<T>, windowMs: number): Promise<T> => {
      const until = performance.now() + windowMs;
      for (let wait = WRITER_RETRY_MS; ; wait = Math.min(wait * 2, WRITER_RETRY_MAX_MS)) {
        const result = await bounded(call, Math.max(1, until - performance.now()), () => abort.abort(), signal);
        if (forgeAuthorityDeferReason(result) !== 'unavailable' || performance.now() + wait >= until || !lease.current()) return result;
        await pause(wait, signal);
        checkCurrent();
      }
    };
    const execute = async (): Promise<KingdomForgeResult> => {
      try {
        const reserved = await writerStep(() => authority.reserve({
          ...attempt, kingdomId: command.kingdomId, personId: command.personId, messageId: command.messageId,
          slot: command.slot, observedAt: command.observedAt,
        }, lease), RESERVE_WAIT_MS);
        checkCurrent();
        if (reserved.kind !== 'reserved') return privateAuthorityResult(reserved);
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
        // One trusted kit follows the run through its judged sheet, private approval and committed assembly.
        const styleKit = Object.freeze(forgeStyleKit(request.family));
        const fingerprint = homeFingerprint(request.home), homeDigest = digest(request.home);
        if (execution) {
          step = 'bind';
          await bounded(() => execution.bind(reservation!, styleKit), AUDIT_WAIT_MS, () => abort.abort(), signal);
          checkCurrent();
        }
        timer = setTimeout(() => abort.abort(), Math.max(1, reservation.expiresAt - now())); timer.unref?.();
        let approved: Extract<ForgeRunEvent, { type: 'approved' }> | undefined;
        let stopped: Extract<ForgeRunEvent, { type: 'stopped' }> | undefined;
        step = 'gates';
        const selection = await bounded(() => runForge(request, options.providers, event => {
          checkCurrent();
          if (event.type === 'stage') {
            if (publish({ type: 'stage', activityId, stage: event.stage })) staged = true;
          }
          else if (event.type === 'approved') approved = event;
          else stopped = event;
        }, async entry => {
          checkCurrent();
          await bounded(() => options.record({
            key: attempt.key, runId: entry.id, at: entry.at, judgment: entry.outcome,
            // Only the chosen candidate's full gate evidence can authorize the attachment. Other attempts
            // retain bounded quality/outcome summaries, never failed-draft text or arbitrary provider records.
            verdicts: entry.verdicts.map(({ outcome, records, subject, measure, quality, detailMatch }, index) => {
              const full = index === 0 || index === entry.selection?.verdict;
              return { outcome, records: full ? records : [], ...(full && subject ? { subject } : {}), ...(full && measure ? { measure } : {}),
                ...(quality ? { quality } : {}), ...(detailMatch ? { detailMatch } : {}) };
            }),
            ...(entry.selection ? { selection: entry.selection } : {}), attempts: entry.attempts, modelCalls: entry.modelCalls,
            ...(entry.outcome === 'approved' && entry.draft ? { candidate: bindForgeCandidate(entry.draft, request.home, styleKit) } : {}),
          }), AUDIT_WAIT_MS, () => abort.abort(), signal);
          checkCurrent();
        }, signal, { safetyIdentifier: reservation!.safetyIdentifier, styleKit,
          ...(execution ? { recovery: execution.recovery } : {}) }), RUN_WAIT_MS, () => abort.abort(), signal);
        checkCurrent();
        const approval = approved;
        if (!approval) return stopped?.outcome === 'refuse' ? {kind:'refused',message:stopped.message}
          : { kind: stopped?.outcome === 'hold' ? 'held' : 'cold', ...(stopped ? { privateMessage: stopped.message } : {}) };
        if (approval.hostFingerprint !== fingerprint) return { kind: 'held' };

        const reservationId = reservation.reservationId;
        step = 'revalidate';
        const renewed = await bounded(() => authority.revalidate(attempt, reservationId, lease), AUTHORITY_WAIT_MS, () => abort.abort(), signal);
        checkCurrent();
        if (renewed.kind !== 'current') return privateAuthorityResult(renewed);
        if (renewed.native.revision !== reservation.revision || renewed.native.slot !== reservation.slot
          || renewed.native.family !== request.family || (renewed.native.hostProfile ?? 'street-home') !== (request.hostProfile ?? 'street-home')
          || digest(renewed.native.home) !== homeDigest
          || homeFingerprint(renewed.native.home) !== fingerprint) return { kind: 'held' };
        step = 'assemble';
        const socket = findForgeSockets(request.home, request.hostProfile, styleKit.revision).find(candidate => candidate.kind === approval.draft.plan.kind);
        if (!socket) return { kind: 'held' };
        const assembled = assembleForge(approval.draft.plan, styleKit, socket);
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
        const commit = { ...attempt, reservationId, expectedRevision, expectedHomeDigest: homeDigest,
          attachment: structuredClone(attachment), creation: { words: request.words } };
        if (execution) {
          step = 'prepare';
          await bounded(() => execution.prepareCommit(commit, selection),
            AUDIT_WAIT_MS, () => abort.abort(), signal);
          checkCurrent();
        }
        step = 'commit';
        const result = await writerStep(() => authority.commit(commit, lease), COMMIT_WAIT_MS);
        if (result.kind !== 'committed') return privateAuthorityResult(result);
        // A cancellation after the transaction cannot undo a durable attachment. Its outbox/snapshot survives.
        committed = true;
        if (!Number.isSafeInteger(result.committedAt) || result.committedAt < 0) throw new Error('Invalid commit receipt');
        const publication: CommittedForgeAttachment = { ...attachment, committedAt: result.committedAt,
          provenance: { ...attachment.provenance, firstForgedAt: result.committedAt } };
        return { kind: 'committed', attachment: publication,
          privateMessage: forgeDeliveryMessage(approval.draft, selection),
          published: lease.current() && publish({ type: 'committed', activityId, attachment: structuredClone(publication) }) };
      } catch (error) {
        try { options.fault?.({ step, cause: faultCause(error) }); } catch { /* a private note cannot change the outcome */ }
        // A durable worker must reconcile its saved attempt before deciding that work failed or releasing it.
        if (execution) return { kind: 'recovery-needed', ...attempt };
        return { kind: incoming.signal.aborted || !incoming.current() ? 'canceled' : 'cold' };
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const outcome = await execute();
    // The durable adapter owns confirmed-outcome persistence and cleanup. Process interruption is not release.
    if (execution) return outcome;
    if (!committed) {
      // End only an observed animation, before cleanup can wait on an unavailable authority.
      // A lost commit reply may still be followed by the authority's durable outbox reveal.
      if (staged) publish({ type: 'ended', activityId });
      abort.abort();
      // Cleanup uses no canceled signal. Unknown reserve/commit outcomes are resolved by the same attempt.
      try { await bounded(() => authority.release(attempt), RELEASE_WAIT_MS, () => {}); }
      catch { return { kind: 'recovery-needed', ...attempt }; }
    }
    return outcome;
  };
}
