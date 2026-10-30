import { expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { readRealmAuthConfig } from './config';
import { authorizationUrl, twitchOidc, verifyIdToken, type OidcProvider } from './oidc';
import { approvedPublicName } from './presentation';
import { sha256 } from './secrets';
import { safeReturnPath } from './service';

const provider: OidcProvider = { ...twitchOidc('chatdom-client', 'not-a-real-secret') };

it('R4: only a fresh RS256 ID token from the issuer, for our client and this sign-in, names a person', async () => {
  const signer = await generateKeyPair('RS256'), stranger = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(signer.publicKey), kid: 'k1', alg: 'RS256' }] });
  const nonceHash = sha256('nonce-for-this-attempt');
  const now = Math.floor(Date.now() / 1000);
  const mint = (claims: JWTPayload = {}, options: { key?: CryptoKey; header?: Record<string, unknown> } = {}) =>
    new SignJWT({ iss: provider.issuer, aud: provider.clientId, sub: '12826', iat: now, exp: now + 600, nonce: 'nonce-for-this-attempt', preferred_username: 'Twitch', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1', ...options.header }).sign(options.key ?? signer.privateKey);
  const verify = (token: string) => verifyIdToken(token, { provider, keys, nonceHash });

  await expect(verify(await mint())).resolves.toEqual({ subject: '12826', preferredUsername: 'Twitch' });
  await expect(verify(await mint({ preferred_username: undefined }))).resolves.toEqual({ subject: '12826', preferredUsername: null });
  const refused = [
    await mint({ iss: 'https://evil.example/oauth2' }),
    await mint({ aud: 'another-client' }),
    await mint({ aud: [provider.clientId, 'another-client'] }), // several audiences need azp = us
    await mint({ azp: 'another-client' }),
    await mint({ nonce: 'nonce-from-another-sign-in' }),
    await mint({ nonce: undefined }),
    await mint({ exp: now - 120, iat: now - 720 }),
    await mint({ iat: now - 3600, exp: now + 600 }), // older than the sign-in window
    await mint({ sub: 'twitch-user' }),
    await mint({ sub: '0012' }),
    await mint({}, { key: stranger.privateKey }), // right kid, wrong signature
    `${(await mint()).split('.').slice(0, 2).join('.')}.`, // stripped signature
    [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), (await mint()).split('.')[1], ''].join('.'),
    await new SignJWT({ iss: provider.issuer, aud: provider.clientId, sub: '12826', iat: now, exp: now + 600, nonce: 'nonce-for-this-attempt' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' }).sign(new TextEncoder().encode('a shared secret anyone could guess, 32+ bytes')),
  ];
  for (const token of refused) await expect(verify(token)).rejects.toMatchObject({ name: 'OidcError', kind: 'rejected' });

  // The authorize request asks for openid only, with server-made state/nonce and the display-name claim.
  const url = new URL(authorizationUrl(provider, { redirectUri: 'http://localhost:5190/api/realm/auth/callback', state: 's'.repeat(43), nonce: 'n'.repeat(43) }));
  expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', scope: 'openid', claims: '{"id_token":{"preferred_username":null}}' });

  // Return destinations stay on kingdom pages; names lose control and direction overrides or fall back to anonymous.
  for (const path of [null, '/', '/tobi4s_', '/tobi4s_/throne', '/map', '/map/tobi4s_', '/-/realm']) expect(safeReturnPath(path)).not.toBeNull();
  for (const path of ['https://evil.example', '//evil.example', '/\\evil', '/tobi4s_?x=1', '/tobi4s_#x', '/Tobi/../x', `/${'a'.repeat(40)}`]) expect(safeReturnPath(path)).toBeNull();
  expect(approvedPublicName('Wren‮')).toBe('Wren');
  expect(approvedPublicName('⁦\u0007 ')).toBeNull();
  expect(approvedPublicName(null)).toBeNull();

  // Live mode has no bypass and SIMULATED mode cannot reach live data.
  const base = { DATABASE_URL: 'postgres://configured', TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'secret' };
  expect(readRealmAuthConfig(base)).toMatchObject({ mode: 'live', schema: 'realm', secureCookies: false, port: 5192, redirectUri: 'http://localhost:5190/api/realm/auth/callback' });
  expect(readRealmAuthConfig({ ...base, REALM_PUBLIC_ORIGIN: 'https://chatdom.gg' }).secureCookies).toBe(true);
  expect(() => readRealmAuthConfig({ DATABASE_URL: base.DATABASE_URL })).toThrow(/TWITCH_CLIENT_ID/);
  expect(() => readRealmAuthConfig({ ...base, DATABASE_URL: '' })).toThrow(/no in-memory fallback/);
  expect(() => readRealmAuthConfig({ ...base, REALM_DATABASE_SCHEMA: 'realm_simulated' })).toThrow(/simulated/);
  expect(() => readRealmAuthConfig({ ...base, REALM_AUTH_MODE: 'simulated', REALM_DATABASE_SCHEMA: 'realm' })).toThrow(/own schema/);
  expect(() => readRealmAuthConfig({ ...base, REALM_PUBLIC_ORIGIN: 'http://chatdom.gg' })).toThrow(/https/);
  expect(() => readRealmAuthConfig({ ...base, REALM_PUBLIC_ORIGIN: 'https://chatdom.gg/api' })).toThrow(/bare origin/);
});
