import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { KingdomIdSchema, RaidChatFrameSchema, type KingdomId } from '@chatdom/shared';
import type { RaidChatPresentation } from './raid-chat-presentation';

export const RAID_CHAT_ROUTE = '/realm/raid-chat/:kingdomId';
export interface RaidChatReaderOptions {
  readonly origin: 'live' | 'simulated';
  readonly presentation: Pick<RaidChatPresentation, 'read' | 'clear'>;
  /** Only this process's current adopted writer. Never retain/open a writer for a public chat read. */
  readonly current: (kingdomId: KingdomId) => boolean;
}
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** Current ephemeral cues only. No cursor, history, private identities or durable chat archive. */
export function createRaidChatReader(options: RaidChatReaderOptions) {
  let closed = false;
  return {
    handle(request: Request): Response {
      const url = new URL(request.url), match = /^\/realm\/raid-chat\/([1-9][0-9]{0,31})$/u.exec(url.pathname);
      if (!match) return json(404, { version: 1, status: 'unavailable' });
      if (request.method !== 'GET') return json(405, { version: 1, status: 'refused' });
      if (url.search) return json(400, { version: 1, status: 'refused' });
      if (closed) return json(503, { version: 1, status: 'unavailable' });
      const kingdomId = KingdomIdSchema.parse(match[1]);
      if (!options.current(kingdomId)) { options.presentation.clear(kingdomId); return json(503, { version: 1, status: 'unavailable' }); }
      try {
        const frame = RaidChatFrameSchema.parse(options.presentation.read(kingdomId));
        if (frame.kingdomId !== kingdomId || frame.origin !== options.origin) return json(503, { version: 1, status: 'unavailable' });
        const response = json(200, frame);
        return response;
      } catch { return json(503, { version: 1, status: 'unavailable' }); }
    },
    close() { closed = true; },
  };
}

/** One literal read on the existing realm listener; the public gateway allowlists only this grammar. */
export function mountRaidChatRead(app: uWebSocketsTransport['app'], options: RaidChatReaderOptions) {
  const service = createRaidChatReader(options);
  app.get(RAID_CHAT_ROUTE, (response, request) => {
    const query = request.getQuery(), url = `http://realm.internal${request.getUrl()}${query ? `?${query}` : ''}`;
    const result = service.handle(new Request(url));
    let aborted = false;
    response.onAborted(() => { aborted = true; });
    void result.text().then(body => {
      if (aborted) return;
      response.cork(() => {
        response.writeStatus(`${result.status} ${result.status === 200 ? 'OK' : 'Unavailable'}`);
        result.headers.forEach((value, key) => response.writeHeader(key, value));
        response.end(body);
      });
    });
  });
  return service;
}
