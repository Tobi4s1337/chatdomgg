import { createHash } from 'node:crypto';
import { ForgeDraftSchema, VoxelBlueprintSchema, type ForgeDraft, type VoxelBlueprint } from '@chatdom/shared';

/** Private binding from the selected result gate to exactly what the realm is allowed to commit. */
export interface ForgeCandidateBinding { readonly draftDigest: string; readonly homeDigest: string }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const forgeDraftDigest = (draft: ForgeDraft) => digest(ForgeDraftSchema.parse(draft));
export function bindForgeCandidate(draft: ForgeDraft, home: VoxelBlueprint): ForgeCandidateBinding {
  return { draftDigest: forgeDraftDigest(draft), homeDigest: digest(VoxelBlueprintSchema.parse(home)) };
}
