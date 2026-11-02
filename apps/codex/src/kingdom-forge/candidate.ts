import { createHash } from 'node:crypto';
import { z } from 'zod';
import { forgeStyleKit } from '@chatdom/forge';
import { ForgeDraftSchema, ForgeStyleKitSchema, TokenSchema, VoxelBlueprintSchema, type ForgeDraft, type ForgeStyleKit, type VoxelBlueprint } from '@chatdom/shared';

const digests = { draftDigest: z.string().regex(/^[a-f0-9]{64}$/), homeDigest: z.string().regex(/^[a-f0-9]{64}$/) };
const LegacyCandidateSchema = z.strictObject(digests);
const ExactCandidateSchema = z.strictObject({ ...digests, kitId: TokenSchema, kitRevision: z.number().int().positive().safe() })
  .superRefine(({ kitId, kitRevision }, context) => {
    const family = (['hearth', 'tide', 'grove'] as const).find(family => `${family}-native` === kitId);
    try {
      if (!family || forgeStyleKit(family, kitRevision).id !== kitId) throw new Error('Unknown kit');
    } catch { context.addIssue({ code: 'custom', message: 'An approval needs a registered Forge style kit.' }); }
  });

/** A legacy audit has neither kit field. Partial, unknown or future kit metadata is never legacy. */
export const ForgeCandidateBindingSchema = z.union([LegacyCandidateSchema, ExactCandidateSchema]);
/** Private binding from the selected result gate to exactly what the realm is allowed to commit. */
export type ForgeCandidateBinding = Readonly<z.infer<typeof ForgeCandidateBindingSchema>>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const forgeDraftDigest = (draft: ForgeDraft) => digest(ForgeDraftSchema.parse(draft));
/** Omission exists only to read/reproduce revision-one legacy evidence. New runs supply their trusted assembly kit. */
export function bindForgeCandidate(draft: ForgeDraft, home: VoxelBlueprint, styleKit?: ForgeStyleKit): ForgeCandidateBinding {
  const candidate = { draftDigest: forgeDraftDigest(draft), homeDigest: digest(VoxelBlueprintSchema.parse(home)) };
  if (styleKit === undefined) return candidate;
  const kit = ForgeStyleKitSchema.parse(styleKit), registered = forgeStyleKit(kit.family, kit.revision);
  if (kit.id !== registered.id || kit.styleId !== registered.styleId) throw new Error('An approval needs the registered assembly kit.');
  return ExactCandidateSchema.parse({ ...candidate, kitId: kit.id, kitRevision: kit.revision });
}
