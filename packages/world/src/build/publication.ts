import type { BuildDraftSnapshot, VoxelBlueprint } from '@chatdom/shared';
import { BuildDraft, BuildError } from './draft';
import { assertBuildGrounded } from './shaping';

export interface BuildPublicationCandidate {
  readonly version: 1;
  readonly plotId: string;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly name: string;
  readonly revision: number;
  readonly source: BuildDraftSnapshot;
  readonly blueprint: VoxelBlueprint;
}
export interface Housewarming {
  readonly durationMs: 6000;
  readonly ownerName: string;
  readonly name: string;
  readonly plotId: string;
}
export type BuildPublicationDecision =
  | { status: 'published'; revision: number; publicationId: string }
  | { status: 'held' | 'refused'; revision: number; message: string };

/** Implemented by the authenticated realm service, not by a browser's approval button.
 * It rechecks ownership, source limits, revision, support/egress, six-angle visual/name moderation,
 * then atomically records the approved home and its housewarming. A hold preserves the last approved home.
 */
export interface BuildPublicationReviewer {
  reviewAndPublish(candidate: BuildPublicationCandidate): Promise<BuildPublicationDecision>;
}

export function prepareBuildPublication(draft: BuildDraft, names: { name: string; ownerName: string }): BuildPublicationCandidate {
  const name = cleanName(names.name), ownerName = cleanName(names.ownerName);
  const source = draft.serialize();
  assertBuildGrounded(draft.cloneVoxels(), draft.policy.size);
  const blueprint = draft.toBlueprint();
  const candidate: BuildPublicationCandidate = { version: 1, plotId: draft.policy.plotId, ownerId: draft.policy.ownerId,
    ownerName, name, revision: draft.revision, source, blueprint };
  return freezeTree(candidate);
}

/** Only the labelled simulation adapter may display this in its own local street. It is never approval. */
export function previewBuildPublication(candidate: BuildPublicationCandidate): {
  mode: 'SIMULATED'; status: 'local-preview'; candidate: BuildPublicationCandidate; housewarming: Housewarming;
} {
  return { mode: 'SIMULATED', status: 'local-preview', candidate,
    housewarming: { durationMs: 6000, ownerName: candidate.ownerName, name: candidate.name, plotId: candidate.plotId } };
}

export async function submitBuildPublication(candidate: BuildPublicationCandidate, reviewer?: BuildPublicationReviewer): Promise<BuildPublicationDecision> {
  if (!reviewer) throw new BuildError('review', 'Street publication needs the kingdom’s review service. Your draft is safe.');
  const decision = await reviewer.reviewAndPublish(candidate);
  if (decision.revision !== candidate.revision
    || !['published', 'held', 'refused'].includes(decision.status)
    || (decision.status === 'published' && !decision.publicationId)
    || (decision.status !== 'published' && !decision.message)) {
    throw new BuildError('review', 'The kingdom returned an incomplete publication receipt. Your draft is safe.');
  }
  return decision;
}

function cleanName(value: string): string {
  const text = value.trim();
  if (!text || text.length > 80 || [...text].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new BuildError('operation', 'Give this home a short, readable name.');
  return text;
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
