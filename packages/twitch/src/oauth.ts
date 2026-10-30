import { TwitchIdSchema, TwitchLoginSchema } from '@chatdom/shared';
import { z } from 'zod';
import { TWITCH_ID_URL, ValidationSchema } from './app-token';
import { isTwitchFailure, TwitchRequestError } from './errors';
import { Secret } from './secret';
import { DEFAULT_TIMEOUT_MS, send, type FetchLike } from './transport';

export interface AuthorizeUrlInput {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly state: string;
  readonly idUrl?: string;
}

/**
 * The consent page for the authorization-code grant. `force_verify` makes Twitch show the consent screen
 * even for an existing grant, so the person can see which account they are signing in as.
 */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL('/oauth2/authorize', input.idUrl ?? TWITCH_ID_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', [...input.scopes].join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('force_verify', 'true');
  return url.toString();
}

const CodeTokenSchema = z.object({
  access_token: z.string().min(1).max(512),
  token_type: z.string().regex(/^bearer$/i),
});

/** What a completed consent proved. No token is part of it. */
export interface GrantIdentity {
  readonly clientId: string;
  readonly userId: string;
  readonly login: string;
  readonly scopes: readonly string[];
}

export interface ConfirmGrantInput {
  readonly clientId: string;
  readonly clientSecret: Secret;
  readonly code: Secret;
  readonly redirectUri: string;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly idUrl?: string;
}

/**
 * Exchanges an authorization code server-side and validates who granted what. The user's access and refresh
 * tokens exist only inside this call and are discarded on return. They are deliberately not revoked:
 * revoking would also remove the authorization the person just gave, which app-token reads rely on.
 */
export async function confirmGrant(input: ConfirmGrantInput): Promise<GrantIdentity> {
  const idUrl = input.idUrl ?? TWITCH_ID_URL;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let raw: unknown;
  try {
    ({ body: raw } = await send(input.fetch, {
      operation: 'authorization code exchange',
      method: 'POST',
      url: new URL('/oauth2/token', idUrl),
      form: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret.reveal(),
        code: input.code.reveal(),
        grant_type: 'authorization_code',
        redirect_uri: input.redirectUri,
      }),
      timeoutMs,
      signal: input.signal,
    }));
  } catch (error) {
    if (isTwitchFailure(error, 'forbidden') || isTwitchFailure(error, 'unauthorized')) throw new TwitchRequestError('credentials_rejected', 'authorization code exchange', error.status);
    throw error;
  }
  const exchanged = CodeTokenSchema.safeParse(raw);
  if (!exchanged.success) throw new TwitchRequestError('invalid_response', 'authorization code exchange');
  const access = new Secret(exchanged.data.access_token);

  const { body } = await send(input.fetch, {
    operation: 'validate user token',
    method: 'GET',
    url: new URL('/oauth2/validate', idUrl),
    headers: { Authorization: `OAuth ${access.reveal()}` },
    timeoutMs,
    signal: input.signal,
  });
  const validation = ValidationSchema.safeParse(body);
  if (!validation.success) throw new TwitchRequestError('invalid_response', 'validate user token');
  const userId = TwitchIdSchema.safeParse(validation.data.user_id);
  const login = TwitchLoginSchema.safeParse(validation.data.login);
  if (!userId.success || !login.success) throw new TwitchRequestError('invalid_response', 'validate user token');
  // The validation answer is authoritative; the exchange's own scope list is not trusted over it.
  const scopes = [...new Set(validation.data.scopes ?? [])].sort();
  return { clientId: validation.data.client_id, userId: userId.data, login: login.data, scopes };
}
