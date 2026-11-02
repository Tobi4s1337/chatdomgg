/**
 * Composition for main: the Raid Gate on the shared realm pool and realm-auth sessions, served from the API's node
 * HTTP server. Main supplies the pool, this deployment's origin and sign-in issuer, the session cookie name and the
 * four policy ports; everything else is built here.
 *
 *   const gate = createRaidGateService({ pool, origin, issuer: provider.issuer, sessionCookie, publicOrigin,
 *     origins: [publicOrigin], clock: Date.now, policyPorts: { live, grants, consent, directory }, raids, roads, rooms, items });
 *   if (gate.matches(request.url)) return gate.serve(request, response);
 *   // main's verified EventSub ingress, for each channel.raid it correlated (or not) to a gate request:
 *   await gate.application.ingestRaid({ raid, upstreamEventId, actionRequestId, receivedAt });
 */
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { KingdomId } from '../../../../packages/shared/src/identity';
import { createRaidTravelCoordinator, type RaidTravelCoordinator } from '../../../realm/src/raid-gate/coordinator';
import type { RealmTravelTransport, TravelRecovery } from '../../../realm/src/raid-gate/ports';
import { createArrivalWitness } from '../../../realm/src/raid-gate/arrivals';
import { createPostgresTravelRepository } from '../../../realm/src/raid-gate/postgres-repository';
import { createRaidGateApplication, createRaidMarchCheck, type RaidGateApplication } from './application';
import { createRealmGiftHosts } from './gift-hosts';
import { createPostgresItemTransfers, type ItemRows } from './gift-postgres';
import { createVisitorGifts } from './gifts';
import { createPolledGateFanout } from './gate-changes';
import { createGateFanout, createRaidGateHttp, type RaidGateHttp } from './http';
import { createRealmGatePolicy, type LiveChannels, type RaidGrants, type TargetDirectory, type WriteConsent } from './policy';
import type { AtlasRoadIngress, AuthorizedRaidTransport, PreviewTokens, RaidGateRecovery } from './ports';
import { createPostgresRaidGateRepository, type SqlPool } from './postgres-repository';
import type { RecordOrigin } from './repository';
import { createRealmSessionAuthenticator, gateKingdomFromPath, kingdomFromGatePath, type SqlQueryable } from './session';

export const RAID_GATE_PATH = '/api/raid-gate';

export type RaidGateServiceDeps = Readonly<{
  /** The realm pool (`pg.Pool` with the realm schema on its search path). Main owns and ends it. */
  pool: SqlPool & SqlQueryable;
  origin: RecordOrigin;
  /** realm-auth's `provider.issuer` for this deployment. */
  issuer: string;
  /** realm-auth's session cookie name. */
  sessionCookie: string;
  /** The page origin the browser sees, for example `https://chatdom.gg`. */
  publicOrigin: string;
  /** Web origins allowed to call the gate; usually `[publicOrigin]`. */
  origins: readonly string[];
  clock: () => number;
  policyPorts: Readonly<{ live: LiveChannels; grants: RaidGrants; consent: WriteConsent; directory: TargetDirectory }>;
  /** The source broadcaster's authorized Start/Cancel a Raid transport. Absent: the gate gathers but cannot start. */
  raids?: AuthorizedRaidTransport | null;
  /** The Atlas's road ingestion. Absent: witnessed raids wait in the outbox until it is bound. */
  roads?: AtlasRoadIngress | null;
  /** The realm's room membership transport. Absent: travel commands answer `unavailable`. */
  rooms?: RealmTravelTransport | null;
  /**
   * Main's item rows on the gift transaction's client (`gift-postgres.ts` states the contract). Absent: the welcome and
   * gifts answer `unavailable`; travel is unaffected.
   */
  items?: ItemRows | null;
  /** How often recovery runs (reconcile, resend the provably unsent, retry roads, mark overdue). 0 turns it off. */
  recoverEveryMs?: number;
  /** Told about a recovery pass that did something, or failed. */
  onRecovery?: (outcome: Readonly<{ kind: 'report'; report: RaidGateRecovery & Partial<TravelRecovery> }> | Readonly<{ kind: 'error'; error: unknown }>) => void;
  pathPrefix?: string;
  tokens?: PreviewTokens;
  heartbeatMs?: number;
  /**
   * How often watched gates are reread from storage, so a landing the realm committed reaches open streams here.
   * 0 turns it off (a single-process test).
   */
  changePollMs?: number;
}>;

export const RAID_GATE_RECOVER_EVERY_MS = 15_000;
const RECOVERY_PAGE = 50;

export interface RaidGateService {
  readonly http: RaidGateHttp;
  readonly application: RaidGateApplication;
  /** The travel coordinator, when the realm's rooms are bound. */
  readonly travel: RaidTravelCoordinator | null;
  /** True for `${pathPrefix}/<kingdomId>` with or without a query, from a node request's `url`. */
  matches(url: string | undefined): boolean;
  /** Answers one node request end to end, streaming the live gate and ending it when the client leaves. */
  serve(request: IncomingMessage, response: ServerResponse): Promise<void>;
  /** One recovery pass now (the gate, then journeys); the timer runs the same thing. */
  recover(): Promise<RaidGateRecovery & Partial<TravelRecovery>>;
  /** Ends every open stream and the recovery timer. The pool is main's. */
  close(): void;
}

/** 256-bit random preview tokens in hex (always a valid opaque token), stored only as their SHA-256 hex. */
export function createPreviewTokens(): PreviewTokens {
  return {
    issue: () => randomBytes(32).toString('hex'),
    hash: async value => createHash('sha256').update(value, 'utf8').digest('hex'),
  };
}

/** The path of a node request URL (`/api/raid-gate/41?request=r1`), or null when it is not origin-form. */
function pathOf(url: string | undefined): string | null {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return null;
  const end = url.search(/[?#]/);
  return end < 0 ? url : url.slice(0, end);
}

/**
 * A web `Request` for a node request. The URL is rebuilt on `publicOrigin` from the origin-form path only, so a Host
 * header or an absolute-form target cannot change it. The signal aborts when the client goes away before the
 * response finished, which ends a live gate stream and its listener.
 */
export function toWebRequest(request: IncomingMessage, response: ServerResponse, publicOrigin: string): Request {
  const path = request.url && request.url.startsWith('/') && !request.url.startsWith('//') ? request.url : '/';
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const each of Array.isArray(value) ? value : [value]) headers.append(name, each);
  }
  const life = new AbortController();
  const gone = () => { if (!response.writableFinished) life.abort(new Error('The client closed the connection.')); };
  response.once('close', gone);
  const method = request.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? null : Readable.toWeb(request) as ReadableStream<Uint8Array>;
  return new Request(new URL(path, publicOrigin), {
    method, headers, signal: life.signal, ...(body ? { body, duplex: 'half' } : {}),
  } as RequestInit);
}

/** Writes a web `Response` to node, streaming its body with backpressure and cancelling it if the client leaves. */
export async function writeWebResponse(source: Response, response: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  source.headers.forEach((value, name) => { if (name !== 'set-cookie') headers[name] = value; });
  const cookies = source.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  headers['x-content-type-options'] = 'nosniff';
  response.writeHead(source.status, headers);
  if (!source.body) { response.end(); return; }
  response.flushHeaders();
  const reader = source.body.getReader();
  const closed = new Promise<void>(resolve => response.once('close', resolve));
  void closed.then(() => { if (!response.writableFinished) void reader.cancel().catch(() => undefined); });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (response.destroyed) return;
      if (!response.write(value)) await Promise.race([new Promise<void>(resolve => response.once('drain', resolve)), closed]);
    }
    response.end();
  } catch {
    response.destroy();
  }
}

export function createRaidGateService(deps: RaidGateServiceDeps): RaidGateService {
  const prefix = deps.pathPrefix ?? RAID_GATE_PATH;
  const kingdomOf: (request: Request) => KingdomId | null = gateKingdomFromPath(prefix);
  const publicOrigin = new URL(deps.publicOrigin).origin;
  const repository = createPostgresRaidGateRepository({ pool: deps.pool });
  const policy = createRealmGatePolicy({ pool: deps.pool, origin: deps.origin, issuer: deps.issuer, ...deps.policyPorts });
  const fanout = createPolledGateFanout(createGateFanout(), {
    pool: deps.pool, ...(deps.changePollMs === undefined ? {} : { everyMs: deps.changePollMs }),
    onError: error => deps.onRecovery?.({ kind: 'error', error }),
  });
  const travel = deps.rooms ? createRaidTravelCoordinator({
    repository: createPostgresTravelRepository({ pool: deps.pool }), rooms: deps.rooms, marches: createRaidMarchCheck(repository),
    origin: deps.origin, clock: deps.clock,
  }) : null;
  const application = createRaidGateApplication({
    repository, policy, tokens: deps.tokens ?? createPreviewTokens(), notifier: fanout, origin: deps.origin, clock: deps.clock,
    raids: deps.raids ?? null, roads: deps.roads ?? null, travel,
    gifts: deps.items ? createVisitorGifts({
      items: createPostgresItemTransfers({ pool: deps.pool, origin: deps.origin, items: deps.items }),
      arrivals: createArrivalWitness({ repository: createPostgresTravelRepository({ pool: deps.pool }), origin: deps.origin }),
      hosts: createRealmGiftHosts({ pool: deps.pool, origin: deps.origin }),
      origin: deps.origin,
    }) : null,
  });
  const http = createRaidGateHttp({
    application, changes: fanout, clock: deps.clock, origins: deps.origins,
    authenticate: createRealmSessionAuthenticator({ pool: deps.pool, origin: deps.origin, sessionCookie: deps.sessionCookie, kingdomOf }),
    ...(deps.heartbeatMs === undefined ? {} : { heartbeatMs: deps.heartbeatMs }),
  });

  let recovering: Promise<RaidGateRecovery & Partial<TravelRecovery>> | null = null;
  const pass = async () => {
    const gate = await application.recover(deps.clock(), RECOVERY_PAGE);
    return travel ? { ...gate, ...await travel.recover(deps.clock(), RECOVERY_PAGE) } : gate;
  };
  const recover = () => recovering ??= pass().finally(() => { recovering = null; });
  const every = deps.recoverEveryMs ?? RAID_GATE_RECOVER_EVERY_MS;
  const tick = () => {
    recover().then(report => {
      if (Object.values(report).some(count => count > 0)) deps.onRecovery?.({ kind: 'report', report });
    }, error => deps.onRecovery?.({ kind: 'error', error }));
  };
  const timer = every > 0 ? setInterval(tick, every) : null;
  timer?.unref?.();
  // A restart picks up whatever the last process left half-done.
  if (timer) queueMicrotask(tick);

  return {
    http, application, travel, recover,
    matches(url) {
      const path = pathOf(url);
      return path !== null && kingdomFromGatePath(prefix, path) !== null;
    },
    async serve(request, response) {
      await writeWebResponse(await http.handle(toWebRequest(request, response, publicOrigin)), response);
    },
    close: () => { if (timer) clearInterval(timer); fanout.close(); http.close(); },
  };
}
