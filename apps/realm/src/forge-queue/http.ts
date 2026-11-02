import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { FORGE_QUEUE_LIMITS, FORGE_QUEUE_ROUTE, KingdomIdSchema, type ForgeQueueView, type KingdomId } from '@chatdom/shared';
import { dockPrincipal, type DockSessionPool } from '../../../api/src/dock/auth';
import type { ForgeLineEntry } from './presenter';

export interface ForgeQueueSource {
  /** The kingdom's current line, head first. Empty when the anvil rests or the kingdom is unknown. */
  line(kingdomId: KingdomId): readonly (ForgeLineEntry & { readonly shownAt?: number })[];
  /** The approved name the citizen card shows, or null when the kingdom is not open here. */
  name(kingdomId: KingdomId, personId: string): string | null;
}

/**
 * Anyone sees how long the line is. The signed-in maker also sees their own place; the broadcaster (the
 * person whose Twitch ID is the kingdom's) also sees who waits, by approved name. Never words or reasons.
 */
export function forgeQueueView(source: ForgeQueueSource, kingdomId: KingdomId, reader: string | null, at = Date.now()): ForgeQueueView {
  const line = source.line(kingdomId), head = line[0];
  const view: { -readonly [K in keyof ForgeQueueView]: ForgeQueueView[K] } = { version: 1, kingdomId, total: line.length,
    waiting: Math.max(0, line.length - 1), forgingSince: head?.shownAt ?? null, at };
  if (reader !== null) {
    const position = line.findIndex(entry => entry.personId === reader);
    if (position >= 0) view.yours = { position, state: position === 0 ? 'forging' : 'waiting' };
    if (reader === kingdomId) view.makers = line.slice(0, FORGE_QUEUE_LIMITS.makers).map((entry, index) => ({
      position: index, name: source.name(kingdomId, entry.personId) ?? 'A citizen', state: index === 0 ? 'forging' : 'waiting' }));
  }
  return view;
}

export interface ForgeQueueHttpOptions {
  readonly pool: DockSessionPool;
  readonly origin: 'live' | 'simulated';
  readonly secureCookies: boolean;
}
export interface ForgeQueueHttpReply { readonly http: 200 | 400 | 503; readonly body: unknown }

export function createForgeQueueHandler(source: ForgeQueueSource, options: ForgeQueueHttpOptions) {
  return async (query: string, cookie: string | undefined): Promise<ForgeQueueHttpReply> => {
    const params = new URLSearchParams(query);
    const kingdomId = KingdomIdSchema.safeParse(params.get('kingdomId'));
    if (!kingdomId.success || [...params.keys()].some(key => key !== 'kingdomId') || params.getAll('kingdomId').length !== 1)
      return { http: 400, body: { version: 1, status: 'error', message: 'This queue request could not be read.' } };
    // A failed session read still answers the public line; it never fails the anvil for everyone.
    const reader = await dockPrincipal(options.pool, options.origin, options.secureCookies, cookie)
      .then(session => session?.principal.personId ?? null, () => null);
    return { http: 200, body: forgeQueueView(source, kingdomId.data, reader) };
  };
}

type App = uWebSocketsTransport['app'];
const STATUS = { 200: '200 OK', 400: '400 Bad Request', 503: '503 Service Unavailable' } as const;

export function mountForgeQueueRoutes(app: App, source: ForgeQueueSource, options: ForgeQueueHttpOptions): void {
  const handle = createForgeQueueHandler(source, options);
  app.get(FORGE_QUEUE_ROUTE, (response, request) => {
    let aborted = false;
    response.onAborted(() => { aborted = true; });
    const query = request.getQuery() ?? '', cookie = request.getHeader('cookie') || undefined;
    const send = (reply: ForgeQueueHttpReply) => {
      if (aborted) return;
      response.cork(() => {
        response.writeStatus(STATUS[reply.http]).writeHeader('Cache-Control', 'no-store')
          .writeHeader('Referrer-Policy', 'no-referrer').writeHeader('X-Content-Type-Options', 'nosniff')
          .writeHeader('Content-Type', 'application/json').end(JSON.stringify(reply.body));
      });
    };
    void handle(query, cookie).then(send, () => send({ http: 503, body: { version: 1, status: 'error', message: 'The anvil cannot be read just now.' } }));
  });
}
