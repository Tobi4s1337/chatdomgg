import { jwtVerify, errors } from 'jose';

/**
 * What a verified Twitch Extension token says about the viewer looking at the panel. Only these claims are read,
 * and only after the HS256 signature checks out against the extension's own secret.
 *
 * - `channelId` is the channel whose page carries the panel: the kingdom. Never taken from a request body.
 * - `personId` is the viewer's real Twitch user id, present only once they chose to share their identity with
 *   Chatdom (`requestIdShare`). The opaque id is never treated as a person.
 */
export type PanelViewer =
  | { readonly channelId: string; readonly role: string; readonly kind: 'anonymous' }
  | { readonly channelId: string; readonly role: string; readonly kind: 'unshared' }
  | { readonly channelId: string; readonly role: string; readonly kind: 'shared'; readonly personId: string };

const ID = /^[1-9][0-9]{0,31}$/;

export class PanelTokenError extends Error {
  constructor(message: string) { super(message); this.name = 'PanelTokenError'; }
}

/** The extension secret from the console is base64; the HMAC key is its decoded bytes. */
export function extensionKey(secret: string): Uint8Array {
  const key = Buffer.from(secret, 'base64');
  if (key.length < 16) throw new Error('TWITCH_EXTENSION_SECRET must be the base64 secret from the extension console');
  return new Uint8Array(key);
}

export async function verifyPanelToken(authorization: string | null, key: Uint8Array): Promise<PanelViewer> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || token.length > 4096) throw new PanelTokenError('No Twitch panel token');
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key, { algorithms: ['HS256'], clockTolerance: 30 }));
  } catch (error) {
    throw new PanelTokenError(error instanceof errors.JWTExpired ? 'The Twitch panel token expired' : 'The Twitch panel token did not verify');
  }
  const channelId = typeof payload.channel_id === 'string' && ID.test(payload.channel_id) ? payload.channel_id : null;
  const opaque = typeof payload.opaque_user_id === 'string' ? payload.opaque_user_id : '';
  const role = typeof payload.role === 'string' ? payload.role : 'viewer';
  if (!channelId || !opaque) throw new PanelTokenError('The Twitch panel token names no channel or viewer');
  if (typeof payload.exp !== 'number') throw new PanelTokenError('The Twitch panel token has no expiry');
  const userId = typeof payload.user_id === 'string' && ID.test(payload.user_id) ? payload.user_id : null;
  if (userId) return { channelId, role, kind: 'shared', personId: userId };
  // `A…` is a logged-out viewer; `U…` is logged in but has not shared who they are.
  return { channelId, role, kind: opaque.startsWith('U') ? 'unshared' : 'anonymous' };
}
