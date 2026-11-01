import { SignJWT, UnsecuredJWT, type JWTPayload } from 'jose';
import { describe, expect, it } from 'vitest';
import { extensionKey, PanelTokenError, verifyPanelToken } from './token';

// Extension secrets from the console are base64; these are fixed test bytes, never a real secret.
const SECRET = Buffer.alloc(32, 7).toString('base64');
const OTHER_SECRET = Buffer.alloc(32, 9).toString('base64');
const key = extensionKey(SECRET);
const now = () => Math.floor(Date.now() / 1000);

/** Mints a token the way Twitch does for a panel view (HS256 with the extension secret) unless told otherwise. */
function mint(claims: JWTPayload, options: { secret?: string; alg?: string; exp?: number | null } = {}) {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: options.alg ?? 'HS256' });
  if (options.exp !== null) jwt.setExpirationTime(options.exp ?? now() + 3600);
  return jwt.sign(extensionKey(options.secret ?? SECRET));
}
/** A copy of `claims` with one claim left out. */
const without = (claims: JWTPayload, name: string) => Object.fromEntries(Object.entries(claims).filter(([key]) => key !== name));
const bearer = async (claims: JWTPayload, options?: Parameters<typeof mint>[1]) => `Bearer ${await mint(claims, options)}`;

const ANONYMOUS = { channel_id: '1001', opaque_user_id: 'ARQwPIYx2nM', role: 'viewer' };
const UNSHARED = { channel_id: '1001', opaque_user_id: 'UVvQ2HwX1M8', role: 'viewer' };
const SHARED = { channel_id: '1001', opaque_user_id: 'UVvQ2HwX1M8', user_id: '2002', role: 'viewer' };

async function refusal(authorization: string | null): Promise<string> {
  try { await verifyPanelToken(authorization, key); } catch (error) {
    expect(error).toBeInstanceOf(PanelTokenError);
    return (error as Error).message;
  }
  throw new Error('expected the token to be refused');
}

describe('extensionKey', () => {
  it('decodes the base64 console secret into the HMAC key', () => {
    expect(Buffer.from(extensionKey(SECRET))).toEqual(Buffer.alloc(32, 7));
  });

  it('refuses a secret too short to be the console\'s, without repeating it', () => {
    for (const secret of ['', 'c2hvcnQ=', 'not-a-secret', Buffer.alloc(15, 1).toString('base64')]) {
      expect(() => extensionKey(secret)).toThrow('TWITCH_EXTENSION_SECRET must be the base64 secret from the extension console');
    }
  });
});

describe('verifyPanelToken', () => {
  it('reads a logged-out viewer as anonymous', async () => {
    expect(await verifyPanelToken(await bearer(ANONYMOUS), key)).toEqual({ channelId: '1001', role: 'viewer', kind: 'anonymous' });
  });

  it('reads a logged-in viewer who has not shared who they are as unshared, never as a person', async () => {
    const viewer = await verifyPanelToken(await bearer(UNSHARED), key);
    expect(viewer).toEqual({ channelId: '1001', role: 'viewer', kind: 'unshared' });
    expect(JSON.stringify(viewer)).not.toContain('UVvQ2HwX1M8');
  });

  it('reads a viewer who shared their identity as that person', async () => {
    expect(await verifyPanelToken(await bearer(SHARED), key)).toEqual({ channelId: '1001', role: 'viewer', kind: 'shared', personId: '2002' });
    expect(await verifyPanelToken(await bearer({ ...SHARED, user_id: '1001', role: 'broadcaster' }), key))
      .toEqual({ channelId: '1001', role: 'broadcaster', kind: 'shared', personId: '1001' });
  });

  it('treats a malformed user id as not shared, and a missing role as a viewer', async () => {
    expect(await verifyPanelToken(await bearer({ ...SHARED, user_id: 'U2002' }), key)).toMatchObject({ kind: 'unshared' });
    expect(await verifyPanelToken(await bearer({ ...SHARED, user_id: 2002 }), key)).toMatchObject({ kind: 'unshared' });
    expect(await verifyPanelToken(await bearer(without(ANONYMOUS, 'role')), key)).toEqual({ channelId: '1001', role: 'viewer', kind: 'anonymous' });
  });

  it('refuses an expired token, allowing half a minute of clock skew', async () => {
    expect(await refusal(await bearer(SHARED, { exp: now() - 120 }))).toBe('The Twitch panel token expired');
    expect(await verifyPanelToken(await bearer(SHARED, { exp: now() - 10 }), key)).toMatchObject({ kind: 'shared' });
  });

  it('refuses a token signed with another key or another algorithm', async () => {
    expect(await refusal(await bearer(SHARED, { secret: OTHER_SECRET }))).toBe('The Twitch panel token did not verify');
    expect(await refusal(await bearer(SHARED, { alg: 'HS512' }))).toBe('The Twitch panel token did not verify');
    const unsigned = new UnsecuredJWT(SHARED).setExpirationTime(now() + 3600).encode();
    expect(await refusal(`Bearer ${unsigned}`)).toBe('The Twitch panel token did not verify');
    // A genuine signature over someone else's claims: the viewer swapped for another person.
    const [header, , signature] = (await mint(SHARED)).split('.');
    const forged = Buffer.from(JSON.stringify({ ...SHARED, user_id: '3003', exp: now() + 3600 })).toString('base64url');
    expect(await refusal(`Bearer ${header}.${forged}.${signature}`)).toBe('The Twitch panel token did not verify');
  });

  it('refuses a token that names no channel, no viewer or no expiry', async () => {
    expect(await refusal(await bearer(without(SHARED, 'channel_id')))).toBe('The Twitch panel token names no channel or viewer');
    expect(await refusal(await bearer({ ...SHARED, channel_id: '0123' }))).toBe('The Twitch panel token names no channel or viewer');
    expect(await refusal(await bearer({ ...SHARED, channel_id: 1001 }))).toBe('The Twitch panel token names no channel or viewer');
    expect(await refusal(await bearer(without(SHARED, 'opaque_user_id')))).toBe('The Twitch panel token names no channel or viewer');
    expect(await refusal(await bearer({ ...SHARED, opaque_user_id: '' }))).toBe('The Twitch panel token names no channel or viewer');
    expect(await refusal(await bearer(SHARED, { exp: null }))).toBe('The Twitch panel token has no expiry');
  });

  it('refuses a missing or odd Authorization header before looking at any token', async () => {
    const token = await mint(SHARED);
    for (const header of [null, '', 'Bearer', 'Bearer ', 'Bearer    ', `bearer ${token}`, `Basic ${token}`, token, `Bearer ${'a'.repeat(4097)}`]) {
      expect(await refusal(header)).toBe('No Twitch panel token');
    }
    expect(await refusal('Bearer not.a.jwt')).toBe('The Twitch panel token did not verify');
  });
});
