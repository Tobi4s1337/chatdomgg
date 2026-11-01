import { UIntSchema, type KingdomId } from '@chatdom/shared';
import { z } from 'zod';
import { RaidObservationSchema, type RaidObservation } from '../../../api/src/raid-gate/observations';
import { IGNORED } from '../twitch-moments/normalizer';
import type { SubscriptionPlan } from './subscriptions';

const Event = z.object({
  from_broadcaster_user_id: z.string(), from_broadcaster_user_login: z.string(), from_broadcaster_user_name: z.string(),
  to_broadcaster_user_id: z.string(), to_broadcaster_user_login: z.string(), to_broadcaster_user_name: z.string(),
  viewers: UIntSchema,
});
const ObservationIncludingEmpty = RaidObservationSchema.safeExtend({ viewers: UIntSchema });

/** Pure normalization of a verified frame. Preserve provider time after ChatIngest's five-second skew check. */
export function raidObservation(raw: unknown, context: {
  readonly plan: SubscriptionPlan; readonly kingdomId: KingdomId; readonly id: string;
  readonly origin: RaidObservation['origin']; readonly occurredAt: number; readonly receivedAt: number;
}): RaidObservation | typeof IGNORED | null {
  const { plan, kingdomId } = context;
  if (plan.type !== 'channel.raid' || plan.version !== '1' || Object.keys(plan.condition).length !== 1) return null;
  const direction = plan.condition.to_broadcaster_user_id === kingdomId ? 'incoming'
    : plan.condition.from_broadcaster_user_id === kingdomId ? 'outgoing' : null;
  if (!direction) return null;
  const parsed = Event.safeParse(raw);
  if (!parsed.success) return null;
  const event = parsed.data;
  const result = ObservationIncludingEmpty.safeParse({
    version: 1, id: context.id, origin: context.origin, kingdomId, direction,
    occurredAt: context.occurredAt, receivedAt: context.receivedAt,
    from: { kingdomId: event.from_broadcaster_user_id, login: event.from_broadcaster_user_login, name: event.from_broadcaster_user_name },
    to: { kingdomId: event.to_broadcaster_user_id, login: event.to_broadcaster_user_login, name: event.to_broadcaster_user_name },
    viewers: event.viewers,
  });
  if (!result.success) return null;
  if (result.data.viewers === 0) return IGNORED;
  return result.data;
}
