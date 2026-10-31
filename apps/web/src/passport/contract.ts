import type { PassportBook as FrozenBook } from '@chatdom/shared/passport';
import type { HiddenPassportView, VisiblePassportView } from '@chatdom/ui/passport';

/**
 * Compile-time proof that the frozen read projection still fits the views the book's craft reads. If the shared
 * contract changes shape, this file stops compiling before any surface can draw a book it misunderstands.
 */
type Visible = Extract<FrozenBook, { visibility: 'visible' }>;
type Hidden = Extract<FrozenBook, { visibility: 'hidden' }>;
type Fits<A, B> = [A] extends [B] ? true : false;
export const FROZEN_VISIBLE_FITS: Fits<Visible, VisiblePassportView> = true;
export const FROZEN_HIDDEN_FITS: Fits<Hidden, HiddenPassportView> = true;
/** And the hidden view carries nothing the frozen hidden payload does not: no holder, revision or history. */
export const HIDDEN_VIEW_IS_EXACT: Fits<keyof HiddenPassportView, keyof Hidden> = true;
