import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { z } from 'zod';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { IngressGate } from '../gate';
import { forgetPerson, setPersonQuiet, type ForgetDependencies, type ForgottenKind } from './privacy';

/** The Herald's door for `!chatdom quiet`, `!chatdom quiet off` and `!chatdom forget`. Herald secret only. */
export const REALM_CHAT_PRIVACY_ROUTE = '/internal/realm/chat/privacy';

/**
 * The Herald sends the verified EventSub chat event's broadcaster and chatter IDs, never a typed name, so one person can
 * only ever quiet or forget themselves. `reply` is the line the Herald may post back in that chat, without an @-mention.
 */
export const ChatPrivacyRequestSchema = z.strictObject({
  version: z.literal(1), kingdomId: KingdomIdSchema, personId: PersonIdSchema, command: z.enum(['quiet', 'quiet-off', 'forget']),
});
export type ChatPrivacyRequest = z.infer<typeof ChatPrivacyRequestSchema>;
export type ChatPrivacyReply =
  | { readonly http: 200; readonly body: { readonly version: 1; readonly status: 'quiet' | 'forgotten'; readonly reply: string; readonly erased?: readonly ForgottenKind[] } }
  | { readonly http: 400 | 401 | 503; readonly body: { readonly version: 1; readonly status: 'refused' | 'unavailable'; readonly message: string } };

/** Short, kind and factual; the Herald posts it as is. */
export function chatPrivacyLine(command: ChatPrivacyRequest['command'], erased: readonly ForgottenKind[] = []): string {
  if (command === 'quiet') return 'Done. Your name stays off the stream; your light and home are still yours. !chatdom quiet off brings it back.';
  if (command === 'quiet-off') return 'Done. Your name can appear on the stream again.';
  return erased.length
    ? 'Forgotten, across every kingdom: your name, your light and what we noted of your visits. Your home waits if you take your place again.'
    : 'There was nothing of yours to forget.';
}

export class RealmChatPrivacy {
  private readonly gate: IngressGate;
  constructor(private readonly options: ForgetDependencies & { readonly secret: string | undefined }) {
    this.gate = new IngressGate(options.secret ? { herald: options.secret } : {}, options.origin);
  }
  authenticate(authorization: string): boolean { return this.gate.authenticate(authorization) === 'herald'; }

  async handle(authorization: string, raw: unknown): Promise<ChatPrivacyReply> {
    if (!this.authenticate(authorization)) return { http: 401, body: { version: 1, status: 'refused', message: 'Unknown chat service.' } };
    const request = ChatPrivacyRequestSchema.safeParse(raw);
    if (!request.success) return { http: 400, body: { version: 1, status: 'refused', message: 'Send { version: 1, kingdomId, personId, command }.' } };
    const { personId, command } = request.data;
    try {
      if (command !== 'forget') {
        await setPersonQuiet(this.options.db, this.options.origin, personId, command === 'quiet');
        return { http: 200, body: { version: 1, status: 'quiet', reply: chatPrivacyLine(command) } };
      }
      const answer = await forgetPerson(this.options, { personId });
      return { http: 200, body: { version: 1, status: 'forgotten', erased: answer.erased, reply: chatPrivacyLine(command, answer.erased) } };
    } catch {
      return { http: 503, body: { version: 1, status: 'unavailable', message: 'The realm could not do that just now. It is safe to send again.' } };
    }
  }
}

const STATUS = { 200: '200 OK', 400: '400 Bad Request', 401: '401 Unauthorized', 503: '503 Service Unavailable' } as const;
const LIMIT = 1_024;

/** Internal route only: bearer gate before buffering, bounded JSON, no browser CORS. */
export function mountChatPrivacyRoute(app: uWebSocketsTransport['app'], privacy: RealmChatPrivacy): void {
  app.post(REALM_CHAT_PRIVACY_ROUTE, (res, req) => {
    const authorization = req.getHeader('authorization');
    let aborted = false, finished = false, bytes = 0;
    const chunks: Buffer[] = [];
    res.onAborted(() => { aborted = true; });
    const reply = (answer: ChatPrivacyReply) => {
      if (aborted || finished) return;
      finished = true;
      res.cork(() => res.writeStatus(STATUS[answer.http]).writeHeader('Content-Type', 'application/json')
        .writeHeader('Cache-Control', 'no-store').writeHeader('X-Content-Type-Options', 'nosniff').end(JSON.stringify(answer.body)));
    };
    if (!privacy.authenticate(authorization)) { reply({ http: 401, body: { version: 1, status: 'refused', message: 'Unknown chat service.' } }); return; }
    if (!/^application\/json\b/i.test(req.getHeader('content-type')) || Number(req.getHeader('content-length') || 0) > LIMIT) {
      reply({ http: 400, body: { version: 1, status: 'refused', message: 'Send a bounded JSON request.' } }); return;
    }
    res.onData((chunk, last) => {
      if (aborted || finished) return;
      bytes += chunk.byteLength;
      if (bytes > LIMIT) { reply({ http: 400, body: { version: 1, status: 'refused', message: 'The request is too large.' } }); return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { reply({ http: 400, body: { version: 1, status: 'refused', message: 'The request is not JSON.' } }); return; }
      void privacy.handle(authorization, body).then(reply, () => reply({ http: 503, body: { version: 1, status: 'unavailable', message: 'The realm could not do that just now.' } }));
    });
  });
}
