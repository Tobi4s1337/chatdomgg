import { createHash } from 'node:crypto';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { z } from 'zod';
import type { ForgeWishReceipt, ForgeWishWithdrawal } from './types';

const integer = z.number().int().nonnegative().safe();
export const withdrawalSchema = z.strictObject({
  kingdomId: KingdomIdSchema,
  reason: z.enum(['deleted', 'moderated', 'offline', 'coverage']),
  scope: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('message'), messageId: z.string().min(1).max(128) }),
    z.strictObject({ kind: z.literal('person'), personId: PersonIdSchema, through: integer }),
    z.strictObject({ kind: z.literal('kingdom'), through: integer }),
  ]),
});
export const withdrawalRecordSchema = z.strictObject({
  version: z.literal(1), origin: z.enum(['live', 'simulated']), withdrawal: withdrawalSchema,
});
export const ownerDeliverySchema = z.strictObject({
  replyId: z.string().regex(/^forge:[a-f0-9]{48}$/),
  message: z.string().trim().min(1).max(240),
  acknowledged: z.boolean(),
});
export const ownerQuerySchema = z.strictObject({
  afterSequence: integer.optional(), limit: integer.min(1).max(32).optional(),
});

/** Field order and scope tags make target binding unambiguous without exposing IDs in filenames. */
export function withdrawalName(input: ForgeWishWithdrawal): string {
  const target = input.scope.kind === 'message' ? input.scope.messageId
    : input.scope.kind === 'person' ? input.scope.personId : null;
  const hash = createHash('sha256').update(JSON.stringify([input.kingdomId, input.scope.kind, target])).digest('hex');
  return `withdrawal-${hash}.json`;
}

export function matchesWithdrawal(input: ForgeWishWithdrawal,
  wish: Pick<ForgeWishReceipt, 'kingdomId' | 'personId' | 'messageId' | 'observedAt'>): boolean {
  if (input.kingdomId !== wish.kingdomId) return false;
  if (input.scope.kind === 'message') return input.scope.messageId === wish.messageId;
  return wish.observedAt <= input.scope.through
    && (input.scope.kind === 'kingdom' || input.scope.personId === wish.personId);
}

/** A later restore never lowers history's cutoff; rights for new wishes remain with the authority. */
export function mergeWithdrawal(previous: ForgeWishWithdrawal | undefined, next: ForgeWishWithdrawal): ForgeWishWithdrawal {
  if (!previous) return next;
  if (previous.scope.kind === 'message' || next.scope.kind === 'message') return previous;
  return next.scope.through > previous.scope.through ? next : previous;
}

/** Existing private realm receipt identity, scoped by its owning kingdom/person rather than a public route. */
export const ownerReplyId = (messageId: string) =>
  `forge:${createHash('sha256').update(messageId).digest('hex').slice(0, 48)}`;
