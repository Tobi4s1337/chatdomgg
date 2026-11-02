import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, TokenSchema, UIntSchema } from '../../../../packages/shared/src/identity';

export const RAID_CRIER_CLAIM_ROUTE = '/internal/realm/raid-gate/crier/claim';
export const RAID_CRIER_RECEIPT_ROUTE = '/internal/realm/raid-gate/crier/receipt';
export const RAID_CRIER_SETTINGS_PREFIX = '/api/raid-gate/crier';
export const RAID_CRIER_LIFETIME_MS = 60_000;
export const RAID_CRIER_ALLOWED_LIVE_KINGDOM = '129634568';
export const CrierModeSchema = z.enum(['silent', 'rare', 'herald']);
const Origin = z.enum(['live', 'simulated']);
export const RaidCrierClaimRequestSchema = z.strictObject({ version: z.literal(1), origin: Origin, kingdomId: KingdomIdSchema, senderId: PersonIdSchema });
export const RaidCrierClaimSchema = z.strictObject({
  version: z.literal(1), origin: Origin, claimId: z.uuid(), raidId: TokenSchema,
  kingdomId: KingdomIdSchema, senderId: PersonIdSchema, expiresAt: EpochMsSchema,
  text: z.string().min(1).max(500).regex(/^[^\p{Cc}\p{Cf}]*$/u),
});
export const RaidCrierClaimReplySchema = z.strictObject({ version: z.literal(1), claim: RaidCrierClaimSchema.nullable() });
export const RaidCrierOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('sent'), messageId: TokenSchema }),
  z.strictObject({ status: z.literal('refused'), code: z.string().regex(/^[a-z0-9_-]{1,64}$/u) }),
  z.strictObject({ status: z.literal('unknown') }),
]);
export const RaidCrierReceiptSchema = z.strictObject({ ...RaidCrierClaimRequestSchema.shape, claimId: z.uuid(), outcome: RaidCrierOutcomeSchema });
export const RaidCrierSettingSchema = z.strictObject({ version: z.literal(1), origin: Origin, kingdomId: KingdomIdSchema,
  revision: UIntSchema, mode: CrierModeSchema });
export const RaidCrierSettingChangeSchema = z.strictObject({ version: z.literal(1), expectedRevision: UIntSchema, mode: CrierModeSchema });
export type RaidCrierClaim = z.infer<typeof RaidCrierClaimSchema>;
export type RaidCrierClaimRequest = z.infer<typeof RaidCrierClaimRequestSchema>;
export type RaidCrierReceipt = z.infer<typeof RaidCrierReceiptSchema>;
export type RaidCrierOutcome = z.infer<typeof RaidCrierOutcomeSchema>;
export type RaidCrierSetting = z.infer<typeof RaidCrierSettingSchema>;
export type CrierMode = z.infer<typeof CrierModeSchema>;
