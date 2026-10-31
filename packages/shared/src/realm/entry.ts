import { z } from 'zod';
import { KingdomIdSchema } from '../identity';

/** Public, host-approved presentation only. Geometry and entry rights remain separate authorities. */
export const REALM_ENTRY_ROUTE = '/api/realm/entry/:kingdomId';
export const RealmEntryInfoSchema = z.strictObject({
  version: z.literal(1), kingdomId: KingdomIdSchema, origin: z.enum(['live', 'simulated']),
  name: z.string().trim().min(1).max(80),
});
export type RealmEntryInfo = z.infer<typeof RealmEntryInfoSchema>;
