import { createHash } from 'node:crypto';
import { ForgeDraftSchema, TokenSchema, VoxelBlueprintSchema, type KingdomId, type PersonId, type VoxelBlueprint } from '@chatdom/shared';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import type { ForgeAttachment, ForgeAttempt, ForgeReservation, KingdomForgeAuthority, KingdomForgeLease, NativeForgeHome, RealmDomainCommand,
  RealmForgeReservation, RealmOwnedHome, RealmPrivateState, RealmStoredOutcome } from '@chatdom/shared/realm';
import { REALM_BASE_ANVILS, RealmBusyError, RealmHeldError, RealmWriterFencedError, type DurableKingdom, type DurableKingdomHold,
  type RealmCommandMeta } from '../persistence';
import type { RealmForgeAttemptStatus, RealmForgeAuthority, RealmForgeOptions, RealmWiringLog } from './types';

/** Long enough for the coordinator's three-minute run and its checks; it accepts at most ten minutes. */
export const FORGE_RESERVATION_MS = 300_000;
/** Expired reservations released by one reservation, so abandoned work never piles up in the private state. */
export const FORGE_EXPIRY_SWEEP = 4;
/** A wish observed this far ahead of the kingdom's clock is not believed. */
const OBSERVED_SKEW_MS = 30_000;
const SAFETY_IDENTIFIER = /^[A-Za-z0-9_-]{16,128}$/;

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * The full home digest the Forge binds a candidate to: SHA-256 over the blueprint in its schema's
 * canonical field order, exactly as the coordinator hashes the home it judged. A stored home whose
 * digest disagrees fails closed rather than attaching to geometry nobody judged.
 */
export function forgeHomeDigest(blueprint: VoxelBlueprint): string {
  return sha256(JSON.stringify(VoxelBlueprintSchema.parse(blueprint)));
}
/** The durable key of one chat (or browser) wish, as the coordinator derives it: one message, one work. */
export function forgeMessageKey(kingdomId: KingdomId, messageId: string): string {
  return `forge-chat-${sha256(JSON.stringify([kingdomId, messageId]))}`;
}
/** Repository command IDs stay short (≤ 128), stable for retries and free of anything private. */
const attemptDigest = (attempt: ForgeAttempt) => sha256(JSON.stringify([attempt.key, attempt.attemptId])).slice(0, 48);
type Step = 'reserve' | 'commit' | 'release' | 'expire';
const commandId = (step: Step, attempt: ForgeAttempt) => `forge:${step}:${attemptDigest(attempt)}`;

type Reserved = Awaited<ReturnType<KingdomForgeAuthority['reserve']>>;
type Revalidated = Awaited<ReturnType<KingdomForgeAuthority['revalidate']>>;
type Committed = Awaited<ReturnType<KingdomForgeAuthority['commit']>>;
type Refusal = { readonly kind: 'held' | 'cold'; readonly reason: string };
type Eligible = { readonly kind: 'eligible'; readonly home: RealmOwnedHome; readonly rights: RealmPrivateState['rights'][string]; readonly blueprint: VoxelBlueprint };

/**
 * What a person must actually hold for free words, read from committed authority only: their own home
 * on this founded layout, Forge rights without a hold, a live broadcast, approved names and home
 * geometry that matches its digest. The chat command's slot is never consulted.
 */
function eligibility(state: RealmPrivateState, personId: PersonId, now: number, layoutRevision: string): Eligible | Refusal {
  const home = Object.values(state.homes).find(candidate => candidate.ownerId === personId);
  if (!home) return { kind: 'cold', reason: 'no-home' };
  const rights = own(state.rights, personId);
  if (rights?.blocked) return { kind: 'held', reason: 'hold' };
  if (!rights?.forge) return { kind: 'cold', reason: 'no-rights' };
  if (state.stream.sessionId === null || state.stream.liveUntil <= now) return { kind: 'cold', reason: 'offline' };
  if (!SAFETY_IDENTIFIER.test(rights.safetyIdentifier)) return { kind: 'held', reason: 'identity' };
  const names = home.attribution;
  if (!TokenSchema.safeParse(names.approvalId).success || !names.makerName || names.makerName.length > 64
    || !names.kingdomName || names.kingdomName.length > 64) return { kind: 'held', reason: 'names' };
  if (home.layoutRevision !== layoutRevision) return { kind: 'held', reason: 'layout' };
  const parsed = VoxelBlueprintSchema.safeParse(home.blueprint);
  if (!parsed.success || forgeHomeDigest(parsed.data) !== home.digest) return { kind: 'held', reason: 'geometry' };
  return { kind: 'eligible', home, rights, blueprint: parsed.data };
}

function native(home: RealmOwnedHome, blueprint: VoxelBlueprint): NativeForgeHome {
  return { slot: home.slot, revision: home.revision, family: home.family, home: structuredClone(blueprint) };
}

/** True once any attempt of this key made a part: one message is one made thing. */
const made = (state: RealmPrivateState, key: string) => Object.values(state.attachments).find(item => item.forgeKey === key);

/** Durable state for one attempt: committed (by this or another attempt), reserved, released or unknown. */
function attemptStatus(state: RealmPrivateState, attempt: ForgeAttempt): RealmForgeAttemptStatus {
  const item = made(state, attempt.key), outcome = own(state.forgeOutcomes, attempt.key), held = own(state.reservations, attempt.key);
  const mine = (attemptId: string | undefined) => attemptId === attempt.attemptId;
  if (item) return mine(outcome?.attemptId) ? { kind: 'committed', committedAt: item.attachment.committedAt } : { kind: 'other-attempt' };
  if (held) return mine(held.attempt.attemptId) ? { kind: 'reserved' } : { kind: 'other-attempt' };
  if (outcome) return mine(outcome.attemptId) ? { kind: 'released' } : { kind: 'other-attempt' };
  return { kind: 'unknown' };
}

/** Candidate fields checked against the current owned home before the reducer checks them again in the transaction. */
function fits(attachment: ForgeAttachment, home: RealmOwnedHome, kingdomId: KingdomId, origin: 'live' | 'simulated'): boolean {
  const a = attachment;
  const draft = ForgeDraftSchema.safeParse(a.draft);
  if (!draft.success) return false;
  if (!(a.version === 1 && a.kingdomId === kingdomId && a.slot === home.slot && a.hostId === home.blueprint.id && a.family === home.family
    && TokenSchema.safeParse(a.id).success && a.id === a.runId && TokenSchema.safeParse(a.socketId).success
    && TokenSchema.safeParse(a.kitId).success && Number.isSafeInteger(a.kitRevision) && a.kitRevision >= 0
    && typeof a.hostFingerprint === 'string' && a.hostFingerprint.length > 0 && a.hostFingerprint.length <= 128
    && a.origin.length === 3 && a.origin.every(n => Number.isSafeInteger(n))
    // A fixture never labels its result live, and a live room never adopts a simulated part.
    && a.provenance.source === origin && TokenSchema.safeParse(a.provenance.designId).success
    && a.provenance.makerName === home.attribution.makerName && a.provenance.kingdomName === home.attribution.kingdomName)) return false;
  try {
    const socket = findForgeSockets(home.blueprint).find(candidate => candidate.kind === draft.data.plan.kind);
    if (!socket || socket.id !== a.socketId || socket.origin.some((value, index) => value !== a.origin[index])
      || a.hostFingerprint !== homeFingerprint(home.blueprint)) return false;
    const assembled = assembleForge(draft.data.plan, forgeStyleKit(home.family), socket);
    checkForge(assembled, home.blueprint);
    return assembled.kit.id === a.kitId && assembled.kit.revision === a.kitRevision;
  } catch { return false; }
}

/** The caller's lease fell before the write: the transaction rolled back, nothing is stored. Re-askable by a current caller. */
const CANCELED = Symbol('canceled');
type Canceled = typeof CANCELED;

/** Refused before the writer started it, so nothing was written and the step can simply be asked again. */
const unstarted = (error: unknown) => error instanceof RealmBusyError || error instanceof RealmHeldError || error instanceof RealmWriterFencedError;

/** How the authority reaches the kingdom: a counted hold on this process's one writer, or null when it cannot take work. */
export interface ForgeAuthorityBinding {
  readonly kingdomId: KingdomId;
  /** The owning realm's origin. Every step also requires the held kingdom's stored origin to equal it. */
  readonly origin: 'live' | 'simulated';
  retain(): Promise<DurableKingdomHold | null>;
}

/**
 * The shared `KingdomForgeAuthority` bound to realm-server's accepted kingdom authority. Every durable step is one
 * `DurableKingdom.execute` of main's own commands (`forge.reserve`, `forge.commitApproved`, `forge.release`), serialized
 * behind the kingdom's single writer with presence ingress, decided by the world reducer at database time and
 * committed with its outbox row. The checks here read committed `privateState` first so a refusal has an honest
 * reason; the reducer then rechecks rights, home revision and digest, night, coal, anvil and attempt inside the
 * transaction, so a race can only refuse, never attach to the wrong home. Nothing here keeps a balance or a record.
 */
export function createForgeAuthority(binding: ForgeAuthorityBinding, options: RealmForgeOptions | undefined,
  log: (event: RealmWiringLog) => void = () => {}): RealmForgeAuthority {
  const { kingdomId, origin } = binding;
  if (origin !== 'live' && origin !== 'simulated') throw new TypeError('The Forge authority needs its realm origin');
  const anvils = options?.anvils ?? REALM_BASE_ANVILS, reservationMs = options?.reservationMs ?? FORGE_RESERVATION_MS;
  if (!Number.isSafeInteger(anvils) || anvils < 1 || anvils > 64) throw new RangeError('Anvils must be 1–64');
  if (!Number.isSafeInteger(reservationMs) || reservationMs < 10_000 || reservationMs > 600_000) throw new RangeError('A reservation lasts 10 s – 10 min');
  const live = (lease: KingdomForgeLease) => { try { return !lease.signal.aborted && lease.current(); } catch { return false; } };
  // Without the caller gate among the repository's commit guards, a cancelled wish could still spend: refuse everything.
  const gate = options?.gate.installed ? options.gate : null;
  const note = (operation: RealmWiringLog['operation'], status: string, reason?: string) => {
    try { log({ kind: 'forge', kingdomId, operation, status, ...(reason ? { reason } : {}) }); }
    catch { /* An operational log cannot change a durable outcome. */ }
  };

  /** Work under a hold on the open writer. A kingdom this process cannot hold right now answers without starting anything. */
  async function holding<T>(work: (kingdom: DurableKingdom) => Promise<T>, unavailable: () => T): Promise<T> {
    let hold: DurableKingdomHold | null;
    try { hold = await binding.retain(); } catch { return unavailable(); }
    if (!hold) return unavailable();
    try { return hold.kingdom.current && hold.kingdom.kingdomId === kingdomId && hold.kingdom.origin === origin ? await work(hold.kingdom) : unavailable(); }
    finally { await hold.release().catch(() => {}); }
  }

  /**
   * One command through the kingdom's writer. A step taken for a caller carries that caller's lease to the
   * transactional write (`ForgeWriteGate`): cancelled while queued or waiting on the kingdom row, it writes nothing and
   * answers `canceled`. `DurableKingdom` already resolves a lost COMMIT reply by lookup; when even that cannot answer,
   * the same ID is looked up once more here. Still unknown is never a refusal: it throws, and the caller recovers
   * through `status`.
   */
  async function run(kingdom: DurableKingdom, step: Step, attempt: ForgeAttempt, command: RealmDomainCommand, meta: RealmCommandMeta): Promise<RealmStoredOutcome>;
  async function run(kingdom: DurableKingdom, step: Step, attempt: ForgeAttempt, command: RealmDomainCommand, meta: RealmCommandMeta,
    caller: () => boolean): Promise<RealmStoredOutcome | Canceled>;
  async function run(kingdom: DurableKingdom, step: Step, attempt: ForgeAttempt, command: RealmDomainCommand, meta: RealmCommandMeta,
    caller?: () => boolean): Promise<RealmStoredOutcome | Canceled> {
    const id = commandId(step, attempt);
    const execute = () => kingdom.execute(id, command, 'forge', { anvilCapacity: anvils, ...meta, ...(caller ? { current: caller } : {}) });
    try {
      // Release and expiry belong to no caller's lease: they always run.
      if (!caller || !gate) return await execute();
      const step = await gate.run(command, caller, execute);
      return step.canceled ? CANCELED : step.result;
    } catch (error) {
      if (unstarted(error)) return { status: 'rejected', reason: 'cold' };
      let known: RealmStoredOutcome | null;
      try { known = await kingdom.lookup(id); }
      catch { note(step, 'uncertain'); throw new Error('The kingdom could not confirm this Forge step'); }
      // A missing receipt after a failed write is not proof of rollback. In particular COMMIT may still be
      // finishing after its reply was lost. Keep uncertainty explicit so cleanup cannot invent a refund.
      if (!known) { note(step, 'uncertain'); throw new Error('The kingdom could not confirm this Forge step', { cause: error }); }
      return known;
    }
  }

  /** Abandoned reservations past their expiry free their coal and anvil. Live ones are never touched. */
  async function expire(kingdom: DurableKingdom): Promise<void> {
    const now = kingdom.databaseNow();
    const lapsed = Object.values(kingdom.privateState.reservations).filter(r => r.reservation.expiresAt <= now).slice(0, FORGE_EXPIRY_SWEEP);
    for (const r of lapsed) {
      const result = await run(kingdom, 'expire', r.attempt, { type: 'forge.release', attempt: r.attempt }, { cause: { kind: 'scheduled', id: r.reservation.reservationId } });
      note('expire', result.status);
    }
  }

  const authority: RealmForgeAuthority = {
    origin,
    async reserve(input, lease) {
      if (!options || !gate || input.kingdomId !== kingdomId || !live(lease)) { note('reserve', 'cold', !options ? 'unconfigured' : !gate ? 'ungated' : 'closed'); return { kind: 'cold' }; }
      if (!TokenSchema.safeParse(input.attemptId).success || input.key !== forgeMessageKey(input.kingdomId, input.messageId)
        || !Number.isSafeInteger(input.observedAt)) { note('reserve', 'held', 'attempt'); return { kind: 'held' }; }
      return holding<Reserved>(async kingdom => {
        if (!live(lease)) return { kind: 'cold' } as const;
        await expire(kingdom);
        // Cleanup is a queue barrier even when reserve never started. Its terminal unchanged receipt
        // closes this attempt too; otherwise a retry could reopen work whose release ID is already spent.
        const cleanup = await kingdom.lookup(commandId('release', input));
        if (!live(lease) || cleanup?.status === 'committed' || cleanup?.status === 'unchanged') return { kind: 'cold' } as const;
        const state = kingdom.privateState, now = kingdom.databaseNow(), held = own(state.reservations, input.key);
        if (made(state, input.key)) { note('reserve', 'already-committed'); return { kind: 'already-committed' } as const; }
        if (held) {
          // A retried call for the same attempt finds its reservation instead of making a second one.
          if (held.attempt.attemptId === input.attemptId && held.reservation.personId === input.personId && held.reservation.expiresAt > now) return { kind: 'reserved', reservation: structuredClone(held.reservation) } as const;
          note('reserve', 'held', 'other-attempt'); return { kind: 'held' } as const;
        }
        // One message is one work: a released wish is not run again under the same message.
        if (own(state.forgeOutcomes, input.key)) { note('reserve', 'cold', 'spent-message'); return { kind: 'cold' } as const; }
        // A wish spoken before this broadcast began belongs to no live night.
        if (input.observedAt < state.stream.startedAt || input.observedAt > now + OBSERVED_SKEW_MS) { note('reserve', 'cold', 'outside-night'); return { kind: 'cold' } as const; }
        const found = eligibility(state, input.personId, now, kingdom.layoutRevision);
        if (found.kind !== 'eligible') { note('reserve', found.kind, found.reason); return { kind: found.kind } as const; }
        const { home, rights, blueprint } = found;
        const reservation: ForgeReservation = {
          reservationId: `forge-reservation-${attemptDigest(input).slice(0, 32)}`, kingdomId, personId: input.personId,
          slot: home.slot, revision: home.revision, family: home.family, home: structuredClone(blueprint),
          safetyIdentifier: rights.safetyIdentifier, expiresAt: now + reservationMs,
          attribution: { makerName: home.attribution.makerName, kingdomName: home.attribution.kingdomName, approvalId: home.attribution.approvalId },
        };
        const record: RealmForgeReservation = { attempt: { key: input.key, attemptId: input.attemptId }, homeId: home.id,
          streamSessionId: state.stream.sessionId!, homeDigest: home.digest, rightsRevision: rights.revision, reservation };
        if (!live(lease)) { note('reserve', 'cold', 'canceled'); return { kind: 'cold' } as const; }
        // The lease travels with the command: a cancellation while it waits for the writer or the row still wins.
        const result = await run(kingdom, 'reserve', input, { type: 'forge.reserve', record },
          { occurredAt: Math.min(input.observedAt, now), actor: input.personId, cause: { kind: 'external', source: 'forge', id: input.key } }, () => live(lease));
        if (result === CANCELED) { note('reserve', 'cold', 'canceled'); return { kind: 'cold' } as const; }
        const after = own(kingdom.privateState.reservations, input.key);
        if ((result.status === 'committed' || result.status === 'unchanged') && after?.attempt.attemptId === input.attemptId) {
          note('reserve', 'reserved');
          return { kind: 'reserved', reservation: structuredClone(after.reservation) } as const;
        }
        if (result.status === 'committed') throw new Error('The kingdom could not confirm its reserved Forge state');
        if (made(kingdom.privateState, input.key)) return { kind: 'already-committed' } as const;
        const kind = result.reason === 'cold' ? 'cold' : 'held';
        note('reserve', kind, result.reason);
        return { kind } as const;
      }, () => { note('reserve', 'cold', 'closed'); return { kind: 'cold' } as const; });
    },

    async revalidate(attempt, reservationId, lease) {
      if (!options || !gate || !live(lease)) return { kind: 'cold' };
      return holding<Revalidated>(async kingdom => {
        if (!live(lease)) return { kind: 'cold' } as const;
        const state = kingdom.privateState, now = kingdom.databaseNow(), r = own(state.reservations, attempt.key);
        if (!r || r.attempt.attemptId !== attempt.attemptId || r.reservation.reservationId !== reservationId || r.reservation.expiresAt <= now) {
          note('revalidate', 'cold', 'reservation'); return { kind: 'cold' } as const;
        }
        const found = eligibility(state, r.reservation.personId, now, kingdom.layoutRevision);
        if (found.kind !== 'eligible') { note('revalidate', found.kind, found.reason); return { kind: found.kind } as const; }
        // A changed deed, a moderation decision or another night invalidates the reservation itself.
        if (found.home.id !== r.homeId) { note('revalidate', 'cold', 'home'); return { kind: 'cold' } as const; }
        if (found.rights.revision !== r.rightsRevision || found.rights.safetyIdentifier !== r.reservation.safetyIdentifier) { note('revalidate', 'held', 'rights'); return { kind: 'held' } as const; }
        if (state.stream.sessionId !== r.streamSessionId) { note('revalidate', 'cold', 'night'); return { kind: 'cold' } as const; }
        // The CURRENT home, even when it changed: the coordinator compares it with what its judges saw.
        return { kind: 'current', native: native(found.home, found.blueprint) } as const;
      }, () => ({ kind: 'cold' } as const));
    },

    async commit(input, lease) {
      if (!options || !gate || !live(lease)) { note('commit', 'cold', !options ? 'unconfigured' : !gate ? 'ungated' : 'closed'); return { kind: 'cold' }; }
      // The judges' own audited approval of this run, read before the writer: placement needs both that evidence and
      // the kingdom's commit. A model-approved event or an API key alone never attaches anything.
      const approval = await options.approvals.approved(input.key, input.attachment.runId).catch(() => null);
      if (!approval || !TokenSchema.safeParse(approval).success) { note('commit', 'held', 'gates'); return { kind: 'held' }; }
      return holding<Committed>(async kingdom => {
        const state = kingdom.privateState, now = kingdom.databaseNow(), prior = attemptStatus(state, input);
        if (prior.kind === 'committed') return { kind: 'committed', committedAt: prior.committedAt } as const;
        if (made(state, input.key)) { note('commit', 'already-committed'); return { kind: 'already-committed' } as const; }
        if (!live(lease)) { note('commit', 'cold', 'canceled'); return { kind: 'cold' } as const; }
        const r = own(state.reservations, input.key);
        if (!r || r.attempt.attemptId !== input.attemptId || r.reservation.reservationId !== input.reservationId || r.reservation.expiresAt <= now) {
          note('commit', 'cold', 'reservation'); return { kind: 'cold' } as const;
        }
        const found = eligibility(state, r.reservation.personId, now, kingdom.layoutRevision);
        if (found.kind !== 'eligible') { note('commit', found.kind, found.reason); return { kind: found.kind } as const; }
        const home = found.home;
        // Compare-and-set on the exact home the judges saw. A stale candidate leaves the home untouched.
        if (home.id !== r.homeId || home.revision !== input.expectedRevision || home.digest !== input.expectedHomeDigest
          || forgeHomeDigest(found.blueprint) !== input.expectedHomeDigest) { note('commit', 'held', 'stale-home'); return { kind: 'held' } as const; }
        if (!fits(input.attachment, home, kingdomId, origin)) { note('commit', 'held', 'candidate'); return { kind: 'held' } as const; }
        const words = input.creation.words.trim();
        if (!words || words.length > 240) { note('commit', 'held', 'candidate'); return { kind: 'held' } as const; }
        // Checked again at the transactional write: cancelled while queued or row-locked, nothing attaches or is charged.
        const result = await run(kingdom, 'commit', input, {
          type: 'forge.commitApproved', attempt: { key: input.key, attemptId: input.attemptId }, reservationId: input.reservationId,
          expectedRevision: input.expectedRevision, expectedHomeDigest: input.expectedHomeDigest, attachment: structuredClone(input.attachment),
          creation: { words }, approvalReceipt: approval,
        }, { actor: home.ownerId, cause: { kind: 'external', source: 'forge', id: input.key } }, () => live(lease));
        if (result === CANCELED) { note('commit', 'cold', 'canceled'); return { kind: 'cold' } as const; }
        if (result.status === 'committed') { note('commit', 'committed'); return { kind: 'committed', committedAt: result.at } as const; }
        // A stored earlier outcome of this very command (a retry after a lost reply) or another attempt's part.
        const after = attemptStatus(kingdom.privateState, input);
        if (after.kind === 'committed') return { kind: 'committed', committedAt: after.committedAt } as const;
        if (made(kingdom.privateState, input.key)) return { kind: 'already-committed' } as const;
        const kind = result.reason === 'cold' ? 'cold' : 'held';
        note('commit', kind, result.reason);
        return { kind } as const;
      }, () => { note('commit', 'cold', 'closed'); return { kind: 'cold' } as const; });
    },

    async release(attempt) {
      const done = await holding(async kingdom => {
        // Always enter the writer queue: a timed-out reserve may still be queued or committed while
        // privateState lags its receipt. The reducer checks this attempt against transactional state,
        // leaving committed work and another caller's reservation untouched.
        const result = await run(kingdom, 'release', attempt, { type: 'forge.release', attempt: { key: attempt.key, attemptId: attempt.attemptId } },
          { cause: { kind: 'external', source: 'forge', id: attempt.key } });
        note('release', result.status);
        return result.status === 'committed' || result.status === 'unchanged';
      }, () => null);
      if (done === null) throw new Error('The kingdom writer is not open here; the reservation expires on its own');
      if (!done) throw new Error('The kingdom did not release this reservation');
    },

    async status(attempt) {
      const status = await holding<RealmForgeAttemptStatus | null>(async kingdom => {
        // The stored outcome of this attempt's own commit is the durable truth, even when this process's view lags it.
        const known = await kingdom.lookup(commandId('commit', attempt));
        if (known?.status === 'committed') return { kind: 'committed', committedAt: known.at };
        for (const step of ['release', 'expire'] as const) {
          const released = await kingdom.lookup(commandId(step, attempt));
          if (released?.status === 'committed') return { kind: 'released' };
        }
        return attemptStatus(kingdom.privateState, attempt);
      }, () => null);
      if (!status) throw new Error('The kingdom writer is not open here');
      note('status', status.kind);
      return status;
    },
  };
  return authority;
}

export type { KingdomForgeAuthority };
