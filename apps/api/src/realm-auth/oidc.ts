import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { TwitchIdSchema } from '@chatdom/shared';
import { sameHash, sha256 } from './secrets';

/**
 * An OpenID provider the API trusts for sign-in. Live mode only ever uses `twitchOidc`, whose endpoints are
 * constants; the SIMULATED provider is injected explicitly by simulation/test composition and marks every
 * person it vouches for as simulated.
 */
export interface OidcProvider {
  readonly origin: 'live' | 'simulated';
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export const TWITCH_OIDC_ISSUER = 'https://id.twitch.tv/oauth2';
export function twitchOidc(clientId: string, clientSecret: string): OidcProvider {
  if (!clientId || !clientSecret) throw new Error('Twitch sign-in needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the ignored environment configuration');
  return {
    origin: 'live', issuer: TWITCH_OIDC_ISSUER, clientId, clientSecret,
    authorizationEndpoint: 'https://id.twitch.tv/oauth2/authorize',
    tokenEndpoint: 'https://id.twitch.tv/oauth2/token',
    jwksUri: 'https://id.twitch.tv/oauth2/keys',
  };
}

/** Keep this openid-only flow separate. If API scopes are ever added, first union the existing
 * client/user grant (as Herald does); expanded consent must never narrow another feature’s grant.
 * `openid` only: no Twitch API rights. The display name is requested as an ID-token claim, not a scope. */
export function authorizationUrl(provider: OidcProvider, request: { redirectUri: string; state: string; nonce: string }): string {
  const url = new URL(provider.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: provider.clientId, redirect_uri: request.redirectUri, scope: 'openid',
    state: request.state, nonce: request.nonce, claims: JSON.stringify({ id_token: { preferred_username: null } }),
  }).toString();
  return url.toString();
}

const TokenReplySchema = z.object({ id_token: z.string().min(16).max(16_384) });

/**
 * Exchanges the one-use code for the ID token and drops everything else in the reply: Twitch access and refresh
 * tokens never leave this function, are never stored and are never logged.
 */
export async function exchangeCode(provider: OidcProvider, request: { code: string; redirectUri: string }, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(provider.tokenEndpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: provider.clientId, client_secret: provider.clientSecret, code: request.code,
      grant_type: 'authorization_code', redirect_uri: request.redirectUri,
    }),
  });
  if (!response.ok) throw new OidcError(response.status >= 500 ? 'unavailable' : 'rejected', 'The identity provider refused the sign-in code');
  const reply = TokenReplySchema.safeParse(await response.json().catch(() => null));
  if (!reply.success) throw new OidcError('rejected', 'The identity provider returned no ID token');
  return reply.data.id_token;
}

export interface VerifiedIdentity {
  /** Verified subject. For Twitch this is the user ID, which is also the Chatdom `PersonId`. */
  readonly subject: string;
  /** Provider-supplied display name, still unapproved. */
  readonly preferredUsername: string | null;
}

/**
 * Production ID-token verification, shared by live and SIMULATED providers: signature against the provider's
 * keys, RS256 only, exact issuer, our client as audience (and authorised party), fresh expiry/issue time, and the
 * nonce bound to this browser's sign-in attempt (compared by hash; the plain nonce is never stored).
 */
export async function verifyIdToken(idToken: string, options: { provider: OidcProvider; keys: JWTVerifyGetKey; nonceHash: Buffer; currentDate?: Date }): Promise<VerifiedIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, options.keys, {
      issuer: options.provider.issuer, audience: options.provider.clientId, algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat', 'nonce'], clockTolerance: 30, maxTokenAge: '15m',
      ...(options.currentDate ? { currentDate: options.currentDate } : {}),
    }));
  } catch {
    throw new OidcError('rejected', 'The ID token did not verify');
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if ((audiences.length > 1 || payload.azp !== undefined) && payload.azp !== options.provider.clientId) throw new OidcError('rejected', 'The ID token was issued to another client');
  if (typeof payload.nonce !== 'string' || !sameHash(sha256(payload.nonce), options.nonceHash)) throw new OidcError('rejected', 'The ID token belongs to another sign-in');
  const subject = TwitchIdSchema.safeParse(payload.sub);
  if (!subject.success) throw new OidcError('rejected', 'The ID token names no valid person');
  const name = payload.preferred_username;
  return { subject: subject.data, preferredUsername: typeof name === 'string' ? name : null };
}

export class OidcError extends Error {
  constructor(readonly kind: 'rejected' | 'unavailable', message: string) { super(message); this.name = 'OidcError'; }
}
