/**
 * Transports for a passport reading. Each one hands the session only what the passport boundary reader accepted:
 * a refused reply resolves `undefined` (the session shows it as unavailable, never as an empty book) and a failed
 * read rejects.
 */
import { readPassportReply, type PassportReply } from '../../../api/src/passport/contracts';
import type { PassportReadContext, PassportReader } from '../../../api/src/passport/read';
import type { PassportReplyView, PassportRequestView, PassportTransport } from '@chatdom/ui/passport';

/** The checked reply in the craft's structural terms (proved to fit in `contract.ts`). */
const view = (reply: PassportReply | undefined): PassportReplyView | undefined => reply;

/**
 * Reads a passport over HTTP from main's route: POST `{ op: 'book' }` or `{ op: 'page', … }` as JSON. The route
 * decides the subject from its own path and session; the body never names a person.
 */
export function passportHttpTransport(endpoint: string, init: { fetch?: typeof fetch } = {}): PassportTransport {
  const send = init.fetch ?? fetch;
  return async (request: PassportRequestView, signal: AbortSignal) => {
    const response = await send(endpoint, {
      method: 'POST', signal, credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`passport read answered ${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { return undefined; }
    return view(readPassportReply(body));
  };
}

/**
 * Reads through a reader in this page, with the reply serialised and re-read exactly as it would cross a network.
 * Used by the SIMULATED bench; `wire` lets the bench show what a corrupt answer does.
 */
export function passportLocalTransport(reader: PassportReader, context: Omit<PassportReadContext, 'signal'>, wire: (json: unknown) => unknown = json => json): PassportTransport {
  return async (request, signal) => {
    const reply = await reader.handle({ ...context, signal }, JSON.parse(JSON.stringify(request)));
    if (signal.aborted) throw new Error('aborted');
    return view(readPassportReply(wire(JSON.parse(JSON.stringify(reply)))));
  };
}
