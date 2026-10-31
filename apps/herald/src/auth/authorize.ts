import {
  AppTokenSession, buildAuthorizeUrl, confirmGrant, type FetchLike, HelixReader, type HelixUser, Secret,
} from '@chatdom/twitch';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AUTHORIZE_CALLBACK_PORT, type HeraldConfig, isLocalCallback } from '../config';
import { describe } from './authority';
import { missingScopes, ROLE_SCOPES, type Role, scopesToRequest } from './grants';
import { type PageCopy, renderPage } from './page';

export const AUTHORIZE_DEADLINE_MS = 600_000;
const RESULT_PATH = '/chatdom-herald/result';
const MAX_FOREIGN_CALLBACKS = 20;

export type AuthorizeOutcome =
  | { readonly status: 'recorded'; readonly login: string; readonly scopes: readonly string[] }
  | { readonly status: 'not_ready'; readonly reasons: readonly string[] }
  | { readonly status: 'denied' }
  | { readonly status: 'wrong_account'; readonly expected: string }
  | { readonly status: 'wrong_client' }
  | { readonly status: 'missing_scopes'; readonly scopes: readonly string[] }
  | { readonly status: 'not_recorded' }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'expired' }
  | { readonly status: 'cancelled' };

export interface AuthorizeOptions {
  readonly config: HeraldConfig;
  readonly role: Role;
  readonly fetch: FetchLike;
  readonly print: (line: string) => void;
  /** Overrides the bind port; the redirect URI must still name 5195. Tests use 0. */
  readonly listenPort?: number;
  readonly onListening?: (port: number) => void;
  readonly deadlineMs?: number;
  /** How long the result page stays reachable after the callback. */
  readonly lingerMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * The interactive grant bootstrap. It asks one account for its Herald role's scopes plus every existing scope for this client, receives the
 * callback on loopback, checks single-use CSRF state, exchanges the code server-side and verifies the
 * client, the account and the scopes. The user tokens are discarded unrevoked; afterwards the grant is
 * confirmed the way the runtime will see it, through Get Authorization By User with the app token.
 * Nothing here prints a code, a token or a callback query, and nothing opens a browser on its own.
 */
export async function runAuthorize(options: AuthorizeOptions): Promise<AuthorizeOutcome> {
  const { config, role, print } = options;
  const expectedLogin = role === 'broadcaster' ? config.channelLogin : config.readerLogin;
  const reasons: string[] = [];
  if (!config.credentials) reasons.push(`TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be present in ${config.secretsFile}`);
  if (expectedLogin === null) reasons.push('HERALD_READER_LOGIN is not set: the Herald reader account has not been designated');
  if (config.redirectUri === null) reasons.push(`HERALD_REDIRECT_URI is not set: give the callback already registered for this app, http://localhost:${AUTHORIZE_CALLBACK_PORT}/<path>`);
  else if (!isLocalCallback(config.redirectUri)) reasons.push(`HERALD_REDIRECT_URI must be a registered http://localhost:${AUTHORIZE_CALLBACK_PORT}/<path> callback for this helper to receive it`);
  if (reasons.length > 0 || !config.credentials || expectedLogin === null || config.redirectUri === null) return { status: 'not_ready', reasons };

  const { clientId, clientSecret } = config.credentials;
  const redirectUri = config.redirectUri.toString();
  const callbackPath = config.redirectUri.pathname;
  const tokens = new AppTokenSession({ clientId, clientSecret, fetch: options.fetch });
  const helix = new HelixReader({ tokens, fetch: options.fetch });
  try {
    let account: HelixUser | undefined;
    let granted: readonly string[] = [];
    try {
      [account] = await helix.getUsers({ logins: [expectedLogin] });
      if (account) granted = (await helix.getAuthorizationByUser([account.id]))[0]?.scopes ?? [];
    } catch (error) {
      return { status: 'not_ready', reasons: [describe(error)] };
    }
    if (!account) return { status: 'not_ready', reasons: [`${expectedLogin} is not a Twitch account`] };
    const expected = account;

    const requested = scopesToRequest(role, granted);
    const state = randomBytes(32).toString('base64url');
    const consentUrl = buildAuthorizeUrl({ clientId, redirectUri, scopes: requested, state });

    const outcome = await new Promise<AuthorizeOutcome>(resolve => {
      let consumed = false;
      let foreign = 0;
      let result: AuthorizeOutcome | null = null;
      let linger: ReturnType<typeof setTimeout> | null = null;
      const deadline = setTimeout(() => finish({ status: 'expired' }), options.deadlineMs ?? AUTHORIZE_DEADLINE_MS);
      const onAbort = () => finish({ status: 'cancelled' });
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const server = createServer((request, response) => {
        void handle(request, response).catch(() => {
          if (!response.headersSent) page(response, 500, { tone: 'stopped', title: 'Something went wrong', body: 'Herald could not finish this step.' });
          finish({ status: 'failed', reason: 'callback handling failed (details withheld)' });
        });
      });

      function finish(value: AuthorizeOutcome, keepResultPage = false): void {
        if (result === null) result = value;
        clearTimeout(deadline);
        options.signal?.removeEventListener('abort', onAbort);
        if (keepResultPage && linger === null) {
          linger = setTimeout(close, options.lingerMs ?? 15_000);
          linger.unref?.();
        } else if (!keepResultPage) close();
      }
      let closed = false;
      function close(): void {
        if (linger) clearTimeout(linger);
        if (!closed) {
          closed = true;
          if (server.listening) server.close();
          server.closeAllConnections();
        }
        if (result) resolve(result);
      }

      async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (request.method === 'GET' && url.pathname === RESULT_PATH && consumed && result) {
          response.once('finish', close);
          page(response, 200, copyFor(result, expected.login));
          return;
        }
        if (request.method !== 'GET' || url.pathname !== callbackPath) {
          page(response, 404, { tone: 'stopped', title: 'Nothing here', body: 'This address only answers the Twitch sign-in for Herald.' });
          return;
        }
        if (consumed) {
          page(response, 410, { tone: 'stopped', title: 'Already used', body: 'This sign-in request has already been completed. Start a new one from the terminal.' });
          return;
        }
        if (!sameState(url.searchParams.get('state'), state)) {
          foreign += 1;
          page(response, 400, { tone: 'stopped', title: 'Not this request', body: 'This link does not belong to the sign-in Herald is waiting for. Use the address printed in the terminal.' });
          if (foreign >= MAX_FOREIGN_CALLBACKS) finish({ status: 'failed', reason: 'too many callbacks that did not match this request' });
          return;
        }
        consumed = true;
        const code = url.searchParams.get('code');
        let value: AuthorizeOutcome;
        if (url.searchParams.has('error')) value = url.searchParams.get('error') === 'access_denied' ? { status: 'denied' } : { status: 'failed', reason: 'Twitch reported the consent did not complete' };
        else if (!code) value = { status: 'failed', reason: 'Twitch returned without an authorization code' };
        else value = await verify(new Secret(code));
        finish(value, true);
        response.writeHead(303, { Location: RESULT_PATH, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        response.end();
      }

      async function verify(code: Secret): Promise<AuthorizeOutcome> {
        try {
          const identity = await confirmGrant({ clientId, clientSecret, code, redirectUri, fetch: options.fetch });
          if (identity.clientId !== clientId) return { status: 'wrong_client' };
          if (identity.userId !== expected.id) return { status: 'wrong_account', expected: expected.login };
          const missing = missingScopes(identity.scopes, ROLE_SCOPES[role]);
          if (missing.length > 0) return { status: 'missing_scopes', scopes: missing };
          const [recorded] = await helix.getAuthorizationByUser([expected.id]);
          if (!recorded?.hasAuthorized || missingScopes(recorded.scopes, ROLE_SCOPES[role]).length > 0) return { status: 'not_recorded' };
          return { status: 'recorded', login: expected.login, scopes: recorded.scopes };
        } catch (error) {
          return { status: 'failed', reason: describe(error) };
        }
      }

      server.on('error', error => {
        const busy = (error as { code?: unknown }).code === 'EADDRINUSE';
        finish({ status: 'not_ready', reasons: [busy ? `port ${AUTHORIZE_CALLBACK_PORT} is already in use on this machine` : 'the local callback could not be opened'] });
      });
      server.listen(options.listenPort ?? AUTHORIZE_CALLBACK_PORT, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port;
        print(`Herald authorization · ${role} account ${expected.login}`);
        print(`Requests only: ${requested.join(' ')}`);
        print('');
        print(`1. Open this address in a browser signed in to Twitch as ${expected.login}:`);
        print(`   ${consentUrl}`);
        print(`2. Twitch returns to ${redirectUri}; this helper listens on 127.0.0.1:${port}.`);
        print(`   From another computer, forward the port first: ssh -L ${AUTHORIZE_CALLBACK_PORT}:127.0.0.1:${AUTHORIZE_CALLBACK_PORT} <this host>`);
        print(`Waiting up to ${Math.round((options.deadlineMs ?? AUTHORIZE_DEADLINE_MS) / 60_000)} minutes. Ctrl-C cancels.`);
        options.onListening?.(port);
      });
    });
    return outcome;
  } finally {
    tokens.close();
  }
}

function sameState(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function page(response: ServerResponse, status: number, copy: PageCopy): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(renderPage(copy));
}

function copyFor(outcome: AuthorizeOutcome, login: string): PageCopy {
  switch (outcome.status) {
    case 'recorded': return { tone: 'done', title: 'Herald can listen now', body: `Twitch recorded the grant for ${login}. Herald keeps no token from this sign-in.` };
    case 'denied': return { tone: 'stopped', title: 'Not approved', body: 'The request was declined on Twitch. Nothing was granted.' };
    case 'wrong_account': return { tone: 'stopped', title: 'A different account signed in', body: `This step needs ${outcome.expected}. Sign out of Twitch, then start again from the terminal.` };
    case 'missing_scopes': return { tone: 'stopped', title: 'Some permissions are missing', body: 'Twitch recorded fewer permissions than Herald asked for. Start again from the terminal.' };
    default: return { tone: 'stopped', title: 'Not finished', body: 'Herald could not confirm the grant. The terminal explains what happened.' };
  }
}
