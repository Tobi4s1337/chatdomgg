import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ForgeDraftSchema, ForgeHostProfileSchema, KingdomIdSchema, TokenSchema,
  VoxelBlueprintSchema, type ForgeStyleKit } from '@chatdom/shared';
import { homeFingerprint } from '@chatdom/forge';
import { createQueuedForgeRunRecovery } from '../run-recovery';
import { FORGE_JUDGE_POLICY_VERSION } from '../providers/policy';
import { forgeDeliveryMessage } from '../wish-decision';
import { FileForgeWishQueue, type ForgeWishClaim, type ForgeWishJson } from '../wish-queue';
import { createKingdomForgeApplication, type KingdomForgeOptions, type KingdomForgeResult } from './application';
import type { ForgeCommitRequest, KingdomForgeExecution } from './execution';
import { forgeAuthorityDeferred } from './defer';
import type { CommittedForgeAttachment, ForgeAttempt, ForgeReservation, KingdomForgeAuthority,
  KingdomForgeCommand, KingdomForgeLease } from './ports';

const integer = z.number().int().nonnegative().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const originSchema = z.enum(['live', 'simulated']);
const attributionSchema = z.strictObject({ makerName: z.string().min(1).max(64), kingdomName: z.string().min(1).max(64), approvalId: TokenSchema });
const bindingSchema = z.strictObject({ version: z.literal(1), commandDigest: hash, origin: originSchema,
  policy: z.string().min(1).max(128), reservationId: TokenSchema, revision: TokenSchema, slot: integer.max(65_534),
  family: z.enum(['hearth', 'tide', 'grove']), homeDigest: hash, fingerprint: z.string().min(1).max(128),
  hostProfile: ForgeHostProfileSchema, safetyIdentifier: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  expiresAt: integer, attribution: attributionSchema,
  kit: z.strictObject({ id: TokenSchema, revision: integer.positive(), styleId: TokenSchema }),
});
const attachmentSchema = z.strictObject({ version: z.literal(1), id: TokenSchema, runId: TokenSchema,
  kingdomId: KingdomIdSchema, slot: integer.max(65_534), hostId: TokenSchema,
  hostFingerprint: z.string().min(1).max(128), socketId: TokenSchema,
  origin: z.tuple([z.number().int().safe(), z.number().int().safe(), z.number().int().safe()]),
  kitId: TokenSchema, kitRevision: integer.positive(), family: z.enum(['hearth', 'tide', 'grove']),
  hostProfile: ForgeHostProfileSchema.optional(), draft: ForgeDraftSchema,
  provenance: z.strictObject({ source: originSchema, makerName: z.string().min(1).max(64),
    kingdomName: z.string().min(1).max(64), designId: TokenSchema }),
}).transform(({ hostProfile, ...value }) => ({ ...value, ...(hostProfile ? { hostProfile } : {}) }));
const commitInputSchema = z.strictObject({ key: z.string().regex(/^forge-chat-[a-f0-9]{64}$/), attemptId: TokenSchema,
  reservationId: TokenSchema, expectedRevision: TokenSchema, expectedHomeDigest: hash,
  attachment: attachmentSchema, creation: z.strictObject({ words: z.string().min(1).max(240) }),
});
const selectionSchema = z.strictObject({ verdict: integer.min(1).max(2), attempt: integer.min(1).max(2),
  delivery: z.enum(['delivered', 'retried', 'softened']), shared: z.enum(['subject', 'family', 'slot', 'mood', 'colour']),
  reason: z.enum(['vocabulary', 'quality', 'fit']).optional(),
}).transform(({ reason, ...value }) => ({ ...value, ...(reason ? { reason } : {}) }));
const commitSchema = z.strictObject({ version: z.literal(1), bindingDigest: hash,
  input: commitInputSchema, selection: selectionSchema.optional() });
const terminalOutcomeSchema = z.union([
  z.strictObject({ kind: z.literal('refused'), message: z.string().min(1).max(240), privateMessage: z.string().min(1).max(240).optional() })
    .transform(({ privateMessage, ...value }) => ({ ...value, ...(privateMessage ? { privateMessage } : {}) })),
  z.strictObject({ kind: z.enum(['held', 'cold', 'canceled']), privateMessage: z.string().min(1).max(240).optional() })
    .transform(({ privateMessage, ...value }) => ({ ...value, ...(privateMessage ? { privateMessage } : {}) })),
]);
const terminalSchema = z.strictObject({ version: z.literal(1), commandDigest: hash, origin: originSchema,
  outcome: terminalOutcomeSchema });
const statusSchema = z.union([z.strictObject({ kind: z.literal('committed'), committedAt: integer }),
  z.strictObject({ kind: z.enum(['reserved', 'released', 'other-attempt', 'unknown']) })]);
type SavedCommit = z.infer<typeof commitSchema>;
type Terminal = z.infer<typeof terminalOutcomeSchema>;
export type RecoverableKingdomForgeAuthority = KingdomForgeAuthority & {
  status(attempt: ForgeAttempt): Promise<z.infer<typeof statusSchema>>;
};
export interface QueuedKingdomForgeOptions extends Omit<KingdomForgeOptions, 'authority'> {
  readonly queue: FileForgeWishQueue;
  readonly authority: RecoverableKingdomForgeAuthority;
}
export interface QueuedKingdomForgeControl {
  /** Losing this lease suspends work; it does not withdraw the wish or release its reservation. */
  readonly lease?: KingdomForgeLease;
  /** Explicit witnessed withdrawal, separate from worker/service lifetime. */
  readonly withdrawal?: AbortSignal;
  /** Trusted durable admission order; only a first publication is gated. Exact committed recovery bypasses it. */
  readonly canCommit?: () => boolean;
  /** Keep an anvil available for earlier accepted work that has not reserved yet. */
  readonly canReserve?: () => boolean;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const commandDigest = (command: KingdomForgeCommand) => digest([command.kingdomId, command.personId,
  command.messageId, command.slot, command.observedAt, command.words]);
const pending = (attempt: ForgeAttempt): KingdomForgeResult => ({ kind: 'recovery-needed', ...attempt });
function read<T>(schema: z.ZodType<T>, value: unknown): T {
  try { return schema.parse(value); } catch { throw new Error('The saved Forge work needs private recovery.'); }
}
async function wait<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The Forge authority has not answered.')), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

/**
 * Execute one claimed wish through the real coordinator. The worker still owns durable owner delivery and
 * queue.finish; this adapter never deletes words or claims a terminal receipt on that worker's behalf.
 * After recovery-needed, retry/reclaim before starting another execution so snapshots are current.
 */
export function createQueuedKingdomForgeApplication(options: QueuedKingdomForgeOptions) {
  return async (claim: ForgeWishClaim, control: QueuedKingdomForgeControl = {}): Promise<KingdomForgeResult> => {
    const { queue, authority } = options, attempt = claim.attempt, command = claim.command;
    const expectedCommand = commandDigest(command), origin = authority.origin;
    const snapshots = new Map(claim.checkpoints.map(checkpoint => [checkpoint.id, checkpoint.data]));
    const withdrawal = () => claim.withdrawal.aborted || control.withdrawal?.aborted === true;
    const owned = () => claim.current() && !claim.signal.aborted;
    const signal = AbortSignal.any([claim.signal, claim.withdrawal, ...(control.lease ? [control.lease.signal] : []),
      ...(control.withdrawal ? [control.withdrawal] : [])]);
    const live = () => owned() && !signal.aborted && (control.lease?.current() ?? true);
    const lease: KingdomForgeLease = { signal, current: live };
    // Used only after status proves a monotonic committed outcome: exact replay cannot make a new piece.
    const recoveryLease: KingdomForgeLease = { signal: claim.signal, current: owned };
    const mayCommit = () => { try { return control.canCommit?.() ?? true; } catch { return false; } };
    const firstCommit: KingdomForgeAuthority['commit'] = async (input, caller) => {
      if (!mayCommit()) throw new Error('This wish is waiting for its turn at the anvil.');
      const result = await authority.commit(input, { signal: caller.signal, current: () => caller.current() && mayCommit() });
      if (forgeAuthorityDeferred(result)) throw new Error('The Forge authority is awaiting recovery.');
      return result;
    };
    const save = async (id: string, stage: 'words' | 'commit', data: unknown) => {
      if (!owned()) throw new Error('The Forge worker no longer owns this wish.');
      const json = JSON.parse(JSON.stringify(data)) as ForgeWishJson;
      await queue.checkpoint(claim, { id, stage, data: json }); snapshots.set(id, json);
    };
    const status = async () => read(statusSchema, await wait(() => authority.status(attempt)));
    const storedBinding = () => {
      const raw = snapshots.get('application-binding');
      if (raw === undefined) return undefined;
      const binding = read(bindingSchema, raw);
      if (binding.origin !== origin || binding.commandDigest !== expectedCommand) throw new Error('The saved Forge binding differs.');
      return binding;
    };
    const storedCommit = (): SavedCommit | undefined => {
      const raw = snapshots.get('application-commit');
      if (raw === undefined) return undefined;
      const saved = read(commitSchema, raw), binding = storedBinding();
      if (!binding || saved.bindingDigest !== digest(binding)) throw new Error('The saved Forge command is unbound.');
      const input = saved.input, a = input.attachment;
      if (input.key !== attempt.key || input.attemptId !== attempt.attemptId || input.creation.words !== command.words
        || input.reservationId !== binding.reservationId || input.expectedRevision !== binding.revision
        || input.expectedHomeDigest !== binding.homeDigest || a.id !== a.runId || a.kingdomId !== command.kingdomId
        || a.slot !== binding.slot || a.family !== binding.family || a.hostFingerprint !== binding.fingerprint
        || (a.hostProfile ?? 'street-home') !== binding.hostProfile || a.kitId !== binding.kit.id
        || a.kitRevision !== binding.kit.revision || a.provenance.source !== origin
        || a.provenance.makerName !== binding.attribution.makerName || a.provenance.kingdomName !== binding.attribution.kingdomName)
        throw new Error('The saved Forge command differs from its exact source.');
      return saved;
    };
    const storedTerminal = (): Terminal | undefined => {
      const raw = snapshots.get('application-terminal');
      if (raw === undefined) return undefined;
      const saved = read(terminalSchema, raw);
      if (saved.commandDigest !== expectedCommand || saved.origin !== origin) throw new Error('The saved Forge outcome differs.');
      return saved.outcome;
    };
    const rememberTerminal = async (outcome: Terminal) => {
      await save('application-terminal', 'commit', { version: 1, commandDigest: expectedCommand, origin, outcome });
    };
    const publication = (saved: SavedCommit, at: number): KingdomForgeResult => {
      const attachment: CommittedForgeAttachment = { ...saved.input.attachment, committedAt: at,
        provenance: { ...saved.input.attachment.provenance, firstForgedAt: at } };
      return { kind: 'committed', attachment, published: false,
        privateMessage: forgeDeliveryMessage(attachment.draft, saved.selection) };
    };
    const replay = async (saved: SavedCommit, knownCommitted: boolean): Promise<KingdomForgeResult> => {
      if (!owned() || !knownCommitted && !live()) return pending(attempt);
      if (!knownCommitted && !mayCommit()) return pending(attempt);
      const result = await wait(() => knownCommitted
        ? authority.commit(structuredClone(saved.input), recoveryLease)
        : firstCommit(structuredClone(saved.input), lease));
      if (forgeAuthorityDeferred(result)) return pending(attempt);
      if (!owned()) return pending(attempt);
      if (result.kind !== 'committed') {
        if (knownCommitted) return pending(attempt); // A receipt cannot substitute for an exact payload match.
        const after = await status();
        if (after.kind === 'committed') return replay(saved, true);
        if (after.kind === 'other-attempt' || result.kind === 'already-committed') return pending(attempt);
        return cleanTerminal({ kind: result.kind, ...('privateMessage' in result && typeof result.privateMessage === 'string'
          && result.privateMessage.length <= 240 ? { privateMessage: result.privateMessage } : {}) });
      }
      if (!Number.isSafeInteger(result.committedAt) || result.committedAt < 0) return pending(attempt);
      return publication(saved, result.committedAt);
    };
    const cleanTerminal = async (outcome: Terminal): Promise<KingdomForgeResult> => {
      if (!owned() || queue.origin !== origin) return pending(attempt);
      const known = await status();
      if (known.kind === 'committed') {
        const saved = storedCommit(); return saved ? await replay(saved, true) : pending(attempt);
      }
      if (known.kind === 'other-attempt') return pending(attempt);
      if (!storedTerminal()) await rememberTerminal(outcome);
      if (known.kind !== 'released') await wait(() => authority.release(attempt));
      const after = await status();
      if (after.kind === 'committed') {
        const saved = storedCommit(); return saved ? await replay(saved, true) : pending(attempt);
      }
      if (after.kind === 'reserved' || after.kind === 'other-attempt' || !owned()) return pending(attempt);
      return outcome;
    };

    try {
      if (!owned() || queue.origin !== origin) return pending(attempt);
      const actual = await queue.get(attempt.key);
      if (!actual || actual.attemptId !== attempt.attemptId || actual.generation !== claim.receipt.generation
        || actual.modelCalls !== claim.receipt.modelCalls) return pending(attempt);
      const known = await status(), saved = storedCommit(), terminal = storedTerminal();
      if (!owned()) return pending(attempt);
      if (known.kind === 'committed') return saved ? await replay(saved, true) : pending(attempt);
      if (known.kind === 'other-attempt') return pending(attempt);
      if (terminal) return await cleanTerminal(terminal);
      if (withdrawal()) return await cleanTerminal({ kind: 'canceled' });
      if (!live()) return pending(attempt);
      if (known.kind === 'released') return await cleanTerminal({ kind: 'cold',
        privateMessage: 'The fire cooled before this wish could land. Your coal stays yours.' });
      if (saved) {
        // New publication still passes the current exact approval, live reservation and normal write gate.
        return await replay(saved, false);
      }
      let invalidBinding: Terminal | undefined;
      const execution: KingdomForgeExecution = { attempt, recovery: createQueuedForgeRunRecovery(queue, claim),
        async bind(reservation: ForgeReservation, kit: ForgeStyleKit) {
          const next = read(bindingSchema, { version: 1, commandDigest: expectedCommand, origin,
            policy: FORGE_JUDGE_POLICY_VERSION, reservationId: reservation.reservationId,
            revision: reservation.revision, slot: reservation.slot, family: reservation.family,
            homeDigest: digest(VoxelBlueprintSchema.parse(reservation.home)), fingerprint: homeFingerprint(reservation.home),
            hostProfile: reservation.hostProfile ?? 'street-home', safetyIdentifier: reservation.safetyIdentifier,
            expiresAt: reservation.expiresAt, attribution: reservation.attribution,
            kit: { id: kit.id, revision: kit.revision, styleId: kit.styleId } });
          const previous = storedBinding();
          if (previous && digest(previous) !== digest(next)) {
            invalidBinding = { kind: 'held', privateMessage: 'Your home or the Forge rules changed while this wish waited. Your coal stays yours.' };
            throw new Error('The saved Forge binding has changed.');
          }
          if (previous) {
            const current = await wait(() => authority.revalidate(attempt, reservation.reservationId, lease));
            if (forgeAuthorityDeferred(current)) throw new Error('The Forge authority is awaiting recovery.');
            if (!live()) throw new Error('The Forge worker was interrupted.');
            if (current.kind !== 'current' || current.native.revision !== reservation.revision
              || current.native.slot !== reservation.slot || current.native.family !== reservation.family
              || (current.native.hostProfile ?? 'street-home') !== (reservation.hostProfile ?? 'street-home')
              || digest(VoxelBlueprintSchema.parse(current.native.home)) !== next.homeDigest) {
              invalidBinding = { kind: 'held', privateMessage: 'Your home needs another look before this wish can land. Your coal stays yours.' };
              throw new Error('The recovered Forge home is no longer current.');
            }
          } else await save('application-binding', 'words', next);
        },
        async prepareCommit(input: ForgeCommitRequest, selection) {
          const binding = storedBinding(); if (!binding) throw new Error('The Forge reservation has no saved binding.');
          const candidate = read(commitSchema, { version: 1, bindingDigest: digest(binding), input,
            ...(selection ? { selection } : {}) });
          await save('application-commit', 'commit', candidate);
          storedCommit();
        },
      };
      const run = createKingdomForgeApplication({ ...options,
        authority: { ...authority, commit: firstCommit, reserve: async (...args) => {
          if (control.canReserve && !control.canReserve()) throw new Error('An earlier wish is waiting for its anvil.');
          const result = await authority.reserve(...args);
          if (forgeAuthorityDeferred(result)) throw new Error('The anvil is waiting for its present work.');
          return result;
        }, revalidate: async (...args) => {
          const result = await authority.revalidate(...args);
          if (forgeAuthorityDeferred(result)) throw new Error('The Forge authority is awaiting recovery.');
          return result;
        } },
        // Committed pieces already belong to the authority's durable outbox. Never replay that ceremony here.
        publish: event => { if (event.type !== 'committed' && mayCommit()) options.publish(event); },
      });
      const outcome = await run(command, lease, execution);
      if (!owned()) return pending(attempt);
      if (outcome.kind === 'committed') return { ...outcome, published: false };
      if (withdrawal()) return await cleanTerminal({ kind: 'canceled' });
      if (!live()) return pending(attempt);
      if (invalidBinding) return await cleanTerminal(invalidBinding);
      if (outcome.kind === 'recovery-needed' || outcome.kind === 'already-committed') {
        const after = await status(), commit = storedCommit();
        return after.kind === 'committed' && commit ? await replay(commit, true) : pending(attempt);
      }
      return await cleanTerminal(read(terminalOutcomeSchema, outcome));
    } catch {
      // Storage, malformed snapshots, a dead dependency and unknown commits are never invented terminal replies.
      return pending(attempt);
    }
  };
}
