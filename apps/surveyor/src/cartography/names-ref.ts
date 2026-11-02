import NAMES_1 from './language-names-1.json?raw';
import { sha256 } from '../export/project';

/** The continent name table as a founding is gated on it: its id, review status and the exact bytes. */
export interface NamesRef { id: string; status: 'proposed' | 'reviewed'; sha256: string }

export function namesRefOf(text: string): NamesRef {
  const parsed = JSON.parse(text) as { kind?: unknown; id?: unknown; review?: { status?: unknown; reviewedBy?: unknown; reviewedAt?: unknown } };
  if (parsed.kind !== 'chatdom-atlas-language-names' || typeof parsed.id !== 'string' || !/^language-names-[0-9]{1,4}$/.test(parsed.id)) {
    throw new Error('Not a language name table.');
  }
  // Reviewed means signed off with a reviewer and a date; anything else is a proposal.
  const review = parsed.review ?? {};
  const reviewed = review.status === 'reviewed' && typeof review.reviewedBy === 'string' && review.reviewedBy.length > 0
    && typeof review.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt);
  return { id: parsed.id, status: reviewed ? 'reviewed' : 'proposed', sha256: sha256(text) };
}

export function currentNamesText(): string {
  return NAMES_1;
}
