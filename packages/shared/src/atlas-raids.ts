import { z } from 'zod';
import { AtlasEvidenceSchema } from './atlas';
import { EpochMsSchema, KingdomIdSchema, TokenSchema, UIntSchema } from './identity';
import { SurveyorRaidSchema } from './surveyor';

/** Public channel event, not a kingdom fact and never a per-person journey. */
export const AtlasRaidSchema = z.strictObject({
  version: z.literal(1),
  id: TokenSchema,
  fromKingdomId: KingdomIdSchema,
  toKingdomId: KingdomIdSchema,
  viewers: UIntSchema.min(1),
  observedAt: EpochMsSchema,
  occurredAt: EpochMsSchema.nullable(),
  evidence: AtlasEvidenceSchema,
  delivery: z.enum(['ephemeral', 'resumable']),
  source: z.enum(['surveyor-sse', 'surveyor-recorder', 'herald', 'simulation']),
}).superRefine((raid, ctx) => {
  if (raid.evidence.asOf !== raid.observedAt) {
    ctx.addIssue({ code: 'custom', path: ['evidence', 'asOf'], message: 'A raid keeps its original observation time on every delivery.' });
  }
  if (raid.fromKingdomId === raid.toKingdomId) ctx.addIssue({ code: 'custom', message: 'A raid must join different channels.' });
  if ((raid.source === 'simulation') !== (raid.evidence.kind === 'simulated')) {
    ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'Simulated raids must retain their simulation label.' });
  }
  if (raid.source === 'surveyor-sse' && (raid.occurredAt !== null || raid.delivery !== 'ephemeral')) {
    ctx.addIssue({ code: 'custom', message: 'Legacy SSE has receipt time only and cannot resume.' });
  }
});
export type AtlasRaid = z.infer<typeof AtlasRaidSchema>;

/** Legacy at is Date.now() inside onRaid, NOT the EventSub event timestamp. */
export function adaptSurveyorRaid(input: unknown): AtlasRaid {
  const raid = SurveyorRaidSchema.parse(input);
  return AtlasRaidSchema.parse({
    version: 1,
    // A best-effort content key, not an upstream event ID or a replay cursor.
    id: `surveyor:${raid.at}:${raid.from.id}:${raid.to.id}:${raid.viewers}`,
    fromKingdomId: raid.from.id,
    toKingdomId: raid.to.id,
    viewers: raid.viewers,
    observedAt: raid.at,
    occurredAt: null,
    evidence: { kind: 'observed', asOf: raid.at },
    delivery: 'ephemeral',
    source: 'surveyor-sse',
  });
}
