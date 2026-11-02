import { createHash } from 'node:crypto';
import { ForgeDraftSchema, TokenSchema, VoxelBlueprintSchema, type KingdomId, type PersonId, type VoxelBlueprint } from '@chatdom/shared';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { forgeHostForPerson, ownedHostProfile } from '@chatdom/shared/realm';
import type { ForgeAttachment, ForgeAttempt, ForgeReservation, KingdomForgeAuthority, KingdomForgeLease, NativeForgeHome, RealmDomainCommand,
  RealmForgeReservation, RealmOwnedForgeHost, RealmPrivateState, RealmStoredOutcome } from '@chatdom/shared/realm';
import { REALM_BASE_ANVILS, RealmBusyError, RealmHeldError, RealmWriterFencedError, type DurableKingdom, type DurableKingdomHold,
  type RealmCommandMeta } from '../persistence';
import type { RealmForgeAttemptStatus, RealmForgeAuthority, RealmForgeOptions, RealmWiringLog } from './types';
import { forgeDraftDigest } from '../../../codex/src/kingdom-forge/candidate';
import { deferForgeAuthority } from '../../../codex/src/kingdom-forge/defer';

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

type Reserved = Awaited<ReturnType<KingdomForgeAuthority['reserve']>> & { readonly privateMessage?: string };
type Revalidated = Awaited<ReturnType<KingdomForgeAuthority['revalidate']>> & { readonly privateMessage?: string };
type Committed = Awaited<ReturnType<KingdomForgeAuthority['commit']>> & { readonly privateMessage?: string };
type Refusal = { readonly kind: 'held' | 'cold'; readonly reason: string };
type Eligible = { readonly kind: 'eligible'; readonly home: RealmOwnedForgeHost; readonly rights: RealmPrivateState['rights'][string]; readonly blueprint: VoxelBlueprint };

const privateCause = (cause: string) => ({
  'no-home': 'Your own home needs a hearth before the forge can make a part for it. Settle in first; your coal stays yours.',
  'no-rights': 'The smith is saving your own words for a returning night. Keep showing up; your coal stays yours.',
  offline: 'The forge fire rests while the stream is offline. Bring your wish when the kingdom wakes; your coal stays yours.',
  hold: 'Your wish waits privately for the Watch. Your coal stays yours.',
  coal: 'Your scuttle is empty. Your hearth gives you a coal each live night you are here.',
  busy: 'All the anvils are busy. Your coal stays yours; the smith needs a little time.',
  working: 'You already have a wish in the fire. Let it reach your home first; this wish costs nothing.',
}[cause] ?? 'The smith needs to check your home before this wish can land. Your coal stays yours.');

/**
 * What a person must actually hold for free words, read from committed authority only: their own home
 * on this founded layout, Forge rights without a hold, a live broadcast, approved names and home
 * geometry that matches its digest. The chat command's slot is never consulted.
 */
function eligibility(state: RealmPrivateState, personId: PersonId, now: number, layoutRevision: string): Eligible | Refusal {
  const home = forgeHostForPerson(state, personId);
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

function native(home: RealmOwnedForgeHost, blueprint: VoxelBlueprint): NativeForgeHome {
  return { slot: home.slot, revision: home.revision, family: home.family, home: structuredClone(blueprint), ...(ownedHostProfile(home) === 'castle-keep' ? { hostProfile: 'castle-keep' } : {}) };
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
function fits(attachment: ForgeAttachment, home: RealmOwnedForgeHost, kingdomId: KingdomId, origin: 'live' | 'simulated'): boolean {
  const a = attachment;
  const draft = ForgeDraftSchema.safeParse(a.draft);
  if (!draft.success) return false;
  if (!(a.version === 1 && a.kingdomId === kingdomId && a.slot === home.slot && a.hostId === home.blueprint.id && a.family === home.family
    && (a.hostProfile ?? 'street-home') === ownedHostProfile(home)
    && TokenSchema.safeParse(a.id).success && a.id === a.runId && TokenSchema.safeParse(a.socketId).success
    && TokenSchema.safeParse(a.kitId).success && Number.isSafeInteger(a.kitRevision) && a.kitRevision >= 0
    && typeof a.hostFingerprint === 'string' && a.hostFingerprint.length > 0 && a.hostFingerprint.length <= 128
    && a.origin.length === 3 && a.origin.every(n => Number.isSafeInteger(n))
    // A fixture never labels its result live, and a live room never adopts a simulated part.
    && a.provenance.source === origin && TokenSchema.safeParse(a.provenance.designId).success
    && a.provenance.makerName === home.attribution.makerName && a.provenance.kingdomName === home.attribution.kingdomName)) return false;
  try {
    const kit = forgeStyleKit(home.family);
    const socket = findForgeSockets(home.blueprint, ownedHostProfile(home), kit.revision).find(candidate => candidate.kind === draft.data.plan.kind);
    if (!socket || socket.id !== a.socketId || socket.origin.some((value, index) => value !== a.origin[index])
      || a.hostFingerprint !== homeFingerprint(home.blueprint)) return false;
    const assembled = assembleForge(draft.data.plan, kit, socket);
    checkForge(assembled, home.blueprint, ownedHostProfile(home));
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
    // A rejected reserve may be proposed again after capacity returns. Its expiry and native snapshot
    // can then differ, so each exact proposal needs its own immutable repository digest binding.
    // The reducer still owns one reservation per source attempt. Commit/release identities stay fixed.
    const id = step === 'reserve'
      ? `${commandId(step, attempt)}:${sha256(JSON.stringify(command)).slice(0, 48)}` : commandId(step, attempt);
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
      // A lookup proves the attempt's outcome, not that the submitted candidate matched its command digest.
      // Only execute can establish that match; status remains available to recover the durable outcome.
      if (step === 'commit' && known.status === 'committed') return { status: 'rejected', reason: 'unconfirmed-candidate' };
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
      if (!options || !gate || input.kingdomId !== kingdomId || !live(lease)) {
        note('reserve', 'cold', !options ? 'unconfigured' : !gate ? 'ungated' : 'closed');
        return !options || !gate ? deferForgeAuthority({ kind: 'cold' as const }, 'unavailable') : { kind: 'cold' };
      }
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
        if (found.kind !== 'eligible') { note('reserve', found.kind, found.reason); return { kind: found.kind, privateMessage: privateCause(found.reason) } as const; }
        const { home, rights, blueprint } = found;
        // Explain the actual committed prerequisite privately. The reducer still rechecks these in its transaction.
        if ((own(state.coals, input.personId) ?? 0) < 1) return { kind: 'held', privateMessage: privateCause('coal') } as const;
        const active = Object.values(state.reservations).filter(record => record.reservation.expiresAt > now);
        if (active.some(record => record.reservation.personId === input.personId)) return deferForgeAuthority({ kind: 'held', privateMessage: privateCause('working') } as const, 'capacity');
        if (active.length >= anvils) return deferForgeAuthority({ kind: 'held', privateMessage: privateCause('busy') } as const, 'capacity');
        const reservation: ForgeReservation = {
          reservationId: `forge-reservation-${attemptDigest(input).slice(0, 32)}`, kingdomId, personId: input.personId,
          ...native(home, blueprint),
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
        const fresh = kingdom.privateState;
        // Capacity may already have cleared after the rejection. Its old answer cannot become terminal
        // merely because a competing reservation was released before this read.
        if (result.reason === 'held' && eligibility(fresh, input.personId, kingdom.databaseNow(), kingdom.layoutRevision).kind === 'eligible'
          && (own(fresh.coals, input.personId) ?? 0) >= 1 && (!after || after.attempt.attemptId === input.attemptId))
          return deferForgeAuthority({ kind: 'held' as const }, 'capacity');
        if (result.reason === 'cold' && eligibility(kingdom.privateState, input.personId, kingdom.databaseNow(), kingdom.layoutRevision).kind === 'eligible')
          return deferForgeAuthority({ kind: 'cold' as const }, 'unavailable');
        return { kind } as const;
      }, () => { note('reserve', 'cold', 'closed'); return deferForgeAuthority({ kind: 'cold' as const }, 'unavailable'); });
    },

    async revalidate(attempt, reservationId, lease) {
      if (!options || !gate || !live(lease)) return !options || !gate
        ? deferForgeAuthority({ kind: 'cold' as const }, 'unavailable') : { kind: 'cold' };
      return holding<Revalidated>(async kingdom => {
        if (!live(lease)) return { kind: 'cold' } as const;
        const state = kingdom.privateState, now = kingdom.databaseNow(), r = own(state.reservations, attempt.key);
        if (!r || r.attempt.attemptId !== attempt.attemptId || r.reservation.reservationId !== reservationId || r.reservation.expiresAt <= now) {
          note('revalidate', 'cold', 'reservation'); return { kind: 'cold' } as const;
        }
        const found = eligibility(state, r.reservation.personId, now, kingdom.layoutRevision);
        if (found.kind !== 'eligible') { note('revalidate', found.kind, found.reason); return { kind: found.kind, privateMessage: privateCause(found.reason) } as const; }
        // A changed deed, a moderation decision or another night invalidates the reservation itself.
        if (found.home.id !== r.homeId) { note('revalidate', 'cold', 'home'); return { kind: 'cold' } as const; }
        if (found.rights.revision !== r.rightsRevision || found.rights.safetyIdentifier !== r.reservation.safetyIdentifier) { note('revalidate', 'held', 'rights'); return { kind: 'held' } as const; }
        if (state.stream.sessionId !== r.streamSessionId) { note('revalidate', 'cold', 'night'); return { kind: 'cold' } as const; }
        // The CURRENT home, even when it changed: the coordinator compares it with what its judges saw.
        return { kind: 'current', native: native(found.home, found.blueprint) } as const;
      }, () => deferForgeAuthority({ kind: 'cold' as const }, 'unavailable'));
    },

    async commit(input, lease) {
      if (!options || !gate || !live(lease)) {
        note('commit', 'cold', !options ? 'unconfigured' : !gate ? 'ungated' : 'closed');
        return !options || !gate ? deferForgeAuthority({ kind: 'cold' as const }, 'unavailable') : { kind: 'cold' };
      }
      const draft = ForgeDraftSchema.safeParse(input.attachment.draft);
      if (!draft.success) return { kind: 'held' };
      return holding<Committed>(async kingdom => {
        if (!live(lease)) { note('commit', 'cold', 'canceled'); return { kind: 'cold' } as const; }
        // Reporting this attempt's durable commit is not a new approval. A newer policy may no longer read its
        // historical audit. Its own receipt proves the outcome, but only the repository's command digest can
        // prove the full retry payload, including the original home revision/digest and reservation.
        const known = await kingdom.lookup(commandId('commit', input)).catch(() => {
          // An unavailable lookup is no evidence of success or rollback. A pending candidate still has to
          // pass current approval and the exact transactional command check; status can recover uncertainty.
          note('commit', 'uncertain');
          return null;
        });
        if (!live(lease)) { note('commit', 'cold', 'canceled'); return { kind: 'cold' } as const; }
        const prior = attemptStatus(kingdom.privateState, input);
        if (known?.status === 'committed' || prior.kind === 'committed') {
          const item = made(kingdom.privateState, input.key);
          // A lost reply can leave privateState behind its receipt. Without the stored approval receipt we
          // cannot reconstruct the original command: status can report recovery, commit cannot invent a match.
          if (!item || prior.kind !== 'committed') { note('commit', 'held', 'unconfirmed-candidate'); return { kind: 'held' } as const; }
          const command: RealmDomainCommand = {
            type: 'forge.commitApproved', attempt: { key: input.key, attemptId: input.attemptId }, reservationId: input.reservationId,
            expectedRevision: input.expectedRevision, expectedHomeDigest: input.expectedHomeDigest, attachment: structuredClone(input.attachment),
            creation: { words: input.creation.words.trim() }, approvalReceipt: item.approvalReceipt,
          };
          try {
            // Unlike a new write's recovery, a failed payload check cannot fall back to lookup: the receipt
            // names this attempt, not the submitted payload. Only an exact repository replay proves both.
            const replay = await gate.run(command, () => live(lease), () => kingdom.execute(commandId('commit', input), command, 'forge',
              { anvilCapacity: anvils, actor: item.ownerId, cause: { kind: 'external', source: 'forge', id: input.key }, current: () => live(lease) }));
            if (!live(lease) || replay.canceled) { note('commit', 'cold', 'canceled'); return { kind: 'cold' } as const; }
            if (replay.result.status === 'committed') return { kind: 'committed', committedAt: replay.result.at } as const;
            const kind = replay.result.reason === 'cold' ? 'cold' : 'held';
            note('commit', kind, replay.result.reason);
            return { kind } as const;
          } catch {
            const kind = live(lease) ? 'held' : 'cold';
            note('commit', kind, 'unconfirmed-candidate');
            return { kind } as const;
          }
        }
        if (made(kingdom.privateState, input.key)) { note('commit', 'already-committed'); return { kind: 'already-committed' } as const; }
        // Every new publication still needs the judges' own current audited approval of this exact candidate.
        // A model-approved event, a historical policy receipt or an API key alone never attaches anything.
        let approval: string | null;
        try {
          approval = await options.approvals.approved(input.key, input.attachment.runId,
            { draftDigest: forgeDraftDigest(draft.data), homeDigest: input.expectedHomeDigest,
              kitId: input.attachment.kitId, kitRevision: input.attachment.kitRevision });
        } catch { return deferForgeAuthority({ kind: 'held' as const }, 'unavailable'); }
        if (!approval || !TokenSchema.safeParse(approval).success) { note('commit', 'held', 'gates'); return { kind: 'held' } as const; }
        if (!live(lease)) { note('commit', 'cold', 'canceled'); return { kind: 'cold' } as const; }
        const state = kingdom.privateState, now = kingdom.databaseNow();
        const r = own(state.reservations, input.key);
        if (!r || r.attempt.attemptId !== input.attemptId || r.reservation.reservationId !== input.reservationId || r.reservation.expiresAt <= now) {
          note('commit', 'cold', 'reservation'); return { kind: 'cold' } as const;
        }
        const found = eligibility(state, r.reservation.personId, now, kingdom.layoutRevision);
        if (found.kind !== 'eligible') { note('commit', found.kind, found.reason); return { kind: found.kind, privateMessage: privateCause(found.reason) } as const; }
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
        // A rejected digest/conflict must never become success merely because this attempt made another payload.
        if (result.status === 'rejected') {
          const kind = result.reason === 'cold' ? 'cold' : 'held';
          note('commit', kind, result.reason);
          if (result.reason === 'cold' && live(lease)
            && eligibility(kingdom.privateState, r.reservation.personId, kingdom.databaseNow(), kingdom.layoutRevision).kind === 'eligible'
            && r.reservation.expiresAt > kingdom.databaseNow()) return deferForgeAuthority({ kind: 'cold' as const }, 'unavailable');
          return { kind } as const;
        }
        if (made(kingdom.privateState, input.key)) return { kind: 'already-committed' } as const;
        const kind = result.reason === 'cold' ? 'cold' : 'held';
        note('commit', kind, result.reason);
        return { kind } as const;
      }, () => { note('commit', 'cold', 'closed'); return deferForgeAuthority({ kind: 'cold' as const }, 'unavailable'); });
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
