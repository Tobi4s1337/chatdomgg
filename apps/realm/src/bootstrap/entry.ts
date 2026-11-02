import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { REALM_ENTRY_ROUTE, RealmEntryInfoSchema } from '@chatdom/shared/realm';
import { FoundedReadError, type createFoundedReader, type FoundedReadRequest } from './founded';

/** Names are explicitly approved by this host; URL parameters and settlement seeds never supply a title. */
export function mountEntryRoutes(
  app: uWebSocketsTransport['app'],
  founded: Pick<ReturnType<typeof createFoundedReader>, 'manifest'>,
  origin: 'live' | 'simulated',
  names: ReadonlyMap<KingdomId, string>,
) {
  const read = async (rawKingdomId: string, request: FoundedReadRequest) => {
    const parsed = KingdomIdSchema.safeParse(rawKingdomId);
    if (!parsed.success) throw new FoundedReadError(400, 'The kingdom identifier is invalid.');
    const kingdomId = parsed.data, name = names.get(kingdomId);
    // A kingdom this host has not approved for walking in is not here for visitors: the gate says the road leads nowhere.
    if (name === undefined) throw new FoundedReadError(404, 'No kingdom with this address is open to visitors.');
    const info = RealmEntryInfoSchema.safeParse({ version: 1, kingdomId, origin, name });
    if (!info.success) throw new FoundedReadError(503, 'This kingdom entry name is unavailable.');
    const manifest = await founded.manifest(kingdomId, request);
    if (manifest.kingdomId !== kingdomId || manifest.origin !== origin) throw new FoundedReadError(503, 'This kingdom entry is unavailable.');
    return info.data;
  };
  const statuses = { 400: '400 Bad Request', 403: '403 Forbidden', 404: '404 Not Found', 503: '503 Service Unavailable' } as const;
  app.get(REALM_ENTRY_ROUTE, (res, req) => {
    const kingdomId = req.getParameter(0) ?? '';
    const request: FoundedReadRequest = { authorization: req.getHeader('authorization'), cookie: req.getHeader('cookie'), origin: req.getHeader('origin') };
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    const reply = (status: string, body: unknown) => {
      if (aborted) return;
      res.cork(() => {
        res.writeStatus(status).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
          .writeHeader('X-Content-Type-Options', 'nosniff').end(JSON.stringify(body));
      });
    };
    void read(kingdomId, request).then(info => reply('200 OK', info), error => {
      const failure = error instanceof FoundedReadError ? error : new FoundedReadError(503, 'This kingdom entry is unavailable.');
      reply(statuses[failure.status], { version: 1, status: 'unavailable', message: failure.message });
    });
  });
}
