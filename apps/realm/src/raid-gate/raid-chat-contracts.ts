import { z } from 'zod';
import { EpochMsSchema, KingdomIdSchema, PersonIdSchema, RaidChatCueSchema, TokenSchema } from '@chatdom/shared';

/** Private result of the existing durable guest authority. No speech text is stored or accepted here. */
export const RaidChatQualificationSchema = z.strictObject({
  origin: z.enum(['live', 'simulated']), kingdomId: KingdomIdSchema, personId: PersonIdSchema,
  messageId: TokenSchema, at: EpochMsSchema,
  proofMessageId: TokenSchema, proofAt: EpochMsSchema, raidOccurredAt: EpochMsSchema,
  raid: RaidChatCueSchema.shape.raid,
}).superRefine((proof, context) => {
  if (proof.proofAt < proof.raidOccurredAt || proof.proofAt >= proof.raidOccurredAt + 600_000 || proof.at < proof.proofAt) {
    context.addIssue({ code: 'custom', message: 'Raid chat requires original ten-minute evidence' });
  }
});
export type RaidChatQualification = z.infer<typeof RaidChatQualificationSchema>;
