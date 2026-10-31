import { DisplayNameSchema } from '@chatdom/shared';

/**
 * The public name rule for signed-in people. It matches the rule Herald already applies before a chat name may
 * label a window: the provider's display name, with control and bidirectional-override characters removed.
 * A name that does not survive is not shown; the person walks under the anonymous presentation instead.
 */
export const DISPLAY_NAME_APPROVAL = 'provider-display-name-v1';
const UNSAFE_NAME = /[\p{Cc}؜‎‏‪-‮⁦-⁩]/gu;

export function approvedPublicName(raw: string | null): string | null {
  if (raw === null) return null;
  const cleaned = raw.replace(UNSAFE_NAME, '').trim();
  return DisplayNameSchema.safeParse(cleaned).success ? cleaned : null;
}
