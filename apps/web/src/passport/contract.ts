import type { PassportBook as FrozenBook } from '@chatdom/shared/passport';
import type { HiddenPassportView, PassportReplyView, PassportRequestView, VisiblePassportView } from '@chatdom/ui/passport';
import type { PassportReply, PassportRequest } from '../../../api/src/passport/contracts';

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

/** Every reply the passport boundary reader accepts is one the reading session understands, and every request it sends is one the reader reads. */
export const CHECKED_REPLY_FITS: Fits<PassportReply, PassportReplyView> = true;
export const SESSION_REQUEST_FITS: Fits<PassportRequestView, PassportRequest> = true;
