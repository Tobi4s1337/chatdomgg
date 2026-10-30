import { z } from 'zod';

/** IDs are decimal strings; converting them to numbers can merge distinct people. */
export const TwitchIdSchema = z.string().regex(/^[1-9][0-9]{0,31}$/);
export const PersonIdSchema = TwitchIdSchema.brand<'PersonId'>();
export const KingdomIdSchema = TwitchIdSchema.brand<'KingdomId'>();
export type PersonId = z.infer<typeof PersonIdSchema>;
export type KingdomId = z.infer<typeof KingdomIdSchema>;

export const UIntSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const PositiveIntSchema = UIntSchema.min(1);
/** Unix milliseconds, never seconds or a device-local date string. */
export const EpochMsSchema = UIntSchema.max(8_640_000_000_000_000);
export const TokenSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const TwitchLoginSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
export const DisplayNameSchema = z.string().min(1).max(128);

/** The citizen key is the pair. Neither login nor home address is an identity. */
export const CitizenKeySchema = z.strictObject({
  personId: PersonIdSchema,
  kingdomId: KingdomIdSchema,
});
export type CitizenKey = z.infer<typeof CitizenKeySchema>;

export function kingdomForBroadcaster(personId: PersonId): KingdomId {
  return KingdomIdSchema.parse(personId);
}
