/**
 * The panel's passport read: one POST to the kingdom's Extension backend, signed with the token Twitch's Helper gave
 * this view. The backend verifies that token and decides whose passport it is (or that there is none to show); the
 * panel never names a person in the body and never treats a Twitch ID as one. Every answer crosses the passport
 * boundary reader, so a refused reply reaches the session as `undefined` (unavailable, never an empty book).
 */
import { readPassportReply, type PassportReply } from '../../../api/src/passport/contracts';
import type { PassportReplyView, PassportRequestView, PassportTransport } from '@chatdom/ui/passport';

/** Replies are a book's first pages or one page of ≤50 records; anything far larger is not a passport. */
export const PANEL_PASSPORT_REPLY_LIMIT = 512 * 1024;

export interface PanelPassportEndpoint {
  /** The backend's passport read, an absolute https URL on the Extension's allowlist. */
  readonly url: string;
  /** The Helper's latest token, read at send time so a refreshed token is used at once. Null before authorization. */
  readonly token: () => string | null;
  readonly fetch?: typeof fetch;
}

/** The checked reply in the craft's structural terms (proved to fit in `apps/web/src/passport/contract.ts`). */
const view = (reply: PassportReply | undefined): PassportReplyView | undefined => reply;

export class PanelPassportUnauthorized extends Error {
  constructor() { super('Twitch has not authorized this panel yet'); this.name = 'PanelPassportUnauthorized'; }
}

export function passportExtensionTransport(endpoint: PanelPassportEndpoint): PassportTransport {
  const send = endpoint.fetch ?? fetch;
  return async (request: PassportRequestView, signal: AbortSignal) => {
    const token = endpoint.token();
    // Without Twitch's word there is nobody to read for: the read fails and the book stays closed as unavailable.
    if (!token) throw new PanelPassportUnauthorized();
    const response = await send(endpoint.url, {
      method: 'POST', signal, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`passport read answered ${response.status}`);
    const text = await response.text();
    if (signal.aborted) throw new Error('aborted');
    if (text.length > PANEL_PASSPORT_REPLY_LIMIT) return undefined;
    let body: unknown;
    try { body = JSON.parse(text); } catch { return undefined; }
    return view(readPassportReply(body));
  };
}
