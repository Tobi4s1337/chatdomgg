import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { FORGE_LEDGER_LIMITS, FORGE_LEDGER_ROUTE, KingdomIdSchema, type ForgeLedgerView, type KingdomId } from '@chatdom/shared';
import type { RealmPrivateState } from '@chatdom/shared/realm';
import { FoundedUnavailableError } from '../founded/load';
import { forgeLedgerView } from './projection';

/** What the ledger needs from the realm: a kingdom's committed state, read without ever writing. */
export interface ForgeLedgerSource {
  /** The state of a kingdom already open in this process, or undefined. */
  open(kingdomId: KingdomId): { readonly privateState: RealmPrivateState; readonly current: boolean } | undefined;
  /** Hold a kingdom briefly to read it (the same retained registry the founded reader uses). */
  retain(kingdomId: KingdomId): Promise<{ readonly kingdom: { readonly privateState: RealmPrivateState; readonly current: boolean }; release(): Promise<void> }>;
}

export interface ForgeLedgerHttpReply { readonly http: 200 | 400 | 404 | 503; readonly body: unknown }
const error = (http: 400 | 404 | 503, message: string): ForgeLedgerHttpReply => ({ http, body: { version: 1, status: 'error', message } });

/**
 * Public and read-only. Anyone may read a kingdom's ledger; it holds nothing private (see `projection.ts`).
 * Repeated reads of one kingdom share one answer for `FORGE_LEDGER_LIMITS.cacheMs`, so a panel full of viewers
 * never opens a resting kingdom more than once in that window.
 */
export function createForgeLedgerHandler(source: ForgeLedgerSource, options: { readonly now?: () => number; readonly cacheMs?: number } = {}) {
  const now = options.now ?? Date.now, cacheMs = options.cacheMs ?? FORGE_LEDGER_LIMITS.cacheMs;
  const cache = new Map<KingdomId, { readonly until: number; readonly reply: Promise<ForgeLedgerHttpReply> }>();

  async function read(kingdomId: KingdomId): Promise<ForgeLedgerHttpReply> {
    const open = source.open(kingdomId);
    if (open?.current) return { http: 200, body: forgeLedgerView(open.privateState, now()) satisfies ForgeLedgerView };
    let hold: Awaited<ReturnType<ForgeLedgerSource['retain']>>;
    try { hold = await source.retain(kingdomId); }
    catch (cause) {
      if (cause instanceof FoundedUnavailableError && cause.reason === 'unfounded') return error(404, 'This kingdom has no forge yet.');
      return error(503, 'The forge’s memory cannot be read just now.');
    }
    try {
      if (!hold.kingdom.current) return error(503, 'The forge’s memory cannot be read just now.');
      return { http: 200, body: forgeLedgerView(hold.kingdom.privateState, now()) };
    } finally { await hold.release().catch(() => {}); }
  }

  return (query: string): Promise<ForgeLedgerHttpReply> => {
    const params = new URLSearchParams(query);
    const kingdomId = KingdomIdSchema.safeParse(params.get('kingdomId'));
    if (!kingdomId.success || [...params.keys()].some(key => key !== 'kingdomId') || params.getAll('kingdomId').length !== 1)
      return Promise.resolve(error(400, 'This ledger request could not be read.'));
    const at = now();
    for (const [key, entry] of cache) if (entry.until <= at) cache.delete(key);
    const cached = cache.get(kingdomId.data);
    if (cached) return cached.reply;
    const reply = read(kingdomId.data).catch(() => error(503, 'The forge’s memory cannot be read just now.'));
    // Only answers worth repeating are kept; a passing failure is asked again next time.
    cache.set(kingdomId.data, { until: at + cacheMs, reply });
    void reply.then(answer => { if (answer.http === 503 && cache.get(kingdomId.data)?.reply === reply) cache.delete(kingdomId.data); });
    return reply;
  };
}

type App = uWebSocketsTransport['app'];
const STATUS = { 200: '200 OK', 400: '400 Bad Request', 404: '404 Not Found', 503: '503 Service Unavailable' } as const;

export function mountForgeLedgerRoutes(app: App, source: ForgeLedgerSource): void {
  const handle = createForgeLedgerHandler(source);
  app.get(FORGE_LEDGER_ROUTE, (response, request) => {
    let aborted = false;
    response.onAborted(() => { aborted = true; });
    const query = request.getQuery() ?? '';
    const send = (reply: ForgeLedgerHttpReply) => {
      if (aborted) return;
      response.cork(() => {
        response.writeStatus(STATUS[reply.http])
          .writeHeader('Cache-Control', reply.http === 200 ? `public, max-age=${Math.floor(FORGE_LEDGER_LIMITS.cacheMs / 1000)}` : 'no-store')
          .writeHeader('Referrer-Policy', 'no-referrer').writeHeader('X-Content-Type-Options', 'nosniff')
          .writeHeader('Access-Control-Allow-Origin', '*')
          .writeHeader('Content-Type', 'application/json').end(JSON.stringify(reply.body));
      });
    };
    void handle(query).then(send, () => send(error(503, 'The forge’s memory cannot be read just now.')));
  });
}

/** The realm's own registry as a ledger source. */
export function forgeLedgerSource(services: { readonly kingdoms: ReadonlyMap<KingdomId, { readonly privateState: RealmPrivateState; readonly current: boolean }>;
  retain(kingdomId: KingdomId): Promise<{ readonly kingdom: { readonly privateState: RealmPrivateState; readonly current: boolean }; release(): Promise<void> }> }): ForgeLedgerSource {
  return { open: kingdomId => services.kingdoms.get(kingdomId), retain: kingdomId => services.retain(kingdomId) };
}
