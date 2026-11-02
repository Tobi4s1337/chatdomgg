import { z } from 'zod';

/** Browser-safe: the holder's "Hide my travels" route and its wire shapes (served by `passport-http.ts`). */
export const RAID_PASSPORT_TRAVELS_ROUTE = '/api/raid-gate/passport/travels';
export const TravelsBodySchema = z.strictObject({ version: z.literal(1), travels: z.enum(['shown', 'hidden']) });
/** The passport disclosure the card's surfaces follow; the revision is the moment of the last change. */
export const TravelsReplySchema = z.strictObject({
  version: z.literal(1), origin: z.enum(['live', 'simulated']), travels: z.enum(['shown', 'hidden']),
  revision: z.number().int().nonnegative(),
});
export type TravelsReply = z.infer<typeof TravelsReplySchema>;
