import type { IncomingMessage, ServerResponse } from 'node:http';
import { REALM_AUTH_ROUTES, type RealmApiError } from '@chatdom/shared/realm';
import { REALM_AUTH_LIMITS, RealmAuthError, type RealmAuthService } from './service';
import { sameText } from './secrets';

export interface RealmAuthHttpOptions {
  readonly service: RealmAuthService;
  /** Scheme, host and port the browser sees; the only origin allowed to POST. */
  readonly publicOrigin: string;
  /** `__Host-` prefixed Secure cookies everywhere except plain-HTTP loopback development. */
  readonly secureCookies: boolean;
  /** Enables `POST /internal/realm/revoke` with this bearer secret. Absent means the route does not exist. */
  readonly internalSecret?: string;
  /** Extra routes mounted first (the SIMULATED provider in simulation mode only). */
  readonly extra?: (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;
}

const BODY_LIMIT = 4_096;
export const INTERNAL_REVOKE_ROUTE = '/internal/realm/revoke';

/** Returns a request handler that answers the realm auth routes and reports whether it handled the request. */
export function createRealmAuthHttp(options: RealmAuthHttpOptions) {
  const { service, publicOrigin, secureCookies } = options;
  const sessionCookie = secureCookies ? '__Host-chatdom_session' : 'chatdom_session';
  const bindingCookie = secureCookies ? '__Host-chatdom_signin' : 'chatdom_signin';
  const cookie = (name: string, value: string, maxAgeSeconds: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureCookies ? '; Secure' : ''}`;

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://api.invalid');
    if (options.extra && await options.extra(request, response, url)) return true;
    const cookies = readCookies(request.headers.cookie);
    const handle = cookies.get(sessionCookie) ?? null;
    try {
      switch (url.pathname) {
        case REALM_AUTH_ROUTES.session: {
          allow(request, response, 'GET');
          const reply = await service.session(handle);
          json(response, 200, reply, reply.status === 'anonymous' && handle ? [cookie(sessionCookie, '', 0)] : []);
          return true;
        }
        case REALM_AUTH_ROUTES.start: {
          allow(request, response, 'GET');
          const { location, binding } = await service.start(url.searchParams.get('returnTo'));
          redirect(response, 302, location, [cookie(bindingCookie, binding, REALM_AUTH_LIMITS.attemptTtlMs / 1000)]);
          return true;
        }
        case REALM_AUTH_ROUTES.callback: {
          allow(request, response, 'GET');
          const result = await service.callback(url.searchParams, cookies.get(bindingCookie) ?? null, handle);
          redirect(response, 303, result.location, [cookie(bindingCookie, '', 0),
            ...(result.session ? [cookie(sessionCookie, result.session, REALM_AUTH_LIMITS.sessionTtlMs / 1000)] : [])]);
          return true;
        }
        case REALM_AUTH_ROUTES.ticket: {
          allow(request, response, 'POST'); sameOrigin(request, publicOrigin);
          const body = await readJson(request);
          json(response, 200, await service.ticket(handle, header(request, 'x-csrf-token'), publicOrigin, body));
          return true;
        }
        case REALM_AUTH_ROUTES.signout: {
          allow(request, response, 'POST'); sameOrigin(request, publicOrigin);
          json(response, 200, await service.signout(handle, header(request, 'x-csrf-token')), [cookie(sessionCookie, '', 0)]);
          return true;
        }
        case INTERNAL_REVOKE_ROUTE: {
          if (!options.internalSecret) return false;
          allow(request, response, 'POST');
          const bearer = header(request, 'authorization')?.replace(/^Bearer /, '') ?? '';
          if (!sameText(bearer, options.internalSecret)) throw new RealmAuthError('unauthenticated', 'Internal revocation needs the service credential');
          const body = await readJson(request) as { personId?: unknown; sessionId?: unknown; reason?: unknown } | null;
          const reason = body?.reason === 'moderated' ? 'moderated' : 'revoked';
          const target = typeof body?.personId === 'string' && /^[1-9][0-9]{0,31}$/.test(body.personId) ? { personId: body.personId }
            : typeof body?.sessionId === 'string' && /^[0-9a-f-]{36}$/.test(body.sessionId) ? { sessionId: body.sessionId } : null;
          if (!target) throw new RealmAuthError('refused', 'Name one personId or sessionId to revoke', 400);
          json(response, 200, { version: 1, status: 'revoked', sessions: await service.revoke(target, reason) });
          return true;
        }
        default:
          return false;
      }
    } catch (error) {
      const known = error instanceof RealmAuthError ? error
        : new RealmAuthError('unavailable', 'The sign-in service is unavailable right now. Nothing has changed; try again shortly.');
      if (!(error instanceof RealmAuthError)) console.error(`realm-auth: ${request.method} ${url.pathname} failed (${error instanceof Error ? error.name : 'unknown'})`);
      const reply: RealmApiError = { version: 1, status: known.status, message: known.message.slice(0, 240) };
      json(response, known.httpStatus, reply);
      return true;
    }
  };
}

function allow(request: IncomingMessage, response: ServerResponse, method: 'GET' | 'POST') {
  if (request.method === method) return;
  response.setHeader('Allow', method);
  throw new RealmAuthError('refused', `Use ${method} for this route`, 405);
}
/** Mutating routes accept only the public page's own origin; the CSRF token is checked by the service. */
function sameOrigin(request: IncomingMessage, publicOrigin: string) {
  if (header(request, 'origin') !== publicOrigin || header(request, 'sec-fetch-site') === 'cross-site') {
    throw new RealmAuthError('refused', 'This request did not come from your Chatdom page. Reload and try again.');
  }
}
function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
}
function readCookies(raw: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (raw ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) { const name = part.slice(0, at).trim(); if (!cookies.has(name)) cookies.set(name, part.slice(at + 1).trim()); }
  }
  return cookies;
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(header(request, 'content-type') ?? '')) throw new RealmAuthError('refused', 'Send this request as JSON', 400);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new RealmAuthError('refused', 'This request is too large', 400);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); }
  catch { throw new RealmAuthError('refused', 'This request is not valid JSON', 400); }
}
const COMMON = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Cookie' };
function json(response: ServerResponse, status: number, body: unknown, cookies: string[] = []) {
  response.writeHead(status, { ...COMMON, 'Content-Type': 'application/json; charset=utf-8', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
  response.end(JSON.stringify(body));
}
function redirect(response: ServerResponse, status: 302 | 303, location: string, cookies: string[]) {
  response.writeHead(status, { ...COMMON, Location: location, 'Set-Cookie': cookies });
  response.end();
}
